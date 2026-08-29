/**
 * Code indexer — parse_chunks stage (structural parse + chunk embed).
 */
import {
  FULL_INDEX_PIPELINE,
  INCREMENTAL_INDEX_MODE,
  STRUCTURAL_PARSER_ID,
  buildFullFilePlan,
  structuralParserIdForFile,
} from './codebase-full-index.js';
import { deleteDepEdgesForFile } from './codebase-dep-edges.js';
import { upsertCodeIndexJobFiles, claimNextCodeIndexJobFileBatch, rollupCodeIndexJobFileProgress } from './code-index-job-files.js';
import {
  FULL_FILES_PER_RUN,
  FULL_FILES_CAP,
  FULL_FAIL_ABORT_ABS,
  FULL_FAIL_ABORT_RATIO,
  FULL_FAIL_ABORT_MIN_ATTEMPTED,
  nowUnix,
  embedTextsForCodeIndex,
  getCodeIndexEmbedSpec,
  shouldAbortFullIndexForFailures,
  contentHash16,
  upsertChunkRowsBatch,
  estimateTokens,
} from './code-indexer-shared.js';
import { resolveCodeIndexLaneConfig } from './code-index-lane-resolve.js';
import { fetchRepoFile } from './code-indexer-github.js';
import {
  shouldSkipUnchangedFile,
  slimFileEntryForD1,
  slimManifestForD1,
  slimSymbolSummaryForD1,
  slimReceiptsForSummary,
  serializeManifestForD1,
  isJobCancelled,
  patchCheckpoint,
  patchJob,
  MANIFEST_CHECKPOINT_SOFT_MAX_BYTES,
  compactCallSites,
  compactImportBindings,
  normalizeManifestInPlace,
  logFullIndexTerminal,
} from './code-indexer-job-state.js';
import {
  deleteFullFileArtifacts,
  findIndexedGitBlobSha,
  countPgArtifactsForFile,
  relinkPgArtifactsToJob,
  relinkNodesToJob,
  insertFullNodes,
} from './code-indexer-symbols.js';
import { resolveJobIndexGenerationId } from './code-index-generation.js';
import {
  createCodeIndexPgBatchSession,
  isCodeIndexPgTransientError,
} from './code-index-write-pipe.js';

/**
 * @param {any} env
 * @param {object} ctx
 * @returns {Promise<object>}
 */
export async function runParseChunksStage(env, ctx) {
  await resolveCodeIndexLaneConfig(env);
  const embedSpec = getCodeIndexEmbedSpec(env);
  let {
    job,
    workspaceUuid,
    workspaceId,
    tenantId,
    repoFullName,
    manifest,
    summary,
    cols,
    opts,
    jobMode,
    gh,
  } = ctx;
  repoFullName =
    (repoFullName != null && String(repoFullName).trim()) ||
    (manifest?.repo_full_name != null && String(manifest.repo_full_name).trim()) ||
    (job?.repo_full_name != null && String(job.repo_full_name).trim()) ||
    '';
  if (!repoFullName) {
    return { ok: false, error: 'repo_full_name_required', run_id: job?.id, job_id: job?.id };
  }
  const indexGenerationId = resolveJobIndexGenerationId({
    id: job?.id,
    index_generation_id:
      job?.index_generation_id ||
      manifest?.index_generation_id ||
      summary?.index_generation_id ||
      null,
  });
  const filesTotal = Math.max(
    Number(job.file_count) || 0,
    Number(manifest.files?.length) || 0,
  );
  const maxFiles = Math.max(
    1,
    Math.min(Number(opts.maxFiles) || FULL_FILES_PER_RUN, FULL_FILES_CAP),
  );
  const batch = await claimNextCodeIndexJobFileBatch(env, job.id, maxFiles);
  if (!batch.length) {
    const progress = await rollupCodeIndexJobFileProgress(env, job.id);
    const crawlComplete = progress.total > 0 && progress.pending === 0 && progress.processing === 0;
    if (crawlComplete) {
      const nodeCount = await env.DB.prepare(
        `SELECT COUNT(*) AS c FROM codebase_ast_nodes WHERE index_job_id = ?`,
      )
        .bind(job.id)
        .first();
      const nextSummary = {
        ...summary,
        mode: jobMode,
        stage: 'embed_symbols',
        stages: {
          ...summary.stages,
          parse_chunks: {
            ...(summary.stages?.parse_chunks || {}),
            at: new Date().toISOString(),
            ok: progress.failed === 0,
            complete: true,
            indexed_files: progress.processed,
            total_files: progress.total,
            failed_files: progress.failed,
          },
        },
      };
      await patchCheckpoint(
        env,
        job.id,
        {
          status: 'idle',
          indexed_file_count: progress.processed,
          failed_file_count: progress.failed,
          progress_percent: 70,
          symbol_summary: JSON.stringify(slimSymbolSummaryForD1(nextSummary)),
        },
        cols,
      );
    }
    return {
      ok: true,
      complete: crawlComplete,
      resume: !crawlComplete,
      run_id: job.id,
      job_id: job.id,
      pipeline: FULL_INDEX_PIPELINE,
      mode: jobMode,
      stage: crawlComplete ? 'embed_symbols' : 'parse_chunks',
      indexed_files: progress.processed,
      files_total: progress.total || filesTotal,
      reason: progress.total ? 'no_pending_files' : 'inventory_empty',
    };
  }
  let chunksWritten = 0;
  let skippedUnchanged = 0;
  let symbolsRelinked = 0;
  let failedFiles = Number(job.failed_file_count) || 0; // legacy counter; rollups come from job_file
  const receipts = [];

  // Reuse one session-pooler client across files; ensureClient() before each PG burst
  // (not held idle across GitHub fetch / embed — that is what kills nano sockets).
  const pgSession = createCodeIndexPgBatchSession(env);
  try {
  for (const file of batch) {
    const live = await env.DB.prepare(
      `SELECT status FROM agentsam_code_index_job WHERE id = ? LIMIT 1`,
    )
      .bind(job.id)
      .first()
      .catch(() => null);
    if (String(live?.status || '') === 'cancelled') {
      await logFullIndexTerminal(env, {
        outcome: 'cancelled',
        jobId: job.id,
        workspaceId,
        repoFullName,
        revisionSha: manifest.revision_sha || null,
        stage: String(summary.stage || 'parse_chunks'),
        error: 'cancelled_observed_during_batch',
        context: {
          indexed_file_count: Number(job.indexed_file_count) || 0,
          file_count: filesTotal,
        },
      });
      return {
        ok: true,
        cancelled: true,
        run_id: job.id,
        job_id: job.id,
        mode: jobMode,
        status: 'cancelled',
      };
    }
    try {
      const blobSha =
        file.git_blob_sha != null && String(file.git_blob_sha).trim()
          ? String(file.git_blob_sha).trim()
          : null;
      // Full/Restart re-embeds every file — skip the per-file PG SHA lookup
      // that only exists to short-circuit Update/incremental.
      if (blobSha && jobMode === INCREMENTAL_INDEX_MODE) {
        const pgOpts = { client: await pgSession.ensureClient() };
        const existing = await findIndexedGitBlobSha(
          env,
          workspaceUuid,
          repoFullName,
          file.path,
          pgOpts,
        );
        const existingSha = existing?.git_blob_sha || null;
        const expectedParser =
          file.classification === 'structural_and_chunks'
            ? structuralParserIdForFile(file) || STRUCTURAL_PARSER_ID
            : null;
        // Missing/old parser_id must NOT skip — otherwise bloated const-flood parses stick forever.
        // Also refuse skip when promoting chunks_only → structural (py/go lane).
        const parserMatch = !expectedParser
          ? true
          : existing?.parser_id === expectedParser;
        // Blob-skip is Update/incremental only. Restart/full must re-parse + re-embed
        // every processable file so activate can build full import/call graph parity.
        if (
          jobMode === INCREMENTAL_INDEX_MODE &&
          existingSha &&
          existingSha === blobSha
        ) {
          const pgOptsSkip = { client: await pgSession.ensureClient() };
          const pgCounts = await countPgArtifactsForFile(
            env,
            workspaceUuid,
            repoFullName,
            file.path,
            pgOptsSkip,
          );
          // Skip only when both chunk + symbol rows exist — otherwise re-index.
          if (
            shouldSkipUnchangedFile({
              blobMatch: true,
              chunks: pgCounts.chunks,
              symbols: pgCounts.symbols,
              parserMatch,
            })
          ) {
            await relinkNodesToJob(env, workspaceId, repoFullName, file.path, job.id);
            await relinkPgArtifactsToJob(
              env,
              workspaceUuid,
              repoFullName,
              file.path,
              job.id,
              pgOptsSkip,
            );
            // Skip-unchanged still needs call_sites on this job's manifest for activate.
            let skipCallSites = [];
            let skipImportBindings = [];
            if (file.classification === 'structural_and_chunks') {
              try {
                const rawSkip = await fetchRepoFile(
                  gh.token,
                  repoFullName,
                  file.path,
                  manifest.revision_sha,
                );
                const { parseStructuralForFile } = await import(
                  './structural-parse.js'
                );
                const parsedSkip = await parseStructuralForFile(rawSkip, file, {
                  workspace_id: workspaceId,
                  repo_full_name: repoFullName,
                  revision_sha: manifest.revision_sha,
                  run_id: job.id,
                  parser_id: expectedParser,
                  env,
                });
                // Remap enclosing ids onto currently relinked D1 node ids by name+line.
                const nodeRows = await env.DB.prepare(
                  `SELECT id, node_name, line_start FROM codebase_ast_nodes
                    WHERE workspace_id = ? AND repo_full_name = ? AND file_path = ? AND index_job_id = ?`,
                )
                  .bind(workspaceId, repoFullName, file.path, job.id)
                  .all();
                const byKey = new Map(
                  (nodeRows?.results || []).map((n) => [
                    `${n.node_name}|${n.line_start}`,
                    n.id,
                  ]),
                );
                skipCallSites = compactCallSites(
                  (parsedSkip.call_sites || []).map((cs) => {
                    const key = `${cs.enclosing_name}|${cs.enclosing_line_start}`;
                    const remapped = byKey.get(key);
                    return remapped ? { ...cs, enclosing_node_id: remapped } : cs;
                  }),
                );
                skipImportBindings = compactImportBindings(parsedSkip.import_bindings || []);
              } catch {
                // Best-effort: activate may record unresolved calls for this file.
              }
            }
            skippedUnchanged += 1;
            symbolsRelinked += pgCounts.symbols;
            chunksWritten += pgCounts.chunks;
            receipts.push({
              path: file.path,
              status: 'skipped_unchanged',
              git_blob_sha: blobSha,
              revision_sha: manifest.revision_sha,
              chunks_relinked: pgCounts.chunks,
              symbols_relinked: pgCounts.symbols,
              parser_id: existing.parser_id || null,
              call_sites: skipCallSites,
              import_bindings: skipImportBindings,
            });
            Object.assign(file, {
              status: 'skipped_unchanged',
              git_blob_sha: blobSha,
              parser_id: existing.parser_id || null,
              chunks_relinked: pgCounts.chunks,
              symbols_relinked: pgCounts.symbols,
              chunks_written: 0,
              symbols_written: 0,
              call_sites: skipCallSites,
              import_bindings: skipImportBindings,
            });
            continue;
          }
        }
      }

      const raw = await fetchRepoFile(gh.token, repoFullName, file.path, manifest.revision_sha);
      const wantedStructural = file.classification === 'structural_and_chunks';
      const plan = await buildFullFilePlan(raw, file, {
        workspace_id: workspaceId,
        repo_full_name: repoFullName,
        revision_sha: manifest.revision_sha,
        run_id: job.id,
        index_generation_id: indexGenerationId,
        env,
      });
      // Empty IR (structure_empty) is chunks-only success. Real parse_failed stays a hard fail.
      const structureEmpty =
        plan.file?.structural_quality === 'structure_empty' ||
        plan.stage_receipt?.status === 'structure_empty_chunks_only';
      if (
        wantedStructural &&
        !structureEmpty &&
        (plan.file?.structural_quality === 'parse_failed' ||
          !Array.isArray(plan.symbols) ||
          plan.symbols.length <= 0)
      ) {
        throw new Error(
          String(plan.stage_receipt?.parse_error || 'structural_parse_failed').slice(0, 300),
        );
      }
      const nodesInserted = await insertFullNodes(env, plan.symbols);
      if (wantedStructural && !structureEmpty && nodesInserted <= 0) {
        throw new Error(`ast_nodes_not_persisted:${file.path}`);
      }

      // Embed first (no PG held). Full mode → Gemini Batch Mode; incremental → online.
      const preparedChunks = [];
      if (plan.chunks.length) {
        const embedResults = await embedTextsForCodeIndex(
          env,
          plan.chunks.map((c) => c.content),
          {
            mode: jobMode,
            spec: embedSpec,
            userId: job.user_id != null ? String(job.user_id) : null,
            displayName: `cidx_chunks_${job.id}_${String(file.path).slice(0, 40)}`,
            usage: {
              workspace_id: workspaceId,
              tenant_id: tenantId,
              user_id: job.user_id != null ? String(job.user_id) : null,
              task_type:
                jobMode === 'full' ? 'codebase_full_chunk_batch_embed' : 'codebase_full_chunk_embed',
              tool_name: 'codebase_full_index',
              ref_table: 'agentsam_code_index_job',
              ref_id: job.id,
              pricing_kind: jobMode === 'full' ? 'batch' : 'embedding',
            },
          },
        );
        for (let ci = 0; ci < plan.chunks.length; ci += 1) {
          const chunk = plan.chunks[ci];
          const embedding = embedResults[ci]?.embedding;
          if (!Array.isArray(embedding)) {
            throw new Error(`chunk_embed_missing:${file.path}:${ci}`);
          }
          const metadata = {
            run_id: job.id,
            index_generation_id: indexGenerationId,
            pipeline: FULL_INDEX_PIPELINE,
            mode: jobMode,
            workspace_id: workspaceId,
            workspace_uuid: workspaceUuid,
            repo_full_name: repoFullName,
            branch: manifest.branch,
            revision_sha: manifest.revision_sha,
            git_blob_sha: plan.file.git_blob_sha,
            file_hash: plan.file.file_hash,
            file_path: file.path,
            chunk_index: chunk.chunk_index,
            line_start: chunk.line_start,
            line_end: chunk.line_end,
            node_id: chunk.node_id,
            node_name: chunk.node_name,
            node_type: chunk.node_type,
            chunker_id: chunk.chunker_id,
            parser_id: file.parser_id || null,
            structural_quality: file.structural_quality || 'unavailable',
            source: 'codebase_full_index',
            embedding_model: embedSpec.model,
            embed_pipe: embedResults[ci]?.batch_name ? 'gemini_batch_mode' : 'online',
            gemini_batch_name: embedResults[ci]?.batch_name || null,
          };
          preparedChunks.push({
            chunk,
            embedding,
            metadata,
            row: {
              id: crypto.randomUUID(),
              workspace_id: workspaceUuid,
              file_path: file.path,
              content: chunk.content,
              chunk_index: chunk.chunk_index,
              token_count: estimateTokens(chunk.content),
              embedding,
              metadata,
              node_id: chunk.node_id,
              index_generation_id: indexGenerationId,
            },
          });
        }
      }
      await pgSession.run(async (pgClient) => {
        const pgOptsWrite = { client: pgClient };
        await deleteFullFileArtifacts(env, workspaceUuid, workspaceId, repoFullName, file.path, {
          index_generation_id: indexGenerationId,
          client: pgClient,
        });
        await upsertChunkRowsBatch(
          env,
          preparedChunks.map((p) => p.row),
          pgOptsWrite,
        );
      });
      chunksWritten += preparedChunks.length;
      const receipt = {
        ...plan.stage_receipt,
        status: 'indexed',
        call_sites: compactCallSites(plan.call_sites || []),
        import_bindings: compactImportBindings(plan.import_bindings || []),
      };
      // Never persist per-file revision_sha — top-level manifest.revision_sha is SSOT.
      delete receipt.revision_sha;
      receipts.push(receipt);
      Object.assign(file, receipt);
    } catch (error) {
      // Socket drops are batch-level — do not burn the auto-stop fail ratio on nano flaps.
      if (isCodeIndexPgTransientError(error)) throw error;
      failedFiles += 1;
      const message = String(error?.message || error).slice(0, 300);
      receipts.push({ path: file.path, status: 'failed', error: message, revision_sha: manifest.revision_sha });
      Object.assign(file, { status: 'failed', error: message });

      try {
        await upsertCodeIndexJobFiles(env, {
          jobId: job.id,
          workspaceId,
          repo_full_name: repoFullName,
          indexGenerationId: indexGenerationId,
          files: [file],
        });
      } catch (upsertErr) {
        console.warn(
          '[code-indexer] job_file_failed_write_failed',
          file.path,
          upsertErr?.message || upsertErr,
        );
      }

      const progressSnap = await rollupCodeIndexJobFileProgress(env, job.id);
      const attemptedSoFar = progressSnap.processed;
      const trip = shouldAbortFullIndexForFailures({
        failedFiles: progressSnap.failed,
        attempted: attemptedSoFar,
      });
      if (trip.abort) {
        const ratio =
          attemptedSoFar > 0
            ? Math.round((progressSnap.failed / attemptedSoFar) * 1000) / 10
            : 0;
        const lastError =
          `auto_stopped:failed_files=${progressSnap.failed}/${attemptedSoFar} (${ratio}%, gate=${trip.reason}). ` +
          `Inspect failures before Continue — progress counts attempted files, not successful embeds.`;
        const stopSummary = {
          ...summary,
          mode: jobMode,
          stage: 'parse_chunks',
          cancel_requested: true,
          auto_stop: {
            at: nowUnix(),
            failed_files: progressSnap.failed,
            attempted: attemptedSoFar,
            gate: trip.reason,
            last_path: file.path,
          },
          stages: {
            ...summary.stages,
            parse_chunks: {
              at: new Date().toISOString(),
              ok: false,
              complete: false,
              discovery: manifest.discovery || null,
              revision_sha: manifest.revision_sha,
              indexed_files: attemptedSoFar,
              total_files: progressSnap.total || filesTotal,
              failed_files: progressSnap.failed,
              auto_stopped: true,
              receipts: receipts.slice(-40),
            },
          },
        };
        await patchCheckpoint(
          env,
          job.id,
          {
            status: 'cancelled',
            indexed_file_count: attemptedSoFar,
            failed_file_count: progressSnap.failed,
            chunk_count: (Number(job.chunk_count) || 0) + chunksWritten,
            progress_percent: Math.max(
              1,
              Math.min(
                69,
                Math.ceil((attemptedSoFar / Math.max(1, progressSnap.total || filesTotal || 1)) * 70),
              ),
            ),
            last_error: lastError.slice(0, 500),
            file_manifest: await serializeManifestForD1(env, job.id, manifest, {
              persistFilesOnly: batch,
              inventoryStamp: false,
            }),
            symbol_summary: JSON.stringify(slimSymbolSummaryForD1(stopSummary)),
          },
          cols,
        );
        await logFullIndexTerminal(env, {
          outcome: 'cancelled',
          jobId: job.id,
          workspaceId,
          repoFullName,
          revisionSha: manifest.revision_sha || null,
          stage: 'parse_chunks',
          error: lastError,
          stack: error?.stack || null,
          context: {
            indexed_file_count: attemptedSoFar,
            file_count: progressSnap.total || filesTotal,
            failed_file_count: progressSnap.failed,
            auto_stop: true,
            failure_point: 'parse_chunks_auto_stop',
            last_failed_path: file.path,
          },
        });
        return {
          ok: false,
          cancelled: true,
          resume: false,
          run_id: job.id,
          job_id: job.id,
          mode: jobMode,
          status: 'cancelled',
          last_error: lastError,
          failed_file_count: progressSnap.failed,
          indexed_file_count: attemptedSoFar,
        };
      }
    }
  }
  const progress = await rollupCodeIndexJobFileProgress(env, job.id);
  const crawlComplete = progress.total > 0 && progress.pending === 0 && progress.processing === 0;
  const nodeCount = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM codebase_ast_nodes WHERE index_job_id = ?`,
  )
    .bind(job.id)
    .first();
  const nextChunks = (Number(job.chunk_count) || 0) + chunksWritten;
  const priorSkipped =
    Number(summary.stages?.parse_chunks?.skipped_unchanged) || 0;
  const priorSymbolsRelinked =
    Number(summary.stages?.parse_chunks?.symbols_relinked) || 0;
  const nextSummary = {
    ...summary,
    mode: jobMode,
    stage: crawlComplete ? 'embed_symbols' : 'parse_chunks',
    symbol_offset: 0,
    stages: {
      ...summary.stages,
      parse_chunks: {
        at: new Date().toISOString(),
        ok: progress.failed === 0,
        complete: crawlComplete,
        discovery: manifest.discovery || null,
        revision_sha: manifest.revision_sha,
        base_sha: manifest.base_sha || null,
        indexed_files: progress.processed,
        total_files: progress.total || filesTotal,
        changed_count: manifest.changed_count != null ? Number(manifest.changed_count) : progress.total || filesTotal,
        removed_paths: Array.isArray(manifest.removed_paths) ? manifest.removed_paths : [],
        d1_nodes: Number(nodeCount?.c) || 0,
        chunks_written: nextChunks,
        failed_files: progress.failed,
        skipped_unchanged: priorSkipped + skippedUnchanged,
        symbols_relinked: priorSymbolsRelinked + symbolsRelinked,
        latest_receipts: slimReceiptsForSummary(receipts),
      },
    },
  };
  try {
    const slimManifestJson = await serializeManifestForD1(env, job.id, manifest, {
      persistFilesOnly: batch,
      inventoryStamp: false,
    });
    const slimSummaryJson = JSON.stringify(slimSymbolSummaryForD1(nextSummary));
    await patchCheckpoint(
      env,
      job.id,
      {
        status: 'idle',
        indexed_file_count: progress.processed,
        failed_file_count: progress.failed,
        chunk_count: nextChunks,
        symbol_count: Number(nodeCount?.c) || 0,
        ast_node_count: Number(nodeCount?.c) || 0,
        ast_file_count: progress.indexed + progress.skipped,
        ast_last_indexed_at: nowUnix(),
        progress_percent: crawlComplete
          ? 70
          : Math.max(
              1,
              Math.min(
                69,
                Math.ceil((progress.processed / Math.max(1, progress.total || filesTotal || 1)) * 70),
              ),
            ),
        file_manifest: slimManifestJson,
        symbol_summary: slimSummaryJson,
        last_error: progress.failed ? `${progress.failed} file(s) failed; inspect job_file receipts` : null,
      },
      cols,
    );
  } catch (writeErr) {
    normalizeManifestInPlace(manifest);
    const manifestBytes =
      writeErr?.manifestBytes != null
        ? Number(writeErr.manifestBytes)
        : JSON.stringify(slimManifestForD1(manifest)).length;
    const soft =
      writeErr?.code === 'manifest_checkpoint_soft_limit' ||
      String(writeErr?.message || '').startsWith('manifest_checkpoint_soft_limit');
    console.warn(
      soft
        ? '[code-indexer] parse_chunks_checkpoint_soft_limit'
        : '[code-indexer] parse_chunks_checkpoint_write_failed',
      {
        jobId: job.id,
        processed: progress.processed,
        filesTotal: progress.total || filesTotal,
        manifestBytes,
        err: String(writeErr?.message || writeErr).slice(0, 300),
      },
    );
    if (soft) {
      const pauseMsg =
        `manifest_checkpoint_soft_limit:bytes=${manifestBytes}:limit=${MANIFEST_CHECKPOINT_SOFT_MAX_BYTES}` +
        `:processed=${progress.processed}:files_total=${progress.total || filesTotal}. Progress intact — trim/deploy then Continue.`;
      await patchCheckpoint(
        env,
        job.id,
        {
          status: 'idle',
          last_error: pauseMsg.slice(0, 500),
          symbol_summary: JSON.stringify(
            slimSymbolSummaryForD1({
              ...summary,
              stage: 'parse_chunks',
              stages: {
                ...summary.stages,
                parse_chunks: {
                  ...(summary.stages?.parse_chunks || {}),
                  soft_limit_pause: {
                    at: new Date().toISOString(),
                    bytes: manifestBytes,
                    processed: progress.processed,
                  },
                },
              },
            }),
          ),
        },
        cols,
      ).catch(() => null);
      return {
        ok: false,
        paused: true,
        resume: false,
        run_id: job.id,
        job_id: job.id,
        pipeline: FULL_INDEX_PIPELINE,
        mode: jobMode,
        stage: 'parse_chunks',
        status: 'idle',
        last_error: pauseMsg,
        indexed_files: progress.processed,
        files_total: progress.total || filesTotal,
      };
    }
    const wrapped = new Error(
      `parse_chunks_checkpoint_write_failed:${String(writeErr?.message || writeErr).slice(0, 200)}:manifest_bytes=${manifestBytes}:processed=${progress.processed}:files_total=${progress.total || filesTotal}`,
    );
    wrapped.stack = writeErr?.stack || wrapped.stack;
    throw wrapped;
  }
  if (await isJobCancelled(env, job.id)) {
    return {
      ok: true,
      cancelled: true,
      run_id: job.id,
      job_id: job.id,
      mode: jobMode,
      status: 'cancelled',
    };
  }
  return {
    ok: true,
    complete: false,
    resume: !crawlComplete,
    run_id: job.id,
    job_id: job.id,
    pipeline: FULL_INDEX_PIPELINE,
    mode: jobMode,
    stage: nextSummary.stage,
    revision_sha: manifest.revision_sha,
    discovery: manifest.discovery || null,
    files_processed_this_run: batch.length,
    indexed_files: progress.processed,
    files_total: progress.total || filesTotal,
    changed_count: manifest.changed_count != null ? Number(manifest.changed_count) : progress.total || filesTotal,
    chunks_written: chunksWritten,
    skipped_unchanged: skippedUnchanged,
    failed_files: progress.failed,
  };
  } catch (pgErr) {
    if (isCodeIndexPgTransientError(pgErr)) {
      const message = `code_index_pg_transient:${String(pgErr?.message || pgErr).slice(0, 200)}`;
      console.warn('[code-indexer] parse_chunks_pg_transient', message);
      const pgProgress = await rollupCodeIndexJobFileProgress(env, job.id).catch(() => null);
      return {
        ok: false,
        resume: true,
        run_id: job.id,
        job_id: job.id,
        pipeline: FULL_INDEX_PIPELINE,
        mode: jobMode,
        stage: 'parse_chunks',
        status: 'idle',
        error: message,
        last_error: message,
        indexed_files: pgProgress?.processed ?? (Number(job.indexed_file_count) || 0),
        files_total: pgProgress?.total ?? filesTotal,
        chunks_written: chunksWritten,
        failed_files: pgProgress?.failed ?? failedFiles,
      };
    }
    throw pgErr;
  } finally {
    await pgSession.close();
  }
}
