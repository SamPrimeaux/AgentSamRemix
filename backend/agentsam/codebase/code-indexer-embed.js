/**
 * Code indexer — embed_symbols stage.
 */
import { FULL_INDEX_PIPELINE, shouldEmbedSymbolNode } from './codebase-full-index.js';
import {
  FULL_SYMBOLS_PER_RUN,
  FULL_SYMBOLS_CAP,
  embedTextsForCodeIndex,
  getCodeIndexEmbedSpec,
} from './code-indexer-shared.js';
import { resolveCodeIndexLaneConfig } from './code-index-lane-resolve.js';
import {
  slimSymbolSummaryForD1,
  isJobCancelled,
  patchCheckpoint,
  embedSymbolsSkipInvariant,
} from './code-indexer-job-state.js';
import {
  symbolAlreadyEmbedded,
  clearSymbolEmbeddedInD1,
  hydrateEmbeddedAtFromPg,
  stampSymbolRunIdsBatch,
  upsertFullSymbolRowsBatch,
  symbolEmbedText,
} from './code-indexer-symbols.js';
import { withCodeIndexPgClient } from './code-index-write-pipe.js';

/**
 * @param {any} env
 * @param {object} ctx
 * @returns {Promise<object>}
 */
export async function runEmbedSymbolsStage(env, ctx) {
  await resolveCodeIndexLaneConfig(env);
  const embedSpec = getCodeIndexEmbedSpec(env);
  const { job, workspaceUuid, workspaceId, tenantId, manifest, summary, cols, opts, jobMode } =
    ctx;
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
  // Prefer explicit offset; fall back to embed receipt so a bad resume receipt
  // (symbol_offset:0 while processed=14850) does not re-embed from zero.
  const offset = Math.max(
    Number(summary.symbol_offset) || 0,
    Number(summary.stages?.embed_symbols?.processed) || 0,
  );
  const cursorId =
    summary.symbol_cursor_id != null && String(summary.symbol_cursor_id).trim()
      ? String(summary.symbol_cursor_id).trim()
      : null;
  const maxSymbols = Math.max(
    1,
    Math.min(Number(opts.maxSymbols) || FULL_SYMBOLS_PER_RUN, FULL_SYMBOLS_CAP),
  );
  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM codebase_ast_nodes WHERE index_job_id = ?`,
  )
    .bind(job.id)
    .first();
  const total = Number(totalRow?.c) || 0;
  const nodes = cursorId
    ? await env.DB.prepare(
        `SELECT id, workspace_id, repo_full_name, file_path, node_type, node_name, signature,
                line_start, line_end, language, file_hash, is_exported, embedded_at
           FROM codebase_ast_nodes
          WHERE index_job_id = ? AND id > ?
          ORDER BY id LIMIT ?`,
      )
        .bind(job.id, cursorId, maxSymbols)
        .all()
        .then((result) => result?.results || [])
    : await env.DB.prepare(
        `SELECT id, workspace_id, repo_full_name, file_path, node_type, node_name, signature,
                line_start, line_end, language, file_hash, is_exported, embedded_at
           FROM codebase_ast_nodes
          WHERE index_job_id = ?
          ORDER BY id LIMIT ? OFFSET ?`,
      )
        .bind(job.id, maxSymbols, offset)
        .all()
        .then((result) => result?.results || []);

  const errors = [];
  /** @type {Array<'structure_only'|'skipped'|'embedded'|'error'|null>} */
  const symbolResults = new Array(nodes.length).fill(null);
  /** @type {Array<{ index: number, node: object }>} */
  const needEmbed = [];
  /** @type {string[]} */
  const stampCandidates = [];

  // Short PG session for hydrate + stamp only — do not hold a nano slot across embed API calls.
  await withCodeIndexPgClient(env, async (pgClient) => {
    const pgOpts = { client: pgClient };
    await hydrateEmbeddedAtFromPg(env, nodes, pgOpts);

    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (!shouldEmbedSymbolNode(node)) {
        symbolResults[i] = 'structure_only';
        continue;
      }
      if (await symbolAlreadyEmbedded(env, node.id, node)) {
        stampCandidates.push(String(node.id));
        symbolResults[i] = 'skipped';
        continue;
      }
      needEmbed.push({ index: i, node: { ...node, revision_sha: manifest.revision_sha } });
    }

    if (!stampCandidates.length) return;
    try {
      const stamped = await stampSymbolRunIdsBatch(
        env,
        stampCandidates,
        workspaceUuid,
        job.id,
        pgOpts,
      );
      for (let i = 0; i < nodes.length; i += 1) {
        if (symbolResults[i] !== 'skipped') continue;
        const id = String(nodes[i].id);
        if (stamped.has(id)) continue;
        await clearSymbolEmbeddedInD1(env, id);
        symbolResults[i] = null;
        needEmbed.push({
          index: i,
          node: { ...nodes[i], revision_sha: manifest.revision_sha },
        });
      }
    } catch (error) {
      for (let i = 0; i < nodes.length; i += 1) {
        if (symbolResults[i] !== 'skipped') continue;
        await clearSymbolEmbeddedInD1(env, nodes[i].id);
        symbolResults[i] = null;
        needEmbed.push({
          index: i,
          node: { ...nodes[i], revision_sha: manifest.revision_sha },
        });
      }
      errors.push({
        node_id: '_stamp_batch',
        error: String(error?.message || error).slice(0, 200),
      });
    }
  });

  // Batch Mode for full; online for incremental — no PG client held open.
  /** @type {Array<{ index: number, node: object, embedding: number[] }>} */
  const pendingUpserts = [];
  if (needEmbed.length) {
    try {
      const embedResults = await embedTextsForCodeIndex(
        env,
        needEmbed.map((item) => symbolEmbedText(item.node)),
        {
          mode: jobMode,
          spec: embedSpec,
          userId: job.user_id != null ? String(job.user_id) : null,
          displayName: `cidx_symbols_${job.id}_${offset}`,
          usage: {
            workspace_id: workspaceId,
            tenant_id: tenantId,
            user_id: job.user_id != null ? String(job.user_id) : null,
            task_type:
              jobMode === 'full'
                ? 'codebase_full_symbol_batch_embed'
                : 'codebase_full_symbol_embed',
            tool_name: 'codebase_full_index',
            ref_table: 'agentsam_code_index_job',
            ref_id: job.id,
            pricing_kind: jobMode === 'full' ? 'batch' : 'embedding',
          },
        },
      );
      for (let i = 0; i < needEmbed.length; i += 1) {
        const embedding = embedResults[i]?.embedding;
        if (!Array.isArray(embedding)) {
          errors.push({
            node_id: needEmbed[i].node.id,
            error: 'symbol_embed_missing',
          });
          symbolResults[needEmbed[i].index] = 'error';
          continue;
        }
        pendingUpserts.push({
          index: needEmbed[i].index,
          node: needEmbed[i].node,
          embedding,
        });
      }
    } catch (error) {
      const msg = String(error?.message || error).slice(0, 200);
      for (const { index, node } of needEmbed) {
        errors.push({ node_id: node.id, error: msg });
        symbolResults[index] = 'error';
      }
    }
  }

  // Second short session for the whole upsert page.
  if (pendingUpserts.length) {
    try {
      await withCodeIndexPgClient(env, async (pgClient) => {
        await upsertFullSymbolRowsBatch(
          env,
          pendingUpserts.map(({ node, embedding }) => ({ node, embedding })),
          workspaceUuid,
          job.id,
          { client: pgClient },
        );
      });
      for (const { index } of pendingUpserts) {
        symbolResults[index] = 'embedded';
      }
    } catch (error) {
      const msg = String(error?.message || error).slice(0, 200);
      for (const { index, node } of pendingUpserts) {
        symbolResults[index] = 'error';
        errors.push({ node_id: node.id, error: msg });
      }
    }
  }

  const embedded = symbolResults.filter((r) => r === 'embedded').length;
  const skipped = symbolResults.filter((r) => r === 'skipped').length;
  const structureOnly = symbolResults.filter((r) => r === 'structure_only').length;
  const errored = symbolResults.filter((r) => r === 'error').length;
  const nextOffset = offset + nodes.length;
  const lastId = nodes.length ? String(nodes[nodes.length - 1].id) : cursorId;
  const complete = nodes.length === 0 || nextOffset >= total;
  const priorEmbedSkipped =
    Number(summary.stages?.embed_symbols?.skipped_already_embedded) || 0;
  const priorStructureOnly =
    Number(summary.stages?.embed_symbols?.skipped_structure_only) || 0;
  const priorEmbedded =
    Number(summary.stages?.embed_symbols?.embedded_this_run) || 0;
  const priorEmbedErrors = Number(summary.stages?.embed_symbols?.embed_errors) || 0;
  const priorErrorSample = Array.isArray(summary.stages?.embed_symbols?.errors)
    ? summary.stages.embed_symbols.errors
    : [];
  const skippedTotal = priorEmbedSkipped + skipped;
  const structureOnlyTotal = priorStructureOnly + structureOnly;
  const embeddedTotal = priorEmbedded + embedded;
  const embedErrorsTotal = priorEmbedErrors + errored;
  const errorSample = [...priorErrorSample, ...errors].slice(0, 20);
  const symbolsRelinkedEstimate =
    Number(summary.stages?.parse_chunks?.symbols_relinked) || 0;
  const skipInvariant = complete
    ? embedSymbolsSkipInvariant({
        symbols_relinked_estimate: symbolsRelinkedEstimate,
        skipped_already_embedded: skippedTotal,
      })
    : null;
  const embedPageOk = errors.length === 0;
  const embedStageOk = embedPageOk && embedErrorsTotal === 0;
  const nextSummary = {
    ...summary,
    stage: complete ? 'verify' : 'embed_symbols',
    symbol_offset: nextOffset,
    symbol_cursor_id: lastId || null,
    stages: {
      ...summary.stages,
      embed_symbols: {
        at: new Date().toISOString(),
        ok: embedStageOk,
        complete,
        revision_sha: manifest.revision_sha,
        processed: nextOffset,
        total,
        embedded_this_run: embeddedTotal,
        skipped_already_embedded: skippedTotal,
        skipped_structure_only: structureOnlyTotal,
        embed_errors: embedErrorsTotal,
        symbols_relinked_estimate: symbolsRelinkedEstimate,
        ...(skipInvariant ? { skip_invariant: skipInvariant } : {}),
        errors: errorSample,
      },
    },
  };
  await patchCheckpoint(
    env,
    job.id,
    {
      status: 'idle',
      symbol_count: nextOffset,
      progress_percent: complete
        ? 92
        : Math.max(71, Math.min(91, 70 + Math.round((nextOffset / Math.max(1, total)) * 22))),
      symbol_summary: JSON.stringify(slimSymbolSummaryForD1(nextSummary)),
      last_error: embedErrorsTotal
        ? errorSample
            .map((item) => item?.error || item)
            .filter(Boolean)
            .join('; ')
            .slice(0, 500)
        : null,
    },
    cols,
  );
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
    ok: embedPageOk,
    complete: false,
    resume: true,
    run_id: job.id,
    job_id: job.id,
    pipeline: FULL_INDEX_PIPELINE,
    mode: jobMode,
    stage: nextSummary.stage,
    revision_sha: manifest.revision_sha,
    symbols_processed: nextOffset,
    symbols_total: total,
    embedded_this_run: embedded,
    skipped_already_embedded: skipped,
    skipped_structure_only: structureOnly,
    skipped_already_embedded_total: skippedTotal,
    embed_errors: embedErrorsTotal,
    errors: errorSample,
  };
}
