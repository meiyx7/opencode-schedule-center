import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { createScanCoordinator } from "./.build/scan-coordinator.js"

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe("全量扫描单飞 / TASK-04", () => {
  it("连续手动刷新只触发一轮扫描，所有调用方共享结果", async () => {
    let count = 0
    const gate = deferred()
    const coordinator = createScanCoordinator(async () => {
      count += 1
      await gate.promise
      return ["row-1"]
    })

    const first = coordinator.refresh()
    const second = coordinator.refresh()
    const third = coordinator.refresh()
    assert.equal(coordinator.busy, true)
    assert.equal(count, 1, "三次调用必须复用同一个在飞 Promise")

    gate.resolve()
    const [a, b, c] = await Promise.all([first, second, third])
    assert.deepEqual(a, { ok: true, data: ["row-1"] })
    assert.deepEqual(b, a)
    assert.deepEqual(c, a)
    assert.equal(coordinator.busy, false)
  })

  it("自动刷新与手动刷新不会相互覆盖", async () => {
    let count = 0
    const gate = deferred()
    const coordinator = createScanCoordinator(async () => {
      count += 1
      await gate.promise
      return { generation: 1 }
    })
    const auto = coordinator.refresh()
    const manual = coordinator.refresh()
    gate.resolve()
    const outcomes = await Promise.all([auto, manual])
    assert.equal(count, 1)
    assert.deepEqual(outcomes[0].data, { generation: 1 })
    assert.deepEqual(outcomes[1].data, { generation: 1 })
  })

  it("旧请求不会晚于新请求返回，因为不存在第二轮请求", async () => {
    const gates = []
    let count = 0
    const coordinator = createScanCoordinator(async () => {
      count += 1
      const gate = deferred()
      gates.push(gate)
      await gate.promise
      return count
    })
    const slowFirst = coordinator.refresh()
    const wouldBeSecond = coordinator.refresh()
    assert.equal(gates.length, 1, "第二次调用不得发起新的扫描")
    gates[0].resolve()
    const [a, b] = await Promise.all([slowFirst, wouldBeSecond])
    assert.equal(a.data, 1)
    assert.equal(b.data, 1)
    assert.equal(count, 1)
  })

  it("首次加载失败标记为 firstLoad，且不产生可用数据", async () => {
    const coordinator = createScanCoordinator(async () => {
      throw new Error("首次扫描失败")
    })
    const outcome = await coordinator.refresh()
    assert.equal(outcome.ok, false)
    assert.equal(outcome.firstLoad, true)
    assert.equal(outcome.error.message, "首次扫描失败")
  })

  it("成功后的后台刷新失败标记为非首次，且协调器不持有数据", async () => {
    let fail = false
    const coordinator = createScanCoordinator(async () => {
      if (fail) throw new Error("后台刷新失败")
      return ["kept"]
    })
    assert.deepEqual(await coordinator.refresh(), { ok: true, data: ["kept"] })
    fail = true
    const outcome = await coordinator.refresh()
    assert.equal(outcome.ok, false)
    assert.equal(outcome.firstLoad, false, "已有可用数据时失败属于后台刷新")
  })

  it("首次失败后重试仍是首次加载，直到首次成功才降级为后台失败", async () => {
    let state = "fail"
    const coordinator = createScanCoordinator(async () => {
      if (state === "fail") throw new Error("boom")
      return ["ok"]
    })
    const first = await coordinator.refresh()
    assert.equal(first.firstLoad, true)
    const retry = await coordinator.refresh()
    assert.equal(retry.firstLoad, true, "从未成功过，重试仍属于首次加载")
    state = "ok"
    assert.equal((await coordinator.refresh()).ok, true)
    state = "fail"
    const later = await coordinator.refresh()
    assert.equal(later.firstLoad, false)
  })

  it("扫描完成后 busy 归位，允许下一轮刷新", async () => {
    const coordinator = createScanCoordinator(async () => ["x"])
    assert.equal(coordinator.busy, false)
    const pending = coordinator.refresh()
    assert.equal(coordinator.busy, true)
    await pending
    assert.equal(coordinator.busy, false)
    assert.equal((await coordinator.refresh()).ok, true)
  })
})
