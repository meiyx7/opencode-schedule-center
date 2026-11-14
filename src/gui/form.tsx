import { createEffect, createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import type { Context } from "@opencode/plugin/gui"
import type { ModelProviderGroup, ScheduleRow, ScheduleWhen, SessionInfo, WhenDraft } from "../types"
import { clockText, dirName, isValidCron, modelRefLabel, outcomeLabel, previewRuns, relativeTime } from "./format"
import { Combobox, type ComboOption } from "./combobox"
import type { ScheduleStore } from "../store"

type IconName = "clock" | "calendar" | "repeat" | "terminal" | "sliders" | "check" | "chevron" | "spark"

const WHEN_KINDS: Array<{ id: WhenDraft["kind"]; label: string; icon: IconName }> = [
  { id: "in", label: "延迟", icon: "clock" },
  { id: "at", label: "定时", icon: "calendar" },
  { id: "every", label: "间隔", icon: "repeat" },
  { id: "cron", label: "Cron", icon: "terminal" },
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

function Icon(props: { name: IconName }) {
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
  const [modelPicker, setModelPicker] = createSignal(false)
  const [modelHint, setModelHint] = createSignal("")
  const [agents, setAgents] = createSignal<Array<{ name: string; description?: string }>>([])
  const [agent, setAgent] = createSignal("")
  const [directories, setDirectories] = createSignal<string[]>([])
  const [directory, setDirectory] = createSignal("")
  const [customDir, setCustomDir] = createSignal(false)
  const [name, setName] = createSignal("")
  const [inMinutes, setInMinutes] = createSignal("30")
  // 记住打开表单时的默认值；dirty 不能拿“此刻 + 1 小时”当基线，否则时间流逝本身会把表单变脏。
  const initialAt = defaultAt()
  const [atTime, setAtTime] = createSignal(initialAt)
  const [everyMinutes, setEveryMinutes] = createSignal("60")
  const [cron, setCron] = createSignal("0 9 * * 1-5")
  const [prompt, setPrompt] = createSignal("")
  const [times, setTimes] = createSignal("")
  const [advanced, setAdvanced] = createSignal(true)
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
  // 合并后的模型入口：把 Provider / 模型 / 变体拼成一行展示，细节放进浮层里选。
  const modelTriggerText = () => {
    const model = selectedModel()
    if (!model) {
      return providerID() ? `${currentProvider()?.name ?? providerID()} · 选择模型` : "跟随会话（默认模型）"
    }
    const base = `${currentProvider()?.name ?? model.providerID} · ${model.name}`
    return variant() ? `${base} · ${variant()}` : base
  }

  let modelField: HTMLDivElement | undefined
  onMount(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!modelPicker()) return
      if (modelField && !modelField.contains(event.target as Node)) setModelPicker(false)
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    onCleanup(() => document.removeEventListener("pointerdown", onPointerDown, true))
  })

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
  const draft = createMemo<WhenDraft | null>(() => {
    if (kind() === "in") {
      const value = Number(inMinutes())
      return Number.isFinite(value) && value > 0 ? { kind: "in", in: `${value} minutes` } : null
    }
    if (kind() === "at") {
      const at = Date.parse(atTime())
      // A past time would fire immediately or never; require a future instant.
      return Number.isNaN(at) || at <= Date.now() ? null : { kind: "at", at: atTime() }
    }
    if (kind() === "every") {
      const value = Number(everyMinutes())
      return Number.isFinite(value) && value > 0 ? { kind: "every", every: `${value} minutes` } : null
    }
    return isValidCron(cron()) ? { kind: "cron", cron: cron().trim() } : null
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

  const submit = async () => {
    // 非法次数绝不能静默落成“不限次”：提交前再挡一次。
    if (!draft() || !canSubmit()) return
    setBusy(true)
    setError("")
    try {
      const selected = selectedModel()
      const dir = directory().trim()
      await props.store.createSchedule({
        sessionID: "",
        name: name().trim() || undefined,
        when: draft()!,
        prompt: prompt().trim(),
        ...(kind() !== "in" && kind() !== "at" && endsWith() ? { ends: endsWith()! } : {}),
        ...(selected
          ? {
              model: {
                id: selected.id,
                providerID: selected.providerID,
                ...(variant() ? { variant: variant() } : {}),
              },
            }
          : {}),
        ...(agent() ? { agent: agent() } : {}),
        ...(dir ? { directory: dir } : {}),
      })
      props.onCreated()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  function endsWith(): { times: number } | undefined {
    const value = Number(times())
    return Number.isInteger(value) && value > 0 ? { times: value } : undefined
  }

  /** Step the max-runs input; an empty value starts at 5 so "−" has a base. */
  function stepTimes(delta: number) {
    const current = Number(times())
    const next = Number.isInteger(current) && current > 0 ? current + delta : 5
    setTimes(String(Math.max(1, next)))
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
  const invalidTimes = () => {
    const value = times().trim()
    if (value.length === 0) return false
    const numeric = Number(value)
    return !Number.isInteger(numeric) || numeric <= 0
  }
  // 绝对时间必须晚于当前时刻；否则到点即触发或永远不触发。
  const invalidAt = () => {
    if (kind() !== "at") return false
    const at = Date.parse(atTime())
    return Number.isNaN(at) || at <= Date.now()
  }
  // 次数错误必须阻止提交：空值才代表“不限”，错误值不允许被省略成不限。
  const canSubmit = () =>
    !busy() && draft() !== null && prompt().trim().length > 0 && !invalidTimes() && !invalidAt()

  // Footer summary: the schedule that is about to be created, in words.
  const draftWhen = createMemo<ScheduleWhen | null>(() => {
    const value = draft()
    if (!value) return null
    if (value.kind === "in") return { type: "in", in: value.in }
    if (value.kind === "at") return { type: "at", at: value.at }
    if (value.kind === "every") return { type: "every", every: value.every }
    return { type: "cron", cron: value.cron }
  })
  const panelLabel = () => {
    if (kind() === "in") return "延迟时长"
    if (kind() === "at") return "触发时间"
    if (kind() === "every") return "重复间隔"
    return "Cron 表达式"
  }
  const panelHint = () => {
    if (kind() === "in" || kind() === "at") return "一次性任务"
    if (kind() === "every") return "按固定间隔重复执行"
    return "5 字段 · 本地时区"
  }

  // Collapsed advanced row reflects the current picks instead of static text.
  const advancedSummary = () => {
    const parts: string[] = []
    if (selectedModel()) {
      // 变体跟着模型显示在摘要里，折叠高级选项时也不会看漏。
      const variantPart = variant() ? ` · ${variant()}` : ""
      parts.push(`${selectedModel()!.name}${variantPart}`)
    }
    if (agent()) parts.push(agent())
    const dir = directory().trim()
    if (dir) parts.push(dir)
    return parts.length > 0 ? parts.join(" · ") : "模型 · Agent · 执行目录"
  }

  const statusText = () => {
    if (draftWhen() === null) return "触发时间无效，请检查设置"
    const first = previewRunsLive()[0]
    // 创建后会自动开一个承载会话，这是定时任务的运行载体，提示里说清楚。
    const sessionNote = "创建后将自动新建一个会话作为任务载体"
    if (prompt().trim().length === 0) return `填写提示词后即可创建 · ${sessionNote}`
    if (!first) return `即将创建 · ${sessionNote}`
    return `将于 ${clockText(first)} 首次触发（${relativeTime(first, now())}） · ${sessionNote}`
  }

  // Report progress so the page can confirm before discarding a half-written form.
  // Compare every editable field, not just the first three: 只改时间或目录也
  // 是用户的输入，离开前必须给出确认机会。
  const dirty = createMemo(
    () =>
      prompt().trim().length > 0 ||
      name().trim().length > 0 ||
      providerID() !== "" ||
      modelKey() !== "" ||
      variant() !== "" ||
      agent() !== "" ||
      directory().trim() !== "" ||
      inMinutes() !== "30" ||
      atTime() !== initialAt ||
      everyMinutes() !== "60" ||
      cron() !== "0 9 * * 1-5" ||
      times().trim() !== "",
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
            if (modelPicker()) {
              event.preventDefault()
              setModelPicker(false)
            } else if (advanced()) {
              event.preventDefault()
              setAdvanced(false)
            } else {
              props.onCancel()
            }
          }
        }}
      >
      <div class="sc-form-body">
      <div class="sc-form-main">
      <section class="sc-section sc-name-section">
        <div class="sc-section-head">
          <span class="sc-mark" />
          <label class="sc-section-title" for="sc-name">任务名称</label>
          <span class="sc-label-note">可选 · 留空时用提示词开头</span>
        </div>
        <input
          id="sc-name"
          class="sc-input sc-name-input"
          placeholder="例如：每日依赖检查"
          value={name()}
          onInput={(event) => setName(event.currentTarget.value)}
        />
      </section>

      <section class="sc-section sc-trigger-section">
        <div class="sc-section-head">
          <span class="sc-mark" />
          <h3 class="sc-section-title">触发</h3>
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
                onClick={() => setKind(option.id)}
              >
                <Icon name={option.icon} />
                <span>{option.label}</span>
              </button>
            )}
          </For>
        </div>

        <div class="sc-panel">
          <div class="sc-panel-grid">
          <div class="sc-panel-main">
            <div class="sc-panel-head">
              <span class="sc-panel-label">{panelLabel()}</span>
              <span class="sc-panel-hint">{panelHint()}</span>
            </div>

            <Show when={kind() === "in"}>
              <div class="sc-control">
                <div class="sc-duration">
                  <input
                    id="sc-in"
                    class="sc-input"
                    type="number"
                    min="1"
                    aria-label="延迟分钟数"
                    value={inMinutes()}
                    onInput={(event) => setInMinutes(event.currentTarget.value)}
                  />
                  <span class="sc-unit">分钟</span>
                  <div class="sc-scrollers">
                    <button type="button" tabIndex={-1} aria-label="减少" onClick={() => stepMinutes(inMinutes, setInMinutes, -1)}>
                      −
                    </button>
                    <button type="button" tabIndex={-1} aria-label="增加" onClick={() => stepMinutes(inMinutes, setInMinutes, 1)}>
                      +
                    </button>
                  </div>
                </div>
                <div class="sc-presets">
                  <For each={MINUTE_PRESETS}>
                    {(preset) => (
                      <button
                        type="button"
                        class="sc-chip"
                        classList={{ active: inMinutes() === preset.value }}
                        onClick={() => setInMinutes(preset.value)}
                      >
                        {preset.label}
                      </button>
                    )}
                  </For>
                </div>
              </div>
              <Show when={invalidIn()}>
                <p class="sc-hint sc-hint-bad">请输入大于 0 的分钟数</p>
              </Show>
            </Show>

            <Show when={kind() === "at"}>
              <div class="sc-control">
                <input
                  id="sc-at"
                  class="sc-input sc-datetime"
                  type="datetime-local"
                  aria-label="触发时间"
                  value={atTime()}
                  onInput={(event) => setAtTime(event.currentTarget.value)}
                />
                <div class="sc-presets">
                  <For each={AT_PRESETS}>
                    {(preset) => (
                      <button type="button" class="sc-chip" onClick={() => setAtTime(preset.at())}>
                        {preset.label}
                      </button>
                    )}
                  </For>
                </div>
              </div>
              <Show when={invalidAt()}>
                <p class="sc-hint sc-hint-bad">请选择晚于当前时间的时间点</p>
              </Show>
            </Show>

            <Show when={kind() === "every"}>
              <div class="sc-control">
                <div class="sc-duration">
                  <input
                    id="sc-every"
                    class="sc-input"
                    type="number"
                    min="1"
                    aria-label="间隔分钟数"
                    value={everyMinutes()}
                    onInput={(event) => setEveryMinutes(event.currentTarget.value)}
                  />
                  <span class="sc-unit">分钟</span>
                  <div class="sc-scrollers">
                    <button type="button" tabIndex={-1} aria-label="减少" onClick={() => stepMinutes(everyMinutes, setEveryMinutes, -1)}>
                      −
                    </button>
                    <button type="button" tabIndex={-1} aria-label="增加" onClick={() => stepMinutes(everyMinutes, setEveryMinutes, 1)}>
                      +
                    </button>
                  </div>
                </div>
                <div class="sc-presets">
                  <For each={MINUTE_PRESETS}>
                    {(preset) => (
                      <button
                        type="button"
                        class="sc-chip"
                        classList={{ active: everyMinutes() === preset.value }}
                        onClick={() => setEveryMinutes(preset.value)}
                      >
                        {preset.label}
                      </button>
                    )}
                  </For>
                </div>
              </div>
              <Show when={invalidEvery()}>
                <p class="sc-hint sc-hint-bad">请输入大于 0 的分钟数</p>
              </Show>
            </Show>

            <Show when={kind() === "cron"}>
              <div class="sc-control sc-control-stack">
                <input
                  id="sc-cron"
                  class="sc-input sc-mono"
                  placeholder="0 9 * * 1-5"
                  aria-label="Cron 表达式"
                  value={cron()}
                  onInput={(event) => setCron(event.currentTarget.value)}
                />
                <div class="sc-presets">
                  <For each={CRON_PRESETS}>
                    {(preset) => (
                      <button
                        type="button"
                        class="sc-chip"
                        classList={{ active: cron().trim() === preset.value }}
                        onClick={() => setCron(preset.value)}
                      >
                        {preset.label}
                      </button>
                    )}
                  </For>
                </div>
              </div>
              <Show when={invalidCron()}>
                <p class="sc-hint sc-hint-bad">格式无效：需要 5 个字段，如「0 9 * * 1-5」</p>
              </Show>
            </Show>
          </div>

          <aside class="sc-next">
            <div class="sc-next-head">
              <Icon name="clock" />
              <span>接下来</span>
            </div>
            <Show when={previewRunsLive().length > 0} fallback={<div class="sc-next-empty">触发时间无效</div>}>
              <div class="sc-next-primary">
                <b>{clockText(previewRunsLive()[0])}</b>
                <em>{relativeTime(previewRunsLive()[0], now())}</em>
              </div>
              <div class="sc-next-more">
                <For each={previewRunsLive().slice(1, 3)}>
                  {(at) => <span class="sc-next-chip">{clockText(at)}</span>}
                </For>
              </div>
            </Show>
            <Show when={kind() === "every" || kind() === "cron"}>
              <div class="sc-limit">
                <span>最多</span>
                <div class="sc-stepper">
                  <button
                    type="button"
                    class="sc-step"
                    aria-label="减少"
                    tabIndex={-1}
                    disabled={times().trim().length === 0}
                    onClick={() => stepTimes(-1)}
                  >
                    −
                  </button>
                  <input
                    id="sc-times"
                    class="sc-input"
                    type="number"
                    min="1"
                    placeholder="不限"
                    aria-label="最多触发次数"
                    value={times()}
                    onInput={(event) => setTimes(event.currentTarget.value)}
                  />
                  <button
                    type="button"
                    class="sc-step"
                    aria-label="增加"
                    tabIndex={-1}
                    onClick={() => stepTimes(1)}
                  >
                    +
                  </button>
                </div>
                <span>次</span>
              </div>
              <Show when={invalidTimes()}>
                <p class="sc-hint sc-hint-bad">需为正整数</p>
              </Show>
            </Show>
          </aside>
          </div>
        </div>
      </section>
      </div>

      <section class="sc-section sc-exec-section">
        <div class="sc-section-head">
          <span class="sc-mark" />
          <h3 class="sc-section-title">执行</h3>
          <span class="sc-section-note">唤醒提示词</span>
          <span class="sc-counter">{prompt().trim().length > 0 ? `${prompt().trim().length} 字` : "必填"}</span>
        </div>

        <textarea
            id="sc-prompt"
            class="sc-input sc-textarea"
            rows="3"
            placeholder="触发时发送给会话的消息，例如：检查依赖更新并总结"
            value={prompt()}
            onInput={(event) => setPrompt(event.currentTarget.value)}
        />

        <div class="sc-advanced-wrap">
          <button
            type="button"
            class="sc-advanced-toggle"
            aria-expanded={advanced()}
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
              <div class="sc-grid" classList={{ "sc-no-agent": agents().length === 0 }}>
                <div class="sc-field sc-model-field" ref={modelField}>
                  <div class="sc-label-row">
                    <label class="sc-label" for="sc-model-trigger">
                      模型
                    </label>
                    <span class="sc-label-note">Provider · 模型 · 变体</span>
                  </div>
                  <button
                    id="sc-model-trigger"
                    type="button"
                    class="sc-input sc-model-trigger"
                    aria-haspopup="dialog"
                    aria-expanded={modelPicker()}
                    title={modelTriggerText()}
                    onClick={() => setModelPicker(!modelPicker())}
                  >
                    <span class="sc-model-trigger-text">{modelTriggerText()}</span>
                    <span class="sc-model-trigger-chevron" classList={{ open: modelPicker() }}>
                      <Icon name="chevron" />
                    </span>
                  </button>
                  <Show when={modelPicker()}>
                    <div class="sc-model-popover" role="dialog" aria-label="选择模型">
                      <div class="sc-field">
                        <label class="sc-label" for="sc-provider">
                          Provider
                        </label>
                        <Combobox
                          id="sc-provider"
                          value={providerID()}
                          options={providerOptions()}
                          placeholder="选择或搜索"
                          emptyText="没有匹配的 Provider"
                          onSelect={selectProvider}
                        />
                      </div>
                      <div class="sc-field">
                        <div class="sc-label-row">
                          <label class="sc-label" for="sc-model">
                            模型
                          </label>
                          <span class="sc-label-note sc-model-summary">
                            {selectedModel() ? `${selectedModel()!.providerID} / ${selectedModel()!.id}` : providerID() ? "可搜索" : "先选 Provider"}
                          </span>
                        </div>
                        <Combobox
                          id="sc-model"
                          value={modelKey()}
                          options={modelOptions()}
                          disabled={!providerID()}
                          placeholder={providerID() ? "搜索模型" : "请先选择 Provider"}
                          emptyText="没有匹配的模型"
                          onSelect={selectModel}
                        />
                      </div>
                      <Show
                        when={variants().length > 0}
                        fallback={
                          <Show when={providerID() && selectedModel()}>
                            <div class="sc-field">
                              <span class="sc-label">变体</span>
                              <p class="sc-hint">该模型没有变体，直接使用默认行为</p>
                            </div>
                          </Show>
                        }
                      >
                        <div class="sc-field">
                          <span class="sc-label">变体</span>
                          <div class="sc-variant-chips" role="group" aria-label="模型变体">
                            <button
                              type="button"
                              class="sc-chip"
                              classList={{ active: variant() === "" }}
                              onClick={() => setVariant("")}
                            >
                              默认
                            </button>
                            <For each={variants()}>
                              {(id) => (
                                <button
                                  type="button"
                                  class="sc-chip"
                                  classList={{ active: variant() === id }}
                                  onClick={() => setVariant(id)}
                                >
                                  {id}
                                </button>
                              )}
                            </For>
                          </div>
                        </div>
                      </Show>
                    </div>
                  </Show>
                  <Show when={modelHint()}>
                    <p class="sc-hint sc-hint-bad">{modelHint()}</p>
                  </Show>
                </div>

                <Show when={agents().length > 0}>
                  <div class="sc-field sc-agent-field">
                    <label class="sc-label" for="sc-agent">
                      Agent
                    </label>
                    <select
                      id="sc-agent"
                      class="sc-input"
                      value={agent()}
                      onChange={(event) => setAgent(event.currentTarget.value)}
                    >
                      <option value="">跟随会话</option>
                      <For each={agents()}>
                        {(item) => <option value={item.name}>{item.name}</option>}
                      </For>
                    </select>
                  </div>
                </Show>

                <div class="sc-field sc-directory-field">
                  <div class="sc-label-row">
                    <label class="sc-label" for="sc-directory">
                      执行目录
                    </label>
                    <button
                      type="button"
                      class="sc-link-button"
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

      <Show when={error()}>
        <p class="sc-hint sc-hint-bad sc-form-error">{error()}</p>
      </Show>
      </div>

      <div class="sc-form-actions">
        <div class="sc-form-status">
          <span class="sc-status-dot" classList={{ ready: canSubmit() }} />
          <span>{statusText()}</span>
        </div>
        <div class="sc-form-buttons">
          <button type="button" class="sc-btn" onClick={() => props.onCancel()}>
            取消
          </button>
          <button
            type="button"
            class="sc-btn sc-btn-primary"
            disabled={!canSubmit()}
            title="⌘ / Ctrl + Enter"
            onClick={() => void submit()}
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
  const model = modelRefLabel(props.row.session?.model)
  const agent = props.row.session?.agent?.trim() ?? ""
  const directory = props.row.session?.location?.directory ?? props.row.session?.directory ?? ""
  // 打开执行会话：复用宿主页签，避免只给一个无法点击的会话名。
  const sessionServerID = createMemo(() => props.row.session?.id ?? schedule.sessionID ?? "")
  const openSession = () => {
    const sessionID = sessionServerID()
    if (!sessionID) return
    const serverID = props.ctx.servers.list()[0]
    if (!serverID) return
    props.ctx.tabs.open({ server: serverID, id: sessionID }, { focus: true })
  }
  const canOpenSession = () => {
    if (!sessionServerID()) return false
    try {
      return props.ctx.servers.list().length > 0
    } catch {
      return false
    }
  }
  return (
    <div
      class="sc-detail"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
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
        <span class="sc-detail-key">提示词</span>
        <span class="sc-detail-value sc-prompt-text">
          <span class="sc-detail-text">{schedule.action.prompt}</span>
          <CopyButton text={schedule.action.prompt} label="提示词" />
        </span>
        <span class="sc-detail-key">已触发</span>
        <span class="sc-detail-value">
          {schedule.runCount} 次
          <Show when={schedule.remainingRuns !== undefined}>（剩余 {schedule.remainingRuns} 次）</Show>
        </span>
        <Show when={schedule.lastFiredAt !== undefined}>
          <span class="sc-detail-key">上次触发</span>
          <span class="sc-detail-value">
            {clockText(schedule.lastFiredAt)}（{relativeTime(schedule.lastFiredAt, props.now)}）
            <Show when={outcome}>
              <span class={`sc-badge sc-badge-${outcome!.tone}`}>{outcome!.text}</span>
            </Show>
          </span>
        </Show>
        <Show when={schedule.lastOutput?.trim()}>
          <span class="sc-detail-key">上次输出</span>
          <span class="sc-detail-value sc-prompt-text">
            <span class="sc-detail-text sc-output-text">{schedule.lastOutput}</span>
            <CopyButton text={schedule.lastOutput!} label="输出" />
          </span>
        </Show>
        <span class="sc-detail-key">创建于</span>
        <span class="sc-detail-value">{clockText(schedule.time.created)}</span>
      </div>
    </div>
  )
}
