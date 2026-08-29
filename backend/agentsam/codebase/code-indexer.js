/**
 * Code indexer — facade (stable import surface for queue/API/cron).
 * Comments have no runtime effect; this map is for debugging only.
 *
 * Hot path (product Update/Restart/Continue):
 *   queue/handlers/codebase-full-index.js
 *     → code-indexer.js (this file)
 *     → code-indexer-dispatch.js     claim job + Hyperdrive gate; route product vs chunk path
 *     → code-indexer-full-run.js     crawl → stage loop host
 *     → code-indexer-parse.js        parse / chunks / nodes / symbols
 *     → code-indexer-embed.js        symbol embeddings + Vectorize
 *     → code-indexer-verify.js       verify gate, activate prune, calls_backfill finalize
 *
 * Supporting modules (same feature):
 *   code-indexer-github.js           tree/compare snapshots, file fetch, token
 *   code-indexer-job-state.js        patchJob, manifests, carry-forward, checkpoints
 *   code-indexer-symbols.js          PG/D1 symbol+node writes, relink, embed stamps
 *   code-indexer-shared.js           constants, embed helpers, Vectorize upsert/delete
 *   code-index-job-files.js          per-file receipts; orphan job purge
 *   code-index-vector-backend-receipt.js  vector backend receipt helpers
 *   code-index-terminal-log.js       terminal/log side-channel
 *   codebase-full-index.js           mode/SHA helpers, product source-type checks
 *   codebase-structural-quality-rollup.js  quality rollup for verify
 *   codebase-dep-edges.js            import edge write + activate prune
 *   codebase-calls-edges.js          Level-2 call-graph edges (calls_backfill)
 *   codebase-structural-parse.js     AST parse used by parse stage
 *   codebase-index-health.js         health / store counts for status UI
 *   GitHub webhook              audit-only; indexing is project-rail buttons
 *   deploy-code-index-queue.js       enqueue helpers / queue payload
 *
 * HTTP / schedule entry (not re-exported here):
 *   api/projects/code-index.js         project dashboard Update/Continue/Restart
 *   api/code-index-run.js              run API helpers
 *   api/workspace-code-index-status.js status payload for Codebase index panel
 *   backend/jobs/code-index-runner.js  scheduled reclaim / pump
 *   queue/handlers/codebase-full-index.js  MY_QUEUE consumer → runCodeIndexJob
 */
export {
  buildCodeIndexVectorBackendReceipt,
  supabaseProjectRefFromHyperdriveConnectionString,
} from './code-index-vector-backend-receipt.js';

export {
  INCREMENTAL_REQUIRES_ACTIVATED_BASELINE,
  buildCompareDeltaFromGithubFiles,
  extractActivatedRevisionSha,
  normalizeCodeIndexMode,
  normalizeFullGitSha,
  resolveQueueBaseSha,
} from './codebase-full-index.js';

export { rollupJobStructuralQuality } from './codebase-structural-quality-rollup.js';

export {
  CODE_BINDING,
  CHUNKS_TABLE,
  SYMBOL_TABLE,
  FULL_FILES_PER_RUN,
  FULL_SYMBOLS_PER_RUN,
  FULL_FILES_CAP,
  FULL_SYMBOLS_CAP,
  EMBED_CONCURRENCY,
  FULL_FAIL_ABORT_ABS,
  FULL_FAIL_ABORT_RATIO,
  FULL_FAIL_ABORT_MIN_ATTEMPTED,
  VECTORIZE_UPSERT_CONCURRENCY,
  EMBED_SPEC,
  getCodeIndexChunksTable,
  getCodeIndexSymbolsTable,
  getCodeIndexEmbedSpec,
  CHUNK_TARGET_CHARS,
  CHUNK_OVERLAP_CHARS,
  EMBED_BATCH,
  MAX_FILES_PER_RUN,
  STALE_RUNNING_MINUTES,
  EXPLICIT_STALE_SECONDS,
  EMBED_TIMEOUT_MS,
  MAX_FILE_BYTES,
  nowUnix,
  embedForIndex,
  shouldAbortFullIndexForFailures,
  notifyCodeIndexPush,
  notifyCodeIndexJobTerminal,
  resolveTenantIdForWorkspace,
  estimateTokens,
  chunkFileContent,
  buildCodeVectorizeId,
  contentHash16,
  vectorLiteral,
  mapPool,
  deleteChunksForFile,
  upsertChunkRow,
  isVectorizeRateLimitError,
  sleepMs,
  upsertCodeVector,
  updateVectorizeRegistry,
  deleteCodeVectors,
} from './code-indexer-shared.js';
export {
  resolveGithubTokenForJob,
  resolveGithubDefaultBranch,
  resolveGithubHeadSha,
  loadRepoSnapshot,
  loadRepoCompareSnapshot,
  listRepoFiles,
  fetchRepoFile,
  loadRepoSnapshotAtSha,
  recoverPurgedFileManifest,
} from './code-indexer-github.js';

export {
  loadJobColumns,
  patchJob,
  parseJsonObject,
  fullStageSummary,
  carryForwardPriorArtifacts,
  shouldSkipUnchangedFile,
  MANIFEST_CHECKPOINT_SOFT_MAX_BYTES,
  compactCallSites,
  compactImportBindings,
  normalizeManifestInPlace,
  slimFileEntryForD1,
  slimManifestForD1,
  slimReceiptsForSummary,
  slimSymbolSummaryForD1,
  loadJobStructuralQualityRollup,
  callGraphSidecarKey,
  extractCallGraphFromManifest,
  persistCallGraphSidecar,
  hydrateCallGraphOntoManifest,
  serializeManifestForD1,
  isJobCancelled,
  patchCheckpoint,
  embedSymbolsSkipInvariant,
  mergeRemovedPaths,
  logFullIndexTerminal,
} from './code-indexer-job-state.js';

export {
  symbolEmbedText,
  deleteFullFileArtifacts,
  findIndexedGitBlobSha,
  countPgArtifactsForFile,
  relinkPgArtifactsToJob,
  relinkNodesToJob,
  symbolAlreadyEmbedded,
  markSymbolEmbeddedInD1,
  clearSymbolEmbeddedInD1,
  hydrateEmbeddedAtFromPg,
  stampSymbolRunId,
  insertFullNodes,
  upsertFullSymbolRow,
} from './code-indexer-symbols.js';

export {
  evaluateSymbolCountMismatch,
  pruneCodeVectorizeForActivate,
  verifyAndActivateFullRun,
  finalizeCallsBackfillFullRun,
} from './code-indexer-verify.js';

export { runParseChunksStage } from './code-indexer-parse.js';
export { runEmbedSymbolsStage } from './code-indexer-embed.js';
export { runFullCodeIndexJob } from './code-indexer-full-run.js';
export { runCodeIndexJob } from './code-indexer-dispatch.js';

import {
  FULL_FILES_PER_RUN,
  FULL_FILES_CAP,
  FULL_SYMBOLS_PER_RUN,
  FULL_SYMBOLS_CAP,
  STALE_RUNNING_MINUTES,
  EXPLICIT_STALE_SECONDS,
} from './code-indexer-shared.js';
import { runCodeIndexJob } from './code-indexer-dispatch.js';

export async function pumpFullCodeIndexRun(env, runId, opts = {}) {
  const id = runId != null ? String(runId).trim() : '';
  if (!id) return { ok: false, error: 'run_id_required' };
  if (env?.DB) {
    // waitUntil often dies mid-batch and leaves status=running; reclaim before pumping.
    await env.DB.prepare(
      `UPDATE agentsam_code_index_job
          SET status = 'idle', triggered_by = 'stale_recovery'
        WHERE id = ?
          AND status = 'running'
          AND updated_at < unixepoch() - ${EXPLICIT_STALE_SECONDS}`,
    )
      .bind(id)
      .run()
      .catch(() => null);
  }
  const maxRounds = Math.max(1, Math.min(Number(opts.maxRounds) || 6, 24));
  const wallBudgetMs = Math.max(8_000, Math.min(Number(opts.wallBudgetMs) || 28_000, 55_000));
  const deadline = Date.now() + wallBudgetMs;
  const rounds = [];
  for (let i = 0; i < maxRounds; i += 1) {
    if (Date.now() >= deadline) break;
    const out = await runCodeIndexJob(env, id, {
      maxFiles: Math.max(1, Math.min(Number(opts.maxFiles) || FULL_FILES_PER_RUN, FULL_FILES_CAP)),
      maxSymbols: Math.max(1, Math.min(Number(opts.maxSymbols) || FULL_SYMBOLS_PER_RUN, FULL_SYMBOLS_CAP)),
      cpuBudgetMs: Math.max(5_000, Math.min(Number(opts.cpuBudgetMs) || 40_000, 55_000)),
    });
    rounds.push(out);
    if (out?.cancelled || out?.complete) break;
    if (out?.skipped && out?.reason === 'job_not_idle') break;
    if (out?.resume !== true) break;
  }
  return {
    ok: true,
    run_id: id,
    rounds: rounds.length,
    last: rounds.length ? rounds[rounds.length - 1] : null,
  };
}

export async function runPendingCodeIndexJob(env, opts = {}) {
  let jobId = opts.jobId != null ? String(opts.jobId).trim() : null;
  if (env?.DB) {
    await env.DB.prepare(
      `UPDATE agentsam_code_index_job
          SET status = 'idle', triggered_by = 'stale_recovery'
        WHERE status = 'running'
          AND COALESCE(source_type, '') NOT IN ('ast_rag', 'ast_symbol_reembed')
          AND updated_at < unixepoch() - (${STALE_RUNNING_MINUTES} * 60)`,
    )
      .run()
      .catch(() => null);

    // Targeted reclaim for operator kicks — waitUntil often dies ~30s after 1 file
    // and leaves status=running, which made every poll return job_not_idle.
    if (jobId) {
      await env.DB.prepare(
        `UPDATE agentsam_code_index_job
            SET status = 'idle', triggered_by = 'stale_recovery'
          WHERE id = ?
            AND status = 'running'
            AND updated_at < unixepoch() - ${EXPLICIT_STALE_SECONDS}`,
      )
        .bind(jobId)
        .run()
        .catch(() => null);
    }
  }
  if (!jobId && opts.workspaceId && env?.DB) {
    const ws = String(opts.workspaceId).trim();
    const row = await env.DB.prepare(
      `SELECT id FROM agentsam_code_index_job
        WHERE status = 'idle'
          AND COALESCE(workspace_id, '') = ?
          AND COALESCE(source_type, '') NOT IN ('ast_rag', 'ast_symbol_reembed')
        ORDER BY rowid
        LIMIT 1`,
    )
      .bind(ws)
      .first()
      .catch(() => null);
    jobId = row?.id != null ? String(row.id) : null;
    if (!jobId) return { ok: true, skipped: true, reason: 'no_idle_job', workspace_id: ws };
  }
  return runCodeIndexJob(env, jobId, opts);
}

