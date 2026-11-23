import { createEffect, createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import type { Context } from "@opencode/plugin/gui"
import type { ModelProviderGroup, ScheduleRow, ScheduleWhen, SessionInfo, WhenDraft } from "../types"
import { actionArgsText, actionLabel, clockText, describeWhen, dirName, isValidCron, modelRefLabel, outcomeLabel, previewRuns, relativeTime, validateEndAt } from "./format"
import { Combobox, type ComboOption } from "./combobox"
import type { ScheduleStore } from "../store"

type IconName = "clock" | "calendar" | "repeat" | "terminal" | "sliders" | "check" | "chevron" | "spark" | "warn" | "search" | "link"
type EndKind = "none" | "after" | "at"

const WHEN_KINDS: Array<{ id: WhenDraft["kind"]; label: string; icon: IconName }> = [
  { id: "in", label: "延迟", icon: "clock" },
  { id: "at", label: "定时", icon: "calendar" },
  { id: "every", label: "间隔", icon: "repeat" },
  { id: "cron", label: "Cron", icon: "terminal" },
]

const END_KINDS: Array<{ id: EndKind; label: string }> = [
  { id: "none", label: "不限" },
  { id: "after", label: "时长" },
  { id: "at", label: "指定时间" },
]

const MINUTE_PRESETS = [
  { label: "5 分钟", value: "5" },
  { label: "15 分钟", value: "15" },
  { label: "30 分钟", value: "30" },
  { label: "1 小时", value: "60" },
  { label: "3 小时", value: "180" },
  { label: "1 天", value: "1440" },
]

const CRON_PRESETS = [
  { label: "每天 09:00", value: "0 9 * * *" },
  { label: "工作日 09:00", value: "0 9 * * 1-5" },
  { label: "每小时", value: "0 * * * *" },
  { label: "每 30 分钟", value: "*/30 * * * *" },
  { label: "每周一 09:00", value: "0 9 * * 1" },
]

/**
 * The plugin runs on the desktop's own server, so sessions it reads belong to
 * that server. `servers.list()[0]` is list order, not identity: find the
 * builtin ref first and only fall back to the first id when none is marked.
 */
function hostServerID(ctx: Context): string | undefined {
  try {
    const ids = ctx.servers.list()
    for (const id of ids) {
      if (ctx.servers.get(id)?.builtin) return id
    }
    return ids[0]
  } catch {
    return undefined
  }
}

/** One-tap times for the "at" mode; values are resolved when clicked. */
const AT_PRESETS: Array<{ label: string; at: () => string }> = [
  { label: "1 小时后", at: () => localInput(new Date(Date.now() + 60 * 60_000)) },
  {
    label: "明天 09:00",
    at: () => {
      const date = new Date()
      date.setDate(date.getDate() + 1)
      date.setHours(9, 0, 0, 0)
      return localInput(date)
    },
  },
  {
    label: "下周一 09:00",
    at: () => {
      const date = new Date()
      const days = (8 - date.getDay()) % 7 || 7
      date.setDate(date.getDate() + days)
      date.setHours(9, 0, 0, 0)
      return localInput(date)
    },
  },
]

export function Icon(props: { name: IconName }) {
  return (
    <svg
      class="sc-icon"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <Switch>
        <Match when={props.name === "clock"}>
          <circle cx="8" cy="8" r="5.8" />
          <path d="M8 4.7V8l2.1 1.4" />
        </Match>
        <Match when={props.name === "calendar"}>
          <rect x="2.4" y="3.4" width="11.2" height="10.2" rx="2" />
          <path d="M2.4 6.4h11.2M5.6 2v2.6M10.4 2v2.6" />
        </Match>
        <Match when={props.name === "repeat"}>
          <path d="M3.2 6.4a3 3 0 0 1 3-2.9h6" />
          <path d="M11 1.7l2 1.8-2 1.8" />
          <path d="M12.8 9.6a3 3 0 0 1-3 2.9h-6" />
          <path d="M5 14.3l-2-1.8 2-1.8" />
        </Match>
        <Match when={props.name === "terminal"}>
          <rect x="2" y="3.2" width="12" height="9.6" rx="2" />
          <path d="M4.6 6.4l1.9 1.7-1.9 1.7M8.4 9.8h3" />
        </Match>
        <Match when={props.name === "sliders"}>
          <path d="M2.6 5.2h10.8M2.6 10.8h10.8" />
          <circle cx="6" cy="5.2" r="1.5" />
          <circle cx="10" cy="10.8" r="1.5" />
        </Match>
        <Match when={props.name === "check"}>
          <path d="M3.4 8.4l3 3 6.2-6.8" />
        </Match>
        <Match when={props.name === "chevron"}>
          <path d="M6.2 3.8L10.4 8l-4.2 4.2" />
        </Match>
        <Match when={props.name === "spark"}>
          <path d="M7 2.4l1.3 2.9 2.9 1.2-2.9 1.2L7 10.6 5.7 7.7 2.8 6.5l2.9-1.2z" />
          <path d="M12.2 10.6l.6 1.3 1.3.5-1.3.5-.6 1.3-.6-1.3-1.3-.5 1.3-.5z" />
        </Match>
        <Match when={props.name === "warn"}>
          <path d="M8 2.6l6 10.8H2z" />
          <path d="M8 6.4v3.2" />
          <path d="M8 11.6h.01" />
        </Match>
        <Match when={props.name === "search"}>
          <circle cx="7.1" cy="7.1" r="4.4" />
          <path d="M10.4 10.4L13.6 13.6" />
        </Match>
        <Match when={props.name === "link"}>
          <path d="M6.4 9.6a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-.7.7" />
          <path d="M9.6 6.4a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l.7-.7" />
        </Match>
      </Switch>
    </svg>
  )
}

export function ScheduleForm(props: {
  ctx: Context
  store: ScheduleStore
  onDirtyChange?: (dirty: boolean) => void
  onCreated: () => void
  onCancel: () => void
}) {
  const [providers, setProviders] = createSignal<ModelProviderGroup[]>([])
  const [providerID, setProviderID] = createSignal("")
  const [modelKey, setModelKey] = createSignal("")
  const [variant, setVariant] = createSignal("")
  const [modelHint, setModelHint] = createSignal("")
  const [agents, setAgents] = createSignal<Array<{ id: string; name: string; description?: string }>>([])
  // Selected value is the stable agent id (what the session API expects);
  // every UI label resolves it back to the human-friendly display name.
  const [agent, setAgent] = createSignal("")
  const agentLabel = () => agents().find((item) => item.id === agent())?.name ?? agent()
  const [directories, setDirectories] = createSignal<string[]>([])
  const [directory, setDirectory] = createSignal("")
  const [customDir, setCustomDir] = createSignal(false)
  const [name, setName] = createSignal("")
  // Whether the current name was auto-filled from a bound session. When the
  // user edits the name by hand this clears, so "改回新建" never wipes input
  // the user actually typed.
  const [nameFromSession, setNameFromSession] = createSignal(false)
  // Session source: empty = create a dedicated mount session (default);
  // non-empty sessionID = bind the prompt to an existing session the user owns.
  const [bindSession, setBindSession] = createSignal("")
  const [bindSessions, setBindSessions] = createSignal<SessionInfo[]>([])
  // The chosen session is kept separately: a later search page may not contain
  // it, but its title must stay visible and the selection must stay stable.
  const [bindSelected, setBindSelected] = createSignal<SessionInfo | undefined>(undefined)
  const [bindCursor, setBindCursor] = createSignal<string | undefined>(undefined)
  const [bindLoading, setBindLoading] = createSignal(false)
  const [bindQuery, setBindQuery] = createSignal("")
  const [bindError, setBindError] = createSignal("")
  const [bindPickerOpen, setBindPickerOpen] = createSignal(false)
  let bindRequest = 0
  let bindTimer: ReturnType<typeof setTimeout> | undefined
  const [inMinutes, setInMinutes] = createSignal("30")
  // 记住打开表单时的默认值；dirty 不能拿“此刻 + 1 小时”当基线，否则时间流逝本身会把表单变脏。
  const initialAt = defaultAt()
  const [atTime, setAtTime] = createSignal(initialAt)
  const [everyMinutes, setEveryMinutes] = createSignal("60")
  const [cron, setCron] = createSignal("0 9 * * 1-5")
  // End condition: default is "none" (no ends payload). Only one of
  // after/at is ever sent — the two official time-end shapes stay mutually
  // exclusive in the UI so no ambiguous combination reaches the server.
  const [endKind, setEndKind] = createSignal<EndKind>("none")
  const [endAfter, setEndAfter] = createSignal("")
  const initialEndAt = defaultAt()
  const [endAt, setEndAt] = createSignal(initialEndAt)
  const [endAtEdited, setEndAtEdited] = createSignal(false)
  const [prompt, setPrompt] = createSignal("")
  // Advanced options start collapsed; the trigger/timing choices are the
  // primary path. Signals below live in this scope, so expanding/collapsing
  // never resets a Provider/Model/Variant/Agent/directory pick.
  const [advanced, setAdvanced] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")

  onMount(async () => {
    const [catalog, agentList, directoryList] = await Promise.allSettled([
      props.store.modelCatalog(),
      props.store.primaryAgents(),
      props.store.recentDirectories(),
    ])
    if (catalog.status === "fulfilled") setProviders(catalog.value)
    else setModelHint("模型列表加载失败，将使用会话默认模型")
    if (agentList.status === "fulfilled") setAgents(agentList.value)
    if (directoryList.status === "fulfilled") setDirectories(directoryList.value)
  })
  onCleanup(() => {
    if (bindTimer) clearTimeout(bindTimer)
  })

  const bound = () => bindSession() !== ""
  const selectedBindSession = createMemo(() => {
    const id = bindSession()
    if (!id) return undefined
    return (
      bindSessions().find((session) => session.id === id) ??
      (bindSelected()?.id === id ? bindSelected() : undefined)
    )
  })
  const bindSessionOptions = createMemo<ComboOption[]>(() => {
    const selected = selectedBindSession()
    const sessions = bindSessions()
    // Keep the chosen session visible even when the current search page does
    // not include it.
    const visible =
      selected && !sessions.some((session) => session.id === selected.id)
        ? [selected, ...sessions]
        : sessions
    return [
      { value: "", label: "新建专用会话", note: "默认 · 自动创建承载会话" },
      ...visible.map((session) => ({
        value: session.id,
        label: session.title?.trim() || session.id,
        note: session.directory ? dirName(session.directory) : undefined,
        keywords: session.id,
      })),
    ]
  })

  async function loadBindSessions(reset: boolean, query: string): Promise<void> {
    const seq = ++bindRequest
    setBindLoading(true)
    setBindError("")
    try {
      const page = await props.store.sessionsPage({
        limit: 50,
        search: query,
        ...(!reset && bindCursor() ? { cursor: bindCursor() } : {}),
      })
      if (seq !== bindRequest) return
      setBindSessions((current) => {
        if (reset) return page.sessions
        const seen = new Set(current.map((session) => session.id))
        return [...current, ...page.sessions.filter((session) => !seen.has(session.id))]
      })
      setBindCursor(page.next)
    } catch (cause) {
      if (seq !== bindRequest) return
      setBindError(cause instanceof Error ? cause.message : String(cause))
      if (reset) setBindSessions([])
      setBindCursor(undefined)
    } finally {
      if (seq === bindRequest) setBindLoading(false)
    }
  }

  function openBindPicker(): void {
    if (bindPickerOpen()) {
      if (bindTimer) {
        clearTimeout(bindTimer)
        bindTimer = undefined
      }
      setBindPickerOpen(false)
      return
    }
    setBindPickerOpen(true)
    setBindQuery("")
    setBindCursor(undefined)
    void loadBindSessions(true, "")
  }

  function changeBindQuery(value: string): void {
    setBindQuery(value)
    // The old cursor belongs to the previous query; loading more before the
    // debounced search lands would append unrelated sessions.
    setBindCursor(undefined)
    if (bindTimer) clearTimeout(bindTimer)
    bindTimer = setTimeout(() => {
      bindTimer = undefined
      void loadBindSessions(true, value)
    }, 250)
  }

  function loadMoreBindSessions(): void {
    if (bindLoading() || !bindCursor()) return
    void loadBindSessions(false, bindQuery())
  }

  const providerOptions = createMemo<ComboOption[]>(() => [
    { value: "", label: "跟随会话", note: "默认模型，不指定" },
    ...providers().map((provider) => ({
      value: provider.id,
      label: provider.name,
      note: provider.id === provider.name ? undefined : provider.id,
      keywords: `${provider.id} ${provider.models.map((model) => model.name).join(" ")}`,
    })),
  ])

  const currentProvider = createMemo(() => providers().find((provider) => provider.id === providerID()))
  const modelOptions = createMemo<ComboOption[]>(() =>
    (currentProvider()?.models ?? []).map((model) => ({
      value: model.key,
      label: model.name,
      note: model.id === model.name ? model.modelID : model.id,
      badge: model.status === "active" ? undefined : model.status,
      keywords: `${model.modelID} ${model.id}`,
    })),
  )
  const selectedModel = createMemo(() => currentProvider()?.models.find((model) => model.key === modelKey()))
  const variants = createMemo(() => selectedModel()?.variants ?? [])

  function selectProvider(value: string) {
    setProviderID(value)
    setModelKey("")
    setVariant("")
  }

  function selectModel(value: string) {
    setModelKey(value)
    const next = currentProvider()?.models.find((model) => model.key === value)
    if (!next || !next.variants.includes(variant())) setVariant("")
  }

  const [kind, setKind] = useStateKind()
  // 延迟/定时是一次性任务，执行一次后自动完成——没有"何时停止"可配置。
  // 间隔/Cron 才可能重复运行，才需要把结束条件映射成官方 expires。
  const isRepeating = () => kind() === "every" || kind() === "cron"
  // Switching modes never discards the end-condition draft: hiding it for a
  // one-shot task is purely visual, and switching back to a repeating mode
  // restores the previously picked kind/values. buildEnds() is what guarantees
  // a one-shot task never sends an expires payload.
  const chooseKind = (next: WhenDraft["kind"]) => setKind(next)
  const draft = createMemo<WhenDraft | null>(() => {
    // The form never sends `tz`: the official API defaults to the host's
    // configured zone. Keeping the field out avoids pinning a task to a zone
    // chosen at creation time (see demo v6).
    if (kind() === "in") {
      const value = Number(inMinutes())
      if (!(Number.isFinite(value) && value > 0)) return null
      return { kind: "in", in: `${value} minutes` }
    }
    if (kind() === "at") {
      const at = Date.parse(atTime())
      // A past time would fire immediately or never; require a future instant.
      if (Number.isNaN(at) || at <= Date.now()) return null
      return { kind: "at", at: atTime() }
    }
    if (kind() === "every") {
      const value = Number(everyMinutes())
      if (!(Number.isFinite(value) && value > 0)) return null
      return { kind: "every", every: `${value} minutes` }
    }
    // Format validity is a hint, not a gate: the server is the final judge of
    // a cron expression. Only an empty expression blocks submission.
    if (kind() === "cron") {
      const text = cron().trim()
      return text ? { kind: "cron", cron: text } : null
    }
    return null
  })

  // The preview card ticks: countdowns stay honest while the form sits open.
  // 这组时钟必须先于 previews 声明：createMemo 会立即执行一次，晚声明会命中 TDZ。
  const [tick, setTick] = createSignal(0)
  onMount(() => {
    const clock = setInterval(() => setTick((value) => value + 1), 1000)
    onCleanup(() => clearInterval(clock))
  })
  const now = () => {
    void tick()
    return Date.now()
  }

  // The preview recomputes against the ticking clock, so "延迟 30 分钟" 的预计
  // 绝对时间随表单停留时间前移，而不是停留在打开表单那一刻。
  const previews = createMemo(() => {
    void tick()
    return draft() ? previewRuns(draft()!, now(), 5) : []
  })
  const previewRunsLive = previews

  // Synchronous guard: signal batching must never open a window for a second
  // submit. The store also coalesces duplicate creates as a second line of defense.
  let submitting = false
  const submit = async () => {
    if (!draft() || !canSubmit() || submitting) return
    submitting = true
    setBusy(true)
    setError("")
    try {
      const selected = selectedModel()
      const dir = directory().trim()
      const ends = buildEnds()
      // Bound mode reuses the chosen session as-is: model/agent/directory
      // belong to that session, so they are deliberately NOT sent (sending
      // them would either reconfigure the user's session or conflict with it).
      await props.store.createSchedule({
        sessionID: "",
        ...(bound() ? { bindSessionID: bindSession() } : {}),
        name: name().trim() || undefined,
        when: draft()!,
        prompt: prompt().trim(),
        ...(ends ? { ends } : {}),
        ...(!bound() && selected
          ? {
              model: {
                id: selected.id,
                providerID: selected.providerID,
                ...(variant() ? { variant: variant() } : {}),
              },
            }
          : {}),
        ...(!bound() && agent() ? { agent: agent() } : {}),
        ...(!bound() && dir ? { directory: dir } : {}),
      })
      props.onCreated()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      submitting = false
      setBusy(false)
    }
  }

  /**
   * Build the time-only `ends` draft from the mutually-exclusive end kind.
   * The store maps it to the official `expires`; the server computes endsAt.
   */
  function buildEnds(): { after?: string; at?: string } | undefined {
    // One-shot tasks finish on their own; an ends payload would be meaningless
    // (and could schedule a second stop the user never configured).
    if (!isRepeating()) return undefined
    if (endKind() === "after") {
      const value = minutesExpression(endAfter())
      return value ? { after: value } : undefined
    }
    if (endKind() === "at") {
      const at = Date.parse(endAt())
      return Number.isNaN(at) ? undefined : { at: endAt() }
    }
    return undefined
  }

  /** Accept a plain minute count ("120") or an official duration string ("2 hours"). */
  function minutesExpression(value: string): string | undefined {
    const text = value.trim()
    if (!text) return undefined
    if (/^\d+$/.test(text)) return Number(text) > 0 ? `${Number(text)} minutes` : undefined
    return /^\d+(\.\d+)?\s*(seconds?|minutes?|hours?|days?|secs?|mins?)$/i.test(text) ? text : undefined
  }

  /** Step a minute field with adaptive increments (1 below 60, 15 up to 240, 60 beyond). */
  function stepMinutes(value: () => string, set: (value: string) => void, delta: number) {
    const current = Number(value())
    const base = Number.isFinite(current) && current > 0 ? current : delta > 0 ? 0 : 2
    const stepSize = base >= 240 ? 60 : base >= 60 ? 15 : 1
    set(String(Math.max(1, base + delta * stepSize)))
  }

  const invalidCron = () => kind() === "cron" && cron().trim().length > 0 && !isValidCron(cron())
  const invalidIn = () => kind() === "in" && !(Number(inMinutes()) > 0)
  const invalidEvery = () => kind() === "every" && !(Number(everyMinutes()) > 0)
  const invalidEndAfter = () => {
    if (!isRepeating() || endKind() !== "after") return false
    return minutesExpression(endAfter()) === undefined
  }
  /**
   * The one-hour default end time can be before the first run (e.g. a 60-minute
   * interval or tomorrow's cron), which would make the form invalid the moment
   * "指定时间" is selected. Until the user edits the field, move it to a day
   * after the first predicted run.
   */
  function chooseEndKind(next: EndKind): void {
    setEndKind(next)
    if (next !== "at" || endAtEdited()) return
    const first = previewRunsLive()[0]
    const base = first !== undefined ? first + 86_400_000 : Date.now() + 86_400_000
    setEndAt(localInput(new Date(Math.max(Date.now() + 3_600_000, base))))
  }
  const invalidEndAt = () => {
    if (!isRepeating() || endKind() !== "at") return false
    return validateEndAt(endAt(), now(), previewRunsLive()[0]) !== null
  }
  const endAtHint = () => {
    if (!isRepeating() || endKind() !== "at") return ""
    return validateEndAt(endAt(), now(), previewRunsLive()[0]) ?? ""
  }
  // 绝对时间必须晚于当前时刻；否则到点即触发或永远不触发。
  const invalidAt = () => {
    if (kind() !== "at") return false
    const at = Date.parse(atTime())
    return Number.isNaN(at) || at <= Date.now()
  }
  // 错误值必须阻止提交，不允许被静默省略成“不限”。
  // Cron 本地校验只作提示，不作门禁——创建是否成功以官方响应为准。
  const canSubmit = () =>
    !busy() &&
    draft() !== null &&
    prompt().trim().length > 0 &&
    !invalidEndAfter() &&
    !invalidEndAt() &&
    !invalidAt()

  // Footer summary: the schedule that is about to be created, in words.
  const draftWhen = createMemo<ScheduleWhen | null>(() => {
    const value = draft()
    if (!value) return null
    if (value.kind === "in") return { type: "in", in: value.in }
    if (value.kind === "at") return { type: "at", at: value.at }
    if (value.kind === "every") return { type: "every", every: value.every }
    return { type: "cron", cron: value.cron }
  })
  // Collapsed advanced row reflects the current picks instead of static text.
  const advancedSummary = () => {
    const parts: string[] = []
    if (selectedModel()) {
      // 变体跟着模型显示在摘要里，折叠高级选项时也不会看漏。
      const variantPart = variant() ? ` · ${variant()}` : ""
      parts.push(`${selectedModel()!.name}${variantPart}`)
    } else if (providerID()) {
      parts.push(`${currentProvider()?.name ?? providerID()} · 未选模型`)
    }
    if (agent()) parts.push(agentLabel())
    const dir = directory().trim()
    if (dir) parts.push(dir)
    return parts.length > 0 ? parts.join(" · ") : "模型 · Agent · 执行目录"
  }

  const statusText = () => {
    if (draftWhen() === null) return "触发时间无效，请检查设置"
    const first = previewRunsLive()[0]
    // 创建后会自动开一个承载会话；绑定模式则复用所选会话，提示要说清归属。
    const sessionNote = bound()
      ? `将绑定到会话「${selectedBindSession()?.title?.trim() || bindSession()}」`
      : "创建后将自动新建一个会话作为任务载体"
    if (prompt().trim().length === 0) return `填写提示词后即可创建 · ${sessionNote}`
    // Local preview is an estimate, never the official nextDueAt.
    if (!first) return `即将创建 · ${sessionNote}`
    return `预计 ${clockText(first)} 首次触发（${relativeTime(first, now())}，仅供参考） · ${sessionNote}`
  }

  // Report progress so the page can confirm before discarding a half-written form.
  // Compare every editable field, not just the first three: 只改时间或目录也
  // 是用户的输入，离开前必须给出确认机会。
  const dirty = createMemo(
    () =>
      prompt().trim().length > 0 ||
      name().trim().length > 0 ||
      bindSession() !== "" ||
      providerID() !== "" ||
      modelKey() !== "" ||
      variant() !== "" ||
      agent() !== "" ||
      directory().trim() !== "" ||
      inMinutes() !== "30" ||
      atTime() !== initialAt ||
      everyMinutes() !== "60" ||
      cron() !== "0 9 * * 1-5" ||
      endKind() !== "none" ||
      endAfter().trim() !== "" ||
      endAt() !== initialEndAt,
  )
  createEffect(() => props.onDirtyChange?.(dirty()))

  return (
    <div
      class="sc-form"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canSubmit()) {
          event.preventDefault()
          void submit()
        }
        // Escape outside a combobox: close an open advanced panel, else leave the form.
        if (event.key === "Escape" && !event.defaultPrevented) {
          if (advanced()) {
            event.preventDefault()
            setAdvanced(false)
          } else {
            props.onCancel()
          }
        }
      }}
    >
      <div class="sc-form-body">
        <div class="sc-form-columns">
          <section class="sc-section sc-content-section">
            <div class="sc-section-head">
              <span class="sc-mark" />
              <h3 class="sc-section-title">任务内容</h3>
              <span class="sc-section-note">名称与执行提示词</span>
            </div>

            <div class="sc-field">
              <label class="sc-label" for="sc-name">
                任务名称 <span class="sc-label-note">选填 · 点右侧图标可选择已有会话</span>
              </label>
              <div class="sc-name-row">
                <input
                  id="sc-name"
                  class="sc-input sc-name-input"
                  placeholder={bound() ? "已填入会话名称，可修改" : "例如：每日依赖检查"}
                  value={name()}
                  onInput={(event) => {
                    setName(event.currentTarget.value)
                    setNameFromSession(false)
                  }}
                />
                <button
                  type="button"
                  class="sc-session-search"
                  classList={{ active: bound() || bindPickerOpen() }}
                  title="绑定到已有会话"
                  aria-label="绑定到已有会话"
                  aria-expanded={bindPickerOpen()}
                  onClick={openBindPicker}
                >
                  <Icon name={bound() ? "link" : "search"} />
                </button>
              </div>
              <div class="sc-session-source">
                <span class="sc-session-source-label">
                  {bound() ? "运行会话" : "运行会话 · 新建专用"}
                </span>
                <span class="sc-session-source-value">
                  {bound() ? selectedBindSession()?.title?.trim() || bindSession() : "任务触发时自动打开独立会话"}
                </span>
                <Show when={bound()}>
                  <button
                    type="button"
                    class="sc-link-button"
                    onClick={() => {
                      // Only clear a name that WE filled from the session; keep
                      // anything the user typed after binding.
                      if (nameFromSession()) setName("")
                      setNameFromSession(false)
                      setBindSession("")
                      setBindSelected(undefined)
                      setBindPickerOpen(false)
                    }}
                  >
                    改回新建
                  </button>
                </Show>
              </div>
              <Show when={bindPickerOpen()}>
                <div class="sc-session-picker">
                  <Combobox
                    id="sc-bind-session"
                    value={bindSession()}
                    options={bindSessionOptions()}
                    placeholder="搜索会话标题或 ID"
                    emptyText={bindLoading() ? "正在搜索…" : "没有匹配的会话"}
                    autoOpen
                    remote
                    loading={bindLoading()}
                    hasMore={Boolean(bindCursor())}
                    onQueryChange={changeBindQuery}
                    onLoadMore={loadMoreBindSessions}
                    onSelect={(value) => {
                      if (bindTimer) {
                        clearTimeout(bindTimer)
                        bindTimer = undefined
                      }
                      // The chosen row may be the preserved selection rather
                      // than an item in the current search page.
                      const chosen = value
                        ? bindSessions().find((session) => session.id === value) ??
                          (bindSelected()?.id === value ? bindSelected() : undefined)
                        : undefined
                      setBindSelected(chosen)
                      setBindSession(value)
                      setBindPickerOpen(false)
                      // Fill the visible name box with the chosen session's
                      // title so the selection is obvious. Only overwrite a
                      // name that is empty or was itself filled from a session;
                      // never clobber a name the user typed by hand.
                      const title = chosen?.title?.trim()
                      if (title && (!name().trim() || nameFromSession())) {
                        setName(title)
                        setNameFromSession(true)
                      }
                    }}
                  />
                  <Show when={bindError()}>
                    <p class="sc-hint sc-hint-bad">会话列表加载失败：{bindError()}</p>
                  </Show>
                </div>
              </Show>
            </div>

            <div class="sc-field sc-prompt-field">
              <label class="sc-label" for="sc-prompt">
                执行提示词 <span class="sc-required">*</span>
              </label>
              <textarea
                id="sc-prompt"
                class="sc-input sc-textarea"
                rows="6"
                placeholder="描述希望 OpenCode 定时执行的工作内容……

例如：
请检查当前项目的代码变更，整理今天的开发进展，并列出需要关注的问题。"
                value={prompt()}
                onInput={(event) => setPrompt(event.currentTarget.value)}
              />
              <div class="sc-prompt-meta">
                <span>任务触发后，将以此提示词启动执行</span>
                <span class="sc-counter">{prompt().trim().length > 0 ? `${prompt().trim().length} 字` : "必填"}</span>
              </div>
            </div>
          </section>

          <section class="sc-section sc-trigger-section">
            <div class="sc-section-head">
              <span class="sc-mark" />
              <h3 class="sc-section-title">触发配置</h3>
              <span class="sc-section-note">何时执行，何时停止</span>
            </div>

            <div class="sc-kind" role="tablist" aria-label="触发方式">
              <For each={WHEN_KINDS}>
                {(option) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={kind() === option.id}
                    class="sc-kind-item"
                    classList={{ active: kind() === option.id }}
                    onClick={() => chooseKind(option.id)}
                  >
                    <Icon name={option.icon} />
                    <span>{option.label}</span>
                  </button>
                )}
              </For>
            </div>

            {/* All four modes stay in one grid cell; only the active one is
                visible. Each mode uses the same three-row structure (field,
                aside, presets), so the slot height is stable across tabs
                without reserving a tall blank area. */}
            <div class="sc-trigger-slot">
              <div class="sc-mode" classList={{ "sc-mode-hidden": kind() !== "in" }} aria-hidden={kind() !== "in"}>
                <div class="sc-field sc-mode-field">
                  <label class="sc-label" for="sc-in">延迟时间</label>
                  <div class="sc-duration-row">
                    <div class="sc-duration">
                      <input
                        id="sc-in" class="sc-input" type="number" min="1"
                        aria-label="延迟分钟数" value={inMinutes()}
                        onInput={(event) => setInMinutes(event.currentTarget.value)}
                      />
                      <span class="sc-unit">分钟</span>
                      <div class="sc-scrollers">
                        <button type="button" tabIndex={-1} aria-label="减少" onClick={() => stepMinutes(inMinutes, setInMinutes, -1)}>−</button>
                        <button type="button" tabIndex={-1} aria-label="增加" onClick={() => stepMinutes(inMinutes, setInMinutes, 1)}>+</button>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="sc-mode-aside">
                  <div class="sc-mode-desc">一次性执行 · 从创建任务后开始倒计时</div>
                  <p class="sc-mode-hint sc-hint sc-hint-bad" classList={{ "sc-hint-off": !invalidIn() }}>请输入大于 0 的分钟数</p>
                </div>
                <div class="sc-presets">
                  <For each={MINUTE_PRESETS}>
                    {(preset) => (
                      <button type="button" class="sc-chip" classList={{ active: inMinutes() === preset.value }} onClick={() => setInMinutes(preset.value)}>
                        {preset.label}
                      </button>
                    )}
                  </For>
                </div>
              </div>

              <div class="sc-mode" classList={{ "sc-mode-hidden": kind() !== "at" }} aria-hidden={kind() !== "at"}>
                <div class="sc-field sc-mode-field">
                  <label class="sc-label" for="sc-at">执行时间</label>
                  <input
                    id="sc-at" class="sc-input sc-datetime" type="datetime-local"
                    aria-label="触发时间" value={atTime()}
                    onInput={(event) => setAtTime(event.currentTarget.value)}
                  />
                </div>
                <div class="sc-mode-aside">
                  <div class="sc-mode-desc">一次性执行 · 在指定日期和时间执行</div>
                  <p class="sc-mode-hint sc-hint sc-hint-bad" classList={{ "sc-hint-off": !invalidAt() }}>请选择晚于当前时间的时间点</p>
                </div>
                <div class="sc-presets">
                  <For each={AT_PRESETS}>
                    {(preset) => (
                      <button type="button" class="sc-chip" onClick={() => setAtTime(preset.at())}>{preset.label}</button>
                    )}
                  </For>
                </div>
              </div>

              <div class="sc-mode" classList={{ "sc-mode-hidden": kind() !== "every" }} aria-hidden={kind() !== "every"}>
                <div class="sc-field sc-mode-field">
                  <label class="sc-label" for="sc-every">执行间隔</label>
                  <div class="sc-duration-row">
                    <div class="sc-duration">
                      <input
                        id="sc-every" class="sc-input" type="number" min="1"
                        aria-label="间隔分钟数" value={everyMinutes()}
                        onInput={(event) => setEveryMinutes(event.currentTarget.value)}
                      />
                      <span class="sc-unit">分钟</span>
                      <div class="sc-scrollers">
                        <button type="button" tabIndex={-1} aria-label="减少" onClick={() => stepMinutes(everyMinutes, setEveryMinutes, -1)}>−</button>
                        <button type="button" tabIndex={-1} aria-label="增加" onClick={() => stepMinutes(everyMinutes, setEveryMinutes, 1)}>+</button>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="sc-mode-aside">
                  <div class="sc-mode-desc">重复执行 · 按固定时间间隔运行</div>
                  <p class="sc-mode-hint sc-hint sc-hint-bad" classList={{ "sc-hint-off": !invalidEvery() }}>请输入大于 0 的分钟数</p>
                </div>
                <div class="sc-presets">
                  <For each={MINUTE_PRESETS}>
                    {(preset) => (
                      <button type="button" class="sc-chip" classList={{ active: everyMinutes() === preset.value }} onClick={() => setEveryMinutes(preset.value)}>
                        {preset.label}
                      </button>
                    )}
                  </For>
                </div>
              </div>

              <div class="sc-mode" classList={{ "sc-mode-hidden": kind() !== "cron" }} aria-hidden={kind() !== "cron"}>
                <div class="sc-field sc-mode-field">
                  <label class="sc-label" for="sc-cron">Cron 表达式</label>
                  <input
                    id="sc-cron" class="sc-input sc-mono" placeholder="0 9 * * 1-5"
                    aria-label="Cron 表达式" value={cron()}
                    onInput={(event) => setCron(event.currentTarget.value)}
                  />
                </div>
                <div class="sc-mode-aside">
                  <div class="sc-mode-desc">重复执行 · 使用 Cron 表达式定义计划</div>
                  <p class="sc-mode-hint sc-hint" classList={{ "sc-hint-warn": invalidCron() }}>
                    {invalidCron() ? "本地预览无法解析，仍可提交（以官方校验为准）" : "示例：0 9 * * 1-5 · 工作日 09:00"}
                  </p>
                </div>
                <div class="sc-presets">
                  <For each={CRON_PRESETS}>
                    {(preset) => (
                      <button type="button" class="sc-chip" classList={{ active: cron().trim() === preset.value }} onClick={() => setCron(preset.value)}>
                        {preset.label}
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </div>

            <div class="sc-preview">
              <span>预计触发</span>
              <Show when={previewRunsLive().length > 0} fallback={<strong class="sc-preview-invalid">触发时间无效</strong>}>
                <strong title={previewRunsLive().slice(0, 5).map((at) => clockText(at)).join("、")}>
                  {clockText(previewRunsLive()[0])}（{relativeTime(previewRunsLive()[0], now())}）
                </strong>
              </Show>
            </div>

            <div class="sc-end">
              <div class="sc-end-head">
                <span class="sc-label">结束条件</span>
                <span class="sc-label-note">{isRepeating() ? "可选 · 默认不限" : "一次性任务"}</span>
              </div>
              <Show
                when={isRepeating()}
                fallback={
                  <p class="sc-onetime-note">
                    <Icon name="check" /> 一次性任务，执行一次后自动完成，无需设置结束条件
                  </p>
                }
              >
                <div class="sc-end-kinds" role="group" aria-label="结束条件">
                  <For each={END_KINDS}>
                    {(option) => (
                      <button
                        type="button" class="sc-chip" classList={{ active: endKind() === option.id }}
                        onClick={() => chooseEndKind(option.id)}
                      >
                        {option.label}
                      </button>
                    )}
                  </For>
                </div>
                <Show when={endKind() === "none"}>
                  <span class="sc-end-placeholder">任务持续运行，不设置结束时间</span>
                </Show>
                <Show when={endKind() === "after"}>
                  <div class="sc-limit">
                    <span>运行</span>
                    <input
                      id="sc-end-after" class="sc-input" type="text" placeholder="120 分钟 / 2 hours"
                      title="可填「120」分钟或官方时长如「2 hours」「3 days」"
                      aria-label="结束前运行时长" value={endAfter()}
                      onInput={(event) => setEndAfter(event.currentTarget.value)}
                    />
                    <span>后结束</span>
                  </div>
                  <p class="sc-mode-hint sc-hint sc-hint-bad" classList={{ "sc-hint-off": !invalidEndAfter() }}>请输入正整数分钟或合法时长</p>
                </Show>
                <Show when={endKind() === "at"}>
                  <div class="sc-limit">
                    <span>于</span>
                    <input
                      id="sc-end-at" class="sc-input sc-datetime" type="datetime-local"
                      aria-label="结束时间" value={endAt()}
                      onInput={(event) => {
                        setEndAtEdited(true)
                        setEndAt(event.currentTarget.value)
                      }}
                    />
                    <span>结束</span>
                  </div>
                  <p class="sc-mode-hint sc-hint sc-hint-bad" classList={{ "sc-hint-off": !invalidEndAt() }}>{endAtHint()}</p>
                </Show>
              </Show>
            </div>
          </section>
        </div>

        <section class="sc-section sc-advanced-section" classList={{ "sc-advanced-disabled": bound() }}>
          <div class="sc-advanced-wrap">
          <Show when={bound()}>
            <p class="sc-advanced-locked">已绑定已有会话，以下选项由该会话决定，此处不可修改。</p>
          </Show>
          <button
            type="button"
            class="sc-advanced-toggle"
            aria-expanded={advanced()}
            disabled={bound()}
            onClick={() => setAdvanced(!advanced())}
          >
            <span class="sc-advanced-icon">
              <Icon name="sliders" />
            </span>
            <span class="sc-advanced-text">
              <span class="sc-advanced-label">高级选项</span>
              <span class="sc-advanced-sub">{advancedSummary()}</span>
            </span>
            <span class="sc-advanced-chevron" classList={{ open: advanced() }}>
              <Icon name="chevron" />
            </span>
          </button>

          <Show when={advanced()}>
            <div class="sc-advanced">
              <div class="sc-model-grid">
                <div class="sc-field">
                  <div class="sc-label-row">
                    <label class="sc-label" for="sc-provider">Provider</label>
                    <span class="sc-label-note">{providerID() ? "已指定" : "跟随会话"}</span>
                  </div>
                  <Combobox
                    id="sc-provider"
                    value={providerID()}
                    options={providerOptions()}
                    placeholder="选择或搜索"
                    emptyText="没有匹配的 Provider"
                    disabled={bound()}
                    onSelect={selectProvider}
                  />
                </div>
                <div class="sc-field">
                  <div class="sc-label-row">
                    <label class="sc-label" for="sc-model">模型</label>
                    <span class="sc-label-note sc-model-note">
                      {selectedModel() ? `${selectedModel()!.providerID} / ${selectedModel()!.id}` : providerID() ? "请选择模型" : "先选 Provider"}
                    </span>
                  </div>
                  <Combobox
                    id="sc-model"
                    value={modelKey()}
                    options={modelOptions()}
                    disabled={bound() || !providerID()}
                    placeholder={providerID() ? "搜索模型" : "请先选择 Provider"}
                    emptyText="没有匹配的模型"
                    onSelect={selectModel}
                  />
                </div>
                <div class="sc-field">
                  <div class="sc-label-row">
                    <label class="sc-label" for="sc-variant">变体</label>
                    <span class="sc-label-note">
                      {!selectedModel() ? "先选模型" : variants().length === 0 ? "无变体" : "可选"}
                    </span>
                  </div>
                  <select
                    id="sc-variant"
                    class="sc-input"
                    value={variant()}
                    disabled={bound() || !selectedModel() || variants().length === 0}
                    onChange={(event) => setVariant(event.currentTarget.value)}
                  >
                    <option value="">默认</option>
                    <For each={variants()}>{(id) => <option value={id}>{id}</option>}</For>
                  </select>
                </div>
              </div>

              <div class="sc-advanced-bottom" classList={{ "sc-no-agent": agents().length === 0 }}>
                <Show when={agents().length > 0}>
                  <div class="sc-field">
                    <label class="sc-label" for="sc-agent">Agent</label>
                    <select
                      id="sc-agent"
                      class="sc-input"
                      value={agent()}
                      disabled={bound()}
                      onChange={(event) => setAgent(event.currentTarget.value)}
                    >
                      <option value="">跟随会话</option>
                      <For each={agents()}>
                        {(item) => <option value={item.id}>{item.name}</option>}
                      </For>
                    </select>
                  </div>
                </Show>

                <div class="sc-field">
                  <div class="sc-label-row">
                    <label class="sc-label" for="sc-directory">执行目录</label>
                    <button
                      type="button"
                      class="sc-link-button"
                      disabled={bound()}
                      onClick={() => {
                        if (customDir()) {
                          setCustomDir(false)
                          setDirectory("")
                        } else {
                          setCustomDir(true)
                        }
                      }}
                    >
                      {customDir() ? "返回选择" : "手动输入"}
                    </button>
                  </div>
                  <Show
                    when={customDir()}
                    fallback={
                      <select
                        id="sc-directory"
                        class="sc-input"
                        value={directory()}
                        disabled={bound()}
                        onChange={(event) => setDirectory(event.currentTarget.value)}
                      >
                        <option value="">当前项目目录</option>
                        <For each={directories()}>{(dir) => <option value={dir}>{dir}</option>}</For>
                      </select>
                    }
                  >
                    <input
                      id="sc-directory"
                      class="sc-input sc-mono"
                      placeholder="/absolute/path/to/project"
                      value={directory()}
                      disabled={bound()}
                      onInput={(event) => setDirectory(event.currentTarget.value)}
                    />
                  </Show>
                </div>
              </div>
              <Show when={modelHint()}>
                <p class="sc-hint sc-hint-bad">{modelHint()}</p>
              </Show>
            </div>

          </Show>
          </div>
        </section>

        <Show when={error()}><p class="sc-hint sc-hint-bad sc-form-error">{error()}</p></Show>
      </div>

      <div class="sc-form-actions">
        <div class="sc-form-status">
          <span class="sc-status-dot" classList={{ ready: canSubmit() }} />
          <span>{statusText()}</span>
        </div>
        <div class="sc-form-buttons">
          <button type="button" class="sc-btn" onClick={() => props.onCancel()}>取消</button>
          <button
            type="button" class="sc-btn sc-btn-primary" disabled={!canSubmit()}
            title="⌘ / Ctrl + Enter" onClick={() => void submit()}
          >
            {busy() ? "创建中…" : "创建任务"}
          </button>
        </div>
      </div>
    </div>
  )
}

function useStateKind() {
  return createSignal<WhenDraft["kind"]>("in")
}

function localInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function defaultAt(): string {
  return localInput(new Date(Date.now() + 60 * 60_000))
}

/** Compact chips for the advanced options a task was created with (model / agent / directory). */
export function ScheduleConfig(props: { session?: SessionInfo }) {
  const model = () => modelRefLabel(props.session?.model)
  const agent = () => props.session?.agent?.trim() ?? ""
  const directory = () => props.session?.location?.directory ?? props.session?.directory ?? ""
  return (
    <Show when={model() || agent() || directory()}>
      <div class="sc-config">
        <Show when={model()}>
          <span class="sc-config-chip" title={`模型 · ${model()}`}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="4" y="4" width="8" height="8" rx="1.5" />
              <path d="M6.5 1.8v2M9.5 1.8v2M6.5 12.2v2M9.5 12.2v2M1.8 6.5h2M1.8 9.5h2M12.2 6.5h2M12.2 9.5h2" />
            </svg>
            <span class="sc-config-text">{model()}</span>
          </span>
        </Show>
        <Show when={agent()}>
          <span class="sc-config-chip" title={`Agent · ${agent()}`}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="8" cy="5.2" r="2.6" />
              <path d="M2.8 13.6a5.2 5.2 0 0 1 10.4 0" />
            </svg>
            <span class="sc-config-text">{agent()}</span>
          </span>
        </Show>
        <Show when={directory()}>
          <span class="sc-config-chip" title={`执行目录 · ${directory()}`}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M2 4.2A1.2 1.2 0 0 1 3.2 3h3l1.4 1.6h5.2A1.2 1.2 0 0 1 14 5.8v6A1.2 1.2 0 0 1 12.8 13H3.2A1.2 1.2 0 0 1 2 11.8z" />
            </svg>
            <span class="sc-config-text">{dirName(directory())}</span>
          </span>
        </Show>
      </div>
    </Show>
  )
}

/** Write text to the clipboard, falling back to a hidden textarea when the
 *  async Clipboard API is unavailable (non-secure contexts). */
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    // fall through to the legacy path
  }
  const area = document.createElement("textarea")
  area.value = text
  area.setAttribute("readonly", "")
  area.style.position = "fixed"
  area.style.opacity = "0"
  document.body.appendChild(area)
  area.select()
  try {
    document.execCommand("copy")
  } finally {
    document.body.removeChild(area)
  }
}

/** One-click copy with a brief "copied" confirmation. */
function CopyButton(props: { text: string; label: string }) {
  const [copied, setCopied] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))
  const copy = (event: MouseEvent) => {
    event.stopPropagation()
    void copyText(props.text).then(() => {
      setCopied(true)
      clearTimeout(timer)
      timer = setTimeout(() => setCopied(false), 1200)
    })
  }
  return (
    <button
      type="button"
      class="sc-copy"
      classList={{ copied: copied() }}
      title={copied() ? "已复制" : `复制${props.label}`}
      aria-label={copied() ? "已复制" : `复制${props.label}`}
      onClick={copy}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Show
        when={copied()}
        fallback={
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="5.4" y="5.4" width="8" height="8" rx="1.5" />
            <path d="M10.6 3.4v-.2A1.2 1.2 0 0 0 9.4 2H3.2A1.2 1.2 0 0 0 2 3.2v6.2a1.2 1.2 0 0 0 1.2 1.2h.2" />
          </svg>
        }
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3.4 8.6l3 3 6.2-7" />
        </svg>
      </Show>
    </button>
  )
}

export function ScheduleDetail(props: { row: ScheduleRow; now: number; ctx: Context }) {
  const { schedule } = props.row
  const outcome = outcomeLabel(schedule.lastOutcome)
  const actionArgs = actionArgsText(schedule.action)
  const model = modelRefLabel(props.row.session?.model)
  const agent = props.row.session?.agent?.trim() ?? ""
  const directory = props.row.session?.location?.directory ?? props.row.session?.directory ?? ""
  // 打开执行会话：复用宿主页签，避免只给一个无法点击的会话名。
  const sessionServerID = createMemo(() => props.row.session?.id ?? schedule.sessionID ?? "")
  const openSession = () => {
    const sessionID = sessionServerID()
    if (!sessionID) return
    const serverID = hostServerID(props.ctx)
    if (!serverID) return
    props.ctx.tabs.open({ server: serverID, id: sessionID }, { focus: true })
  }
  const canOpenSession = () => {
    if (!sessionServerID()) return false
    return hostServerID(props.ctx) !== undefined
  }
  return (
    <div
      class="sc-detail"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div class="sc-detail-cols">
        <div class="sc-detail-col">
          <section class="sc-detail-group">
            <h4 class="sc-detail-group-title">基本信息</h4>
            <div class="sc-detail-grid">
              <span class="sc-detail-key">绑定会话</span>
              <span class="sc-detail-value" title={props.row.sessionTitle}>
                <span class="sc-detail-text">{props.row.sessionTitle}</span>
                <CopyButton text={props.row.sessionTitle} label="会话" />
                <Show when={canOpenSession()}>
                  <button
                    type="button"
                    class="sc-btn sc-btn-small sc-detail-open"
                    onClick={(event) => {
                      event.stopPropagation()
                      openSession()
                    }}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    查看执行会话
                  </button>
                </Show>
              </span>
              <Show when={model}>
                <span class="sc-detail-key">模型</span>
                <span class="sc-detail-value sc-mono">
                  <span class="sc-detail-text">{model}</span>
                  <CopyButton text={model} label="模型" />
                </span>
              </Show>
              <Show when={agent}>
                <span class="sc-detail-key">Agent</span>
                <span class="sc-detail-value">{agent}</span>
              </Show>
              <Show when={directory}>
                <span class="sc-detail-key">执行目录</span>
                <span class="sc-detail-value sc-mono">
                  <span class="sc-detail-text">{directory}</span>
                  <CopyButton text={directory} label="目录" />
                </span>
              </Show>
            </div>
          </section>

          <section class="sc-detail-group">
            <h4 class="sc-detail-group-title">运行情况</h4>
            <div class="sc-detail-grid">
              <span class="sc-detail-key">已触发</span>
              <span class="sc-detail-value">{schedule.runCount} 次</span>
              <Show when={schedule.lastFiredAt !== undefined}>
                <span class="sc-detail-key">上次触发</span>
                <span class="sc-detail-value">
                  {clockText(schedule.lastFiredAt)}（{relativeTime(schedule.lastFiredAt, props.now)}）
                  <Show when={outcome}>
                    <span class={`sc-badge sc-badge-${outcome!.tone}`}>{outcome!.text}</span>
                  </Show>
                </span>
              </Show>
              <span class="sc-detail-key">创建于</span>
              <span class="sc-detail-value">{clockText(schedule.time.created)}</span>
              <Show when={schedule.time.updated !== schedule.time.created}>
                <span class="sc-detail-key">更新于</span>
                <span class="sc-detail-value">{clockText(schedule.time.updated)}</span>
              </Show>
            </div>
          </section>
        </div>

        <div class="sc-detail-col">
          <section class="sc-detail-group">
            <h4 class="sc-detail-group-title">触发与动作</h4>
            <div class="sc-detail-grid">
              <span class="sc-detail-key">触发方式</span>
              <span class="sc-detail-value">{describeWhen(schedule.when)}</span>
              <span class="sc-detail-key">时区</span>
              <span class="sc-detail-value">{schedule.tz || "—"}</span>
              <span class="sc-detail-key">{actionLabel(schedule.action)}</span>
              <span class="sc-detail-value sc-prompt-text">
                <span class="sc-detail-text">
                  {schedule.action.type === "prompt" ? schedule.action.prompt : schedule.action.code}
                </span>
                <CopyButton
                  text={schedule.action.type === "prompt" ? schedule.action.prompt : schedule.action.code}
                  label={actionLabel(schedule.action)}
                />
              </span>
              <Show when={actionArgs}>
                <span class="sc-detail-key">代码参数</span>
                <span class="sc-detail-value sc-prompt-text">
                  <span class="sc-detail-text sc-output-text">{actionArgs}</span>
                </span>
              </Show>
              <Show when={schedule.endsAt !== undefined}>
                <span class="sc-detail-key">结束时间</span>
                <span class="sc-detail-value">{clockText(schedule.endsAt)}</span>
              </Show>
              <Show when={schedule.lastOutput?.trim()}>
                <span class="sc-detail-key">上次输出</span>
                <span class="sc-detail-value sc-prompt-text">
                  <span class="sc-detail-text sc-output-text">{schedule.lastOutput}</span>
                  <CopyButton text={schedule.lastOutput!} label="输出" />
                </span>
              </Show>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
