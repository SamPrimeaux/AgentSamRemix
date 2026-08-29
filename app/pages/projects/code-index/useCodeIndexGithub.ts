/** GitHub repo bind UI state for the code-index rail (B1 support; B5 may re-home). */

import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { CodeIndexState, GithubRepoRow } from './codeIndexTypes';

export type UseCodeIndexGithubArgs = {
  projectId: string | undefined;
  onToast: (message: string) => void;
  setCodeIndex: Dispatch<SetStateAction<CodeIndexState>>;
  loadCodeIndex: (opts?: { soft?: boolean; runId?: string | null }) => Promise<void>;
};

export function useCodeIndexGithub({
  projectId,
  onToast,
  setCodeIndex,
  loadCodeIndex,
}: UseCodeIndexGithubArgs) {
  const [githubPickerOpen, setGithubPickerOpen] = useState(false);
  const [githubRepos, setGithubRepos] = useState<GithubRepoRow[]>([]);
  const [githubReposLoading, setGithubReposLoading] = useState(false);
  const [githubReposAuthed, setGithubReposAuthed] = useState(true);
  const [githubRepoSearch, setGithubRepoSearch] = useState('');
  const [githubConnectBusy, setGithubConnectBusy] = useState(false);
  const [githubRepoLabelExpanded, setGithubRepoLabelExpanded] = useState(false);

  const loadProjectGithubRepos = useCallback(async () => {
    setGithubReposLoading(true);
    try {
      const res = await fetch('/api/integrations/github/repos', { credentials: 'same-origin' });
      if (!res.ok) {
        setGithubReposAuthed(false);
        setGithubRepos([]);
        return;
      }
      setGithubReposAuthed(true);
      const data = await res.json().catch(() => ({}));
      const list = Array.isArray(data) ? data : data?.repos || [];
      setGithubRepos(Array.isArray(list) ? (list as GithubRepoRow[]) : []);
    } catch {
      setGithubReposAuthed(false);
      setGithubRepos([]);
    } finally {
      setGithubReposLoading(false);
    }
  }, []);

  const openGithubPicker = () => {
    setGithubPickerOpen(true);
    setGithubRepoSearch('');
    void loadProjectGithubRepos();
  };

  const connectProjectGithubRepo = async (
    repoFullName: string,
    opts?: { startIndex?: boolean; defaultBranch?: string | null },
  ) => {
    if (!projectId || !repoFullName || githubConnectBusy) return;
    setGithubConnectBusy(true);
    try {
      const body: Record<string, unknown> = {
        github_repo: repoFullName,
        start_index: opts?.startIndex !== false,
      };
      if (opts?.defaultBranch) body.branch = opts.defaultBranch;
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/github`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        github_repo?: string | null;
        index?: { ok?: boolean; run_id?: string };
      };
      if (!res.ok || payload.ok === false) {
        onToast(payload.error || payload.message || `Connect failed (${res.status})`);
        return;
      }
      setGithubPickerOpen(false);
      setCodeIndex((state: CodeIndexState) => ({
        ...state,
        githubRepo: payload.github_repo || repoFullName,
        githubConnected: true,
        reindexing: Boolean(payload.index?.run_id),
        phase: payload.index?.run_id ? 'running' : state.phase,
        statusMsg: payload.message || `Connected ${repoFullName}`,
      }));
      onToast(payload.message || `Connected ${repoFullName}`);
      window.setTimeout(() => void loadCodeIndex({ soft: true }), 600);
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Connect failed');
    } finally {
      setGithubConnectBusy(false);
    }
  };

  const disconnectProjectGithubRepo = async () => {
    if (!projectId || githubConnectBusy) return;
    setGithubConnectBusy(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/github`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };
      if (!res.ok || payload.ok === false) {
        onToast(payload.error || payload.message || `Disconnect failed (${res.status})`);
        return;
      }
      setGithubPickerOpen(false);
      setCodeIndex((state: CodeIndexState) => ({
        ...state,
        githubRepo: null,
        githubConnected: false,
        reindexing: false,
        phase: 'idle',
        progressPct: 0,
        statusMsg: 'Connect a GitHub repo to index this project',
        ast: null,
        job: null,
      }));
      onToast(payload.message || 'GitHub repo disconnected');
      void loadCodeIndex({ soft: true });
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Disconnect failed');
    } finally {
      setGithubConnectBusy(false);
    }
  };

  const filteredGithubRepos = useMemo(() => {
    const q = githubRepoSearch.trim().toLowerCase();
    if (!q) return githubRepos;
    return githubRepos.filter((repo: GithubRepoRow) => {
      const full = String(repo.full_name || repo.name || '').toLowerCase();
      return full.includes(q);
    });
  }, [githubRepos, githubRepoSearch]);

  return {
    githubPickerOpen,
    setGithubPickerOpen,
    githubReposLoading,
    githubReposAuthed,
    githubRepoSearch,
    setGithubRepoSearch,
    githubConnectBusy,
    githubRepoLabelExpanded,
    setGithubRepoLabelExpanded,
    filteredGithubRepos,
    openGithubPicker,
    connectProjectGithubRepo,
    disconnectProjectGithubRepo,
  };
}
