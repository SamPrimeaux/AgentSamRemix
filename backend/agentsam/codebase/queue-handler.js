/**
 * Queue consumer for durable full codebase index batches.
 * Message type: codebase_full_index_batch
 */
import {
  enqueueFullCodeIndexBatch,
  FULL_INDEX_QUEUE_TYPE,
  FULL_INDEX_SKIP_REQUEUE_DELAY_SECONDS,
  fullIndexQueueBatchIsHardFail,
  fullIndexQueueSkipShouldRequeue,
} from './deploy-code-index-queue.js';
import {
  failJobTreesitterWasmAbort,
  isTreesitterWasmAbortSuspect,
} from './codebase-treesitter-heartbeat.js';
import { isCodeIndexPgTransientError } from './code-index-write-pipe.js';

/**
 * @param {any} env
 * @param {Record<string, unknown>} body
 */
export async function handleCodebaseFullIndexQueueJob(env, body) {
  const runId = body?.run_id != null ? String(body.run_id).trim() : '';
  if (!runId) {
    return { ok: false, error: 'run_id_required', kind: FULL_INDEX_QUEUE_TYPE };
  }
  const workspaceId = body?.workspace_id != null ? String(body.workspace_id).trim() : '';

  if (env?.DB) {
    const live = await env.DB.prepare(
      `SELECT status, symbol_summary, indexed_file_count, failed_file_count, updated_at
         FROM agentsam_code_index_job WHERE id = ? LIMIT 1`,
    )
      .bind(runId)
      .first()
      .catch(() => null);
    const st = String(live?.status || '');
    let summary = null;
    try {
      summary =
        live?.symbol_summary != null ? JSON.parse(String(live.symbol_summary)) : null;
    } catch {
      summary = null;
    }
    const cancelRequested = summary?.cancel_requested === true;
    const bf = summary?.stages?.calls_backfill;
    const callsPending =
      bf &&
      bf.ok !== true &&
      (Number(bf.total_shards) > 0 || bf.queued === true || Number(bf.shard_index) >= 0);
    const stage = String(summary?.stage || '');
    const indexedFileCount = Number(live?.indexed_file_count) || 0;
    const failedFileCount = Number(live?.failed_file_count) || 0;
    const wasmSuspect = isTreesitterWasmAbortSuspect(summary, {
      indexedFileCount,
      failedFileCount,
    });
    const staleSecs = live?.updated_at != null ? Math.max(0, Math.floor(Date.now() / 1000) - Number(live.updated_at)) : 0;

    if (st === 'cancelled' || cancelRequested || st === 'failed') {
      // Heal race: sticky cancel flag with wrong status.
      if (cancelRequested && st !== 'cancelled' && st !== 'completed' && st !== 'failed') {
        await env.DB.prepare(
          `UPDATE agentsam_code_index_job
              SET status = 'cancelled', updated_at = unixepoch()
            WHERE id = ? AND status IN ('idle','running')`,
        )
          .bind(runId)
          .run()
          .catch(() => null);
      }
      return {
        ok: true,
        kind: FULL_INDEX_QUEUE_TYPE,
        terminal: true,
        skipped: true,
        reason: cancelRequested ? 'job_cancel_requested' : `job_${st}`,
        run_id: runId,
        status: cancelRequested ? 'cancelled' : st,
      };
    }

    // Heartbeat said before_parser_init / before_language_load, then isolate died
    // (empty exceptions[]). Do not reclaim→idle forever — fail loud once stale.
    if (wasmSuspect && (st === 'running' || st === 'idle') && staleSecs >= 45) {
      const failed = await failJobTreesitterWasmAbort(env, runId, summary);
      return {
        ok: false,
        kind: FULL_INDEX_QUEUE_TYPE,
        terminal: true,
        skipped: true,
        reason: 'treesitter_wasm_isolate_abort',
        run_id: runId,
        status: 'failed',
        error: failed.error || 'treesitter_wasm_isolate_abort',
      };
    }

    // Completed but Level 2 unfinished — reopen so one-click index can finish.
    // Never reopen when calls_backfill.ok is already true (avoids clearing finished_at).
    if (
      st === 'completed' &&
      callsPending &&
      (stage === 'calls_backfill' || stage === 'active' || stage === 'activate')
    ) {
      await env.DB.prepare(
        `UPDATE agentsam_code_index_job
            SET status = 'idle',
                completed_at = NULL,
                finished_at = NULL,
                updated_at = unixepoch(),
                triggered_by = 'queue_reclaim_calls'
          WHERE id = ? AND status = 'completed'`,
      )
        .bind(runId)
        .run()
        .catch(() => null);
    } else if (st === 'completed') {
      return {
        ok: true,
        kind: FULL_INDEX_QUEUE_TYPE,
        terminal: true,
        skipped: true,
        reason: 'job_completed',
        run_id: runId,
        status: st,
      };
    }

    // Reclaim waitUntil/queue zombies so the next batch can claim idle.
    // Never touch cancelled/completed/failed. Never reclaim WASM-suspect hearts.
    if (!wasmSuspect) {
      await env.DB.prepare(
        `UPDATE agentsam_code_index_job
            SET status = 'idle', triggered_by = 'queue_reclaim'
          WHERE id = ?
            AND status = 'running'
            AND updated_at < unixepoch() - 45`,
      )
        .bind(runId)
        .run()
        .catch(() => null);
    }

    // Single-flight: if another full-index is already running for this repo, skip.
    const meta = await env.DB.prepare(
      `SELECT workspace_id, repo_full_name, status FROM agentsam_code_index_job WHERE id = ? LIMIT 1`,
    )
      .bind(runId)
      .first()
      .catch(() => null);
    if (meta?.workspace_id && meta?.repo_full_name && String(meta.status) === 'idle') {
      const other = await env.DB.prepare(
        `SELECT id FROM agentsam_code_index_job
          WHERE workspace_id = ?
            AND repo_full_name = ?
            AND source_type = 'codebase_full'
            AND status = 'running'
            AND id != ?
          LIMIT 1`,
      )
        .bind(String(meta.workspace_id), String(meta.repo_full_name), runId)
        .first()
        .catch(() => null);
      if (other?.id) {
        const blocked = {
          ok: true,
          kind: FULL_INDEX_QUEUE_TYPE,
          skipped: true,
          reason: 'single_flight_blocked',
          run_id: runId,
          other_run_id: String(other.id),
        };
        const enq = await enqueueFullCodeIndexBatch(env, {
          runId,
          workspaceId: workspaceId || String(meta.workspace_id || ''),
          delaySeconds: FULL_INDEX_SKIP_REQUEUE_DELAY_SECONDS,
        });
        return { ...blocked, resumed: true, queue_enqueued: enq.ok === true };
      }
    }
  }

  // Structural parse lives on IAM-CODEBASE-INDEXER-SERVICE (static CompiledWasm).
  // Warm once per batch unless indexer self-warms (cron / workers.dev /push).
  const externalWarm =
    env?.CODEBASE_INDEXER_EXTERNAL_WARM === '1' ||
    env?.CODEBASE_INDEXER_EXTERNAL_WARM === 1 ||
    String(env?.CODEBASE_INDEXER_EXTERNAL_WARM || '').toLowerCase() === 'true';
  if (!externalWarm && env?.IAM_CODEBASE_INDEXER?.fetch) {
    try {
      const { warmCodebaseIndexerService } = await import(
        './indexer-client.js'
      );
      const { stampTreesitterHeartbeat } = await import(
        './codebase-treesitter-heartbeat.js'
      );
      await stampTreesitterHeartbeat(env, runId, 'before_indexer_service_warm', {
        service: 'iam-codebase-indexer-service',
      }).catch(() => null);
      await warmCodebaseIndexerService(env);
      await stampTreesitterHeartbeat(env, runId, 'ready', {
        ok: true,
        via: 'IAM_CODEBASE_INDEXER',
      }).catch(() => null);
    } catch (warmErr) {
      const message = String(warmErr?.message || warmErr || 'indexer_warm_failed').slice(0, 500);
      console.warn('[queue codebase_full_index_batch] indexer_warm', message);
      if (env?.DB) {
        await env.DB.prepare(
          `UPDATE agentsam_code_index_job
              SET status = 'failed',
                  last_error = ?,
                  finished_at = unixepoch(),
                  updated_at = unixepoch()
            WHERE id = ?
              AND status IN ('idle','running')`,
        )
          .bind(message, runId)
          .run()
          .catch(() => null);
      }
      return {
        ok: false,
        kind: FULL_INDEX_QUEUE_TYPE,
        terminal: true,
        run_id: runId,
        error: message,
      };
    }
  }

  let out;
  try {
    const { runCodeIndexJob } = await import('./code-indexer.js');
    out = await runCodeIndexJob(env, runId, {
      maxFiles: 12,
      maxSymbols: 150,
      cpuBudgetMs: 55_000,
    });
  } catch (e) {
    const message = String(e?.message || e || 'codebase_full_index_batch_threw').slice(0, 500);
    console.warn('[queue codebase_full_index_batch]', message);

    // Nano / Supavisor socket drops are transient — leave idle + requeue, never terminal-fail.
    if (isCodeIndexPgTransientError(e)) {
      if (env?.DB) {
        await env.DB.prepare(
          `UPDATE agentsam_code_index_job
              SET status = 'idle',
                  last_error = ?,
                  updated_at = unixepoch()
            WHERE id = ?
              AND status IN ('idle','running')`,
        )
          .bind(`code_index_pg_transient:${message}`.slice(0, 500), runId)
          .run()
          .catch(() => null);
      }
      const enq = await enqueueFullCodeIndexBatch(env, {
        runId,
        workspaceId: workspaceId || null,
        delaySeconds: 15,
      });
      return {
        ok: true,
        kind: FULL_INDEX_QUEUE_TYPE,
        resume: true,
        resumed: true,
        queue_enqueued: enq.ok === true,
        run_id: runId,
        error: message,
        reason: 'code_index_pg_transient',
      };
    }

    // Catchable path — persist so reclaim does not loop with empty last_error.
    if (env?.DB) {
      await env.DB.prepare(
        `UPDATE agentsam_code_index_job
            SET status = 'failed',
                last_error = ?,
                finished_at = unixepoch(),
                updated_at = unixepoch()
          WHERE id = ?
            AND status IN ('idle','running')`,
      )
        .bind(message, runId)
        .run()
        .catch(() => null);
    }
    return {
      ok: false,
      kind: FULL_INDEX_QUEUE_TYPE,
      terminal: true,
      run_id: runId,
      error: message,
    };
  }

  if (out?.cancelled || out?.complete) {
    return { ok: true, kind: FULL_INDEX_QUEUE_TYPE, terminal: true, ...out };
  }

  // A finished parse batch can return ok:false (some files failed) AND resume:true.
  // Do not flip the whole 2k-file job to failed — checkpoint already idled + last_error.
  if (fullIndexQueueBatchIsHardFail(out) && env?.DB) {
    // Pre-claim / hard failures used to return ok:false then ACK — job stayed idle forever.
    // Persist loudly when the handler did not already flip status (belt-and-suspenders).
    const err = String(out.error || out.reason || 'codebase_full_index_batch_failed').slice(0, 500);
    await env.DB.prepare(
      `UPDATE agentsam_code_index_job
          SET status = CASE WHEN status IN ('idle','running') THEN 'failed' ELSE status END,
              last_error = COALESCE(NULLIF(TRIM(last_error), ''), ?),
              finished_at = COALESCE(finished_at, unixepoch()),
              updated_at = unixepoch()
        WHERE id = ?`,
    )
      .bind(err, runId)
      .run()
      .catch(() => null);
    return { ok: false, kind: FULL_INDEX_QUEUE_TYPE, terminal: true, ...out, error: err };
  }

  if (out?.resume === true) {
    // Re-check cancel + WASM abort before spending another queue hop.
    if (env?.DB) {
      const again = await env.DB.prepare(
        `SELECT status, symbol_summary, indexed_file_count, failed_file_count
           FROM agentsam_code_index_job WHERE id = ? LIMIT 1`,
      )
        .bind(runId)
        .first()
        .catch(() => null);
      if (String(again?.status || '') === 'cancelled') {
        return {
          ok: true,
          kind: FULL_INDEX_QUEUE_TYPE,
          terminal: true,
          cancelled: true,
          run_id: runId,
        };
      }
      let againSummary = null;
      try {
        againSummary =
          again?.symbol_summary != null ? JSON.parse(String(again.symbol_summary)) : null;
      } catch {
        againSummary = null;
      }
      if (
        isTreesitterWasmAbortSuspect(againSummary, {
          indexedFileCount: Number(again?.indexed_file_count) || 0,
          failedFileCount: Number(again?.failed_file_count) || 0,
        })
      ) {
        // Init heartbeat without ready — do not keep chewing the same zombie.
        return {
          ok: false,
          kind: FULL_INDEX_QUEUE_TYPE,
          terminal: true,
          skipped: true,
          reason: 'treesitter_wasm_init_incomplete',
          run_id: runId,
        };
      }
    }
    const enq = await enqueueFullCodeIndexBatch(env, {
      runId,
      workspaceId: workspaceId || out.workspace_id || null,
    });
    return {
      ok: true,
      kind: FULL_INDEX_QUEUE_TYPE,
      resumed: true,
      queue_enqueued: enq.ok === true,
      ...out,
    };
  }

  if (fullIndexQueueSkipShouldRequeue(out)) {
    const enq = await enqueueFullCodeIndexBatch(env, {
      runId,
      workspaceId: workspaceId || out.workspace_id || null,
      delaySeconds: FULL_INDEX_SKIP_REQUEUE_DELAY_SECONDS,
    });
    return {
      ok: true,
      kind: FULL_INDEX_QUEUE_TYPE,
      resumed: true,
      queue_enqueued: enq.ok === true,
      requeued_skip: true,
      ...out,
    };
  }

  return { ok: out?.ok !== false, kind: FULL_INDEX_QUEUE_TYPE, ...out };
}
