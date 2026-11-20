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

/**
 * Row handed to the panel. Built from the official AutomationInfo by the store:
 * - official fields keep their SDK types (Omit only removes the three we reshape);
 * - `when` is the display projection of the official `trigger`;
 * - `endsAt` mirrors official `expires`, `lastFiredAt` mirrors `lastRunAt`.
 * The Automation API has neither gating conditions nor run caps, so no such
 * fields exist here — every other official field (state, runCount, lastOutput,
 * projectID, directory, time, ...) is preserved verbatim from AutomationInfo.
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
  /** Display alias of official `lastRunAt`. */
  lastFiredAt?: number
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

/** Time-only end condition from the form. The official API has no run-cap field. */
export type EndDraft = { after?: string; at?: string }

export interface CreateDraft {
  sessionID: string
  /**
   * Bind the prompt to an EXISTING session instead of creating a dedicated
   * mount session. When set, createOnce skips session.create and the
   * model/agent/directory switches — those would mutate the user's session.
   */
  bindSessionID?: string
  name?: string
  when: WhenDraft
  prompt: string
  ends?: EndDraft
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
