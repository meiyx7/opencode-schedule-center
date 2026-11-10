import type { ModelInfo, OpenCodeClient, ProviderInfo } from "@opencode/client/promise"
import type { CreateDraft, ModelChoice, ModelProviderGroup, ScheduleInfo, ScheduleRow, SessionInfo, WhenDraft } from "./types"

/**
 * The schedule API filters every list call by sessionID, so the panel sweeps
 * the session list and merges per-session results. Sessions rarely exceed a
 * few hundred rows, and the sweep runs on demand, not on an interval.
 *
 * Results are cached: pause/resume/delete patch the cache instead of re-sweeping
 * every session, so follow-up renders are instant and the network sees one call.
 */
export class ScheduleStore {
  private sessions = new Map<string, SessionInfo>()
  /** Per-session schedule lists from the last sweep, keyed by sessionID. */
  private scheduleCache = new Map<string, ScheduleInfo[]>()
  /** Cached model catalog; one fetch per dialog lifetime is enough. */
  private catalog: ModelProviderGroup[] | undefined

  constructor(private readonly client: OpenCodeClient) {}

  /** The OpenCode client; exposed for widgets that call schedule endpoints directly. */
  get api(): OpenCodeClient {
    return this.client
  }

  async refreshSessions(): Promise<void> {
    this.sessions.clear()
    let cursor: string | undefined
    // The session list paginates; follow the cursor to sweep every session.
    for (let page = 0; page < 100; page += 1) {
      const response = await this.client.session.list({
        limit: 200,
        ...(cursor ? { cursor } : {}),
      })
      for (const session of response.data ?? []) this.sessions.set(session.id, session)
      const next = response.cursor?.next
      if (!next) break
      cursor = next
    }
  }

  /** Fetch schedules for every known session and return active-first rows. */
  async listAll(): Promise<ScheduleRow[]> {
    await this.refreshSessions()
    const ids = [...this.sessions.keys()]
    this.scheduleCache.clear()
    const rows: ScheduleRow[] = []
    const chunkSize = 20
    for (let start = 0; start < ids.length; start += chunkSize) {
      const chunk = ids.slice(start, start + chunkSize)
      const results = await Promise.allSettled(
        chunk.map(async (sessionID) => {
          const schedules = await this.client.experimental.schedule.list({ sessionID })
          return { sessionID, schedules }
        }),
      )
      for (const result of results) {
        if (result.status !== "fulfilled") continue
        const { sessionID, schedules } = result.value
        this.scheduleCache.set(sessionID, schedules)
        const session = this.sessions.get(sessionID)
        for (const schedule of schedules) {
          rows.push({
            schedule,
            sessionTitle: session?.title ?? sessionID,
            session,
          })
        }
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
      break
    }
    return this.rowsFromCache()
  }

  /** Rebuild rows from the per-session cache (no network). */
  private rowsFromCache(): ScheduleRow[] {
    const rows: ScheduleRow[] = []
    for (const [sessionID, schedules] of this.scheduleCache) {
      const session = this.sessions.get(sessionID)
      for (const schedule of schedules) {
        rows.push({ schedule, sessionTitle: session?.title ?? sessionID, session })
      }
    }
    return sortRows(rows)
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
    const session = await this.client.session.create({
      title: draft.name ? `定时任务：${draft.name}` : "定时任务",
      ...(draft.model ? { model: draft.model } : {}),
      ...(draft.agent ? { agent: draft.agent } : {}),
      ...(draft.directory ? { location: { directory: draft.directory } } : {}),
    })
    if (draft.model && !sameModel(session.model, draft.model)) {
      // Some hosts ignore `model` on create; switch explicitly so the picked
      // model is what the schedule will wake with.
      await this.client.session.switchModel({ sessionID: session.id, model: draft.model }).catch(() => undefined)
    }
    try {
      const when: WhenDraft = draft.when
      const response = await this.client.experimental.schedule.create({
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
          ...(when.kind === "in" ? {} : when.tz ? { tz: when.tz } : {}),
        },
        ...(draft.ends ? { ends: draft.ends } : {}),
      })
      const stored: SessionInfo = { ...session, ...(draft.model ? { model: draft.model } : {}) }
      this.sessions.set(session.id, stored)
      // Put the new schedule in the cache so the list can show it without a sweep.
      const existing = this.scheduleCache.get(session.id) ?? []
      this.scheduleCache.set(session.id, [...existing, response])
      return response
    } catch (error) {
      // The mount session is useless without its schedule; drop it again.
      void this.client.session.remove({ sessionID: session.id }).catch(() => undefined)
      throw error
    }
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

  /** Primary agents available for scheduled runs. */
  async primaryAgents(): Promise<Array<{ name: string; description?: string }>> {
    try {
      const response = await this.client.agent.list()
      const agents = (response.data ?? response) as Array<{ name: string; mode?: string; description?: string }>
      return agents
        .filter((agent) => agent.mode === "primary" || agent.mode === "all")
        .filter((agent) => !["Compaction", "Title", "Summary"].includes(agent.name))
        .map((agent) => ({ name: agent.name, description: agent.description }))
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

  async remove(scheduleID: string): Promise<void> {
    await this.client.experimental.schedule.delete({ scheduleID })
    // Drop it from the cache so the list view reflects the deletion at once.
    for (const [sessionID, schedules] of this.scheduleCache) {
      const index = schedules.findIndex((schedule) => schedule.id === scheduleID)
      if (index >= 0) {
        const next = schedules.filter((schedule) => schedule.id !== scheduleID)
        this.scheduleCache.set(sessionID, next)
        break
      }
    }
  }
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

function toModelChoice(model: ModelInfo): ModelChoice {
  return {
    key: `${model.providerID}/${model.id}`,
    id: model.id,
    modelID: model.modelID || model.id,
    providerID: model.providerID,
    name: model.name?.trim() || model.id,
    status: model.status ?? "active",
    variants: (model.variants ?? []).map((variant) => variant.id).filter((id) => id !== "none"),
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
