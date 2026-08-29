/** Pure reducer for /code-index-status payloads (ProjectDetail peel B1). */

import { formatEmbedSpendLine, type EmbedCostRollup } from './codeIndexFormat';
import type { CodeIndexAst, CodeIndexState, PreviousCodeIndexRun } from './codeIndexTypes';

export type CodeIndexStatusPayload = {
  ok?: boolean;
  error?: string;
  workspace_id?: string;
  github_repo?: string | null;
  github_connected?: boolean;
  selected_run_id?: string | null;
  previous_runs?: PreviousCodeIndexRun[];
  ast?: CodeIndexAst;
  embed_cost?: EmbedCostRollup;
  run?: {
    run_id?: string;
    job_id?: string;
    status?: string;
    progress_percent?: number;
    stage?: string;
    readiness?: string;
    activated?: boolean;
    calls_written?: number;
    calls_backfill?: {
      ok?: boolean;
      queued?: boolean;
      calls_written?: number;
      file_offset?: number;
      shard_index?: number;
      total_shards?: number;
      total_files?: number;
    } | null;
    revision_sha?: string | null;
    file_count?: number;
    indexed_file_count?: number;
    chunk_count?: number;
    failed_file_count?: number;
    skipped_unchanged?: number;
    last_error?: string | null;
    mode?: string;
    source_type?: string;
  };
};

export type ApplyCodeIndexStatusResult =
  | { ok: false; error: string }
  | {
      ok: true;
      patch: Omit<CodeIndexState, never>;
      previousRuns?: PreviousCodeIndexRun[];
      resolvedRunId: string | null;
      autoStoppedToast?: string;
    };

export function applyCodeIndexStatusPayload(
  resOk: boolean,
  resStatus: number,
  payload: CodeIndexStatusPayload,
  opts?: { soft?: boolean },
): ApplyCodeIndexStatusResult {
  if (!resOk || payload.ok === false) {
    return {
      ok: false,
      error: typeof payload.error === 'string' ? payload.error : `Load failed (${resStatus})`,
    };
  }

  const run = payload.run ?? null;
  const githubRepo =
    typeof payload.github_repo === 'string' && payload.github_repo.trim()
      ? payload.github_repo.trim()
      : null;
  const status = String(run?.status || '').toLowerCase();
  const stage = String(run?.stage || 'idle');
  const bfEarly = run?.calls_backfill;
  const level2Pending =
    Boolean(bfEarly) &&
    bfEarly?.ok !== true &&
    (Number(bfEarly?.total_shards) > 0 ||
      bfEarly?.queued === true ||
      Number(bfEarly?.shard_index) >= 0 ||
      stage === 'calls_backfill');
  // Done only when activated with call-graph quality (ready). Degradation is not green.
  const activated =
    run?.activated === true && run?.readiness === 'ready' && !level2Pending;
  const cancelled = status === 'cancelled';
  const failed = status === 'failed' || stage === 'failed' || stage === 'verify_failed';
  const active =
    !!run &&
    !activated &&
    !failed &&
    !cancelled &&
    (['idle', 'running'].includes(status) || level2Pending || stage === 'calls_backfill');
  const fileTotal = Math.max(0, Number(run?.file_count) || 0);
  const fileDone = Math.max(0, Number(run?.indexed_file_count) || 0);
  const chunkDone = Math.max(0, Number(run?.chunk_count) || 0);
  const failedFiles = Math.max(0, Number(run?.failed_file_count) || 0);
  const skippedUnchanged = Math.max(0, Number(run?.skipped_unchanged) || 0);
  // Ring % is attempted/total — failed files still advance it (not success rate).
  const failHeavy =
    failedFiles >= 50 || (fileDone >= 20 && failedFiles / Math.max(fileDone, 1) >= 0.2);
  let progress = Math.max(0, Math.min(100, Number(run?.progress_percent) || 0));
  // File-ratio only during crawl/parse. After parse completes, D1 progress_percent
  // (embed ~70–92, verify ~92+) is truth — never max() with 1992/1992 → fake 99%.
  const fileRatioPct =
    fileTotal > 0 ? Math.max(1, Math.min(99, Math.ceil((fileDone / fileTotal) * 100))) : 0;
  if (active && fileTotal > 0 && (stage === 'parse_chunks' || stage === 'queued' || stage === 'crawl')) {
    progress = fileRatioPct;
  }
  if (level2Pending && Number(bfEarly?.total_shards) > 0) {
    const shardDone = Math.min(
      Number(bfEarly?.total_shards) || 0,
      Math.max(0, Number(bfEarly?.shard_index) || 0),
    );
    progress = Math.max(
      92,
      Math.min(99, 92 + Math.floor((shardDone / Number(bfEarly.total_shards)) * 7)),
    );
  }
  const stageLabel: Record<string, string> = {
    queued: 'Queued · waiting for crawl',
    parse_chunks: 'Crawling, parsing, and embedding chunks',
    embed_symbols: 'Embedding structural symbols',
    verify: 'Verifying run artifacts',
    activate: 'Writing dependency / call edges',
    active:
      run?.mode === 'incremental' || run?.source_type === 'incremental_refresh'
        ? 'Incremental index active'
        : 'Full index active',
    calls_backfill: 'Writing call-graph edges (Level 2)',
    verify_failed: 'Verification failed',
    failed: 'Index run failed',
  };
  const revision = run?.revision_sha ? String(run.revision_sha).slice(0, 8) : null;
  const runTruth =
    active && fileTotal > 0
      ? `${fileDone}/${fileTotal} files · ${chunkDone} chunks${
          skippedUnchanged ? ` · ${skippedUnchanged} unchanged skipped` : ''
        }${failedFiles ? ` · ${failedFiles} failed` : ''}${
          failHeavy ? ' · FAIL-HEAVY (ring ≠ success)' : ''
        }`
      : active && stage === 'embed_symbols'
        ? `Embedding symbols${skippedUnchanged ? ` · ${skippedUnchanged} files unchanged` : ''}${
            failHeavy && failedFiles ? ` · ${failedFiles} failed · FAIL-HEAVY` : ''
          }`
        : null;
  const spend = formatEmbedSpendLine(payload.embed_cost ?? null);
  const message = !githubRepo
    ? 'Connect a GitHub repo to index this project'
    : cancelled
      ? run?.last_error && String(run.last_error).startsWith('auto_stopped:')
        ? String(run.last_error)
        : `Index stopped · ${stageLabel[stage] || stage} checkpoint kept — Continue resumes the same run`
      : failed
        ? `FAILED · ${run?.last_error || stageLabel[stage] || 'Index run failed'}`
        : [stageLabel[stage] || stage, runTruth, spend || null, revision].filter(Boolean).join(' · ');

  let autoStoppedToast: string | undefined;
  if (
    cancelled &&
    run?.last_error &&
    String(run.last_error).startsWith('auto_stopped:') &&
    !opts?.soft
  ) {
    autoStoppedToast = String(run.last_error).slice(0, 220);
  }

  const resolvedRunId =
    (run?.run_id && String(run.run_id)) ||
    (payload.selected_run_id && String(payload.selected_run_id)) ||
    null;
  const callsWritten = Math.max(0, Number(run?.calls_written) || 0);
  const bf = run?.calls_backfill || bfEarly;
  const shardLabel =
    level2Pending && bf && Number(bf.total_shards) > 0
      ? `Writing call graph · shard ${Math.min(Number(bf.shard_index) || 0, Number(bf.total_shards))}/${bf.total_shards}` +
        (callsWritten > 0 ? ` · ${callsWritten} edges` : '')
      : level2Pending
        ? 'Writing call-graph edges…'
        : null;

  const patch: CodeIndexState = {
    loading: false,
    reindexing: active,
    callsWritten,
    callsBackfilling: level2Pending,
    phase: !githubRepo
      ? 'idle'
      : failed
        ? 'error'
        : activated && callsWritten > 0
          ? 'calls'
          : activated
            ? 'ok'
            : active
              ? 'running'
              : cancelled
                ? 'idle'
                : 'idle',
    progressPct: activated ? 100 : cancelled ? Math.max(1, Math.min(99, progress || 1)) : progress,
    statusMsg: !githubRepo
      ? message
      : shardLabel
        ? [shardLabel, spend || null].filter(Boolean).join(' · ')
        : run
          ? callsWritten > 0
            ? `${message} · ${callsWritten} call edges`
            : message
          : 'No full index run yet',
    error: failed ? run?.last_error || 'Index run failed' : null,
    workspaceId: payload.workspace_id ? String(payload.workspace_id) : null,
    githubRepo,
    githubConnected: payload.github_connected === true || Boolean(githubRepo),
    ast: payload.ast ?? null,
    embedCost: payload.embed_cost ?? null,
    job: run
      ? {
          ...run,
          id: run.job_id || run.run_id,
          calls_written: callsWritten,
        }
      : null,
  };

  return {
    ok: true,
    patch,
    previousRuns: Array.isArray(payload.previous_runs) ? payload.previous_runs : undefined,
    resolvedRunId,
    autoStoppedToast,
  };
}
