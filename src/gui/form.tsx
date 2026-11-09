import { createMemo, createSignal, For, Match, onMount, Show, Switch } from "solid-js"
import type { Context } from "@opencode/plugin/gui"
import type { ModelProviderGroup, ScheduleRow, ScheduleWhen, WhenDraft } from "../types"
import { clockText, describeWhen, isValidCron, outcomeLabel, previewRuns, relativeTime } from "./format"
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
  onCreated: () => void
  onCancel: () => void
}) {
  const [providers, setProviders] = createSignal<ModelProviderGroup[]>([])
  const [providerID, setProviderID] = createSignal("")
  const [modelKey, setModelKey] = createSignal("")
  const [variant, setVariant] = createSignal("")
  const [modelHint, setModelHint] = createSignal("")
  const [agents, setAgents] = createSignal<Array<{ name: string; description?: string }>>([])
  const [agent, setAgent] = createSignal("")
  const [directories, setDirectories] = createSignal<string[]>([])
  const [directory, setDirectory] = createSignal("")
  const [customDir, setCustomDir] = createSignal(false)
  const [name, setName] = createSignal("")
  const [inMinutes, setInMinutes] = createSignal("30")
  const [atTime, setAtTime] = createSignal(defaultAt())
  const [everyMinutes, setEveryMinutes] = createSignal("60")
  const [cron, setCron] = createSignal("0 9 * * 1-5")
  const [prompt, setPrompt] = createSignal("")
  const [times, setTimes] = createSignal("")
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

  const providerOptions = createMemo<ComboOption[]>(() => [
    { value: "", label: "默认模型（跟随会话）", note: "不指定" },
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
  const draft = createMemo<WhenDraft | null>(() => {
    if (kind() === "in") {
      const value = Number(inMinutes())
      return Number.isFinite(value) && value > 0 ? { kind: "in", in: `${value} minutes` } : null
    }
    if (kind() === "at") {
      const at = Date.parse(atTime())
      return Number.isNaN(at) ? null : { kind: "at", at: atTime() }
    }
    if (kind() === "every") {
      const value = Number(everyMinutes())
      return Number.isFinite(value) && value > 0 ? { kind: "every", every: `${value} minutes` } : null
    }
    return isValidCron(cron()) ? { kind: "cron", cron: cron().trim() } : null
  })

  const previews = createMemo(() => (draft() ? previewRuns(draft()!, Date.now(), 5) : []))

  const submit = async () => {
    if (!draft()) return
    setBusy(true)
    setError("")
    try {
      const ends = kind() === "in" || kind() === "at" ? undefined : endsWith()
      const selected = selectedModel()
      const dir = directory().trim()
      await props.store.createSchedule({
        sessionID: "",
        name: name().trim() || undefined,
        when: draft()!,
        prompt: prompt().trim(),
        ...(endsWith() ? { ends: ends! } : {}),
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

  const invalidCron = () => kind() === "cron" && cron().trim().length > 0 && !isValidCron(cron())
  const invalidIn = () => kind() === "in" && !(Number(inMinutes()) > 0)
  const invalidEvery = () => kind() === "every" && !(Number(everyMinutes()) > 0)
  const invalidTimes = () => {
    const value = times().trim()
    if (value.length === 0) return false
    const numeric = Number(value)
    return !Number.isInteger(numeric) || numeric <= 0
  }
  const canSubmit = () => !busy() && draft() !== null && prompt().trim().length > 0

  // Footer summary: the schedule that is about to be created, in words.
  const draftWhen = createMemo<ScheduleWhen | null>(() => {
    const value = draft()
    if (!value) return null
    if (value.kind === "in") return { type: "in", in: value.in }
    if (value.kind === "at") return { type: "at", at: value.at }
    if (value.kind === "every") return { type: "every", every: value.every }
    return { type: "cron", cron: value.cron }
  })
  const draftSummary = () => (draftWhen() ? describeWhen(draftWhen()!) : "触发时间无效")

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
    if (selectedModel()) parts.push(selectedModel()!.name)
    if (agent()) parts.push(agent())
    const dir = directory().trim()
    if (dir) parts.push(dir)
    return parts.length > 0 ? parts.join(" · ") : "模型 · Agent · 执行目录"
  }

  const statusText = () => {
    if (draftWhen() === null) return "触发时间无效，请检查设置"
    const first = previews()[0]
    if (prompt().trim().length === 0) return "填写提示词后即可创建"
    return first ? `将于 ${clockText(first)} 首次触发` : draftSummary()
  }

  return (
    <div
      class="sc-form"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canSubmit()) {
          event.preventDefault()
          void submit()
        }
      }}
    >
      <div class="sc-field sc-name-field">
        <label class="sc-label" for="sc-name">
          任务名称 <span class="sc-label-note">可选 · 留空时用提示词开头</span>
        </label>
        <input
          id="sc-name"
          class="sc-input sc-name-input"
          placeholder="例如：每日依赖检查"
          value={name()}
          onInput={(event) => setName(event.currentTarget.value)}
        />
      </div>

      <section class="sc-section">
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
            <Show when={previews().length > 0} fallback={<div class="sc-next-empty">触发时间无效</div>}>
              <div class="sc-next-primary">
                <b>{clockText(previews()[0])}</b>
                <em>{relativeTime(previews()[0], Date.now())}</em>
              </div>
              <div class="sc-next-more">
                <For each={previews().slice(1, 3)}>{(at) => <span class="sc-next-chip">{clockText(at)}</span>}</For>
              </div>
            </Show>
            <Show when={kind() === "every" || kind() === "cron"}>
              <div class="sc-limit">
                <span>最多</span>
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
                <span>次</span>
              </div>
              <Show when={invalidTimes()}>
                <p class="sc-hint sc-hint-bad">需为正整数</p>
              </Show>
            </Show>
          </aside>
        </div>
      </section>

      <section class="sc-section">
        <div class="sc-section-head">
          <span class="sc-mark" />
          <h3 class="sc-section-title">执行</h3>
        </div>

        <div class="sc-field">
          <div class="sc-label-row">
            <label class="sc-label" for="sc-prompt">
              唤醒提示词
            </label>
            <span class="sc-counter">
              {prompt().trim().length > 0 ? `${prompt().trim().length} 字` : "必填"}
            </span>
          </div>
          <textarea
            id="sc-prompt"
            class="sc-input sc-textarea"
            rows="3"
            placeholder="触发时发送给会话的消息，例如：检查依赖更新并总结"
            value={prompt()}
            onInput={(event) => setPrompt(event.currentTarget.value)}
          />
        </div>

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
              <div class="sc-grid">
                <div class="sc-field">
                  <label class="sc-label" for="sc-provider">
                    Provider <span class="sc-label-note">先选 Provider</span>
                  </label>
                  <Combobox
                    id="sc-provider"
                    value={providerID()}
                    options={providerOptions()}
                    placeholder="搜索 Provider 或模型名"
                    emptyText="没有匹配的 Provider"
                    onSelect={selectProvider}
                  />
                </div>

                <div class="sc-field">
                  <label class="sc-label" for="sc-model">
                    模型 <span class="sc-label-note">{providerID() ? "可搜索" : "默认跟随会话"}</span>
                  </label>
                  <Combobox
                    id="sc-model"
                    value={modelKey()}
                    options={modelOptions()}
                    disabled={!providerID()}
                    placeholder={providerID() ? "搜索模型（名称或 ID）" : "请先选择 Provider"}
                    emptyText="没有匹配的模型"
                    onSelect={selectModel}
                  />
                  <Show when={variants().length > 0}>
                    <select
                      class="sc-input"
                      value={variant()}
                      onChange={(event) => setVariant(event.currentTarget.value)}
                      aria-label="模型变体"
                    >
                      <option value="">默认变体</option>
                      <For each={variants()}>{(id) => <option value={id}>{id}</option>}</For>
                    </select>
                  </Show>
                  <Show when={selectedModel()}>
                    <p class="sc-hint sc-model-summary">
                      {selectedModel()!.providerID} / {selectedModel()!.id}
                      <Show when={selectedModel()!.status !== "active"}>（{selectedModel()!.status}）</Show>
                    </p>
                  </Show>
                  <Show when={modelHint()}>
                    <p class="sc-hint sc-hint-bad">{modelHint()}</p>
                  </Show>
                </div>

                <Show when={agents().length > 0}>
                  <div class="sc-field">
                    <label class="sc-label" for="sc-agent">
                      Agent <span class="sc-label-note">默认 Build</span>
                    </label>
                    <select
                      id="sc-agent"
                      class="sc-input"
                      value={agent()}
                      onChange={(event) => setAgent(event.currentTarget.value)}
                    >
                      <option value="">默认（Build）</option>
                      <For each={agents()}>
                        {(item) => <option value={item.name}>{item.description || item.name}</option>}
                      </For>
                    </select>
                  </div>
                </Show>

                <div class="sc-field sc-span-2">
                  <label class="sc-label" for="sc-directory">
                    执行目录 <span class="sc-label-note">任务里的相对路径以此目录为准</span>
                  </label>
                  <Show
                    when={customDir()}
                    fallback={
                      <div class="sc-dir-row">
                        <select
                          id="sc-directory"
                          class="sc-input"
                          value={directory()}
                          onChange={(event) => setDirectory(event.currentTarget.value)}
                        >
                          <option value="">当前项目目录</option>
                          <For each={directories()}>{(dir) => <option value={dir}>{dir}</option>}</For>
                        </select>
                        <button type="button" class="sc-btn sc-btn-small" onClick={() => setCustomDir(true)}>
                          手动输入
                        </button>
                      </div>
                    }
                  >
                    <div class="sc-dir-row">
                      <input
                        class="sc-input sc-mono"
                        placeholder="/absolute/path/to/project"
                        value={directory()}
                        onInput={(event) => setDirectory(event.currentTarget.value)}
                      />
                      <button
                        type="button"
                        class="sc-btn sc-btn-small"
                        onClick={() => {
                          setCustomDir(false)
                          setDirectory("")
                        }}
                      >
                        返回选择
                      </button>
                    </div>
                  </Show>
                </div>
              </div>
            </div>
          </Show>
        </div>
      </section>

      <Show when={error()}>
        <p class="sc-hint sc-hint-bad">{error()}</p>
      </Show>

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

export function ScheduleDetail(props: { row: ScheduleRow; now: number }) {
  const { schedule } = props.row
  const outcome = outcomeLabel(schedule.lastOutcome)
  return (
    <div class="sc-detail">
      <div class="sc-detail-grid">
        <span class="sc-detail-key">绑定会话</span>
        <span class="sc-detail-value" title={props.row.sessionTitle}>
          {props.row.sessionTitle}
        </span>
        <span class="sc-detail-key">提示词</span>
        <span class="sc-detail-value sc-prompt-text">{schedule.action.prompt}</span>
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
        <span class="sc-detail-key">创建于</span>
        <span class="sc-detail-value">{clockText(schedule.time.created)}</span>
      </div>
    </div>
  )
}
