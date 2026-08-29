import React, { useCallback, useMemo, useState } from 'react';
import { ChevronDown, Loader2, RefreshCw } from 'lucide-react';
import { useWorkspace } from '../../../src/context/WorkspaceContext';
import { databaseStudioPathForWorkspace } from '../../../src/lib/databaseStudioRoute';
import { useNavigate } from 'react-router-dom';

export function WorkspaceActiveSwitcher() {
  const navigate = useNavigate();
  const {
    workspaceId,
    workspaces,
    canonicalWorkspaceId,
    workspaceDrift,
    switchWorkspace,
    refreshWorkspaces,
    loading,
  } = useWorkspace();
  const [switching, setSwitching] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const activeRow = useMemo(
    () => workspaces.find((w) => w.id === workspaceId) ?? null,
    [workspaces, workspaceId],
  );

  const handlePick = useCallback(
    async (id: string) => {
      const trimmed = id.trim();
      if (!trimmed || trimmed === workspaceId) {
        setOpen(false);
        return;
      }
      setSwitching(trimmed);
      try {
        const row = workspaces.find((w) => w.id === trimmed);
        await switchWorkspace(trimmed, {
          displayName: row?.name,
          slug: row?.slug,
          github_repo: row?.github_repo,
          sync: true,
        });
        if (window.location.pathname.startsWith('/dashboard/database')) {
          navigate(databaseStudioPathForWorkspace(row ?? null), { replace: true });
        }
      } finally {
        setSwitching(null);
        setOpen(false);
      }
    },
    [navigate, switchWorkspace, workspaceId, workspaces],
  );

  if (workspaces.length === 0 && !loading) {
    return (
      <div className="rounded-xl border border-[var(--accent-warning)]/40 bg-[var(--accent-warning)]/10 px-4 py-3 text-[12px] text-main">
        No workspaces available for this account.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)]/60 px-4 py-3 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-widest text-muted">Active workspace</div>
          <div className="text-[13px] text-main mt-1 truncate">
            {activeRow?.name || activeRow?.slug || workspaceId || '—'}
          </div>
          {workspaceId ? (
            <code className="text-[10px] font-mono text-muted">{workspaceId}</code>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            className="text-[11px] px-3 py-2 rounded-lg border border-[var(--border-subtle)] text-main hover:bg-[var(--bg-hover)] inline-flex items-center gap-1.5"
            onClick={() => void refreshWorkspaces({ force: true })}
            disabled={loading}
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Refresh
          </button>
          <div className="relative">
            <button
              type="button"
              className="text-[11px] px-3 py-2 rounded-lg bg-[var(--solar-blue)] text-[var(--toggle-knob)] inline-flex items-center gap-1.5 min-w-[160px] justify-between"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-haspopup="listbox"
            >
              Switch workspace
              <ChevronDown size={14} />
            </button>
            {open ? (
              <ul
                className="absolute right-0 z-50 mt-1 min-w-[240px] max-h-[280px] overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-lg py-1"
                role="listbox"
              >
                {workspaces.map((w) => {
                  const selected = w.id === workspaceId;
                  const busy = switching === w.id;
                  return (
                    <li key={w.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        disabled={Boolean(switching)}
                        className={`w-full text-left px-3 py-2 text-[12px] hover:bg-[var(--bg-hover)] ${
                          selected ? 'bg-[var(--bg-hover)] font-semibold' : ''
                        }`}
                        onClick={() => void handlePick(w.id)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate">{w.name || w.slug || w.id}</span>
                          {busy ? <Loader2 size={12} className="animate-spin shrink-0" /> : null}
                        </div>
                        <div className="text-[10px] text-muted font-mono truncate">{w.id}</div>
                        {w.github_repo ? (
                          <div className="text-[10px] text-muted truncate">{w.github_repo}</div>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </div>
      </div>
      {workspaceDrift && canonicalWorkspaceId ? (
        <div className="text-[11px] text-[var(--accent-warning)] flex flex-wrap items-center gap-2">
          <span>
            Browser cache disagrees with server ({canonicalWorkspaceId}). Snapping to server…
          </span>
          <button
            type="button"
            className="underline"
            onClick={() => void handlePick(canonicalWorkspaceId)}
          >
            Use {canonicalWorkspaceId.replace(/^ws_/, '')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
