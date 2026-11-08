import { createSignal, For, Show } from "solid-js"
import type { Context } from "@opencode/plugin/gui"
import type { ScheduleRow } from "../types"
import { clockText, describeWhen, outcomeLabel, relativeTime } from "./format"
import { ScheduleDetail, ScheduleForm } from "./form"
import { CSS } from "./styles"
import type { ScheduleStore } from "../store"

type Tab = "list" | "create"

export function SchedulePage(props: { ctx: Context; store: ScheduleStore; embedded?: boolean }) {
  const ctx = props.ctx
  const [tab, setTab] = createSignal<Tab>("list")
  const [rows, setRows] = createSignal<ScheduleRow[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal("")
  const [expanded, setExpanded] = createSignal<string>("")
  const [busyId, setBusyId] = createSignal("")
  const [nowTick, setNowTick] = createSignal(0)

  // One shared ticking clock drives every countdown on the page.
  const now = () => {
    void nowTick()
    return Date.now()
  }
  let timer: ReturnType<typeof setInterval> | undefined
  timer = setInterval(() => setNowTick((value) => value + 1), 1000)

  const load = async () => {
    setLoading(true)
    setError("")
    try {
      setRows(await props.store.listAll())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  void load()

  const act = async (row: ScheduleRow, action: "pause" | "resume" | "delete") => {
    setBusyId(row.schedule.id)
    setError("")
    try {
      if (action === "delete") await props.store.remove(row.schedule.id)
      else if (action === "pause") await props.store.pause(row.schedule.id)
      else await props.store.resume(row.schedule.id)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusyId("")
    }
  }

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
          <p class="sc-sub">把重复的事交给 agent：到点唤醒会话执行提示词，支持 cron、条件与执行目录。</p>
          <div class="sc-hero-meta">
            <Show when={!loading()} fallback={<span>正在扫描会话…</span>}>
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
          <button type="button" class="sc-btn sc-btn-primary" onClick={() => setTab("create")}>
            新建任务
          </button>
        </div>
      </section>

      <div class="sc-toolbar">
        <div class="sc-tabs">
          <button type="button" class="sc-tab" classList={{ active: tab() === "list" }} onClick={() => setTab("list")}>
            任务列表{rows().length > 0 ? `（${rows().length}）` : ""}
          </button>
          <button type="button" class="sc-tab" classList={{ active: tab() === "create" }} onClick={() => setTab("create")}>
            新建任务
          </button>
        </div>
        <button type="button" class="sc-btn sc-btn-ghost" disabled={loading()} onClick={() => void load()}>
          {loading() ? "刷新中…" : "刷新"}
        </button>
      </div>

      <Show when={error()}>
        <p class="sc-hint sc-hint-bad">{error()}</p>
      </Show>

      <Show
        when={tab() === "list"}
        fallback={<ScheduleForm ctx={ctx} store={props.store} onCreated={() => { setTab("list"); void load() }} onCancel={() => setTab("list")} />}
      >
        <Show
          when={!loading() || rows().length > 0}
          fallback={
            <div class="sc-empty">
              <Show when={loading()} fallback={
                <>
                  <p class="sc-empty-title">还没有定时任务</p>
                  <p class="sc-empty-hint">创建一个任务，让 agent 定时替你巡检、汇报、提醒</p>
                  <button type="button" class="sc-btn sc-btn-primary" onClick={() => setTab("create")}>
                    新建第一个任务
                  </button>
                </>
              }>正在扫描会话…</Show>
            </div>
          }
        >
          <div class="sc-list">
            <For each={rows()}>
              {(row) => (
                <div
                  class="sc-card"
                  classList={{ expanded: expanded() === row.schedule.id }}
                  role="button"
                  tabIndex="0"
                  aria-expanded={expanded() === row.schedule.id}
                  onClick={() => setExpanded(expanded() === row.schedule.id ? "" : row.schedule.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      setExpanded(expanded() === row.schedule.id ? "" : row.schedule.id)
                    }
                  }}
                >
                  <div class="sc-card-head">
                    <div class="sc-card-title">
                      <span class="sc-name">{row.schedule.name?.trim() || row.schedule.action.prompt.slice(0, 40)}</span>
                      <span class={`sc-badge sc-badge-${row.schedule.status}`}>
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
                        disabled={busyId() === row.schedule.id}
                        onClick={(event) => {
                          event.stopPropagation()
                          void act(row, "delete")
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                  <div class="sc-card-meta">
                    <span class="sc-when">{describeWhen(row.schedule.when)}</span>
                    <Show
                      when={row.schedule.status === "active" && row.schedule.nextDueAt !== undefined}
                      fallback={
                        <Show when={row.schedule.lastFiredAt !== undefined}>
                          <span class="sc-sep">·</span>
                          <span>上次 {clockText(row.schedule.lastFiredAt)}</span>
                        </Show>
                      }
                    >
                      <span class="sc-sep">·</span>
                      <span>
                        下次 {clockText(row.schedule.nextDueAt)}（{relativeTime(row.schedule.nextDueAt, now())}）
                      </span>
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
                  <Show when={expanded() === row.schedule.id}>
                    <ScheduleDetail row={row} now={now()} />
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  )
}
