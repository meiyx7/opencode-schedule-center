import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { ScheduleStore } from "./.build/store.js"

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeSchedule(overrides = {}) {
  return {
    id: "t-1",
    sessionID: "ses-1",
    when: { type: "every", every: "5 minutes" },
    tz: "Asia/Shanghai",
    action: { type: "prompt", prompt: "do it" },
    status: "active",
    runCount: 0,
    time: { created: 1, updated: 1 },
    ...overrides,
  }
}

function makeSession(overrides = {}) {
  return { id: "ses-1", title: "定时任务：巡检", ...overrides }
}

function draft(overrides = {}) {
  return {
    sessionID: "",
    name: "巡检",
    when: { kind: "every", every: "5 minutes" },
    prompt: "do it",
    ...overrides,
  }
}

function record(target, group, calls) {
  for (const [name, fn] of Object.entries(target)) {
    if (typeof fn !== "function") continue
    target[name] = async (...args) => {
      calls.push({ group, name, args })
      return fn(...args)
    }
  }
}

/** Minimal in-memory stand-in for the official OpenCode client. */
function createClient(overrides = {}) {
  const calls = []
  const baseSession = {
    list: async () => ({ data: [], cursor: {} }),
    create: async () => makeSession({ id: "new-session" }),
    get: async (params) => makeSession({ id: params.sessionID }),
    switchModel: async () => ({}),
    remove: async () => {},
  }
  const baseSchedule = {
    create: async (params) => makeSchedule({ sessionID: params.sessionID }),
    list: async () => [],
    delete: async () => {},
    pause: async (params) => makeSchedule({ id: params.scheduleID }),
    resume: async (params) => makeSchedule({ id: params.scheduleID }),
  }
  const session = { ...baseSession, ...(overrides.session ?? {}) }
  const schedule = { ...baseSchedule, ...(overrides.schedule ?? {}) }
  record(session, "session", calls)
  record(schedule, "schedule", calls)
  const client = {
    session,
    experimental: { schedule },
    model: { list: async () => ({ data: [] }) },
    provider: { list: async () => ({ data: [] }) },
    agent: { list: async () => ({ data: [] }) },
  }
  return { client, calls }
}

function countOf(calls, group, name) {
  return calls.filter((call) => call.group === group && call.name === name).length
}

function hasCall(calls, group, name) {
  return countOf(calls, group, name) > 0
}

async function seededStore({ sessions = [], schedules = {} } = {}) {
  const { client, calls } = createClient({
    session: { list: async () => ({ data: sessions, cursor: {} }) },
    schedule: { list: async ({ sessionID }) => schedules[sessionID] ?? [] },
  })
  const store = new ScheduleStore(client)
  const result = await store.listAll()
  return { store, calls, result }
}

describe("会话安全 / TASK-01", () => {
  it("普通用户会话不会被删除", async () => {
    const sessions = [makeSession({ id: "u1", title: "我的聊天" })]
    const schedules = { u1: [makeSchedule({ id: "t1", sessionID: "u1" })] }
    const { store, calls, result } = await seededStore({ sessions, schedules })
    assert.equal(result.rows.length, 1)

    await store.remove("t1")
    assert.equal(hasCall(calls, "session", "remove"), false, "不得发出任何会话删除请求")
    assert.equal(store.cachedRows().length, 0, "任务应从缓存移除")
  })

  it("用户修改标题后的会话不会被误删", async () => {
    const sessions = [makeSession({ id: "s1", title: "我改名了，不再是定时任务" })]
    const schedules = { s1: [makeSchedule({ id: "t1", sessionID: "s1" })] }
    const { store, calls } = await seededStore({ sessions, schedules })

    await store.remove("t1")
    assert.equal(hasCall(calls, "session", "remove"), false)
  })

  it("同一会话多个任务的删除互不影响", async () => {
    const sessions = [makeSession({ id: "s1", title: "定时任务：共享会话" })]
    const schedules = {
      s1: [makeSchedule({ id: "t1", sessionID: "s1" }), makeSchedule({ id: "t2", sessionID: "s1", prompt: "other" })],
    }
    const { store, calls } = await seededStore({ sessions, schedules })

    await store.remove("t1")
    const remaining = store.cachedRows()
    assert.equal(remaining.length, 1)
    assert.equal(remaining[0].schedule.id, "t2")
    assert.equal(hasCall(calls, "session", "remove"), false)
  })

  it("删除失败保留任务，且不产生会话删除请求", async () => {
    const { client, calls } = createClient({
      session: { list: async () => ({ data: [makeSession({ id: "s1" })], cursor: {} }) },
      schedule: {
        list: async () => [makeSchedule({ id: "t1", sessionID: "s1" })],
        delete: async () => {
          throw new Error("delete failed")
        },
      },
    })
    const store = new ScheduleStore(client)
    await store.listAll()

    await assert.rejects(store.remove("t1"), /delete failed/)
    assert.equal(store.cachedRows().length, 1, "删除失败时任务仍在")
    assert.equal(hasCall(calls, "session", "remove"), false)
  })
})

describe("创建与回滚 / TASK-02", () => {
  it("Session 创建失败：直接抛出，不发起任何会话删除", async () => {
    const { client, calls } = createClient({
      session: {
        create: async () => {
          throw new Error("session create failed")
        },
      },
    })
    const store = new ScheduleStore(client)
    await assert.rejects(store.createSchedule(draft()), /session create failed/)
    assert.equal(hasCall(calls, "schedule", "create"), false)
    assert.equal(hasCall(calls, "session", "remove"), false)
  })

  it("Schedule 明确失败：等待回滚完成后才抛出原错误", async () => {
    const gate = deferred()
    let sessionRemoved = false
    const { client, calls } = createClient({
      schedule: {
        create: async () => {
          throw new Error("create failed")
        },
        list: async () => [],
      },
      session: {
        remove: async () => {
          await gate.promise
          sessionRemoved = true
        },
      },
    })
    const store = new ScheduleStore(client)
    const pending = store.createSchedule(draft())
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(countOf(calls, "session", "remove"), 1)
    assert.equal(sessionRemoved, false, "回滚未完成时不得 settle")
    gate.resolve()
    await assert.rejects(pending, /create failed/)
    assert.equal(sessionRemoved, true, "回滚必须被等待")
  })

  it("请求超时但服务端已创建：核对命中后认领任务并保留会话", async () => {
    const { client, calls } = createClient({
      schedule: {
        create: async () => {
          throw new Error("timeout")
        },
        list: async ({ sessionID }) => [makeSchedule({ id: "t-adopted", sessionID, prompt: "do it" })],
      },
    })
    const store = new ScheduleStore(client)
    const created = await store.createSchedule(draft())

    assert.equal(created.id, "t-adopted")
    assert.equal(hasCall(calls, "session", "remove"), false, "绝不删除已创建任务的承载会话")
    assert.equal(store.cachedRows().length, 1)
  })

  it("响应丢失（AbortError）：与超时同样认领，不删会话", async () => {
    const { client, calls } = createClient({
      schedule: {
        create: async () => {
          const error = new Error("aborted")
          error.name = "AbortError"
          throw error
        },
        list: async ({ sessionID }) => [makeSchedule({ id: "t-lost-response", sessionID })],
      },
    })
    const store = new ScheduleStore(client)
    const created = await store.createSchedule(draft())
    assert.equal(created.id, "t-lost-response")
    assert.equal(hasCall(calls, "schedule", "list"), true, "必须用官方 List API 核对")
    assert.equal(hasCall(calls, "session", "remove"), false)
  })

  it("回滚失败：错误信息同时包含回滚原因与原始原因", async () => {
    const { client } = createClient({
      schedule: {
        create: async () => {
          throw new Error("original create failure")
        },
        list: async () => [],
      },
      session: {
        remove: async () => {
          throw new Error("cleanup failure")
        },
      },
    })
    const store = new ScheduleStore(client)
    await assert.rejects(
      store.createSchedule(draft()),
      (error) =>
        error.message.includes("承载会话清理失败") &&
        error.message.includes("cleanup failure") &&
        error.message.includes("original create failure"),
    )
  })

  it("重复提交：只创建一个会话和一个任务", async () => {
    const { client, calls } = createClient()
    const store = new ScheduleStore(client)
    const first = store.createSchedule(draft())
    const second = store.createSchedule(draft())
    const [a, b] = await Promise.all([first, second])

    assert.equal(countOf(calls, "session", "create"), 1)
    assert.equal(countOf(calls, "schedule", "create"), 1)
    assert.equal(a.id, b.id)
    assert.equal(store.cachedRows().length, 1)
  })

  it("不同草稿并发提交不会被单飞吞掉", async () => {
    const { client, calls } = createClient({
      schedule: {
        create: async (params) =>
          makeSchedule({ id: `t-${params.prompt}`, sessionID: params.sessionID, prompt: params.prompt }),
      },
    })
    const store = new ScheduleStore(client)
    const [a, b] = await Promise.all([
      store.createSchedule(draft({ prompt: "task A" })),
      store.createSchedule(draft({ prompt: "task B" })),
    ])
    assert.equal(countOf(calls, "schedule", "create"), 2)
    assert.equal(a.id, "t-task A")
    assert.equal(b.id, "t-task B")
  })

  it("核对也失败：结果未知，保留会话并明确报错", async () => {
    const { client, calls } = createClient({
      schedule: {
        create: async () => {
          throw new Error("timeout")
        },
        list: async () => {
          throw new Error("list unavailable")
        },
      },
    })
    const store = new ScheduleStore(client)
    await assert.rejects(
      store.createSchedule(draft()),
      (error) =>
        error.message.includes("无法确认") &&
        error.message.includes("承载会话") &&
        error.message.includes("已保留"),
    )
    assert.equal(hasCall(calls, "session", "remove"), false)
  })

  it("超时且核对为空：不删会话，按结果未知处理", async () => {
    const { client, calls } = createClient({
      schedule: {
        create: async () => {
          const error = new Error("request timeout")
          error.name = "TimeoutError"
          throw error
        },
        list: async () => [],
      },
    })
    const store = new ScheduleStore(client)
    await assert.rejects(store.createSchedule(draft()), /无法确认/)
    assert.equal(hasCall(calls, "session", "remove"), false, "空列表不能证明服务端未创建")
  })

  it("模型未能确认：等待回滚后抛错，不创建任务", async () => {
    const model = { id: "m1", providerID: "p1" }
    const { client, calls } = createClient({
      session: {
        create: async () => makeSession({ id: "new-session" }),
        get: async (params) => makeSession({ id: params.sessionID, model: { id: "other", providerID: "p1" } }),
      },
    })
    const store = new ScheduleStore(client)
    await assert.rejects(store.createSchedule(draft({ model })), /无法确认模型/)
    assert.equal(countOf(calls, "session", "remove"), 1)
    assert.equal(hasCall(calls, "schedule", "create"), false)
  })
})

describe("全会话扫描分页 / TASK-03", () => {
  it("0 个会话：返回空的完整结果", async () => {
    const { store, result } = await seededStore()
    assert.deepEqual(result.rows, [])
    assert.deepEqual(result.failures, [])
    assert.equal(result.truncated, false)
  })

  it("不足一页：全部会话都被扫描", async () => {
    const sessions = [1, 2, 3].map((n) => makeSession({ id: `s${n}` }))
    const schedules = Object.fromEntries(
      sessions.map((session) => [session.id, [makeSchedule({ id: `t-${session.id}`, sessionID: session.id })]]),
    )
    const { result } = await seededStore({ sessions, schedules })
    assert.equal(result.rows.length, 3)
    assert.equal(result.truncated, false)
  })

  it("恰好一页：没有 next 游标即终止", async () => {
    const sessions = Array.from({ length: 200 }, (_, index) => makeSession({ id: `s${index}` }))
    const { client, calls } = createClient({
      session: { list: async () => ({ data: sessions, cursor: { next: null } }) },
    })
    const result = await new ScheduleStore(client).listAll()
    assert.equal(countOf(calls, "session", "list"), 1)
    assert.equal(result.rows.length, 0)
    assert.equal(result.truncated, false)
  })

  it("多页：使用官方 cursor 逐页推进", async () => {
    const seen = []
    const { client, calls } = createClient({
      session: {
        list: async ({ cursor }) => {
          seen.push(cursor ?? "first")
          if (!cursor) {
            return { data: [makeSession({ id: "s1" }), makeSession({ id: "s2" })], cursor: { next: "cursor-2" } }
          }
          return { data: [makeSession({ id: "s3" })], cursor: {} }
        },
      },
      schedule: {
        list: async ({ sessionID }) => [makeSchedule({ id: `t-${sessionID}`, sessionID })],
      },
    })
    const result = await new ScheduleStore(client).listAll()
    assert.deepEqual(seen, ["first", "cursor-2"])
    assert.equal(countOf(calls, "session", "list"), 2)
    assert.equal(result.rows.length, 3)
    assert.equal(result.truncated, false)
  })

  it("超过 20,000 个会话的模拟：达到安全上限时明确标记不完整", async () => {
    let page = 0
    const { client, calls } = createClient({
      session: {
        list: async () => {
          page += 1
          return { data: [makeSession({ id: `s${page}` })], cursor: { next: `cursor-${page + 1}` } }
        },
      },
    })
    const result = await new ScheduleStore(client).listAll()
    assert.equal(countOf(calls, "session", "list"), 100, "硬上限应被检测到而非静默截断")
    assert.equal(result.truncated, true)
    assert.equal(result.rows.length, 0)
  })

  it("达到安全上限时保留未扫描会话的已有任务，不静默丢失", async () => {
    let truncatedMode = false
    const { client } = createClient({
      session: {
        list: async ({ cursor }) => {
          if (!truncatedMode) return { data: [makeSession({ id: "s3" })], cursor: {} }
          return { data: [makeSession({ id: "s1" })], cursor: { next: `cursor-${cursor ?? 1}` } }
        },
      },
      schedule: {
        list: async ({ sessionID }) => [makeSchedule({ id: `t-${sessionID}`, sessionID })],
      },
    })
    const store = new ScheduleStore(client)
    const first = await store.listAll()
    assert.equal(first.rows.length, 1)

    truncatedMode = true
    const second = await store.listAll()
    assert.equal(second.truncated, true)
    assert.deepEqual(second.rows.map((row) => row.schedule.id).sort(), ["t-s1", "t-s3"])
  })

  it("中间某页请求失败：抛出错误而非返回静默不完整结果", async () => {
    let listCount = 0
    const { client } = createClient({
      session: {
        list: async () => {
          listCount += 1
          if (listCount === 1) return { data: [makeSession({ id: "s1" })], cursor: {} }
          if (listCount === 2) {
            return { data: [makeSession({ id: "s1" })], cursor: { next: "cursor-2" } }
          }
          throw new Error("page failed")
        },
      },
      schedule: {
        list: async ({ sessionID }) => [makeSchedule({ id: `t-${sessionID}`, sessionID })],
      },
    })
    const store = new ScheduleStore(client)
    await store.listAll()
    assert.equal(store.cachedRows().length, 1)
    await assert.rejects(store.listAll(), /page failed/)
    assert.equal(store.cachedRows().length, 1, "失败不得清空上次有效数据")
  })

  it("扫描期间的暂停操作不会被较旧的扫描结果覆盖", async () => {
    const gate = deferred()
    let listCount = 0
    const { client } = createClient({
      session: { list: async () => ({ data: [makeSession({ id: "s1" })], cursor: {} }) },
      schedule: {
        list: async ({ sessionID }) => {
          listCount += 1
          if (listCount === 1) return [makeSchedule({ id: "t1", sessionID })]
          await gate.promise
          return [makeSchedule({ id: "t1", sessionID })]
        },
        pause: async (params) => makeSchedule({ id: params.scheduleID, sessionID: "s1", status: "paused" }),
      },
    })
    const store = new ScheduleStore(client)
    await store.listAll()

    const sweeping = store.listAll()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const patched = await store.pause("t1")
    assert.equal(patched[0].schedule.status, "paused")

    gate.resolve()
    const result = await sweeping
    assert.equal(result.rows[0].schedule.status, "paused", "本地较新写入不得被扫描快照覆盖")
    assert.equal(store.cachedRows()[0].schedule.status, "paused")
  })

  it("分页期间会话数量发生变化：返回可识别结果，不声称强一致", async () => {
    const { client, result } = createClient({
      session: {
        list: async ({ cursor }) => {
          if (!cursor) {
            return { data: [makeSession({ id: "s1" }), makeSession({ id: "s2" })], cursor: { next: "cursor-2" } }
          }
          return { data: [makeSession({ id: "s3" })], cursor: {} }
        },
      },
      schedule: {
        list: async ({ sessionID }) => [makeSchedule({ id: `t-${sessionID}`, sessionID })],
      },
    })
    const sweep = await new ScheduleStore(client).listAll()
    assert.equal(sweep.rows.length, 3)
    assert.equal(sweep.truncated, false, "接口无快照语义，此处只报告可检测的不完整状态")
  })
})

describe("部分失败处理 / TASK-05", () => {
  it("一个会话失败：其他会话数据保留，失败被记录", async () => {
    const { client, calls } = createClient({
      session: {
        list: async () => ({ data: [makeSession({ id: "s1" }), makeSession({ id: "s2" })], cursor: {} }),
      },
      schedule: {
        list: async ({ sessionID }) => {
          if (sessionID === "s2") throw new Error("s2 unavailable")
          return [makeSchedule({ id: `t-${sessionID}`, sessionID })]
        },
      },
    })
    const result = await new ScheduleStore(client).listAll()
    assert.equal(result.rows.length, 1)
    assert.equal(result.rows[0].schedule.id, "t-s1")
    assert.equal(result.failures.length, 1)
    assert.equal(result.failures[0].sessionID, "s2")
    assert.equal(result.failures[0].reason, "s2 unavailable")
    assert.equal(hasCall(calls, "schedule", "delete"), false)
  })

  it("多个会话失败：全部失败会话都被记录", async () => {
    const sessions = [1, 2, 3].map((n) => makeSession({ id: `s${n}` }))
    const { client } = createClient({
      session: { list: async () => ({ data: sessions, cursor: {} }) },
      schedule: {
        list: async ({ sessionID }) => {
          if (sessionID !== "s1") throw new Error(`${sessionID} down`)
          return [makeSchedule({ id: "t-s1", sessionID })]
        },
      },
    })
    const result = await new ScheduleStore(client).listAll()
    assert.equal(result.failures.length, 2)
    assert.deepEqual(result.failures.map((item) => item.sessionID).sort(), ["s2", "s3"])
  })

  it("全部会话失败：rows 为空但 failures 明确，不误报任务数量", async () => {
    const sessions = [makeSession({ id: "s1" }), makeSession({ id: "s2" })]
    const { client } = createClient({
      session: { list: async () => ({ data: sessions, cursor: {} }) },
      schedule: {
        list: async () => {
          throw new Error("all down")
        },
      },
    })
    const result = await new ScheduleStore(client).listAll()
    assert.equal(result.rows.length, 0)
    assert.equal(result.failures.length, 2)
  })

  it("失败会话保留上次任务，不被判定为没有任务", async () => {
    let fail = false
    const sessions = [makeSession({ id: "s1" }), makeSession({ id: "s2" })]
    const { client } = createClient({
      session: { list: async () => ({ data: sessions, cursor: {} }) },
      schedule: {
        list: async ({ sessionID }) => {
          if (fail && sessionID === "s2") throw new Error("temporary failure")
          return [makeSchedule({ id: `t-${sessionID}`, sessionID })]
        },
      },
    })
    const store = new ScheduleStore(client)
    const first = await store.listAll()
    assert.equal(first.rows.length, 2)

    fail = true
    const second = await store.listAll()
    assert.equal(second.rows.length, 2, "失败会话的旧任务必须保留")
    assert.equal(second.failures.length, 1)
    assert.equal(second.failures[0].sessionID, "s2")
  })

  it("后续刷新成功后恢复完整状态", async () => {
    let fail = true
    const sessions = [makeSession({ id: "s1" }), makeSession({ id: "s2" })]
    const { client } = createClient({
      session: { list: async () => ({ data: sessions, cursor: {} }) },
      schedule: {
        list: async ({ sessionID }) => {
          if (fail && sessionID === "s2") throw new Error("temporary failure")
          return [makeSchedule({ id: `t-${sessionID}`, sessionID })]
        },
      },
    })
    const store = new ScheduleStore(client)
    const partial = await store.listAll()
    assert.equal(partial.failures.length, 1)

    fail = false
    const complete = await store.listAll()
    assert.equal(complete.failures.length, 0)
    assert.equal(complete.rows.length, 2)
    assert.equal(complete.truncated, false)
  })

  it("部分失败不触发任何删除或修改动作", async () => {
    const { client, calls } = createClient({
      session: {
        list: async () => ({ data: [makeSession({ id: "s1" }), makeSession({ id: "s2" })], cursor: {} }),
      },
      schedule: {
        list: async ({ sessionID }) => {
          if (sessionID === "s2") throw new Error("down")
          return [makeSchedule({ id: "t-s1", sessionID })]
        },
      },
    })
    await new ScheduleStore(client).listAll()
    for (const name of ["delete", "pause", "resume", "create"]) {
      assert.equal(hasCall(calls, "schedule", name), false, `不得调用 schedule.${name}`)
    }
    assert.equal(hasCall(calls, "session", "remove"), false)
  })
})
