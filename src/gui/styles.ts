/** Styles for the schedule center UI, injected once per window. */
const CSS_ID = "opencode-schedule-center-styles"

export function installStyles(): void {
  if (typeof document === "undefined") return
  let style = document.getElementById(CSS_ID) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement("style")
    style.id = CSS_ID
    document.head.appendChild(style)
  }
  style.textContent = CSS
}

/** Component-scoped copy injected at the root of SchedulePage, like the other plugins. */
export const CSS: string = `/* Schedule Center styles. Namespaced with sc- to avoid host collisions. */

.sc-root {
  --sc-strong: var(--color-v2-text-text-contrast, var(--color-text-strong, currentColor));
  --sc-muted: var(--color-v2-text-text-muted, var(--color-text-weak, color-mix(in srgb, currentColor 58%, transparent)));
  --sc-faint: var(--color-v2-text-text-faint, color-mix(in srgb, currentColor 42%, transparent));
  --sc-border: var(--color-v2-border-border-base, var(--color-border-weak-base, color-mix(in srgb, currentColor 12%, transparent)));
  --sc-card: var(--color-v2-background-bg-base, var(--color-surface-base, #fff));
  --sc-layer: var(--color-v2-background-bg-layer-01, #fafafa);
  --sc-layer-2: var(--color-v2-background-bg-layer-02, #f2f2f2);
  --sc-accent: #6d4aff;
  --sc-accent-hover: #5b3be0;
  --sc-blue: #3b82f6;
  --sc-teal: #0ea5a4;
  --sc-amber: #b45309;
  --sc-red: #d92d20;
  width: 100%;
  max-width: 1000px;
  margin: 0 auto;
  padding: 4px 0 36px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: var(--sc-strong);
  font-size: 13px;
}

.sc-root *, .sc-root *::before, .sc-root *::after { box-sizing: border-box; }
.sc-root button, .sc-root select, .sc-root input, .sc-root textarea { font: inherit; }

/* hero */
.sc-hero {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 22px;
  min-height: 112px;
  padding: 16px 20px;
  border: 1px solid var(--sc-border);
  border-radius: 14px;
  overflow: hidden;
  background:
    radial-gradient(120% 190% at 0% 0%, color-mix(in srgb, var(--sc-accent) 14%, transparent) 0%, transparent 55%),
    linear-gradient(115deg,
      color-mix(in srgb, var(--sc-accent) 4%, var(--sc-card)) 0%,
      color-mix(in srgb, var(--sc-accent) 3%, var(--sc-card)) 52%,
      color-mix(in srgb, var(--sc-blue) 3%, var(--sc-card)) 100%);
}
.sc-hero::after {
  content: "";
  position: absolute;
  right: 210px;
  bottom: -60px;
  width: 440px;
  height: 160px;
  background: radial-gradient(ellipse at center, color-mix(in srgb, var(--sc-accent) 11%, transparent), transparent 68%);
  pointer-events: none;
}
.sc-hero-copy { min-width: 0; position: relative; z-index: 1; }
.sc-kicker {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 5px;
  color: var(--sc-accent);
  font-size: 10px;
  font-weight: 750;
  letter-spacing: 0.13em;
}
.sc-kicker svg { width: 13px; height: 13px; }
.sc-hero-title {
  margin: 0;
  font-size: 21px;
  font-weight: 680;
  letter-spacing: -0.02em;
  line-height: 1.15;
  color: var(--sc-strong);
}
.sc-sub { margin: 4px 0 0; color: var(--sc-muted); font-size: 11.5px; line-height: 1.5; }
.sc-hero-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 7px;
  color: var(--sc-faint);
  font-size: 10.5px;
  flex-wrap: wrap;
}
.sc-hero-meta b { color: var(--sc-muted); font-weight: 620; }
.sc-hero-meta .sc-sep { width: 2px; height: 2px; }
.sc-hero-tools {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}
.sc-root[data-embedded="true"] .sc-hero { min-height: 98px; }
/* In the dialog the form should spend the height on content, not chrome. */
.sc-root[data-embedded="true"] { padding: 0 0 4px; gap: 10px; }

.sc-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.sc-tabs {
  display: flex;
  gap: 2px;
  background: var(--sc-layer, color-mix(in srgb, var(--sc-muted) 7%, transparent));
  border-radius: 8px;
  padding: 2px;
}

.sc-tab {
  border: none;
  background: transparent;
  color: var(--sc-muted);
  padding: 5px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
}

.sc-tab.active {
  background: var(--sc-layer-2, color-mix(in srgb, var(--sc-muted) 10%, var(--sc-card)));
  color: var(--sc-strong);
  font-weight: 500;
}

.sc-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sc-card {
  border: 1px solid var(--sc-border);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--sc-card);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  cursor: pointer;
  user-select: none;
}

.sc-card:focus-visible {
  outline: 2px solid var(--sc-accent);
  outline-offset: 1px;
}

.sc-card:hover {
  border-color: var(--sc-accent);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}

.sc-card.expanded {
  border-color: var(--sc-accent);
}

.sc-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.sc-card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.sc-name {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sc-card-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.sc-card-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  color: var(--sc-muted);
  font-size: 12px;
}

.sc-sep {
  display: inline-block;
  width: 2px;
  height: 2px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.55;
}

.sc-when {
  color: var(--sc-strong);
  font-weight: 500;
}

/* Advanced options (model / agent / directory) shown on each card. */
.sc-config {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.sc-config-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 2px 8px;
  border: 1px solid color-mix(in srgb, var(--sc-border) 70%, transparent);
  border-radius: 999px;
  background: var(--sc-layer, color-mix(in srgb, var(--sc-muted) 4%, transparent));
  color: var(--sc-muted);
  font-size: 11px;
  line-height: 16px;
}

.sc-config-chip svg {
  flex: 0 0 auto;
  width: 12px;
  height: 12px;
  opacity: 0.75;
}

.sc-config-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
}

.sc-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}

.sc-badge-active,
.sc-badge-ok {
  background: rgba(20, 184, 166, 0.15);
  color: #14b8a6;
}

/* Scheduling status is a lifecycle fact, not an execution verdict: 启用即强调,
   暂停即提醒, 结束用中性色 —— 正常跑完的任务不该被标红。 */
.sc-status-active {
  background: rgba(20, 184, 166, 0.15);
  color: #14b8a6;
}

.sc-status-paused {
  background: rgba(245, 158, 11, 0.15);
  color: #b45309;
}

.sc-status-done {
  background: rgba(127, 127, 127, 0.14);
  color: var(--sc-muted);
}

.sc-badge-paused,
.sc-badge-warn {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
}

.sc-badge-done,
.sc-badge-bad {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}

.sc-header-badge {
  margin-left: 6px;
}

.sc-detail {
  border-top: 1px dashed var(--sc-border);
  padding-top: 8px;
  /* The card disables selection for click-to-expand; the detail re-enables it
     so historical values can be selected and copied. */
  user-select: text;
  cursor: default;
}

.sc-detail-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 14px;
  font-size: 12px;
}

.sc-detail-key {
  color: var(--sc-muted);
}

.sc-detail-value {
  min-width: 0;
  overflow-wrap: anywhere;
  display: flex;
  align-items: center;
  gap: 6px;
  user-select: text;
}

.sc-detail-open {
  flex: none;
}

.sc-detail-text {
  min-width: 0;
  overflow-wrap: anywhere;
  user-select: text;
  cursor: text;
}

.sc-prompt-text {
  align-items: flex-start;
}

.sc-prompt-text .sc-detail-text {
  white-space: pre-wrap;
}

/* One-click copy affordance inside a detail value. */
.sc-copy {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--sc-faint);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}

.sc-copy:hover {
  background: var(--sc-layer-2, color-mix(in srgb, var(--sc-muted) 8%, transparent));
  color: var(--sc-strong);
}

.sc-copy:focus-visible {
  outline: 2px solid var(--sc-accent);
  outline-offset: 1px;
}

.sc-copy.copied {
  color: #14b8a6;
}

.sc-copy svg {
  width: 13px;
  height: 13px;
}

.sc-btn {
  border: 1px solid var(--sc-border);
  background: var(--sc-card);
  color: var(--sc-strong);
  border-radius: 9px;
  padding: 6px 14px;
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
  transition: background 0.12s ease, border-color 0.12s ease, opacity 0.12s ease, transform 0.06s ease;
}

.sc-btn:hover:not(:disabled) {
  border-color: var(--sc-accent);
}

.sc-btn:active:not(:disabled) {
  transform: translateY(1px);
}

.sc-btn:focus-visible {
  outline: 2px solid var(--sc-accent);
  outline-offset: 1px;
}

.sc-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.sc-btn-primary {
  border-color: transparent;
  background: linear-gradient(180deg, #7c5cff, var(--sc-accent));
  color: #fff;
  box-shadow: 0 4px 12px -6px rgba(109, 74, 255, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.16);
}

.sc-btn-primary:hover:not(:disabled) {
  border-color: transparent;
  background: linear-gradient(180deg, #8569ff, var(--sc-accent-hover));
}

.sc-btn-ghost {
  border-color: transparent;
  background: transparent;
  color: var(--sc-muted);
}

.sc-btn-danger {
  color: #ef4444;
}

.sc-btn-small {
  padding: 3px 10px;
  font-size: 12px;
  border-radius: 7px;
}

.sc-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  container-type: inline-size;
  container-name: scform;
}

/* The form body is a single column by default and folds into two columns on a
   wide container (the dialog / settings page): trigger on the left, prompt +
   advanced on the right. This spends the dialog's width instead of its height,
   so the whole form fits without scrolling. */
.sc-form-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

@container scform (min-width: 700px) {
  .sc-form-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-areas:
      "name    name"
      "trigger exec"
      "error   error";
    gap: 14px;
    align-items: start;
  }

  .sc-form-body .sc-name-field { grid-area: name; }
  .sc-form-body .sc-trigger-section { grid-area: trigger; }
  .sc-form-body .sc-exec-section { grid-area: exec; }
  .sc-form-body .sc-form-error { grid-area: error; }
}

/* Name is a title-style field, not another boxed row. */
.sc-name-field {
  gap: 6px;
}

.sc-input.sc-name-input {
  height: 42px;
  padding: 0 12px;
  border-radius: 10px;
  background: var(--sc-card);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.sc-input.sc-name-input:hover {
  border-color: color-mix(in srgb, var(--sc-border) 68%, var(--sc-accent) 32%);
}

.sc-input.sc-name-input:focus {
  background: var(--sc-card);
}

.sc-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px 16px;
  border: 1px solid var(--sc-border);
  border-radius: 13px;
  background: var(--sc-card);
}

.sc-section-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sc-mark {
  width: 3px;
  height: 13px;
  border-radius: 2px;
  background: linear-gradient(180deg, var(--sc-accent), color-mix(in srgb, var(--sc-accent) 30%, transparent));
}

.sc-section-title {
  margin: 0;
  color: var(--sc-strong);
  font-size: 12.5px;
  font-weight: 650;
  letter-spacing: 0.02em;
}

/* Segmented control for the trigger kind. */
.sc-kind {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  border-radius: 11px;
  background: var(--sc-layer-2, color-mix(in srgb, var(--sc-muted) 8%, transparent));
}

.sc-kind-item {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 34px;
  padding: 0 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--sc-muted);
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}

.sc-kind-item .sc-icon {
  width: 15px;
  height: 15px;
  opacity: 0.85;
}

.sc-kind-item:hover {
  background: color-mix(in srgb, var(--sc-card) 55%, transparent);
  color: var(--sc-strong);
}

.sc-kind-item.active {
  background: var(--sc-card);
  color: var(--sc-accent);
  font-weight: 650;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08), 0 0 0 0.5px color-mix(in srgb, var(--sc-border) 60%, transparent);
}

/* Contextual panel under the segmented control. It is its own container so the
   controls + next-run preview sit side by side only when there is room, and
   stack when the panel lands in a narrow (two-column form) column. */
.sc-panel {
  padding: 12px;
  border: 1px solid color-mix(in srgb, var(--sc-border) 70%, transparent);
  border-radius: 11px;
  background: var(--sc-layer, color-mix(in srgb, var(--sc-muted) 4%, transparent));
  container-type: inline-size;
  container-name: scpanel;
}

.sc-panel-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
}

@container scpanel (min-width: 520px) {
  .sc-panel-grid {
    grid-template-columns: minmax(0, 1fr) 224px;
    gap: 14px;
  }
}

.sc-panel-main {
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-width: 0;
}

.sc-panel-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.sc-panel-label {
  color: var(--sc-muted);
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.sc-panel-hint {
  color: var(--sc-faint);
  font-size: 11px;
}

.sc-control {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.sc-control-stack {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}

.sc-duration {
  position: relative;
  flex: 0 0 148px;
}

.sc-duration .sc-input {
  height: 36px;
  padding: 0 60px 0 12px;
  font-size: 14px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  -moz-appearance: textfield;
  appearance: textfield;
}

.sc-duration .sc-input::-webkit-inner-spin-button,
.sc-duration .sc-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.sc-unit {
  position: absolute;
  right: 44px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--sc-muted);
  font-size: 11px;
  pointer-events: none;
}

.sc-datetime {
  flex: 0 0 194px;
  height: 36px;
}

.sc-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}

.sc-chip {
  height: 26px;
  padding: 0 7px;
  border: 1px solid var(--sc-border);
  border-radius: 7px;
  background: var(--sc-card);
  color: var(--sc-muted);
  font: inherit;
  font-size: 11px;
  line-height: 24px;
  cursor: pointer;
  transition: border-color 0.12s ease, color 0.12s ease, background 0.12s ease;
}

.sc-chip:hover {
  border-color: color-mix(in srgb, var(--sc-accent) 50%, transparent);
  color: var(--sc-strong);
}

.sc-chip.active {
  border-color: color-mix(in srgb, var(--sc-accent) 55%, transparent);
  background: color-mix(in srgb, var(--sc-accent) 10%, var(--sc-card));
  color: var(--sc-accent);
  font-weight: 600;
}

.sc-chip:focus-visible,
.sc-kind-item:focus-visible,
.sc-advanced-toggle:focus-visible {
  outline: 2px solid var(--sc-accent);
  outline-offset: 1px;
}

/* Live next-run preview beside the timing controls. */
.sc-next {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--sc-border) 70%, transparent);
  border-radius: 9px;
  background: var(--sc-card);
}

.sc-next-head {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--sc-faint);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.sc-next-head .sc-icon {
  width: 12px;
  height: 12px;
}

.sc-next-primary {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
}

.sc-next-primary b {
  color: var(--sc-strong);
  font-size: 13px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}

.sc-next-primary em {
  color: var(--sc-accent);
  font-size: 11px;
  font-style: normal;
}

.sc-next-more {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.sc-next-chip {
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--sc-layer-2, color-mix(in srgb, var(--sc-muted) 8%, transparent));
  color: var(--sc-muted);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}

.sc-next-empty {
  color: var(--sc-red);
  font-size: 11.5px;
}

.sc-limit {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px dashed var(--sc-border);
  color: var(--sc-muted);
  font-size: 11px;
}

.sc-limit .sc-input {
  width: 62px;
  height: 26px;
  padding: 0 8px;
  text-align: center;
  font-size: 12px;
  -moz-appearance: textfield;
  appearance: textfield;
}

.sc-limit .sc-input::-webkit-inner-spin-button,
.sc-limit .sc-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

/* Execution: prompt and advanced options. */
.sc-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.sc-label-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.sc-counter {
  color: var(--sc-faint);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.sc-label {
  color: var(--sc-muted);
  font-size: 12px;
  font-weight: 500;
}

.sc-label-note {
  font-weight: 400;
  opacity: 0.7;
}

.sc-input.sc-textarea {
  min-height: 92px;
  height: auto;
  padding: 10px 12px;
  line-height: 1.6;
  resize: vertical;
}

.sc-advanced-wrap {
  margin-top: 2px;
  padding-top: 10px;
  border-top: 1px solid var(--sc-border);
}

.sc-advanced-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 5px 4px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--sc-strong);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s ease;
}

.sc-advanced-toggle:hover {
  background: var(--sc-layer, color-mix(in srgb, var(--sc-muted) 5%, transparent));
}

.sc-advanced-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: var(--sc-layer-2, color-mix(in srgb, var(--sc-muted) 8%, transparent));
  color: var(--sc-muted);
  transition: color 0.12s ease;
}

.sc-advanced-toggle:hover .sc-advanced-icon {
  color: var(--sc-accent);
}

.sc-advanced-icon .sc-icon {
  width: 15px;
  height: 15px;
}

.sc-advanced-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.sc-advanced-label {
  font-size: 12.5px;
  font-weight: 600;
}

.sc-advanced-sub {
  overflow: hidden;
  color: var(--sc-faint);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sc-advanced-chevron {
  display: flex;
  align-items: center;
  margin-left: auto;
  color: var(--sc-faint);
  transition: transform 0.18s ease;
}

.sc-advanced-chevron .sc-icon {
  width: 14px;
  height: 14px;
}

.sc-advanced-chevron.open {
  transform: rotate(90deg);
}

.sc-advanced {
  margin-top: 10px;
  padding: 12px;
  border: 1px solid color-mix(in srgb, var(--sc-border) 70%, transparent);
  border-radius: 10px;
  background: var(--sc-layer, color-mix(in srgb, var(--sc-muted) 4%, transparent));
  animation: sc-panel-in 0.18s ease;
  container-type: inline-size;
  container-name: scadv;
}

/* In a narrow column the advanced fields stack instead of squeezing two-up. */
@container scadv (max-width: 480px) {
  .sc-advanced .sc-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .sc-advanced .sc-span-2 {
    grid-column: auto;
  }
}

@keyframes sc-panel-in {
  from {
    opacity: 0;
    transform: translateY(-3px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.sc-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 14px;
  align-items: start;
}

.sc-span-2 {
  grid-column: 1 / -1;
}

.sc-dir-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sc-dir-row .sc-input {
  flex: 1;
}

.sc-model-summary {
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}

/* Inputs */
.sc-input {
  width: 100%;
  box-sizing: border-box;
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--sc-border);
  border-radius: 9px;
  background: var(--sc-layer, transparent);
  color: var(--sc-strong);
  font: inherit;
  font-size: 13px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}

.sc-input:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--sc-border) 68%, var(--sc-accent) 32%);
}

.sc-input:focus {
  outline: none;
  border-color: var(--sc-accent);
  background: var(--sc-card);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--sc-accent) 15%, transparent);
}

.sc-input:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

select.sc-input {
  padding-right: 28px;
}

/* Searchable provider / model picker. */
.sc-combo {
  position: relative;
}

.sc-combo-option[aria-selected="true"] .sc-combo-option-label {
  color: var(--sc-accent);
  font-weight: 600;
}

.sc-combo-input {
  padding-right: 26px;
}

.sc-combo.open .sc-combo-input {
  border-color: var(--sc-accent);
  background: var(--sc-card);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--sc-accent) 15%, transparent);
}

/* Clear affordance floats inside the input. */
.sc-combo-clear {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--sc-faint);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}

.sc-combo-clear:hover {
  background: var(--sc-layer-2, rgba(128, 128, 128, 0.14));
  color: var(--sc-strong);
}

.sc-combo-clear svg {
  width: 10px;
  height: 10px;
}

.sc-combo-list {
  position: absolute;
  z-index: 40;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 240px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--sc-border);
  border-radius: 10px;
  background: var(--sc-card);
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.2), 0 0 0 0.5px rgba(0, 0, 0, 0.08);
  animation: sc-panel-in 0.14s ease;
}

.sc-combo-count {
  padding: 3px 8px 4px;
  color: var(--sc-faint);
  font-size: 10px;
  letter-spacing: 0.04em;
}

.sc-combo-option {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.sc-combo-check {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 12px;
  height: 12px;
  color: var(--sc-accent);
  opacity: 0;
}

.sc-combo-check svg {
  width: 11px;
  height: 11px;
}

.sc-combo-option[aria-selected="true"] .sc-combo-check {
  opacity: 1;
}

.sc-combo-option.active {
  background: color-mix(in srgb, var(--sc-accent) 12%, transparent);
}

.sc-combo-option[aria-selected="true"] .sc-combo-option-label {
  color: var(--sc-accent);
  font-weight: 600;
}

.sc-combo-option-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sc-combo-option-note {
  margin-left: auto;
  padding-left: 8px;
  color: var(--sc-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sc-combo-option-badge {
  flex: 0 0 auto;
  border-radius: 999px;
  padding: 0 6px;
  background: rgba(245, 158, 11, 0.15);
  color: #b45309;
  font-size: 10px;
  line-height: 16px;
}

.sc-combo-empty {
  padding: 8px;
  color: var(--sc-muted);
  font-size: 12px;
}

.sc-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.sc-hint {
  margin: 0;
  font-size: 11.5px;
  color: var(--sc-muted);
}

.sc-hint-bad {
  color: #ef4444;
}

.sc-hint-warn {
  color: #d97706;
}

/* Sticky action bar with live status. */
.sc-form-actions {
  position: sticky;
  bottom: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 2px 6px;
  border-top: 1px solid var(--sc-border);
  background: var(--sc-card);
  box-shadow: 0 -12px 20px -18px rgba(15, 23, 42, 0.35);
}

.sc-form-status {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-right: auto;
  overflow: hidden;
  color: var(--sc-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sc-status-dot {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--sc-faint);
  transition: background 0.15s ease, box-shadow 0.15s ease;
}

.sc-status-dot.ready {
  background: #14b8a6;
  box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.14);
}

.sc-form-buttons {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
}

/* Status filter tabs on the list page. */
.sc-filters {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.sc-filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--sc-border);
  border-radius: 999px;
  background: var(--sc-card);
  color: var(--sc-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.12s ease, color 0.12s ease, background 0.12s ease;
}

.sc-filter:hover {
  border-color: color-mix(in srgb, var(--sc-accent) 45%, transparent);
  color: var(--sc-strong);
}

.sc-filter.active {
  border-color: transparent;
  background: var(--sc-accent);
  color: #fff;
  font-weight: 600;
}

.sc-filter-count {
  min-width: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--sc-layer-2, rgba(128, 128, 128, 0.14));
  color: inherit;
  font-size: 10.5px;
  font-weight: 600;
  line-height: 16px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.sc-filter.active .sc-filter-count {
  background: rgba(255, 255, 255, 0.22);
}

/* Inline task search, right of the filter pills. */
.sc-search {
  flex: 1 1 140px;
  max-width: 220px;
  min-width: 120px;
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 12px;
}

/* Last run output in the detail view: pre-wrapped, capped. */
.sc-output-text {
  white-space: pre-wrap;
  max-height: 140px;
  overflow-y: auto;
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--sc-muted);
}

.sc-empty-slim {
  padding: 20px;
  flex-direction: row;
  justify-content: center;
}

.sc-empty-slim .sc-empty-title {
  font-size: 12.5px;
  font-weight: 400;
  color: var(--sc-muted);
}

/* Compact ± steppers for numeric inputs. */
.sc-scrollers {
  position: absolute;
  right: 3px;
  top: 4px;
  bottom: 4px;
  display: flex;
  flex-direction: column;
  border-radius: 5px;
  overflow: hidden;
}

.sc-scrollers button {
  flex: 1;
  width: 20px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--sc-faint);
  font-size: 9px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}

.sc-scrollers button:hover {
  background: var(--sc-layer-2, rgba(128, 128, 128, 0.14));
  color: var(--sc-strong);
}

/* The limit stepper lives inline in the preview card. */
.sc-stepper {
  display: flex;
  align-items: center;
  border: 1px solid var(--sc-border);
  border-radius: 7px;
  background: var(--sc-card);
  overflow: hidden;
}

.sc-stepper .sc-input {
  width: 44px;
  height: 24px;
  border: none;
  border-radius: 0;
  padding: 0 4px;
  text-align: center;
  font-size: 12px;
  background: transparent;
  -moz-appearance: textfield;
  appearance: textfield;
}

.sc-stepper .sc-input:focus {
  box-shadow: none;
  background: transparent;
}

.sc-stepper .sc-input::-webkit-inner-spin-button,
.sc-stepper .sc-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.sc-step {
  width: 20px;
  height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--sc-muted);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}

.sc-step:hover:not(:disabled) {
  background: var(--sc-layer-2, rgba(128, 128, 128, 0.12));
  color: var(--sc-strong);
}

.sc-step:disabled {
  opacity: 0.4;
  cursor: default;
}

/* Armed delete: pulse gently so the second click is obvious. */
.sc-confirm-btn,
.sc-btn-danger.sc-btn-small {
  min-width: 64px;
}

@keyframes sc-confirm-pulse {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.35);
  }
  50% {
    box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.18);
  }
}

.sc-btn-danger.sc-btn-small:not(:disabled) {
  animation: none;
}

.sc-btn-danger.sc-btn-small.confirm-armed {
  animation: sc-confirm-pulse 1.2s ease infinite;
}

.sc-empty {
  border: 1px dashed var(--sc-border);
  border-radius: 10px;
  padding: 28px;
  text-align: center;
  color: var(--sc-muted);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.sc-empty-title {
  margin: 0;
  font-weight: 500;
  color: var(--sc-strong);
}

.sc-empty-hint {
  margin: 0;
  font-size: 12px;
}

/* Transitions for the expand/collapse of card details. */
.sc-detail {
  animation: sc-detail-in 0.15s ease;
}

@keyframes sc-detail-in {
  from {
    opacity: 0;
    transform: translateY(-2px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.sc-dialog {
  display: flex;
  flex-direction: column;
  width: min(720px, 90vw);
  max-height: 82vh;
}

.sc-dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--sc-border);
}

.sc-dialog-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.sc-dialog-body {
  overflow-y: auto;
  padding-top: 12px;
}

.sc-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--sc-muted);
  cursor: default;
  white-space: nowrap;
}

.sc-pill-next {
  font-variant-numeric: tabular-nums;
}

@media (max-width: 720px) {
  .sc-panel {
    grid-template-columns: minmax(0, 1fr);
  }

  .sc-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .sc-span-2 {
    grid-column: auto;
  }

  .sc-form-status {
    display: none;
  }
}

/* Reduced motion: keep the state changes, drop the animation. */
@media (prefers-reduced-motion: reduce) {
  .sc-advanced,
  .sc-detail,
  .sc-combo-list {
    animation: none !important;
  }

  .sc-advanced-chevron {
    transition: none !important;
  }

  .sc-btn-danger.sc-btn-small.confirm-armed {
    animation: none !important;
    box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.18);
  }

  .sc-btn:active:not(:disabled) {
    transform: none;
  }
}
`
