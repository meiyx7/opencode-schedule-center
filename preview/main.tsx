import { render } from "solid-js/web"
import type { Context } from "@opencode/plugin/gui"
import { ScheduleDialog } from "../src/gui/dialog"
import { installStyles } from "../src/gui/styles"
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
      action: { type: "prompt", prompt: "检查依赖更新并总结" },
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

const demoSessions = rows.map((row, index) => ({
  id: row.schedule.sessionID ?? `ses_demo_${index}`,
  title: row.sessionTitle,
}))

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

const ctx = {
  ui: { Dialog: MockDialog },
  client: {
    experimental: {
      schedule: {
        // The store queries per session; return that session's rows only.
        list: async (input: { sessionID: string }) =>
          rows.filter((row) => row.schedule.sessionID === input.sessionID).map((row) => row.schedule),
        create: async () => rows[0].schedule,
        pause: async (input: { scheduleID: string }) => {
          const row = rows.find((row) => row.schedule.id === input.scheduleID)
          if (row) row.schedule.status = "paused"
          return rows[0].schedule
        },
        resume: async (input: { scheduleID: string }) => {
          const row = rows.find((row) => row.schedule.id === input.scheduleID)
          if (row) row.schedule.status = "active"
          return rows[0].schedule
        },
        delete: async () => undefined,
      },
    },
    model: {
      list: async () => ({
        data: [
          { providerID: "anthropic", id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", status: "active", enabled: true },
          { providerID: "opencode", id: "iceman-free", name: "Iceman Free", status: "active", enabled: true },
          { providerID: "zcode", id: "GLM-5.3-Flash", name: "GLM-5.3 Flash", status: "active", enabled: true },
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
      list: async () => ({
        data: demoSessions.map((session, index) => ({
          id: session.id,
          title: session.title,
          location: { directory: ["/Users/meiyx/workspace/esop_workbuddy", "/Users/meiyx/workspace/esop_workbuddy_api", "/Users/meiyx/workspace/others/ext-new"][index % 3] },
        })),
        cursor: {},
      }),
      create: async () => ({ id: "ses_new", title: "定时任务：新任务" }),
      remove: async () => undefined,
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
