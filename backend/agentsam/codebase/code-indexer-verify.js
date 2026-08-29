/**
 * Code indexer — verify gate, activate prune, calls_backfill finalize.
 */
import { runCodeIndexPgQuery } from './code-index-write-pipe.js';
import {
  resolveCodeIndexLaneConfig,
  requireCodeIndexLaneConfig,
} from './code-index-lane-resolve.js';
import {
  normalizeCodeIndexMode,
  normalizeFullGitSha,
  FULL_INDEX_PIPELINE,
  INCREMENTAL_INDEX_MODE,
} from './codebase-full-index.js';
import { pruneDepEdgesForActivate, writeDepEdgesForIndexJob } from './codebase-dep-edges.js';
import { pumpCallsEdgesBackfill } from './codebase-calls-edges.js';
import { purgeOrphanedCodeIndexJobs } from './code-index-job-files.js';
import {
  activateCodeIndexGeneration,
  resolveJobIndexGenerationId,
} from './code-index-generation.js';
import {
  loadCodeIndexKeepFilePaths,
  purgeOrphanCodeIndexVectorsByKeepPaths,
} from './code-indexer-orphan-vectors.js';
import { rollupJobStructuralQuality } from './codebase-structural-quality-rollup.js';
import {
  nowUnix,
  buildCodeVectorizeId,
  deleteCodeVectors,
  updateVectorizeRegistry,
  notifyCodeIndexPush,
  notifyCodeIndexJobTerminal,
} from './code-indexer-shared.js';
import {
  patchJob,
  slimSymbolSummaryForD1,
  slimManifestForD1,
  serializeManifestForD1,
  hydrateCallGraphOntoManifest,
  mergeRemovedPaths,
  loadJobStructuralQualityRollup,
  logFullIndexTerminal,
  isJobCancelled,
  patchCheckpoint,
  embedSymbolsSkipInvariant,
} from './code-indexer-job-state.js';

export function evaluateSymbolCountMismatch(symbols, embeddableNodes, opts = {}) {
  const sym = Math.max(0, Number(symbols) || 0);
  const emb = Math.max(0, Number(embeddableNodes) || 0);
  if (emb <= 0) {
    return { ok: true, delta: 0, allowed: 0, soft: false, failure: null };
  }
  const abs = Math.max(0, Number(opts.abs) || 25);
  const ratio = Math.max(0, Number(opts.ratio) || 0.002);
  const allowed = Math.max(abs, Math.ceil(emb * ratio));
  const delta = Math.abs(sym - emb);
  if (delta === 0) {
    return { ok: true, delta: 0, allowed, soft: false, failure: null };
  }
  if (delta <= allowed) {
    return { ok: true, delta, allowed, soft: true, failure: null };
  }
  return {
    ok: false,
    delta,
    allowed,
    soft: false,
    failure: `symbol_count_mismatch:${sym}/${emb}`,
  };
}

export async function pruneCodeVectorizeForActivate(env, opts) {
  await resolveCodeIndexLaneConfig(env);
  const chunksTable = requireCodeIndexLaneConfig(env).tables.chunks;
  const workspaceId = String(opts.workspaceId || '').trim();
  const workspaceUuid = String(opts.workspaceUuid || '').trim();
  const repoFullName = String(opts.repoFullName || '').trim();
  const jobId = String(opts.jobId || '').trim();
  const explicit = mergeRemovedPaths(opts.removedPaths, null);

  /** @type {{ file_path?: string, chunk_index?: number }[]} */
  let rows = [];
  if (explicit.length) {
    const pg = await runCodeIndexPgQuery(
      env,
      `SELECT file_path, chunk_index
         FROM agentsam.${chunksTable}
        WHERE workspace_id = $1::uuid
          AND COALESCE(metadata->>'repo_full_name', '') = $2
          AND file_path = ANY($3::text[])`,
      [workspaceUuid, repoFullName, explicit],
    );
    if (!pg.ok) {
      return {
        ok: false,
        order: 'select_before_pg_delete',
        removed_paths: explicit,
        vectorize_delete_attempted: 0,
        vectorize_delete_deleted: 0,
        vectorize_delete_soft_fails: 0,
        error: pg.error || 'vectorize_prune_select_failed',
      };
    }
    rows = pg.rows || [];
  } else {
    // Set-diff: paths with non-current run_id that have no current-run row.
    const pg = await runCodeIndexPgQuery(
      env,
      `SELECT c.file_path, c.chunk_index
         FROM agentsam.${chunksTable} c
        WHERE c.workspace_id = $1::uuid
          AND COALESCE(c.metadata->>'repo_full_name', '') = $2
          AND COALESCE(c.metadata->>'run_id', '') <> $3
          AND NOT EXISTS (
            SELECT 1 FROM agentsam.${chunksTable} cur
             WHERE cur.workspace_id = c.workspace_id
               AND cur.file_path = c.file_path
               AND COALESCE(cur.metadata->>'run_id', '') = $3
          )`,
      [workspaceUuid, repoFullName, jobId],
    );
    if (!pg.ok) {
      return {
        ok: false,
        order: 'select_before_pg_delete',
        removed_paths: [],
        vectorize_delete_attempted: 0,
        vectorize_delete_deleted: 0,
        vectorize_delete_soft_fails: 0,
        error: pg.error || 'vectorize_prune_select_failed',
      };
    }
    rows = pg.rows || [];
  }

  const removedPaths = mergeRemovedPaths(
    explicit,
    rows.map((r) => r.file_path),
  );
  const idSet = new Set();
  for (const row of rows) {
    const fp = row?.file_path != null ? String(row.file_path).trim() : '';
    if (!fp) continue;
    const idx = Number(row.chunk_index);
    const chunkIndex = Number.isFinite(idx) ? idx : 0;
    idSet.add(await buildCodeVectorizeId(workspaceId, fp, chunkIndex));
  }
  const ids = [...idSet];
  const del = await deleteCodeVectors(env, ids);
  return {
    ok: true,
    order: 'select_before_pg_delete',
    removed_paths: removedPaths,
    removed_path_count: removedPaths.length,
    chunk_rows_selected: rows.length,
    vectorize_delete_attempted: del.attempted,
    vectorize_delete_deleted: del.deleted,
    vectorize_delete_soft_fails: del.soft_fails,
    ...(del.skipped ? { vectorize_delete_skipped: del.skipped } : {}),
  };
}

export async function verifyAndActivateFullRun(env, job, workspaceUuid, manifest, summary, cols) {
  await resolveCodeIndexLaneConfig(env);
  const { chunks: chunksTable, symbols: symbolsTable } = requireCodeIndexLaneConfig(env).tables;
  const workspaceId = String(job.workspace_id);
  const repoFullName = String(job.repo_full_name || '');
  const indexGenerationId = resolveJobIndexGenerationId({
    id: job.id,
    index_generation_id:
      job.index_generation_id ||
      manifest.index_generation_id ||
      summary.index_generation_id ||
      null,
  });
  const runMode = normalizeCodeIndexMode(manifest.mode || summary.mode || 'full');
  const priorVerify =
    summary?.stages?.verify && typeof summary.stages.verify === 'object'
      ? summary.stages.verify
      : null;
  // Activate resume: verify already checkpointed — do not re-compare (and do not
  // require a new verify.at). Soft-allow + edge work must survive isolate kills.
  const verifyAlreadyOk =
    String(summary.stage || '') === 'activate' && priorVerify?.ok === true;

  let verifyReceipt = priorVerify;
  let symbols = Number(priorVerify?.pg_symbols) || 0;
  let chunks = Number(priorVerify?.pg_chunks) || 0;
  let linkedChunks = Number(priorVerify?.linked_chunks) || 0;
  let d1Nodes = Number(priorVerify?.d1_nodes) || 0;
  let removedPaths = Array.isArray(priorVerify?.removed_paths)
    ? priorVerify.removed_paths.map((p) => String(p))
    : Array.isArray(manifest.removed_paths)
      ? manifest.removed_paths.map((p) => String(p))
      : [];

  if (!verifyAlreadyOk) {
    const d1 = await env.DB.prepare(
      `SELECT COUNT(*) AS nodes, COUNT(DISTINCT file_path) AS files
         FROM codebase_ast_nodes WHERE workspace_id = ? AND repo_full_name = ? AND index_job_id = ?`,
    )
      .bind(workspaceId, repoFullName, job.id)
      .first();
    const pgSymbols = await runCodeIndexPgQuery(
      env,
      `SELECT COUNT(*)::int AS c FROM agentsam.${symbolsTable}
        WHERE workspace_id = $1::uuid AND repo_full_name = $2 AND metadata->>'run_id' = $3`,
      [workspaceUuid, repoFullName, job.id],
    );
    const pgChunks = await runCodeIndexPgQuery(
      env,
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE node_id IS NOT NULL)::int AS linked
         FROM agentsam.${chunksTable}
        WHERE workspace_id = $1::uuid AND metadata->>'run_id' = $2`,
      [workspaceUuid, job.id],
    );
    if (!pgSymbols.ok || !pgChunks.ok) {
      throw new Error(pgSymbols.error || pgChunks.error || 'verify_hyperdrive_failed');
    }

    const expectedFiles = Array.isArray(manifest.files) ? manifest.files.length : 0;
    const structuralFiles = (manifest.files || []).filter(
      (file) => file.classification === 'structural_and_chunks',
    ).length;
    d1Nodes = Number(d1?.nodes) || 0;
    symbols = Number(pgSymbols.rows?.[0]?.c) || 0;
    chunks = Number(pgChunks.rows?.[0]?.total) || 0;
    linkedChunks = Number(pgChunks.rows?.[0]?.linked) || 0;
    const indexedFiles = Number(job.indexed_file_count) || expectedFiles;
    const failedFileCount = Math.max(0, Number(job.failed_file_count) || 0);
    const failureRate =
      expectedFiles > 0 ? failedFileCount / Math.max(1, expectedFiles) : failedFileCount > 0 ? 1 : 0;
    const isIncremental = runMode === INCREMENTAL_INDEX_MODE;
    removedPaths = Array.isArray(manifest.removed_paths)
      ? manifest.removed_paths.map((p) => String(p))
      : [];
    const failures = [];
    if (!manifest.revision_sha || !/^[a-f0-9]{40}$/i.test(String(manifest.revision_sha))) {
      failures.push('revision_sha_missing');
    }
    if (isIncremental) {
      if (!manifest.base_sha || !/^[a-f0-9]{40}$/i.test(String(manifest.base_sha))) {
        failures.push('incremental_base_sha_missing');
      }
      if (String(manifest.discovery || '') !== 'compare') {
        failures.push('incremental_discovery_not_compare');
      }
      // No-op / deletes-only incremental: carried artifacts must still be present on this run.
      if (expectedFiles <= 0 && chunks <= 0 && symbols <= 0 && d1Nodes <= 0) {
        failures.push('incremental_noop_empty_index');
      }
    } else if (expectedFiles <= 0) {
      failures.push('crawl_found_no_indexable_files');
    }
    if (indexedFiles < expectedFiles) failures.push(`files_incomplete:${indexedFiles}/${expectedFiles}`);
    // Soft degradation under 5%: allow activate. Absolute any-failure kill blocked large-repo greens.
    if (failureRate >= 0.05) {
      failures.push(`failure_rate_too_high:${Math.round(failureRate * 100)}pct`);
    }
    if (chunks <= 0) failures.push('chunks_missing');
    const symbolsWrittenSum = (manifest.files || []).reduce(
      (n, f) => n + (Number(f.symbols_written) || 0),
      0,
    );
    const parseFailedFiles = (manifest.files || []).filter(
      (f) =>
        f?.structural_quality === 'parse_failed' ||
        f?.parse_error ||
        String(f?.status || '').includes('parse_failed'),
    ).length;
    if (structuralFiles > 0 && d1Nodes <= 0) {
      failures.push(
        `structural_nodes_missing:d1=0;structural_files=${structuralFiles};symbols_written_sum=${symbolsWrittenSum};parse_failed_files=${parseFailedFiles};pg_chunks=${chunks};pg_symbols=${symbols};hint=${
          parseFailedFiles > 0 || symbolsWrittenSum <= 0
            ? 'structural_parse_produced_zero_nodes'
            : 'ast_nodes_not_in_d1'
        }`,
      );
    }
    // Symbols only required for embed-eligible nodes (imports / non-exported const are structure-only).
    const embeddableRow = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM codebase_ast_nodes
        WHERE index_job_id = ?
          AND NOT (
            node_type = 'import'
            OR (node_type IN ('const', 'variable') AND COALESCE(is_exported, 0) = 0)
          )`,
    )
      .bind(job.id)
      .first();
    const embeddableNodes = Number(embeddableRow?.c) || 0;
    const symbolMismatch = evaluateSymbolCountMismatch(symbols, embeddableNodes);
    if (!symbolMismatch.ok && symbolMismatch.failure) {
      failures.push(symbolMismatch.failure);
    }

    verifyReceipt = {
      at: new Date().toISOString(),
      ok: failures.length === 0,
      mode: runMode,
      discovery: manifest.discovery || null,
      revision_sha: manifest.revision_sha,
      base_sha: manifest.base_sha || null,
      expected_files: expectedFiles,
      indexed_files: indexedFiles,
      changed_count: manifest.changed_count != null ? Number(manifest.changed_count) : expectedFiles,
      removed_paths: removedPaths,
      failed_files: failedFileCount,
      failure_rate: Math.round(failureRate * 1000) / 1000,
      d1_nodes: d1Nodes,
      embeddable_nodes: embeddableNodes,
      pg_symbols: symbols,
      pg_chunks: chunks,
      linked_chunks: linkedChunks,
      symbols_written_sum: symbolsWrittenSum,
      parse_failed_files: parseFailedFiles,
      symbol_mismatch_delta: symbolMismatch.delta,
      symbol_mismatch_allowed: symbolMismatch.allowed,
      symbol_mismatch_soft: symbolMismatch.soft === true,
      failures,
    };
    if (failures.length) {
      const failedSummary = slimSymbolSummaryForD1({
        ...summary,
        stage: 'verify_failed',
        readiness: 'failed',
        stages: { ...summary.stages, verify: verifyReceipt },
      });
      await patchJob(
        env,
        job.id,
        {
          status: 'failed',
          last_error: failures.join('; ').slice(0, 500),
          symbol_summary: JSON.stringify(failedSummary),
          finished_at: nowUnix(),
        },
        cols,
      );
      await logFullIndexTerminal(env, {
        outcome: 'failed',
        jobId: job.id,
        workspaceId,
        repoFullName,
        revisionSha: manifest.revision_sha || null,
        stage: 'verify_failed',
        error: failures.join('; '),
        verify: verifyReceipt,
        context: {
          d1_nodes: d1Nodes,
          pg_symbols: symbols,
          pg_chunks: chunks,
          linked_chunks: linkedChunks,
          failed_files: failedFileCount,
        },
      });
      return { ok: false, error: 'full_index_verify_failed', run_id: job.id, verify: verifyReceipt };
    }

    // CRITICAL: persist verify success BEFORE edge/activate work. Isolate kills during
    // writeDepEdges / calls used to leave stages.verify.at frozen at the old failure —
    // looking like "verify never re-ran" even when soft-allow already passed in memory.
    const verifiedSummary = slimSymbolSummaryForD1({
      ...summary,
      stage: 'activate',
      readiness: 'verified',
      stages: { ...summary.stages, verify: verifyReceipt },
    });
    await patchJob(
      env,
      job.id,
      {
        status: 'running',
        last_error: null,
        symbol_count: symbols,
        chunk_count: chunks,
        symbol_summary: JSON.stringify(verifiedSummary),
      },
      cols,
    );
    summary = verifiedSummary;
  }

  // LOCKED: Vectorize SELECT→deleteByIds BEFORE any PG chunk/symbol DELETE.
  const explicitRemoved = mergeRemovedPaths(
    summary?.stages?.crawl?.removed_paths ||
      summary?.stages?.parse_chunks?.removed_paths ||
      manifest?.removed_paths ||
      null,
    null,
  );
  let vectorizePrune;
  let edgeCounts = {
    edges_written: 0,
    external: 0,
    unresolved: 0,
    import_sites: 0,
    edge_scope: 'full',
  };
  let callEdgeCounts = {
    calls_written: 0,
    calls_unresolved: 0,
    calls_ambiguous: 0,
    calls_dynamic_skipped: 0,
  };
  let preferDelta = false;
  try {
    vectorizePrune = await pruneCodeVectorizeForActivate(env, {
      workspaceId,
      workspaceUuid,
      repoFullName,
      jobId: job.id,
      removedPaths: explicitRemoved.length ? explicitRemoved : null,
    });

    // Atomic-enough interim activation: verified current-run rows become the only active repo rows.
    // Edges first (FK → nodes), then nodes, then PG prune.
    // writeDepEdgesForIndexJob prunes other jobs BEFORE insert (UNIQUE is global) + durable COUNT gate.
    const changedPaths = mergeRemovedPaths(
      summary?.stages?.crawl?.changed_paths ||
        summary?.stages?.parse_chunks?.changed_paths ||
        manifest?.changed_paths ||
        null,
      vectorizePrune.removed_paths,
    );
    const jobMode = String(summary?.mode || manifest?.mode || 'full').toLowerCase();
    preferDelta =
      jobMode === 'incremental' &&
      (changedPaths.length > 0 ||
        explicitRemoved.length > 0 ||
        (vectorizePrune.removed_path_count || 0) > 0);
    edgeCounts.edge_scope = preferDelta ? 'delta' : 'full';

    const manifestFiles = (manifest.files || [])
      .map((f) => (f?.path != null ? String(f.path) : ''))
      .filter(Boolean);
    edgeCounts = await writeDepEdgesForIndexJob(env, job, {
      repoFiles: manifestFiles,
      edgeScope: preferDelta ? 'delta' : 'full',
      changedPaths: preferDelta ? changedPaths : undefined,
      removedPaths: preferDelta ? vectorizePrune.removed_paths : undefined,
    });
    // Level 2 (calls) is sharded via stage=calls_backfill — never monolith-load here.
    callEdgeCounts = {
      calls_written: 0,
      calls_unresolved: 0,
      calls_ambiguous: 0,
      calls_dynamic_skipped: 0,
      deferred: 'calls_backfill_stage',
    };
    // Belt-and-suspenders: writer already pruned-before-write; keep activate prune for races.
    // Generation-scoped only — never wipe ACTIVE generation A's edges while B activates.
    await pruneDepEdgesForActivate(env, workspaceId, repoFullName, job.id, {
      index_generation_id: indexGenerationId,
    });
  } catch (activateErr) {
    // Keep verify checkpoint; park idle so MY_QUEUE reclaim can retry activate only.
    const msg = String(activateErr?.message || activateErr).slice(0, 500);
    const parked = slimSymbolSummaryForD1({
      ...summary,
      stage: 'activate',
      readiness: 'verified',
      stages: {
        ...(summary.stages && typeof summary.stages === 'object' ? summary.stages : {}),
        verify: verifyReceipt,
        activate: {
          at: new Date().toISOString(),
          ok: false,
          error: msg,
          retryable: true,
        },
      },
    });
    await patchJob(
      env,
      job.id,
      {
        status: 'idle',
        last_error: msg,
        symbol_summary: JSON.stringify(parked),
      },
      cols,
    ).catch(() => null);
    return {
      ok: false,
      resume: true,
      error: msg,
      run_id: job.id,
      job_id: job.id,
      stage: 'activate',
      verify: verifyReceipt,
    };
  }
  // Incremental activate: prune removed paths only. Never job-id-exclusive wipe —
  // that collapsed live coverage when carry-forward returned 0 (ticket
  // tkt_code_index_incremental_carry_activate_d665e2c87d1e).
  const D1_IN_CHUNK = 40;
  let pruneChunks;
  let pruneSymbols;
  let orphanPurge = {
    ok: true,
    purged_jobs: 0,
    purged_files: 0,
    job_ids: [],
    skipped: runMode === INCREMENTAL_INDEX_MODE ? 'incremental_delta_prune' : null,
  };
  if (runMode === INCREMENTAL_INDEX_MODE) {
    for (let i = 0; i < removedPaths.length; i += D1_IN_CHUNK) {
      const chunk = removedPaths.slice(i, i + D1_IN_CHUNK).filter(Boolean);
      if (!chunk.length) continue;
      const ph = chunk.map(() => '?').join(',');
      await env.DB.prepare(
        `DELETE FROM codebase_ast_nodes
          WHERE workspace_id = ? AND repo_full_name = ?
            AND index_generation_id = ?
            AND file_path IN (${ph})`,
      )
        .bind(workspaceId, repoFullName, indexGenerationId, ...chunk)
        .run();
      pruneChunks = await runCodeIndexPgQuery(
        env,
        `DELETE FROM agentsam.${chunksTable}
          WHERE workspace_id = $1::uuid
            AND index_generation_id = $2
            AND COALESCE(metadata->>'repo_full_name', '') = $3
            AND file_path = ANY($4::text[])`,
        [workspaceUuid, indexGenerationId, repoFullName, chunk],
      );
      if (!pruneChunks.ok) throw new Error(pruneChunks.error || 'activate_chunk_prune_failed');
      pruneSymbols = await runCodeIndexPgQuery(
        env,
        `DELETE FROM agentsam.${symbolsTable}
          WHERE workspace_id = $1::uuid AND repo_full_name = $2
            AND index_generation_id = $3
            AND file_path = ANY($4::text[])`,
        [workspaceUuid, repoFullName, indexGenerationId, chunk],
      );
      if (!pruneSymbols.ok) throw new Error(pruneSymbols.error || 'activate_symbol_prune_failed');
    }
    if (!removedPaths.length) {
      pruneChunks = { ok: true, skipped: 'incremental_no_removed_paths' };
      pruneSymbols = { ok: true, skipped: 'incremental_no_removed_paths' };
    }
  } else {
    // Full activate: prune sibling attempts for THIS generation only — keep prior ACTIVE gen A.
    await env.DB.prepare(
      `DELETE FROM codebase_ast_nodes
        WHERE workspace_id = ? AND repo_full_name = ?
          AND index_generation_id = ?
          AND COALESCE(index_job_id, '') <> ?`,
    )
      .bind(workspaceId, repoFullName, indexGenerationId, job.id)
      .run();
    // Nodes for dead siblings are gone — drop their job + job_file residue (not "audit").
    orphanPurge = await purgeOrphanedCodeIndexJobs(env, {
      workspaceId,
      repoFullName,
      keepJobId: job.id,
    }).catch((e) => ({
      ok: false,
      purged_jobs: 0,
      purged_files: 0,
      job_ids: [],
      error: String(e?.message || e),
    }));
    if (orphanPurge?.ok === false) {
      console.warn('[code-indexer] orphan_job_purge_soft_fail', orphanPurge.error || orphanPurge);
    } else if ((orphanPurge?.purged_jobs || 0) > 0) {
      console.warn('[code-indexer] orphan_job_purge', {
        jobId: job.id,
        purged_jobs: orphanPurge.purged_jobs,
        purged_files: orphanPurge.purged_files,
      });
    }
    pruneChunks = await runCodeIndexPgQuery(
      env,
      `DELETE FROM agentsam.${chunksTable}
        WHERE workspace_id = $1::uuid
          AND index_generation_id = $2
          AND COALESCE(metadata->>'repo_full_name', '') = $3
          AND COALESCE(metadata->>'run_id', '') <> $4`,
      [workspaceUuid, indexGenerationId, repoFullName, job.id],
    );
    if (!pruneChunks.ok) throw new Error(pruneChunks.error || 'activate_chunk_prune_failed');
    pruneSymbols = await runCodeIndexPgQuery(
      env,
      `DELETE FROM agentsam.${symbolsTable}
        WHERE workspace_id = $1::uuid AND repo_full_name = $2
          AND index_generation_id = $3
          AND COALESCE(metadata->>'run_id', '') <> $4`,
      [workspaceUuid, repoFullName, indexGenerationId, job.id],
    );
    if (!pruneSymbols.ok) throw new Error(pruneSymbols.error || 'activate_symbol_prune_failed');
  }

  // Manifest keep-set purge: delete PG vectors for file_paths not in this job's inventory.
  // Covers orphans left when prior runs never activated, and incomplete removed_paths.
  const manifestKeep = (manifest.files || [])
    .map((f) => (f?.path != null ? String(f.path).trim() : ''))
    .filter(Boolean);
  const keepPaths = await loadCodeIndexKeepFilePaths(env, {
    jobId: job.id,
    paths: manifestKeep,
  });
  let stalePathPurge = { ok: true, deleted_paths: 0, skipped: keepPaths.length ? null : 'keep_paths_empty' };
  if (keepPaths.length) {
    stalePathPurge = await purgeOrphanCodeIndexVectorsByKeepPaths(env, {
      workspaceUuid,
      repoFullName,
      keepPaths,
      jobId: job.id,
    });
    if (!stalePathPurge.ok) {
      throw new Error(stalePathPurge.error || 'orphan_keep_path_purge_failed');
    }
  } else {
    console.warn('[code-indexer] orphan_keep_path_purge_skipped', {
      jobId: job.id,
      reason: 'keep_paths_empty',
    });
  }

  const vectorizeSoftFails = Number(summary.stages?.parse_chunks?.vectorize_soft_fails) || 0;
  const embedInvariant =
    summary?.stages?.embed_symbols?.skip_invariant ||
    embedSymbolsSkipInvariant({
      symbols_relinked_estimate: Number(summary?.stages?.parse_chunks?.symbols_relinked) || 0,
      skipped_already_embedded:
        Number(summary?.stages?.embed_symbols?.skipped_already_embedded) || 0,
    });
  const importsReadyAtUnix = nowUnix();
  const importsReadyAt = new Date(importsReadyAtUnix * 1000).toISOString();
  const edgeReceipt = {
    at: importsReadyAt,
    ok: true,
    edge_scope: edgeCounts.edge_scope || (preferDelta ? 'delta' : 'full'),
    ...edgeCounts,
    ...callEdgeCounts,
  };
  // Imports durable — NOT done until Level 2 calls_backfill finishes (one-click contract).
  // Reconcile job-level quality from file receipts (queue seeds 'pending', never 'degraded').
  const qualityRollup = await loadJobStructuralQualityRollup(env, job.id);
  const interimSummary = {
    ...summary,
    stage: 'calls_backfill',
    readiness: 'imports_ready',
    activated: false,
    revision_sha: manifest.revision_sha,
    mode: runMode,
    base_sha: manifest.base_sha || null,
    calls_written: 0,
    structural_quality: qualityRollup.structural_quality,
    structural_quality_breakdown: qualityRollup.structural_quality_breakdown,
    stages: {
      ...summary.stages,
      verify: verifyReceipt,
      dep_edges: edgeReceipt,
      activate: {
        at: importsReadyAt,
        ok: true,
        awaiting_calls: true,
        strategy: 'verified_run_replaces_repo_rows',
        mode: runMode,
        discovery: manifest.discovery || null,
        base_sha: manifest.base_sha || null,
        head_sha: manifest.head_sha || manifest.revision_sha || null,
        removed_paths: removedPaths,
        removed_count: removedPaths.length,
        order: 'vectorize_select_delete_then_d1_pg_prune',
        orphan_jobs_purged: Number(orphanPurge?.purged_jobs) || 0,
        orphan_job_files_purged: Number(orphanPurge?.purged_files) || 0,
        orphan_vector_paths_purged: Number(stalePathPurge?.deleted_paths) || 0,
        orphan_vector_chunks_deleted: Number(stalePathPurge?.chunks_deleted) || 0,
        orphan_vector_symbols_deleted: Number(stalePathPurge?.symbols_deleted) || 0,
        edges_written: edgeCounts.edges_written,
        edges_external: edgeCounts.external,
        edges_unresolved: edgeCounts.unresolved,
        edge_scope: edgeReceipt.edge_scope,
        vectorize_delete_attempted: vectorizePrune.vectorize_delete_attempted || 0,
        vectorize_delete_deleted: vectorizePrune.vectorize_delete_deleted || 0,
        vectorize_delete_soft_fails: vectorizePrune.vectorize_delete_soft_fails || 0,
        removed_path_count: vectorizePrune.removed_path_count || 0,
        removed_paths_sample: (vectorizePrune.removed_paths || []).slice(0, 20),
        embed_skip_invariant: embedInvariant,
        chat_rag_vectorize:
          vectorizeSoftFails > 0 || (vectorizePrune.vectorize_delete_soft_fails || 0) > 0
            ? {
                ok: false,
                soft_fails: vectorizeSoftFails + (vectorizePrune.vectorize_delete_soft_fails || 0),
              }
            : { ok: true },
      },
      calls_backfill: {
        at: importsReadyAt,
        ok: false,
        queued: true,
        shard_index: 0,
        calls_written: 0,
      },
    },
  };
  const relationshipQuality =
    edgeCounts.edges_written > 0
      ? edgeCounts.unresolved > 0
        ? 'partial_imports'
        : 'imports_v1'
      : 'unavailable';
  await patchJob(
    env,
    job.id,
    {
      status: 'idle',
      progress_percent: 92,
      symbol_count: symbols,
      chunk_count: chunks,
      last_error: null,
      last_sync_at: importsReadyAtUnix,
      completed_at: null,
      finished_at: null,
      revision_sha: normalizeFullGitSha(manifest.revision_sha),
      base_sha: normalizeFullGitSha(manifest.base_sha),
      symbol_summary: JSON.stringify(interimSummary),
      dependency_summary: JSON.stringify({
        run_id: job.id,
        revision_sha: manifest.revision_sha,
        relationship_quality: relationshipQuality,
        edge_scope: edgeReceipt.edge_scope,
        edges_written: edgeCounts.edges_written,
        edges_durable: edgeCounts.edges_durable ?? edgeCounts.edges_written,
        external: edgeCounts.external,
        unresolved: edgeCounts.unresolved,
        import_sites: edgeCounts.import_sites,
        edge_types: ['imports', 're_exports'],
        prune_before_write: true,
        awaiting_calls: true,
      }),
    },
    cols,
  );
  return {
    ok: true,
    complete: false,
    resume: true,
    run_id: job.id,
    job_id: job.id,
    pipeline: FULL_INDEX_PIPELINE,
    mode: runMode,
    status: 'idle',
    stage: 'calls_backfill',
    readiness: 'imports_ready',
    revision_sha: manifest.revision_sha,
    discovery: manifest.discovery || null,
    removed_paths: removedPaths,
    verify: verifyReceipt,
    d1_nodes: d1Nodes,
    pg_symbols: symbols,
    pg_chunks: chunks,
    linked_chunks: linkedChunks,
  };
}

export async function finalizeCallsBackfillFullRun(env, job, summary, cols) {
  const workspaceId = String(job.workspace_id || '').trim();
  const repoFullName = String(job.repo_full_name || '').trim();
  const indexGenerationId = resolveJobIndexGenerationId({
    id: job.id,
    index_generation_id: job.index_generation_id || summary.index_generation_id || null,
  });
  const step = await pumpCallsEdgesBackfill(env, job.id, {
    wallBudgetMs: 45_000,
    maxShardsPerPump: 3,
  });
  if (!step.ok) {
    const msg = String(step.error || 'calls_backfill_failed').slice(0, 500);
    await patchJob(
      env,
      job.id,
      {
        status: 'idle',
        last_error: msg,
        symbol_summary: JSON.stringify({
          ...summary,
          stage: 'calls_backfill',
          readiness: 'imports_ready',
          activated: false,
          stages: {
            ...(summary.stages && typeof summary.stages === 'object' ? summary.stages : {}),
            calls_backfill: {
              ...(summary.stages?.calls_backfill || {}),
              at: new Date().toISOString(),
              ok: false,
              error: msg,
            },
          },
        }),
      },
      cols,
    ).catch(() => null);
    return {
      ok: false,
      resume: true,
      error: msg,
      run_id: job.id,
      job_id: job.id,
      stage: 'calls_backfill',
    };
  }
  if (!step.complete) {
    await patchJob(
      env,
      job.id,
      {
        status: 'idle',
        progress_percent: Math.min(
          99,
          92 +
            Math.floor(
              (Math.max(0, Number(step.next_shard_index) || 0) /
                Math.max(1, Number(step.total_shards) || 1)) *
                7,
            ),
        ),
        last_error: null,
      },
      cols,
    ).catch(() => null);
    return {
      ok: true,
      complete: false,
      resume: true,
      run_id: job.id,
      job_id: job.id,
      stage: 'calls_backfill',
      calls_written: step.calls_written || 0,
      next_shard_index: step.next_shard_index,
      total_shards: step.total_shards,
    };
  }

  const activatedAtUnix = nowUnix();
  const activatedAt = new Date(activatedAtUnix * 1000).toISOString();
  const callsWritten = Math.max(0, Number(step.calls_written) || 0);
  let dep = {};
  try {
    dep = job.dependency_summary != null ? JSON.parse(String(job.dependency_summary)) : {};
  } catch {
    dep = {};
  }
  // Call-graph is required quality — never mark activated/completed without it.
  if (step.sidecar_missing === true || callsWritten <= 0) {
    const msg =
      step.sidecar_missing === true ? 'calls_sidecar_missing' : 'calls_graph_empty';
    const failedSummary = slimSymbolSummaryForD1({
      ...summary,
      stage: 'calls_backfill',
      readiness: 'failed',
      activated: false,
      calls_written: callsWritten,
      stages: {
        ...(summary.stages && typeof summary.stages === 'object' ? summary.stages : {}),
        calls_backfill: {
          at: activatedAt,
          ok: false,
          error: msg,
          calls_written: callsWritten,
          sidecar_missing: step.sidecar_missing === true,
          shard_index: Number(step.total_shards) || 0,
          total_shards: Number(step.total_shards) || 0,
          total_files: Number(step.total_files) || 0,
        },
        activate: {
          ...(summary.stages?.activate && typeof summary.stages.activate === 'object'
            ? summary.stages.activate
            : {}),
          awaiting_calls: false,
          calls_written: callsWritten,
          ok: false,
          error: msg,
        },
      },
    });
    await patchJob(
      env,
      job.id,
      {
        status: 'failed',
        progress_percent: 99,
        last_error: msg,
        finished_at: activatedAtUnix,
        symbol_summary: JSON.stringify(failedSummary),
        dependency_summary: JSON.stringify({
          ...dep,
          relationship_quality: 'imports_v1',
          calls_written: callsWritten,
          awaiting_calls: false,
          edge_types: ['imports', 're_exports'],
        }),
      },
      cols,
    );
    await logFullIndexTerminal(env, {
      outcome: 'failed',
      jobId: job.id,
      workspaceId,
      repoFullName,
      revisionSha: summary.revision_sha || null,
      stage: 'calls_backfill',
      error: msg,
      verify: summary.stages?.verify || null,
      context: { calls_written: callsWritten, sidecar_missing: step.sidecar_missing === true },
    });
    return {
      ok: false,
      complete: true,
      error: msg,
      run_id: job.id,
      job_id: job.id,
      pipeline: FULL_INDEX_PIPELINE,
      status: 'failed',
      stage: 'calls_backfill',
      calls_written: callsWritten,
    };
  }

  const relationshipQuality = 'imports_and_calls_v1';
  const readiness = 'ready';
  const qualityRollup = await loadJobStructuralQualityRollup(env, job.id);
  const finalSummary = {
    ...summary,
    stage: 'active',
    readiness,
    activated: true,
    activated_at: activatedAt,
    calls_written: callsWritten,
    structural_quality: qualityRollup.structural_quality,
    structural_quality_breakdown: qualityRollup.structural_quality_breakdown,
    stages: {
      ...(summary.stages && typeof summary.stages === 'object' ? summary.stages : {}),
      calls_backfill: {
        at: activatedAt,
        ok: true,
        shard_index: Number(step.total_shards) || 0,
        total_shards: Number(step.total_shards) || 0,
        total_files: Number(step.total_files) || 0,
        calls_written: callsWritten,
        sidecar_missing: false,
      },
      activate: {
        ...(summary.stages?.activate && typeof summary.stages.activate === 'object'
          ? summary.stages.activate
          : {}),
        awaiting_calls: false,
        calls_written: callsWritten,
        completed_at: activatedAt,
        readiness,
        relationship_quality: relationshipQuality,
      },
    },
  };
  await patchJob(
    env,
    job.id,
    {
      status: 'completed',
      progress_percent: 100,
      last_error: null,
      last_sync_at: activatedAtUnix,
      completed_at: activatedAtUnix,
      finished_at: activatedAtUnix,
      revision_sha: normalizeFullGitSha(
        finalSummary.revision_sha || summary.revision_sha || job.revision_sha,
      ),
      base_sha: normalizeFullGitSha(finalSummary.base_sha || summary.base_sha || job.base_sha),
      symbol_summary: JSON.stringify(finalSummary),
      dependency_summary: JSON.stringify({
        ...dep,
        relationship_quality: relationshipQuality,
        calls_written: callsWritten,
        awaiting_calls: false,
        edge_types: ['imports', 're_exports', 'calls'],
        index_generation_id: indexGenerationId,
      }),
    },
    cols,
  );
  // Last write of a green Build: flip LIVE pointer (exactly one is_active per workspace+repo).
  await activateCodeIndexGeneration(env, {
    workspaceId,
    repo_full_name: repoFullName,
    jobId: job.id,
    generationId: indexGenerationId,
    nowUnix: activatedAtUnix,
  });
  await logFullIndexTerminal(env, {
    outcome: 'completed',
    jobId: job.id,
    workspaceId,
    repoFullName,
    revisionSha: summary.revision_sha || null,
    stage: 'active',
    verify: summary.stages?.verify || null,
    context: {
      calls_written: callsWritten,
      readiness,
      relationship_quality: relationshipQuality,
      index_generation_id: indexGenerationId,
    },
  });
  return {
    ok: true,
    complete: true,
    run_id: job.id,
    job_id: job.id,
    index_generation_id: indexGenerationId,
    pipeline: FULL_INDEX_PIPELINE,
    status: 'completed',
    stage: 'active',
    readiness,
    calls_written: callsWritten,
  };
}

