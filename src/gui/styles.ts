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
  max-width: 1180px;
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
}

.sc-prompt-text {
  white-space: pre-wrap;
}

.sc-btn {
  border: 1px solid var(--sc-border);
  background: var(--sc-card);
  color: var(--sc-strong);
  border-radius: 8px;
  padding: 6px 14px;
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
  transition: background 0.12s ease, border-color 0.12s ease, opacity 0.12s ease;
}

.sc-btn:hover:not(:disabled) {
  border-color: var(--sc-accent);
}

.sc-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.sc-btn-primary {
  background: var(--sc-accent);
  border-color: transparent;
  color: #fff;
}

.sc-btn-primary:hover:not(:disabled) {
  background: var(--sc-accent-hover);
  border-color: transparent;
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
  gap: 16px;
}

.sc-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  border: 1px solid var(--sc-border);
  border-radius: 10px;
  padding: 12px 14px;
  background: var(--sc-layer, color-mix(in srgb, var(--sc-muted) 4%, transparent));
}

.sc-section-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--sc-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.sc-label-note {
  font-weight: 400;
  opacity: 0.7;
  margin-left: 4px;
}

.sc-advanced-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: none;
  color: var(--sc-muted);
  font-size: 12px;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
}

.sc-advanced-toggle:hover {
  color: var(--sc-strong);
}

.sc-advanced-chevron {
  display: inline-block;
  transition: transform 0.15s ease;
  font-size: 10px;
}

.sc-advanced-chevron.open {
  transform: rotate(90deg);
}

.sc-advanced {
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-left: 2px solid var(--border, rgba(128, 128, 128, 0.2));
  padding-left: 12px;
  margin-left: 4px;
}

.sc-dir-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.sc-dir-row .sc-input {
  flex: 1;
}

.sc-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.sc-label {
  font-size: 12px;
  color: var(--sc-muted);
  font-weight: 500;
}

.sc-input {
  border: 1px solid var(--sc-border);
  border-radius: 8px;
  background: var(--sc-layer, transparent);
  color: var(--sc-strong);
  padding: 7px 10px;
  font-size: 13px;
  font-family: inherit;
  width: 100%;
  box-sizing: border-box;
}

.sc-input:focus {
  outline: none;
  border-color: var(--sc-accent);
}

.sc-textarea {
  resize: vertical;
}

/* Searchable provider / model picker. */
.sc-combo {
  position: relative;
}

.sc-combo-input {
  padding-right: 10px;
}

.sc-combo-list {
  position: absolute;
  z-index: 40;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 216px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--sc-border);
  border-radius: 8px;
  background: var(--sc-card);
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18), 0 0 0 0.5px rgba(0, 0, 0, 0.08);
}

.sc-combo-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
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

.sc-variant {
  margin-top: 2px;
}

.sc-model-summary {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  overflow-wrap: anywhere;
}

.sc-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.sc-segment {
  display: flex;
  gap: 2px;
  background: var(--sc-layer, color-mix(in srgb, var(--sc-muted) 7%, transparent));
  border-radius: 8px;
  padding: 2px;
  width: fit-content;
}

.sc-segment-item {
  border: none;
  background: transparent;
  color: var(--sc-muted);
  padding: 5px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
}

.sc-segment-item.active {
  background: var(--sc-layer-2, color-mix(in srgb, var(--sc-muted) 10%, var(--sc-card)));
  color: var(--sc-strong);
  font-weight: 500;
}

.sc-hint {
  margin: 0;
  font-size: 12px;
  color: var(--sc-muted);
}

.sc-hint-bad {
  color: #ef4444;
}

.sc-previews {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.sc-preview-chip {
  border: 1px solid var(--sc-border);
  border-radius: 6px;
  padding: 2px 8px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  background: var(--sc-card);
}

.sc-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
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
`
