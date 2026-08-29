import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { persistRecentWorkspaceSwitch } from '../src/recentWorkspacesStorage';
import { loadPrefsForWorkspace } from '../hooks/useTerminalWorkspace';
import {
  fetchHostedTunnelConnections,
  setDefaultHostedTunnelConnection,
  type HostedTunnelConnection,
} from '../src/lib/ptyTerminalSetupApi';
import { patchTerminalWorkspacePref } from '../src/lib/terminalWorkspacePrefs';
import { WorkspaceTerminalTile } from './WorkspaceTerminalTile';
import {
  FolderOpen,
  Github,
  Terminal,
  Database,
  Search,
  Plus,
  Clock,
  Settings,
  ShieldCheck,
  Server,
  FolderGit2,
  Loader2,
} from 'lucide-react';

export type AgentsamWorkspaceRow = {
  id: string;
  display_name: string;
  slug: string;
  workspace_type?: string | null;
  r2_prefix?: string | null;
  github_repo?: string | null;
  updated_at?: number | null;
  status?: string | null;
};

interface WorkspaceLauncherProps {
  onClose: () => void;
  onOpenLocalFolder?: () => void;
  onManageEnvironments?: () => void;
  onConnectWorkspace?: () => void;
  /** Session user from GET /api/auth/me — required to namespace `iam_recent_workspaces` in localStorage. */
  sessionUserId?: string | null;
  authWorkspaceId?: string | null;
  setAuthWorkspaceId: (id: string) => void;
  setWorkspaceDisplayName?: (name: string | null) => void;
  /** Called after server sync — parent updates sessionStorage + context. */
  onWorkspaceActivated?: (ws: AgentsamWorkspaceRow) => void;
  setToastMsg: (msg: string | null) => void;
  /** Opens the real terminal-pane PTY tunnel setup wizard (Cloudflare tunnel + cloudflared).
   *  "SSH" in this picker means "connect a remote machine via tunnel", not a raw SSH dial —
   *  there is no separate ssh_target transport implemented. Reuses the same wizard triggered
   *  by the status-bar connection menu's "Set up remote terminal" action. */
  onOpenSshSetup?: () => void;
}

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return s || 'workspace';
}

function isWorkspaceRowVisible(w: AgentsamWorkspaceRow): boolean {
  const st = String(w.status || '').trim().toLowerCase();
  if (st === 'archived' || st === 'deleted') return false;
  return true;
}

function normalizeGithubRepoRef(ref: string | null | undefined): string {
  return String(ref || '')
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .toLowerCase();
}

type GithubRepoRow = {
  id?: number | string;
  full_name?: string;
  name?: string;
  html_url?: string;
  default_branch?: string;
};

/**
 * Workspace switchboard: loads agentsam_workspace rows from GET /api/workspaces/list.
 */
export const WorkspaceLauncher: React.FC<WorkspaceLauncherProps> = ({
  onClose,
  onOpenLocalFolder,
  onManageEnvironments,
  onConnectWorkspace,
  sessionUserId,
  authWorkspaceId,
  setAuthWorkspaceId,
  setWorkspaceDisplayName,
  onWorkspaceActivated,
  setToastMsg,
  onOpenSshSetup,
}) => {
  const [activeFilter, setActiveFilter] = useState<'all' | 'local' | 'github' | 'r2' | 'ssh'>('all');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<AgentsamWorkspaceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uiMode, setUiMode] = useState<'list' | 'create'>('list');
  const [createStep, setCreateStep] = useState<1 | 2>(1);
  const [createKind, setCreateKind] = useState<'github' | 'r2' | null>(null);
  const [newName, setNewName] = useState('');
  const [extraField, setExtraField] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [githubRepos, setGithubRepos] = useState<GithubRepoRow[]>([]);
  const [githubReposLoading, setGithubReposLoading] = useState(false);
  const [githubReposAuthed, setGithubReposAuthed] = useState(true);
  const [hostedConnections, setHostedConnections] = useState<HostedTunnelConnection[]>([]);
  const [hostedLoading, setHostedLoading] = useState(false);

  const loadList = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const r = await fetch('/api/workspaces/list', { credentials: 'same-origin', signal });
      if (!r.ok) throw new Error('Failed to load workspaces');
      const data = (await r.json()) as { workspaces?: AgentsamWorkspaceRow[] };
      const list = Array.isArray(data.workspaces) ? data.workspaces : [];
      setRows(list.filter(isWorkspaceRowVisible));
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      console.error('[WorkspaceLauncher]', e);
      setRows([]);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  const loadGithubRepos = useCallback(async (signal?: AbortSignal) => {
    setGithubReposLoading(true);
    try {
      const hdr: Record<string, string> = {};
      if (authWorkspaceId?.trim()) hdr['X-IAM-Workspace-Id'] = authWorkspaceId.trim();
      const res = await fetch('/api/integrations/github/repos', {
        credentials: 'same-origin',
        headers: hdr,
        signal,
      });
      if (!res.ok) {
        setGithubReposAuthed(false);
        setGithubRepos([]);
        return;
      }
      setGithubReposAuthed(true);
      const data = await res.json();
      const list = Array.isArray(data) ? data : data.repos || [];
      setGithubRepos(Array.isArray(list) ? (list as GithubRepoRow[]) : []);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setGithubReposAuthed(false);
      setGithubRepos([]);
    } finally {
      if (!signal?.aborted) setGithubReposLoading(false);
    }
  }, [authWorkspaceId]);

  useEffect(() => {
    const ac = new AbortController();
    void loadList(ac.signal);
    return () => ac.abort();
  }, [loadList]);

  useEffect(() => {
    if (activeFilter !== 'github' && createKind !== 'github') return;
    const ac = new AbortController();
    void loadGithubRepos(ac.signal);
    return () => ac.abort();
  }, [activeFilter, createKind, loadGithubRepos]);

  const loadHostedConnections = useCallback(async (signal?: AbortSignal) => {
    const wid = authWorkspaceId?.trim();
    if (!wid) {
      setHostedConnections([]);
      return;
    }
    setHostedLoading(true);
    try {
      const list = await fetchHostedTunnelConnections(wid);
      if (!signal?.aborted) setHostedConnections(list);
    } catch {
      if (!signal?.aborted) setHostedConnections([]);
    } finally {
      if (!signal?.aborted) setHostedLoading(false);
    }
  }, [authWorkspaceId]);

  useEffect(() => {
    if (activeFilter !== 'ssh') return;
    const ac = new AbortController();
    void loadHostedConnections(ac.signal);
    return () => ac.abort();
  }, [activeFilter, loadHostedConnections]);

  const pinHostedConnection = useCallback(
    async (connectionId: string) => {
      const wid = authWorkspaceId?.trim();
      if (!wid || !connectionId.trim()) return;
      try {
        await setDefaultHostedTunnelConnection(wid, connectionId.trim());
        patchTerminalWorkspacePref(wid, {
          localConnectionId: connectionId.trim(),
          targetType: 'user_hosted_tunnel',
        });
        setToastMsg('Remote machine selected — connect Local terminal lane to use it.');
        void loadHostedConnections();
      } catch (e) {
        setToastMsg(e instanceof Error ? e.message : 'Could not select remote machine.');
      }
    },
    [authWorkspaceId, loadHostedConnections, setToastMsg],
  );

  const filteredHostedConnections = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return hostedConnections;
    return hostedConnections.filter((c) => {
      const name = c.name.toLowerCase();
      const host = (c.hostname || '').toLowerCase();
      return name.includes(q) || host.includes(q) || c.id.toLowerCase().includes(q);
    });
  }, [hostedConnections, search]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    let list = [...rows];
    if (activeFilter === 'local') {
      list = list.filter((w) => ['ide', 'scratch'].includes(String(w.workspace_type || '').toLowerCase()));
    } else if (activeFilter === 'github') {
      list = list.filter((w) => w.github_repo != null && String(w.github_repo).trim() !== '');
    } else if (activeFilter === 'r2') {
      list = list.filter((w) => w.r2_prefix != null && String(w.r2_prefix).trim() !== '');
    }

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((w) => {
        const dn = (w.display_name || '').toLowerCase();
        const sl = (w.slug || '').toLowerCase();
        const r2 = (w.r2_prefix || '').toLowerCase();
        const gh = (w.github_repo || '').toLowerCase();
        return dn.includes(q) || sl.includes(q) || r2.includes(q) || gh.includes(q);
      });
    }
    return list;
  }, [rows, activeFilter, search]);

  const filteredGithubRepos = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = githubRepos.filter((r) => String(r.full_name || r.name || '').trim());
    if (q) {
      list = list.filter((r) => {
        const full = String(r.full_name || r.name || '').toLowerCase();
        return full.includes(q);
      });
    }
    return list;
  }, [githubRepos, search]);

  const githubRepoCount = filteredGithubRepos.length;

  const activeWorkspaceLabel = useMemo(() => {
    if (!authWorkspaceId?.trim()) return '';
    const w = rows.find((x) => x.id === authWorkspaceId);
    return w?.display_name?.trim() || '';
  }, [authWorkspaceId, rows]);

  const activateWorkspace = async (ws: AgentsamWorkspaceRow) => {
    let r: Response;
    try {
      r = await fetch('/api/settings/workspaces/active', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ws.id }),
      });
    } catch {
      setToastMsg('Network error — workspace not switched. Try again.');
      return;
    }

    const data = (await r.json().catch(() => ({}))) as {
      success?: boolean;
      workspace?: { id: string; display_name: string; slug: string };
      error?: string;
    };

    if (!r.ok || !data.success || !data.workspace) {
      setToastMsg(data.error || 'Failed to switch workspace on server.');
      return;
    }

    setAuthWorkspaceId(data.workspace.id);
    setWorkspaceDisplayName?.(data.workspace.display_name);
    persistRecentWorkspaceSwitch(sessionUserId, {
      id: ws.id,
      display_name: ws.display_name,
      slug: ws.slug,
      workspace_type: ws.workspace_type ?? 'ide',
      updated_at:
        ws.updated_at != null ? Number(ws.updated_at) : Math.floor(Date.now() / 1000),
    });
    onWorkspaceActivated?.({
      ...ws,
      id: data.workspace.id,
      display_name: data.workspace.display_name,
      slug: data.workspace.slug ?? ws.slug,
    });
    setToastMsg(`Switched to ${ws.display_name}`);
    onClose();
  };

  const openGithubRepo = async (repo: GithubRepoRow) => {
    const full = String(repo.full_name || '').trim();
    if (!full) return;
    const norm = normalizeGithubRepoRef(full);

    const existing = rows.find((w) => normalizeGithubRepoRef(w.github_repo) === norm);
    if (existing) {
      await activateWorkspace(existing);
      return;
    }

    // Unlinked repos must create a new workspace — never PATCH the active workspace's
    // github_repo (clobbers ws_inneranimalmedia when browsing other repos).
    const shortName = full.split('/').pop() || full;
    setCreating(true);
    setCreateError(null);
    try {
      const r = await fetch('/api/workspaces', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: shortName,
          slug: slugify(shortName),
          workspace_type: 'project',
          github_repo: full,
        }),
      });
      const data = (await r.json().catch(() => ({}))) as {
        workspace?: AgentsamWorkspaceRow;
        error?: string;
      } & AgentsamWorkspaceRow;
      if (!r.ok) {
        setToastMsg(typeof data.error === 'string' ? data.error : 'Failed to link repository');
        return;
      }
      const row = data.workspace ?? data;
      const ws: AgentsamWorkspaceRow = {
        id: String(row.id),
        display_name: String(row.display_name || shortName),
        slug: String(row.slug || slugify(shortName)),
        workspace_type: row.workspace_type ?? 'project',
        github_repo: full,
        r2_prefix: row.r2_prefix ?? null,
        updated_at: row.updated_at != null ? Number(row.updated_at) : undefined,
      };
      setRows((prev) => [ws, ...prev.filter((x) => x.id !== ws.id)]);
      await activateWorkspace(ws);
    } catch (e) {
      setToastMsg(e instanceof Error ? e.message : 'Failed to open repository');
    } finally {
      setCreating(false);
    }
  };

  const submitCreate = async () => {
    const name = newName.trim();
    if (!name) {
      setCreateError('Name is required.');
      return;
    }
    setCreating(true);
    setCreateError(null);
    const slug = slugify(name);

    let body: Record<string, unknown> = {
      name,
      slug,
    };

    if (createKind === 'github') {
      const repo = extraField.trim();
      if (!repo) {
        setCreateError('Repository URL required.');
        setCreating(false);
        return;
      }
      body = { ...body, workspace_type: 'project', github_repo: repo };
    } else if (createKind === 'r2') {
      const prefix = extraField.trim();
      if (!prefix) {
        setCreateError('R2 prefix required.');
        setCreating(false);
        return;
      }
      body = { ...body, workspace_type: 'project', r2_prefix: prefix };
    } else {
      setCreateError('Pick a workspace type.');
      setCreating(false);
      return;
    }

    try {
      const r = await fetch('/api/workspaces', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await r.json().catch(() => ({}))) as {
        workspace?: AgentsamWorkspaceRow;
        error?: string;
      } & AgentsamWorkspaceRow;
      if (!r.ok) {
        setCreateError(typeof data.error === 'string' ? data.error : 'Create failed');
        setCreating(false);
        return;
      }
      const row = data.workspace ?? data;
      const ws: AgentsamWorkspaceRow = {
        id: String(row.id),
        display_name: String(row.display_name || name),
        slug: String(row.slug || slug),
        workspace_type: row.workspace_type ?? undefined,
        r2_prefix: row.r2_prefix ?? null,
        github_repo: row.github_repo ?? null,
        updated_at: row.updated_at != null ? Number(row.updated_at) : undefined,
      };
      setRows((prev) => [ws, ...prev.filter((x) => x.id !== ws.id)]);
      await activateWorkspace(ws);
      setUiMode('list');
      setCreateStep(1);
      setCreateKind(null);
      setNewName('');
      setExtraField('');
    } catch (e) {
      setCreateError(String(e instanceof Error ? e.message : e));
    } finally {
      setCreating(false);
    }
  };

  const filters = [
    { id: 'all' as const, label: 'All Projects', shortLabel: 'All', icon: <Server size={14} /> },
    { id: 'local' as const, label: 'Local', shortLabel: 'Local', icon: <FolderOpen size={14} /> },
    { id: 'github' as const, label: 'GitHub', shortLabel: 'GitHub', icon: <Github size={14} /> },
    { id: 'r2' as const, label: 'R2 Buckets', shortLabel: 'R2', icon: <Database size={14} /> },
    { id: 'ssh' as const, label: 'SSH', shortLabel: 'SSH', icon: <Terminal size={14} /> },
  ];

  const openCreateFlow = () => {
    setUiMode('create');
    setCreateStep(1);
    setCreateKind(null);
    setNewName('');
    setExtraField('');
    setCreateError(null);
  };

  const typeCards = (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 px-0 sm:px-2">
      {(
        [
          ['local', 'Local folder', 'Pick a directory (FSA)', FolderOpen],
          ['github', 'GitHub', 'Linked repo', Github],
          ['r2', 'R2', 'Bucket prefix', Database],
          ['ssh', 'Remote (SSH)', 'Cloudflare tunnel setup', Terminal],
        ] as const
      ).map(([id, title, sub, Icon]) => (
        <button
          key={id}
          type="button"
          onClick={() => {
            if (id === 'local') {
              onClose();
              onOpenLocalFolder?.();
              return;
            }
            if (id === 'ssh') {
              onClose();
              onOpenSshSetup?.();
              return;
            }
            setCreateKind(id as 'github' | 'r2');
            setCreateStep(2);
            setExtraField('');
            setCreateError(null);
          }}
          className={`p-3 sm:p-4 rounded-xl border text-left transition-all ${
            createKind === id
              ? 'border-[var(--solar-cyan)] bg-[var(--bg-panel)]'
              : 'border-[var(--border-subtle)] hover:border-[var(--solar-cyan)]/40'
          }`}
        >
          <Icon size={20} className="text-[var(--solar-cyan)] mb-2" />
          <p className="text-sm font-semibold text-[var(--text-heading)]">{title}</p>
          <p className="text-[11px] text-muted">{sub}</p>
        </button>
      ))}
    </div>
  );

  return (
    <div className="workspace-launcher fixed inset-0 z-[100] flex max-md:items-stretch md:items-center justify-center bg-[var(--bg-app)]/80 backdrop-blur-md animate-in fade-in duration-300 p-0 md:p-2">
      <div className="w-full max-w-4xl h-[min(600px,92dvh)] max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:max-w-none bg-[var(--bg-panel)] border border-[var(--border-main)] max-md:border-0 md:rounded-2xl max-md:rounded-none shadow-2xl flex flex-col overflow-hidden">
        <div className="px-3 py-3 sm:px-4 sm:py-4 md:p-6 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-[var(--solar-cyan)]/10 flex items-center justify-center text-[var(--solar-cyan)] shrink-0">
              <Server size={20} className="sm:hidden" />
              <Server size={24} className="hidden sm:block" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg md:text-xl font-bold text-[var(--text-heading)] truncate">
                Switch Workspace
              </h2>
              <p className="text-[11px] sm:text-sm text-muted truncate hidden sm:block">
                Select or create a development environment
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close workspace picker"
            className="p-2 shrink-0 hover:bg-[var(--bg-app)] rounded-lg text-muted hover:text-main transition-colors"
          >
            <Plus size={20} className="rotate-45" />
          </button>
        </div>

        <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
          <div className="w-64 max-md:w-full max-md:shrink-0 border-r border-[var(--border-subtle)] max-md:border-r-0 max-md:border-b bg-[var(--bg-app)]/50 p-3 md:p-4 max-md:space-y-0 space-y-1 max-md:flex max-md:flex-row max-md:overflow-x-auto max-md:gap-1.5 max-md:overscroll-x-contain max-md:[-webkit-overflow-scrolling:touch] max-md:scrollbar-none">
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setActiveFilter(f.id)}
                disabled={uiMode === 'create'}
                title={f.label}
                className={`w-full max-md:w-auto max-md:shrink-0 flex items-center gap-3 max-md:gap-1 max-md:flex-col px-3 max-md:px-2.5 py-2.5 max-md:py-2 rounded-xl max-md:rounded-lg text-sm max-md:text-[10px] font-medium transition-all min-w-[3.25rem] ${
                  activeFilter === f.id
                    ? 'bg-[var(--bg-panel)] text-[var(--solar-cyan)] shadow-sm border border-[var(--border-subtle)]'
                    : 'text-muted hover:text-main hover:bg-[var(--bg-panel)]/50'
                } ${uiMode === 'create' ? 'opacity-40 pointer-events-none' : ''}`}
              >
                {f.icon}
                <span className="md:hidden max-md:leading-tight max-md:text-center">{f.shortLabel}</span>
                <span className="max-md:hidden">{f.label}</span>
              </button>
            ))}

            <div className="pt-8 px-3 max-md:hidden">
              <p className="text-[10px] uppercase tracking-widest font-bold text-muted mb-4">
                Operations
              </p>
              <button
                type="button"
                onClick={openCreateFlow}
                className="w-full flex items-center gap-3 text-sm text-muted hover:text-main transition-colors py-2"
              >
                <Plus size={14} /> New Workspace
              </button>
              {onOpenLocalFolder ? (
                <button
                  type="button"
                  onClick={() => onOpenLocalFolder()}
                  className="w-full flex items-center gap-3 text-sm text-muted hover:text-main transition-colors py-2"
                >
                  <FolderOpen size={14} /> Open local folder
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => onManageEnvironments?.()}
                className="w-full flex items-center gap-3 text-sm text-muted hover:text-main transition-colors py-2"
              >
                <Settings size={14} /> Manage environments
              </button>
            </div>
          </div>

          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            {uiMode === 'list' ? (
              <>
                <div className="md:hidden flex items-center gap-1.5 px-3 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-app)]/30 shrink-0 overflow-x-auto [-webkit-overflow-scrolling:touch]">
                  <button
                    type="button"
                    onClick={openCreateFlow}
                    className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[10px] font-semibold text-main"
                  >
                    <Plus size={12} /> New
                  </button>
                  {onOpenLocalFolder ? (
                    <button
                      type="button"
                      onClick={() => onOpenLocalFolder()}
                      className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[10px] font-semibold text-main"
                    >
                      <FolderOpen size={12} /> Local
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onManageEnvironments?.()}
                    className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[10px] font-semibold text-main"
                  >
                    <Settings size={12} /> Manage
                  </button>
                </div>

                <div className="p-3 sm:p-4 border-b border-[var(--border-subtle)] shrink-0">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
                    <input
                      type="search"
                      placeholder="Search workspaces…"
                      className="w-full bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded-xl py-2 sm:py-2.5 pl-10 pr-4 text-[13px] sm:text-sm focus:outline-none focus:border-[var(--solar-cyan)]/50 transition-all font-sans"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-2 [-webkit-overflow-scrolling:touch]">
                  {activeFilter === 'github' ? (
                    githubReposLoading && githubRepos.length === 0 ? (
                      <div className="h-full flex items-center justify-center gap-2 text-muted text-[13px]">
                        <Loader2 size={16} className="animate-spin" />
                        Loading GitHub repositories…
                      </div>
                    ) : !githubReposAuthed ? (
                      <div className="text-center py-10 sm:py-16 space-y-4 px-4">
                        <p className="text-[13px] text-muted">
                          Connect GitHub to browse your repositories here.
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            window.location.href =
                              '/api/oauth/github/start?return_to=' +
                              encodeURIComponent('/dashboard/agent');
                          }}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--solar-cyan)] text-xs font-bold hover:bg-[var(--bg-hover)]"
                        >
                          <Github size={14} />
                          Connect GitHub
                        </button>
                      </div>
                    ) : filteredGithubRepos.length === 0 ? (
                      <div className="text-muted text-center py-10 sm:py-16 text-[13px] sm:text-sm">
                        No GitHub repositories match this search.
                      </div>
                    ) : (
                      <>
                        <p className="text-[10px] uppercase tracking-wider font-bold text-muted px-1">
                          Your GitHub repositories ({githubRepoCount})
                        </p>
                        {filteredGithubRepos.map((repo) => {
                          const full = String(repo.full_name || repo.name || '').trim();
                          const linked = rows.some(
                            (w) => normalizeGithubRepoRef(w.github_repo) === normalizeGithubRepoRef(full),
                          );
                          return (
                            <div
                              key={String(repo.id ?? full)}
                              className="flex flex-col sm:flex-row items-stretch gap-2 p-2.5 sm:p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)]/40 hover:bg-[var(--bg-hover)]/50 transition-colors"
                            >
                              <div className="flex-1 min-w-0 flex items-start gap-2">
                                <FolderGit2
                                  size={16}
                                  className="shrink-0 text-[var(--solar-cyan)] mt-0.5"
                                />
                                <div className="min-w-0">
                                  <div className="font-bold text-[var(--text-heading)] truncate text-[13px] sm:text-sm">
                                    {full}
                                  </div>
                                  <div className="text-[10px] sm:text-[11px] text-muted mt-0.5 flex flex-wrap gap-x-2">
                                    {repo.default_branch ? (
                                      <span>branch: {repo.default_branch}</span>
                                    ) : null}
                                    {linked ? (
                                      <span className="text-[var(--solar-cyan)]">Linked workspace</span>
                                    ) : (
                                      <span>Not linked yet</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <button
                                type="button"
                                disabled={creating}
                                onClick={() => void openGithubRepo(repo)}
                                className="shrink-0 w-full sm:w-auto px-4 py-2 sm:py-1.5 rounded-lg bg-[var(--solar-cyan)]/20 text-[var(--solar-cyan)] text-xs font-bold hover:bg-[var(--solar-cyan)]/30 disabled:opacity-40"
                              >
                                Open
                              </button>
                            </div>
                          );
                        })}
                        {filtered.length > 0 ? (
                          <div className="pt-4 space-y-2">
                            <p className="text-[10px] uppercase tracking-wider font-bold text-muted px-1">
                              Linked workspaces
                            </p>
                            {filtered.map((w) => (
                              <WorkspaceTerminalTile
                                key={w.id}
                                workspaceId={w.id}
                                displayName={w.display_name || w.slug || w.id}
                                slug={w.slug}
                                githubRepo={w.github_repo}
                                prefs={loadPrefsForWorkspace(w.id)}
                                isActive={w.id === authWorkspaceId}
                                onOpen={(id) => {
                                  const row = rows.find((r) => r.id === id);
                                  if (row) void activateWorkspace(row);
                                }}
                              />
                            ))}
                          </div>
                        ) : null}
                      </>
                    )
                  ) : activeFilter === 'ssh' ? (
                    hostedLoading && hostedConnections.length === 0 ? (
                      <div className="h-full flex items-center justify-center gap-2 text-muted text-[13px]">
                        <Loader2 size={16} className="animate-spin" />
                        Loading remote machines…
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between gap-2 px-1 pb-2">
                          <p className="text-[10px] uppercase tracking-wider font-bold text-muted">
                            Remote machines ({filteredHostedConnections.length})
                          </p>
                          {onOpenSshSetup ? (
                            <button
                              type="button"
                              onClick={() => onOpenSshSetup()}
                              className="text-[10px] font-bold text-[var(--solar-cyan)] hover:underline"
                            >
                              + Setup wizard
                            </button>
                          ) : null}
                        </div>
                        {filteredHostedConnections.length === 0 ? (
                          <div className="text-center py-10 space-y-4">
                            <p className="text-[13px] text-muted">
                              No remote machines yet. Run the Cloudflare tunnel wizard to add one.
                            </p>
                            {onOpenSshSetup ? (
                              <button
                                type="button"
                                onClick={() => onOpenSshSetup()}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--solar-cyan)] text-xs font-bold hover:bg-[var(--bg-hover)]"
                              >
                                <Terminal size={14} />
                                Remote (SSH) setup
                              </button>
                            ) : null}
                          </div>
                        ) : (
                          filteredHostedConnections.map((conn) => (
                            <div
                              key={conn.id}
                              className="flex flex-col sm:flex-row items-stretch gap-2 p-2.5 sm:p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)]/40"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="font-bold text-[var(--text-heading)] text-[13px] truncate">
                                  {conn.is_default ? '★ ' : ''}{conn.name}
                                </div>
                                <div className="text-[10px] text-muted mt-0.5 flex flex-wrap gap-x-2">
                                  {conn.hostname ? <span>{conn.hostname}</span> : null}
                                  {conn.is_active ? (
                                    <span className="text-[var(--solar-cyan)]">live</span>
                                  ) : (
                                    <span>waiting for cloudflared</span>
                                  )}
                                  {conn.platform ? <span>{conn.platform}</span> : null}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => void pinHostedConnection(conn.id)}
                                className="shrink-0 px-4 py-2 rounded-lg bg-[var(--solar-cyan)]/20 text-[var(--solar-cyan)] text-xs font-bold hover:bg-[var(--solar-cyan)]/30"
                              >
                                Use
                              </button>
                            </div>
                          ))
                        )}
                      </>
                    )
                  ) : loading ? (
                    <div className="h-full flex items-center justify-center text-muted animate-pulse">
                      Loading workspaces…
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="text-muted text-center py-10 sm:py-16 text-[13px] sm:text-sm space-y-4">
                      <p>No workspaces match this filter.</p>
                      {activeFilter === 'local' && onOpenLocalFolder ? (
                        <button
                          type="button"
                          onClick={() => onOpenLocalFolder()}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--solar-cyan)] text-xs font-bold hover:bg-[var(--bg-hover)]"
                        >
                          <FolderOpen size={14} />
                          Open local folder instead
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    filtered.map((w) => (
                      <WorkspaceTerminalTile
                        key={w.id}
                        workspaceId={w.id}
                        displayName={w.display_name || w.slug || w.id}
                        slug={w.slug}
                        githubRepo={w.github_repo}
                        prefs={loadPrefsForWorkspace(w.id)}
                        isActive={w.id === authWorkspaceId}
                        onOpen={(id) => {
                          const row = rows.find((r) => r.id === id);
                          if (row) void activateWorkspace(row);
                        }}
                      />
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-6 [-webkit-overflow-scrolling:touch]">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    className="text-xs text-[var(--solar-cyan)] font-semibold"
                    onClick={() => {
                      if (createStep === 2) {
                        setCreateStep(1);
                        setCreateKind(null);
                        setCreateError(null);
                      } else {
                        setUiMode('list');
                      }
                    }}
                  >
                    ← Back
                  </button>
                </div>

                {createStep === 1 ? (
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-[var(--text-heading)]">Workspace type</h3>
                    {typeCards}
                  </div>
                ) : (
                  <div className="space-y-4 max-w-md">
                    <label className="block">
                      <span className="text-[11px] uppercase text-muted font-bold">
                        Display name
                      </span>
                      <input
                        className="mt-1 w-full bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="My workspace"
                      />
                    </label>
                    {createKind === 'github' ? (
                      <label className="block">
                        <span className="text-[11px] uppercase text-muted font-bold">
                          GitHub repo URL
                        </span>
                        <input
                          className="mt-1 w-full bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm font-mono text-[12px]"
                          value={extraField}
                          onChange={(e) => setExtraField(e.target.value)}
                          placeholder="https://github.com/org/repo"
                        />
                      </label>
                    ) : null}
                    {createKind === 'r2' ? (
                      <label className="block">
                        <span className="text-[11px] uppercase text-muted font-bold">
                          R2 prefix
                        </span>
                        <input
                          className="mt-1 w-full bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm font-mono text-[12px]"
                          value={extraField}
                          onChange={(e) => setExtraField(e.target.value)}
                          placeholder="my-bucket/prefix/"
                        />
                      </label>
                    ) : null}

                    {createError ? (
                      <p className="text-[12px] text-red-400">{createError}</p>
                    ) : null}

                    <button
                      type="button"
                      disabled={creating}
                      onClick={() => void submitCreate()}
                      className="w-full py-2.5 rounded-lg bg-[var(--solar-cyan)] text-black text-xs font-bold uppercase tracking-wide disabled:opacity-50"
                    >
                      {creating ? 'Creating…' : 'Create workspace'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="px-3 py-2.5 sm:p-4 bg-[var(--bg-app)] border-t border-[var(--border-subtle)] flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between text-[10px] sm:text-[11px] gap-2 sm:gap-3 shrink-0 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-2 sm:gap-3 text-muted shrink-0">
            <span className="max-phone:inline-flex hidden items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--bg-panel)] border border-[var(--border-subtle)] whitespace-nowrap">
              <ShieldCheck size={12} className="text-[var(--solar-green)]" /> Auth
            </span>
            <span className="max-phone:inline-flex hidden items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--bg-panel)] border border-[var(--border-subtle)] whitespace-nowrap">
              <Server size={12} /> D1
            </span>
            <span className="max-phone:hidden flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--bg-panel)] border border-[var(--border-subtle)] whitespace-nowrap">
              <ShieldCheck size={12} className="text-[var(--solar-green)]" /> Authenticated
            </span>
            <span className="max-phone:hidden flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--bg-panel)] border border-[var(--border-subtle)] whitespace-nowrap">
              <Server size={12} /> D1 Active
            </span>
          </div>
          {activeWorkspaceLabel ? (
            <p className="text-muted font-mono truncate w-full sm:max-w-[55%] sm:text-right text-[10px] sm:text-[11px]">
              {activeWorkspaceLabel}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
};
