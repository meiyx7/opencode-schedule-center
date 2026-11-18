// Types are anchored to the real @opencode/client 2.3.2 Automation API surface.
// The official Schedule* types were removed in 2.3.2, so this module no longer
// imports them. `ScheduleInfo` below is a DISPLAY PROJECTION of the official
// AutomationInfo (built by the store), not a re-declaration of an API type:
// every official field keeps its SDK type, and the few extra fields are
// display-only aliases derived from official data for the existing panel.
import type {
  AutomationAction,
  AutomationInfo as OfficialAutomationInfo,
  AutomationStatus,
  AutomationOutcome,
  AutomationTrigger,
} from "@opencode/client/promise"

/** Official status/outcome enums, re-exported under the names the panel uses. */
export type ScheduleStatus = AutomationStatus
export type ScheduleOutcome = AutomationOutcome

/** Display projection of the official AutomationTrigger.
 *  The legacy `in` kind is display-only: official `in` schedules were folded
 *  into an absolute `at` trigger by the host, so the API never returns it. */
export type ScheduleWhen = AutomationTrigger | { type: "in"; in: string; tz?: string }

/** Legacy display shape for `if` / `until`. The Automation API has no condition
 *  fields; these are kept only so the detail view can still render old rows
 *  and the pure formatter stays testable. The store never populates them. */
export type ScheduleCondition =
  | { type: "shell"; run: string; is?: string; matches?: string; changes?: boolean }
  | { type: "code"; code: string }

/**
 * Row handed to the panel. Built from the official AutomationInfo by the store:
 * - official fields keep their SDK types (Omit only removes the two we reshape);
 * - `when` is the display projection of the official `trigger`;
 * - `endsAt` mirrors official `expires`, `lastFiredAt` mirrors `lastRunAt`;
 * - `if` / `until` / `remainingRuns` have NO official equivalent and stay
 *   undefined — the automation API has neither gating conditions nor run caps.
 */
export type ScheduleInfo = Omit<OfficialAutomationInfo, "action" | "trigger" | "name"> & {
  name?: string
  /** Display projection of the official `trigger`. */
  when: ScheduleWhen
  /** Official action kept verbatim as a discriminated union (prompt | code).
   *  Code actions are NEVER downgraded to prompt: `code`/`args` stay intact and
   *  consumers must narrow on `type` before reading action-specific fields. */
  action: AutomationAction
  /** Display alias of official `expires`. */
  endsAt?: number
  /** No official equivalent. */
  remainingRuns?: number
  /** Display alias of official `lastRunAt`. */
  lastFiredAt?: number
  /** No official equivalent. */
  if?: ScheduleCondition
  /** No official equivalent. */
  until?: ScheduleCondition
}

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

/** Duration/end draft from the form. `times` has no Automation equivalent and
 *  is deliberately ignored by the store (recorded as an open issue in B0). */
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
  key: string
  id: string
  modelID: string
  providerID: string
  name: string
  status: string
  variants: string[]
}

/** Models grouped by provider so the picker can cascade provider → model. */
export interface ModelProviderGroup {
  id: string
  name: string
  models: ModelChoice[]
}
