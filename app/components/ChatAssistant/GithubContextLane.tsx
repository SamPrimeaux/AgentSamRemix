import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, FileText, Folder, FolderGit2, Loader2 } from 'lucide-react';
import { readGhReposCache, writeGhReposCache, type GhRepoRow } from './repoPickerCache';
import { fetchGithubFileContent } from '../../types/contextEnvelope';
import {
  oauthConnectReturnTo,
  openIntegrationOAuthPopup,
} from '../../src/lib/integrationOAuthPopup';

type GhContentRow = {
  name: string;
  path: string;
  type: 'file' | 'dir';
  sha?: string;
};

export type GithubContextLaneProps = {
  workspaceId: string | null | undefined;
  githubRepoContext: string | null;
  onSelectRepo: (fullName: string) => void;
  onSelectFile?: (
    repo: string,
    path: string,
    branch: string,
    meta?: { content?: string | null; contentSha?: string | null; contentTruncated?: boolean },
  ) => void;
  onBrowseFiles?: (fullName: string) => void;
  onClose?: () => void;
  /** Hub stack: return to hub root (not close drawer). */
  onBackToHub?: () => void;
  onOAuthConnected?: () => void;
  embedded?: boolean;
};

export function GithubContextLane({
  workspaceId,
  githubRepoContext,
  onSelectRepo,
  onSelectFile,
  onBrowseFiles,
  onClose,
  onBackToHub,
  onOAuthConnected,
  embedded = false,
}: GithubContextLaneProps) {
  const [ghRepos, setGhRepos] = useState<GhRepoRow[]>([]);
  const [ghReposLoading, setGhReposLoading] = useState(false);
  const [ghReposAuthed, setGhReposAuthed] = useState(true);
  const [githubConnectBusy, setGithubConnectBusy] = useState(false);
  const [repoSearch, setRepoSearch] = useState('');
  const [view, setView] = useState<'repos' | 'files'>('repos');
  const [browseRepo, setBrowseRepo] = useState<string | null>(null);
  const [browseBranch, setBrowseBranch] = useState('main');
  const [browsePath, setBrowsePath] = useState('');
  const [entries, setEntries] = useState<GhContentRow[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [fileHydrating, setFileHydrating] = useState(false);

  const loadGhRepos = useCallback(async () => {
    const cached = readGhReposCache();
    if (cached?.length) setGhRepos(cached);

    setGhReposLoading(true);
    try {
      const hdr: Record<string, string> = {};
      if (workspaceId?.trim()) hdr['X-IAM-Workspace-Id'] = workspaceId.trim();
      const res = await fetch('/api/integrations/github/repos', {
        credentials: 'same-origin',
        headers: hdr,
      });
      if (!res.ok) {
        setGhReposAuthed(false);
        if (!cached?.length) setGhRepos([]);
        return;
      }
      setGhReposAuthed(true);
      const data = await res.json();
      const list = Array.isArray(data) ? data : data.repos || [];
      const rows = (Array.isArray(list) ? list : []) as GhRepoRow[];
      setGhRepos(rows);
      if (rows.length) writeGhReposCache(rows);
    } catch {
      setGhReposAuthed(false);
      if (!cached?.length) setGhRepos([]);
    } finally {
      setGhReposLoading(false);
    }
  }, [workspaceId]);

  const loadDirectory = useCallback(
    async (repoFull: string, branch: string, path: string) => {
      const [owner, repo] = repoFull.split('/');
      if (!owner || !repo) {
        setEntriesError('Invalid repository');
        return;
      }
      setEntriesLoading(true);
      setEntriesError(null);
      try {
        const qs = new URLSearchParams();
        if (path.trim()) qs.set('path', path.trim());
        if (branch.trim()) qs.set('ref', branch.trim());
        const res = await fetch(
          `/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents?${qs}`,
          { credentials: 'same-origin' },
        );
        const data = await res.json();
        if (!res.ok) {
          setEntries([]);
          setEntriesError(typeof data?.message === 'string' ? data.message : 'Could not load files');
          return;
        }
        if (Array.isArray(data)) {
          setEntries(
            data.map((row: GhContentRow) => ({
              name: String(row.name || ''),
              path: String(row.path || ''),
              type: row.type === 'dir' ? 'dir' : 'file',
              sha: row.sha,
            })),
          );
          return;
        }
        if (data?.type === 'file') {
          onSelectRepo(repoFull);
          const hydration = await fetchGithubFileContent(repoFull, String(data.path || path), branch);
          onSelectFile?.(repoFull, String(data.path || path), branch, {
            content: hydration?.content ?? null,
            contentSha: hydration?.sha ?? null,
            contentTruncated: hydration?.truncated ?? false,
          });
          onClose?.();
          return;
        }
        setEntries([]);
        setEntriesError('Unexpected GitHub response');
      } catch {
        setEntries([]);
        setEntriesError('Network error loading files');
      } finally {
        setEntriesLoading(false);
      }
    },
    [onClose, onSelectFile, onSelectRepo],
  );

  useEffect(() => {
    void loadGhRepos();
  }, [loadGhRepos]);

  useEffect(() => {
    if (view !== 'files' || !browseRepo) return;
    void loadDirectory(browseRepo, browseBranch, browsePath);
  }, [view, browseRepo, browseBranch, browsePath, loadDirectory]);

  const openFilesForRepo = (full: string, branch?: string) => {
    const row = ghRepos.find((r) => String(r.full_name) === full);
    setBrowseRepo(full);
    setBrowseBranch(branch || row?.default_branch || 'main');
    setBrowsePath('');
    setView('files');
  };

  const filteredGhRepos = ghRepos.filter((r) => {
    const q = repoSearch.trim().toLowerCase();
    if (!q) return true;
    return String(r.full_name || r.name || '')
      .toLowerCase()
      .includes(q);
  });

  const showLoadingOverlay = ghReposLoading && ghRepos.length === 0 && view === 'repos';
  const pathSegments = browsePath ? browsePath.split('/').filter(Boolean) : [];

  const oauthReturnTo = encodeURIComponent(oauthConnectReturnTo());

  const connectGithub = () => {
    setGithubConnectBusy(true);
    void openIntegrationOAuthPopup(
      `/api/oauth/github/start?return_to=${oauthReturnTo}`,
      'github',
    )
      .then(async (result) => {
        if (result.ok) {
          onOAuthConnected?.();
          await loadGhRepos();
        }
      })
      .finally(() => setGithubConnectBusy(false));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-[var(--dashboard-border)] px-4 py-3">
        <div className="flex items-center gap-2">
          {view === 'files' ? (
            <button
              type="button"
              aria-label="Back to repositories"
              onClick={() => {
                setView('repos');
                setBrowseRepo(null);
                setBrowsePath('');
              }}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--dashboard-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--dashboard-text)]"
            >
              <ChevronLeft size={18} />
            </button>
          ) : embedded && onBackToHub ? (
            <button
              type="button"
              aria-label="Back to context hub"
              onClick={() => {
                setView('repos');
                setBrowseRepo(null);
                setBrowsePath('');
                onBackToHub();
              }}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--dashboard-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--dashboard-text)]"
            >
              <ChevronLeft size={18} />
            </button>
          ) : null}
          <div className="min-w-0 flex-1">
            <h3 className="text-[14px] font-semibold text-[var(--dashboard-text)] truncate">
              {view === 'files' ? browseRepo || 'Files' : 'GitHub'}
            </h3>
            {view === 'files' ? (
              <p className="text-[11px] text-[var(--dashboard-muted)] truncate">
                {browseBranch}
                {browsePath ? ` · ${browsePath}` : ' · root'}
              </p>
            ) : (
              <p className="text-[11px] text-[var(--dashboard-muted)]">Repos and files for this chat</p>
            )}
          </div>
        </div>
        {view === 'repos' ? (
          <input
            type="search"
            value={repoSearch}
            onChange={(e) => setRepoSearch(e.target.value)}
            placeholder="Search repositories"
            className="mt-2 w-full rounded-lg border border-[var(--dashboard-border)] bg-[var(--scene-bg)] py-2 px-3 text-[13px] text-[var(--dashboard-text)] placeholder:text-[var(--text-placeholder-strong)] outline-none focus:border-[var(--solar-cyan)]"
          />
        ) : null}
      </div>

      <div className="relative min-h-0 flex-1 overflow-y-auto chat-hide-scroll p-2">
        {view === 'repos' ? (
          <>
            {showLoadingOverlay ? (
              <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-3 bg-[var(--dashboard-panel)]/85">
                <Loader2 className="animate-spin text-[var(--dashboard-muted)]" size={22} aria-hidden />
                <p className="text-[11px] text-[var(--dashboard-muted)]">Loading repositories…</p>
              </div>
            ) : null}
            {!ghReposAuthed && !ghReposLoading ? (
              <div className="space-y-3 px-2 py-6 text-center">
                <p className="text-[12px] text-[var(--dashboard-muted)]">Connect GitHub to list your repositories.</p>
                <button
                  type="button"
                  disabled={githubConnectBusy}
                  onClick={connectGithub}
                  className="rounded-lg border border-[var(--dashboard-border)] bg-[var(--scene-bg)] px-4 py-2 text-[12px] font-medium text-[var(--dashboard-text)] disabled:opacity-60"
                >
                  {githubConnectBusy ? 'Connecting…' : 'Connect GitHub'}
                </button>
              </div>
            ) : filteredGhRepos.length === 0 && !ghReposLoading ? (
              <p className="px-3 py-6 text-center text-[12px] text-[var(--dashboard-muted)]">No repositories match.</p>
            ) : (
              filteredGhRepos.map((repo) => {
                const full = String(repo.full_name || '');
                const selected = githubRepoContext === full;
                return (
                  <div key={String(repo.id)} className="mb-1 flex gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        onSelectRepo(full);
                        onClose?.();
                      }}
                      className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-[var(--bg-hover)] ${
                        selected ? 'bg-[var(--scene-bg)] ring-1 ring-[var(--solar-cyan)]/40' : ''
                      }`}
                    >
                      <FolderGit2 size={14} className="shrink-0 text-[var(--solar-cyan)] opacity-80" />
                      <span className="truncate font-medium text-[var(--dashboard-text)]">{full}</span>
                      {repo.default_branch ? (
                        <span className="shrink-0 text-[10px] text-[var(--dashboard-muted)]">{repo.default_branch}</span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      title="Browse files"
                      onClick={() => openFilesForRepo(full, repo.default_branch)}
                      className="shrink-0 rounded-lg border border-[var(--dashboard-border)] px-2.5 py-2 text-[11px] font-medium text-[var(--solar-cyan)] hover:bg-[var(--bg-hover)]"
                    >
                      Files
                    </button>
                  </div>
                );
              })
            )}
          </>
        ) : (
          <>
            {browsePath ? (
              <div className="mb-2 flex flex-wrap items-center gap-1 px-1 text-[11px]">
                <button
                  type="button"
                  className="text-[var(--solar-cyan)] hover:underline"
                  onClick={() => setBrowsePath('')}
                >
                  root
                </button>
                {pathSegments.map((seg, i) => {
                  const partial = pathSegments.slice(0, i + 1).join('/');
                  return (
                    <span key={partial} className="flex items-center gap-1 text-[var(--dashboard-muted)]">
                      <span>/</span>
                      <button
                        type="button"
                        className="text-[var(--solar-cyan)] hover:underline"
                        onClick={() => setBrowsePath(partial)}
                      >
                        {seg}
                      </button>
                    </span>
                  );
                })}
              </div>
            ) : null}
            {entriesLoading ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10">
                <Loader2 className="animate-spin text-[var(--dashboard-muted)]" size={20} />
                <p className="text-[11px] text-[var(--dashboard-muted)]">Loading files…</p>
              </div>
            ) : entriesError ? (
              <p className="px-3 py-6 text-center text-[12px] text-[var(--dashboard-muted)]">{entriesError}</p>
            ) : entries.length === 0 ? (
              <p className="px-3 py-6 text-center text-[12px] text-[var(--dashboard-muted)]">Empty folder</p>
            ) : (
              entries.map((entry) => {
                const isDir = entry.type === 'dir';
                return (
                  <button
                    key={entry.path || entry.name}
                    type="button"
                    disabled={fileHydrating}
                    onClick={() => {
                      if (isDir) {
                        setBrowsePath(entry.path);
                        return;
                      }
                      if (!browseRepo) return;
                      void (async () => {
                        setFileHydrating(true);
                        try {
                          const hydration = await fetchGithubFileContent(
                            browseRepo,
                            entry.path,
                            browseBranch,
                          );
                          onSelectRepo(browseRepo);
                          onSelectFile?.(browseRepo, entry.path, browseBranch, {
                            content: hydration?.content ?? null,
                            contentSha: hydration?.sha ?? null,
                            contentTruncated: hydration?.truncated ?? false,
                          });
                          onClose?.();
                        } finally {
                          setFileHydrating(false);
                        }
                      })();
                    }}
                    className="mb-0.5 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[13px] hover:bg-[var(--bg-hover)]"
                  >
                    {isDir ? (
                      <Folder size={14} className="shrink-0 text-[var(--solar-yellow)]" />
                    ) : (
                      <FileText size={14} className="shrink-0 text-[var(--dashboard-muted)]" />
                    )}
                    <span className="truncate text-[var(--dashboard-text)]">{entry.name}</span>
                  </button>
                );
              })
            )}
            {browseRepo && onBrowseFiles ? (
              <button
                type="button"
                onClick={() => {
                  onSelectRepo(browseRepo);
                  onClose?.();
                  onBrowseFiles(browseRepo);
                }}
                className="mt-3 w-full rounded-lg border border-[var(--dashboard-border)] py-2.5 text-[12px] text-[var(--dashboard-muted)] hover:bg-[var(--bg-hover)]"
              >
                Open full GitHub browser in sidebar
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
