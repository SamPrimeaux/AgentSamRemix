import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
  type MouseEvent,
} from 'react';
import {
  Archive,
  ChevronRight,
  FolderKanban,
  MoreHorizontal,
  Pencil,
  Search,
  Star,
  Trash2,
} from 'lucide-react';
import type { AgentSessionRow } from '../../agentSessionsCatalog';
import { conversationIdFromSession, sessionDisplayTitle } from '../../agentSessionsCatalog';
import type { AgentChatProjectOption } from '../../hooks/useAgentChatSessions';

type Props = {
  session: AgentSessionRow;
  projects: AgentChatProjectOption[];
  onPatch: (id: string, patch: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onReload: () => void;
  activeConversationId?: string | null;
  onDeletedActive?: (id: string) => void;
};

export const AgentChatSessionRowMenu: FC<Props> = ({
  session,
  projects,
  onPatch,
  onDelete,
  onReload,
  activeConversationId,
  onDeletedActive,
}) => {
  const id = conversationIdFromSession(session);
  const [open, setOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const filteredProjects = useMemo(() => {
    const q = projectQuery.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, projectQuery]);

  const closeAll = useCallback(() => {
    setOpen(false);
    setProjectOpen(false);
    setProjectQuery('');
    setRenaming(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent | globalThis.MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) closeAll();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAll();
    };
    document.addEventListener('mousedown', onDoc as EventListener);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc as EventListener);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, closeAll]);

  if (!id) return null;

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await onReload();
      closeAll();
    } finally {
      setBusy(false);
    }
  };

  const toggleStar = () =>
    void run(async () => {
      const next = !session.is_starred;
      await onPatch(id, { is_starred: next ? 1 : 0 });
    });

  const startRename = () => {
    setRenameValue(sessionDisplayTitle(session));
    setRenaming(true);
    setOpen(false);
    setProjectOpen(false);
  };

  const saveRename = () =>
    void run(async () => {
      const title = renameValue.trim();
      if (!title) return;
      await onPatch(id, { title });
    });

  const assignProject = (projectId: string | null) =>
    void run(async () => {
      const p = projects.find((x) => x.id === projectId);
      const resolved = p?.chat_project_id || projectId;
      await onPatch(id, { project_id: resolved });
    });

  const deleteSession = () => {
    const label = sessionDisplayTitle(session);
    if (!window.confirm(`Delete "${label}"? This removes the chat from your history.`)) return;
    void run(async () => {
      await onDelete(id);
      if (activeConversationId === id) onDeletedActive?.(id);
    });
  };

  if (renaming) {
    return (
      <div className="flex items-center gap-1 px-1 py-0.5" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void saveRename();
            if (e.key === 'Escape') {
              setRenaming(false);
              setRenameValue('');
            }
          }}
          className="flex-1 min-w-0 rounded border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-1.5 py-0.5 text-[10px] text-main"
        />
        <button
          type="button"
          disabled={busy || !renameValue.trim()}
          onClick={() => void saveRename()}
          className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--solar-cyan)]/20 text-[var(--solar-cyan)] disabled:opacity-40"
        >
          Save
        </button>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        title="Chat options"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          setProjectOpen(false);
        }}
        className="p-1 rounded text-muted opacity-0 group-hover:opacity-100 hover:bg-[var(--bg-hover)] hover:text-main focus:opacity-100"
      >
        <MoreHorizontal size={14} />
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-0.5 min-w-[168px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-1 shadow-lg">
          <button
            type="button"
            disabled={busy}
            onClick={toggleStar}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-[var(--bg-hover)] disabled:opacity-50"
          >
            <Star size={13} fill={session.is_starred ? 'currentColor' : 'none'} className={session.is_starred ? 'text-[var(--solar-yellow)]' : ''} />
            {session.is_starred ? 'Unstar' : 'Star'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={startRename}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-[var(--bg-hover)] disabled:opacity-50"
          >
            <Pencil size={13} />
            Rename
          </button>
          <div className="relative">
            <button
              type="button"
              disabled={busy}
              onClick={() => setProjectOpen((v) => !v)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-[var(--bg-hover)] disabled:opacity-50"
            >
              <FolderKanban size={13} />
              <span className="flex-1">Add to project</span>
              <ChevronRight size={12} className="text-muted" />
            </button>
            {projectOpen ? (
              <div className="absolute left-full top-0 z-50 ml-1 w-[200px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-1 shadow-lg">
                <div className="px-2 pb-1">
                  <div className="flex items-center gap-1.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2 py-1">
                    <Search size={11} className="text-muted shrink-0" />
                    <input
                      autoFocus
                      value={projectQuery}
                      onChange={(e) => setProjectQuery(e.target.value)}
                      placeholder="Search projects"
                      className="w-full min-w-0 bg-transparent text-[10px] outline-none text-main placeholder:text-muted"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => assignProject(null)}
                  className="block w-full px-3 py-1.5 text-left text-[10px] text-muted hover:bg-[var(--bg-hover)] disabled:opacity-50"
                >
                  Remove from project
                </button>
                <div className="max-h-[180px] overflow-y-auto">
                  {filteredProjects.length ? (
                    filteredProjects.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        disabled={busy}
                        onClick={() => assignProject(p.id)}
                        className={`block w-full truncate px-3 py-1.5 text-left text-[10px] hover:bg-[var(--bg-hover)] disabled:opacity-50 ${
                          session.project_id === p.id ||
                          (p.chat_project_id && session.project_id === p.chat_project_id)
                            ? 'text-[var(--solar-cyan)]'
                            : ''
                        }`}
                      >
                        {p.name}
                      </button>
                    ))
                  ) : (
                    <p className="px-3 py-2 text-[10px] text-muted">No projects found</p>
                  )}
                </div>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={deleteSession}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-red-400 hover:bg-[var(--bg-hover)] disabled:opacity-50"
          >
            <Trash2 size={13} />
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
};
