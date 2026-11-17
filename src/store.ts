import type { ModelInfo, OpenCodeClient, ProviderInfo } from "@opencode/client/promise"
import type { CreateDraft, ModelChoice, ModelProviderGroup, ScheduleInfo, ScheduleRow, SessionInfo, WhenDraft } from "./types"

/** A session whose schedule list could not be read in this sweep. */
export interface SessionFailure {
  sessionID: string
  reason: string
}

/** Result of a full sweep: rows plus explicit markers for each incomplete dimension. */
export interface ListResult {
  rows: ScheduleRow[]
  /** Failed sessions keep their previous rows (if any); a failed query is never "no tasks". */
  failures: SessionFailure[]
  /** Session pagination reached the safety cap while a next cursor still existed. */
  truncated: boolean
}

const SESSION_PAGE_SIZE = 200
const MAX_SESSION_PAGES = 100
const SCHEDULE_CHUNK_SIZE = 20

/**
 * The schedule API filters every list call by sessionID, so the panel sweeps
 * the session list and merges per-session results. Sessions are paginated by
 * an opaque cursor; the API gives no snapshot guarantee, so a concurrent
 * add/remove may be missed and is never reported as strongly consistent.
 */
export class ScheduleStore {
  private sessions = new Map<string, SessionInfo>()
  /** Per-session schedule lists from the last *successful* sweep, keyed by sessionID. */
  private scheduleCache = new Map<string, ScheduleInfo[]>()
  /** Cached model catalog; one fetch per dialog lifetime is enough. */
  private catalog: ModelProviderGroup[] | undefined
  /** Each draft key keeps its own in-flight create, so A/B/A stays distinct. */
  private inflightCreates = new Map<string, Promise<ScheduleInfo>>()
  /** Bumped by local cache writes so a sweep never overwrites newer local data. */
  private mutationSeq = 0

  constructor(private readonly client: OpenCodeClient) {}

  /** The OpenCode client; exposed for widgets that call schedule endpoints directly. */
  get api(): OpenCodeClient {
    return this.client
  }

  /**
   * Follow the official cursor to exhaustion. The 100-page ceiling is a safety
   * net, not a truncation to hide: if a next cursor remains at the ceiling the
   * caller is told the sweep is incomplete.
   */
  private async fetchAllSessions(): Promise<{ sessions: Map<string, SessionInfo>; truncated: boolean }> {
    const sessions = new Map<string, SessionInfo>()
    let cursor: string | undefined
    let truncated = false
    for (let page = 0; page < MAX_SESSION_PAGES; page += 1) {
      const response = await this.client.session.list({
        limit: SESSION_PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      })
      for (const session of response.data ?? []) sessions.set(session.id, session)
      const next = response.cursor?.next
      if (!next) break
      cursor = next
      if (page === MAX_SESSION_PAGES - 1) truncated = true
    }
    return { sessions, truncated }
  }

  async refreshSessions(): Promise<void> {
    const { sessions } = await this.fetchAllSessions()
    this.sessions = sessions
  }

  /** Fetch schedules for every known session and return active-first rows. */
  async listAll(): Promise<ListResult> {
    // Baseline BEFORE the first await: a create landing anywhere during
    // session pagination (not just schedule fetching) must be detectable.
    const seqAtStart = this.mutationSeq
    const { sessions, truncated } = await this.fetchAllSessions()
    const ids = [...sessions.keys()]

    // Build into locals and commit once at the end: a failed sweep keeps the
    // last good cache, and the page keeps showing the previous rows.
    const nextCache = new Map<string, ScheduleInfo[]>()
    for (const id of ids) {
      const previous = this.scheduleCache.get(id)
      if (previous) nextCache.set(id, previous)
    }
    // Truncated pages were never read: keep their last known rows rather than
    // silently dropping tasks the user could still see.
    if (truncated) {
      for (const [id, previous] of this.scheduleCache) {
        if (!nextCache.has(id)) nextCache.set(id, previous)
      }
    }
    const failures: SessionFailure[] = []

    for (let start = 0; start < ids.length; start += SCHEDULE_CHUNK_SIZE) {
      const chunk = ids.slice(start, start + SCHEDULE_CHUNK_SIZE)
      const results = await Promise.allSettled(
        chunk.map((sessionID) => this.client.experimental.schedule.list({ sessionID })),
      )
      for (let index = 0; index < results.length; index += 1) {
        const result = results[index]
        const sessionID = chunk[index]
        if (result.status === "rejected") {
          failures.push({ sessionID, reason: describeError(result.reason) })
          continue // previous entry, if any, stays in nextCache
        }
        nextCache.set(sessionID, result.value)
      }
    }

    if (this.mutationSeq === seqAtStart) {
      // Clean sweep: the snapshot is newer than nothing, adopt it in full —
      // including session metadata (title / model / agent / directory).
      this.sessions = sessions
      this.scheduleCache = nextCache
    } else {
      // A create/pause/resume/delete landed mid-sweep. Those local writes are
      // newer than this snapshot. Never let stale scan data roll them back:
      //   - schedules: update only entries the live cache has NOT seen;
      //   - sessions: never drop a live session (a just-created mount session
      //     carries its model/agent/directory), only add ones we lack.
      for (const [id, schedules] of nextCache) {
        if (!this.scheduleCache.has(id)) this.scheduleCache.set(id, schedules)
      }
      for (const [id, session] of sessions) {
        if (!this.sessions.has(id)) this.sessions.set(id, session)
      }
    }
    // Always rebuild from the live sessions map so a newly created mount
    // session keeps its metadata instead of falling back to a stale snapshot.
    return { rows: this.rowsFrom(this.sessions, this.scheduleCache), failures, truncated }
  }

  private rowsFrom(sessions: Map<string, SessionInfo>, cache: Map<string, ScheduleInfo[]>): ScheduleRow[] {
    const rows: ScheduleRow[] = []
    for (const [sessionID, schedules] of cache) {
      const session = sessions.get(sessionID)
      for (const schedule of schedules) {
        rows.push({ schedule, sessionTitle: session?.title ?? sessionID, session })
      }
    }
    return sortRows(rows)
  }

  /**
   * Patched view of the rows without a network sweep: apply `mutate` to the
   * cached schedule, then rebuild rows from the cache. Cheap and immediate;
   * the next explicit refresh still reconciles with the server.
   */
  private patchLocal(scheduleID: string, mutate: (schedule: ScheduleInfo) => void): ScheduleRow[] {
    for (const [sessionID, schedules] of this.scheduleCache) {
      const index = schedules.findIndex((schedule) => schedule.id === scheduleID)
      if (index < 0) continue
      const next = [...schedules]
      next[index] = { ...schedules[index], sessionID: schedules[index].sessionID ?? sessionID }
      mutate(next[index])
      this.scheduleCache.set(sessionID, next)
      this.mutationSeq += 1
      break
    }
    return this.cachedRows()
  }

  /** Rebuild rows from the per-session cache (no network). */
  private rowsFromCache(): ScheduleRow[] {
    return this.rowsFrom(this.sessions, this.scheduleCache)
  }

  /** Public read of the cache, for views that patch instead of re-fetching. */
  cachedRows(): ScheduleRow[] {
    return this.rowsFromCache()
  }

  /**
   * Chat models grouped by provider, so the form can offer provider → model
   * cascading with search. Beta models stay selectable; deprecated ones do not.
   * Cached after the first fetch; the catalog rarely changes mid-dialog.
   */
  async modelCatalog(): Promise<ModelProviderGroup[]> {
    if (this.catalog) return this.catalog
    const [modelResponse, providerResponse] = await Promise.allSettled([
      this.client.model.list({ types: ["chat"] }),
      this.client.provider.list(),
    ])
    if (modelResponse.status === "rejected") throw modelResponse.reason

    const providerNames = new Map<string, string>()
    if (providerResponse.status === "fulfilled") {
      const list = (providerResponse.value.data ?? providerResponse.value) as ProviderInfo[]
      for (const provider of list) providerNames.set(provider.id, provider.name || provider.id)
    }

    const models = (modelResponse.value.data ?? modelResponse.value) as ModelInfo[]
    const groups = new Map<string, ModelProviderGroup>()
    for (const model of models) {
      if (model.enabled === false || model.status === "deprecated") continue
      let group = groups.get(model.providerID)
      if (!group) {
        group = {
          id: model.providerID,
          name: providerNames.get(model.providerID) || model.providerID,
          models: [],
        }
        groups.set(model.providerID, group)
      }
      group.models.push(toModelChoice(model))
    }

    const result = [...groups.values()]
    for (const group of result) {
      group.models.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    }
    result.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    this.catalog = result
    return result
  }

  /** Create a dedicated mount session so the schedule has a home to wake. */
  async createSchedule(draft: CreateDraft): Promise<ScheduleInfo> {
    // Double submit: later calls with the SAME draft share one in-flight
    // promise; different drafts run independently (A/B/A, A-fails-B-succeeds).
    const key = draftKey(draft)
    const existing = this.inflightCreates.get(key)
    if (existing) return existing
    const task = this.createOnce(draft)
    this.inflightCreates.set(key, task)
    try {
      return await task
    } finally {
      // Clear only this draft's entry, and only if it is still ours — a newer
      // submission of the same key must not be evicted by an older one.
      if (this.inflightCreates.get(key) === task) this.inflightCreates.delete(key)
    }
  }

  private async createOnce(draft: CreateDraft): Promise<ScheduleInfo> {
    const session = await this.client.session.create({
      title: draft.name ? `定时任务：${draft.name}` : "定时任务",
      ...(draft.model ? { model: draft.model } : {}),
      ...(draft.agent ? { agent: draft.agent } : {}),
      ...(draft.directory ? { location: { directory: draft.directory } } : {}),
    })

    let modelConfirmed = !draft.model
    if (draft.model && !sameModel(session.model, draft.model)) {
      // Some hosts ignore `model` on create; switch explicitly and read back
      // instead of trusting the picked value.
      try {
        await this.client.session.switchModel({ sessionID: session.id, model: draft.model })
        const verify = await this.client.session.get({ sessionID: session.id })
        modelConfirmed = sameModel(verify.model, draft.model)
      } catch {
        modelConfirmed = false
      }
    }
    if (draft.model && !modelConfirmed) {
      const reason = new Error(
        `无法确认模型 ${draft.model.providerID}/${draft.model.id} 已生效，任务未创建；请稍后重试或不指定模型。`,
      )
      // Explicit failure: wait for rollback, and surface a rollback failure.
      await this.rollbackSession(session.id, reason)
      throw reason
    }

    // Mirror the model read-back for agent: trust the server's session state,
    // not the create argument. Switch explicitly then verify when needed.
    let agentConfirmed = !draft.agent
    if (draft.agent && session.agent !== draft.agent) {
      try {
        await this.client.session.switchAgent({ sessionID: session.id, agent: draft.agent })
        const verify = await this.client.session.get({ sessionID: session.id })
        agentConfirmed = verify.agent === draft.agent
      } catch {
        agentConfirmed = false
      }
    }
    if (draft.agent && !agentConfirmed) {
      const reason = new Error(
        `无法确认 Agent ${draft.agent} 已生效，任务未创建；请稍后重试或不指定 Agent。`,
      )
      await this.rollbackSession(session.id, reason)
      throw reason
    }

    const when: WhenDraft = draft.when
    let response: ScheduleInfo
    try {
      response = await this.client.experimental.schedule.create({
        sessionID: session.id,
        prompt: draft.prompt,
        ...(draft.name ? { name: draft.name } : {}),
        when: {
          ...(when.kind === "in"
            ? { in: when.in }
            : when.kind === "at"
              ? { at: when.at }
              : when.kind === "every"
                ? { every: when.every }
                : { cron: when.cron }),
          ...(when.tz ? { tz: when.tz } : {}),
        },
        ...(draft.if ? { if: draft.if } : {}),
        ...(draft.until ? { until: draft.until } : {}),
        ...(draft.ends ? { ends: draft.ends } : {}),
      })
    } catch (error) {
      return this.reconcileCreate(session, draft, error)
    }
    this.commitCreated(session, response, draft)
    return response
  }

  /**
   * A rejected create does not prove the server did nothing — a lost response
   * (timeout/abort) can hide a successful write. Verify with the official
   * schedule list before ever touching the mount session.
   */
  private async reconcileCreate(session: SessionInfo, draft: CreateDraft, error: unknown): Promise<ScheduleInfo> {
    let existing: ScheduleInfo[] | undefined
    try {
      existing = await this.client.experimental.schedule.list({ sessionID: session.id })
    } catch {
      existing = undefined
    }
    if (existing && existing.length > 0) {
      // The server did create the task: adopt it and keep its mount session.
      const created = existing.find((item) => item.action?.prompt === draft.prompt) ?? existing[0]
      this.commitCreated(session, created, draft)
      return created
    }
    if (existing && classifyCreateError(error) === "explicit-rejection") {
      // ONLY a provable business rejection (4xx with a stable SDK tag/status)
      // plus a confirmed empty list is safe to roll back. Every uncertain
      // class — 5xx, timeout, abort, network, parse, unknown — keeps the
      // session: a lost response can hide a write even when the list is empty.
      await this.rollbackSession(session.id, error)
      throw error
    }
    // A lost/timeout response can be hidden by read lag even when the list is
    // empty, and a failed verification proves nothing either way. In both cases
    // the outcome is unknown: keep the session instead of orphaning a task.
    throw new Error(
      `任务创建结果无法确认（${describeError(error)}）；承载会话 ${session.id} 已保留，请检查后手动处理。`,
    )
  }

  private async rollbackSession(sessionID: string, cause: unknown): Promise<void> {
    try {
      await this.client.session.remove({ sessionID })
    } catch (rollbackError) {
      throw new Error(
        `承载会话清理失败（${sessionID}）：${describeError(rollbackError)}；原始错误：${describeError(cause)}。请手动删除该会话。`,
      )
    }
  }

  private commitCreated(session: SessionInfo, schedule: ScheduleInfo, draft: CreateDraft): void {
    const stored: SessionInfo = { ...session, ...(draft.model ? { model: draft.model } : {}) }
    this.sessions.set(session.id, stored)
    const existing = this.scheduleCache.get(session.id) ?? []
    this.scheduleCache.set(
      session.id,
      existing.some((item) => item.id === schedule.id) ? existing : [...existing, schedule],
    )
    this.mutationSeq += 1
  }

  /** Known project directories, most recently used first, for the directory picker. */
  async recentDirectories(): Promise<string[]> {
    if (this.sessions.size === 0) await this.refreshSessions()
    const counts = new Map<string, number>()
    for (const session of this.sessions.values()) {
      const directory = (session.location?.directory ?? session.directory ?? "").trim()
      if (!directory) continue
      counts.set(directory, (counts.get(directory) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([directory]) => directory)
  }

  /**
   * Primary agents available for scheduled runs. `id` is the stable value the
   * session API expects; `name` is only a human-friendly label for the picker.
   */
  async primaryAgents(): Promise<Array<{ id: string; name: string; description?: string }>> {
    try {
      const response = await this.client.agent.list()
      const agents = (response.data ?? response) as Array<{ id: string; name: string; mode?: string; description?: string }>
      return agents
        .filter((agent) => agent.mode === "primary" || agent.mode === "all")
        // Bookkeeping agents are not meaningful owners for a scheduled run.
        // Match on id (stable) rather than display name, which is localized.
        .filter((agent) => !["compaction", "title", "summary"].includes(agent.id))
        .map((agent) => ({ id: agent.id, name: agent.name, description: agent.description }))
    } catch {
      return []
    }
  }

  async pause(scheduleID: string): Promise<ScheduleRow[]> {
    const updated = await this.client.experimental.schedule.pause({ scheduleID })
    return this.patchLocal(scheduleID, (schedule) => Object.assign(schedule, updated))
  }

  async resume(scheduleID: string): Promise<ScheduleRow[]> {
    const updated = await this.client.experimental.schedule.resume({ scheduleID })
    return this.patchLocal(scheduleID, (schedule) => Object.assign(schedule, updated))
  }

  /**
   * Delete the schedule only. A display title is never proof of ownership, so
   * no session is removed here — not even one this plugin created earlier.
   * An unused mount session is harmless and stays under the user's control.
   */
  async remove(scheduleID: string, _sessionID?: string): Promise<void> {
    await this.client.experimental.schedule.delete({ scheduleID })
    this.dropFromCache(scheduleID)
  }

  /**
   * Re-read one task with the official `schedule.get` after a failed operation.
   * Unlike a full sweep this touches only the affected task:
   * - still present  -> adopt the server's fresh state into the cache;
   * - not found       -> the task is gone, drop only this cache entry;
   * - unreadable      -> outcome unknown, keep the last known state untouched.
   * It never deletes sessions or changes other tasks.
   */
  async reconcile(scheduleID: string): Promise<ScheduleRow[]> {
    let fresh: ScheduleInfo
    try {
      fresh = await this.client.experimental.schedule.get({ scheduleID })
    } catch (error) {
      // Duck-type the official ScheduleNotFoundError via its stable `_tag`
      // (a runtime import from the SDK is not available inside plugin GUIs).
      if ((error as { _tag?: string } | null)?._tag === "ScheduleNotFoundError") {
        this.dropFromCache(scheduleID)
      }
      // Any other failure is indeterminate: keep the previous rows.
      return this.cachedRows()
    }
    return this.patchLocal(scheduleID, (schedule) => Object.assign(schedule, fresh))
  }

  /** Remove one cached task (and only it); no-op when already absent. */
  private dropFromCache(scheduleID: string): void {
    for (const [sessionID, schedules] of this.scheduleCache) {
      if (!schedules.some((schedule) => schedule.id === scheduleID)) continue
      this.scheduleCache.set(sessionID, schedules.filter((schedule) => schedule.id !== scheduleID))
      this.mutationSeq += 1
      break
    }
  }
}

/** Stable identity for duplicate-submit detection; different drafts stay distinct. */
function draftKey(draft: CreateDraft): string {
  return JSON.stringify({
    name: draft.name,
    prompt: draft.prompt,
    when: draft.when,
    ends: draft.ends,
    if: draft.if,
    until: draft.until,
    model: draft.model,
    agent: draft.agent,
    directory: draft.directory,
  })
}

/**
 * How a failed `schedule.create` is classified, based on the ACTUAL error
 * shapes @opencode/client 2.2.5 throws (verified against the shipped SDK):
 *  - declared business errors are Error instances carrying a `_tag` property
 *    and `name === _tag` (SDK: `Object.assign(new Error(message), body)`):
 *    InvalidRequestError=400, UnauthorizedError=401, ForbiddenError=403,
 *    ServiceUnavailableError=503, UnknownError, etc. `_tag` is read BEFORE
 *    `instanceof Error` so these are never mistaken for generic errors;
 *  - transport / undeclared HTTP statuses are `ClientError` Errors with a
 *    `reason` (`UnexpectedStatus` carrying a numeric `cause.status`,
 *    `Transport`, `MalformedResponse`, `UnsupportedContentType`, ...);
 *  - fetch/network/abort/parse may also surface as native Error subclasses.
 *
 * Only `explicit-rejection` may trigger rollback (and only with a confirmed
 * empty list). Everything else is indeterminate — the server may have written
 * the task despite a broken response.
 */
export type CreateErrorKind =
  | "explicit-rejection"
  | "server-error"
  | "timeout"
  | "abort"
  | "network"
  | "parse-error"
  | "unknown"

/** Tags the SDK maps from definitive client-side rejections (4xx). */
const EXPLICIT_REJECTION_TAGS = new Set([
  "InvalidRequestError", // 400
  "UnauthorizedError", // 401
  "ForbiddenError", // 403
  "ConflictError", // 409
  "InvalidCursorError",
  "SessionBusyError",
])
/** Tags the SDK maps from server-side failures — outcome is not knowable. */
const SERVER_ERROR_TAGS = new Set([
  "ServiceUnavailableError", // 503
  "RpcError",
  "RpcInternalError",
  "UnknownError",
  "CommandExecutionError",
  "ProviderRequestError",
])

export function classifyCreateError(error: unknown): CreateErrorKind {
  if (error === null || error !== Object(error)) return "unknown"

  const tag = (error as { _tag?: unknown })._tag
  if (typeof tag === "string") {
    if (EXPLICIT_REJECTION_TAGS.has(tag)) return "explicit-rejection"
    if (SERVER_ERROR_TAGS.has(tag)) return "server-error"
    // Any other SDK business tag (e.g. a *NotFoundError) is a rejected
    // request, not a lost response — but it is not a create validation
    // rejection either. Treat conservatively as indeterminate.
    return "unknown"
  }

  // SDK `ClientError`: reason + numeric cause.status, no message guessing.
  const name = (error as { name?: unknown }).name
  const reason = (error as { reason?: unknown }).reason
  if (name === "ClientError" && reason !== undefined) {
    if (reason === "UnexpectedStatus") {
      const status = (error as { cause?: { status?: unknown } }).cause?.status
      if (typeof status === "number") {
        if (status >= 500) return "server-error"
        if (status === 408) return "timeout"
        if (status === 429) return "unknown" // rate limit: outcome unknowable
        if (status >= 400 && status < 500) return "explicit-rejection"
      }
      return "unknown"
    }
    if (reason === "Transport") return "network"
    if (reason === "MalformedResponse" || reason === "UnsupportedContentType") return "parse-error"
    return "unknown"
  }

  // Native Error subclasses from fetch/abort/parse layers.
  if (error instanceof Error) {
    if (error.name === "TimeoutError") return "timeout"
    if (error.name === "AbortError") return "abort"
    if (error.name === "SyntaxError") return "parse-error"
    if (error.name === "TypeError") return "network" // undici "fetch failed"
    return "unknown"
  }
  return "unknown"
}

/** Active first, then by next due time; ended tasks last. */
function sortRows(rows: ScheduleRow[]): ScheduleRow[] {
  return rows.sort((a, b) => {
    const order = (row: ScheduleRow) => (row.schedule.status === "active" ? 0 : row.schedule.status === "paused" ? 1 : 2)
    const byStatus = order(a) - order(b)
    if (byStatus !== 0) return byStatus
    return (a.schedule.nextDueAt ?? Number.MAX_SAFE_INTEGER) - (b.schedule.nextDueAt ?? Number.MAX_SAFE_INTEGER)
  })
}

function describeError(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  // SDK business errors are plain objects carrying `message` (+ `_tag`).
  if (cause !== null && typeof cause === "object" && "message" in cause) {
    const message = (cause as { message?: unknown }).message
    const tag = (cause as { _tag?: unknown })._tag
    return typeof tag === "string" ? `${tag}: ${String(message)}` : String(message)
  }
  return String(cause)
}

function toModelChoice(model: ModelInfo): ModelChoice {
  return {
    key: `${model.providerID}/${model.id}`,
    id: model.id,
    modelID: model.modelID || model.id,
    providerID: model.providerID,
    name: model.name?.trim() || model.id,
    status: model.status ?? "active",
    variants: (model.variants ?? []).map((variant: { id: string }) => variant.id).filter((id) => id !== "none"),
  }
}

/** Whether a session already runs the picked model (and variant). */
function sameModel(
  current: { id: string; providerID: string; variant?: string } | undefined,
  picked: { id: string; providerID: string; variant?: string },
): boolean {
  return (
    current !== undefined &&
    current.id === picked.id &&
    current.providerID === picked.providerID &&
    (current.variant ?? "") === (picked.variant ?? "")
  )
}
