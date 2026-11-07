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
  style.textContent = CSS_TEXT
}

const CSS_TEXT = `
/* Schedule Center styles. Namespaced with sc- to avoid host collisions. */

.sc-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 13px;
  color: var(--text-primary, inherit);
}

.sc-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.sc-tabs {
  display: flex;
  gap: 2px;
  background: var(--background-muted, rgba(128, 128, 128, 0.1));
  border-radius: 8px;
  padding: 2px;
}

.sc-tab {
  border: none;
  background: transparent;
  color: var(--text-muted, inherit);
  padding: 5px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
}

.sc-tab.active {
  background: var(--background-elevated, rgba(128, 128, 128, 0.18));
  color: var(--text-primary, inherit);
  font-weight: 500;
}

.sc-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sc-card {
  border: 1px solid var(--border, rgba(128, 128, 128, 0.25));
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--background-elevated, transparent);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  cursor: pointer;
  user-select: none;
}

.sc-card:focus-visible {
  outline: 2px solid var(--interactive-accent, #6d4aff);
  outline-offset: 1px;
}

.sc-card:hover {
  border-color: var(--border-active, rgba(109, 74, 255, 0.35));
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}

.sc-card.expanded {
  border-color: var(--border-active, rgba(109, 74, 255, 0.5));
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
  color: var(--text-muted, inherit);
  font-size: 12px;
}

.sc-sep {
  opacity: 0.5;
}

.sc-when {
  color: var(--text-primary, inherit);
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
  border-top: 1px dashed var(--border, rgba(128, 128, 128, 0.25));
  padding-top: 8px;
}

.sc-detail-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 14px;
  font-size: 12px;
}

.sc-detail-key {
  color: var(--text-muted, inherit);
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
  border: 1px solid var(--border, rgba(128, 128, 128, 0.3));
  background: var(--background-elevated, transparent);
  color: var(--text-primary, inherit);
  border-radius: 8px;
  padding: 6px 14px;
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
  transition: background 0.12s ease, border-color 0.12s ease, opacity 0.12s ease;
}

.sc-btn:hover:not(:disabled) {
  border-color: var(--border-active, rgba(109, 74, 255, 0.4));
}

.sc-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.sc-btn-primary {
  background: var(--interactive-accent, #6d4aff);
  border-color: transparent;
  color: #fff;
}

.sc-btn-primary:hover:not(:disabled) {
  background: var(--interactive-accent-hover, #5b3be0);
  border-color: transparent;
}

.sc-btn-ghost {
  border-color: transparent;
  background: transparent;
  color: var(--text-muted, inherit);
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
  border: 1px solid var(--border, rgba(128, 128, 128, 0.18));
  border-radius: 10px;
  padding: 12px 14px;
  background: var(--background-muted, rgba(128, 128, 128, 0.04));
}

.sc-section-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted, inherit);
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
  color: var(--text-muted, inherit);
  font-size: 12px;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
}

.sc-advanced-toggle:hover {
  color: var(--text-primary, inherit);
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
  color: var(--text-muted, inherit);
  font-weight: 500;
}

.sc-input {
  border: 1px solid var(--border, rgba(128, 128, 128, 0.3));
  border-radius: 8px;
  background: var(--background-muted, transparent);
  color: var(--text-primary, inherit);
  padding: 7px 10px;
  font-size: 13px;
  font-family: inherit;
  width: 100%;
  box-sizing: border-box;
}

.sc-input:focus {
  outline: none;
  border-color: var(--interactive-accent, #6d4aff);
}

.sc-textarea {
  resize: vertical;
}

.sc-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.sc-segment {
  display: flex;
  gap: 2px;
  background: var(--background-muted, rgba(128, 128, 128, 0.1));
  border-radius: 8px;
  padding: 2px;
  width: fit-content;
}

.sc-segment-item {
  border: none;
  background: transparent;
  color: var(--text-muted, inherit);
  padding: 5px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
}

.sc-segment-item.active {
  background: var(--background-elevated, rgba(128, 128, 128, 0.18));
  color: var(--text-primary, inherit);
  font-weight: 500;
}

.sc-hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted, inherit);
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
  border: 1px solid var(--border, rgba(128, 128, 128, 0.25));
  border-radius: 6px;
  padding: 2px 8px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  background: var(--background-elevated, transparent);
}

.sc-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.sc-empty {
  border: 1px dashed var(--border, rgba(128, 128, 128, 0.3));
  border-radius: 10px;
  padding: 28px;
  text-align: center;
  color: var(--text-muted, inherit);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.sc-empty-title {
  margin: 0;
  font-weight: 500;
  color: var(--text-primary, inherit);
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
  border-bottom: 1px solid var(--border, rgba(128, 128, 128, 0.25));
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
  color: var(--text-muted, inherit);
  cursor: default;
  white-space: nowrap;
}

.sc-pill-next {
  font-variant-numeric: tabular-nums;
}
`
