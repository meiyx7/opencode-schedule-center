// Schedule domain types come straight from the official SDK — no local mirror
// that can drift on upgrade. Re-exported under the same names so callers need
// no change; add a compile-time alias check below to keep this honest.
import type {
  ScheduleCondition as OfficialScheduleCondition,
  ScheduleInfo as OfficialScheduleInfo,
  ScheduleOutcome as OfficialScheduleOutcome,
  ScheduleStatus as OfficialScheduleStatus,
  ScheduleWhen as OfficialScheduleWhen,
} from "@opencode/client/promise"

export type ScheduleWhen = OfficialScheduleWhen
export type ScheduleCondition = OfficialScheduleCondition
export type ScheduleStatus = OfficialScheduleStatus
export type ScheduleOutcome = OfficialScheduleOutcome
export type ScheduleInfo = OfficialScheduleInfo

/** A session's model pick, mirroring the API's ModelRef. */
export interface SessionModelRef {
  id: string
  providerID: string
  variant?: string
}

export interface SessionInfo {
  id: string
  title?: string
  directory?: string
  projectID?: string
  location?: { directory?: string }
  time?: { created?: number; updated?: number }
  /** The model the session wakes with; set in the create form's advanced options. */
  model?: SessionModelRef
  /** The primary agent the session runs as. */
  agent?: string
}

export interface ScheduleRow {
  schedule: ScheduleInfo
  sessionTitle: string
  /** The bound session, source of the advanced options (model / agent / directory). */
  session?: SessionInfo
}

export type WhenDraft =
  | { kind: "in"; in: string; tz?: string }
  | { kind: "at"; at: string; tz?: string }
  | { kind: "every"; every: string; tz?: string }
  | { kind: "cron"; cron: string; tz?: string }

/**
 * Condition shape accepted by the official create payload. Unlike the returned
 * `ScheduleCondition` it carries no `type` discriminator — the API tells shell
 * from code by the presence of `run` vs `code`.
 */
export type ConditionDraft =
  | { run: string; is?: string; matches?: string; changes?: boolean }
  | { code: string }

export interface CreateDraft {
  sessionID: string
  name?: string
  when: WhenDraft
  prompt: string
  ends?: { after?: string; at?: string; times?: number }
  if?: ConditionDraft
  until?: ConditionDraft
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
