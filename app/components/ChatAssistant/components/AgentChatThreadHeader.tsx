import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FC,
} from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import {
  Files,
  FolderKanban,
  MoreHorizontal,
  Pencil,
  Plus,
  Pin,
  SquarePen,
  Trash2,
} from 'lucide-react';
import type { AgentSessionRow } from '../../../agentSessionsCatalog';
import {
  conversationIdFromSession,
  isPlaceholderAgentChatTitle,
  sessionDisplayTitle,
} from '../../../agentSessionsCatalog';
import type { AgentChatProjectOption } from '../../../hooks/useAgentChatSessions';
import { deleteAgentSession, patchAgentSession } from '../../../hooks/useAgentChatSessions';
import { IAM_AGENT_CHAT_CONVERSATION_CHANGE } from '../../../agentChatConstants';
import { notifyAgentChatSessionsRefresh } from '../../../lib/openAgentConversation';
import { isUnboundAgentChatPath } from '../../../lib/agentConversationBind';

type Props = {
  conversationId: string;
  threadTitle: string;
  session: AgentSessionRow | null;
  projects: AgentChatProjectOption[];
  onTitleChange: (title: string) => void;
  onReloadSessions: () => void | Promise<void>;
  onDeletedActive?: (id: string) => void;
  onNewChat: () => void;
  onToggleScratchpad: () => void;
  scratchpadOpen?: boolean;
  /** Total file count (uploaded + agent-generated) — shows badge on the icon. */
  scratchpadFileCount?: number;
  compact?: boolean;
  /** When embedded in a merged shell row, omit bottom border. */
  embedded?: boolean;
  /** Cursor-style mobile thread: adds View button; scratchpad stays available. */
  mobileThreadChrome?: boolean;
  onView?: () => void;
};

const MENU_ITEM =
  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-[var(--bg-hover)] disabled:opacity-50';

export const AgentChatThreadHeader: FC<Props> = ({
  conversationId,
  threadTitle,
  session,
  projects,
  onTitleChange,
  onReloadSessions,
  onDeletedActive,
  onNewChat,
  onToggleScratchpad,
  scratchpadOpen = false,
  scratchpadFileCount = 0,
  compact = false,
  embedded = false,
  mobileThreadChrome = false,
  onView,
}) => {
  const location = useLocation();
  const convId = String(conversationId || '').trim();
  const unboundPath = isUnboundAgentChatPath(location.pathname, location.search);

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const menuPortalRef = useRef<HTMLDivElement>(null);

  const canMutate = Boolean(convId);

  const displayTitle = useMemo(() => {
    if (!convId || unboundPath) return 'New chat';
    const t = threadTitle.trim();
    if (t && !isPlaceholderAgentChatTitle(t)) return t;
    if (session) {
      const fromSession = sessionDisplayTitle(session);
      if (fromSession && !isPlaceholderAgentChatTitle(fromSession)) return fromSession;
    }
    return 'Chat';
  }, [threadTitle, session, convId, unboundPath]);

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPos(null);
      return;
    }
    const place = () => {
      const el = menuBtnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setMenuPos({
        top: Math.round(r.bottom + 4),
        right: Math.round(window.innerWidth - r.right),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuBtnRef.current?.contains(t)) return;
      if (menuPortalRef.current?.contains(t)) return;
      setMenuOpen(false);
      setProjectOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        setProjectOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      if (busy || !convId) return;
      setBusy(true);
      try {
        await fn();
        await onReloadSessions();
        setMenuOpen(false);
        setProjectOpen(false);
      } finally {
        setBusy(false);
      }
    },
    [busy, convId, onReloadSessions],
  );

  const saveTitle = useCallback(() => {
    const title = editValue.trim();
    if (!title || !convId) {
      setEditing(false);
      return;
    }
    void run(async () => {
      await patchAgentSession(convId, { title });
      onTitleChange(title);
      window.dispatchEvent(
        new CustomEvent(IAM_AGENT_CHAT_CONVERSATION_CHANGE, {
          detail: { id: convId, title },
        }),
      );
      setEditing(false);
    });
  }, [convId, editValue, onTitleChange, run]);

  const toggleStar = () =>
    void run(async () => {
      const next = !session?.is_starred;
      await patchAgentSession(convId, { is_starred: next ? 1 : 0 });
    });

  const assignProject = (projectId: string | null) =>
    void run(async () => {
      await patchAgentSession(convId, { project_id: projectId });
      notifyAgentChatSessionsRefresh(convId);
    });

  const deleteChat = () => {
    if (!convId) return;
    if (!window.confirm(`Delete "${displayTitle}"? This removes the chat from your history.`)) {
      return;
    }
    void run(async () => {
      await deleteAgentSession(convId);
      onDeletedActive?.(convId);
    });
  };

  const menu =
    menuOpen && menuPos
      ? createPortal(
          <div
            ref={menuPortalRef}
            role="menu"
            aria-label="Chat options"
            className="fixed z-[9999] min-w-[176px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-1 shadow-xl"
            style={{ top: menuPos.top, right: menuPos.right }}
          >
            {canMutate ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => {
                    setEditValue(displayTitle);
                    setEditing(true);
                    setMenuOpen(false);
                  }}
                  className={MENU_ITEM}
                >
                  <Pencil size={13} />
                  Rename
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={toggleStar}
                  className={MENU_ITEM}
                >
                  <Pin size={13} fill={session?.is_starred ? 'currentColor' : 'none'} />
                  {session?.is_starred ? 'Unpin' : 'Pin'}
                </button>
                <div className="relative">
                  <button
                    type="button"
                    role="menuitem"
                    disabled={busy}
                    onClick={() => setProjectOpen((v) => !v)}
                    className={MENU_ITEM}
                  >
                    <FolderKanban size={13} />
                    Add to project
                  </button>
                  {projectOpen ? (
                    <div className="absolute right-full top-0 z-[10000] mr-1 w-[200px] max-h-[220px] overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-1 shadow-xl">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => assignProject(null)}
                        className="block w-full px-3 py-1.5 text-left text-[10px] text-muted hover:bg-[var(--bg-hover)]"
                      >
                        Remove from project
                      </button>
                      {projects.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          disabled={busy}
                          onClick={() => assignProject(p.id)}
                          className="block w-full truncate px-3 py-1.5 text-left text-[10px] hover:bg-[var(--bg-hover)]"
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={deleteChat}
                  className={`${MENU_ITEM} text-red-400`}
                >
                  <Trash2 size={13} />
                  Delete
                </button>
              </>
            ) : null}
          </div>,
          document.body,
        )
      : null;

  if (mobileThreadChrome) {
    return (
      <div
        className="pointer-events-none fixed z-[140]"
        style={{
          top: 'calc(env(safe-area-inset-top, 0px) + 4px)',
          right: 'max(12px, env(safe-area-inset-right, 0px))',
        }}
      >
        <div className="pointer-events-auto inline-flex h-12 items-center gap-0.5 rounded-full border border-white/10 bg-[color-mix(in_srgb,var(--dashboard-panel)_90%,transparent)] px-1.5 shadow-[0_4px_18px_rgba(0,0,0,0.28)] backdrop-blur-xl">
          <button
            type="button"
            onClick={onNewChat}
            className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--dashboard-text)] hover:bg-[var(--bg-hover)]"
            title="New chat"
            aria-label="New chat"
          >
            <SquarePen size={20} strokeWidth={2} />
          </button>
          <button
            type="button"
            ref={menuBtnRef}
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-10 min-w-10 items-center justify-center rounded-full px-2 text-[var(--dashboard-text)] hover:bg-[var(--bg-hover)]"
            aria-label="Chat options"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            <MoreHorizontal size={21} strokeWidth={2} />
          </button>
          {menu}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-1.5 sm:gap-2 min-w-0 ${
        embedded ? '' : 'border-b border-[var(--dashboard-border)]'
      } bg-[var(--dashboard-panel)]/80 backdrop-blur-sm ${
        compact ? 'px-2 py-1.5' : 'px-2.5 sm:px-3 py-2'
      }`}
    >
      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        {editing ? (
          <input
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveTitle();
              if (e.key === 'Escape') setEditing(false);
            }}
            onBlur={() => saveTitle()}
            className="flex-1 min-w-0 rounded-md border border-[var(--dashboard-border)] bg-[var(--scene-bg)] px-2 py-1 text-[13px] font-semibold text-[var(--dashboard-text)] outline-none focus:border-[var(--solar-cyan)]"
          />
        ) : (
          <button
            type="button"
            disabled={!canMutate || busy}
            onClick={() => {
              if (!canMutate) return;
              setEditValue(displayTitle);
              setEditing(true);
            }}
            className="flex-1 min-w-0 flex items-center gap-1.5 text-left group disabled:cursor-default"
            title={canMutate ? 'Rename chat' : undefined}
          >
            <span className="truncate text-[13px] font-semibold text-[var(--dashboard-text)]">
              {displayTitle}
            </span>
            {canMutate ? (
              <Pencil
                size={12}
                className="shrink-0 opacity-0 group-hover:opacity-60 text-[var(--dashboard-muted)]"
              />
            ) : null}
          </button>
        )}
      </div>

      <div className="flex items-center gap-0.5 shrink-0">
        <button
          type="button"
          onClick={onToggleScratchpad}
          className={`relative flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${
            scratchpadOpen
              ? 'bg-[var(--bg-hover)] text-[var(--solar-cyan)]'
              : scratchpadFileCount > 0
                ? 'text-[var(--dashboard-text)] hover:bg-[var(--bg-hover)]'
                : 'text-[var(--dashboard-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--dashboard-text)]'
          }`}
          title={
            scratchpadOpen
              ? 'Close scratchpad'
              : scratchpadFileCount > 0
                ? `Open scratchpad · ${scratchpadFileCount} file${scratchpadFileCount === 1 ? '' : 's'}`
                : 'Open scratchpad'
          }
          aria-label={scratchpadOpen ? 'Close scratchpad' : 'Open scratchpad'}
          aria-pressed={scratchpadOpen}
        >
          <Files size={16} strokeWidth={1.75} />
          {scratchpadFileCount > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-[3px] rounded-full bg-[var(--solar-cyan)] text-[var(--dashboard-panel)] text-[9px] font-bold leading-[14px] text-center pointer-events-none select-none">
              {scratchpadFileCount > 99 ? '99+' : scratchpadFileCount}
            </span>
          ) : null}
        </button>

        {!mobileThreadChrome ? (
          <button
            type="button"
            onClick={onNewChat}
            className="flex items-center justify-center w-8 h-8 rounded-lg text-[var(--solar-cyan)] hover:bg-[var(--bg-hover)] transition-colors"
            title="New chat"
            aria-label="New chat"
          >
            <Plus size={18} strokeWidth={2} />
          </button>
        ) : onView ? (
          <button
            type="button"
            onClick={onView}
            className="px-2.5 py-1 rounded-lg border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] text-[11px] font-semibold text-[var(--dashboard-text)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            View
          </button>
        ) : null}

        <button
          type="button"
          ref={menuBtnRef}
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--dashboard-muted)]"
          aria-label="Chat options"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          <MoreHorizontal size={16} />
        </button>
        {menu}
      </div>
    </div>
  );
};

export function findSessionRow(
  sessions: AgentSessionRow[],
  conversationId: string,
): AgentSessionRow | null {
  const id = String(conversationId || '').trim();
  if (!id) return null;
  return (
    sessions.find(
      (s) => conversationIdFromSession(s) === id || s.id === id || s.conversation_id === id,
    ) ?? null
  );
}
