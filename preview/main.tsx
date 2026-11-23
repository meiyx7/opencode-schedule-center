import { render } from "solid-js/web"
import type { Context } from "@opencode/plugin/gui"
import { ScheduleDialog } from "../src/gui/dialog"
import { installStyles } from "../src/gui/styles"
import { durationMs } from "../src/gui/format"
import { ScheduleStore } from "../src/store"
import type { ScheduleRow } from "../src/types"

const now = Date.now()

function makeRow(overrides: Partial<ScheduleRow["schedule"]>, sessionTitle: string): ScheduleRow {
  return {
    sessionTitle,
    schedule: {
      id: "sch_demo" + Math.random().toString(36).slice(2, 8),
      sessionID: "ses_demo",
      name: undefined,
      when: { type: "cron", cron: "0 9 * * 1-5", tz: "Asia/Shanghai" },
      tz: "Asia/Shanghai",
      action: { type: "prompt", prompt: "检查依赖更新并总结", to: { session: "ses_demo" } },
      status: "active",
      runCount: 0,
      time: { created: now - 86_400_000, updated: now - 86_400_000 },
      nextDueAt: now + 9 * 3600_000 + 600_000,
      ...overrides,
    },
  }
}

const rows: ScheduleRow[] = [
  makeRow(
    {
      name: "工作日晨报",
      nextDueAt: now + 47 * 60_000,
      lastOutcome: "fired",
      lastFiredAt: now - 86_400_000,
      runCount: 23,
    },
    "定时任务：工作日晨报",
  ),
  makeRow(
    {
      name: "CI 巡检",
      when: { type: "every", every: "30 minutes" },
      nextDueAt: now + 12 * 60_000,
      runCount: 4,
      remainingRuns: 8,
    },
    "定时任务：CI 巡检",
  ),
  makeRow(
    {
      name: "周末提醒",
      when: { type: "at", at: new Date(now + 3 * 86_400_000).toISOString() },
      nextDueAt: now + 3 * 86_400_000,
    },
    "定时任务：周末提醒",
  ),
  makeRow(
    {
      name: "旧任务",
      status: "paused",
      lastOutcome: "late",
      lastFiredAt: now - 2 * 86_400_000,
      runCount: 10,
    },
    "定时任务：旧任务",
  ),
  makeRow(
    {
      name: undefined,
      prompt: "这条任务没有设置名称，展示提示词截断的效果，看看是否正常省略号截断处理了。",
      status: "done",
      lastOutcome: "failed",
      lastFiredAt: now - 5 * 3600_000,
      runCount: 1,
    },
    "某个普通会话",
  ),
]

const live = rows.filter((row) => row.schedule.status !== "done")

// Give each demo task its own session so the advanced-option chips vary.
rows.forEach((row, index) => {
  const sessionID = `ses_demo_${index}`
  row.schedule.sessionID = sessionID
  if (row.schedule.action.type === "prompt") row.schedule.action.to = { session: sessionID }
})

const demoSessions = rows.map((row, index) => ({
  id: row.schedule.sessionID ?? `ses_demo_${index}`,
  title: row.sessionTitle,
}))

// Mount sessions created during the preview stay here so a sweep after creation
// still sees their metadata (required by the optional session cleanup).
const extraSessions: Array<{ id: string; title: string; metadata?: Record<string, unknown> }> = []

function MockDialog(props: { title?: string; children?: unknown }) {
  return (
    <div class="mock-dialog">
      <div class="mock-dialog-header">
        <span>{props.title}</span>
      </div>
      <div class="mock-dialog-content">{props.children}</div>
    </div>
  )
}

function toAutomation(row: ScheduleRow) {
  const { when, endsAt, lastFiredAt, ...rest } = row.schedule
  return {
    ...rest,
    trigger: when.type === "in" ? { type: "at", at: `in ${when.in}` } : when,
    expires: endsAt,
    lastRunAt: lastFiredAt,
  }
}

const ctx = {
  ui: { Dialog: MockDialog },
  client: {
    experimental: {
      automation: {
        list: async (input?: { sessionID?: string }) => {
          const source = input?.sessionID
            ? rows.filter((row) => row.schedule.sessionID === input.sessionID)
            : rows
          return source.map(toAutomation)
        },
        get: async (input: { automationID: string }) => {
          const row = rows.find((row) => row.schedule.id === input.automationID)
          if (!row) throw Object.assign(new Error("not found"), { _tag: "AutomationNotFoundError" })
          return toAutomation(row)
        },
        create: async (input: any) => {
          // The real host folds "in 30 minutes" into an absolute timestamp.
          // Do the same so the preview never renders NaN dates.
          const absolute = (value: unknown) => {
            if (typeof value !== "string" || !value.startsWith("in ")) return value
            const ms = durationMs(value.slice(3))
            return ms === null ? value : new Date(Date.now() + ms).toISOString()
          }
          const trigger = input.trigger?.type === "at"
            ? { ...input.trigger, at: absolute(input.trigger.at) }
            : input.trigger
          const schedule: ScheduleRow["schedule"] = {
            id: "sch_created_" + Math.random().toString(36).slice(2, 8),
            sessionID: input.sessionID,
            name: input.name,
            when: trigger,
            tz: "Asia/Shanghai",
            action: input.action,
            status: "active",
            runCount: 0,
            time: { created: Date.now(), updated: Date.now() },
            nextDueAt: Date.now() + 30 * 60_000,
          }
          const row = { sessionTitle: input.name ?? "定时任务", schedule }
          rows.push(row)
          return toAutomation(row)
        },
        pause: async (input: { automationID: string }) => {
          const row = rows.find((row) => row.schedule.id === input.automationID)
          if (row) row.schedule.status = "paused"
          return toAutomation(rows.find((row) => row.schedule.id === input.automationID)!)
        },
        resume: async (input: { automationID: string }) => {
          const row = rows.find((row) => row.schedule.id === input.automationID)
          if (row) row.schedule.status = "active"
          return toAutomation(rows.find((row) => row.schedule.id === input.automationID)!)
        },
        delete: async () => undefined,
      },
    },
    model: {
      list: async () => ({
        data: [
          {
            providerID: "anthropic",
            id: "claude-sonnet-5-5",
            modelID: "claude-sonnet-5-5-20260101",
            name: "Claude Sonnet 5.5",
            status: "active",
            enabled: true,
            variants: [{ id: "none" }, { id: "high" }, { id: "low" }],
          },
          {
            providerID: "anthropic",
            id: "claude-haiku-5",
            modelID: "claude-haiku-5",
            name: "Claude Haiku 5",
            status: "beta",
            enabled: true,
            variants: [],
          },
          {
            providerID: "opencode",
            id: "iceman-free",
            modelID: "iceman-free",
            name: "Iceman Free",
            status: "active",
            enabled: true,
            variants: [],
          },
          {
            providerID: "zcode",
            id: "GLM-5.3-Flash",
            modelID: "GLM-5.3-Flash",
            name: "GLM-5.3 Flash",
            status: "active",
            enabled: true,
            variants: [{ id: "default" }, { id: "thinking" }],
          },
          {
            providerID: "agnes",
            id: "agnes-2.5-pro",
            modelID: "agnes-2.5-pro",
            name: "agnes-2.5-pro",
            status: "active",
            enabled: true,
            variants: [],
          },
        ],
      }),
    },
    provider: {
      list: async () => ({
        data: [
          { id: "anthropic", name: "Anthropic", activation: "enabled", package: "@ai-sdk/anthropic" },
          { id: "opencode", name: "OpenCode", activation: "enabled", package: "@ai-sdk/openai-compatible" },
          { id: "zcode", name: "ZCode", activation: "enabled", package: "@ai-sdk/openai-compatible" },
          { id: "agnes", name: "Agnes", activation: "enabled", package: "@ai-sdk/openai-compatible" },
        ],
      }),
    },
    agent: {
      list: async () => ({
        data: [
          { name: "Build", mode: "primary", description: "构建 agent" },
          { name: "Plan", mode: "primary", description: "规划 agent" },
        ],
      }),
    },
    session: {
      list: async (input?: { limit?: number; search?: string; cursor?: string }) => {
        // Derive from rows so sessions added by other means still show up.
        const all = [...demoSessions, ...extraSessions, ...rows
          .filter((row) => ![...demoSessions, ...extraSessions].some((session) => session.id === row.schedule.sessionID))
          .map((row, index) => ({
            id: row.schedule.sessionID ?? `ses_extra_${index}`,
            title: row.sessionTitle,
          }))]
        const term = input?.search?.trim().toLowerCase()
        const matched = term
          ? all.filter((session) => `${session.title} ${session.id}`.toLowerCase().includes(term))
          : all
        const start = input?.cursor ? Number(input.cursor) : 0
        const limit = input?.limit ?? matched.length
        const data = matched.slice(start, start + limit)
        return {
          data,
          cursor: start + limit < matched.length ? { next: String(start + limit) } : {},
        }
      },
      create: async (input?: { title?: string; metadata?: Record<string, unknown> }) => {
        const session = {
          id: "ses_new_" + Math.random().toString(36).slice(2, 8),
          title: input?.title ?? "定时任务",
          ...(input?.metadata ? { metadata: input.metadata } : {}),
        }
        extraSessions.push(session)
        return session
      },
      get: async ({ sessionID }: { sessionID: string }) =>
        [...demoSessions, ...extraSessions].find((session) => session.id === sessionID) ?? {
          id: sessionID,
          title: sessionID,
        },
      switchModel: async () => undefined,
      remove: async ({ sessionID }: { sessionID: string }) => {
        const index = extraSessions.findIndex((session) => session.id === sessionID)
        if (index >= 0) extraSessions.splice(index, 1)
      },
    },
  },
  sessions: { current: () => undefined },
} as unknown as Context

installStyles()
const store = new ScheduleStore(ctx.client)
render(
  () => <ScheduleDialog ctx={ctx} store={store} onClose={() => undefined} />,
  document.getElementById("root")!,
)
