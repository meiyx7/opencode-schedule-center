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
    automation: { list: async () => Object.values(schedules).flat() },
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
  it("绑定已有会话：不新建会话，sessionID 与 to.session 都指向目标", async () => {
    let payload
    const { client, calls } = createClient({
      automation: {
        create: async (params) => {
          payload = params
          return makeSchedule({ id: "t-bound", sessionID: params.sessionID })
        },
      },
    })
    const store = new ScheduleStore(client)
    const created = await store.createSchedule(draft({ bindSessionID: "ses_existing" }))

    assert.equal(created.id, "t-bound")
    assert.equal(hasCall(calls, "session", "create"), false, "绑定模式绝不新建会话")
    assert.equal(hasCall(calls, "session", "switchModel"), false, "不得改动用户会话模型")
    assert.equal(hasCall(calls, "session", "switchAgent"), false, "不得改动用户会话 Agent")
    assert.equal(payload.sessionID, "ses_existing")
    assert.deepEqual(payload.action.to, { session: "ses_existing" })
    assert.equal(payload.action.prompt, "do it")
    assert.equal(store.cachedRows().length, 1)
  })

  it("新建承载会话写入归属标记，便于删除任务时识别", async () => {
    let sessionPayload
    const { client } = createClient({
      session: {
        create: async (params) => {
          sessionPayload = params
          return makeSession({ id: "new-session", title: params.title, metadata: params.metadata })
        },
      },
      automation: {
        create: async (params) => makeSchedule({ id: "t-mount", sessionID: params.sessionID }),
      },
    })
    await new ScheduleStore(client).createSchedule(draft({ name: "巡检" }))
    assert.equal(sessionPayload.title, "定时任务：巡检")
    assert.equal(sessionPayload.metadata["opencode-schedule-center.mount"], true)
  })

  it("绑定已有会话 + 草稿带 model/agent/directory：不落到 payload", async () => {
    let payload
    const { client } = createClient({
      automation: {
        create: async (params) => {
          payload = params
          return makeSchedule({ sessionID: params.sessionID })
        },
      },
    })
    const store = new ScheduleStore(client)
    // The form never sends these in bound mode, but the store must not let
    // them leak into the payload even if a caller supplies them.
    await store.createSchedule(
      draft({
        bindSessionID: "ses_existing",
        model: { id: "m1", providerID: "p1" },
        agent: "build",
        directory: "/some/path",
      }),
    )
    assert.equal(payload.model, undefined)
    assert.equal(payload.agent, undefined)
    assert.equal(payload.directory, undefined)
  })

  it("绑定已有会话失败：创建前已存在的任务绝不被认领", async () => {
    const rejection = Object.assign(new Error("bound create rejected"), {
      _tag: "InvalidRequestError",
      name: "InvalidRequestError",
    })
    const preexisting = makeSchedule({
      id: "t-old",
      sessionID: "ses_existing",
      action: { type: "prompt", prompt: "旧任务", to: { session: "ses_existing" } },
    })
    const { client, calls } = createClient({
      automation: {
        create: async () => {
          throw rejection
        },
        list: async () => [preexisting],
      },
    })
    const store = new ScheduleStore(client)
    await assert.rejects(
      store.createSchedule(draft({ bindSessionID: "ses_existing" })),
      (error) => error === rejection,
      "创建前已有的任务不能被当作本次创建结果",
    )

    assert.equal(hasCall(calls, "session", "remove"), false, "绑定模式永不删除用户会话")
    assert.equal(store.cachedRows().length, 0, "失败后不得把旧任务写进缓存")
  })

  it("绑定已有会话失败：只认领创建后新增且提示词匹配的任务", async () => {
    let listCalls = 0
    const timeout = new Error("timeout")
    timeout.name = "TimeoutError"
    const { client } = createClient({
      automation: {
        create: async () => {
          throw timeout
        },
        list: async ({ sessionID }) => {
          listCalls += 1
          const old = makeSchedule({
            id: "t-old",
            sessionID,
            action: { type: "prompt", prompt: "旧任务", to: { session: sessionID } },
          })
          if (listCalls === 1) return [old]
          return [old, makeSchedule({ id: "t-new", sessionID, prompt: "do it" })]
        },
      },
    })
    const store = new ScheduleStore(client)
    const created = await store.createSchedule(draft({ bindSessionID: "ses_existing" }))

    assert.equal(created.id, "t-new")
    assert.equal(created.action.prompt, "do it")
    assert.equal(store.cachedRows().length, 1)
  })

  it("绑定已有会话失败：新增任务提示词不匹配也不认领", async () => {
    const rejection = Object.assign(new Error("bound create rejected"), {
      _tag: "InvalidRequestError",
      name: "InvalidRequestError",
    })
    let listCalls = 0
    const { client } = createClient({
      automation: {
        create: async () => {
          throw rejection
        },
        list: async ({ sessionID }) => {
          listCalls += 1
          return listCalls === 1
            ? []
            : [
                makeSchedule({
                  id: "t-other",
                  sessionID,
                  action: { type: "prompt", prompt: "完全不同的任务", to: { session: sessionID } },
                }),
              ]
        },
      },
    })
    const store = new ScheduleStore(client)
    await assert.rejects(
      store.createSchedule(draft({ bindSessionID: "ses_existing" })),
      (error) => error === rejection,
    )
    assert.equal(store.cachedRows().length, 0)
  })

  it("绑定已有会话失败且无法取得创建前基线：不认领，提示刷新确认", async () => {
    const timeout = new Error("timeout")
    timeout.name = "TimeoutError"
    const { client, calls } = createClient({
      automation: {
        create: async () => {
          throw timeout
        },
        list: async () => {
          throw new Error("list unavailable")
        },
      },
    })
    const store = new ScheduleStore(client)
    await assert.rejects(
      store.createSchedule(draft({ bindSessionID: "ses_existing" })),
      (error) => error.message.includes("无法确认") && error.message.includes("刷新任务列表"),
    )
    assert.equal(hasCall(calls, "session", "remove"), false)
  })

  it("绑定已有会话被明确拒绝且基线读取失败：直接抛原错误，不误报无法确认", async () => {
    const rejection = Object.assign(new Error("invalid cron"), {
      _tag: "InvalidRequestError",
      name: "InvalidRequestError",
    })
    const { client } = createClient({
      automation: {
        create: async () => {
          throw rejection
        },
        list: async () => {
          throw new Error("list unavailable")
        },
      },
    })
    const store = new ScheduleStore(client)
    await assert.rejects(
      store.createSchedule(draft({ bindSessionID: "ses_existing" })),
      (error) => error === rejection,
      "明确业务拒绝已证明没有写入，无需基线核对",
    )
    assert.equal(store.cachedRows().length, 0)
  })

  it("绑定已有会话失败且核对为空：抛原错误，仍不删除用户会话", async () => {
    const rejection = Object.assign(new Error("bound create rejected"), {
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
    })
    const store = new ScheduleStore(client)
    await assert.rejects(store.createSchedule(draft({ bindSessionID: "ses_existing" })), (error) => error === rejection)
    assert.equal(hasCall(calls, "session", "remove"), false)
  })

  it("绑定不同会话的同草稿不在一起单飞", async () => {
    const { client, calls } = createClient({
      automation: {
        create: async (params) => makeSchedule({ id: `t-${params.sessionID}`, sessionID: params.sessionID }),
      },
    })
    const store = new ScheduleStore(client)
    const [a, b] = await Promise.all([
      store.createSchedule(draft({ bindSessionID: "ses_a" })),
      store.createSchedule(draft({ bindSessionID: "ses_b" })),
    ])
    assert.equal(countOf(calls, "automation", "create"), 2)
    assert.equal(a.id, "t-ses_a")
    assert.equal(b.id, "t-ses_b")
  })

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
        list: async () => [
          makeSchedule({ id: "t-s1", sessionID: "s1" }),
          makeSchedule({ id: "t-s2", sessionID: "s2" }),
          makeSchedule({ id: "t-s3", sessionID: "s3" }),
        ],
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

  it("会话元数据分页达上限：全局任务仍完整展示，只标记元数据不完整", async () => {
    let truncatedMode = false
    const { client } = createClient({
      session: {
        list: async ({ cursor }) => {
          if (!truncatedMode) return { data: [makeSession({ id: "s3" })], cursor: {} }
          return { data: [makeSession({ id: "s1" })], cursor: { next: `cursor-${cursor ?? 1}` } }
        },
      },
      automation: {
        list: async () => [
          makeSchedule({ id: "t-s1", sessionID: "s1" }),
          makeSchedule({ id: "t-s3", sessionID: "s3" }),
        ],
      },
    })
    const store = new ScheduleStore(client)
    const first = await store.listAll()
    assert.equal(first.rows.length, 2)

    truncatedMode = true
    const second = await store.listAll()
    assert.equal(second.truncated, true, "会话分页上限仍被标记")
    // 全局列表不依赖 session 扫描：即使 s3 的会话元数据未扫到，任务仍在。
    assert.deepEqual(second.rows.map((row) => row.schedule.id).sort(), ["t-s1", "t-s3"])
    const s3 = second.rows.find((row) => row.schedule.id === "t-s3")
    assert.equal(s3.session, undefined, "未扫到的会话不得虚构元数据")
    assert.equal(s3.sessionTitle, "do it", "缺元数据时用任务名兜底，不用空 sessionID")
  })

  it("会话元数据某页失败：记录 failure，任务仍完整展示且不抛错", async () => {
    let listCount = 0
    const { client } = createClient({
      session: {
        list: async () => {
          listCount += 1
          if (listCount === 1) return { data: [makeSession({ id: "s1" })], cursor: { next: "cursor-2" } }
          throw new Error("page failed")
        },
      },
      automation: {
        list: async () => [
          makeSchedule({ id: "t-s1", sessionID: "s1" }),
          makeSchedule({ id: "t-s3", sessionID: "s3" }),
        ],
      },
    })
    const store = new ScheduleStore(client)
    const result = await store.listAll()
    // Session metadata failure is non-fatal: tasks come from the global list.
    assert.equal(result.rows.length, 2, "会话元数据失败不得漏掉全局任务")
    assert.equal(result.failures.length, 1)
    assert.match(result.failures[0].reason, /page failed/)
  })

  it("全局 automation.list 失败：抛出错误且不清空上次有效数据", async () => {
    let fail = false
    const { client } = createClient({
      automation: {
        list: async () => {
          if (fail) throw new Error("global list down")
          return [makeSchedule({ id: "t-s1", sessionID: "s1" })]
        },
      },
    })
    const store = new ScheduleStore(client)
    assert.equal((await store.listAll()).rows.length, 1)
    fail = true
    await assert.rejects(store.listAll(), /global list down/)
    assert.equal(store.cachedRows().length, 1, "列表读取失败不得清空上次有效数据")
  })

  it("扫描期间的暂停操作不会被较旧的扫描结果覆盖", async () => {
    const gate = deferred()
    let listCount = 0
    const { client } = createClient({
      session: { list: async () => ({ data: [makeSession({ id: "s1" })], cursor: {} }) },
      automation: {
        list: async () => {
          listCount += 1
          if (listCount === 1) return [makeSchedule({ id: "t1", sessionID: "s1", status: "active" })]
          // Second (global) list blocks; a local pause lands while it is in flight.
          await gate.promise
          return [makeSchedule({ id: "t1", sessionID: "s1", status: "active" })]
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
        list: async () => [
          makeSchedule({ id: "t-s1", sessionID: "s1" }),
          makeSchedule({ id: "t-s2", sessionID: "s2" }),
          makeSchedule({ id: "t-s3", sessionID: "s3" }),
        ],
      },
    })
    const sweep = await new ScheduleStore(client).listAll()
    assert.equal(sweep.rows.length, 3)
    assert.equal(sweep.truncated, false, "接口无快照语义，此处只报告可检测的不完整状态")
  })
})

describe("部分失败处理 / TASK-05（全局列表 + 会话元数据容错）", () => {
  it("会话元数据失败：全局任务仍全部展示，失败被记录为 page 标记", async () => {
    let page = 0
    const { client, calls } = createClient({
      session: {
        list: async () => {
          page += 1
          if (page === 1) return { data: [makeSession({ id: "s1" })], cursor: { next: "c2" } }
          throw new Error("metadata page failed")
        },
      },
      automation: {
        list: async () => [
          makeSchedule({ id: "t-s1", sessionID: "s1" }),
          makeSchedule({ id: "t-s2", sessionID: "s2" }),
        ],
      },
    })
    const result = await new ScheduleStore(client).listAll()
    // The core B2.1 guarantee: a session-query failure never drops a global task.
    assert.equal(result.rows.length, 2)
    assert.deepEqual(result.rows.map((row) => row.schedule.id).sort(), ["t-s1", "t-s2"])
    assert.equal(result.failures.length, 1)
    assert.equal(result.failures[0].sessionID, "page:2")
    assert.match(result.failures[0].reason, /metadata page failed/)
    assert.equal(hasCall(calls, "automation", "delete"), false)
  })

  it("全部会话元数据失败：任务仍展示，failures 明确，不误报为空", async () => {
    const { client } = createClient({
      session: { list: async () => { throw new Error("all sessions down") } },
      automation: {
        list: async () => [makeSchedule({ id: "t-orphan", sessionID: "gone" })],
      },
    })
    const result = await new ScheduleStore(client).listAll()
    assert.equal(result.rows.length, 1, "会话全失败也不得丢失全局任务")
    assert.equal(result.rows[0].schedule.id, "t-orphan")
    assert.equal(result.failures.length, 1)
    assert.match(result.failures[0].reason, /all sessions down/)
  })

  it("无创建者 sessionID 的任务：正常展示且不虚构会话", async () => {
    const { client } = createClient({
      automation: {
        list: async () => [makeSchedule({ id: "t-no-owner", sessionID: undefined, name: "无主任务" })],
      },
    })
    const result = await new ScheduleStore(client).listAll()
    assert.equal(result.rows.length, 1)
    const row = result.rows[0]
    assert.equal(row.schedule.sessionID, undefined)
    assert.equal(row.session, undefined, "不得为无 sessionID 的任务虚构会话")
    assert.equal(row.sessionTitle, "无主任务", "用任务名兜底标题")
  })

  it("会话元数据失败后恢复：failures 清零且元数据补齐", async () => {
    let fail = true
    const { client } = createClient({
      session: {
        list: async () => {
          if (fail) throw new Error("temporary failure")
          return { data: [makeSession({ id: "s1", title: "定时任务：巡检" })], cursor: {} }
        },
      },
      automation: { list: async () => [makeSchedule({ id: "t-s1", sessionID: "s1" })] },
    })
    const store = new ScheduleStore(client)
    const partial = await store.listAll()
    assert.equal(partial.failures.length, 1)
    assert.equal(partial.rows[0].session, undefined)

    fail = false
    const complete = await store.listAll()
    assert.equal(complete.failures.length, 0)
    assert.equal(complete.rows.length, 1)
    assert.equal(complete.rows[0].session?.title, "定时任务：巡检", "恢复后元数据补齐")
    assert.equal(complete.truncated, false)
  })

  it("全局 automation.list 失败：抛错且保留上次有效数据", async () => {
    let fail = false
    const { client, calls } = createClient({
      automation: {
        list: async () => {
          if (fail) throw new Error("list down")
          return [makeSchedule({ id: "t-s1", sessionID: "s1" })]
        },
      },
    })
    const store = new ScheduleStore(client)
    assert.equal((await store.listAll()).rows.length, 1)
    fail = true
    await assert.rejects(store.listAll(), /list down/)
    assert.equal(store.cachedRows().length, 1, "失败不得清空上次有效数据")
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

  it("创建请求严格符合 ExperimentalAutomationCreateInput：无 if/until/times/ends 旧字段", async () => {
    const { client, params } = createCall()
    await new ScheduleStore(client).createSchedule(draft())
    const payload = params()
    // Only official create keys are allowed; legacy condition/cap keys must be absent.
    const allowed = new Set(["sessionID", "directory", "name", "trigger", "action", "expires"])
    for (const key of Object.keys(payload)) {
      assert.ok(allowed.has(key), `创建请求出现非官方字段：${key}`)
    }
    for (const legacy of ["if", "until", "times", "ends"]) {
      assert.equal(legacy in payload, false, `创建请求不应含旧字段 ${legacy}`)
    }
    assert.equal(payload.action.type, "prompt")
  })

  it("ends.after 折算为官方 expires（in <duration>）", async () => {
    const { client, params } = createCall()
    await new ScheduleStore(client).createSchedule(draft({ ends: { after: "2 hours" } }))
    assert.equal(params().expires, "in 2 hours")
    assert.equal("ends" in params(), false)
  })

  it("ends.at 折算为官方 expires（绝对时间）", async () => {
    const { client, params } = createCall()
    await new ScheduleStore(client).createSchedule(draft({ ends: { at: "2026-12-01T09:00:00+08:00" } }))
    assert.equal(params().expires, "2026-12-01T09:00:00+08:00")
    assert.equal("ends" in params(), false)
  })

  it("不设置结束条件时不传 expires，也不传任何旧字段", async () => {
    const { client, params } = createCall()
    await new ScheduleStore(client).createSchedule(draft())
    assert.equal("expires" in params(), false)
    assert.equal("ends" in params(), false)
  })

  it("不同的有效 ends 折算仍算不同草稿（去重键基于有效字段）", async () => {
    const { client, calls } = createCall()
    const store = new ScheduleStore(client)
    const a = store.createSchedule(draft({ ends: { after: "5 minutes" } }))
    const b = store.createSchedule(draft({ ends: { after: "10 minutes" } }))
    await Promise.all([a, b])
    assert.equal(countOf(calls, "automation", "create"), 2)
  })

  it("same full draft (incl. tz/ends) still coalesces to one create", async () => {
    const { client, calls } = createCall()
    const store = new ScheduleStore(client)
    const full = draft({
      when: { kind: "every", every: "5 minutes", tz: "Asia/Shanghai" },
      ends: { after: "2 hours" },
    })
    await Promise.all([store.createSchedule(full), store.createSchedule(full)])
    assert.equal(countOf(calls, "automation", "create"), 1)
  })
})

describe("B2.1：Code Action 全链路保留，不降级为 Prompt", () => {
  it("全局列表读取 code action：code 与 args 原样保留，未被当作 prompt", async () => {
    const codeAction = { type: "code", code: "return hour() === 9", args: { retries: 3 } }
    const { client } = createClient({
      automation: { list: async () => [makeSchedule({ id: "t-code", action: codeAction })] },
    })
    const result = await new ScheduleStore(client).listAll()
    const row = result.rows[0]
    assert.equal(row.schedule.action.type, "code")
    assert.deepEqual(row.schedule.action, codeAction, "code/args 必须逐字段原样保留")
    assert.equal("prompt" in row.schedule.action, false, "code action 不得被注入 prompt 字段")
  })

  it("pause / resume 返回的 code action 不改变类型", async () => {
    const codeAction = { type: "code", code: "runCleanup()", args: ["a", "b"] }
    const { client } = createClient({
      automation: {
        list: async () => [makeSchedule({ id: "t-code", action: codeAction, status: "active" })],
        pause: async () => makeSchedule({ id: "t-code", action: codeAction, status: "paused" }),
        resume: async () => makeSchedule({ id: "t-code", action: codeAction, status: "active" }),
      },
    })
    const store = new ScheduleStore(client)
    await store.listAll()
    const afterPause = await store.pause("t-code")
    assert.equal(afterPause[0].schedule.action.type, "code")
    assert.deepEqual(afterPause[0].schedule.action.args, ["a", "b"])
    const afterResume = await store.resume("t-code")
    assert.equal(afterResume[0].schedule.action.type, "code")
    assert.equal(afterResume[0].schedule.action.code, "runCleanup()")
  })

  it("reconcile 用官方 get 刷新 code action：类型与字段不变", async () => {
    const codeAction = { type: "code", code: "freshCode()", args: { v: 2 } }
    const { client } = createClient({
      automation: {
        list: async () => [makeSchedule({ id: "t-code", action: { type: "code", code: "old()" } })],
        get: async () => makeSchedule({ id: "t-code", action: codeAction }),
      },
    })
    const store = new ScheduleStore(client)
    await store.listAll()
    const rows = await store.reconcile("t-code")
    assert.deepEqual(rows[0].schedule.action, codeAction)
  })

  it("创建结果返回 code action 时原样采纳，不改写类型", async () => {
    const codeAction = { type: "code", code: "created()", args: { k: 1 } }
    const { client } = createClient({
      automation: {
        create: async () => makeSchedule({ id: "t-new", action: codeAction }),
      },
    })
    const store = new ScheduleStore(client)
    const created = await store.createSchedule(draft())
    assert.deepEqual(created.action, codeAction, "创建结果里的 code action 不得被降级")
    assert.equal(store.cachedRows()[0].schedule.action.type, "code")
  })
})

describe("B2.2：官方字段完整保留，旧条件不再出现", () => {
  it("官方 Automation 的 runCount/state/lastOutput/projectID/directory/time 原样保留", async () => {
    const official = makeSchedule({
      id: "t-official",
      runCount: 7,
      state: { retries: 2, note: "third-party state" },
      lastOutput: "done: ok",
      lastOutcome: "fired",
      lastRunAt: 1_700_000_000_000,
      expires: 1_800_000_000_000,
      projectID: "prj-x",
      directory: "/repo/x",
      time: { created: 100, updated: 200 },
    })
    const { client } = createClient({ automation: { list: async () => [official] } })
    const result = await new ScheduleStore(client).listAll()
    const row = result.rows[0]
    // Display aliases exist AND every official field survives the projection.
    assert.equal(row.schedule.endsAt, official.expires)
    assert.equal(row.schedule.lastFiredAt, official.lastRunAt)
    assert.equal(row.schedule.runCount, 7)
    assert.deepEqual(row.schedule.state, official.state)
    assert.equal(row.schedule.lastOutput, "done: ok")
    assert.equal(row.schedule.lastOutcome, "fired")
    assert.equal(row.schedule.projectID, "prj-x")
    assert.equal(row.schedule.directory, "/repo/x")
    assert.deepEqual(row.schedule.time, { created: 100, updated: 200 })
    // No legacy condition/cap field leaks into the display projection.
    for (const legacy of ["if", "until", "remainingRuns"]) {
      assert.equal(legacy in row.schedule, false, `展示数据不应含旧字段 ${legacy}`)
    }
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
        // Global list returns all tasks in one call; the sweep gate now lives
        // in session metadata pagination (below), still after seqAtStart.
        list: async () => [
          makeSchedule({ id: "t-s1", sessionID: "s1", status: "active" }),
          makeSchedule({ id: "t-s2", sessionID: "s2", status: "active" }),
        ],
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

  it("同一完整草稿（tz/ends/directory）仍正确去重", async () => {
    const { store, calls, gateFor } = gatedCreateStore()
    const full = draft({
      when: { kind: "every", every: "5 minutes", tz: "Asia/Shanghai" },
      ends: { after: "2 hours" },
      directory: "/work/project",
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

describe("0.2.2：绑定会话搜索分页", () => {
  it("把 search 与 cursor 原样传给官方 session.list", async () => {
    const seen = []
    const { client } = createClient({
      session: {
        list: async (input) => {
          seen.push(input)
          return { data: [makeSession({ id: "s2" })], cursor: { next: "c2" } }
        },
      },
    })
    const page = await new ScheduleStore(client).sessionsPage({ search: "  巡检  ", cursor: "c1", limit: 25 })
    assert.deepEqual(seen, [{ limit: 25, search: "巡检", cursor: "c1" }])
    assert.equal(page.sessions[0].id, "s2")
    assert.equal(page.next, "c2")
  })

  it("空搜索词不发送 search，无 next 游标时 next 为 undefined", async () => {
    let input
    const { client } = createClient({
      session: {
        list: async (params) => {
          input = params
          return { data: [], cursor: {} }
        },
      },
    })
    const page = await new ScheduleStore(client).sessionsPage({ search: "   " })
    assert.equal(input.search, undefined)
    assert.equal(input.limit, 50)
    assert.equal(page.next, undefined)
  })
})

describe("0.2.2：删除任务时可选清理承载会话", () => {
  const MOUNT = "opencode-schedule-center.mount"

  async function primed({ sessions, schedules }) {
    return seededStore({ sessions, schedules })
  }

  it("带元数据标记的承载会话可随任务删除", async () => {
    const sessions = [makeSession({ id: "m1", title: "定时任务：巡检", metadata: { [MOUNT]: true } })]
    const { store, calls } = await primed({
      sessions,
      schedules: { m1: [makeSchedule({ id: "t1", sessionID: "m1" })] },
    })
    const result = await store.remove("t1", "m1", { deleteSession: true })
    assert.deepEqual(result, { sessionDeleted: true })
    assert.equal(countOf(calls, "session", "remove"), 1)
    assert.equal(store.cachedRows().length, 0)
  })

  it("旧版无标记但标题为插件承载会话时允许清理", async () => {
    const sessions = [makeSession({ id: "m1", title: "定时任务：巡检" })]
    const { store, calls } = await primed({
      sessions,
      schedules: { m1: [makeSchedule({ id: "t1", sessionID: "m1" })] },
    })
    const result = await store.remove("t1", "m1", { deleteSession: true })
    assert.equal(result.sessionDeleted, true)
    assert.equal(countOf(calls, "session", "remove"), 1)
  })

  it("普通用户会话即使勾选也不删除", async () => {
    const sessions = [makeSession({ id: "u1", title: "我的聊天" })]
    const { store, calls } = await primed({
      sessions,
      schedules: { u1: [makeSchedule({ id: "t1", sessionID: "u1" })] },
    })
    const result = await store.remove("t1", "u1", { deleteSession: true })
    assert.equal(result.sessionDeleted, false)
    assert.equal(result.sessionDeleteSkipped, "not-mount")
    assert.equal(hasCall(calls, "session", "remove"), false)
  })

  it("仍被其他任务引用的会话不删除", async () => {
    const sessions = [makeSession({ id: "m1", title: "定时任务：共享", metadata: { [MOUNT]: true } })]
    const { store, calls } = await primed({
      sessions,
      schedules: {
        m1: [
          makeSchedule({ id: "t1", sessionID: "m1" }),
          makeSchedule({ id: "t2", sessionID: "m1", prompt: "另一条" }),
        ],
      },
    })
    const result = await store.remove("t1", "m1", { deleteSession: true })
    assert.equal(result.sessionDeleted, false)
    assert.equal(result.sessionDeleteSkipped, "referenced")
    assert.equal(hasCall(calls, "session", "remove"), false)
    assert.equal(store.cachedRows().length, 1)
  })

  it("会话删除失败：任务已删除，返回明确错误且不回滚任务", async () => {
    const sessions = [makeSession({ id: "m1", title: "定时任务：巡检", metadata: { [MOUNT]: true } })]
    const { client, calls } = createClient({
      session: {
        list: async () => ({ data: sessions, cursor: {} }),
        remove: async () => {
          throw new Error("session remove failed")
        },
      },
      automation: {
        list: async () => [makeSchedule({ id: "t1", sessionID: "m1" })],
      },
    })
    const store = new ScheduleStore(client)
    await store.listAll()
    const result = await store.remove("t1", "m1", { deleteSession: true })
    assert.equal(result.sessionDeleted, false)
    assert.match(result.sessionDeleteError, /session remove failed/)
    assert.equal(hasCall(calls, "automation", "delete"), true)
    assert.equal(store.cachedRows().length, 0, "任务删除成功，不因会话清理失败而回滚")
  })

  it("删除后无法核对引用：保留会话并说明未验证", async () => {
    const sessions = [makeSession({ id: "m1", title: "定时任务：巡检", metadata: { [MOUNT]: true } })]
    let listCalls = 0
    const { client, calls } = createClient({
      session: { list: async () => ({ data: sessions, cursor: {} }) },
      automation: {
        list: async () => {
          listCalls += 1
          if (listCalls === 1) return [makeSchedule({ id: "t1", sessionID: "m1" })]
          throw new Error("reference check unavailable")
        },
      },
    })
    const store = new ScheduleStore(client)
    await store.listAll()
    const result = await store.remove("t1", "m1", { deleteSession: true })
    assert.equal(result.sessionDeleted, false)
    assert.equal(result.sessionDeleteSkipped, "unverified")
    assert.equal(hasCall(calls, "session", "remove"), false)
  })

  it("未勾选清理时即使承载会话也不删除", async () => {
    const sessions = [makeSession({ id: "m1", title: "定时任务：巡检", metadata: { [MOUNT]: true } })]
    const { store, calls } = await primed({
      sessions,
      schedules: { m1: [makeSchedule({ id: "t1", sessionID: "m1" })] },
    })
    const result = await store.remove("t1", "m1")
    assert.deepEqual(result, { sessionDeleted: false })
    assert.equal(hasCall(calls, "session", "remove"), false)
  })
})
