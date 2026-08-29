/**
 * Code-index queue continuation — 1 AM pump (legacy) + every-5-minute stale reclaim.
 */
import { runPendingCodeIndexJob } from '../agentsam/codebase/code-indexer.js';
import { PRODUCT_SOURCE_TYPE_SQL_IN } from '../agentsam/codebase/codebase-full-index.js';
import { MINUTE_STALE_RECLAIM_SECONDS } from '../agentsam/codebase/code-indexer-shared.js';
import {
  failJobTreesitterWasmAbort,
  isTreesitterWasmAbortSuspect,
} from '../agentsam/codebase/codebase-treesitter-heartbeat.js';
import { enqueueFullCodeIndexBatch } from '../agentsam/codebase/deploy-code-index-queue.js';

/**
 * @param {any} env
 */
export async function runCodeIndexCronStep(env) {
  const out = await runPendingCodeIndexJob(env, { cpuBudgetMs: 20_000 });
  if (out.skipped) {
    return { ok: true, skipped: true, reason: out.reason, rowsWritten: 0, rowsRead: 0 };
  }
  return {
    ok: out.ok !== false,
    job_id: out.job_id,
    complete: out.complete,
    chunks_written: out.chunks_written ?? 0,
    rowsWritten: Number(out.chunks_written) || 0,
    rowsRead: Number(out.files_processed_this_run) || 0,
    metadata: out,
  };
}

/**
 * Reclaim product full-index rows left status=running after isolate death.
 * Does not parse — only idle + MY_QUEUE enqueue (or fail loud on WASM abort).
 * @param {any} env
 */
export async function reclaimStaleFullIndexQueueJobs(env) {
  if (!env?.DB) return { ok: false, error: 'no_db', reclaimed: 0, failed_wasm: 0 };
  const staleSec = Math.max(60, Number(MINUTE_STALE_RECLAIM_SECONDS) || 120);
  const { results } = await env.DB.prepare(
    `SELECT id, workspace_id, symbol_summary, indexed_file_count, failed_file_count
       FROM agentsam_code_index_job
      WHERE status = 'running'
        AND COALESCE(source_type, '') IN ${PRODUCT_SOURCE_TYPE_SQL_IN}
        AND updated_at < unixepoch() - ?
      ORDER BY updated_at ASC
      LIMIT 5`,
  )
    .bind(staleSec)
    .all()
    .catch(() => ({ results: [] }));

  const rows = Array.isArray(results) ? results : [];
  let reclaimed = 0;
  let failedWasm = 0;
  const runIds = [];
  for (const row of rows) {
    const runId = row?.id != null ? String(row.id).trim() : '';
    if (!runId) continue;
    let summary = null;
    try {
      summary = row.symbol_summary != null ? JSON.parse(String(row.symbol_summary)) : null;
    } catch {
      summary = null;
    }
    if (
      isTreesitterWasmAbortSuspect(summary, {
        indexedFileCount: Number(row.indexed_file_count) || 0,
        failedFileCount: Number(row.failed_file_count) || 0,
      })
    ) {
      await failJobTreesitterWasmAbort(env, runId, summary);
      failedWasm += 1;
      continue;
    }
    const claim = await env.DB.prepare(
      `UPDATE agentsam_code_index_job
          SET status = 'idle',
              triggered_by = 'five_min_stale_reclaim',
              updated_at = unixepoch()
        WHERE id = ? AND status = 'running'`,
    )
      .bind(runId)
      .run()
      .catch(() => null);
    const changed = Number(claim?.meta?.changes ?? claim?.changes ?? 0) > 0;
    if (!changed) continue;
    const enq = await enqueueFullCodeIndexBatch(env, {
      runId,
      workspaceId: row.workspace_id != null ? String(row.workspace_id) : '',
    });
    if (enq.ok === true) {
      reclaimed += 1;
      runIds.push(runId);
    }
  }
  return {
    ok: true,
    reclaimed,
    failed_wasm: failedWasm,
    run_ids: runIds,
    rowsRead: rows.length,
    rowsWritten: reclaimed + failedWasm,
  };
}
