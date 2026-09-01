import { useCallback, useEffect, useState } from 'react';
import type { WorkbenchWorkspace, WorkbenchPullRequest, WorkbenchChangedFile } from '../types';
import { INITIAL_WORKBENCH_WORKSPACES } from '../data/mockWorkbench';
import { readIamGitStatusCache, writeIamGitStatusCache } from '../../src/iamGitStatusCache';

type GitFileRow = { path: string; status?: string; additions?: number; deletions?: number };

type GitStatusPayload = {
  status?: string;
  branch?: string | null;
  repo_full_name?: string | null;
  tracking_branch?: string;
  ahead?: number;
  behind?: number;
  hash?: string;
  staged?: GitFileRow[];
  unstaged?: GitFileRow[];
};

function mapChangedFiles(staged: GitFileRow[] = [], unstaged: GitFileRow[] = []): WorkbenchChangedFile[] {
  const merged = [...staged, ...unstaged];
  if (!merged.length) return [];
  return merged.map((f, i) => ({
    id: `git-${i}-${f.path}`,
    filename: f.path.split('/').pop() || f.path,
    path: f.path,
    status: f.status === 'added' ? 'added' : f.status === 'deleted' ? 'deleted' : 'modified',
    additions: f.additions ?? 0,
    deletions: f.deletions ?? 0,
    diffLines: [],
  }));
}

function buildLivePullRequest(
  payload: GitStatusPayload,
  fallback: WorkbenchPullRequest,
): WorkbenchPullRequest {
  const files = mapChangedFiles(payload.staged, payload.unstaged);
  const additions = files.reduce((s, f) => s + f.additions, 0);
  const deletions = files.reduce((s, f) => s + f.deletions, 0);
  return {
    ...fallback,
    branch: payload.branch ?? fallback.branch,
    targetBranch: payload.tracking_branch || fallback.targetBranch,
    additions,
    deletions,
    files: files.length ? files : fallback.files,
    updatedAt: 'just now',
    summary:
      files.length > 0
        ? `${files.length} changed file${files.length === 1 ? '' : 's'} on ${payload.branch || fallback.branch}`
        : fallback.summary,
  };
}

/**
 * Hydrates workbench workspace data from /api/agent/git/status when available,
 * falling back to prototype mock workspaces.
 */
export function useWorkModeGitBridge(workspaceId: string | null | undefined) {
  const [workspaces, setWorkspaces] = useState<WorkbenchWorkspace[]>(INITIAL_WORKBENCH_WORKSPACES);
  const [activeBranch, setActiveBranch] = useState<string>('main');
  const [gitRepoFullName, setGitRepoFullName] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [liveGit, setLiveGit] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const cached = readIamGitStatusCache();
      if (cached?.branch) {
        setActiveBranch(cached.branch);
        setGitRepoFullName(cached.repo_full_name || cached.repo || '');
      }

      const ws = workspaceId?.trim();
      const url = ws
        ? `/api/agent/git/status?workspace_id=${encodeURIComponent(ws)}`
        : '/api/agent/git/status';
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return;
      const payload = (await res.json()) as GitStatusPayload;
      writeIamGitStatusCache({
        branch: payload.branch ?? undefined,
        repo_full_name: payload.repo_full_name ?? undefined,
      });

      if (payload.branch) setActiveBranch(payload.branch);
      if (payload.repo_full_name) setGitRepoFullName(payload.repo_full_name);

      setWorkspaces((prev) => {
        if (!prev.length) return prev;
        const [first, ...rest] = prev;
        const livePr = buildLivePullRequest(payload, first.pullRequests[0]);
        return [
          {
            ...first,
            repoName: payload.repo_full_name || first.repoName,
            pullRequests: [livePr, ...first.pullRequests.slice(1)],
          },
          ...rest,
        ];
      });
      setLiveGit(true);
    } catch {
      /* keep mock fallback */
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  return {
    workspaces,
    activeBranch,
    setActiveBranch,
    gitRepoFullName,
    loading,
    liveGit,
    refreshGit: refresh,
  };
}
