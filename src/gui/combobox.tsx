import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"

export interface ComboOption {
  value: string
  label: string
  /** Secondary text, e.g. the model id or provider id. */
  note?: string
  /** A short trailing tag, e.g. the model's status. */
  badge?: string
  /** Extra search terms that are not displayed. */
  keywords?: string
}

/**
 * A searchable single-select input. Native `<select>` cannot search and makes
 * duplicate labels across providers hard to tell apart, so the form uses this
 * combobox for providers and models instead.
 */
export function Combobox(props: {
  id?: string
  value: string
  options: ComboOption[]
  placeholder?: string
  emptyText?: string
  disabled?: boolean
  onSelect: (value: string) => void
}) {
  const [open, setOpen] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  const [active, setActive] = createSignal(-1)
  let root: HTMLDivElement | undefined
  let list: HTMLDivElement | undefined
  let input: HTMLInputElement | undefined

  const selected = createMemo(() => props.options.find((option) => option.value === props.value))
  const query = createMemo(() => draft().trim().toLowerCase())
  const filtering = createMemo(() => {
    const value = query()
    return value.length > 0 && value !== (selected()?.label ?? "").trim().toLowerCase()
  })
  const filtered = createMemo(() => {
    if (!filtering()) return props.options
    const value = query()
    return props.options.filter((option) => {
      const haystack = `${option.label} ${option.note ?? ""} ${option.keywords ?? ""} ${option.value}`
      return haystack.toLowerCase().includes(value)
    })
  })

  // Keep the closed input in sync with the outside value (async options, reset).
  createEffect(() => {
    const label = selected()?.label ?? ""
    if (!open()) setDraft(label)
  })

  onMount(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (root && !root.contains(event.target as Node)) closeList()
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    onCleanup(() => document.removeEventListener("pointerdown", onPointerDown, true))
  })

  function openList() {
    if (props.disabled) return
    setOpen(true)
    setDraft(selected()?.label ?? "")
    setActive(props.options.findIndex((option) => option.value === props.value))
  }

  /** Select the current label so the next keystroke starts a search. */
  function selectAllText() {
    setTimeout(() => {
      if (input && document.activeElement === input) input.select()
    }, 0)
  }

  function closeList() {
    setOpen(false)
    setDraft(selected()?.label ?? "")
    setActive(-1)
  }

  function choose(option: ComboOption) {
    props.onSelect(option.value)
    setOpen(false)
    setDraft(option.label)
    setActive(-1)
  }

  function move(delta: number) {
    const items = filtered()
    if (items.length === 0) return
    const current = active()
    const next =
      current < 0
        ? delta > 0
          ? 0
          : items.length - 1
        : (current + delta + items.length) % items.length
    setActive(next)
  }

  function onKeyDown(event: KeyboardEvent) {
    if (props.disabled) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      if (open()) move(1)
      else openList()
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      if (open()) move(-1)
      else openList()
      return
    }
    if (event.key === "Enter") {
      const option = open() ? filtered()[active()] : undefined
      if (option) {
        event.preventDefault()
        choose(option)
      }
      return
    }
    if (event.key === "Escape" && open()) {
      event.preventDefault()
      closeList()
    }
  }

  // Keep the active option visible while arrowing through a long list.
  createEffect(() => {
    const index = active()
    if (!open() || index < 0 || !list) return
    const node = list.children[index] as HTMLElement | undefined
    node?.scrollIntoView({ block: "nearest" })
  })

  return (
    <div class="sc-combo" ref={root}>
      <input
        id={props.id}
        ref={input}
        class="sc-input sc-combo-input"
        autocomplete="off"
        spellcheck={false}
        value={draft()}
        placeholder={props.placeholder}
        disabled={props.disabled}
        role="combobox"
        aria-expanded={open()}
        aria-autocomplete="list"
        onFocus={() => {
          openList()
          selectAllText()
        }}
        onClick={() => {
          if (!open()) openList()
          if (!filtering()) selectAllText()
        }}
        onInput={(event) => {
          setDraft(event.currentTarget.value)
          setOpen(true)
          setActive(0)
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // Let a click on an option land before deciding focus left the combobox.
          setTimeout(() => {
            if (root && !root.contains(document.activeElement)) closeList()
          }, 0)
        }}
      />
      <Show when={open()}>
        <div class="sc-combo-list" role="listbox" ref={list}>
          <Show
            when={filtered().length > 0}
            fallback={<div class="sc-combo-empty">{props.emptyText ?? "没有匹配项"}</div>}
          >
            <For each={filtered()}>
              {(option, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === props.value}
                  class="sc-combo-option"
                  classList={{ active: index() === active() }}
                  onPointerDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index())}
                  onClick={() => choose(option)}
                >
                  <span class="sc-combo-option-label">{option.label}</span>
                  <Show when={option.note}>
                    <span class="sc-combo-option-note">{option.note}</span>
                  </Show>
                  <Show when={option.badge}>
                    <span class="sc-combo-option-badge">{option.badge}</span>
                  </Show>
                </button>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  )
}
