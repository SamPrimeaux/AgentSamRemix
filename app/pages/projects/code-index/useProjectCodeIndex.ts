/** ProjectDetail code-index state, poll, and reindex actions (peel B1). */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyCodeIndexStatusPayload,
  type CodeIndexStatusPayload,
} from './applyCodeIndexStatus';
import { friendlyIndexError } from './codeIndexFormat';
import {
  INITIAL_CODE_INDEX,
  type CodeIndexState,
  type PreviousCodeIndexRun,
} from './codeIndexTypes';
import { useCodeIndexGithub } from './useCodeIndexGithub';

export type UseProjectCodeIndexArgs = {
  projectId: string | undefined;
  onToast: (message: string) => void;
};

export function useProjectCodeIndex({ projectId, onToast }: UseProjectCodeIndexArgs) {
  const [codeIndex, setCodeIndex] = useState<CodeIndexState>(INITIAL_CODE_INDEX);
  const [selectedCodeIndexRunId, setSelectedCodeIndexRunId] = useState<string | null>(null);
  const selectedCodeIndexRunIdRef = useRef<string | null>(null);
  const [previousRunsOpen, setPreviousRunsOpen] = useState(false);
  const [previousCodeIndexRuns, setPreviousCodeIndexRuns] = useState<PreviousCodeIndexRun[]>([]);

  const loadCodeIndex = useCallback(
    async (opts?: { soft?: boolean; runId?: string | null }) => {
      if (!projectId) return;
      const soft = opts?.soft === true;
      if (!soft) {
        setCodeIndex((state) => ({ ...state, loading: true, error: null }));
      }
      const ac = new AbortController();
      const kill = window.setTimeout(() => ac.abort(), 8_000);
      try {
        const pin = opts && 'runId' in opts ? opts.runId : selectedCodeIndexRunIdRef.current;
        const qs = pin ? `?run_id=${encodeURIComponent(pin)}` : '';
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/code-index-status${qs}`,
          { credentials: 'same-origin', signal: ac.signal },
        );
        const payload = (await res.json().catch(() => ({}))) as CodeIndexStatusPayload;
        const applied = applyCodeIndexStatusPayload(res.ok, res.status, payload, { soft });
        if (!applied.ok) {
          setCodeIndex((state) => ({
            ...state,
            loading: false,
            phase: 'error',
            error: applied.error,
          }));
          return;
        }
        if (applied.autoStoppedToast) onToast(applied.autoStoppedToast);
        if (applied.previousRuns) setPreviousCodeIndexRuns(applied.previousRuns);
        if (applied.resolvedRunId && selectedCodeIndexRunIdRef.current !== applied.resolvedRunId) {
          selectedCodeIndexRunIdRef.current = applied.resolvedRunId;
          setSelectedCodeIndexRunId(applied.resolvedRunId);
        }
        setCodeIndex((state) => ({ ...state, ...applied.patch }));
      } catch (error) {
        const aborted = error instanceof DOMException && error.name === 'AbortError';
        setCodeIndex((state) => ({
          ...state,
          loading: false,
          phase: 'error',
          error: aborted
            ? 'Index status timed out (dashboard poll) — job may still be running on the queue. Refresh or wait; Controls still work.'
            : error instanceof Error
              ? error.message
              : 'Load failed',
        }));
      } finally {
        window.clearTimeout(kill);
      }
    },
    [projectId, onToast],
  );

  const github = useCodeIndexGithub({
    projectId,
    onToast,
    setCodeIndex,
    loadCodeIndex,
  });

  const clearCodeIndexRunPin = () => {
    selectedCodeIndexRunIdRef.current = null;
    setSelectedCodeIndexRunId(null);
  };

  const cancelProjectFullReindex = async () => {
    if (!projectId) return;
    const jobStatus = String(codeIndex.job?.status || '').toLowerCase();
    const canStop =
      codeIndex.reindexing ||
      codeIndex.phase === 'running' ||
      codeIndex.callsBackfilling ||
      ['idle', 'running', 'queued'].includes(jobStatus);
    if (!canStop) return;
    setCodeIndex((state) => ({
      ...state,
      statusMsg: 'Cancelling…',
      reindexing: true,
      phase: 'running',
    }));
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/reindex/cancel`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run_id: codeIndex.job?.run_id || codeIndex.job?.id || null,
          reason: 'cancelled_from_project_rail',
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        cancelled?: boolean;
        error?: string;
        reason?: string;
      };
      clearCodeIndexRunPin();
      await loadCodeIndex({ soft: true, runId: null });
      if (!res.ok || payload.ok === false) {
        onToast(payload.error || payload.reason || `Cancel failed (${res.status})`);
        return;
      }
      if (payload.cancelled || payload.ok !== false) {
        onToast(
          payload.cancelled
            ? 'Index stopped — Continue resumes the same run'
            : 'No active full index to cancel',
        );
      }
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Cancel failed');
    }
  };

  const backfillProjectCallGraph = async () => {
    if (!projectId || codeIndex.reindexing || codeIndex.callsBackfilling) return;
    const runId = codeIndex.job?.run_id || codeIndex.job?.id || selectedCodeIndexRunId;
    if (!runId) {
      onToast('No completed index run selected');
      return;
    }
    setCodeIndex((state) => ({
      ...state,
      callsBackfilling: true,
      statusMsg: 'Level 2 · writing call-graph edges (no re-crawl)…',
    }));
    onToast('Level 2 · writing function-call edges…');
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/reindex/calls`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: runId }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        complete?: boolean;
        calls_written?: number;
      };
      if (!res.ok || payload.ok === false) {
        const msg = payload.error || payload.message || 'Call graph backfill failed';
        setCodeIndex((state) => ({ ...state, callsBackfilling: false, error: msg }));
        onToast(msg);
        return;
      }
      onToast(payload.message || 'Level 2 started');
      if (payload.complete === true && Number(payload.calls_written) > 0) {
        await loadCodeIndex({ soft: true, runId });
        setCodeIndex((state) => ({ ...state, callsBackfilling: false }));
        return;
      }
      for (let i = 0; i < 90; i += 1) {
        await new Promise((r) => window.setTimeout(r, 3000));
        const check = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/code-index-status?run_id=${encodeURIComponent(runId)}`,
          { credentials: 'same-origin' },
        );
        const body = (await check.json().catch(() => ({}))) as {
          run?: {
            calls_written?: number;
            calls_backfill?: { ok?: boolean; queued?: boolean; shard_index?: number };
          };
        };
        const n = Math.max(0, Number(body?.run?.calls_written) || 0);
        const bf = body?.run?.calls_backfill;
        const done = bf?.ok === true;
        const stalled = i >= 10 && !done && n === 0 && !(Number(bf?.shard_index) > 0);
        await loadCodeIndex({ soft: true, runId });
        if (done || stalled) break;
      }
      setCodeIndex((state) => ({ ...state, callsBackfilling: false }));
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Call graph backfill failed');
      setCodeIndex((state) => ({ ...state, callsBackfilling: false }));
    }
  };

  const resumeProjectFullReindex = async () => {
    if (!projectId || codeIndex.reindexing) return;
    // Prefer the live rail run — never Continue a stale Previous-Runs pin over a newer Build.
    const live =
      previousCodeIndexRuns.find((r) =>
        ['running', 'idle', 'queued'].includes(String(r.status || '').toLowerCase()),
      )?.run_id || null;
    const runId =
      live || codeIndex.job?.run_id || codeIndex.job?.id || selectedCodeIndexRunIdRef.current || null;
    if (live && selectedCodeIndexRunIdRef.current !== live) {
      selectedCodeIndexRunIdRef.current = live;
      setSelectedCodeIndexRunId(live);
    }
    setCodeIndex((state) => ({
      ...state,
      reindexing: true,
      phase: 'running',
      statusMsg: 'Continuing same index run…',
      error: null,
    }));
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/reindex/resume`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(runId ? { run_id: runId } : {}),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        run_id?: string;
      };
      if (payload.run_id) {
        selectedCodeIndexRunIdRef.current = payload.run_id;
        setSelectedCodeIndexRunId(payload.run_id);
      }
      await loadCodeIndex({ soft: true, runId: payload.run_id || runId });
      if (!res.ok || payload.ok === false) {
        const message =
          payload.error === 'newer_run_in_progress'
            ? payload.message ||
              'A newer index run is already active — Continue will not cancel it.'
            : friendlyIndexError(payload.error, payload.message) || 'Continue failed';
        setCodeIndex((state) => ({
          ...state,
          reindexing: false,
          phase: 'error',
          statusMsg: message,
          error: message,
        }));
        onToast(message);
        return;
      }
      onToast('Continuing the same index run from its checkpoint');
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Continue failed');
      setCodeIndex((state) => ({ ...state, reindexing: false, phase: 'error' }));
    }
  };

  const reindexProjectFull = async (opts?: { force?: boolean }) => {
    if (!projectId || codeIndex.reindexing) return;
    if (!codeIndex.githubConnected || !codeIndex.githubRepo) {
      github.openGithubPicker();
      onToast('Connect a GitHub repo before indexing');
      return;
    }
    const force = opts?.force === true;
    if (force) {
      const ok = window.confirm(
        'Restart full index from scratch?\n\nThis starts a NEW run (does not Continue the stopped checkpoint). Full mode re-parses and re-embeds every indexable file (no blob-skip) so import/call edges rebuild. Use when the parser/schema changed or the last run is unrecoverable. Spend resets for the new run.',
      );
      if (!ok) return;
    }
    clearCodeIndexRunPin();
    setCodeIndex((state) => ({
      ...state,
      reindexing: true,
      phase: 'running',
      progressPct: 1,
      statusMsg: force ? 'Queueing new full crawl…' : 'Queueing full crawl…',
      error: null,
    }));
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/reindex`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'full', ...(force ? { force: true } : {}) }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        run_id?: string;
        resumed_from_stopped?: boolean;
      };
      if (!res.ok || payload.ok === false || !payload.run_id) {
        const message =
          payload.error === 'github_repo_required'
            ? 'Connect a GitHub repo before indexing'
            : friendlyIndexError(payload.error, payload.message) || 'Full re-index queue failed';
        setCodeIndex((state) => ({
          ...state,
          reindexing: false,
          phase: 'error',
          statusMsg: message,
          error: message,
        }));
        if (payload.error === 'github_repo_required') github.openGithubPicker();
        onToast(message);
        return;
      }
      selectedCodeIndexRunIdRef.current = payload.run_id;
      setSelectedCodeIndexRunId(payload.run_id);
      setCodeIndex((state) => ({
        ...state,
        job: { run_id: payload.run_id, id: payload.run_id, status: 'idle', stage: 'queued' },
        statusMsg: payload.resumed_from_stopped
          ? `Continued stopped run · ${payload.run_id}`
          : `Queued · ${payload.run_id}`,
      }));
      onToast(
        payload.resumed_from_stopped
          ? 'Continued the stopped index from its checkpoint'
          : force
            ? 'New full codebase re-index queued'
            : 'Full codebase re-index queued',
      );
      window.setTimeout(() => void loadCodeIndex({ soft: true, runId: payload.run_id }), 750);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Full re-index failed';
      setCodeIndex((state) => ({
        ...state,
        reindexing: false,
        phase: 'error',
        statusMsg: message,
        error: message,
      }));
      onToast(message);
    }
  };

  /** Delta vs activated baseline (compare discovery) — not a full tree crawl. */
  const reindexProjectIncremental = async () => {
    if (!projectId || codeIndex.reindexing) return;
    if (!codeIndex.githubConnected || !codeIndex.githubRepo) {
      github.openGithubPicker();
      onToast('Connect a GitHub repo before indexing');
      return;
    }
    clearCodeIndexRunPin();
    setCodeIndex((state) => ({
      ...state,
      reindexing: true,
      phase: 'running',
      progressPct: 1,
      statusMsg: 'Queueing incremental update…',
      error: null,
    }));
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/reindex`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'incremental' }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        run_id?: string;
      };
      if (!res.ok || payload.ok === false || !payload.run_id) {
        const message =
          payload.error === 'incremental_requires_activated_baseline'
            ? 'No activated baseline yet — run a full Build once, then Update works.'
            : payload.error === 'github_repo_required'
              ? 'Connect a GitHub repo before indexing'
              : friendlyIndexError(payload.error, payload.message) ||
                'Incremental update queue failed';
        setCodeIndex((state) => ({
          ...state,
          reindexing: false,
          phase: 'error',
          statusMsg: message,
          error: message,
        }));
        if (payload.error === 'github_repo_required') github.openGithubPicker();
        onToast(message);
        return;
      }
      selectedCodeIndexRunIdRef.current = payload.run_id;
      setSelectedCodeIndexRunId(payload.run_id);
      setCodeIndex((state) => ({
        ...state,
        job: {
          run_id: payload.run_id,
          id: payload.run_id,
          status: 'idle',
          stage: 'queued',
        },
        statusMsg: `Update queued · ${payload.run_id}`,
      }));
      onToast(payload.message || 'Incremental codebase update queued');
      window.setTimeout(() => void loadCodeIndex({ soft: true, runId: payload.run_id }), 750);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Incremental update failed';
      setCodeIndex((state) => ({
        ...state,
        reindexing: false,
        phase: 'error',
        statusMsg: message,
        error: message,
      }));
      onToast(message);
    }
  };

  const selectPreviousRun = (runId: string) => {
    selectedCodeIndexRunIdRef.current = runId;
    setSelectedCodeIndexRunId(runId);
    void loadCodeIndex({ soft: true, runId });
  };

  useEffect(() => {
    // Full remount / hard refresh: never keep a Previous-Runs pin across page loads.
    selectedCodeIndexRunIdRef.current = null;
    setSelectedCodeIndexRunId(null);
    void loadCodeIndex({ soft: false, runId: null });
  }, [loadCodeIndex]);

  // Poll while the Worker job is live — not only while local reindexing=true.
  // Leaving the page stops the interval (OK); remount resumes polling. Queue keeps working either way.
  useEffect(() => {
    const jobStatus = String(codeIndex.job?.status || '').toLowerCase();
    const live =
      codeIndex.reindexing ||
      codeIndex.phase === 'running' ||
      codeIndex.callsBackfilling ||
      ['idle', 'running', 'queued'].includes(jobStatus);
    if (!live) return undefined;
    const pollId = window.setInterval(() => void loadCodeIndex({ soft: true }), 2500);
    return () => window.clearInterval(pollId);
  }, [
    codeIndex.reindexing,
    codeIndex.phase,
    codeIndex.callsBackfilling,
    codeIndex.job?.status,
    loadCodeIndex,
  ]);

  return {
    codeIndex,
    loadCodeIndex,
    selectedCodeIndexRunId,
    previousRunsOpen,
    setPreviousRunsOpen,
    previousCodeIndexRuns,
    cancelProjectFullReindex,
    backfillProjectCallGraph,
    resumeProjectFullReindex,
    reindexProjectFull,
    reindexProjectIncremental,
    selectPreviousRun,
    ...github,
  };
}

export type ProjectCodeIndexApi = ReturnType<typeof useProjectCodeIndex>;
