/** Mirror of the experimental schedule API types from @opencode/client. */
export type ScheduleWhen =
  | { type: "in"; in: string; tz?: string }
  | { type: "at"; at: string; tz?: string }
  | { type: "every"; every: string; tz?: string }
  | { type: "cron"; cron: string; tz?: string }

export type ScheduleCondition =
  | { type: "shell"; run: string; is?: string; matches?: string; changes?: boolean }
  | { type: "code"; code: string }

export type ScheduleStatus = "active" | "paused" | "done"

export type ScheduleOutcome =
  | "fired"
  | "late"
  | "checked"
  | "expired"
  | "skipped"
  | "disabled"
  | "failed"

export interface ScheduleInfo {
  id: string
  sessionID?: string
  name?: string
  when: ScheduleWhen
  tz: string
  if?: ScheduleCondition
  until?: ScheduleCondition
  action: { type: "prompt"; prompt: string }
  status: ScheduleStatus
  nextDueAt?: number
  endsAt?: number
  remainingRuns?: number
  runCount: number
  lastFiredAt?: number
  lastOutcome?: ScheduleOutcome
  lastOutput?: string
  time: { created: number; updated: number }
}

export interface SessionInfo {
  id: string
  title?: string
  directory?: string
  projectID?: string
  location?: { directory?: string }
  time?: { created?: number; updated?: number }
}

export interface ScheduleRow {
  schedule: ScheduleInfo
  sessionTitle: string
}

export type WhenDraft =
  | { kind: "in"; in: string }
  | { kind: "at"; at: string; tz?: string }
  | { kind: "every"; every: string; tz?: string }
  | { kind: "cron"; cron: string; tz?: string }

export interface CreateDraft {
  sessionID: string
  name?: string
  when: WhenDraft
  prompt: string
  ends?: { after?: string; at?: string; times?: number }
  model?: { id: string; providerID: string; variant?: string }
  directory?: string
  agent?: string
}

/** One selectable model, flattened from the API's ModelInfo. */
export interface ModelChoice {
  /** `${providerID}/${id}`, unique across providers. */
  key: string
  /** The model id a session's ModelRef expects. */
  id: string
  /** The provider-facing id, useful when it differs from the display id. */
  modelID: string
  providerID: string
  name: string
  status: string
  /** Variant ids the model exposes; empty when it has none. */
  variants: string[]
}

/** Models grouped by provider so the picker can cascade provider → model. */
export interface ModelProviderGroup {
  id: string
  name: string
  models: ModelChoice[]
}
