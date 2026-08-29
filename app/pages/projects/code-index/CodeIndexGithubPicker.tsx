/** GitHub repo picker for the code-index rail (B1 support). */

import { Github, Loader2, Search, X } from 'lucide-react';
import type { GithubRepoRow } from './codeIndexTypes';

export function CodeIndexGithubPicker({
  projectId,
  githubRepo,
  githubRepoSearch,
  setGithubRepoSearch,
  githubReposLoading,
  githubReposAuthed,
  filteredGithubRepos,
  githubConnectBusy,
  onClose,
  onConnect,
}: {
  projectId: string | undefined;
  githubRepo: string | null;
  githubRepoSearch: string;
  setGithubRepoSearch: (value: string) => void;
  githubReposLoading: boolean;
  githubReposAuthed: boolean;
  filteredGithubRepos: GithubRepoRow[];
  githubConnectBusy: boolean;
  onClose: () => void;
  onConnect: (full: string, opts: { startIndex: boolean; defaultBranch: string | null }) => void;
}) {
  return (
    <div className="cpd-gh-picker">
      <div className="cpd-gh-picker-head">
        <span>Select repository</span>
        <button type="button" className="cpd-icon-btn" title="Close" onClick={onClose}>
          <X size={12} strokeWidth={1.5} />
        </button>
      </div>
      <div className="cpd-gh-picker-search">
        <Search size={12} strokeWidth={1.5} />
        <input
          type="search"
          value={githubRepoSearch}
          onChange={(e) => setGithubRepoSearch(e.target.value)}
          placeholder="Search your repos…"
          autoFocus
        />
      </div>
      <div className="cpd-gh-picker-list">
        {githubReposLoading && filteredGithubRepos.length === 0 ? (
          <p className="cpd-rail-preview-empty">
            <Loader2 size={12} className="cpd-spin" /> Loading repositories…
          </p>
        ) : !githubReposAuthed ? (
          <div className="cpd-gh-empty">
            <p className="cpd-rail-preview-empty">Connect GitHub OAuth to list your repositories.</p>
            <button
              type="button"
              className="cpd-gh-connect-btn"
              onClick={() => {
                window.location.href =
                  '/api/oauth/github/start?return_to=' +
                  encodeURIComponent(`/dashboard/projects/${encodeURIComponent(projectId || '')}`);
              }}
            >
              <Github size={14} strokeWidth={1.5} />
              Connect GitHub
            </button>
          </div>
        ) : filteredGithubRepos.length === 0 ? (
          <p className="cpd-rail-preview-empty">No repositories match.</p>
        ) : (
          filteredGithubRepos.map((repo) => {
            const full = String(repo.full_name || repo.name || '').trim();
            if (!full) return null;
            const selected = full === githubRepo;
            return (
              <button
                key={String(repo.id ?? full)}
                type="button"
                className={`cpd-gh-repo-row${selected ? ' cpd-gh-repo-row--selected' : ''}`}
                disabled={githubConnectBusy}
                onClick={() =>
                  onConnect(full, {
                    startIndex: true,
                    defaultBranch: repo.default_branch || null,
                  })
                }
              >
                <span className="cpd-gh-repo-name">{full}</span>
                {repo.default_branch ? (
                  <span className="cpd-gh-repo-branch">{repo.default_branch}</span>
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
