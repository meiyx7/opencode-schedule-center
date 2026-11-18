import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { ScheduleStore, classifyCreateError } from "./.build/store.js"

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
    name: "do it",
    projectID: "prj-1",
    sessionID: "ses-1",
    directory: "/work",
    trigger: { type: "every", every: "5 minutes" },
    tz: "Asia/Shanghai",
    action: { type: "prompt", prompt: "do it", to: { session: "ses-1" } },
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
    switchAgent: async () => ({}),
    remove: async () => {},
  }
  const baseAutomation = {
    create: async (params) => makeSchedule({ sessionID: params.sessionID }),
    list: async () => [],
    get: async (params) => makeSchedule({ id: params.automationID }),
    delete: async () => {},
    pause: async (params) => makeSchedule({ id: params.automationID }),
    resume: async (params) => makeSchedule({ id: params.automationID }),
  }
  const session = { ...baseSession, ...(overrides.session ?? {}) }
  const automation = { ...baseAutomation, ...(overrides.automation ?? {}) }
  record(session, "session", calls)
  record(automation, "automation", calls)
  const client = {
    session,
    experimental: { automation },
    model: { list: async () => ({ data: [] }) },
    provider: { list: async () => ({ data: [] }) },
    agent: { list: async () => ({ data: [] }) },
  }
  return { client, calls }
}

/** The official create payload carries the prompt inside `action`. */
function createdPrompt(params) {
  return params.action?.prompt ?? params.prompt
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
    automation: { list: async ({ sessionID }) => schedules[sessionID] ?? [] },
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
      automation: {
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
    assert.equal(hasCall(calls, "automation", "create"), false)
    assert.equal(hasCall(calls, "session", "remove"), false)
  })

  it("Schedule 明确拒绝：等待回滚完成后才抛出原错误", async () => {
    const gate = deferred()
    let sessionRemoved = false
    // SDK declared errors are Error instances carrying _tag (Object.assign).
    const rejection = Object.assign(new Error("create rejected"), {
      _tag: "InvalidRequestError",
      name: "InvalidRequestError",
    })
    const { client, calls } = createClient({
      automation: {
        create: async () => {
          throw rejection
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
    await assert.rejects(pending, (error) => error === rejection)
    assert.equal(sessionRemoved, true, "回滚必须被等待")
  })

  it("请求超时但服务端已创建：核对命中后认领任务并保留会话", async () => {
    const { client, calls } = createClient({
      automation: {
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
      automation: {
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
    assert.equal(hasCall(calls, "automation", "list"), true, "必须用官方 List API 核对")
    assert.equal(hasCall(calls, "session", "remove"), false)
  })

  it("回滚失败：错误信息同时包含回滚原因与原始原因", async () => {
    const { client } = createClient({
      automation: {
        create: async () => {
          throw Object.assign(new Error("original create rejection"), {
            _tag: "InvalidRequestError",
            name: "InvalidRequestError",
          })
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
        error.message.includes("original create rejection"),
    )
  })

  it("重复提交：只创建一个会话和一个任务", async () => {
    const { client, calls } = createClient()
    const store = new ScheduleStore(client)
    const first = store.createSchedule(draft())
    const second = store.createSchedule(draft())
    const [a, b] = await Promise.all([first, second])

    assert.equal(countOf(calls, "session", "create"), 1)
    assert.equal(countOf(calls, "automation", "create"), 1)
    assert.equal(a.id, b.id)
    assert.equal(store.cachedRows().length, 1)
  })

  it("不同草稿并发提交不会被单飞吞掉", async () => {
    const { client, calls } = createClient({
      automation: {
        create: async (params) =>
          makeSchedule({ id: `t-${createdPrompt(params)}`, sessionID: params.sessionID, prompt: createdPrompt(params) }),
      },
    })
    const store = new ScheduleStore(client)
    const [a, b] = await Promise.all([
      store.createSchedule(draft({ prompt: "task A" })),
      store.createSchedule(draft({ prompt: "task B" })),
    ])
    assert.equal(countOf(calls, "automation", "create"), 2)
    assert.equal(a.id, "t-task A")
    assert.equal(b.id, "t-task B")
  })

  it("核对也失败：结果未知，保留会话并明确报错", async () => {
    const { client, calls } = createClient({
      automation: {
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
      automation: {
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
    assert.equal(hasCall(calls, "automation", "create"), false)
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
      automation: {
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
      automation: {
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
      automation: {
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
      automation: {
        list: async ({ sessionID }) => {
          listCount += 1
          if (listCount === 1) return [makeSchedule({ id: "t1", sessionID })]
          await gate.promise
          return [makeSchedule({ id: "t1", sessionID })]
        },
        pause: async (params) => makeSchedule({ id: params.automationID, sessionID: "s1", status: "paused" }),
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
      automation: {
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
      automation: {
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
    assert.equal(hasCall(calls, "automation", "delete"), false)
  })

  it("多个会话失败：全部失败会话都被记录", async () => {
    const sessions = [1, 2, 3].map((n) => makeSession({ id: `s${n}` }))
    const { client } = createClient({
      session: { list: async () => ({ data: sessions, cursor: {} }) },
      automation: {
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
      automation: {
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
      automation: {
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
      automation: {
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
      automation: {
        list: async ({ sessionID }) => {
          if (sessionID === "s2") throw new Error("down")
          return [makeSchedule({ id: "t-s1", sessionID })]
        },
      },
    })
    await new ScheduleStore(client).listAll()
    for (const name of ["delete", "pause", "resume", "create"]) {
      assert.equal(hasCall(calls, "automation", name), false, `不得调用 automation.${name}`)
    }
    assert.equal(hasCall(calls, "session", "remove"), false)
  })
})

describe("批次3：官方创建参数透传", () => {
  function createCall(overrides = {}) {
    const { client, calls } = createClient(overrides)
    return { client, calls, params: () => calls.find((c) => c.group === "automation" && c.name === "create")?.args[0] }
  }

  it("in 折算为官方 at 触发器并透传可选 tz", async () => {
    const { client, params } = createCall()
    await new ScheduleStore(client).createSchedule(
      draft({ when: { kind: "in", in: "30 minutes", tz: "Asia/Shanghai" } }),
    )
    assert.equal(params().trigger.type, "at")
    assert.equal(params().trigger.at, "in 30 minutes")
    assert.equal(params().trigger.tz, "Asia/Shanghai")
  })

  it("未提供 tz 时不发送该字段", async () => {
    const { client, params } = createCall()
    await new ScheduleStore(client).createSchedule(draft())
    assert.equal("tz" in params().trigger, false)
  })

  it("创建者 sessionID 与执行目标 action.to.session 均指向承载会话（语义不混用）", async () => {
    const { client, params } = createCall()
    await new ScheduleStore(client).createSchedule(draft())
    assert.equal(params().sessionID, "new-session")
    assert.deepEqual(params().action, {
      type: "prompt",
      prompt: "do it",
      to: { session: "new-session" },
    })
    assert.equal(params().name, "巡检")
  })

  it("官方 Automation API 无 if/until 门禁字段：不向入参注入", async () => {
    const { client, params } = createCall()
    await new ScheduleStore(client).createSchedule(
      draft({
        if: { run: "git status --porcelain", changes: true },
        until: { code: "return dayOfWeek() === 5" },
      }),
    )
    assert.equal("if" in params(), false)
    assert.equal("until" in params(), false)
    assert.equal(params().action.type, "prompt")
  })

  it("ends.after/at 折算为官方 expires；times 无官方对应不注入", async () => {
    const cases = [
      [{ after: "2 hours" }, "in 2 hours"],
      [{ at: "2026-12-01T09:00:00+08:00" }, "2026-12-01T09:00:00+08:00"],
      [{ times: 5 }, undefined],
    ]
    for (const [ends, expected] of cases) {
      const { client, params } = createCall()
      await new ScheduleStore(client).createSchedule(draft({ ends }))
      assert.equal(params().expires, expected, `ends=${JSON.stringify(ends)} 的 expires 映射`)
      assert.equal("ends" in params(), false)
    }
  })

  it("different ends / conditions count as distinct drafts for duplicate-submit", async () => {
    const { client, calls } = createCall()
    const store = new ScheduleStore(client)
    const a = store.createSchedule(draft({ ends: { times: 5 } }))
    const b = store.createSchedule(draft({ ends: { times: 10 } }))
    await Promise.all([a, b])
    assert.equal(countOf(calls, "automation", "create"), 2)
  })

  it("same full draft (incl. tz/ends/if) still coalesces to one create", async () => {
    const { client, calls } = createCall()
    const store = new ScheduleStore(client)
    const full = draft({
      when: { kind: "every", every: "5 minutes", tz: "Asia/Shanghai" },
      ends: { after: "2 hours" },
      if: { run: "test -f /tmp/flag" },
    })
    await Promise.all([store.createSchedule(full), store.createSchedule(full)])
    assert.equal(countOf(calls, "automation", "create"), 1)
  })
})

describe("批次5：生命周期操作与按需对账", () => {
  async function primedStore(scheduleOverrides = {}, getOverride) {
    const { client, calls } = createClient({
      session: { list: async () => ({ data: [makeSession({ id: "ses-1" })], cursor: {} }) },
      automation: {
        list: async () => [makeSchedule({ id: "t1", sessionID: "ses-1", ...scheduleOverrides })],
        ...(getOverride ? { get: getOverride } : {}),
      },
    })
    const store = new ScheduleStore(client)
    await store.listAll()
    return { store, calls }
  }

  it("pause 以官方返回值更新缓存，失败则保留原状态", async () => {
    const { store, calls } = await primedStore()
    const paused = await store.pause("t1")
    assert.equal(paused.find((r) => r.schedule.id === "t1").schedule.status, "active") // mock pause returns active
    assert.equal(countOf(calls, "automation", "pause"), 1)

    const c = createClient({
      session: { list: async () => ({ data: [makeSession({ id: "ses-1" })], cursor: {} }) },
      automation: {
        list: async () => [makeSchedule({ id: "t1", sessionID: "ses-1" })],
        pause: async () => { throw new Error("pause down") },
      },
    })
    const failing = new ScheduleStore(c.client)
    await failing.listAll()
    await assert.rejects(failing.pause("t1"), /pause down/)
    assert.equal(failing.cachedRows().length, 1, "失败后保留原任务")
  })

  it("delete 只官方删除，不删 session；失败保留任务", async () => {
    const { store, calls } = await primedStore()
    await store.remove("t1", "ses-1")
    assert.equal(countOf(calls, "automation", "delete"), 1)
    assert.equal(hasCall(calls, "session", "remove"), false, "不得删承载会话")
    assert.equal(store.cachedRows().length, 0)

    const c = createClient({
      session: { list: async () => ({ data: [makeSession({ id: "ses-1" })], cursor: {} }) },
      automation: {
        list: async () => [makeSchedule({ id: "t1", sessionID: "ses-1" })],
        delete: async () => { throw new Error("delete down") },
      },
    })
    const s = new ScheduleStore(c.client)
    await s.listAll()
    await assert.rejects(s.remove("t1"), /delete down/)
    assert.equal(s.cachedRows().length, 1, "删除失败保留任务")
  })

  it("reconcile：任务仍在时以官方 get 值更新缓存", async () => {
    const { store, calls } = await primedStore({ status: "active" }, async () => makeSchedule({ id: "t1", sessionID: "ses-1", status: "paused" }))
    const rows = await store.reconcile("t1")
    assert.equal(countOf(calls, "automation", "get"), 1)
    assert.equal(rows.find((r) => r.schedule.id === "t1").schedule.status, "paused")
  })

  it("reconcile：官方 not found（_tag）时只移除该任务", async () => {
    const { store } = await primedStore({}, async () => {
      const e = new Error("not found"); e._tag = "AutomationNotFoundError"; throw e
    })
    const rows = await store.reconcile("t1")
    assert.equal(rows.length, 0)
  })

  it("reconcile：无法确认时保留上次数据，不改状态", async () => {
    const { store } = await primedStore({ status: "active" }, async () => { throw new Error("network timeout") })
    const rows = await store.reconcile("t1")
    assert.equal(rows.length, 1)
    assert.equal(rows.find((r) => r.schedule.id === "t1").schedule.status, "active")
  })

  it("agent 指定后回读确认：不生效则 switchAgent 并再次核对", async () => {
    const { client, calls } = createClient({
      session: {
        create: async () => makeSession({ id: "new-session", agent: "other" }),
        get: async () => makeSession({ id: "new-session", agent: "build" }),
      },
    })
    const store = new ScheduleStore(client)
    await store.createSchedule(draft({ agent: "build" }))
    assert.equal(countOf(calls, "session", "switchAgent"), 1)
  })

  it("agent 回读失败：等待回滚并抛错，不创建任务", async () => {
    const { client, calls } = createClient({
      session: {
        create: async () => makeSession({ id: "new-session", agent: "other" }),
        get: async () => makeSession({ id: "new-session", agent: "other" }), // switch didn't apply
      },
    })
    const store = new ScheduleStore(client)
    await assert.rejects(store.createSchedule(draft({ agent: "build" })), /无法确认 Agent/)
    assert.equal(hasCall(calls, "automation", "create"), false, "不得创建 automation")
    assert.equal(countOf(calls, "session", "remove"), 1)
  })
})



describe("批次7 / TASK-07：扫描期间的并发变更不得丢失", () => {
  /**
   * A store whose session sweep can be gated from the second scan onward.
   * The first scan seeds the cache; `sweep()` then starts scan #2, blocks
   * after page 1, runs `between`, releases page 2, and returns the result.
   * The snapshot always reports s1/t1 = active, so a local mutation during
   * the sweep is only preserved if the stale snapshot cannot overwrite it.
   */
  function gatedStore() {
    const page1 = deferred()
    const page2 = deferred()
    let gate = false
    let page = 0
    const { client, calls } = createClient({
      session: {
        list: async ({ cursor }) => {
          const first = !cursor
          if (gate && first) {
            page1.resolve()
            await page2.promise
          }
          page += 1
          if (first) return { data: [makeSession({ id: "s1" })], cursor: { next: "c2" } }
          return { data: [makeSession({ id: "s2" })], cursor: {} }
        },
        // Return a model that does NOT match the draft so createOnce takes the
        // switchModel + get verification path; `get` below returns the matching
        // model, making the create succeed. `location` rides along as metadata.
        create: async (params) =>
          makeSession({
            id: "new-session",
            model: { id: "unset", providerID: "p1" },
            agent: "build",
            location: params.location,
          }),
        get: async (params) =>
          makeSession({ id: params.sessionID, model: { id: "m1", providerID: "p1" } }),
      },
      automation: {
        list: async ({ sessionID }) => [makeSchedule({ id: `t-${sessionID}`, sessionID, status: "active" })],
        create: async (params) =>
          makeSchedule({ id: "t-created", sessionID: params.sessionID, prompt: createdPrompt(params), status: "active" }),
        pause: async ({ automationID }) => makeSchedule({ id: automationID, sessionID: "s1", status: "paused" }),
        resume: async ({ automationID }) => makeSchedule({ id: automationID, sessionID: "s1", status: "active" }),
        delete: async () => {},
      },
    })
    const store = new ScheduleStore(client)
    return { store, calls, enableGate: () => { gate = true }, page1, page2 }
  }

  async function interleave(g, between) {
    g.enableGate()
    const sweeping = g.store.listAll()
    await g.page1.promise // page 1 served, page 2 blocked
    const extra = await between(g.store)
    g.page2.resolve()
    const result = await sweeping
    return { result, extra }
  }

  it("第一页后创建任务：任务仍存在，新 Session 的 model/agent/directory 元数据保留", async () => {
    const g = gatedStore()
    await g.store.listAll() // seed
    const model = { id: "m1", providerID: "p1" }
    const { result, extra } = await interleave(g, (s) =>
      s.createSchedule(draft({ name: "新建", model, directory: "/work/proj" })),
    )
    assert.equal(extra.id, "t-created")
    const row = result.rows.find((r) => r.schedule.id === "t-created")
    assert.ok(row, "扫描期间创建的任务不得丢失")
    assert.deepEqual(row.session?.model, model, "新 Session 的 model 元数据不得被快照覆盖")
    assert.equal(row.session?.agent, "build", "新 Session 的 agent 元数据不得被快照覆盖")
    assert.equal(row.session?.location?.directory, "/work/proj", "新 Session 的目录元数据不得丢失")
    assert.equal(g.store.cachedRows().some((r) => r.schedule.id === "t-created"), true)
  })

  it("扫描期间 pause 不被旧快照覆盖", async () => {
    const g = gatedStore()
    await g.store.listAll()
    await interleave(g, (s) => s.pause("t-s1"))
    const row = g.store.cachedRows().find((r) => r.schedule.id === "t-s1")
    assert.equal(row.schedule.status, "paused", "pause 结果必须保留，不被快照的 active 覆盖")
  })

  it("扫描期间 resume 不被旧快照覆盖", async () => {
    const g = gatedStore()
    await g.store.listAll()
    // Make local state paused first, then resume mid-sweep while snapshot says active.
    await g.store.pause("t-s1")
    const { result } = await interleave(g, (s) => s.resume("t-s1"))
    const row = result.rows.find((r) => r.schedule.id === "t-s1")
    assert.equal(row.schedule.status, "active")
    assert.equal(g.store.cachedRows().find((r) => r.schedule.id === "t-s1").schedule.status, "active")
  })

  it("扫描期间 delete 不被扫描结果复活", async () => {
    const g = gatedStore()
    await g.store.listAll()
    await interleave(g, (s) => s.remove("t-s1"))
    assert.equal(g.store.cachedRows().some((r) => r.schedule.id === "t-s1"), false, "已删除任务不得被快照复活")
  })

  it("扫描结束后再次刷新，正常采用最新官方数据", async () => {
    let serverStatus = "active"
    const { client } = createClient({
      session: { list: async () => ({ data: [makeSession({ id: "s1" })], cursor: {} }) },
      automation: { list: async () => [makeSchedule({ id: "t1", sessionID: "s1", status: serverStatus })] },
    })
    const store = new ScheduleStore(client)
    assert.equal((await store.listAll()).rows[0].schedule.status, "active")
    serverStatus = "paused"
    assert.equal((await store.listAll()).rows[0].schedule.status, "paused", "无并发变更时必须采用官方最新数据")
  })
})

describe("批次7 / TASK-08：多草稿并发去重（按 draftKey 管理在途 Promise）", () => {
  /** A create that can be held open by a gate, one gate per prompt. */
  function gatedCreateStore() {
    const gates = new Map()
    const gateFor = (prompt) => {
      if (!gates.has(prompt)) gates.set(prompt, deferred())
      return gates.get(prompt)
    }
    const { client, calls } = createClient({
      session: { create: async () => makeSession({ id: "new-session" }) },
      automation: {
        create: async (params) => {
          await gateFor(createdPrompt(params)).promise
          return makeSchedule({ id: `t-${createdPrompt(params)}`, sessionID: params.sessionID, prompt: createdPrompt(params) })
        },
        list: async () => [],
      },
    })
    return { store: new ScheduleStore(client), calls, gateFor }
  }

  it("A/A：同一草稿只创建一次，共享同一 Promise", async () => {
    const { store, calls, gateFor } = gatedCreateStore()
    const a1 = store.createSchedule(draft({ prompt: "A" }))
    const a2 = store.createSchedule(draft({ prompt: "A" }))
    gateFor("A").resolve()
    const [x, y] = await Promise.all([a1, a2])
    assert.equal(countOf(calls, "automation", "create"), 1)
    assert.equal(countOf(calls, "session", "create"), 1)
    assert.equal(x, y)
  })

  it("A/B：不同草稿各创建一次", async () => {
    const { store, calls, gateFor } = gatedCreateStore()
    const a = store.createSchedule(draft({ prompt: "A" }))
    const b = store.createSchedule(draft({ prompt: "B" }))
    gateFor("A").resolve()
    gateFor("B").resolve()
    await Promise.all([a, b])
    assert.equal(countOf(calls, "automation", "create"), 2)
  })

  it("A/B/A：A 只创建一次，B 一次", async () => {
    const { store, calls, gateFor } = gatedCreateStore()
    const a1 = store.createSchedule(draft({ prompt: "A" }))
    const b = store.createSchedule(draft({ prompt: "B" }))
    const a2 = store.createSchedule(draft({ prompt: "A" }))
    gateFor("A").resolve()
    gateFor("B").resolve()
    const [x, , y] = await Promise.all([a1, b, a2])
    assert.equal(countOf(calls, "automation", "create"), 2)
    assert.equal(x.id, y.id, "两次 A 必须拿到同一个结果")
    assert.equal(x, y)
  })

  it("A 失败、B 成功：互不影响，且失败后可重新提交 A", async () => {
    const gates = new Map()
    const gateFor = (prompt) => {
      if (!gates.has(prompt)) gates.set(prompt, deferred())
      return gates.get(prompt)
    }
    let aAttempts = 0
    const { client, calls } = createClient({
      session: { create: async () => makeSession({ id: "new-session" }) },
      automation: {
        create: async (params) => {
          await gateFor(createdPrompt(params)).promise
          if (createdPrompt(params) === "A") {
            aAttempts += 1
            if (aAttempts === 1) {
              throw Object.assign(new Error("A rejected"), { _tag: "InvalidRequestError", name: "InvalidRequestError" })
            }
          }
          return makeSchedule({ id: `t-${createdPrompt(params)}`, sessionID: params.sessionID, prompt: createdPrompt(params) })
        },
        list: async () => [],
      },
    })
    const store = new ScheduleStore(client)
    const a1 = store.createSchedule(draft({ prompt: "A" }))
    const b = store.createSchedule(draft({ prompt: "B" }))
    gateFor("A").resolve()
    gateFor("B").resolve()
    const bResult = await b
    await assert.rejects(a1, (e) => e._tag === "InvalidRequestError")
    assert.equal(bResult.id, "t-B", "B 不受 A 失败影响")
    assert.equal(countOf(calls, "automation", "create"), 2)

    // After A settled (failed), resubmitting A must be allowed (its key cleared).
    const a2 = store.createSchedule(draft({ prompt: "A" }))
    gateFor("A").resolve()
    assert.equal((await a2).id, "t-A")
    assert.equal(countOf(calls, "automation", "create"), 3)
  })

  it("A 成功后再次提交 A：允许重新创建（不再复用已 settle 的 Promise）", async () => {
    const { store, calls, gateFor } = gatedCreateStore()
    const a1 = store.createSchedule(draft({ prompt: "A" }))
    gateFor("A").resolve()
    await a1
    assert.equal(countOf(calls, "automation", "create"), 1)
    const a2 = store.createSchedule(draft({ prompt: "A" }))
    gateFor("A").resolve()
    const result = await a2
    assert.equal(result.id, "t-A")
    assert.equal(countOf(calls, "automation", "create"), 2, "成功后再提交应创建新任务")
  })

  it("同一草稿包含 tz/ends/if/until 时仍正确去重", async () => {
    const { store, calls, gateFor } = gatedCreateStore()
    const full = draft({
      when: { kind: "every", every: "5 minutes", tz: "Asia/Shanghai" },
      ends: { after: "2 hours" },
      if: { run: "test -f /tmp/flag" },
      until: { code: "return true" },
    })
    const p1 = store.createSchedule(full)
    const p2 = store.createSchedule({ ...full }) // 结构相同，键相同
    gateFor("do it").resolve()
    const [x, y] = await Promise.all([p1, p2])
    assert.equal(countOf(calls, "automation", "create"), 1)
    assert.equal(x, y)
  })
})

describe("批次7 / TASK-09：创建异常分类与回滚安全", () => {
  // SDK 2.2.5 error shapes: declared business errors are plain {_tag,message};
  // transport/undeclared statuses are Error instances with name="ClientError"
  // plus a `reason` and (for UnexpectedStatus) a numeric cause.status.
  // SDK 2.2.5 builds declared errors via Object.assign(new Error(msg), body)
  // and sets name=_tag — an Error instance that also carries `_tag`.
  const tagged = (tag, message = "x") => Object.assign(new Error(message), { _tag: tag, name: tag })
  const clientError = (reason, status) => {
    const e = new Error(`ClientError: ${reason}`)
    e.name = "ClientError"
    e.reason = reason
    if (status !== undefined) e.cause = { status }
    return e
  }
  const nativeError = (name) => {
    const e = new Error(name)
    e.name = name
    return e
  }

  it("HTTP 400 明确拒绝（InvalidRequestError）→ explicit-rejection", () => {
    const error = tagged("InvalidRequestError")
    assert.ok(error instanceof Error, "SDK declared 错误是 Error 实例")
    assert.equal(classifyCreateError(error), "explicit-rejection", "_tag 必须先于 instanceof Error 读取")
  })
  it("HTTP 401/403 权限拒绝 → explicit-rejection", () => {
    assert.equal(classifyCreateError(tagged("UnauthorizedError")), "explicit-rejection")
    assert.equal(classifyCreateError(tagged("ForbiddenError")), "explicit-rejection")
  })
  it("HTTP 408 请求超时 → timeout（未知）", () => {
    assert.equal(classifyCreateError(clientError("UnexpectedStatus", 408)), "timeout")
  })
  it("HTTP 429 限流 → unknown（未知）", () => {
    assert.equal(classifyCreateError(clientError("UnexpectedStatus", 429)), "unknown")
  })
  it("HTTP 500 → server-error", () => {
    assert.equal(classifyCreateError(tagged("UnknownError")), "server-error")
    assert.equal(classifyCreateError(clientError("UnexpectedStatus", 500)), "server-error")
  })
  it("HTTP 502/503 → server-error", () => {
    assert.equal(classifyCreateError(clientError("UnexpectedStatus", 502)), "server-error")
    assert.equal(classifyCreateError(tagged("ServiceUnavailableError")), "server-error")
    assert.equal(classifyCreateError(clientError("UnexpectedStatus", 503)), "server-error")
  })
  it("TimeoutError / AbortError → 未知类别", () => {
    assert.equal(classifyCreateError(nativeError("TimeoutError")), "timeout")
    assert.equal(classifyCreateError(nativeError("AbortError")), "abort")
  })
  it("网络连接中断（ClientError/Transport 与 fetch failed）→ network", () => {
    assert.equal(classifyCreateError(clientError("Transport")), "network")
    assert.equal(classifyCreateError(nativeError("TypeError")), "network")
  })
  it("响应解析失败（MalformedResponse/UnsupportedContentType/SyntaxError）→ parse-error", () => {
    assert.equal(classifyCreateError(clientError("MalformedResponse")), "parse-error")
    assert.equal(classifyCreateError(clientError("UnsupportedContentType")), "parse-error")
    assert.equal(classifyCreateError(nativeError("SyntaxError")), "parse-error")
  })
  it("SDK 错误结构不完整 / 无法识别 → unknown", () => {
    assert.equal(classifyCreateError(new Error("create failed")), "unknown", "普通 Error 不得靠消息猜状态")
    assert.equal(classifyCreateError({}), "unknown")
    assert.equal(classifyCreateError(null), "unknown")
    assert.equal(classifyCreateError("500 Internal Server Error"), "unknown", "不得从字符串猜 5xx")
  })

  /** Drive a create whose schedule.create throws `error`, with a given list result. */
  async function createWith(error, listImpl) {
    const { client, calls } = createClient({
      automation: {
        create: async () => {
          throw error
        },
        list: listImpl ?? (async () => []),
      },
    })
    const store = new ScheduleStore(client)
    let thrown
    try {
      await store.createSchedule(draft())
    } catch (e) {
      thrown = e
    }
    return { calls, thrown }
  }

  it("明确拒绝 + list 核对为空 → 允许回滚并抛原错误", async () => {
    const rejection = tagged("InvalidRequestError", "bad when")
    const { calls, thrown } = await createWith(rejection, async () => [])
    assert.equal(countOf(calls, "session", "remove"), 1, "明确拒绝且核对为空才回滚")
    assert.equal(thrown, rejection)
  })

  it("5xx + list 核对为空 → 绝不回滚，保留会话", async () => {
    for (const error of [clientError("UnexpectedStatus", 500), clientError("UnexpectedStatus", 503), tagged("UnknownError")]) {
      const { calls, thrown } = await createWith(error, async () => [])
      assert.equal(countOf(calls, "session", "remove"), 0, "5xx 不得触发危险回滚")
      assert.match(thrown.message, /无法确认/)
    }
  })

  it("超时/Abort/网络/解析失败 + 空列表 → 一律保留会话", async () => {
    for (const error of [
      nativeError("TimeoutError"),
      nativeError("AbortError"),
      clientError("Transport"),
      clientError("MalformedResponse"),
    ]) {
      const { calls } = await createWith(error, async () => [])
      assert.equal(countOf(calls, "session", "remove"), 0)
    }
  })

  it("schedule.list 核对命中 → 认领任务并保留会话（无论原始错误类别）", async () => {
    const { calls, store } = await (async () => {
      const c = createClient({
        automation: {
          create: async () => {
            throw clientError("UnexpectedStatus", 502)
          },
          list: async ({ sessionID }) => [makeSchedule({ id: "adopted", sessionID, prompt: "do it" })],
        },
      })
      const s = new ScheduleStore(c.client)
      const created = await s.createSchedule(draft())
      assert.equal(created.id, "adopted")
      return { calls: c.calls, store: s }
    })()
    assert.equal(countOf(calls, "automation", "list"), 1)
    assert.equal(countOf(calls, "session", "remove"), 0)
    assert.equal(store.cachedRows().length, 1)
  })

  it("明确拒绝但 list 核对失败 → 保留会话（无法确认是否创建）", async () => {
    const { calls, thrown } = await createWith(tagged("InvalidRequestError"), async () => {
      throw new Error("list down")
    })
    assert.equal(countOf(calls, "session", "remove"), 0)
    assert.match(thrown.message, /无法确认/)
  })
})

describe("批次8 / TASK-11~13：model 与 Agent 创建确认", () => {
  const model = { id: "m1", providerID: "p1" }
  const otherModel = { id: "other", providerID: "p1" }

  function storeWith(sessionOverrides = {}) {
    const { client, calls } = createClient({ session: sessionOverrides })
    return { store: new ScheduleStore(client), calls }
  }

  it("TASK-11：创建接口返回的 model 已匹配 → 直接成功，不调用 switchModel", async () => {
    const { store, calls } = storeWith({
      create: async () => makeSession({ id: "new-session", model }),
    })
    const created = await store.createSchedule(draft({ model }))
    assert.equal(created.id, "t-1")
    assert.equal(countOf(calls, "session", "switchModel"), 0)
    assert.equal(hasCall(calls, "session", "get"), false, "已匹配时无需回读")
    assert.equal(hasCall(calls, "session", "remove"), false)
  })

  it("TASK-12：创建接口返回的 Agent 已匹配 → 直接成功，不调用 switchAgent", async () => {
    const { store, calls } = storeWith({
      create: async () => makeSession({ id: "new-session", agent: "build" }),
    })
    const created = await store.createSchedule(draft({ agent: "build" }))
    assert.equal(created.id, "t-1")
    assert.equal(countOf(calls, "session", "switchAgent"), 0)
    assert.equal(hasCall(calls, "session", "get"), false)
    assert.equal(hasCall(calls, "session", "remove"), false)
  })

  it("TASK-11：model 不匹配 → switchModel 后回读匹配则创建成功", async () => {
    const { store, calls } = storeWith({
      create: async () => makeSession({ id: "new-session", model: otherModel }),
      get: async (params) => makeSession({ id: params.sessionID, model }),
    })
    const created = await store.createSchedule(draft({ model }))
    assert.equal(created.id, "t-1")
    assert.equal(countOf(calls, "session", "switchModel"), 1)
    assert.equal(hasCall(calls, "session", "remove"), false)
  })

  it("TASK-12：Agent 不匹配 → switchAgent 后回读匹配则创建成功", async () => {
    const { store, calls } = storeWith({
      create: async () => makeSession({ id: "new-session", agent: "other" }),
      get: async (params) => makeSession({ id: params.sessionID, agent: "build" }),
    })
    const created = await store.createSchedule(draft({ agent: "build" }))
    assert.equal(created.id, "t-1")
    assert.equal(countOf(calls, "session", "switchAgent"), 1)
    assert.equal(hasCall(calls, "session", "remove"), false)
  })

  it("TASK-11：model 切换请求失败 → 安全回滚，不创建任务", async () => {
    const { store, calls } = storeWith({
      create: async () => makeSession({ id: "new-session", model: otherModel }),
      switchModel: async () => {
        throw new Error("switchModel down")
      },
    })
    await assert.rejects(store.createSchedule(draft({ model })), /无法确认模型/)
    assert.equal(countOf(calls, "session", "remove"), 1)
    assert.equal(hasCall(calls, "automation", "create"), false)
  })

  it("TASK-12：Agent 切换请求失败 → 安全回滚，不创建任务", async () => {
    const { store, calls } = storeWith({
      create: async () => makeSession({ id: "new-session", agent: "other" }),
      switchAgent: async () => {
        throw new Error("switchAgent down")
      },
    })
    await assert.rejects(store.createSchedule(draft({ agent: "build" })), /无法确认 Agent/)
    assert.equal(countOf(calls, "session", "remove"), 1)
    assert.equal(hasCall(calls, "automation", "create"), false)
  })

  it("TASK-11：model 切换后回读仍不匹配 → 安全回滚", async () => {
    const { store, calls } = storeWith({
      create: async () => makeSession({ id: "new-session", model: otherModel }),
      get: async (params) => makeSession({ id: params.sessionID, model: { id: "stale", providerID: "p1" } }),
    })
    await assert.rejects(store.createSchedule(draft({ model })), /无法确认模型/)
    assert.equal(countOf(calls, "session", "remove"), 1)
    assert.equal(hasCall(calls, "automation", "create"), false)
  })

  it("TASK-12：Agent 切换后回读仍不匹配 → 安全回滚", async () => {
    const { store, calls } = storeWith({
      create: async () => makeSession({ id: "new-session", agent: "other" }),
      get: async (params) => makeSession({ id: params.sessionID, agent: "still-other" }),
    })
    await assert.rejects(store.createSchedule(draft({ agent: "build" })), /无法确认 Agent/)
    assert.equal(countOf(calls, "session", "remove"), 1)
    assert.equal(hasCall(calls, "automation", "create"), false)
  })

  it("未指定 model / Agent：不触发多余切换或回读", async () => {
    const { store, calls } = storeWith({
      create: async () => makeSession({ id: "new-session", model: otherModel, agent: "other" }),
    })
    const created = await store.createSchedule(draft())
    assert.equal(created.id, "t-1")
    assert.equal(hasCall(calls, "session", "switchModel"), false)
    assert.equal(hasCall(calls, "session", "switchAgent"), false)
    assert.equal(hasCall(calls, "session", "get"), false)
  })

  it("TASK-13：直接接受路径缓存保存服务端实际值而非 draft 对象", async () => {
    const requestedModel = { id: "m1", providerID: "p1" }
    const returnedModel = { id: "m1", providerID: "p1", name: "server" }
    const { store } = storeWith({
      create: async () => makeSession({ id: "new-session", model: returnedModel, agent: "build" }),
    })
    await store.createSchedule(draft({ model: requestedModel, agent: "build" }))
    const row = store.cachedRows()[0]
    assert.equal(row.session.model, returnedModel, "必须保存服务端对象本身")
    assert.notEqual(row.session.model, requestedModel, "不得写入 draft 对象")
    assert.equal(row.session.agent, "build")
  })

  it("TASK-13：切换路径缓存使用回读确认值，并保留其他元数据", async () => {
    const confirmedModel = { id: "m1", providerID: "p1", name: "verified" }
    const { store, calls } = storeWith({
      create: async (params) =>
        makeSession({ id: "new-session", model: otherModel, agent: "other", location: params.location }),
      get: async (params) => makeSession({ id: params.sessionID, model: confirmedModel, agent: "build" }),
    })
    await store.createSchedule(draft({ model, agent: "build", directory: "/work/proj" }))
    const row = store.cachedRows()[0]
    assert.equal(row.session.model, confirmedModel, "model 必须来自回读")
    assert.equal(row.session.agent, "build", "agent 必须来自回读")
    assert.equal(row.session.location?.directory, "/work/proj", "回读合并不得丢失目录元数据")
    assert.equal(countOf(calls, "session", "get"), 2, "model 与 agent 各自回读一次")
  })
})
