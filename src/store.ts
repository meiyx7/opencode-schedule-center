import type { ModelInfo, OpenCodeClient, ProviderInfo } from "@opencode/client/promise"
import type { CreateDraft, ModelChoice, ModelProviderGroup, ScheduleInfo, ScheduleRow, SessionInfo, WhenDraft } from "./types"

/**
 * The schedule API filters every list call by sessionID, so the panel sweeps
 * the session list and merges per-session results. Sessions rarely exceed a
 * few hundred rows, and the sweep runs on demand, not on an interval.
 */
export class ScheduleStore {
  private sessions = new Map<string, SessionInfo>()

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
    if (this.sessions.size === 0) await this.refreshSessions()
    const ids = [...this.sessions.keys()]
    const batches: ScheduleRow[] = []
    const chunkSize = 20
    for (let start = 0; start < ids.length; start += chunkSize) {
      const chunk = ids.slice(start, start + chunkSize)
      const results = await Promise.allSettled(
        chunk.map(async (sessionID) => {
          const schedules = await this.client.experimental.schedule.list({ sessionID })
          return schedules.map((schedule): ScheduleRow => ({
            schedule,
            sessionTitle: this.sessions.get(sessionID)?.title ?? sessionID,
          }))
        }),
      )
      for (const result of results) {
        if (result.status === "fulfilled") batches.push(...result.value)
      }
    }
    batches.sort((a, b) => {
      const order = (row: ScheduleRow) => (row.schedule.status === "active" ? 0 : row.schedule.status === "paused" ? 1 : 2)
      const byStatus = order(a) - order(b)
      if (byStatus !== 0) return byStatus
      return (a.schedule.nextDueAt ?? Number.MAX_SAFE_INTEGER) - (b.schedule.nextDueAt ?? Number.MAX_SAFE_INTEGER)
    })
    return batches
  }

  /**
   * Chat models grouped by provider, so the form can offer provider → model
   * cascading with search. Beta models stay selectable; deprecated ones do not.
   */
  async modelCatalog(): Promise<ModelProviderGroup[]> {
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
      this.sessions.set(session.id, { id: session.id, title: session.title })
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

  async pause(scheduleID: string): Promise<ScheduleInfo> {
    return this.client.experimental.schedule.pause({ scheduleID })
  }

  async resume(scheduleID: string): Promise<ScheduleInfo> {
    return this.client.experimental.schedule.resume({ scheduleID })
  }

  async remove(scheduleID: string): Promise<void> {
    await this.client.experimental.schedule.delete({ scheduleID })
  }
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
