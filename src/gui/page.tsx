import { createSignal, createMemo, For, onCleanup, Show } from "solid-js"
import type { Context } from "@opencode/plugin/gui"
import type { ScheduleRow } from "../types"
import { actionText, clockText, describeWhen, outcomeLabel, relativeTime } from "./format"
import { ScheduleConfig, ScheduleDetail, ScheduleForm, Icon } from "./form"
import { CSS } from "./styles"
import type { ScheduleStore } from "../store"
import { createScanCoordinator } from "../scan-coordinator"

type Tab = "list" | "create"
type Filter = "active" | "paused" | "done" | "all"

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "active", label: "进行中" },
  { id: "paused", label: "已暂停" },
  { id: "done", label: "已结束" },
  { id: "all", label: "全部" },
]

export function SchedulePage(props: { ctx: Context; store: ScheduleStore; embedded?: boolean }) {
  const ctx = props.ctx
  const [tab, setTab] = createSignal<Tab>("list")
  const [rows, setRows] = createSignal<ScheduleRow[]>([])
  // The very first load shows the scan hint; later refreshes keep the list up.
  const [primed, setPrimed] = createSignal(false)
  const loading = () => !primed()
  const [error, setError] = createSignal("")
  // A failed sweep leaves the list state unknown — never present it as empty.
  const [scanFailed, setScanFailed] = createSignal(false)
  // Non-fatal partial-scan notice: some sessions failed to report schedules.
  const [scanPartial, setScanPartial] = createSignal("")
  const [expanded, setExpanded] = createSignal<string>("")
  const [busyId, setBusyId] = createSignal("")
  const [filter, setFilter] = createSignal<Filter>("all")
  const [confirming, setConfirming] = createSignal<string>("")
  const [search, setSearch] = createSignal("")
  const [nowTick, setNowTick] = createSignal(0)

  // One shared ticking clock drives every countdown on the page.
  const now = () => {
    void nowTick()
    return Date.now()
  }
  const timer = setInterval(() => setNowTick((value) => value + 1), 1000)
  onCleanup(() => clearInterval(timer))

  // Every refresh entry point shares one in-flight sweep. On failure the last
  // good rows stay on screen; only a failed first load raises a blocking error.
  const coordinator = createScanCoordinator(() => props.store.listAll())
  const load = async () => {
    const outcome = await coordinator.refresh()
    // The first attempt is over whether it succeeded or failed; later failures
    // are background refreshes and must leave the current rows alone.
    setPrimed(true)
    if (!outcome.ok) {
      // Unknown is not "no tasks": mark the sweep failed so empty-state copy
      // never claims the list is complete. A background failure must not erase
      // an earlier operation error either.
      setScanFailed(true)
      if (outcome.firstLoad) setError(describeError(outcome.error))
      return
    }
    setScanFailed(false)
    setError("")
    const result = outcome.data
    setRows(result.rows)
    // Never present a partial sweep as a complete one: count + truncation are
    // surfaced verbatim, and a background failure above did not clear `rows`.
    const notices: string[] = []
    if (result.failures.length > 0) notices.push(`${result.failures.length} 个会话读取失败`)
    if (result.truncated) notices.push("会话分页达到安全上限，仍有未扫描会话")
    setScanPartial(notices.length > 0 ? `${notices.join("；")}，任务列表可能不完整；可点「刷新」重试。` : "")
  }

  void load()

  // Countdowns tick every second, but the data behind them needs its own
  // calibration: poll at a calm cadence while the panel is visible so a fired
  // task does not sit with a stale badge until the user refreshes.
  const poll = setInterval(() => {
    if (document.hidden) return
    if (busyId()) return
    void load()
  }, 30_000)
  onCleanup(() => clearInterval(poll))

  const act = async (row: ScheduleRow, action: "pause" | "resume" | "delete") => {
    setBusyId(row.schedule.id)
    setError("")
    try {
      if (action === "delete") {
        await props.store.remove(row.schedule.id, row.schedule.sessionID ?? row.session?.id)
        if (expanded() === row.schedule.id) setExpanded("")
        // Deletion is already reflected in the store cache; rebuild locally.
        setRows(props.store.cachedRows())
      } else {
        // pause/resume patch the store cache and return fresh rows — no full
        // re-sweep of every session (the old code re-fetched N sessions).
        const patched = action === "pause"
          ? await props.store.pause(row.schedule.id)
          : await props.store.resume(row.schedule.id)
        setRows(patched)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      // The operation failed, but the server may have applied it anyway. Read
      // back ONLY this task with the official get — never re-sweep every
      // session (that would churn caches and could overwrite other edits).
      try {
        setRows(await props.store.reconcile(row.schedule.id))
      } catch {
        // Reconcile itself failed: keep the last known rows, stay quiet.
      }
    } finally {
      setBusyId("")
      setConfirming("")
    }
  }

  // Half-written create form, reported back by ScheduleForm via onDirtyChange.
  const [formDirty, setFormDirty] = createSignal(false)

  const switchTab = (next: Tab) => {
    // Leaving a half-written create form deserves a beat of friction; an
    // inline confirm on the back button replaces the jarring window.confirm.
    if (tab() === "create" && next === "list" && formDirty() && !confirmLeave()) {
      setConfirmLeave(true)
      return
    }
    setConfirmLeave(false)
    setTab(next)
  }
  const [confirmLeave, setConfirmLeave] = createSignal(false)

  const counts = createMemo(() => ({
    active: rows().filter((row) => row.schedule.status === "active").length,
    paused: rows().filter((row) => row.schedule.status === "paused").length,
    done: rows().filter((row) => row.schedule.status === "done").length,
    all: rows().length,
  }))
  // A failed sweep with no cached rows is "unknown", not an empty task list.
  const dataUnknown = () => scanFailed() && rows().length === 0

  const visibleRows = createMemo(() => {
    const current = filter()
    const needle = search().trim().toLowerCase()
    return rows().filter((row) => {
      if (current !== "all" && row.schedule.status !== current) return false
      if (!needle) return true
      const haystack =
        `${row.schedule.name ?? ""} ${actionText(row.schedule.action)} ${row.sessionTitle}`.toLowerCase()
      return haystack.includes(needle)
    })
  })

  return (
    <div
      class="sc-root"
      ref={(element) => {
        const style = document.createElement("style")
        style.textContent = CSS
        element.prepend(style)
        return () => clearInterval(timer)
      }}
      data-embedded={props.embedded ? "true" : undefined}
    >
      <Show when={tab() === "list"}>
        <section class="sc-hero">
          <div class="sc-hero-copy">
            <div class="sc-kicker">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                <circle cx="8" cy="8.5" r="5.5" />
                <path d="M8 5.5v3l2 1.5" />
                <path d="M6 1.5h4" />
              </svg>
              SCHEDULE CENTER
            </div>
            <Show when={!props.embedded}>
              <h1 class="sc-hero-title">定时任务</h1>
            </Show>
            <p class="sc-sub">把重复的事交给 agent：到点唤醒会话执行提示词。任务在本机 OpenCode 后台运行，应用退出后不会触发。</p>
            <div class="sc-hero-meta">
              <Show when={!loading() && !dataUnknown()} fallback={
                <span>{loading() ? "正在扫描会话…" : "任务状态暂不可确认，请重试"}</span>
              }>
                <span>
                  <b>{rows().filter((row) => row.schedule.status === "active").length}</b> 个进行中
                </span>
                <span class="sc-sep" />
                <span>
                  <b>{rows().filter((row) => row.schedule.status === "paused").length}</b> 个已暂停
                </span>
                <span class="sc-sep" />
                <span>
                  <b>{rows().length}</b> 个任务总计
                </span>
              </Show>
            </div>
          </div>
          <div class="sc-hero-tools">
            <button type="button" class="sc-btn sc-btn-primary" onClick={() => switchTab("create")}>
              新建任务
            </button>
          </div>
        </section>
      </Show>

      <div class="sc-toolbar">
        <div class="sc-tabs">
          <button type="button" class="sc-tab" classList={{ active: tab() === "list" }} onClick={() => switchTab("list")}>
            任务列表{rows().length > 0 ? `（${rows().length}）` : ""}
          </button>
          <button type="button" class="sc-tab" classList={{ active: tab() === "create" }} onClick={() => switchTab("create")}>
            新建任务
          </button>
        </div>
        <Show when={tab() === "list"}>
          <div class="sc-toolbar-end">
            {/* Partial-scan warning rides next to 刷新 instead of its own row:
                an icon that reveals the full sentence on hover or click. */}
            <Show when={scanPartial() && !error()}>
              <span class="sc-scan-warn" tabIndex={0} role="status" aria-label={scanPartial()}>
                <Icon name="warn" />
              </span>
            </Show>
            <button type="button" class="sc-btn sc-btn-ghost" disabled={loading()} onClick={() => void load()}>
              {loading() ? "刷新中…" : "刷新"}
            </button>
          </div>
        </Show>
      </div>

      <Show when={tab() === "create" && confirmLeave()}>
        <p class="sc-hint sc-hint-bad">
          提示词还没提交，返回列表将丢弃已填写的内容。
          <button type="button" class="sc-btn sc-btn-small" onClick={() => setConfirmLeave(false)}>
            继续编辑
          </button>
          <button type="button" class="sc-btn sc-btn-small sc-btn-danger" onClick={() => setTab("list")}>
            放弃并返回
          </button>
        </p>
      </Show>

      <Show when={tab() === "list" && error()}>
        <p class="sc-hint sc-hint-bad">{error()}</p>
      </Show>

      <Show
        when={tab() === "list"}
        fallback={
          <ScheduleForm
            ctx={ctx}
            store={props.store}
            onDirtyChange={setFormDirty}
            onCreated={() => {
              setFormDirty(false)
              setTab("list")
              // The new schedule is already in the store cache; show it at
              // once, then quietly reconcile in the background.
              setRows(props.store.cachedRows())
              void load()
            }}
            onCancel={() => switchTab("list")}
          />
        }
      >
        <Show
          when={!loading() || rows().length > 0}
          fallback={
            <div class="sc-empty">
              <Show when={loading()} fallback={
                <>
                  <p class="sc-empty-title">还没有定时任务</p>
                  <p class="sc-empty-hint">创建一个任务，让 agent 定时替你巡检、汇报、提醒</p>
                  <button type="button" class="sc-btn sc-btn-primary" onClick={() => switchTab("create")}>
                    新建第一个任务
                  </button>
                </>
              }>正在扫描会话…</Show>
            </div>
          }
        >
          <div class="sc-filters" role="tablist" aria-label="任务筛选">
            <For each={FILTERS}>
              {(item) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={filter() === item.id}
                  class="sc-filter"
                  classList={{ active: filter() === item.id }}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label}
                  <Show when={!dataUnknown()}><span class="sc-filter-count">{counts()[item.id]}</span></Show>
                </button>
              )}
            </For>
            {/* 搜索与筛选常驻，避免任务增减时布局跳动、焦点丢失。 */}
            <input
              type="search"
              class="sc-input sc-search"
              placeholder="搜索任务…"
              aria-label="搜索任务"
              value={search()}
              onInput={(event) => setSearch(event.currentTarget.value)}
            />
          </div>

          <Show
            when={visibleRows().length > 0}
            fallback={
              <div class="sc-empty sc-empty-slim">
                <Show
                  when={!dataUnknown()}
                  fallback={
                    <>
                      <p class="sc-empty-title">任务状态暂不可确认</p>
                      <p class="sc-empty-hint">扫描未能完成，这不代表没有任务；请点「刷新」重试。</p>
                    </>
                  }
                >
                  <Show
                    when={search().trim()}
                    fallback={
                      <>
                        <p class="sc-empty-title">没有{FILTERS.find((item) => item.id === filter())?.label}的任务</p>
                        <button type="button" class="sc-btn" onClick={() => setFilter("all")}>
                          查看全部
                        </button>
                      </>
                    }
                  >
                    <p class="sc-empty-title">没有匹配「{search().trim()}」的任务</p>
                    <button type="button" class="sc-btn" onClick={() => setSearch("")}>
                      清除搜索
                    </button>
                  </Show>
                </Show>
              </div>
            }
          >
            <div class="sc-list">
              <For each={visibleRows()}>
              {(row) => (
                <div
                  class="sc-card"
                  classList={{ expanded: expanded() === row.schedule.id }}
                  data-schedule={row.schedule.id}
                  role="button"
                  tabIndex="0"
                  aria-expanded={expanded() === row.schedule.id}
                  onClick={() => setExpanded(expanded() === row.schedule.id ? "" : row.schedule.id)}
                  onKeyDown={(event) => {
                    // 评审 S13：展开/折叠只响应卡片本身的 Enter/空格——内部按钮
                    // 的键盘事件不再被父级拦截或重复触发。
                    if (event.key !== "Enter" && event.key !== " ") return
                    if (event.target !== event.currentTarget) return
                    event.preventDefault()
                    setExpanded(expanded() === row.schedule.id ? "" : row.schedule.id)
                  }}
                >
                  <div class="sc-card-head">
                    <div class="sc-card-title">
                      <span class="sc-name">{row.schedule.name?.trim() || actionText(row.schedule.action).slice(0, 40)}</span>
                      <span class={`sc-badge sc-status-${row.schedule.status}`}>
                        {row.schedule.status === "active" ? "进行中" : row.schedule.status === "paused" ? "已暂停" : "已结束"}
                      </span>
                    </div>
                    <div class="sc-card-actions">
                      <Show when={row.schedule.status === "active"}>
                        <button
                          type="button"
                          class="sc-btn sc-btn-small"
                          disabled={busyId() === row.schedule.id}
                          onClick={(event) => {
                            event.stopPropagation()
                            void act(row, "pause")
                          }}
                        >
                          暂停
                        </button>
                      </Show>
                      <Show when={row.schedule.status === "paused"}>
                        <button
                          type="button"
                          class="sc-btn sc-btn-small sc-btn-primary"
                          disabled={busyId() === row.schedule.id}
                          title="恢复后按官方规则继续：一次性任务若在暂停期到期将触发一次；重复任务从下一时间槽继续，不逐次补跑"
                          onClick={(event) => {
                            event.stopPropagation()
                            void act(row, "resume")
                          }}
                        >
                          恢复
                        </button>
                      </Show>
                      <button
                        type="button"
                        class="sc-btn sc-btn-small sc-btn-danger"
                        classList={{ "confirm-armed": confirming() === row.schedule.id }}
                        disabled={busyId() === row.schedule.id}
                        title="删除这条定时任务"
                        onClick={(event) => {
                          event.stopPropagation()
                          if (confirming() === row.schedule.id) {
                            void act(row, "delete")
                          } else {
                            // Two clicks, no modal: first arms, clicking elsewhere disarms.
                            setConfirming(row.schedule.id)
                            const scheduleID = row.schedule.id
                            const disarm = (click: Event) => {
                              const target = click.target as HTMLElement
                              if (!target.closest?.(`[data-schedule="${scheduleID}"]`)) setConfirming("")
                              document.removeEventListener("click", disarm, true)
                            }
                            document.addEventListener("click", disarm, true)
                          }
                        }}
                      >
                        {confirming() === row.schedule.id ? "确认删除任务" : "删除"}
                      </button>
                    </div>
                  </div>
                  <Show when={row.schedule.status === "active" && row.schedule.nextDueAt !== undefined}>
                    <div class="sc-card-next">
                      <svg class="sc-next-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
                        <circle cx="8" cy="8.5" r="5.5" />
                        <path d="M8 5.5v3l2 1.5" />
                      </svg>
                      <span class="sc-next-rel">{relativeTime(row.schedule.nextDueAt, now())}</span>
                      <span class="sc-next-at">{clockText(row.schedule.nextDueAt)}</span>
                    </div>
                  </Show>
                  <div class="sc-card-meta">
                    <span class="sc-when">{describeWhen(row.schedule.when)}</span>
                    <Show when={row.schedule.status !== "active" || row.schedule.nextDueAt === undefined}>
                      <Show when={row.schedule.lastFiredAt !== undefined}>
                        <span class="sc-sep">·</span>
                        <span>上次 {clockText(row.schedule.lastFiredAt)}</span>
                      </Show>
                    </Show>
                    <Show when={outcomeLabel(row.schedule.lastOutcome)}>
                      {(outcome) => (
                        <>
                          <span class="sc-sep">·</span>
                          <span class={`sc-badge sc-badge-${outcome().tone}`}>{outcome().text}</span>
                        </>
                      )}
                    </Show>
                  </div>
                  <ScheduleConfig session={row.session} />
                  <Show when={expanded() === row.schedule.id}>
                    <ScheduleDetail row={row} now={now()} ctx={ctx} />
                  </Show>
                </div>
              )}
              </For>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  )
}
