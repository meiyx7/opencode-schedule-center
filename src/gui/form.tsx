import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import type { Context } from "@opencode/plugin/gui"
import type { ScheduleRow, WhenDraft } from "../types"
import { clockText, isValidCron, outcomeLabel, previewRuns, relativeTime } from "./format"
import type { ScheduleStore } from "../store"

const WHEN_KINDS: Array<{ id: WhenDraft["kind"]; label: string }> = [
  { id: "in", label: "延迟" },
  { id: "at", label: "定时" },
  { id: "every", label: "间隔" },
  { id: "cron", label: "Cron" },
]

interface ModelOption {
  key: string
  label: string
  id: string
  providerID: string
  variant?: string
}

export function ScheduleForm(props: {
  ctx: Context
  store: ScheduleStore
  onCreated: () => void
  onCancel: () => void
}) {
  const [models, setModels] = createSignal<ModelOption[]>([])
  const [modelKey, setModelKey] = createSignal("")
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
    const [modelResponse, agentList, directoryList] = await Promise.allSettled([
      props.store.api.model.list({ types: ["chat"] }),
      props.store.primaryAgents(),
      props.store.recentDirectories(),
    ])
    if (modelResponse.status === "fulfilled") {
      const raw = (modelResponse.value.data ?? modelResponse.value) as Array<{
        providerID: string
        id: string
        name?: string
        status?: string
        enabled?: boolean
      }>
      setModels(
        raw
          .filter((model) => model.status === "active" && model.enabled !== false)
          .map((model) => ({
            key: `${model.providerID}/${model.id}`,
            label: model.name || model.id,
            id: model.id,
            providerID: model.providerID,
          })),
      )
    }
    if (agentList.status === "fulfilled") setAgents(agentList.value)
    if (directoryList.status === "fulfilled") setDirectories(directoryList.value)
  })

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
      const selected = models().find((model) => model.key === modelKey())
      const dir = directory().trim()
      await props.store.createSchedule({
        sessionID: "",
        name: name().trim() || undefined,
        when: draft()!,
        prompt: prompt().trim(),
        ...(endsWith() ? { ends: ends! } : {}),
        ...(selected ? { model: { id: selected.id, providerID: selected.providerID } } : {}),
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
  const canSubmit = () => !busy() && draft() !== null && prompt().trim().length > 0

  return (
    <div class="sc-form">
      <section class="sc-section">
        <div class="sc-field">
          <label class="sc-label" for="sc-name">
            任务名称 <span class="sc-label-note">可选</span>
          </label>
          <input
            id="sc-name"
            class="sc-input"
            placeholder="例如：每日依赖检查"
            value={name()}
            onInput={(event) => setName(event.currentTarget.value)}
          />
        </div>
      </section>

      <section class="sc-section">
        <h3 class="sc-section-title">触发</h3>
        <div class="sc-field">
          <span class="sc-label">方式</span>
          <div class="sc-segment" role="radiogroup" aria-label="触发方式">
            <For each={WHEN_KINDS}>
              {(option) => (
                <button
                  type="button"
                  class="sc-segment-item"
                  classList={{ active: kind() === option.id }}
                  role="radio"
                  aria-checked={kind() === option.id}
                  onClick={() => setKind(option.id)}
                >
                  {option.label}
                </button>
              )}
            </For>
          </div>
        </div>

        <Show
          when={kind() === "in"}
          fallback={
            <Show
              when={kind() === "at"}
              fallback={
                <Show
                  when={kind() === "every"}
                  fallback={
                    <div class="sc-field">
                      <label class="sc-label" for="sc-cron">
                        Cron 表达式 <span class="sc-label-note">5 字段，本地时区</span>
                      </label>
                      <input
                        id="sc-cron"
                        class="sc-input sc-mono"
                        placeholder="0 9 * * 1-5"
                        value={cron()}
                        onInput={(event) => setCron(event.currentTarget.value)}
                      />
                      <Show when={invalidCron()}>
                        <p class="sc-hint sc-hint-bad">格式无效：需要 5 个字段，如「0 9 * * 1-5」</p>
                      </Show>
                    </div>
                  }
                >
                  <div class="sc-field">
                    <label class="sc-label" for="sc-every">
                      间隔（分钟）
                    </label>
                    <input
                      id="sc-every"
                      class="sc-input"
                      type="number"
                      min="1"
                      value={everyMinutes()}
                      onInput={(event) => setEveryMinutes(event.currentTarget.value)}
                    />
                  </div>
                </Show>
              }
            >
              <div class="sc-field">
                <label class="sc-label" for="sc-at">
                  触发时间
                </label>
                <input
                  id="sc-at"
                  class="sc-input"
                  type="datetime-local"
                  value={atTime()}
                  onInput={(event) => setAtTime(event.currentTarget.value)}
                />
              </div>
            </Show>
          }
        >
          <div class="sc-field">
            <label class="sc-label" for="sc-in">
              多久之后（分钟）
            </label>
            <input
              id="sc-in"
              class="sc-input"
              type="number"
              min="1"
              value={inMinutes()}
              onInput={(event) => setInMinutes(event.currentTarget.value)}
            />
          </div>
        </Show>

        <Show when={kind() === "every" || kind() === "cron"}>
          <div class="sc-field">
            <label class="sc-label" for="sc-times">
              最多触发次数 <span class="sc-label-note">可选，留空一直执行</span>
            </label>
            <input
              id="sc-times"
              class="sc-input"
              type="number"
              min="1"
              placeholder="不限"
              value={times()}
              onInput={(event) => setTimes(event.currentTarget.value)}
            />
          </div>
        </Show>

        <Show when={previews().length > 0}>
          <div class="sc-field">
            <span class="sc-label">未来触发时间</span>
            <div class="sc-previews">
              <For each={previews()}>{(at) => <span class="sc-preview-chip">{clockText(at)}</span>}</For>
            </div>
          </div>
        </Show>
      </section>

      <section class="sc-section">
        <h3 class="sc-section-title">执行</h3>
        <div class="sc-field">
          <label class="sc-label" for="sc-prompt">
            唤醒提示词
          </label>
          <textarea
            id="sc-prompt"
            class="sc-input sc-textarea"
            rows="3"
            placeholder="触发时发送给会话的消息，例如：检查依赖更新并总结"
            value={prompt()}
            onInput={(event) => setPrompt(event.currentTarget.value)}
          />
        </div>

        <button type="button" class="sc-advanced-toggle" onClick={() => setAdvanced(!advanced())}>
          <span class="sc-advanced-chevron" classList={{ open: advanced() }}>
            ▸
          </span>
          高级选项
          <span class="sc-label-note">模型、Agent、执行目录</span>
        </button>

        <Show when={advanced()}>
          <div class="sc-advanced">
            <div class="sc-field">
              <label class="sc-label" for="sc-model">
                模型 <span class="sc-label-note">默认使用会话默认模型</span>
              </label>
              <select
                id="sc-model"
                class="sc-input"
                value={modelKey()}
                onChange={(event) => setModelKey(event.currentTarget.value)}
              >
                <option value="">默认模型</option>
                <For each={models()}>{(model) => <option value={model.key}>{model.label}</option>}</For>
              </select>
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

            <div class="sc-field">
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
        </Show>
      </section>

      <Show when={error()}>
        <p class="sc-hint sc-hint-bad">{error()}</p>
      </Show>

      <div class="sc-form-actions">
        <button type="button" class="sc-btn" onClick={() => props.onCancel()}>
          取消
        </button>
        <button type="button" class="sc-btn sc-btn-primary" disabled={!canSubmit()} onClick={() => void submit()}>
          {busy() ? "创建中…" : "创建任务"}
        </button>
      </div>
    </div>
  )
}

function useStateKind() {
  return createSignal<WhenDraft["kind"]>("in")
}

function defaultAt(): string {
  const date = new Date(Date.now() + 60 * 60_000)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
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
