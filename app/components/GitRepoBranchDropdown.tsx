import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GitBranch, ChevronDown } from 'lucide-react';
import type { OpenCommandPaletteDetail } from '../src/lib/openCommandPalette';
import { useWorkspace } from '../src/context/WorkspaceContext';
import {
  ShellDropdownPanel,
  ShellDropdownRow,
  ShellDropdownDivider,
  ShellDropdownKeyHint,
} from './ShellDropdownPanel';
import './StatusBar.css';

export type GitBranchRow = {
  ref: string;
  sha?: string;
  protected?: boolean;
  subject?: string;
  date_relative?: string;
};

type GithubRepoRow = { full_name: string; default_branch?: string | null; private?: boolean };

function mapBranchApiError(
  payload: { error?: string; message?: string; status?: number },
  httpStatus: number,
): string {
  const code = String(payload.error || '').trim();
  if (code === 'github_auth' || code === 'No GitHub token' || code === 'github_not_connected') {
    return 'Connect GitHub under Settings → Integrations, then retry.';
  }
  if (code === 'no_github_repo') {
    return 'No GitHub repo linked to this workspace — pick one below or set it in Workspace settings.';
  }
  if (code === 'github_branches') {
    const ghStatus = payload.status ?? httpStatus;
    return `GitHub could not list branches (${ghStatus}). Check repo access for your connected account.`;
  }
  if (code === 'github_token_mismatch') {
    return 'GitHub token does not match the connected account — reconnect GitHub in Integrations.';
  }
  const msg = payload.message?.trim();
  if (msg) return msg;
  if (code) return code.replace(/_/g, ' ');
  return `Failed to load branches (${httpStatus})`;
}

export type GitRepoBranchMenuPanelProps = {
  open: boolean;
  onClose: () => void;
  activeWorkspaceId?: string | null;
  currentBranch?: string;
  workspaceRepoHint?: string | null;
  onBranchSelect?: (branch: string) => void;
  onOpenCommandPalette?: (detail?: OpenCommandPaletteDetail) => void;
  onGitBranchClick?: () => void;
  onWorkspacePickerClick?: () => void;
  /** `floating` = App portal; `dropdown` = anchored under nav trigger */
  variant?: 'dropdown' | 'floating';
  className?: string;
};

export function GitRepoBranchMenuPanel({
  open,
  onClose,
  activeWorkspaceId,
  currentBranch,
  workspaceRepoHint,
  onBranchSelect,
  onOpenCommandPalette,
  onGitBranchClick,
  onWorkspacePickerClick,
  variant = 'dropdown',
  className = '',
}: GitRepoBranchMenuPanelProps) {
  const [branchData, setBranchData] = useState<{
    current: string;
    repo: string;
    branches: GitBranchRow[];
  } | null>(null);
  const [branchLoading, setBranchLoading] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [branchMenuFilter, setBranchMenuFilter] = useState('');
  const [githubRepos, setGithubRepos] = useState<GithubRepoRow[]>([]);
  const [githubReposLoading, setGithubReposLoading] = useState(false);
  const branchFetchGenRef = useRef(0);
  const { persistGithubRepo } = useWorkspace();

  const openPalette = useCallback(
    (detail?: OpenCommandPaletteDetail) => {
      onOpenCommandPalette?.(detail);
    },
    [onOpenCommandPalette],
  );

  const loadGithubRepos = useCallback(async () => {
    setGithubReposLoading(true);
    try {
      const res = await fetch('/api/agent/github/repos', { credentials: 'same-origin' });
      const json = (await res.json().catch(() => ({}))) as {
        repos?: { full_name?: string; name?: string; default_branch?: string; private?: boolean }[];
      };
      if (!res.ok) {
        setGithubRepos([]);
        return;
      }
      const rows: GithubRepoRow[] = [];
      for (const r of json.repos || []) {
        const full = String(r.full_name || r.name || '').trim();
        if (!full.includes('/')) continue;
        rows.push({
          full_name: full,
          default_branch: r.default_branch ?? null,
          private: r.private,
        });
      }
      setGithubRepos(rows);
    } catch {
      setGithubRepos([]);
    } finally {
      setGithubReposLoading(false);
    }
  }, []);

  const loadBranches = useCallback(async () => {
    const gen = ++branchFetchGenRef.current;
    setBranchLoading(true);
    setBranchError(null);
    try {
      const ws = activeWorkspaceId?.trim();
      const url = ws
        ? `/api/agent/git/branches?workspace_id=${encodeURIComponent(ws)}`
        : '/api/agent/git/branches';
      const res = await fetch(url, { credentials: 'same-origin' });
      const json = (await res.json()) as {
        current?: string;
        repo?: string;
        repo_full_name?: string;
        branches?: GitBranchRow[];
        error?: string;
        message?: string;
        status?: number;
      };
      if (gen !== branchFetchGenRef.current) return;

      const apiError = json.error?.trim();
      if (!res.ok || apiError) {
        setBranchData(null);
        setBranchError(mapBranchApiError(json, res.status));
        if (
          apiError === 'no_github_repo' ||
          apiError === 'github_auth' ||
          apiError === 'github_not_connected'
        ) {
          void loadGithubRepos();
        }
        return;
      }

      const repoLabel = json.repo || json.repo_full_name || '';
      setBranchData({
        current: json.current || currentBranch || 'main',
        repo: repoLabel,
        branches: Array.isArray(json.branches)
          ? json.branches.map((b) => ({
              ref: b.ref,
              sha: b.sha,
              protected: b.protected ?? false,
              subject: b.subject,
              date_relative: b.date_relative,
            }))
          : [],
      });
    } catch {
      if (gen !== branchFetchGenRef.current) return;
      setBranchError('Network error loading branches');
      void loadGithubRepos();
    } finally {
      if (gen === branchFetchGenRef.current) setBranchLoading(false);
    }
  }, [activeWorkspaceId, currentBranch, loadGithubRepos]);

  useEffect(() => {
    setBranchData(null);
    setBranchError(null);
    setGithubRepos([]);
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (!activeWorkspaceId?.trim()) return;
    void loadBranches();
  }, [activeWorkspaceId, loadBranches]);

  useEffect(() => {
    if (!open) {
      setBranchMenuFilter('');
      return;
    }
    void loadBranches();
  }, [open, loadBranches]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const filteredBranchRows = useMemo(() => {
    const rows = branchData?.branches ?? [];
    const q = branchMenuFilter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((b) => b.ref.toLowerCase().includes(q));
  }, [branchData, branchMenuFilter]);

  if (!open) return null;

  const shellVariant = variant === 'dropdown' ? 'anchored' : 'floating';

  return (
    <ShellDropdownPanel
      variant={shellVariant}
      className={className}
      aria-label="Repository and branches"
      title={branchLoading ? 'Loading…' : branchData?.repo || workspaceRepoHint || 'Repository'}
      footer={
        <>
          <ShellDropdownKeyHint />
          {onWorkspacePickerClick ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                onWorkspacePickerClick();
              }}
              className="w-full text-left px-3 py-1.5 text-[0.6875rem] text-main hover:bg-[var(--bg-hover)] font-[var(--font-sans)]"
            >
              Switch workspace…
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              onClose();
              onGitBranchClick?.();
            }}
            className="w-full text-left px-3 py-1.5 text-[0.6875rem] text-[var(--solar-cyan)] hover:underline font-[var(--font-sans)]"
          >
            Open Source Control…
          </button>
        </>
      }
    >
      <div className="shrink-0">
        <ShellDropdownRow
          icon={<span className="text-[var(--solar-cyan)]">+</span>}
          label="Create new branch…"
          onClick={() => {
            onClose();
            openPalette({ chip: 'commands', query: 'branch', facets: ['commands'] });
          }}
        />
        <ShellDropdownRow
          icon={<span className="text-[var(--solar-cyan)]">⇪</span>}
          label="Deploy from command palette…"
          onClick={() => {
            onClose();
            openPalette({ chip: 'commands', query: 'deploy', facets: ['deploy'] });
          }}
        />
      </div>
      <ShellDropdownDivider />
      <div className="px-3.5 py-2 shrink-0">
        <input
          type="text"
          value={branchMenuFilter}
          onChange={(e) => setBranchMenuFilter(e.target.value)}
          placeholder="Filter branches…"
          className="w-full bg-transparent text-[0.75rem] text-main placeholder:text-muted outline-none font-[var(--font-sans)]"
          autoFocus
        />
      </div>
      <div className="py-1 overflow-y-auto flex-1 min-h-0">
        {branchLoading && (
          <div className="flex items-center justify-center px-3 py-6 text-muted">
            <svg
              className="iam-branch-spinner h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
              <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
            </svg>
          </div>
        )}
        {branchError && !branchLoading && (
          <div className="px-3 py-3 iam-branch-error-text">
            <p className="text-[11px] mb-2">{branchError}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="text-[11px] font-semibold text-[var(--solar-cyan)] hover:underline font-[var(--font-sans)]"
                onClick={() => {
                  setBranchData(null);
                  void loadBranches();
                }}
              >
                Retry
              </button>
              <a
                href="/dashboard/settings/integrations"
                className="text-[11px] text-muted hover:text-[var(--solar-cyan)] underline font-[var(--font-sans)]"
                onClick={() => onClose()}
              >
                Integrations
              </a>
            </div>
          </div>
        )}
        {!branchLoading && branchError && (githubReposLoading || githubRepos.length > 0) && (
          <div className="px-3 py-2 border-t border-[var(--border-subtle)]">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted mb-1.5">
              Link repository
            </div>
            {githubReposLoading ? (
              <p className="text-[11px] text-muted">Loading your repos…</p>
            ) : (
              <div className="max-h-[140px] overflow-y-auto">
                {githubRepos.slice(0, 24).map((r) => (
                  <button
                    key={r.full_name}
                    type="button"
                    className="w-full text-left py-1 text-[11px] text-main hover:text-[var(--solar-cyan)] truncate font-[var(--font-sans)]"
                    onClick={() => {
                      void persistGithubRepo(r.full_name, activeWorkspaceId);
                      setBranchError(null);
                      void loadBranches();
                    }}
                  >
                    {r.full_name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {!branchLoading && !branchError && filteredBranchRows.length === 0 && (
          <p className="px-3 py-3 text-[11px] text-muted">No branches match.</p>
        )}
        {!branchLoading &&
          !branchError &&
          filteredBranchRows.map((b) => {
            const isCurrent =
              branchData != null && b.ref === (branchData.current || currentBranch);
            const shortSha = b.sha ? String(b.sha).slice(0, 7) : '';
            const metaParts = [shortSha, b.date_relative].filter(Boolean);
            return (
              <ShellDropdownRow
                key={b.ref}
                active={isCurrent}
                icon={
                  isCurrent ? (
                    <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden className="text-[var(--solar-cyan)]">
                      <circle cx="4.5" cy="4.5" r="3.5" fill="currentColor" />
                    </svg>
                  ) : (
                    <span className="block w-2.5 h-2.5 rounded-full border border-[var(--border-subtle)]" />
                  )
                }
                label={b.ref}
                hint={b.subject || undefined}
                meta={metaParts.join(' · ') || undefined}
                badge={b.protected ? 'protected' : undefined}
                onClick={() => {
                  onBranchSelect?.(b.ref);
                  onClose();
                }}
              />
            );
          })}
      </div>
    </ShellDropdownPanel>
  );
}

export type GitRepoBranchNavTriggerProps = {
  workspaceLabel?: string;
  gitBranch?: string;
  open: boolean;
  onToggle: () => void;
  className?: string;
};

/** Top-nav repo chip — opens branch menu anchored below. */
export function GitRepoBranchNavTrigger({
  workspaceLabel,
  gitBranch,
  open,
  onToggle,
  className = '',
}: GitRepoBranchNavTriggerProps) {
  const label = workspaceLabel?.trim() || 'Repository';
  const branch = gitBranch?.trim();
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex items-center gap-1 px-2 py-1.5 text-left w-full min-w-0 hover:bg-[var(--bg-hover)] transition-colors ${className}`}
      aria-expanded={open}
      aria-haspopup="dialog"
      title="Repository and branches"
    >
      <GitBranch size={13} className="shrink-0 opacity-70 text-muted" />
      <span className="text-[11px] text-muted truncate min-w-0">
        <span className="text-main font-medium">{label}</span>
        {branch ? (
          <span className="text-muted font-normal"> · {branch}</span>
        ) : null}
      </span>
      <ChevronDown size={12} className="shrink-0 text-muted opacity-70" />
    </button>
  );
}
