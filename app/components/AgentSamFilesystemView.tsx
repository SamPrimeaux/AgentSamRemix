import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  FilePlus,
  Folder,
  FolderPlus,
  GripVertical,
  Loader2,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import type { ActiveFile } from '../types';
import { useWorkspace } from '../src/context/WorkspaceContext';
import { ContainerExplorer } from './ContainerExplorer';
import { GitHubExplorer } from './GitHubExplorer';
import { GoogleDriveExplorer } from './GoogleDriveExplorer';
import { VirtualizedFileTree } from './VirtualizedFileTree';
import { SetiFileIcon } from '../src/components/SetiFileIcon';
import { FsSourceIcon } from '../src/components/FsSourceIcon';
import {
  AGENT_SAM_FS_SOURCES,
  buildAgentSamFsSourceContext,
  fsSourceIconId,
  IAM_FILES_SOURCE_CONTEXT_EVENT,
  IAM_FILES_SOURCE_CONTEXT_REQUEST_EVENT,
  isAgentSamFsModesEnabled,
  loadPersistedAgentSamFsSource,
  loadPersistedFsInspectionWidth,
  persistAgentSamFsSource,
  persistFsInspectionWidth,
  type AgentSamFsPaneMode,
  type AgentSamFsSource,
} from '../src/lib/agentSamFilesystemTypes';
import {
  buildFsChangeMapFromStatus,
  buildFsChangeScope,
  filterLocalRowsForChangesMode,
  fsChangeEntriesSorted,
  glyphForChangeState,
  isFsChangesGithubSource,
  lookupChangeForTreePath,
  publishFsChangeScope,
  resolveInspectionWidthBand,
  type AgentGitStatusFilesPayload,
  type FsChangeEntry,
  type FsInspectionWidthBand,
} from '../src/lib/agentSamFsChanges';
import { canUseFsMerkleSnapshot } from '../src/lib/fsMerkleCapability';
import { FsMerkleSnapshotPanel } from './FsMerkleSnapshotPanel';
import { FsRailChrome } from './files-rail/FsRailChrome';
import { FsLocalPane } from './files-rail/FsLocalPane';
import { FsR2Pane } from './files-rail/FsR2Pane';
import { useFsChangesPane } from './files-rail/useFsChangesPane';
import type { LocalFileTreeRow } from '../src/lib/localFileTree';
import type { LocalFsaController } from '../hooks/useLocalFsaFolder';
import type { R2FilesController } from '../hooks/useR2FilesPane';
import type { R2ObjectRow } from '../src/lib/r2Listing';
import { parseGithubCloneRef } from '../src/lib/githubClone';

export type AgentSamFilesystemViewProps = {
  onClose?: () => void;
  onOpenInEditor?: (file: ActiveFile) => void;
  workspace_id?: string | null;
  googleDriveOAuthRefresh?: number;

  local: LocalFsaController;
  r2: R2FilesController;
  onSourceActivated?: (source: AgentSamFsSource) => void;
  /** Workspace-linked GitHub repo — seeds GitHub tab expand when set (owner/repo). */
  pinnedGithubRepo?: string | null;
};

export const AgentSamFilesystemView: React.FC<AgentSamFilesystemViewProps> = (props) => {
  const {
    onClose,
    onOpenInEditor,
    workspace_id,
    googleDriveOAuthRefresh = 0,
    local,
    r2,
    onSourceActivated,
    pinnedGithubRepo = null,
  } = props;
  const {
    rootDir, localResumeHint, localTreeRows, onLocalTreeRowClick,
    handleOpenFolder, handleReconnectPersistedFolder, disconnectNativeFolder,
    handleCreateLocalFile, handleCreateLocalFolder, refreshLocalTree,
  } = local;
  const {
    displayR2Buckets, selectedR2Bucket, setSelectedR2Bucket, setR2PrefixByBucket,
    setR2SearchMode, r2PrefixByBucket, r2PrefixesByBucket, r2ObjectsByBucket,
    r2ListCursorByBucket, r2ListTruncatedByBucket, r2Loading, r2Err, r2SearchQ,
    r2SearchMode, setR2SearchQ, setR2Prefix, parentR2Prefix, loadR2List,
    loadMoreR2List, runR2Search, clearR2Search, openR2Key, deleteR2Key,
    createR2Folder, uploadToR2, r2AddOpen, setR2AddOpen, r2AddMode,
    setR2AddMode, r2AddName, setR2AddName, r2AddBusy, connectR2Bucket,
    createR2Bucket, r2UploadRef, setR2UploadTargetBucket,
  } = r2;

  const { featureFlags } = useWorkspace();
  const modesEnabled = isAgentSamFsModesEnabled(featureFlags);

  const [activeSource, setActiveSource] = useState<AgentSamFsSource>(
    () => loadPersistedAgentSamFsSource() ?? 'local',
  );
  const [paneMode, setPaneMode] = useState<AgentSamFsPaneMode>('files');
  const [changeMap, setChangeMap] = useState<Map<string, FsChangeEntry>>(() => new Map());
  const [gitMeta, setGitMeta] = useState<{
    branch: string | null;
    baseline: string | null;
    repo: string | null;
    status: string | null;
  }>({ branch: null, baseline: null, repo: null, status: null });
  const [changesLoading, setChangesLoading] = useState(false);
  const [changesError, setChangesError] = useState<string | null>(null);
  const [selectedChangePath, setSelectedChangePath] = useState<string | null>(null);
  const { paneRef, widthBand } = useFsChangesPane({ paneMode });
  const pinnedRepo = String(pinnedGithubRepo || '').trim() || null;
  const [cloneBusy, setCloneBusy] = useState(false);
  const [cloneToast, setCloneToast] = useState<string | null>(null);
  /** Open/expanded repo in GitHubExplorer — null while browsing the OAuth repo list. */
  const [githubOpenRepo, setGithubOpenRepo] = useState<string | null>(null);
  const githubOpenRepoRef = useRef<string | null>(null);
  githubOpenRepoRef.current = githubOpenRepo;
  /**
   * One-shot expand seed for GitHubExplorer. Cleared after consume.
   * Never pass a sticky pin as expandRepoFullName — that traps Back in focused tree.
   */
  const [githubExpandSeed, setGithubExpandSeed] = useState<string | null>(null);
  /** User hit Back (or collapsed) — show connected-repo list; do not re-force pin expand. */
  const [githubBrowsingRepoList, setGithubBrowsingRepoList] = useState(false);
  const [refreshedAtMs, setRefreshedAtMs] = useState<number | null>(null);
  const [headerRefreshBusy, setHeaderRefreshBusy] = useState(false);

  const effectiveGithubRepo = useMemo(() => {
    const open = githubOpenRepo?.trim() || null;
    if (open) return open;
    // Pin is fallback for Changes/Merkle only — not for forcing the explorer tree open.
    return pinnedRepo;
  }, [githubOpenRepo, pinnedRepo]);

  const showSnapshotTab =
    modesEnabled &&
    canUseFsMerkleSnapshot({
      source: activeSource,
      repository: effectiveGithubRepo,
      hasLocalDirectoryHandle: Boolean(rootDir?.handle),
    });

  // Entering GitHub tab: seed expand once from open/pin unless user is browsing the list.
  // Ref guards against re-seeding after onExpandRepoConsumed clears the seed (would fight Back).
  const githubExpandSeededRef = useRef(false);
  useEffect(() => {
    if (activeSource !== 'github') {
      githubExpandSeededRef.current = false;
      return;
    }
    if (githubBrowsingRepoList) {
      githubExpandSeededRef.current = false;
      return;
    }
    if (githubExpandSeededRef.current) return;
    if (githubExpandSeed?.trim()) {
      githubExpandSeededRef.current = true;
      return;
    }
    const seed = githubOpenRepo?.trim() || pinnedRepo;
    if (!seed) return;
    githubExpandSeededRef.current = true;
    if (!githubOpenRepo?.trim()) setGithubOpenRepo(seed);
    setGithubExpandSeed(seed);
  }, [activeSource, githubBrowsingRepoList, githubExpandSeed, githubOpenRepo, pinnedRepo]);

  const headerTitle = useMemo(() => {
    if (activeSource === 'local') return 'Local';
    if (activeSource === 'github') {
      if (githubBrowsingRepoList) return 'GitHub repos';
      return githubOpenRepo?.trim() || pinnedRepo || 'GitHub';
    }
    if (activeSource === 'r2') return selectedR2Bucket?.trim() || 'R2';
    if (activeSource === 'drive') return 'Drive';
    if (activeSource === 'container') return 'Sandbox';
    return 'Files';
  }, [
    activeSource,
    githubBrowsingRepoList,
    githubOpenRepo,
    pinnedRepo,
    selectedR2Bucket,
  ]);

  const refreshedAtLabel = useMemo(() => {
    if (refreshedAtMs == null) return null;
    try {
      return new Date(refreshedAtMs).toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return null;
    }
  }, [refreshedAtMs]);

  const runCloneIntoWorkspace = useCallback(async () => {
    const raw = window.prompt('Clone into workspace — GitHub owner/repo (or URL):');
    if (!raw || cloneBusy) return;
    const ref = parseGithubCloneRef(raw);
    if (!ref) {
      setCloneToast('Invalid GitHub ref');
      return;
    }
    setCloneBusy(true);
    setCloneToast(null);
    try {
      const res = await fetch('/api/agent/git/clone', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          ...(workspace_id?.trim() ? { 'X-IAM-Workspace-Id': workspace_id.trim() } : {}),
        },
        body: JSON.stringify({ repo: ref, workspace_id: workspace_id?.trim() || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        repo_path?: string;
        workspace_root?: string;
        github_repo?: string;
        body?: { user_message?: string };
      };
      if (!res.ok || !data.ok) {
        setCloneToast(
          data.body?.user_message ||
            data.error ||
            `Clone failed (${res.status})`,
        );
        return;
      }
      if (!data.workspace_root && !data.repo_path) {
        setCloneToast('Clone returned without workspace_root — refusing silent success');
        return;
      }
      setCloneToast(`Cloned ${data.github_repo || ref} → ${data.workspace_root || data.repo_path}`);
      window.dispatchEvent(
        new CustomEvent('iam_workspace_github_repo', {
          detail: {
            workspaceId: workspace_id?.trim() || null,
            github_repo: data.github_repo || ref,
            workspace_root: data.workspace_root || data.repo_path,
          },
        }),
      );
    } catch (e) {
      setCloneToast(e instanceof Error ? e.message : 'Clone failed');
    } finally {
      setCloneBusy(false);
    }
  }, [cloneBusy, workspace_id]);

  const selectSource = useCallback(
    (source: AgentSamFsSource) => {
      setActiveSource(source);
      persistAgentSamFsSource(source);
      onSourceActivated?.(source);
    },
    [onSourceActivated],
  );

  useEffect(() => {
    onSourceActivated?.(activeSource);
  }, [activeSource, onSourceActivated]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onRepo = (ev: Event) => {
      const detail = (ev as CustomEvent<{ active_repo?: string | null }>).detail;
      const repo = detail?.active_repo != null ? String(detail.active_repo).trim() : '';
      if (repo) {
        setGithubOpenRepo(repo);
        setGithubBrowsingRepoList(false);
        return;
      }
      // Only enter list mode when collapsing a previously open repo (Back).
      // Ignore spurious nulls from mount / workspace reset before any expand.
      const hadOpen = Boolean(githubOpenRepoRef.current?.trim());
      setGithubOpenRepo(null);
      if (hadOpen) {
        setGithubBrowsingRepoList(true);
        setGithubExpandSeed(null);
      }
    };
    window.addEventListener('iam_explorer_active_repo', onRepo);
    try {
      window.dispatchEvent(new CustomEvent('iam_explorer_request_active_repo'));
    } catch {
      /* ignore */
    }
  return () => window.removeEventListener('iam_explorer_active_repo', onRepo);
  }, []);

  const filesSourceContext = useMemo(
    () =>
      buildAgentSamFsSourceContext({
        source: activeSource,
        localFolder: rootDir?.name ?? null,
        hasLocalHandle: Boolean(rootDir?.handle),
        // Honest bind: only the repo currently open in the explorer — not ambient D1 pin.
        githubRepo:
          activeSource === 'github' ? githubOpenRepo?.trim() || null : null,
        r2Bucket: selectedR2Bucket || null,
        r2Prefix: selectedR2Bucket ? r2PrefixByBucket[selectedR2Bucket] ?? '' : null,
      }),
    [
      activeSource,
      rootDir?.name,
      rootDir?.handle,
      githubOpenRepo,
      selectedR2Bucket,
      r2PrefixByBucket,
    ],
  );

  // Publish real source bind — chat/greeting consume this; do not invent from D1 github_repo.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const publishFilesSourceContext = () => {
      window.dispatchEvent(
        new CustomEvent(IAM_FILES_SOURCE_CONTEXT_EVENT, { detail: filesSourceContext }),
      );
      // Compat for older listeners (source only).
      window.dispatchEvent(
        new CustomEvent('iam_explorer_active_source', {
          detail: {
            source: filesSourceContext.source,
            local_folder: filesSourceContext.local_folder,
            has_local_handle: filesSourceContext.has_local_handle,
            source_path: filesSourceContext.source_path,
            label: filesSourceContext.label,
            github_repo: filesSourceContext.github_repo,
          },
        }),
      );
    };
    const publishSafely = () => {
      try {
        publishFilesSourceContext();
      } catch {
        /* ignore */
      }
    };
    publishSafely();
    window.addEventListener(IAM_FILES_SOURCE_CONTEXT_REQUEST_EVENT, publishSafely);
    return () => {
      window.removeEventListener(IAM_FILES_SOURCE_CONTEXT_REQUEST_EVENT, publishSafely);
    };
  }, [filesSourceContext]);

  useEffect(() => {
    if (!modesEnabled) setPaneMode('files');
  }, [modesEnabled]);

  const fetchChanges = useCallback(async () => {
    setChangesLoading(true);
    setChangesError(null);
    try {
      // Slice 1: Changes = GitHub compare only. Local / R2 / Drive / Container stay honest-empty.
      if (!isFsChangesGithubSource(activeSource)) {
        setChangeMap(new Map());
        setGitMeta({
          branch: null,
          baseline: null,
          repo: null,
          status: activeSource === 'local' ? 'local_unavailable' : 'not_git_source',
        });
        return;
      }
      const ws = workspace_id?.trim();
      const qs = new URLSearchParams();
      if (ws) qs.set('workspace_id', ws);
      const repo = effectiveGithubRepo;
      if (repo && repo.includes('/')) qs.set('repo', repo);
      qs.set('include_files', '1');
      const url = `/api/agent/git/status?${qs.toString()}`;
      const res = await fetch(url, { credentials: 'same-origin' });
      const json = (await res.json().catch(() => ({}))) as AgentGitStatusFilesPayload & {
        error?: string;
        default_branch?: string | null;
      };
      if (!res.ok) throw new Error(json.error || 'Failed to fetch git status');
      const map = buildFsChangeMapFromStatus(json);
      setChangeMap(map);
      const defaultBranch =
        json.default_branch != null ? String(json.default_branch).trim() : '';
      if (!defaultBranch) {
        throw new Error('github_default_branch_unresolved');
      }
      setGitMeta({
        branch: json.branch ?? null,
        baseline: `origin/${defaultBranch}`,
        repo: json.repo_full_name ?? repo ?? null,
        status: json.status ?? null,
      });
    } catch (err: unknown) {
      setChangesError(err instanceof Error ? err.message : 'Failed to fetch changes');
      setChangeMap(new Map());
    } finally {
      setChangesLoading(false);
    }
  }, [workspace_id, effectiveGithubRepo, activeSource]);

  const runHeaderRefresh = useCallback(async () => {
    if (headerRefreshBusy) return;
    setHeaderRefreshBusy(true);
    try {
      if (modesEnabled && paneMode === 'changes') {
        await fetchChanges();
      } else if (activeSource === 'local' && refreshLocalTree) {
        await refreshLocalTree();
      } else if (activeSource === 'r2' && selectedR2Bucket) {
        await Promise.resolve(loadR2List(selectedR2Bucket));
      }
      setRefreshedAtMs(Date.now());
    } finally {
      setHeaderRefreshBusy(false);
    }
  }, [
    headerRefreshBusy,
    modesEnabled,
    paneMode,
    fetchChanges,
    activeSource,
    refreshLocalTree,
    selectedR2Bucket,
    loadR2List,
  ]);

  useEffect(() => {
    if (!modesEnabled || paneMode !== 'changes') return;
    void fetchChanges();
    const timer = window.setInterval(() => void fetchChanges(), 30000);
    return () => window.clearInterval(timer);
  }, [modesEnabled, paneMode, fetchChanges]);

  const changeEntries = useMemo(() => fsChangeEntriesSorted(changeMap), [changeMap]);
  const selectedEntry = useMemo(() => {
    if (!selectedChangePath) return null;
    return changeMap.get(selectedChangePath) || null;
  }, [changeMap, selectedChangePath]);

  const filteredLocalRows = useMemo(() => {
    if (paneMode !== 'changes') return localTreeRows;
    return filterLocalRowsForChangesMode(localTreeRows, changeMap, rootDir?.name ?? null);
  }, [paneMode, localTreeRows, changeMap, rootDir?.name]);

  const resolveTreeChange = useCallback(
    (treePath: string) => lookupChangeForTreePath(changeMap, treePath, rootDir?.name ?? null),
    [changeMap, rootDir?.name],
  );

  const selectChangedPath = useCallback(
    (entry: FsChangeEntry) => {
      setSelectedChangePath(entry.path);
      if (!gitMeta.baseline) {
        setChangesError('github_default_branch_unresolved');
        return;
      }
      publishFsChangeScope(
        buildFsChangeScope({
          path: entry.path,
          state: entry.state,
          baseline: gitMeta.baseline,
          currentRoot: entry.hashShort || '',
          previousRoot: '',
          changedPaths: changeEntries.map((e) => e.path),
        }),
      );
    },
    [changeEntries, gitMeta.baseline],
  );

  const breadcrumb = useMemo(() => {
    if (modesEnabled && paneMode === 'changes') {
      const branch = gitMeta.branch || 'HEAD';
      return `${changeEntries.length} change${changeEntries.length === 1 ? '' : 's'} · ${branch}`;
    }
    if (modesEnabled && paneMode === 'snapshot') {
      return 'Snapshot (Merkle)';
    }
    if (activeSource === 'local') {
      return rootDir?.name ?? 'Local workspace';
    }
    if (activeSource === 'r2' && selectedR2Bucket) {
      const prefix = r2PrefixByBucket[selectedR2Bucket] ?? '';
      return prefix ? `${selectedR2Bucket} / ${prefix}` : selectedR2Bucket;
    }
    if (activeSource === 'github') {
      return effectiveGithubRepo || 'GitHub — link a repo on this workspace or pick one below';
    }
    if (activeSource === 'drive') return 'Google Drive';
    if (activeSource === 'container') return 'Sandbox workspace';
    return 'Files';
  }, [
    modesEnabled,
    paneMode,
    gitMeta.branch,
    changeEntries.length,
    activeSource,
    rootDir,
    selectedR2Bucket,
    r2PrefixByBucket,
    effectiveGithubRepo,
  ]);

  const r2Bucket = selectedR2Bucket;
  const r2Prefix = r2Bucket ? (r2PrefixByBucket[r2Bucket] ?? '') : '';
  const r2Prefs = r2Bucket ? (r2PrefixesByBucket[r2Bucket] || []) : [];
  const r2Objs = r2Bucket ? (r2ObjectsByBucket[r2Bucket] || []) : [];
  const r2SearchOn = r2Bucket ? !!r2SearchMode[r2Bucket] : false;

  const shortR2Name = (full: string) =>
    r2Prefix && full.startsWith(r2Prefix) ? full.slice(r2Prefix.length) : full;

  const changeStateColor = (state: FsChangeEntry['state']) => {
    if (state === 'added') return 'text-[var(--solar-green)]';
    if (state === 'deleted') return 'text-[var(--solar-red,#f85149)]';
    if (state === 'renamed') return 'text-[var(--solar-cyan)]';
    if (state === 'modified') return 'text-[#dab98f]';
    return 'text-muted';
  };

    return (
    <div
      ref={paneRef}
      className="flex flex-col h-full min-h-0 bg-[var(--dashboard-sidebar)] overflow-hidden text-main"
      data-fs-modes={modesEnabled ? 'on' : 'off'}
      data-fs-pane-mode={modesEnabled ? paneMode : 'files'}
    >
      <FsRailChrome
        onClose={onClose}
        headerTitle={headerTitle}
        runHeaderRefresh={runHeaderRefresh}
        headerRefreshBusy={headerRefreshBusy}
        refreshedAtLabel={refreshedAtLabel}
        modesEnabled={modesEnabled}
        paneMode={paneMode}
        setPaneMode={setPaneMode}
        showSnapshotTab={showSnapshotTab}
        activeSource={activeSource}
        selectSource={selectSource}
      />
      <div className="shrink-0 px-3 py-1.5 border-b border-[var(--border-subtle)]/20 flex items-center gap-2 min-h-[32px]">
        <span className="text-[10px] text-muted truncate flex-1 font-mono" title={breadcrumb}>
          {breadcrumb}
        </span>
        {modesEnabled && paneMode === 'changes' ? (
          <button
            type="button"
            title="Refresh changes"
            className="p-1 rounded hover:bg-[var(--bg-hover)] text-muted shrink-0"
            onClick={() => void fetchChanges()}
          >
            <RefreshCw size={12} className={changesLoading ? 'animate-spin' : ''} />
          </button>
        ) : null}
        {(!modesEnabled || paneMode === 'files') && activeSource === 'local' && rootDir ? (
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              title="New file"
              className="p-1 rounded hover:bg-[var(--bg-hover)] text-muted hover:text-main"
              onClick={() => void handleCreateLocalFile()}
            >
              <FilePlus size={12} />
            </button>
            <button
              type="button"
              title="New folder"
              className="p-1 rounded hover:bg-[var(--bg-hover)] text-muted hover:text-main"
              onClick={() => void handleCreateLocalFolder()}
            >
              <FolderPlus size={12} />
            </button>
            <button
              type="button"
              title="Disconnect folder"
              className="p-1 rounded hover:bg-[var(--bg-hover)] text-muted hover:text-[var(--solar-orange)] text-[10px] px-1"
              onClick={() => void disconnectNativeFolder()}
            >
              Disconnect
            </button>
          </div>
        ) : null}
        {(!modesEnabled || paneMode === 'files') && activeSource === 'r2' && r2Bucket ? (
          <div className="flex items-center gap-0.5 shrink-0">
            {r2Prefix ? (
              <button
                type="button"
                className="text-[10px] text-[var(--solar-cyan)] hover:underline px-1"
                onClick={() => setR2Prefix(r2Bucket, parentR2Prefix(r2Prefix))}
              >
                Up
              </button>
            ) : null}
            <button
              type="button"
              title="Refresh"
              className="p-1 rounded hover:bg-[var(--bg-hover)] text-muted"
              onClick={() => void loadR2List(r2Bucket)}
            >
              <RefreshCw size={12} className={r2Loading ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              title="Upload"
              className="p-1 rounded hover:bg-[var(--bg-hover)] text-muted"
              onClick={() => {
                setR2UploadTargetBucket(r2Bucket);
                r2UploadRef.current?.click();
              }}
            >
              <Upload size={12} />
            </button>
            <button
              type="button"
              title="New folder"
              className="p-1 rounded hover:bg-[var(--bg-hover)] text-muted"
              onClick={() => void createR2Folder(r2Bucket)}
            >
              <FolderPlus size={12} />
            </button>
            <button
              type="button"
              title="Add bucket"
              className="p-1 rounded hover:bg-[var(--bg-hover)] text-muted"
              onClick={() => {
                setR2AddOpen((v) => !v);
                setR2AddMode(null);
                setR2AddName('');
              }}
            >
              <Plus size={12} />
            </button>
          </div>
        ) : null}
      </div>

      <input
        ref={r2UploadRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (r2Bucket) void uploadToR2(r2Bucket, e.target.files);
        }}
      />

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {modesEnabled && paneMode === 'changes' ? (
          <div className="flex-1 min-h-0 flex flex-col font-mono" data-testid="agent-sam-fs-changes">
            {changesError ? (
              <p className="px-3 py-2 text-[10px] text-[var(--solar-orange)]">{changesError}</p>
            ) : null}
            {changesLoading && changeEntries.length === 0 ? (
              <div className="flex items-center gap-1.5 px-3 py-3 text-[10px] text-muted">
                <Loader2 size={12} className="animate-spin" /> Loading changes…
              </div>
            ) : null}
            {!changesLoading && changeEntries.length === 0 && !changesError ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4 py-6 text-center">
                <p className="text-[11px] text-muted">
                  {gitMeta.status === 'local_unavailable'
                    ? 'Local git status not available yet.'
                    : gitMeta.status === 'not_git_source'
                      ? 'Not a Git Changes source — switch to GitHub or React, then open Changes.'
                      : gitMeta.status === 'no_repo' || gitMeta.status === 'no_workspace'
                        ? 'No repo/workspace — link GitHub or open a workspace to see changes.'
                        : 'No dirty paths in status (clean or file list unavailable).'}
                </p>
                <p className="text-[9px] text-muted/70 max-w-[220px]">
                  {gitMeta.status === 'local_unavailable'
                    ? 'ExecOS git status lands in a later slice. Changes today are GitHub compare only.'
                    : 'Changes overlays GitHub compare. Unchanged paths stay collapsed.'}
                </p>
              </div>
            ) : null}

            {changeEntries.length > 0 ? (
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-1 py-1">
                {changeEntries.map((entry) => {
                  const selected = selectedChangePath === entry.path;
                  const name = entry.path.split('/').pop() || entry.path;
                  const dir = entry.path.includes('/')
                    ? entry.path.slice(0, entry.path.lastIndexOf('/'))
                    : '';
                  return (
                    <button
                      key={entry.path}
                      type="button"
                      data-change-state={entry.state}
                      onClick={() => selectChangedPath(entry)}
                      className={`flex w-full items-center gap-1.5 px-2 py-1 rounded text-left text-[12px] border-none bg-transparent font-inherit cursor-pointer ${
                        selected ? 'bg-[var(--bg-hover)]' : 'hover:bg-[var(--bg-hover)]'
                      }`}
                    >
                      <span
                        className={`w-3 shrink-0 text-center text-[11px] font-bold ${changeStateColor(entry.state)}`}
                        aria-label={entry.state}
                      >
                        {glyphForChangeState(entry.state)}
                      </span>
                      <SetiFileIcon filename={name} size={13} />
                      <span className="truncate min-w-0 flex-1 text-main" title={entry.path}>
                        {name}
                      </span>
                      {widthBand !== 'narrow' && entry.hashShort ? (
                        <span className="shrink-0 text-[9px] text-muted/80 tabular-nums">
                          {entry.hashShort}
                        </span>
                      ) : null}
                      {widthBand === 'wide' ? (
                        <span className={`shrink-0 text-[9px] uppercase ${changeStateColor(entry.state)}`}>
                          {entry.state}
                        </span>
                      ) : widthBand === 'medium' && dir ? (
                        <span className="shrink-0 max-w-[40%] truncate text-[9px] text-muted opacity-60">
                          {dir}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {rootDir && filteredLocalRows.length > 0 ? (
              <div className="shrink-0 max-h-[40%] min-h-0 border-t border-[var(--border-subtle)]/30 flex flex-col">
                <p className="px-2 py-1 text-[9px] uppercase tracking-wide text-muted">
                  Tree overlay (dirty only)
                </p>
                <VirtualizedFileTree
                  rows={filteredLocalRows}
                  fillHeight
                  ariaLabel="Changed local files"
                  onRowClick={(row) => {
                    if (row.type !== 'entry') return;
                    const ch = resolveTreeChange(row.id);
                    if (ch) selectChangedPath(ch);
                    void onLocalTreeRowClick(row);
                  }}
                  resolveChange={resolveTreeChange}
                  widthBand={widthBand}
                  selectedPath={
                    selectedChangePath && rootDir?.name
                      ? `${rootDir.name}/${selectedChangePath}`
                      : selectedChangePath
                  }
                  dimUnchanged
                />
              </div>
            ) : null}

            {selectedEntry ? (
              <div
                className="shrink-0 border-t border-[var(--dashboard-border)]/60 px-3 py-2 bg-transparent"
                data-testid="agent-sam-fs-change-detail"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-[12px] font-bold ${changeStateColor(selectedEntry.state)}`}>
                    {glyphForChangeState(selectedEntry.state)}
                  </span>
                  <span className="text-[11px] text-main truncate font-mono" title={selectedEntry.path}>
                    {selectedEntry.path}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-muted">
                  <span className="uppercase tracking-wide">{selectedEntry.state}</span>
                  {gitMeta.baseline ? <span>baseline {gitMeta.baseline}</span> : null}
                  {selectedEntry.hashShort ? <span>hash {selectedEntry.hashShort}</span> : null}
                  {selectedEntry.previousPath ? <span>was {selectedEntry.previousPath}</span> : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {modesEnabled && paneMode === 'snapshot' && showSnapshotTab ? (
          <FsMerkleSnapshotPanel
            workspaceId={workspace_id}
            source={activeSource}
            repository={effectiveGithubRepo || gitMeta.repo}
            localDirectoryHandle={
              rootDir?.handle && rootDir.handle.kind === 'directory'
                ? (rootDir.handle as FileSystemDirectoryHandle)
                : null
            }
          />
        ) : null}

        {(!modesEnabled || paneMode === 'files') && activeSource === 'local' ? (
          <FsLocalPane
            rootDir={rootDir}
            localResumeHint={localResumeHint}
            localTreeRows={localTreeRows}
            onLocalTreeRowClick={onLocalTreeRowClick}
            handleOpenFolder={handleOpenFolder}
            handleReconnectPersistedFolder={handleReconnectPersistedFolder}
            handleCloneIntoWorkspace={runCloneIntoWorkspace}
            cloneBusy={cloneBusy}
            cloneToast={cloneToast}
          />
        ) : null}

        {(!modesEnabled || paneMode === 'files') && activeSource === 'r2' ? (
          <FsR2Pane r2={r2} onOpenInEditor={onOpenInEditor} />
        ) : null}

        {(!modesEnabled || paneMode === 'files') && activeSource === 'github' ? (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {!pinnedRepo && !githubOpenRepo ? (
              <p className="text-[10px] text-muted px-2 py-1.5 border-b border-[var(--border-color)] shrink-0">
                No workspace GitHub pin — browse a repo below, or link one in Settings → Workspace. Save will
                not invent a repo.
              </p>
            ) : null}
            <GitHubExplorer
              embedded
              workspace_id={workspace_id}
              expandRepoFullName={
                githubBrowsingRepoList ? undefined : githubExpandSeed || undefined
              }
              onExpandRepoConsumed={() => setGithubExpandSeed(null)}
              onOpenInEditor={onOpenInEditor}
            />
          </div>
        ) : null}

        {(!modesEnabled || paneMode === 'files') && activeSource === 'container' ? (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <ContainerExplorer embedded />
          </div>
        ) : null}

        {(!modesEnabled || paneMode === 'files') && activeSource === 'drive' ? (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <GoogleDriveExplorer
              key={googleDriveOAuthRefresh}
              embedded
              onOpenInEditor={onOpenInEditor}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default AgentSamFilesystemView;
