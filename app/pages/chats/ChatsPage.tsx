import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Loader2, MessageSquare, Plus, Search, Star } from 'lucide-react';
import {
  chatsListRelativeTime,
  conversationIdFromSession,
  sessionDisplayTitle,
  sessionSortMs,
  type AgentSessionRow,
} from '../../agentSessionsCatalog';
import { resumeAgentChatSession, startNewAgentChat } from '../../lib/openAgentConversation';
import { useAgentChatSessions } from '../../hooks/useAgentChatSessions';
import { AgentChatSessionRowMenu } from '../../components/shell/AgentChatSessionRowMenu';

// ─── helpers ────────────────────────────────────────────────────────────────

function groupByDate(sessions: AgentSessionRow[]): { label: string; items: AgentSessionRow[] }[] {
  const now = Date.now();
  const DAY = 86_400_000;
  const buckets: Record<string, AgentSessionRow[]> = {};

  for (const s of sessions) {
    const ms = sessionSortMs(s);
    const diff = now - ms;
    let label: string;
    if (diff < DAY) label = 'Today';
    else if (diff < 2 * DAY) label = 'Yesterday';
    else if (diff < 7 * DAY) label = 'Previous 7 days';
    else if (diff < 30 * DAY) label = 'Previous 30 days';
    else {
      const d = new Date(ms);
      label = d.toLocaleString('default', { month: 'long', year: 'numeric' });
    }
    if (!buckets[label]) buckets[label] = [];
    buckets[label].push(s);
  }

  const ORDER = ['Today', 'Yesterday', 'Previous 7 days', 'Previous 30 days'];
  const entries = Object.entries(buckets).sort(([a], [b]) => {
    const ai = ORDER.indexOf(a);
    const bi = ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return b.localeCompare(a); // month-year descending
  });

  return entries.map(([label, items]) => ({ label, items }));
}

// ─── component ──────────────────────────────────────────────────────────────

export default function ChatsPage() {
  const { sessions, loading, projects, reload, patchSession, deleteSession } =
    useAgentChatSessions({ limit: 200 });

  const [query, setQuery] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // ── derived ──
  const sorted = useMemo(
    () => [...sessions].sort((a, b) => sessionSortMs(b) - sessionSortMs(a)),
    [sessions],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((s) => {
      const title = sessionDisplayTitle(s).toLowerCase();
      const project = String(s.project_name || '').toLowerCase();
      return title.includes(q) || project.includes(q);
    });
  }, [sorted, query]);

  const groups = useMemo(() => (query.trim() ? null : groupByDate(filtered)), [filtered, query]);

  const selectedCount = selected.size;
  const allVisibleSelected =
    filtered.length > 0 &&
    filtered.every((s) => selected.has(conversationIdFromSession(s) ?? ''));

  // ── actions ──
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleAllVisible = () => {
    if (allVisibleSelected) { setSelected(new Set()); return; }
    setSelected(new Set(filtered.map((s) => conversationIdFromSession(s)).filter(Boolean) as string[]));
  };

  const enterSelectMode = () => { setSelectMode(true); };

  const cancelSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
    setMoveOpen(false);
  };

  const resumeChat = useCallback((s: AgentSessionRow) => {
    const id = conversationIdFromSession(s);
    if (!id) return;
    resumeAgentChatSession({ id, title: sessionDisplayTitle(s), force: true });
  }, []);

  const deleteSelected = async () => {
    if (!selectedCount || busy) return;
    if (!window.confirm(`Delete ${selectedCount} chat${selectedCount === 1 ? '' : 's'}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await Promise.all([...selected].map((id) => deleteSession(id)));
      cancelSelect();
      await reload();
    } finally { setBusy(false); }
  };

  const moveSelectedToProject = async (projectId: string | null) => {
    if (!selectedCount || busy) return;
    setBusy(true);
    try {
      const p = projectId ? projects.find((x) => x.id === projectId) : null;
      const resolved = projectId ? p?.chat_project_id || projectId : null;
      await Promise.all([...selected].map((id) => patchSession(id, { project_id: resolved })));
      cancelSelect();
      await reload();
    } finally { setBusy(false); }
  };

  // ── row badge ──
  const rowBadge = (s: AgentSessionRow) => {
    if (
      s.last_turn_status === 'interrupted' ||
      s.last_turn_status === 'failed' ||
      s.last_turn_status === 'done_no_token'
    ) {
      return (
        <span className="chats-badge chats-badge--error">Incomplete</span>
      );
    }
    if (s.project_name) {
      return <span className="chats-badge">{s.project_name}</span>;
    }
    return null;
  };

  // ── row ──
  const renderRow = (s: AgentSessionRow) => {
    const id = conversationIdFromSession(s);
    if (!id) return null;
    const checked = selected.has(id);

    return (
      <li key={id} className="chats-row group">
        {selectMode && (
          <span className="chats-check-wrap" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggleOne(id)}
              aria-label={`Select ${sessionDisplayTitle(s)}`}
              className="chats-checkbox"
            />
          </span>
        )}

        <button
          type="button"
          onClick={() => (selectMode ? toggleOne(id) : resumeChat(s))}
          className="chats-row-main"
        >
          <span className="chats-row-title">
            {s.is_starred && (
              <Star size={11} className="chats-star" fill="currentColor" />
            )}
            {sessionDisplayTitle(s)}
          </span>
          {rowBadge(s)}
        </button>

        <span className="chats-row-time">
          {chatsListRelativeTime(s)}
        </span>

        {!selectMode && (
          <span className="chats-row-menu opacity-0 group-hover:opacity-100 focus-within:opacity-100">
            <AgentChatSessionRowMenu
              session={s}
              projects={projects}
              onPatch={patchSession}
              onDelete={deleteSession}
              onReload={reload}
            />
          </span>
        )}
      </li>
    );
  };

  // ── empty / loader ──
  const renderBody = () => {
    if (loading) {
      return (
        <div className="chats-empty">
          <Loader2 size={18} className="animate-spin text-muted" />
        </div>
      );
    }
    if (!filtered.length) {
      return (
        <div className="chats-empty">
          <MessageSquare size={32} className="chats-empty-icon" />
          <p className="chats-empty-text">
            {query.trim()
              ? 'No chats match your search.'
              : 'No chats yet. Send a message in Agent Sam to start one.'}
          </p>
        </div>
      );
    }

    if (groups) {
      return (
        <div>
          {groups.map(({ label, items }) => (
            <section key={label}>
              <div className="chats-group-label">{label}</div>
              <ul className="chats-list">{items.map(renderRow)}</ul>
            </section>
          ))}
        </div>
      );
    }

    return <ul className="chats-list">{filtered.map(renderRow)}</ul>;
  };

  // ── render ──
  return (
    <div className="chats-root">
      <style>{CHATS_CSS}</style>

      {/* ── header ── */}
      <header className="chats-header">
        <div className="chats-header-top">
          <h1 className="chats-title">Chats</h1>

          <div className="chats-header-actions">
            {selectMode ? (
              /* ── selection action bar ── */
              <>
                <span className="chats-sel-count">{selectedCount} selected</span>
                <button
                  type="button"
                  disabled={!filtered.length || busy}
                  onClick={toggleAllVisible}
                  className="chats-btn"
                >
                  {allVisibleSelected ? 'Deselect all' : 'Select all'}
                </button>
                <div className="relative">
                  <button
                    type="button"
                    disabled={!selectedCount || busy}
                    onClick={() => setMoveOpen((v) => !v)}
                    className="chats-btn"
                  >
                    Move to project
                  </button>
                  {moveOpen && selectedCount > 0 && (
                    <div className="chats-dropdown">
                      <button
                        type="button"
                        className="chats-dropdown-item chats-dropdown-item--muted"
                        onClick={() => void moveSelectedToProject(null)}
                      >
                        Remove from project
                      </button>
                      {projects.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className="chats-dropdown-item"
                          onClick={() => void moveSelectedToProject(p.id)}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  disabled={!selectedCount || busy}
                  onClick={() => void deleteSelected()}
                  className="chats-btn chats-btn--danger"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={cancelSelect}
                  className="chats-btn"
                >
                  Cancel
                </button>
              </>
            ) : (
              /* ── default header actions ── */
              <>
                <button
                  type="button"
                  onClick={enterSelectMode}
                  className="chats-btn"
                >
                  Select chats
                </button>
                <button
                  type="button"
                  onClick={() => startNewAgentChat()}
                  className="chats-btn chats-btn--primary"
                >
                  <Plus size={14} />
                  New chat
                </button>
              </>
            )}
          </div>
        </div>

        {/* ── search ── */}
        <div className="chats-search-wrap">
          <Search size={15} className="chats-search-icon" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats..."
            className="chats-search-input"
          />
        </div>
      </header>

      {/* ── body ── */}
      <div className="chats-body">{renderBody()}</div>
    </div>
  );
}

// ─── scoped CSS ─────────────────────────────────────────────────────────────

const CHATS_CSS = `
.chats-root {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  min-width: 0;
  background: var(--dashboard-canvas);
  color: var(--color-main, #e2e8f0);
}

/* centered column */
.chats-header,
.chats-body > *,
.chats-body > div > section {
  max-width: 740px;
  margin-left: auto;
  margin-right: auto;
  width: 100%;
}

/* header */
.chats-header {
  flex-shrink: 0;
  padding: 32px 24px 0;
  border-bottom: none;
}
.chats-header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}
.chats-title {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 0;
}
.chats-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.chats-sel-count {
  font-size: 12px;
  color: var(--color-muted, #94a3b8);
  min-width: 5rem;
  text-align: right;
}

/* buttons */
.chats-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border-radius: 8px;
  border: 1px solid var(--dashboard-border);
  background: transparent;
  color: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.12s;
  white-space: nowrap;
}
.chats-btn:hover:not(:disabled) { background: var(--bg-hover); }
.chats-btn:disabled { opacity: 0.4; cursor: default; }
.chats-btn--primary {
  background: var(--bg-elevated, rgba(255,255,255,0.08));
  border-color: transparent;
  font-weight: 500;
}
.chats-btn--primary:hover:not(:disabled) {
  background: var(--bg-hover);
}
.chats-btn--danger { color: #f87171; }

/* dropdown */
.chats-dropdown {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 30;
  min-width: 180px;
  border-radius: 10px;
  border: 1px solid var(--dashboard-border);
  background: var(--bg-elevated);
  box-shadow: 0 8px 24px rgba(0,0,0,0.3);
  padding: 4px 0;
}
.chats-dropdown-item {
  display: block;
  width: 100%;
  padding: 7px 14px;
  text-align: left;
  font-size: 12px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border: none;
}
.chats-dropdown-item:hover { background: var(--bg-hover); }
.chats-dropdown-item--muted { color: var(--color-muted, #94a3b8); }

/* search */
.chats-search-wrap {
  position: relative;
  margin-bottom: 0;
  padding-bottom: 14px;
}
.chats-search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-muted, #94a3b8);
  pointer-events: none;
}
.chats-search-input {
  width: 100%;
  padding: 8px 12px 8px 36px;
  border-radius: 10px;
  border: 1px solid var(--dashboard-border);
  background: var(--dashboard-panel, rgba(255,255,255,0.04));
  color: inherit;
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s;
  box-sizing: border-box;
}
.chats-search-input:focus {
  border-color: var(--solar-cyan, #22d3ee);
  box-shadow: 0 0 0 3px rgba(34, 211, 238, 0.15);
  outline: none;
}
.chats-search-input::placeholder { color: var(--color-muted, #94a3b8); }

/* body */
.chats-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

/* group label */
.chats-group-label {
  max-width: 740px;
  margin: 0 auto;
  padding: 20px 24px 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-muted, #94a3b8);
  opacity: 0.7;
}

/* list */
.chats-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

/* row */
.chats-row {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 740px;
  margin: 0 auto;
  padding: 0 24px;
  min-height: 46px;
  border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
  transition: background 0.1s;
  position: relative;
  border-radius: 6px;
}
.chats-row:hover { background: var(--bg-hover, rgba(255,255,255,0.04)); }

.chats-check-wrap {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}
.chats-checkbox {
  width: 15px;
  height: 15px;
  border-radius: 4px;
  border: 1.5px solid var(--dashboard-border);
  accent-color: var(--solar-cyan, #22d3ee);
  cursor: pointer;
}

.chats-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
  color: inherit;
  padding: 0;
}
.chats-row-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 450;
  display: flex;
  align-items: center;
  gap: 5px;
}
.chats-star { color: var(--solar-yellow, #fbbf24); flex-shrink: 0; }

.chats-row-time {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--color-muted, #94a3b8);
  white-space: nowrap;
  tabular-nums: true;
}

.chats-row-menu { flex-shrink: 0; transition: opacity 0.1s; }

/* badge */
.chats-badge {
  flex-shrink: 0;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--dashboard-border);
  font-size: 10px;
  color: var(--color-muted, #94a3b8);
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chats-badge--error {
  border-color: rgba(239,68,68,0.4);
  color: #f87171;
}

/* empty */
.chats-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 64px 24px;
  text-align: center;
}
.chats-empty-icon { color: var(--color-muted, #94a3b8); opacity: 0.4; }
.chats-empty-text { font-size: 14px; color: var(--color-muted, #94a3b8); max-width: 280px; }
`;
