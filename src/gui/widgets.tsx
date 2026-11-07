import { createSignal, onCleanup, onMount } from "solid-js"
import type { ScheduleRow } from "../types"
import { relativeTime } from "./format"
import type { ScheduleStore } from "../store"

/**
 * Live status for the current session's schedules: the composer pill calls
 * `refresh` when the session changes and `view` while rendering.
 */
export function createSessionStatus(store: ScheduleStore) {
  const [rows, setRows] = createSignal<ScheduleRow[]>([])
  const [tick, setTick] = createSignal(0)
  let disposed = false

  onMount(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 30_000)
    onCleanup(() => {
      disposed = true
      clearInterval(timer)
    })
  })

  async function refresh(sessionID: string): Promise<void> {
    try {
      const schedules = await store.api.experimental.schedule.list({ sessionID })
      if (!disposed) {
        setRows(
          schedules.map((schedule): ScheduleRow => ({ schedule, sessionTitle: schedule.sessionID ?? sessionID })),
        )
      }
    } catch {
      if (!disposed) setRows([])
    }
  }

  function view(): number {
    void tick()
    return rows().filter((row) => row.schedule.status !== "done").length
  }

  function nextDueText(): string | undefined {
    void tick()
    const times = rows()
      .filter((row) => row.schedule.status !== "done")
      .map((row) => row.schedule.nextDueAt)
      .filter((at): at is number => at !== undefined)
    return times.length ? relativeTime(Math.min(...times), Date.now()) : undefined
  }

  return { refresh, view, nextDueText }
}
