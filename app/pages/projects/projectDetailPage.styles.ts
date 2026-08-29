/**
 * ProjectDetailPage inline stylesheet — mechanical extraction, no behavior
 * change. Pure CSS-in-template-literal, injected via <style>{CSS}</style>
 * in ProjectDetailPage.tsx (unchanged).
 */
export const CSS = `
/* root: left col + right rail */
.cpd-root {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
  background: var(--dashboard-canvas);
  color: var(--color-main, #e2e8f0);
  overflow: hidden;
}

/* ── left column ── */
.cpd-left {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: visible;
  padding: 24px 0 0;
  max-width: 660px;
  margin: 0 auto;
  width: 100%;
}
.cpd-left-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 60px;
}

/* back */
.cpd-back-row {
  padding: 0 28px;
  margin-bottom: 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.cpd-back {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--color-muted, #94a3b8);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  transition: color 0.12s;
}
.cpd-back:hover { color: var(--color-main, #e2e8f0); }

/* mobile details toggle */
.cpd-details-toggle {
  font-size: 12px;
  color: var(--solar-cyan, #22d3ee);
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: background 0.1s;
}
.cpd-details-toggle:hover { background: rgba(34,211,238,0.08); }

/* title */
.cpd-title-section {
  padding: 0 28px;
  margin-bottom: 20px;
  position: relative;
  z-index: 60;
  overflow: visible;
}
.cpd-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  overflow: visible;
}
.cpd-title {
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.02em;
  margin: 0;
  line-height: 1.15;
  flex: 1;
  min-width: 0;
}
.cpd-title-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  overflow: visible;
}
.cpd-rename-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cpd-rename-input {
  flex: 1;
  font-size: 22px;
  font-weight: 600;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--solar-cyan, #22d3ee);
  color: inherit;
  outline: none;
  padding: 2px 4px;
}

/* icon btn */
.cpd-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 5px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--color-muted, #94a3b8);
  cursor: pointer;
  font-size: 12px;
  transition: background 0.1s, color 0.1s;
}
.cpd-icon-btn:hover { background: var(--bg-hover); color: var(--color-main, #e2e8f0); }
.cpd-icon-btn:disabled { opacity: 0.4; cursor: default; }

/* more menu */
.cpd-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  left: auto;
  z-index: 200;
  min-width: 200px;
  border-radius: 10px;
  border: 1px solid var(--dashboard-border);
  background: var(--bg-elevated, #1e2130);
  box-shadow: 0 8px 24px rgba(0,0,0,0.3);
  padding: 4px 0;
}
.cpd-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 14px;
  font-size: 13px;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  transition: background 0.1s;
}
.cpd-menu-item:hover { background: var(--bg-hover); }
.cpd-menu-item--danger { color: #f87171; }
.cpd-menu-item--danger:hover { background: rgba(248, 113, 113, 0.12); }

.cpd-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 500;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.cpd-modal {
  width: min(420px, 100%);
  border-radius: 12px;
  border: 1px solid var(--dashboard-border);
  background: var(--bg-elevated, #1e2130);
  padding: 20px 22px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
}
.cpd-modal-title { margin: 0 0 10px; font-size: 18px; font-weight: 600; }
.cpd-modal-body { margin: 0 0 8px; font-size: 14px; line-height: 1.45; }
.cpd-modal-meta { color: var(--color-muted, #94a3b8); font-size: 12px; }
.cpd-modal-hint { margin: 0 0 16px; font-size: 12px; color: var(--color-muted, #94a3b8); line-height: 1.5; }
.cpd-modal-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.cpd-btn {
  border-radius: 8px;
  border: 1px solid var(--dashboard-border);
  background: transparent;
  color: inherit;
  font-size: 13px;
  font-weight: 600;
  padding: 8px 14px;
  cursor: pointer;
}
.cpd-btn--danger {
  border-color: rgba(248, 113, 113, 0.45);
  background: rgba(248, 113, 113, 0.14);
  color: #fca5a5;
}
.cpd-btn--primary {
  border-color: rgba(34, 211, 238, 0.35);
  background: rgba(34, 211, 238, 0.18);
  color: var(--color-main, #e2e8f0);
}
.cpd-btn--primary:hover:not(:disabled) {
  background: rgba(34, 211, 238, 0.28);
}
.cpd-btn:disabled { opacity: 0.5; cursor: default; }

/* ── rail preview cards (Claude-style — click to expand) ── */
.cpd-rail-preview {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--dashboard-border);
  background: var(--dashboard-panel, rgba(255,255,255,0.03));
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
}
.cpd-rail-preview:hover {
  border-color: rgba(34, 211, 238, 0.35);
  background: rgba(34, 211, 238, 0.06);
}
.cpd-rail-preview-text {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
  color: var(--color-main, #e2e8f0);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 5.5em;
  overflow: hidden;
}
.cpd-rail-preview-empty {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-muted, #94a3b8);
}
.cpd-code-index-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 10px;
  flex: 1;
  min-width: 0;
}
.cpd-code-index-top {
  display: flex;
  align-items: center;
  gap: 10px;
}
.cpd-code-ring {
  --pct: 0;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  background: conic-gradient(
    var(--solar-cyan, #22d3ee) calc(var(--pct) * 1%),
    rgba(148, 163, 184, 0.25) 0
  );
  position: relative;
}
.cpd-code-ring::after {
  content: '';
  position: absolute;
  inset: 4px;
  border-radius: 50%;
  background: var(--bg-elevated, #1a1d2e);
}
.cpd-code-ring-pct {
  position: relative;
  z-index: 1;
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--color-main, #e2e8f0);
  max-width: 36px;
  text-align: center;
  line-height: 1;
  white-space: nowrap;
}
.cpd-code-ring--running {
  background: conic-gradient(
    var(--solar-cyan, #22d3ee) calc(var(--pct) * 1%),
    rgba(34, 211, 238, 0.15) 0
  );
}
.cpd-code-ring--ok {
  background: conic-gradient(#34d399 100%, #34d399 0);
  transition: background 0.45s ease;
}
.cpd-code-ring--calls {
  background: conic-gradient(#a78bfa 100%, #a78bfa 0);
  transition: background 0.45s ease;
}
.cpd-code-ring--error {
  background: conic-gradient(#f87171 100%, #f87171 0);
}
.cpd-code-ring--action {
  appearance: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  color: inherit;
  font: inherit;
}
.cpd-code-ring--action:disabled {
  cursor: default;
}
.cpd-code-ring--action:not(:disabled):hover .cpd-code-ring-pct {
  color: #a78bfa;
}
.cpd-code-ring-pct svg {
  display: block;
  margin: 0 auto;
}
.cpd-code-index-label {
  display: block;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-muted, #94a3b8);
}
.cpd-code-index-val {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--color-main, #e2e8f0);
}
.cpd-code-index-meta {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--color-muted, #94a3b8);
  line-height: 1.35;
}
.cpd-code-index-ws {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  color: var(--solar-cyan, #22d3ee);
}
.cpd-code-index-status {
  margin: 4px 0 0;
  font-size: 11px;
  line-height: 1.35;
}
.cpd-code-index-status--running {
  color: var(--solar-cyan, #22d3ee);
}
.cpd-code-index-status--ok {
  color: #34d399;
}
.cpd-code-index-status--error {
  color: #f87171;
}
.cpd-code-index-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0 2px;
  align-items: flex-start;
}
.cpd-code-index-ctrl {
  appearance: none;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(15, 23, 42, 0.55);
  color: inherit;
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  padding: 5px 10px;
  border-radius: 4px;
  cursor: pointer;
}
.cpd-code-index-ctrl:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.cpd-code-index-ctrl--stop {
  border-color: rgba(248, 113, 113, 0.55);
  color: #fca5a5;
}
.cpd-code-index-ctrl--continue {
  border-color: rgba(52, 211, 153, 0.55);
  color: #6ee7b7;
}
.cpd-code-index-prev-foot {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid rgba(148, 163, 184, 0.14);
}
.cpd-code-index-prev-toggle {
  appearance: none;
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: 0;
  background: transparent;
  color: var(--color-muted, #94a3b8);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  padding: 2px 0;
  cursor: pointer;
}
.cpd-code-index-prev-toggle:hover {
  color: var(--color-main, #e2e8f0);
}
.cpd-code-index-prev-toggle-meta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-variant-numeric: tabular-nums;
  opacity: 0.9;
}
.cpd-code-index-prev-list {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  max-height: 180px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cpd-code-index-prev-item {
  display: block;
  width: 100%;
  text-align: left;
  appearance: none;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  line-height: 1.35;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
}
.cpd-code-index-prev-item:hover {
  background: rgba(34, 211, 238, 0.12);
}
.cpd-code-index-prev-item--on {
  background: rgba(167, 139, 250, 0.16);
  color: #c4b5fd;
}
.cpd-gh-empty {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-start;
}
.cpd-gh-connect-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(34, 211, 238, 0.35);
  background: rgba(34, 211, 238, 0.12);
  color: var(--solar-cyan, #22d3ee);
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.cpd-gh-connect-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.cpd-gh-bound {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px 8px;
  margin-bottom: 8px;
}
.cpd-gh-bound-repo {
  flex: 1 1 140px;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: none;
  background: transparent;
  padding: 0;
  margin: 0;
  text-align: left;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  color: var(--solar-cyan, #22d3ee);
  cursor: pointer;
}
.cpd-gh-bound-repo:hover,
.cpd-gh-bound-repo:focus-visible {
  text-decoration: underline;
  outline: none;
}
.cpd-gh-bound-repo--expanded {
  flex-basis: 100%;
  overflow: visible;
  text-overflow: unset;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.cpd-gh-bound-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
  margin-left: auto;
}
.cpd-gh-link-btn {
  border: none;
  background: transparent;
  color: var(--color-muted, #94a3b8);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
}
.cpd-gh-link-btn:hover:not(:disabled) {
  color: var(--color-main, #e2e8f0);
}
.cpd-gh-link-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.cpd-gh-picker {
  margin-top: 10px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.45);
  overflow: hidden;
}
.cpd-gh-picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-muted, #94a3b8);
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
}
.cpd-gh-picker-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
  color: var(--color-muted, #94a3b8);
}
.cpd-gh-picker-search input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--color-main, #e2e8f0);
  font-size: 12px;
}
.cpd-gh-picker-list {
  max-height: 220px;
  overflow-y: auto;
  padding: 6px;
}
.cpd-gh-repo-row {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  text-align: left;
  border: none;
  background: transparent;
  border-radius: 8px;
  padding: 8px;
  cursor: pointer;
  color: var(--color-main, #e2e8f0);
}
.cpd-gh-repo-row:hover:not(:disabled) {
  background: rgba(148, 163, 184, 0.12);
}
.cpd-gh-repo-row--selected {
  background: rgba(34, 211, 238, 0.12);
}
.cpd-gh-repo-row:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.cpd-gh-repo-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
}
.cpd-gh-repo-branch {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--color-muted, #94a3b8);
}
.cpd-rail-preview-foot {
  font-size: 10px;
  color: var(--color-muted, #94a3b8);
}
.cpd-rail-preview--cover { padding: 8px; }
.cpd-rail-cover-thumb {
  width: 100%;
  max-height: 88px;
  object-fit: cover;
  border-radius: 8px;
  display: block;
}
.cpd-rail-files-mini {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.cpd-rail-files-mini img {
  width: 36px;
  height: 36px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--dashboard-border);
}
.cpd-quick-stats--compact { margin: 0; }
.cpd-rail-actions { display: flex; align-items: center; gap: 2px; }
.cpd-rail-actions--storage { position: relative; }
.cpd-storage-anchor { position: relative; }
.cpd-icon-btn--active {
  background: var(--bg-hover);
  color: var(--color-main, #e2e8f0);
}
.cpd-storage-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 540;
  width: min(360px, calc(100vw - 32px));
  padding: 14px;
  border-radius: 12px;
  border: 1px solid var(--dashboard-border);
  background: var(--dashboard-panel, #0f172a);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.35);
}
.cpd-storage-panel--sheet {
  position: fixed;
  top: auto;
  right: 12px;
  left: 12px;
  bottom: 12px;
  width: auto;
  max-height: min(72vh, 640px);
  overflow: auto;
}
.cpd-storage-panel-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.cpd-storage-panel-head-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.cpd-storage-panel-head-copy strong {
  font-size: 13px;
  font-weight: 600;
}
.cpd-storage-panel-head-copy span {
  font-size: 11px;
  color: var(--color-muted, #94a3b8);
}
.cpd-storage-summary {
  display: grid;
  gap: 8px;
  padding: 10px;
  margin-bottom: 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--dashboard-border);
}
.cpd-storage-summary-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  font-size: 11px;
}
.cpd-storage-summary-row span:first-child {
  color: var(--color-muted, #94a3b8);
}
.cpd-storage-summary-row code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: var(--color-main, #e2e8f0);
  word-break: break-all;
  text-align: right;
}
.cpd-storage-connections {
  display: grid;
  gap: 8px;
  margin-bottom: 10px;
}
.cpd-storage-connection {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--dashboard-border);
  background: rgba(255, 255, 255, 0.02);
}
.cpd-storage-connection--empty {
  opacity: 0.72;
}
.cpd-storage-connection-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.cpd-storage-connection-copy strong {
  font-size: 12px;
  font-weight: 600;
}
.cpd-storage-connection-copy span {
  font-size: 11px;
  color: var(--color-muted, #94a3b8);
  word-break: break-all;
}
.cpd-storage-advanced-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 0;
  border: none;
  background: transparent;
  color: var(--color-muted, #94a3b8);
  font-size: 11px;
  cursor: pointer;
}
.cpd-storage-advanced-chevron--open {
  transform: rotate(180deg);
}
.cpd-storage-advanced {
  display: grid;
  gap: 10px;
  padding-top: 4px;
}
.cpd-storage-advanced-note {
  margin: 0;
  font-size: 11px;
  color: var(--color-muted, #94a3b8);
  line-height: 1.45;
}
.cpd-storage-panel-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.cpd-editor-field {
  display: grid;
  gap: 6px;
}
.cpd-editor-field > span {
  font-size: 11px;
  color: var(--color-muted, #94a3b8);
}
.cpd-editor-input {
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--dashboard-border);
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-main, #e2e8f0);
  font-size: 12px;
}
.cpd-rail-preview-inner {
  display: block;
  width: 100%;
  padding: 0;
  margin: 8px 0 0;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.cpd-rail-preview--stats { cursor: default; }
.cpd-spin { animation: cpd-spin 0.85s linear infinite; }
@keyframes cpd-spin { to { transform: rotate(360deg); } }
.cpd-timer-widget {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  padding: 8px 10px;
  margin-bottom: 8px;
  border-radius: 10px;
  border: 1px solid var(--dashboard-border);
  background: rgba(255,255,255,0.02);
}
.cpd-timer-widget--running {
  border-color: rgba(34, 197, 94, 0.45);
  background: rgba(34, 197, 94, 0.08);
}
.cpd-timer-widget--modal { margin-bottom: 14px; }
.cpd-timer-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.cpd-timer-btn--start {
  background: rgba(34, 211, 238, 0.15);
  border-color: rgba(34, 211, 238, 0.35);
  color: #67e8f9;
}
.cpd-timer-btn--stop {
  background: rgba(248, 113, 113, 0.12);
  border-color: rgba(248, 113, 113, 0.35);
  color: #fca5a5;
}
.cpd-timer-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.cpd-timer-label { font-size: 11px; color: var(--color-muted, #94a3b8); }
.cpd-timer-mins { font-size: 11px; font-weight: 600; margin-left: auto; }
.cpd-brand-swatches { display: flex; gap: 6px; margin-bottom: 6px; }
.cpd-brand-swatch {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 1px solid rgba(255,255,255,0.15);
}
.cpd-brand-swatch--muted { opacity: 0.72; }
.cpd-brand-drop .cpd-files-text { font-size: 12px; }
.cpd-brand-token-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px;
  margin-bottom: 14px;
}
.cpd-brand-token-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--color-muted, #94a3b8);
}
.cpd-brand-token-field input[type="color"] {
  width: 44px;
  height: 32px;
  padding: 2px;
  border-radius: 8px;
  border: 1px solid var(--dashboard-border);
  background: transparent;
  cursor: pointer;
}
.cpd-brand-browser-link { margin-top: 12px; display: inline-flex; align-items: center; gap: 6px; }
.cpd-stats-links { display: flex; flex-wrap: wrap; gap: 10px; }
.cpd-btn--ghost {
  background: transparent;
  border: 1px solid var(--dashboard-border);
  color: inherit;
}
.cpd-btn--ghost.sm { padding: 6px 10px; font-size: 12px; }
.cpd-hidden-input { display: none; }

/* ── project insights (Collaborate Time insights parity, dark rail) ── */
.cpd-insights { padding: 2px 0 4px; }
.cpd-insights--compact .cpd-insights-donut { width: 88px; height: 88px; margin: 8px auto 10px; }
.cpd-insights--compact .cpd-insights-subhead h3 { font-size: 11px; }
.cpd-insights-head {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 8px;
}
.cpd-insights-kicker { font-size: 10px; color: var(--color-muted, #94a3b8); text-transform: uppercase; letter-spacing: 0.06em; }
.cpd-insights-title { font-size: 13px; font-weight: 600; color: var(--color-main, #e2e8f0); }
.cpd-insights-live {
  font-size: 10px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
  color: #86efac; background: rgba(34, 197, 94, 0.15); border-radius: 999px; padding: 3px 8px;
}
.cpd-insights-switch, .cpd-insights-metric-switch {
  display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 8px;
  border: 1px solid var(--dashboard-border); border-radius: 10px; padding: 3px; background: rgba(255,255,255,0.02);
}
.cpd-insights-metric-switch { grid-template-columns: repeat(3, 1fr); margin-bottom: 10px; }
.cpd-insights-switch button, .cpd-insights-metric-switch button {
  border: 0; background: transparent; color: var(--color-muted, #94a3b8);
  font-size: 11px; font-weight: 600; padding: 6px 8px; border-radius: 8px; cursor: pointer;
}
.cpd-insights-switch button.active, .cpd-insights-metric-switch button.active {
  background: rgba(34, 211, 238, 0.14); color: #67e8f9;
}
.cpd-insights-timer-row {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px;
}
.cpd-insights-today { font-size: 12px; color: var(--color-muted, #94a3b8); }
.cpd-insights-today strong { color: #93c5fd; font-size: 13px; margin-left: 4px; }
.cpd-insights-donut {
  width: 112px; height: 112px; border-radius: 50%; margin: 4px auto 12px; position: relative;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06);
}
.cpd-insights-donut::after {
  content: ''; position: absolute; inset: 22%; border-radius: 50%;
  background: var(--bg-elevated, #1e2130); box-shadow: inset 0 0 0 1px var(--dashboard-border);
}
.cpd-insights-breakdown { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
.cpd-insights-break-row {
  display: grid; grid-template-columns: 10px 1fr auto; align-items: center; gap: 8px;
  font-size: 11px; color: var(--color-muted, #94a3b8);
}
.cpd-insights-break-row strong { color: var(--color-main, #e2e8f0); font-size: 11px; }
.cpd-insights-dot { width: 8px; height: 8px; border-radius: 50%; }
.cpd-insights-dot--open { background: #4285f4; }
.cpd-insights-dot--done { background: #34a853; }
.cpd-insights-dot--pct { background: #039be5; }
.cpd-insights-rule { height: 1px; background: var(--dashboard-border); margin: 10px 0; }
.cpd-insights-subhead {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px;
}
.cpd-insights-subhead h3 { margin: 0; font-size: 12px; font-weight: 600; color: var(--color-main, #e2e8f0); }
.cpd-insights-subhead span { font-size: 12px; color: #93c5fd; font-weight: 700; }
.cpd-insights-empty { margin: 0 0 8px; font-size: 11px; color: var(--color-muted, #94a3b8); line-height: 1.45; }
.cpd-insights-task-list { list-style: none; margin: 0 0 10px; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.cpd-insights-task-btn {
  width: 100%; text-align: left; border: 1px solid var(--dashboard-border); background: rgba(255,255,255,0.02);
  border-radius: 8px; padding: 7px 9px; cursor: pointer; color: inherit;
}
.cpd-insights-task-btn:hover { border-color: rgba(34, 211, 238, 0.35); background: rgba(34, 211, 238, 0.06); }
.cpd-insights-task-title { display: block; font-size: 11px; font-weight: 600; color: var(--color-main, #e2e8f0); }
.cpd-insights-task-cat { display: block; margin-top: 2px; font-size: 10px; color: var(--color-muted, #94a3b8); }
.cpd-insights-links { display: flex; flex-wrap: wrap; gap: 6px; }
.cpd-insights-contact {
  margin: 14px 0 0; padding-top: 12px; border-top: 1px solid var(--dashboard-border);
  font-size: 12px; line-height: 1.55; color: var(--color-muted, #94a3b8);
}
.cpd-brand-rail {
  border: 1px dashed var(--dashboard-border); border-radius: 10px; padding: 10px;
  transition: border-color 0.12s, background 0.12s;
}
.cpd-brand-rail--over { border-color: rgba(34, 211, 238, 0.55); background: rgba(34, 211, 238, 0.08); }
.cpd-brand-rail-grid { margin: 6px 0; }
.cpd-brand-rail-thumb {
  width: 40px; height: 40px; padding: 0; border: 1px solid var(--dashboard-border);
  border-radius: 8px; overflow: hidden; background: rgba(255,255,255,0.03); cursor: pointer;
}
.cpd-brand-rail-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }

/* ── editor modals (large read/edit) ── */
.cpd-editor-backdrop { z-index: 520; }
.cpd-editor-modal {
  width: min(640px, 100%);
  max-height: min(88vh, 720px);
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  border: 1px solid var(--dashboard-border);
  background: var(--bg-elevated, #1e2130);
  padding: 22px 24px 20px;
  box-shadow: 0 20px 56px rgba(0, 0, 0, 0.5);
}
.cpd-editor-modal-title {
  margin: 0 0 8px;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.cpd-editor-modal-subtitle {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--color-muted, #94a3b8);
}
.cpd-editor-modal-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin-bottom: 16px;
}
.cpd-editor-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  flex-shrink: 0;
  padding-top: 4px;
}
.cpd-editor-textarea {
  width: 100%;
  min-height: min(360px, 50vh);
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid var(--dashboard-border);
  background: var(--dashboard-canvas, rgba(0,0,0,0.2));
  color: inherit;
  font-size: 14px;
  line-height: 1.65;
  outline: none;
  resize: vertical;
  box-sizing: border-box;
  font-family: inherit;
}
.cpd-editor-textarea:focus {
  border-color: var(--solar-cyan, #22d3ee);
  box-shadow: 0 0 0 1px rgba(34, 211, 238, 0.2);
}
.cpd-editor-cover {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}
.cpd-editor-cover-img {
  width: 100%;
  max-height: min(420px, 55vh);
  object-fit: contain;
  border-radius: 10px;
  border: 1px solid var(--dashboard-border);
  background: rgba(0,0,0,0.2);
}
.cpd-editor-cover-empty {
  width: 100%;
  min-height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  border: 1px dashed var(--dashboard-border);
  color: var(--color-muted, #94a3b8);
  font-size: 13px;
}
.cpd-files-drop--modal { min-height: 140px; }
.cpd-quick-stats--modal { margin-bottom: 16px; }
.cpd-quick-stat--wide { grid-column: 1 / -1; }

/* ── mobile editor bottom sheet (Claude-style) ── */
.cpd-editor-sheet-backdrop {
  position: fixed;
  inset: 0;
  z-index: 560;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}
.cpd-editor-sheet {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 561;
  display: flex;
  flex-direction: column;
  max-height: min(92dvh, 720px);
  border-radius: 20px 20px 0 0;
  border-top: 1px solid var(--dashboard-border);
  background: var(--bg-elevated, #1a1d2e);
  box-shadow: 0 -8px 40px rgba(0, 0, 0, 0.45);
  animation: cpd-sheet-in 0.28s cubic-bezier(0.32, 0.72, 0, 1);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.cpd-editor-sheet-grab {
  flex-shrink: 0;
  width: 36px;
  height: 4px;
  margin: 10px auto 4px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.45);
}
.cpd-editor-sheet-toolbar {
  display: grid;
  grid-template-columns: 44px 1fr 44px;
  align-items: center;
  gap: 8px;
  padding: 4px 12px 12px;
  flex-shrink: 0;
}
.cpd-editor-sheet-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  text-align: center;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cpd-editor-sheet-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-main, #e2e8f0);
  cursor: pointer;
}
.cpd-editor-sheet-icon:disabled {
  opacity: 0.45;
  cursor: default;
}
.cpd-editor-sheet-icon--save {
  background: rgba(34, 211, 238, 0.16);
  color: var(--solar-cyan, #22d3ee);
}
.cpd-editor-sheet-icon-spacer {
  width: 40px;
  height: 40px;
}
.cpd-editor-sheet-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 0 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.cpd-editor-sheet-body {
  flex: 1;
  min-height: 0;
}
.cpd-editor-sheet-subtitle {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--color-muted, #94a3b8);
  flex-shrink: 0;
}
.cpd-editor-textarea--sheet {
  min-height: 200px;
  height: 100%;
  font-size: 16px;
  line-height: 1.6;
  border-radius: 12px;
  padding: 16px;
}

/* ── composer ── */
.cpd-composer {
  margin: 0 28px 24px;
  border-radius: 12px;
  border: 1px solid var(--dashboard-border);
  background: var(--dashboard-panel, rgba(255,255,255,0.03));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.cpd-composer:focus-within {
  border-color: rgba(255,255,255,0.15);
  box-shadow: 0 0 0 1px rgba(255,255,255,0.06);
}
.cpd-composer-input {
  width: 100%;
  padding: 16px 16px 8px;
  background: transparent;
  border: none;
  color: inherit;
  font-size: 14px;
  line-height: 1.5;
  outline: none;
  resize: none;
  box-sizing: border-box;
  min-height: 52px;
}
.cpd-composer-input::placeholder { color: var(--color-muted, #94a3b8); }
.cpd-composer-footer {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  gap: 8px;
}
.cpd-composer-spacer { flex: 1; }
.cpd-composer-new {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid var(--dashboard-border);
  background: transparent;
  color: var(--color-muted, #94a3b8);
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.cpd-composer-new:hover { background: var(--bg-hover); color: var(--color-main, #e2e8f0); }
.cpd-composer-send {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: var(--color-main, #e2e8f0);
  color: var(--dashboard-canvas, #0f1117);
  cursor: pointer;
  transition: opacity 0.1s;
}
.cpd-composer-send:disabled { opacity: 0.3; cursor: default; }

.cpd-composer-source-chips {
  padding: 0 2px 8px;
}

.cpd-composer-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 2px 8px;
}
.cpd-composer-attach-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 180px;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 11px;
  border: 1px solid var(--dashboard-border);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-muted, #94a3b8);
}
.cpd-composer-attach-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cpd-composer-attach-remove {
  display: flex;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  cursor: pointer;
  opacity: 0.7;
}
.cpd-composer-attach-remove:hover { opacity: 1; }
.cpd-composer-link {
  font-size: 11px;
  color: var(--solar-cyan, #22d3ee);
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 6px;
}
.cpd-composer-link:hover { text-decoration: underline; }

.cpd-thread {
  margin: 0 0 16px;
  max-height: min(420px, 42vh);
  overflow-y: auto;
  border: 1px solid var(--dashboard-border);
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.15);
}
.cpd-thread-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--dashboard-border);
  position: sticky;
  top: 0;
  background: var(--bg-elevated, #1a1d2e);
  z-index: 1;
}
.cpd-thread-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-muted, #94a3b8);
}
.cpd-thread-new {
  font-size: 11px;
  color: var(--solar-cyan, #22d3ee);
  background: none;
  border: none;
  cursor: pointer;
}
.cpd-thread-loading {
  padding: 16px 12px;
  font-size: 12px;
  color: var(--color-muted, #94a3b8);
}
.cpd-thread-messages {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}
.cpd-thread-bubble {
  max-width: 92%;
  padding: 10px 12px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.cpd-thread-bubble--user {
  align-self: flex-end;
  background: rgba(34, 211, 238, 0.12);
  border: 1px solid rgba(34, 211, 238, 0.25);
}
.cpd-thread-bubble--assistant {
  align-self: flex-start;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--dashboard-border);
}

/* ── chat list ── */
.cpd-chat-section {
  padding: 0 28px;
}
.cpd-chat-empty {
  font-size: 13px;
  color: var(--color-muted, #94a3b8);
  padding: 16px 0;
}
.cpd-toast {
  position: fixed;
  bottom: 72px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1400;
  padding: 10px 16px;
  border-radius: 999px;
  border: 1px solid var(--dashboard-border);
  background: var(--bg-elevated, #1a1f2e);
  font-size: 13px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.35);
}
.cpd-chat-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.cpd-chat-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
  transition: background 0.1s;
  border-radius: 6px;
  cursor: pointer;
}
.cpd-chat-row:hover { background: var(--bg-hover, rgba(255,255,255,0.04)); padding-left: 8px; padding-right: 8px; margin: 0 -8px; }
.cpd-chat-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  text-align: left;
  padding: 0;
}
.cpd-chat-title {
  font-size: 14px;
  font-weight: 400;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}
.cpd-chat-badge {
  flex-shrink: 0;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid var(--dashboard-border);
  color: var(--color-muted, #94a3b8);
}
.cpd-chat-badge--err {
  border-color: rgba(239,68,68,0.4);
  color: #f87171;
}
.cpd-chat-time {
  font-size: 12px;
  color: var(--color-muted, #94a3b8);
}

/* ── desktop right rail ── */
.cpd-right {
  width: 320px;
  min-width: 320px;
  max-width: 320px;
  border-left: 1px solid var(--dashboard-border);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  flex-shrink: 0;
  padding: 20px 0 40px;
}

/* ── rail sections (shared desktop + mobile sheet) ── */
.cpd-rail-section {
  border-bottom: 1px solid var(--dashboard-border);
  padding: 16px 20px;
}
.cpd-rail-section:last-child { border-bottom: none; }

.cpd-rail-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.cpd-rail-section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 0;
  text-align: left;
}
.cpd-rail-chevron {
  display: flex;
  align-items: center;
  color: var(--color-muted, #94a3b8);
}
.cpd-rail-section-action {
  display: flex;
  align-items: center;
  gap: 4px;
}

.cpd-rail-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--dashboard-border);
  color: var(--color-muted, #94a3b8);
  font-weight: 400;
}

.cpd-rail-section-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cpd-quick-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
  margin: 0;
}
.cpd-quick-stat { margin: 0; min-width: 0; }
.cpd-quick-stat dt {
  margin: 0 0 2px;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-muted, #94a3b8);
}
.cpd-quick-stat dd {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-main, #e2e8f0);
}
.cpd-quick-stat-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  font-weight: 500;
  word-break: break-all;
}
.cpd-rail-link-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 4px;
  padding: 0;
  border: none;
  background: none;
  font-size: 12px;
  color: var(--solar-cyan, #22d3ee);
  cursor: pointer;
  text-align: left;
}
.cpd-rail-link-btn:hover { text-decoration: underline; }

.cpd-rail-textarea {
  width: 100%;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--dashboard-border);
  background: var(--dashboard-panel, rgba(255,255,255,0.03));
  color: inherit;
  font-size: 12px;
  line-height: 1.6;
  outline: none;
  resize: vertical;
  transition: border-color 0.15s;
  box-sizing: border-box;
}
.cpd-rail-textarea:focus { border-color: var(--solar-cyan, #22d3ee); }
.cpd-rail-textarea::placeholder { color: var(--color-muted, #94a3b8); }

.cpd-rail-save {
  display: inline-flex;
  align-items: center;
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid var(--dashboard-border);
  background: transparent;
  color: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.1s;
  align-self: flex-start;
}
.cpd-rail-save:hover { background: var(--bg-hover); }

.cpd-rail-empty-btn {
  width: 100%;
  text-align: left;
  font-size: 12px;
  color: var(--color-muted, #94a3b8);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  line-height: 1.5;
  transition: color 0.1s;
}
.cpd-rail-empty-btn:hover { color: var(--color-main, #e2e8f0); }

/* files */
.cpd-files-drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 14px 10px;
  text-align: center;
  border-radius: 10px;
  border: 1px dashed var(--dashboard-border);
  transition: border-color 0.12s, background 0.12s;
}
.cpd-files-drop--over {
  border-color: var(--solar-cyan, #22d3ee);
  background: rgba(34, 211, 238, 0.06);
}
.cpd-files-icon { color: var(--color-muted, #94a3b8); opacity: 0.4; }
.cpd-files-text {
  font-size: 12px;
  color: var(--color-muted, #94a3b8);
  margin: 0;
  max-width: 240px;
  line-height: 1.5;
}
.cpd-files-text code { font-size: 10px; }
.cpd-files-gallery {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin-top: 12px;
}
.cpd-files-thumb {
  aspect-ratio: 1;
  padding: 0;
  border: 1px solid var(--dashboard-border);
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  background: rgba(0, 0, 0, 0.2);
  transition: border-color 0.12s, transform 0.12s;
}
.cpd-files-thumb:hover {
  border-color: var(--solar-cyan, #22d3ee);
  transform: scale(1.02);
}
.cpd-files-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.cpd-files-list {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cpd-files-list li {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  font-size: 12px;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid var(--dashboard-border);
}
.cpd-files-doc-icon {
  flex-shrink: 0;
  color: var(--color-muted, #94a3b8);
  opacity: 0.85;
}
.cpd-files-list a {
  flex: 1;
  min-width: 0;
  color: var(--solar-cyan, #22d3ee);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cpd-lightbox {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.88);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.cpd-lightbox-close {
  position: absolute;
  top: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  cursor: pointer;
}
.cpd-lightbox-img {
  max-width: min(960px, 92vw);
  max-height: 80vh;
  object-fit: contain;
  border-radius: 8px;
}
.cpd-lightbox-caption {
  margin: 12px 0 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
  text-align: center;
  max-width: 480px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cpd-cover-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cpd-cover-preview img {
  width: 100%;
  max-height: 120px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid var(--dashboard-border);
}

/* ── mobile bottom sheet ── */
.cpd-sheet-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 50;
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}

.cpd-sheet {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 51;
  background: var(--bg-elevated, #1a1d2e);
  border-top: 1px solid var(--dashboard-border);
  border-radius: 20px 20px 0 0;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  animation: cpd-sheet-in 0.25s cubic-bezier(0.32, 0.72, 0, 1);
}

@keyframes cpd-sheet-in {
  from { transform: translateY(100%); }
  to   { transform: translateY(0); }
}

.cpd-sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--dashboard-border);
  flex-shrink: 0;
}

.cpd-sheet-title {
  font-size: 15px;
  font-weight: 600;
}

.cpd-sheet-body {
  overflow-y: auto;
  flex: 1;
  padding-bottom: env(safe-area-inset-bottom, 16px);
}

/* ── mobile overrides ── */
@media (max-width: 768px) {
  .cpd-root {
    overflow: visible;
  }
  .cpd-left {
    max-width: 100%;
    padding: 16px 0 80px;
  }
  .cpd-back-row {
    padding: 0 16px;
    margin-bottom: 14px;
  }
  .cpd-title-section {
    padding: 0 16px;
    margin-bottom: 16px;
  }
  .cpd-title {
    font-size: 22px;
  }
  .cpd-composer {
    margin: 0 16px 20px;
  }
  .cpd-chat-section {
    padding: 0 16px;
  }
  .cpd-chat-row:hover {
    padding-left: 6px;
    padding-right: 6px;
    margin: 0 -6px;
  }
}

@media (max-width: 480px) {
  .cpd-title { font-size: 20px; }
  .cpd-rail-textarea { font-size: 14px; }
  .cpd-composer-input { font-size: 16px; /* prevents iOS zoom */ }
}

/* skeleton */
.cpd-skel {
  border-radius: 4px;
  background: linear-gradient(
    90deg,
    var(--dashboard-border) 25%,
    rgba(255,255,255,0.06) 50%,
    var(--dashboard-border) 75%
  );
  background-size: 200% 100%;
  animation: cpd-shimmer 1.4s ease-in-out infinite;
}
@keyframes cpd-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
`;
