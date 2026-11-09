import type { ScheduleInfo, ScheduleWhen, WhenDraft } from "../types"

/** Parse a duration like "90 seconds", "5 minutes", "2 hours", "3 days" into milliseconds. */
export function durationMs(text: string): number | null {
  const match = text.trim().match(/^([\d.]+)\s*(seconds?|minutes?|hours?|days?|secs?|mins?)$/i)
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isFinite(value)) return null
  const unit = match[2].toLowerCase()
  const size = unit.startsWith("d")
    ? 86_400_000
    : unit.startsWith("h")
      ? 3_600_000
      : unit.startsWith("m")
        ? 60_000
        : 1000
  return value * size
}

/** Human duration in Chinese: "90 分钟", "2 小时", "3 天". */
export function durationLabel(text: string): string {
  const ms = durationMs(text)
  if (ms === null) return text
  if (ms >= 86_400_000 && ms % 86_400_000 === 0) return `${ms / 86_400_000} 天`
  if (ms >= 3_600_000 && ms % 3_600_000 === 0) return `${ms / 3_600_000} 小时`
  if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000} 分钟`
  return `${ms / 1000} 秒`
}

/** Describe a when clause in plain Chinese, e.g. "工作日每天 18:00". */
export function describeWhen(when: ScheduleWhen): string {
  if (when.type === "in") return `${durationLabel(when.in)}后（一次性）`
  if (when.type === "at") return `${clockText(Date.parse(when.at))} 触发（一次性）`
  if (when.type === "every") return `每 ${durationLabel(when.every)}`
  return describeCron(when.cron)
}

/** Human description of a 5-field cron expression; falls back to the raw text. */
export function describeCron(expr: string): string {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return expr
  const [min, hour, dom, month, dow] = fields

  const timeText = (h: string, m: string): string | null => {
    if (h === "*" || m === "*") return null
    const hh = Number(h)
    const mm = Number(m)
    if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`
  }

  const dowNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
  const dowText = (): string | null => {
    if (dow === "*") return null
    if (dow === "1-5" || dow === "1,2,3,4,5") return "工作日"
    if (dow === "0,6" || dow === "6,0") return "周末"
    const parts = dow.split(",").map((part) => {
      if (part.includes("-")) return null
      const day = Number(part)
      return Number.isInteger(day) && day >= 0 && day <= 7 ? dowNames[day % 7] : null
    })
    if (parts.some((part) => part === null)) return null
    return parts.join("、")
  }

  const dailyTime = timeText(hour, min)
  if (dailyTime) {
    const day = dowText()
    if (day) return `${day} ${dailyTime}`
    if (dom === "*" && month === "*") return `每天 ${dailyTime}`
    if (month === "*") return `每月 ${dom} 日 ${dailyTime}`
  }
  if (hour === "*" && min !== "*" && dom === "*" && month === "*" && dow === "*") {
    if (/^\*\/\d+$/.test(min)) return `每 ${min.slice(2)} 分钟`
    return `每小时第 ${min} 分`
  }
  if (min === "0" && hour.startsWith("*/") && dom === "*" && month === "*" && dow === "*") {
    return `每 ${hour.slice(2)} 小时`
  }
  if (hour === "*" && min.startsWith("*/") && dom === "*" && month === "*" && dow === "*") {
    return `每 ${min.slice(2)} 分钟`
  }
  return expr
}

const UNITS: Array<[string, number]> = [
  ["天", 86_400_000],
  ["小时", 3_600_000],
  ["分钟", 60_000],
]

/** Compact relative time: "3天2小时后", "5分钟前", "刚刚". */
export function relativeTime(at: number | undefined, now: number): string {
  if (at === undefined) return "—"
  const diff = at - now
  const abs = Math.abs(diff)
  if (abs < 60_000) return diff > 0 ? "1 分钟内" : "刚刚"
  const parts: string[] = []
  let rest = abs
  for (const [label, size] of UNITS) {
    if (rest >= size) {
      const value = Math.floor(rest / size)
      parts.push(`${value} ${label}`)
      rest -= value * size
      if (parts.length === 2) break
    }
  }
  const text = parts.join(" ") || "<1 秒"
  return diff > 0 ? `${text}后` : `${text}前`
}

/** Local "MM-DD HH:mm" for a timestamp. */
export function clockText(at: number | undefined): string {
  if (at === undefined) return "—"
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Outcome badge text and tone. */
export function outcomeLabel(outcome: string | undefined): { text: string; tone: "ok" | "warn" | "bad" } | null {
  if (!outcome) return null
  if (outcome === "fired") return { text: "已触发", tone: "ok" }
  if (outcome === "late") return { text: "延迟触发", tone: "warn" }
  if (outcome === "failed") return { text: "触发失败", tone: "bad" }
  if (outcome === "expired") return { text: "已过期", tone: "warn" }
  if (outcome === "skipped") return { text: "已跳过", tone: "warn" }
  if (outcome === "checked") return { text: "条件未满足", tone: "warn" }
  return { text: outcome, tone: "warn" }
}

const CRON_FIELD_RANGES: Array<[number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
]

function parseCronField(field: string, low: number, high: number): boolean {
  for (const part of field.split(",")) {
    const step = part.split("/")
    const range = step[0]
    if (step.length > 2) return false
    if (step.length === 2) {
      const interval = Number(step[1])
      if (!Number.isInteger(interval) || interval <= 0) return false
    }
    if (range === "*") continue
    const bounds = range.split("-")
    if (bounds.length > 2) return false
    for (const bound of bounds) {
      const value = Number(bound)
      if (!Number.isInteger(value) || value < low || value > high) return false
    }
  }
  return true
}

/** True when the text looks like a valid 5-field cron expression. */
export function isValidCron(expr: string): boolean {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return false
  return fields.every((field, index) => {
    const [low, high] = CRON_FIELD_RANGES[index]
    return field.length > 0 && parseCronField(field, low, high)
  })
}

function fieldMatches(field: string, value: number, high: number, dow = false): boolean {
  if (field === "*") return true
  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/")
    const step = stepPart === undefined ? 1 : Number(stepPart)
    let low: number
    let highBound: number
    if (rangePart === "*") {
      low = 0
      highBound = high
    } else {
      const bounds = rangePart.split("-")
      low = Number(bounds[0])
      highBound = bounds.length === 2 ? Number(bounds[1]) : stepPart !== undefined ? high : low
    }
    if (dow && highBound === 7 && low === 0) highBound = 7
    for (let candidate = low; candidate <= highBound; candidate += step) {
      // Sunday is 0 and 7 in the day-of-week field only.
      if (candidate === value || (dow && candidate === 7 && value === 0) || (dow && candidate === 0 && value === 7)) {
        return true
      }
    }
  }
  return false
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

/** Next fire times of a cron expression after `from` (local time), newest last. */
export function nextCronRuns(expr: string, from: number, count: number): number[] {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return []
  const [minField, hourField, domField, monthField, dowField] = fields
  const domRestricted = domField !== "*"
  const dowRestricted = dowField !== "*"

  const runs: number[] = []
  const cursor = new Date(from)
  cursor.setSeconds(0, 0)
  cursor.setMinutes(cursor.getMinutes() + 1)

  for (let guard = 0; guard < 366 * 24 * 60 && runs.length < count; guard += 1) {
    const year = cursor.getFullYear()
    const month = cursor.getMonth()
    if (!fieldMatches(monthField, month + 1, 12)) {
      cursor.setMonth(month + 1, 1)
      cursor.setHours(0, 0, 0, 0)
      continue
    }
    const dayOk =
      fieldMatches(domField, cursor.getDate(), daysInMonth(year, month)) &&
      fieldMatches(dowField, cursor.getDay(), 7, true)
    // Standard cron ORs the two day fields when either is restricted.
    const dayCombined = domRestricted && dowRestricted
      ? fieldMatches(domField, cursor.getDate(), daysInMonth(year, month)) ||
        fieldMatches(dowField, cursor.getDay(), 7, true)
      : dayOk
    if (!dayCombined) {
      cursor.setDate(cursor.getDate() + 1)
      cursor.setHours(0, 0, 0, 0)
      continue
    }
    if (!fieldMatches(hourField, cursor.getHours(), 23)) {
      cursor.setHours(cursor.getHours() + 1, 0, 0, 0)
      continue
    }
    if (!fieldMatches(minField, cursor.getMinutes(), 59)) {
      cursor.setMinutes(cursor.getMinutes() + 1, 0, 0)
      continue
    }
    runs.push(cursor.getTime())
    cursor.setMinutes(cursor.getMinutes() + 1, 0, 0)
  }
  return runs
}

/** Convert a form draft into the API's when shape. */
export function draftToWhen(draft: WhenDraft): ScheduleWhen {
  if (draft.kind === "in") return { type: "in", in: draft.in }
  if (draft.kind === "at") return { type: "at", at: draft.at, ...(draft.tz ? { tz: draft.tz } : {}) }
  if (draft.kind === "every") return { type: "every", every: draft.every, ...(draft.tz ? { tz: draft.tz } : {}) }
  return { type: "cron", cron: draft.cron, ...(draft.tz ? { tz: draft.tz } : {}) }
}

/** Preview timestamps for the preview strip of the create form. */
export function previewRuns(draft: WhenDraft, now: number, count = 5): number[] {
  if (draft.kind === "cron" && isValidCron(draft.cron)) return nextCronRuns(draft.cron, now, count)
  if (draft.kind === "in") {
    // The form stores "30 minutes"; accept unit-less numbers too.
    const minutes = Number.parseFloat(draft.in)
    return Number.isFinite(minutes) && minutes > 0 ? [now + minutes * 60_000] : []
  }
  if (draft.kind === "at") {
    const at = Date.parse(draft.at)
    return Number.isNaN(at) ? [] : [at]
  }
  if (draft.kind === "every") {
    const minutes = Number.parseFloat(draft.every)
    if (!Number.isFinite(minutes) || minutes <= 0) return []
    return Array.from({ length: count }, (_, index) => now + (index + 1) * minutes * 60_000)
  }
  return []
}

export function scheduleTitle(schedule: ScheduleInfo): string {
  return schedule.name?.trim() || schedule.action.prompt.slice(0, 32) || schedule.id
}
