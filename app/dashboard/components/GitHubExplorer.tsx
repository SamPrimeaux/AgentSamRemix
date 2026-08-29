import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Github,
  ExternalLink,
  Loader2,
  RefreshCw,
  Lock,
  ChevronRight,
  ChevronDown,
  Trash2,
  FilePlus,
  Search,
  PanelLeftClose,
  Folder,
  ArrowLeft,
} from 'lucide-react';
import type { ActiveFile } from '../types';
import { SetiFileIcon } from '../src/components/SetiFileIcon';
import {
  flattenVisibleGithubTree,
  mapGithubNodeByPath,
  sortGithubChildren,
  GITHUB_TREE_ROW_HEIGHT_PX,
  type GithubFileNode,
  type GithubFileTreeRow,
} from '../src/lib/githubFileTree';
import { GITHUB_REPOS_RL_UNTIL_KEY } from '../src/lib/sessionStorageKeys';

function utf8ToBase64(text: string) {
  return btoa(unescape(encodeURIComponent(text)));
}

/** Top-level reconnect (no popup=1) — callback must 302 back to editor, not "Closing…" HTML. */
const GITHUB_INTEGRATION_OAUTH_HREF =
  '/api/oauth/github/start?return_to=' + encodeURIComponent('/dashboard/agent/editor');

type RepoListErrorKind = 'reconnect' | 'rate_limit' | 'unavailable' | 'other';

function repoListErrorKind(status: number): RepoListErrorKind {
  if (status === 401 || status === 403) return 'reconnect';
  if (status === 404) return 'unavailable';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'unavailable';
  return 'other';
}

function requestMobileActivitySheetExpand(vh?: number) {
  if (typeof window === 'undefined') return;
  if (!window.matchMedia('(max-width: 430px)').matches) return;
  window.dispatchEvent(new CustomEvent('iam-mobile-activity-sheet-expand', { detail: { vh } }));
}

// ── Inline tree renderer (replaces CWD-swap pattern) ───────────────────────

interface GithubTreeViewProps {
  root: GithubFileNode;
  fullName: string;
  branch: string;
  onToggleDir: (node: GithubFileNode) => void;
  onOpenFile: (node: GithubFileNode) => void;
  onDeleteFile: (node: GithubFileNode) => void;
  onNewFile: (parentPath: string) => void;
}

const GithubTreeView: React.FC<GithubTreeViewProps & { fillHeight?: boolean }> = ({
  root,
  fullName,
  branch,
  onToggleDir,
  onOpenFile,
  onDeleteFile,
  onNewFile,
  fillHeight = false,
}) => {
  const rows = useMemo(() => flattenVisibleGithubTree(root), [root]);
  // Skip the root repo node itself — we render it as the header above
  const visibleRows = rows.slice(1);

  if (visibleRows.length === 0 && !root.loading) {
    return <p className="px-3 py-2 text-[10px] text-muted italic">(empty repository)</p>;
  }

  return (
    <div className={`flex flex-col min-h-0 ${fillHeight ? 'flex-1 h-full' : ''}`}>
      <div
        className={`overflow-y-auto overscroll-contain ${fillHeight ? 'flex-1 min-h-0' : ''}`}
        style={fillHeight ? undefined : { maxHeight: 'min(55vh, 520px)' }}
      >
      {visibleRows.map((row) => {
        if (row.type === 'loading') {
          return (
            <div
              key={row.id}
              style={{ height: GITHUB_TREE_ROW_HEIGHT_PX, paddingLeft: `${row.depth * 12 + 8}px` }}
              className="flex items-center gap-1.5 text-[11px] text-muted"
            >
              <Loader2 size={12} className="animate-spin shrink-0" />
              <span>Loading…</span>
            </div>
          );
        }

        if (row.type === 'empty') {
          return (
            <div
              key={row.id}
              style={{ height: GITHUB_TREE_ROW_HEIGHT_PX, paddingLeft: `${row.depth * 12 + 8}px` }}
              className="flex items-center gap-1.5 text-[11px] text-muted italic"
            >
              <span className="w-3.5 shrink-0" />
              <span>(empty)</span>
            </div>
          );
        }

        const { node, depth } = row as Extract<GithubFileTreeRow, { type: 'entry' }>;
        const isDir = node.kind === 'directory';
        const indent = depth * 12 + 4;

        return (
          <div
            key={row.id}
            className="flex items-center group hover:bg-[var(--bg-hover)] pr-1"
            style={{ height: GITHUB_TREE_ROW_HEIGHT_PX }}
          >
            <button
              type="button"
              onClick={() => isDir ? onToggleDir(node) : onOpenFile(node)}
              style={{ paddingLeft: `${indent}px` }}
              className="flex flex-1 min-w-0 items-center gap-1.5 h-full text-left text-[12px]"
            >
              {isDir ? (
                <>
                  {node.isOpen
                    ? <ChevronDown size={13} className="shrink-0 text-muted opacity-60" />
                    : <ChevronRight size={13} className="shrink-0 text-muted opacity-60" />
                  }
                  <Folder size={13} className="shrink-0 text-[var(--solar-blue)]" />
                </>
              ) : (
                <>
                  <span className="w-3.5 shrink-0" />
                  <SetiFileIcon filename={node.name} size={13} />
                </>
              )}
              <span className="truncate">{node.name}</span>
              {node.loading && <Loader2 size={11} className="ml-auto shrink-0 animate-spin text-muted" />}
            </button>

            {/* Actions: new file in dir, delete file */}
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 shrink-0">
              {isDir && (
                <button
                  type="button"
                  title="New file here"
                  className="p-1 text-muted hover:text-[var(--solar-cyan)]"
                  onClick={(e) => { e.stopPropagation(); onNewFile(node.path); }}
                >
                  <FilePlus size={11} />
                </button>
              )}
              {!isDir && (
                <button
                  type="button"
                  title="Delete file"
                  className="p-1 text-muted hover:text-[var(--solar-orange)]"
                  onClick={(e) => { e.stopPropagation(); onDeleteFile(node); }}
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          </div>
        );
      })}
      </div>
      <p className="px-3 py-0.5 text-[9px] text-muted border-t border-[var(--border-subtle)]/30 shrink-0">
        {visibleRows.filter((r) => r.type === 'entry').length} visible · {branch}
      </p>
    </div>
  );
};

// ── Main GitHubExplorer ─────────────────────────────────────────────────────

export const GitHubExplorer: React.FC<{
  onOpenInEditor?: (file: ActiveFile) => void;
  expandRepoFullName?: string | null;
  onExpandRepoConsumed?: () => void;
  workspace_id?: string | null;
  onClose?: () => void;
  /** Hide outer chrome when nested in AgentSamFilesystem. */
  embedded?: boolean;
}> = ({ onOpenInEditor, expandRepoFullName, onExpandRepoConsumed, workspace_id = null, onClose, embedded = false }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(true);
  const [reconnectAfterReposFailure, setReconnectAfterReposFailure] = useState(false);
  const [repos, setRepos] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [repoFilter, setRepoFilter] = useState('');

  // Per-repo tree roots (keyed by fullName)
  const [treeByRepo, setTreeByRepo] = useState<Record<string, GithubFileNode>>({});
  const [expandedRepo, setExpandedRepo] = useState<string | null>(null);

  const rateLimitedUntil = useRef(0);

  const readReposRateLimitUntil = (): number => {
    try {
      const n = Number(sessionStorage.getItem(GITHUB_REPOS_RL_UNTIL_KEY) || 0);
      return Number.isFinite(n) ? n : 0;
    } catch { return 0; }
  };

  const fetchRepos = async () => {
    const rlUntil = Math.max(rateLimitedUntil.current, readReposRateLimitUntil());
    if (Date.now() < rlUntil) {
      setLoadError('Rate limited — try again shortly');
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/integrations/github/repos', { credentials: 'same-origin' });
      const bodyText = await res.text();
      let data: Record<string, unknown> | unknown[] = {};
      try { data = bodyText ? JSON.parse(bodyText) : {}; } catch { data = {}; }

      if (res.status !== 200) {
        const kind = repoListErrorKind(res.status);
        if (kind === 'reconnect') { setIsAuthenticated(false); setReconnectAfterReposFailure(true); setRepos([]); return; }
        if (kind === 'rate_limit') {
          const until = Date.now() + 60_000;
          rateLimitedUntil.current = until;
          try { sessionStorage.setItem(GITHUB_REPOS_RL_UNTIL_KEY, String(until)); } catch { /* ignore */ }
          setLoadError('Rate limited — try again shortly');
          return;
        }
        const d = data as Record<string, unknown>;
        setLoadError(typeof d.message === 'string' ? d.message : typeof d.error === 'string' ? d.error : `Request failed (${res.status})`);
        return;
      }
      setReconnectAfterReposFailure(false);
      const list = Array.isArray(data) ? data : ((data as Record<string, unknown>).repos as unknown[]) || [];
      setRepos(list);
      setIsAuthenticated(true);
    } catch (err) {
      setIsAuthenticated(false);
      setLoadError(err instanceof Error ? err.message : 'Failed to load repos');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(GITHUB_REPOS_RL_UNTIL_KEY);
      const n = raw ? Number(raw) : 0;
      if (Number.isFinite(n) && n > Date.now()) rateLimitedUntil.current = n;
    } catch { /* ignore */ }
    void fetchRepos();
  }, [workspace_id]);

  useEffect(() => {
    setRepos([]);
    setTreeByRepo({});
    setLoadError(null);
    setExpandedRepo((prev) => {
      if (prev) {
        try {
          window.dispatchEvent(
            new CustomEvent('iam_explorer_active_repo', { detail: { active_repo: null } }),
          );
        } catch {
          /* ignore */
        }
      }
      return null;
    });
  }, [workspace_id]);

  const filteredRepos = useMemo(() => {
    const q = repoFilter.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter((r) => String(r.full_name || r.name || '').toLowerCase().includes(q));
  }, [repos, repoFilter]);

  const defaultBranchFor = useCallback((fullName: string) => {
    const r = repos.find((x) => x.full_name === fullName);
    const b = r?.default_branch;
    return typeof b === 'string' && b.trim() ? b.trim() : 'main';
  }, [repos]);

  // Fetch children for a specific node path and inject into tree
  const fetchChildren = useCallback(async (fullName: string, nodePath: string, branch: string) => {
    const [owner, repo] = fullName.split('/');
    if (!owner || !repo) return;

    try {
      const qs = new URLSearchParams();
      if (nodePath) qs.set('path', nodePath);
      if (branch) qs.set('ref', branch);
      const res = await fetch(
        `/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents?${qs}`,
        { credentials: 'same-origin' },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const kind = repoListErrorKind(res.status);
        if (kind === 'reconnect') { setIsAuthenticated(false); setReconnectAfterReposFailure(true); }
        else setLoadError(`GitHub error (${res.status})`);
        // Mark node as loaded but empty
        setTreeByRepo((prev) => {
          const root = prev[fullName];
          if (!root) return prev;
          const target = nodePath || root.path;
          const updated = mapGithubNodeByPath(root, target, (n) => ({ ...n, loading: false, children: [] }));
          return { ...prev, [fullName]: updated };
        });
        return;
      }

      const list = Array.isArray(data) ? data : [];
      const children: GithubFileNode[] = sortGithubChildren(
        list.map((it: any) => ({
          name: it.name,
          path: it.path,
          kind: it.type === 'dir' ? 'directory' : 'file',
          sha: it.sha,
          size: it.size,
          isOpen: false,
        }))
      );

      setTreeByRepo((prev) => {
        const root = prev[fullName];
        if (!root) return prev;
        const target = nodePath || root.path;
        const updated = mapGithubNodeByPath(root, target, (n) => ({ ...n, loading: false, children }));
        return { ...prev, [fullName]: updated };
      });
    } catch {
      setTreeByRepo((prev) => {
        const root = prev[fullName];
        if (!root) return prev;
        const target = nodePath || root.path;
        const updated = mapGithubNodeByPath(root, target, (n) => ({ ...n, loading: false, children: [] }));
        return { ...prev, [fullName]: updated };
      });
    }
  }, []);

  /** Collapse focused tree → OAuth repo list (connected repos switcher). */
  const collapseToRepoList = useCallback(() => {
    setExpandedRepo(null);
    try {
      window.dispatchEvent(
        new CustomEvent('iam_explorer_active_repo', { detail: { active_repo: null } }),
      );
    } catch {
      /* ignore */
    }
  }, []);

  const toggleRepo = useCallback((fullName: string) => {
    if (expandedRepo === fullName) {
      collapseToRepoList();
      return;
    }
    setExpandedRepo(fullName);
    requestMobileActivitySheetExpand(58);
    try {
      window.dispatchEvent(
        new CustomEvent('iam_explorer_active_repo', {
          detail: { active_repo: fullName, branch: defaultBranchFor(fullName) },
        }),
      );
    } catch {
      /* ignore */
    }

    // Init tree root if not yet loaded
    setTreeByRepo((prev) => {
      if (prev[fullName]) return prev;
      const branch = defaultBranchFor(fullName);
      const root: GithubFileNode = {
        name: fullName.split('/')[1] || fullName,
        path: '',
        kind: 'directory',
        isOpen: true,
        loading: true,
      };
      return { ...prev, [fullName]: root };
    });

    // Fetch root contents
    const branch = defaultBranchFor(fullName);
    void fetchChildren(fullName, '', branch);
  }, [expandedRepo, defaultBranchFor, fetchChildren, collapseToRepoList]);

  const handleToggleDir = useCallback((fullName: string, branch: string, node: GithubFileNode) => {
    if (node.isOpen) {
      // Collapse
      setTreeByRepo((prev) => {
        const root = prev[fullName];
        if (!root) return prev;
        const updated = mapGithubNodeByPath(root, node.path, (n) => ({ ...n, isOpen: false }));
        return { ...prev, [fullName]: updated };
      });
      return;
    }

    // Expand — mark loading, fetch if children not loaded
    setTreeByRepo((prev) => {
      const root = prev[fullName];
      if (!root) return prev;
      const updated = mapGithubNodeByPath(root, node.path, (n) => ({
        ...n,
        isOpen: true,
        loading: n.children === undefined,
      }));
      return { ...prev, [fullName]: updated };
    });

    if (node.children === undefined) {
      void fetchChildren(fullName, node.path, branch);
    }
  }, [fetchChildren]);

  const handleOpenFile = useCallback(async (fullName: string, branch: string, node: GithubFileNode) => {
    if (!onOpenInEditor) return;
    const [owner, repo] = fullName.split('/');
    if (!owner || !repo) return;
    try {
      const qs = new URLSearchParams({ path: node.path, ref: branch });
      const res = await fetch(
        `/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents?${qs}`,
        { credentials: 'same-origin' },
      );
      const data = await res.json();
      if (!res.ok || data.type !== 'file' || typeof data.content !== 'string') return;
      const { isBinaryFile } = await import('../src/lib/fileKind');
      const { activeFileFromPreview } = await import('../src/lib/mediaPreview');
      const fileSize = typeof data.size === 'number' ? data.size : null;
      if (isBinaryFile(node.name, fileSize)) {
        onOpenInEditor({
          ...activeFileFromPreview({ name: node.name, kind: 'binary', previewUrl: '', size: fileSize ?? undefined, binaryMessage: 'Binary file — preview not available.' }),
          githubPath: node.path, githubRepo: fullName, githubSha: data.sha, githubBranch: branch,
        });
        return;
      }
      const raw = String(data.content).replace(/\n/g, '');
      const bytes = new Uint8Array(atob(raw).split('').map((c) => c.charCodeAt(0)));
      const text = new TextDecoder().decode(bytes);
      onOpenInEditor({
        name: node.name, content: text, originalContent: text,
        githubPath: node.path, githubRepo: fullName,
        githubSha: typeof data.sha === 'string' ? data.sha : undefined,
        githubBranch: branch, size: fileSize ?? undefined,
        source_type: 'github',
      });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      console.error(e);
    }
  }, [onOpenInEditor]);

  const handleDeleteFile = useCallback(async (fullName: string, branch: string, node: GithubFileNode) => {
    if (!node.sha) { window.alert('Missing SHA — refresh and retry.'); return; }
    if (!window.confirm(`Delete ${node.path} on GitHub?`)) return;
    const [owner, repo] = fullName.split('/');
    if (!owner || !repo) return;
    try {
      const res = await fetch(
        `/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ path: node.path, message: 'Delete via Agent Sam', sha: node.sha, branch }),
        },
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        window.alert(typeof d.message === 'string' ? d.message : 'Delete failed');
        return;
      }
      // Remove from tree
      setTreeByRepo((prev) => {
        const root = prev[fullName];
        if (!root) return prev;
        const parentPath = node.path.includes('/') ? node.path.split('/').slice(0, -1).join('/') : '';
        const updated = mapGithubNodeByPath(root, parentPath || root.path, (n) => ({
          ...n,
          children: n.children?.filter((c) => c.path !== node.path),
        }));
        return { ...prev, [fullName]: updated };
      });
    } catch (e) { console.error(e); window.alert('Delete failed'); }
  }, []);

  const handleNewFile = useCallback(async (fullName: string, branch: string, parentPath: string) => {
    const name = window.prompt('New file name', 'new-file.ts');
    if (!name?.trim()) return;
    const [owner, repo] = fullName.split('/');
    if (!owner || !repo) return;
    const filePath = parentPath ? `${parentPath}/${name.trim()}` : name.trim();
    try {
      const res = await fetch(
        `/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ path: filePath, message: 'Create via Agent Sam', content: utf8ToBase64('\n'), branch }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { window.alert(typeof data.message === 'string' ? data.message : 'Create failed'); return; }
      // Refresh parent dir
      await fetchChildren(fullName, parentPath, branch);
      if (onOpenInEditor) {
        onOpenInEditor({ name: name.trim(), content: '\n', originalContent: '\n', githubPath: filePath, githubRepo: fullName, githubSha: data.content?.sha || data.sha, githubBranch: branch });
      }
    } catch (e) { console.error(e); window.alert('Create failed'); }
  }, [fetchChildren, onOpenInEditor]);

  // One-shot external expand — parent must clear via onExpandRepoConsumed so Back
  // can show the OAuth repo list without being forced open again by a sticky pin.
  useEffect(() => {
    const fn = expandRepoFullName?.trim();
    if (!fn || isLoading) return;
    if (expandedRepo === fn) {
      onExpandRepoConsumed?.();
      return;
    }
    toggleRepo(fn);
    onExpandRepoConsumed?.();
  }, [expandRepoFullName, isLoading, expandedRepo, toggleRepo, onExpandRepoConsumed]);

  // Re-broadcast open repo when chat mounts after explorer (or on expand change).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const publish = () => {
      if (!expandedRepo) return;
      try {
        window.dispatchEvent(
          new CustomEvent('iam_explorer_active_repo', {
            detail: { active_repo: expandedRepo, branch: defaultBranchFor(expandedRepo) },
          }),
        );
      } catch {
        /* ignore */
      }
    };
    const onRequest = () => publish();
    window.addEventListener('iam_explorer_request_active_repo', onRequest);
    publish();
    return () => window.removeEventListener('iam_explorer_request_active_repo', onRequest);
  }, [expandedRepo, defaultBranchFor]);

  if (!isAuthenticated) {
    return (
      <div
        className={`w-full h-full flex flex-col items-center justify-center p-6 text-center ${
          embedded ? 'bg-transparent' : 'bg-[var(--dashboard-panel)]'
        }`}
      >
        <div className="p-10 bg-[var(--text-main)]/5 rounded-full mb-6 border border-dashed border-[var(--text-main)]/20 relative">
          <Github size={48} className="text-main opacity-80" />
          <div className="absolute top-0 right-0 bg-[var(--dashboard-panel)] p-1 rounded-full border border-[var(--border-subtle)]">
            <Lock size={12} className="text-muted" />
          </div>
        </div>
        <h3 className="text-[14px] font-bold mb-2 uppercase tracking-widest text-[var(--text-heading)]">
          {reconnectAfterReposFailure ? 'Reconnect GitHub' : 'GitHub'}
        </h3>
        <p className="text-[11px] font-mono text-muted mb-8 max-w-[220px]">
          {reconnectAfterReposFailure
            ? 'GitHub returned an auth error. Use Reconnect to re-run OAuth.'
            : 'Connect GitHub OAuth to browse repos, open files, and write back.'}
        </p>
        <button
          type="button"
          onClick={() => { window.location.href = GITHUB_INTEGRATION_OAUTH_HREF; }}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-[var(--text-main)] text-[var(--dashboard-panel)] hover:brightness-110 rounded text-[11px] font-bold transition-all w-full max-w-[220px]"
        >
          <ExternalLink size={14} /> {reconnectAfterReposFailure ? 'Reconnect GitHub' : 'Connect GitHub'}
        </button>
      </div>
    );
  }

  // If a repo is expanded, show focused tree view (hides repo list)
  const activeTree = expandedRepo ? treeByRepo[expandedRepo] : null;
  const activeBranch = expandedRepo ? defaultBranchFor(expandedRepo) : '';

  return (
    <div
      className={`w-full h-full flex flex-col text-main overflow-hidden min-h-0 ${
        embedded ? 'bg-transparent' : 'bg-[var(--dashboard-panel)]'
      }`}
    >
      <div
        className={`${embedded ? 'px-2 py-1' : 'px-3 py-2'} border-b border-[var(--border-subtle)] flex items-center justify-between shrink-0`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {expandedRepo ? (
            <button
              type="button"
              onClick={collapseToRepoList}
              className="p-1 hover:bg-[var(--bg-hover)] rounded text-muted hover:text-main"
              title="Back to repos"
              aria-label="Back to repositories"
            >
              <ArrowLeft size={13} />
            </button>
          ) : embedded ? null : (
            <Github size={13} className="shrink-0 text-muted" />
          )}
          {!embedded ? (
            <span className="text-[11px] font-bold tracking-widest uppercase truncate text-muted">
              {expandedRepo ? expandedRepo.split('/')[1] : 'Repositories'}
            </span>
          ) : expandedRepo ? (
            <span className="text-[11px] font-medium truncate text-main">{expandedRepo}</span>
          ) : null}
          {expandedRepo && (
            <span className="text-[9px] font-mono text-muted/60 truncate">{activeBranch}</span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {expandedRepo ? (
            <button
              type="button"
              onClick={() => void handleNewFile(expandedRepo, activeBranch, '')}
              className="p-1.5 hover:bg-[var(--bg-hover)] rounded text-muted hover:text-[var(--solar-cyan)]"
              title="New file in root"
            >
              <FilePlus size={12} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              if (expandedRepo) {
                setTreeByRepo((prev) => {
                  const root = prev[expandedRepo];
                  if (!root) return prev;
                  return { ...prev, [expandedRepo]: { ...root, loading: true, children: undefined } };
                });
                void fetchChildren(expandedRepo, '', activeBranch);
              } else {
                void fetchRepos();
              }
            }}
            disabled={isLoading}
            className="p-1.5 hover:bg-[var(--bg-hover)] rounded disabled:opacity-50 text-muted hover:text-main"
            title="Refresh"
          >
            <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
          </button>
          {!embedded && onClose ? (
            <button
              type="button"
              className="p-1.5 rounded text-muted hover:text-main hover:bg-[var(--bg-hover)]"
              title="Close"
              onClick={onClose}
            >
              <PanelLeftClose size={13} strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
      </div>

      {/* Repo list OR focused tree */}
      {!expandedRepo ? (
        <>
          {/* Filter */}
          <div className="px-3 py-1.5 border-b border-[var(--border-subtle)]/40 shrink-0">
            <div className="flex items-center gap-1.5 rounded border border-[var(--border-subtle)]/50 px-2 py-1">
              <Search size={11} className="text-muted shrink-0" />
              <input
                type="search"
                value={repoFilter}
                onChange={(e) => setRepoFilter(e.target.value)}
                placeholder="Filter repos…"
                className="w-full bg-transparent text-[11px] outline-none placeholder:text-muted"
              />
            </div>
          </div>
          {loadError && (
            <p className="px-3 py-1 text-[10px] text-[var(--solar-orange)] font-mono shrink-0">{loadError}</p>
          )}
          <div className="flex-1 overflow-y-auto min-h-0">
            {isLoading && (
              <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-muted">
                <Loader2 size={12} className="animate-spin" /> Loading repos…
              </div>
            )}
            {!isLoading && filteredRepos.length === 0 && (
              <p className="px-3 py-3 text-[10px] text-muted italic">No repositories found.</p>
            )}
            {filteredRepos.map((repo) => {
              const fn = repo.full_name as string;
              const branch = defaultBranchFor(fn);
              return (
                <button
                  key={repo.id}
                  type="button"
                  onClick={() => toggleRepo(fn)}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[var(--bg-hover)] text-left border-b border-[var(--border-subtle)]/20"
                >
                  <ChevronRight size={13} className="text-muted shrink-0" />
                  <Folder size={13} className="text-[var(--solar-blue)] shrink-0" />
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-[12px] font-medium truncate">{repo.name}</span>
                    <span className="text-[9px] text-muted font-mono truncate">{branch}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        /* Focused tree view */
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {loadError && (
            <p className="px-3 py-1 text-[10px] text-[var(--solar-orange)] font-mono shrink-0">{loadError}</p>
          )}
          {activeTree ? (
            <GithubTreeView
              root={activeTree}
              fullName={expandedRepo}
              branch={activeBranch}
              fillHeight={embedded}
              onToggleDir={(node) => handleToggleDir(expandedRepo, activeBranch, node)}
              onOpenFile={(node) => void handleOpenFile(expandedRepo, activeBranch, node)}
              onDeleteFile={(node) => void handleDeleteFile(expandedRepo, activeBranch, node)}
              onNewFile={(parentPath) => void handleNewFile(expandedRepo, activeBranch, parentPath)}
            />
          ) : (
            <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-muted">
              <Loader2 size={12} className="animate-spin" /> Loading…
            </div>
          )}
        </div>
      )}
    </div>
  );
};
