import type {
  AutomationInfo,
  ExperimentalAutomationCreateInput,
  ModelInfo,
  OpenCodeClient,
  ProviderInfo,
} from "@opencode/client/promise"
import type { CreateDraft, ModelChoice, ModelProviderGroup, ScheduleInfo, ScheduleRow, SessionInfo, WhenDraft } from "./types"

/** A session whose metadata could not be read in this sweep. Automation rows
 *  are NEVER dropped because of this — sessions are display metadata only. */
export interface SessionFailure {
  sessionID: string
  reason: string
}

/** Result of a full sweep: rows plus explicit markers for each incomplete dimension. */
export interface ListResult {
  rows: ScheduleRow[]
  /** Failed session-metadata pages; automation visibility is unaffected. */
  failures: SessionFailure[]
  /** Session pagination reached the safety cap while a next cursor still existed. */
  truncated: boolean
}

const SESSION_PAGE_SIZE = 200
const MAX_SESSION_PAGES = 100

/**
 * Automation visibility comes solely from the official global
 * `automation.list()` (no `sessionID` filter). Sessions are read only to enrich
 * display metadata (title / model / agent / directory); a session read failure
 * never hides a task. The official list gives no snapshot guarantee, so a
 * concurrent add/remove may be missed and is never reported as strongly
 * consistent — a mutation during a sweep is detected via `mutationSeq`.
 */
export class ScheduleStore {
  /** Display metadata for sessions, keyed by sessionID. Never a visibility gate. */
  private sessions = new Map<string, SessionInfo>()
  /** Last-read automations keyed by their official id (not by session, so tasks
   *  with no creator sessionID are represented without inventing one). */
  private automationCache = new Map<string, ScheduleInfo>()
  /** Cached model catalog; one fetch per dialog lifetime is enough. */
  private catalog: ModelProviderGroup[] | undefined
  /** Each draft key keeps its own in-flight create, so A/B/A stays distinct. */
  private inflightCreates = new Map<string, Promise<ScheduleInfo>>()
  /** Bumped by local cache writes so a sweep never overwrites newer local data. */
  private mutationSeq = 0
  /** Ids locally deleted while a sweep is in flight. An in-flight global
   *  snapshot still lists them; this tombstone stops the merge from reviving
   *  a task the user just removed. Cleared once the sweep commits. */
  private deletedInFlight = new Set<string>()

  constructor(private readonly client: OpenCodeClient) {}

  /** The OpenCode client; exposed for widgets that call schedule endpoints directly. */
  get api(): OpenCodeClient {
    return this.client
  }

  /**
   * Follow the session cursor to exhaustion, for DISPLAY METADATA only. The
   * 100-page ceiling is reported via `truncated`; a failed page is recorded in
   * `failures`. Neither ever hides an automation — a failure here only means
   * some titles/model/agent may be missing.
   */
  private async fetchAllSessions(): Promise<{
    sessions: Map<string, SessionInfo>
    truncated: boolean
    failures: SessionFailure[]
  }> {
    const sessions = new Map<string, SessionInfo>()
    const failures: SessionFailure[] = []
    let cursor: string | undefined
    let truncated = false
    for (let page = 0; page < MAX_SESSION_PAGES; page += 1) {
      let response
      try {
        response = await this.client.session.list({
          limit: SESSION_PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
        })
      } catch (error) {
        failures.push({ sessionID: `page:${page + 1}`, reason: describeError(error) })
        break // keep the metadata gathered so far; automations are unaffected
      }
      for (const session of response.data ?? []) sessions.set(session.id, session)
      const next = response.cursor?.next
      if (!next) break
      cursor = next
      if (page === MAX_SESSION_PAGES - 1) truncated = true
    }
    return { sessions, truncated, failures }
  }

  async refreshSessions(): Promise<void> {
    const { sessions } = await this.fetchAllSessions()
    // Enrich, never drop: a live session (just-created mount session carrying
    // model/agent/directory) must survive a metadata refresh.
    for (const [id, session] of sessions) this.sessions.set(id, session)
  }

  /**
   * Fetch the official GLOBAL automation list (no sessionID filter) and return
   * active-first rows. A task with no creator sessionID is shown with no bound
   * session — no session is ever invented for it.
   */
  async listAll(): Promise<ListResult> {
    // Baseline BEFORE the first await: any local mutation landing during the
    // awaits must not be rolled back by this snapshot.
    const seqAtStart = this.mutationSeq

    // The authoritative visibility source. A failure here is fatal: it is
    // rethrown so the page marks the sweep unknown rather than pretending the
    // list is empty, and the previous cache stays intact.
    const infos =
      (await this.client.experimental.automation.list()).map(fromAutomation)

    // Session metadata is best-effort and independent of the task list.
    const { sessions, truncated, failures } = await this.fetchAllSessions()

    const nextCache = new Map<string, ScheduleInfo>()
    for (const info of infos) nextCache.set(info.id, info)

    if (this.mutationSeq === seqAtStart) {
      // Clean sweep: adopt the fresh global snapshot in full, including the
      // session metadata gathered this round.
      this.sessions = sessions
      this.automationCache = nextCache
    } else {
      // A create/pause/resume/delete landed mid-sweep. Keep the newer local
      // state: add only tasks/sessions the live cache has not seen, never
      // overwrite entries a local mutation already touched.
      for (const [id, info] of nextCache) {
        if (!this.automationCache.has(id) && !this.deletedInFlight.has(id)) this.automationCache.set(id, info)
      }
      for (const [id, session] of sessions) {
        if (!this.sessions.has(id)) this.sessions.set(id, session)
      }
    }
    // This snapshot has been reconciled; tombstones have served their purpose.
    this.deletedInFlight.clear()
    return { rows: this.rowsFrom(this.sessions, this.automationCache), failures, truncated }
  }

  private rowsFrom(sessions: Map<string, SessionInfo>, cache: Map<string, ScheduleInfo>): ScheduleRow[] {
    const rows: ScheduleRow[] = []
    for (const schedule of cache.values()) {
      // Only a real creator sessionID may bind metadata. An empty/absent one
      // maps to no session — never guess from title or target.
      const session = schedule.sessionID ? sessions.get(schedule.sessionID) : undefined
      rows.push({
        schedule,
        sessionTitle: session?.title ?? schedule.name ?? schedule.id,
        ...(session ? { session } : {}),
      })
    }
    return sortRows(rows)
  }

  /**
   * Patched view of the rows without a network sweep: apply `mutate` to the
   * cached schedule, then rebuild rows from the cache. Cheap and immediate;
   * the next explicit refresh still reconciles with the server.
   */
  private patchLocal(scheduleID: string, mutate: (schedule: ScheduleInfo) => void): ScheduleRow[] {
    const current = this.automationCache.get(scheduleID)
    if (current) {
      const next = { ...current }
      mutate(next)
      this.automationCache.set(scheduleID, next)
      this.mutationSeq += 1
    }
    return this.cachedRows()
  }

  /** Rebuild rows from the automation cache (no network). */
  private rowsFromCache(): ScheduleRow[] {
    return this.rowsFrom(this.sessions, this.automationCache)
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
    // Bind mode: deliver the prompt to a session the user already owns. No
    // mount session, no model/agent/directory switches — those would mutate
    // a session that is not ours to reconfigure.
    if (draft.bindSessionID) return this.createBoundOnce(draft)

    const session = await this.client.session.create({
      title: draft.name ? `定时任务：${draft.name}` : "定时任务",
      ...(draft.model ? { model: draft.model } : {}),
      ...(draft.agent ? { agent: draft.agent } : {}),
      ...(draft.directory ? { location: { directory: draft.directory } } : {}),
    })

    // When create already returns the requested value, that IS the confirmed
    // server state: skip the switch, and never report a false negative that
    // would roll back a perfectly valid session.
    let confirmedSession: SessionInfo = session
    let modelConfirmed = !draft.model || sameModel(session.model, draft.model)
    if (draft.model && !modelConfirmed) {
      // Some hosts ignore `model` on create; switch explicitly and read back
      // instead of trusting the picked value.
      try {
        await this.client.session.switchModel({ sessionID: session.id, model: draft.model })
        const verify = await this.client.session.get({ sessionID: session.id })
        modelConfirmed = sameModel(verify.model, draft.model)
        if (modelConfirmed) confirmedSession = { ...confirmedSession, model: verify.model }
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
    let agentConfirmed = !draft.agent || session.agent === draft.agent
    if (draft.agent && !agentConfirmed) {
      try {
        await this.client.session.switchAgent({ sessionID: session.id, agent: draft.agent })
        const verify = await this.client.session.get({ sessionID: session.id })
        agentConfirmed = verify.agent === draft.agent
        if (agentConfirmed) confirmedSession = { ...confirmedSession, agent: verify.agent }
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

    let response: ScheduleInfo
    try {
      const created = await this.client.experimental.automation.create(buildCreateInput(session.id, draft))
      response = fromAutomation(created)
    } catch (error) {
      return this.reconcileCreate(confirmedSession, draft, error)
    }
    this.commitCreated(confirmedSession, response)
    return response
  }

  /**
   * Bind to an existing session chosen by the user. No session.create and no
   * model/agent/directory switches — the target belongs to the user, and
   * reconfiguring it (or rolling it back by deleting it) would be destructive.
   * The chosen session is both the creator (`sessionID`) and the prompt target
   * (`action.to.session`), so its metadata drives the card display as usual.
   */
  private async createBoundOnce(draft: CreateDraft): Promise<ScheduleInfo> {
    const sessionID = draft.bindSessionID!
    // Read the session for display metadata, but never block creation on it:
    // the caller just picked this session from a live list, and a read-back
    // failure must not turn into a false negative. A minimal fallback lets the
    // card render until the next sweep enriches the title/model/agent.
    let session: SessionInfo = { id: sessionID }
    try {
      session = await this.client.session.get({ sessionID })
    } catch {
      // keep the fallback; metadata enrichment is best-effort everywhere else
    }

    // Defense in depth: the UI never sends these in bound mode, but a direct
    // caller must not be able to smuggle session-level settings into a task
    // that is supposed to reuse the target session as-is.
    const { model: _m, agent: _a, directory: _d, ...clean } = draft
    let response: ScheduleInfo
    try {
      // buildCreateInput sets both sessionID and action.to.session to this id.
      const created = await this.client.experimental.automation.create(buildCreateInput(sessionID, clean))
      response = fromAutomation(created)
    } catch (error) {
      return this.reconcileBoundCreate(session, draft, error)
    }
    this.commitCreated(session, response)
    return response
  }

  /**
   * Bound-mode create failure: verify whether a lost response hid a successful
   * write, but NEVER delete the target session — it is the user's, not a mount
   * session we created. If nothing was written, surface the original error
   * unchanged (the caller keeps its session and its draft).
   */
  private async reconcileBoundCreate(session: SessionInfo, draft: CreateDraft, error: unknown): Promise<ScheduleInfo> {
    let existing: ScheduleInfo[] | undefined
    try {
      existing = (await this.client.experimental.automation.list({ sessionID: session.id })).map(fromAutomation)
    } catch {
      existing = undefined
    }
    if (existing && existing.length > 0) {
      const created =
        existing.find((item) => item.action.type === "prompt" && item.action.prompt === draft.prompt) ?? existing[0]
      this.commitCreated(session, created)
      return created
    }
    throw error
  }

  /**
   * A rejected create does not prove the server did nothing — a lost response
   * (timeout/abort) can hide a successful write. Verify with the official
   * automation list before ever touching the mount session.
   */
  private async reconcileCreate(session: SessionInfo, draft: CreateDraft, error: unknown): Promise<ScheduleInfo> {
    let existing: ScheduleInfo[] | undefined
    try {
      existing = (await this.client.experimental.automation.list({ sessionID: session.id })).map(fromAutomation)
    } catch {
      existing = undefined
    }
    if (existing && existing.length > 0) {
      // The server did create the task: adopt it and keep its mount session.
      // Match only prompt actions whose text is this draft's prompt; a code
      // action has no `prompt` field and must not be coerced into one.
      const created =
        existing.find((item) => item.action.type === "prompt" && item.action.prompt === draft.prompt) ?? existing[0]
      this.commitCreated(session, created)
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

  private commitCreated(session: SessionInfo, schedule: ScheduleInfo): void {
    // `session` is the confirmed server state from createOnce (create response
    // or post-switch read-back). Never overwrite it with the request draft.
    this.sessions.set(session.id, { ...session })
    this.automationCache.set(schedule.id, schedule)
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
    const updated = fromAutomation(await this.client.experimental.automation.pause({ automationID: scheduleID }))
    return this.patchLocal(scheduleID, (schedule) => Object.assign(schedule, updated))
  }

  async resume(scheduleID: string): Promise<ScheduleRow[]> {
    const updated = fromAutomation(await this.client.experimental.automation.resume({ automationID: scheduleID }))
    return this.patchLocal(scheduleID, (schedule) => Object.assign(schedule, updated))
  }

  /**
   * Delete the automation only. A display title is never proof of ownership, so
   * no session is removed here — not even one this plugin created earlier.
   * An unused mount session is harmless and stays under the user's control.
   */
  async remove(scheduleID: string, _sessionID?: string): Promise<void> {
    await this.client.experimental.automation.delete({ automationID: scheduleID })
    this.dropFromCache(scheduleID)
  }

  /**
   * Re-read one task with the official `automation.get` after a failed operation.
   * Unlike a full sweep this touches only the affected task:
   * - still present  -> adopt the server's fresh state into the cache;
   * - not found       -> the task is gone, drop only this cache entry;
   * - unreadable      -> outcome unknown, keep the last known state untouched.
   * It never deletes sessions or changes other tasks.
   */
  async reconcile(scheduleID: string): Promise<ScheduleRow[]> {
    let fresh: ScheduleInfo
    try {
      fresh = fromAutomation(await this.client.experimental.automation.get({ automationID: scheduleID }))
    } catch (error) {
      // Duck-type the official AutomationNotFoundError via its stable `_tag`
      // (a runtime import from the SDK is not available inside plugin GUIs).
      if ((error as { _tag?: string } | null)?._tag === "AutomationNotFoundError") {
        this.dropFromCache(scheduleID)
      }
      // Any other failure is indeterminate: keep the previous rows.
      return this.cachedRows()
    }
    return this.patchLocal(scheduleID, (schedule) => Object.assign(schedule, fresh))
  }

  /** Remove one cached task (and only it); no-op when already absent. */
  private dropFromCache(scheduleID: string): void {
    if (this.automationCache.delete(scheduleID)) {
      this.mutationSeq += 1
      this.deletedInFlight.add(scheduleID)
    }
  }
}

/**
 * Map an official AutomationInfo to the panel's display projection. Every
 * official field is preserved with its SDK type — including `action`, kept
 * verbatim as the official prompt|code discriminated union (a code action is
 * NEVER downgraded to prompt). Only three fields get display aliases.
 */
function fromAutomation(info: AutomationInfo): ScheduleInfo {
  const { trigger, expires, lastRunAt, ...rest } = info
  return {
    ...rest,
    when: trigger,
    endsAt: expires,
    lastFiredAt: lastRunAt,
  }
}

/**
 * Build the official create payload. Two distinct session roles are set on
 * purpose and must not be confused:
 *  - `sessionID` is the CREATOR (the mount session this plugin just created);
 *  - `action.to.session` is the EXECUTION TARGET the prompt is delivered to.
 * They are the same session here because the plugin gives each task a dedicated
 * home, but they are independent fields in the API. `ends` is time-only and maps
 * to the official `expires`; `in` is expressed as an absolute-offset `at`
 * trigger ("in <duration>"). No other fields are sent — this payload is exactly
 * an ExperimentalAutomationCreateInput.
 */
function buildCreateInput(ownerSessionID: string, draft: CreateDraft): ExperimentalAutomationCreateInput {
  const when: WhenDraft = draft.when
  const tz = when.tz ? { tz: when.tz } : {}
  const trigger: ExperimentalAutomationCreateInput["trigger"] =
    when.kind === "in"
      ? { type: "at", at: `in ${when.in}`, ...tz }
      : when.kind === "at"
        ? { type: "at", at: when.at, ...tz }
        : when.kind === "every"
          ? { type: "every", every: when.every, ...tz }
          : { type: "cron", cron: when.cron, ...tz }

  let expires: string | undefined
  if (draft.ends?.after) expires = `in ${draft.ends.after}`
  else if (draft.ends?.at) expires = draft.ends.at

  return {
    sessionID: ownerSessionID,
    name: draft.name ?? draft.prompt.slice(0, 60),
    trigger,
    action: { type: "prompt", prompt: draft.prompt, to: { session: ownerSessionID } },
    ...(draft.directory ? { directory: draft.directory } : {}),
    ...(expires ? { expires } : {}),
  }
}

/** Stable identity for duplicate-submit detection; different drafts stay distinct. */
function draftKey(draft: CreateDraft): string {
  return JSON.stringify({
    bindSessionID: draft.bindSessionID ?? "",
    name: draft.name,
    prompt: draft.prompt,
    when: draft.when,
    ends: draft.ends,
    model: draft.model,
    agent: draft.agent,
    directory: draft.directory,
  })
}

/**
 * How a failed `automation.create` is classified, based on the ACTUAL error
 * shapes @opencode/client 2.3.2 throws (verified against the shipped SDK):
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
