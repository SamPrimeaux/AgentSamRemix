/**
 * Dashboard AST Re-Index — re-embed D1 codebase_ast_nodes → Supabase symbol table.
 * Phase-1 graph walk stays CLI; this refreshes Phase-2 symbols + stamps last_sync + usage cost.
 */
import { createAgentsamEmbedding } from './agentsam-vectorize.js';
import { runHyperdriveQuery, isHyperdriveUsable } from '../../backend/services/database/hyperdrive.js';
import { resolveSupabaseWorkspaceId } from '../../backend/agentsam/rag/index.js';
import { resolveUsageEventCostUsd } from '../../backend/telemetry/pricing.js';
import {
  resolveCodeIndexLaneConfig,
  requireCodeIndexLaneConfig,
  embedSpecFromCodeIndexLaneConfig,
} from '../../backend/agentsam/codebase/code-index-lane-resolve.js';

const EMBEDDABLE_TYPES = [
  'function',
  'class',
  'method',
  'arrow_function',
  'component',
  'hook',
  'const',
  'type_alias',
  'interface',
  'variable',
];
const MAX_NODES_PER_RUN = 48;
const EMBED_BATCH = 8;
const CPU_BUDGET_MS = 18_000;

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function vectorLiteral(embedding) {
  return `[${embedding.map((x) => Number(x).toFixed(8)).join(',')}]`;
}

function sanitizeText(text) {
  return String(text ?? '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ')
    .replace(/\s{4,}/g, '   ')
    .trim();
}

function buildEmbedText(node) {
  const parts = [
    `repo:${node.repo_full_name || node.repo || ''}`,
    `file:${node.file_path || ''}`,
    `type:${node.node_type || ''}`,
    `name:${node.node_name || ''}`,
    String(node.signature || node.node_name || ''),
  ];
  if (node.docstring) parts.push(String(node.docstring).slice(0, 400));
  return sanitizeText(parts.join(' | ')).slice(0, 4000);
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text ?? '').length / 4));
}

function canonicalJobId(workspaceId) {
  return `cidx_${trim(workspaceId)}`;
}

/**
 * @param {any} env
 * @param {string} workspaceId
 */
async function resolveTenantId(env, workspaceId) {
  const ws = trim(workspaceId);
  if (!env?.DB || !ws) return null;
  try {
    const row = await env.DB.prepare(`SELECT tenant_id FROM workspaces WHERE id = ? LIMIT 1`)
      .bind(ws)
      .first();
    if (row?.tenant_id) return String(row.tenant_id).trim();
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Ensure canonical job row + mark queued for AST symbol refresh.
 * @param {any} env
 * @param {{ workspaceId: string, triggeredBy?: string, repoFullName?: string|null, userId?: string|null }} opts
 */
export async function queueAstSymbolReembed(env, opts = {}) {
  const workspaceId = trim(opts.workspaceId);
  if (!env?.DB || !workspaceId) return { ok: false, skipped: true, reason: 'no_workspace' };

  const jobId = canonicalJobId(workspaceId);
  const triggeredBy = trim(opts.triggeredBy) || 'dashboard_ast_reindex';
  const repo = opts.repoFullName != null ? trim(opts.repoFullName) : null;
  // Identity law: auth_users.id only (au_*). Never invent usr_* platform aliases.
  const userId = opts.userId != null ? trim(opts.userId) : '';
  if (!userId || !userId.startsWith('au_')) {
    return {
      ok: false,
      error: 'user_id_required_au',
      reason: 'agentsam_code_index_job.user_id must be auth_users.id (au_*)',
    };
  }

  try {
    const existing = await env.DB.prepare(
      `SELECT id, status, triggered_by, indexed_file_count, progress_percent
         FROM agentsam_code_index_job WHERE id = ? LIMIT 1`,
    )
      .bind(jobId)
      .first()
      .catch(() => null);

    if (!existing) {
      const nowSec = Math.floor(Date.now() / 1000);
      await env.DB.prepare(
        `INSERT INTO agentsam_code_index_job (
           id, user_id, workspace_id, status, source_type, vector_backend,
           triggered_by, repo_full_name, indexed_file_count, progress_percent, updated_at
         ) VALUES (?, ?, ?, 'idle', 'ast_rag', 'supabase_pgvector', ?, ?, 0, 0, ?)`,
      )
        .bind(jobId, userId, workspaceId, triggeredBy, repo || null, nowSec)
        .run();
    } else if (String(existing.status || '') === 'running') {
      return { ok: true, skipped: true, reason: 'already_running', job_id: jobId };
    } else {
      // cancelled / idle / failed — allow a fresh or resumed queue.
      // Preserve offset unless force:true (accidental reindex must not wipe progress).
      const progress = Number(existing.progress_percent) || 0;
      const offset = Number(existing.indexed_file_count) || 0;
      const forceFull = opts.force === true;
      const resumePartial =
        !forceFull &&
        offset > 0 &&
        progress < 100 &&
        (opts.resume === true ||
          String(existing.triggered_by || '').includes('ast_reindex_resume') ||
          String(existing.status || '') === 'cancelled' ||
          String(existing.status || '') === 'canceled' ||
          String(existing.status || '') === 'idle' ||
          String(existing.status || '') === 'failed');
      if (resumePartial) {
        await env.DB.prepare(
          `UPDATE agentsam_code_index_job
              SET status = 'idle',
                  source_type = 'ast_rag',
                  vector_backend = 'supabase_pgvector',
                  triggered_by = ?,
                  last_error = NULL,
                  finished_at = NULL,
                  repo_full_name = COALESCE(?, repo_full_name),
                  updated_at = datetime('now')
            WHERE id = ?`,
        )
          .bind(triggeredBy, repo || null, jobId)
          .run();
      } else {
        await env.DB.prepare(
          `UPDATE agentsam_code_index_job
              SET status = 'idle',
                  source_type = 'ast_rag',
                  vector_backend = 'supabase_pgvector',
                  triggered_by = ?,
                  indexed_file_count = 0,
                  progress_percent = 0,
                  last_error = NULL,
                  finished_at = NULL,
                  repo_full_name = COALESCE(?, repo_full_name),
                  updated_at = datetime('now')
            WHERE id = ?`,
        )
          .bind(triggeredBy, repo || null, jobId)
          .run();
      }
    }

    return { ok: true, job_id: jobId, queued: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Cancel an in-flight or resumable AST symbol re-embed for a workspace.
 * Marks the canonical job cancelled so client loops and Worker batches stop.
 * @param {any} env
 * @param {string} workspaceId
 * @param {{ reason?: string|null }} [opts]
 */
export async function cancelAstSymbolReembed(env, workspaceId, opts = {}) {
  const ws = trim(workspaceId);
  if (!env?.DB || !ws) return { ok: false, error: 'no_workspace' };
  const jobId = canonicalJobId(ws);
  const reason = trim(opts.reason) || 'cancelled_by_operator';
  try {
    const existing = await env.DB.prepare(
      `SELECT id, status, indexed_file_count, progress_percent, symbol_count
         FROM agentsam_code_index_job WHERE id = ? LIMIT 1`,
    )
      .bind(jobId)
      .first()
      .catch(() => null);
    if (!existing) {
      return { ok: true, skipped: true, reason: 'no_job', job_id: jobId };
    }
    const prevStatus = String(existing.status || '');
    await env.DB.prepare(
      `UPDATE agentsam_code_index_job
          SET status = 'cancelled',
              triggered_by = 'dashboard_ast_reindex_cancelled',
              last_error = ?,
              finished_at = datetime('now'),
              updated_at = datetime('now')
        WHERE id = ?`,
    )
      .bind(reason.slice(0, 500), jobId)
      .run();
    return {
      ok: true,
      job_id: jobId,
      previous_status: prevStatus,
      indexed_file_count: Number(existing.indexed_file_count) || 0,
      progress_percent: Number(existing.progress_percent) || 0,
      cancelled: true,
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

async function isAstReembedCancelled(env, jobId) {
  try {
    const row = await env.DB.prepare(
      `SELECT status FROM agentsam_code_index_job WHERE id = ? LIMIT 1`,
    )
      .bind(jobId)
      .first();
    const st = String(row?.status || '').toLowerCase();
    return st === 'cancelled' || st === 'canceled';
  } catch {
    return false;
  }
}

/**
 * Stamp last_sync_at on canonical job from live AST node freshness (or now).
 * @param {any} env
 * @param {string} workspaceId
 * @param {{ atIso?: string|null }} [opts]
 */
export async function stampAstJobLastSync(env, workspaceId, opts = {}) {
  const ws = trim(workspaceId);
  if (!env?.DB || !ws) return { ok: false };
  const jobId = canonicalJobId(ws);
  let atIso = opts.atIso != null ? trim(opts.atIso) : '';
  if (!atIso) {
    try {
      const row = await env.DB.prepare(
        `SELECT MAX(updated_at) AS m FROM codebase_ast_nodes WHERE workspace_id = ?`,
      )
        .bind(ws)
        .first();
      const m = row?.m;
      if (m != null && Number(m) > 1e9 && Number(m) < 1e12) {
        atIso = new Date(Number(m) * 1000).toISOString();
      } else if (m != null) {
        atIso = String(m);
      }
    } catch {
      /* ignore */
    }
  }
  if (!atIso) atIso = new Date().toISOString();
  try {
    await env.DB.prepare(
      `UPDATE agentsam_code_index_job
          SET last_sync_at = ?,
              updated_at = datetime('now'),
              status = CASE WHEN status = 'running' THEN status ELSE 'idle' END
        WHERE id = ?`,
    )
      .bind(atIso, jobId)
      .run();
    return { ok: true, last_sync_at: atIso, job_id: jobId };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} node
 * @param {string} workspaceUuid
 * @param {number[]} embedding
 * @param {string} embedText
 * @param {{ symbolsTable: string, embedModel: string }} lane
 */
async function upsertSymbolRow(env, node, workspaceUuid, embedding, embedText, lane) {
  const sql = `
    INSERT INTO agentsam.${lane.symbolsTable} (
      node_id, workspace_id, repo_full_name, file_path, node_type, node_name,
      signature, line_start, line_end, content, embedding, metadata, updated_at
    ) VALUES (
      $1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11::vector, $12::jsonb, now()
    )
    ON CONFLICT (node_id) DO UPDATE SET
      signature = EXCLUDED.signature,
      line_start = EXCLUDED.line_start,
      line_end = EXCLUDED.line_end,
      content = EXCLUDED.content,
      embedding = EXCLUDED.embedding,
      metadata = EXCLUDED.metadata,
      updated_at = now()
  `;
  const r = await runHyperdriveQuery(env, sql, [
    String(node.id),
    workspaceUuid,
    node.repo_full_name != null
      ? String(node.repo_full_name)
      : node.repo != null
        ? String(node.repo)
        : null,
    node.file_path != null ? String(node.file_path) : null,
    node.node_type != null ? String(node.node_type) : null,
    node.node_name != null ? String(node.node_name) : null,
    node.signature != null ? String(node.signature) : null,
    node.line_start != null ? Number(node.line_start) : null,
    node.line_end != null ? Number(node.line_end) : null,
    embedText,
    vectorLiteral(embedding),
    JSON.stringify({
      workspace_id: node.workspace_id || null,
      language: node.language ?? null,
      is_exported: node.is_exported ?? null,
      embedding_model: lane.embedModel,
      source: 'dashboard_ast_reindex',
    }),
  ]);
  if (!r.ok) throw new Error(r.error || 'symbol_upsert_failed');
}

/**
 * Run one CPU-budgeted batch of AST symbol re-embeds for a workspace.
 * @param {any} env
 * @param {string} workspaceId
 * @param {{ userId?: string|null, cpuBudgetMs?: number, maxNodes?: number }} [opts]
 */
export async function runAstSymbolReembedJob(env, workspaceId, opts = {}) {
  await resolveCodeIndexLaneConfig(env);
  const laneCfg = requireCodeIndexLaneConfig(env);
  const embedSpec = embedSpecFromCodeIndexLaneConfig(laneCfg);
  const symbolsTable = laneCfg.tables.symbols;
  const ws = trim(workspaceId);
  if (!env?.DB || !ws) return { ok: false, skipped: true, reason: 'no_workspace' };
  if (!isHyperdriveUsable(env)) return { ok: false, error: 'hyperdrive_unavailable' };

  const workspaceUuid = await resolveSupabaseWorkspaceId(env, ws);
  if (!workspaceUuid) return { ok: false, error: 'workspace_uuid_unresolved' };

  const tenantId = await resolveTenantId(env, ws);
  if (!tenantId) return { ok: false, error: 'tenant_unresolved' };

  const jobId = canonicalJobId(ws);
  const cpuBudgetMs = Number(opts.cpuBudgetMs) || CPU_BUDGET_MS;
  const maxNodes = Math.min(Number(opts.maxNodes) || MAX_NODES_PER_RUN, 120);
  const startedAt = Date.now();

  const job = await env.DB.prepare(
    `SELECT id, status, indexed_file_count, repo_full_name FROM agentsam_code_index_job WHERE id = ? LIMIT 1`,
  )
    .bind(jobId)
    .first()
    .catch(() => null);

  if (!job) {
    await queueAstSymbolReembed(env, {
      workspaceId: ws,
      triggeredBy: 'dashboard_ast_reindex',
      userId: opts.userId,
    });
  }

  const offset = Number(job?.indexed_file_count) || 0;
  const typePlaceholders = EMBEDDABLE_TYPES.map(() => '?').join(',');
  const nodes = await env.DB.prepare(
    `SELECT id, workspace_id, repo_full_name, file_path, node_type, node_name, signature,
            docstring, language, is_exported, line_start, line_end
       FROM codebase_ast_nodes
      WHERE workspace_id = ?
        AND node_type IN (${typePlaceholders})
      ORDER BY id
      LIMIT ? OFFSET ?`,
  )
    .bind(ws, ...EMBEDDABLE_TYPES, maxNodes, offset)
    .all()
    .then((r) => r?.results || [])
    .catch(() => []);

  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM codebase_ast_nodes
      WHERE workspace_id = ? AND node_type IN (${typePlaceholders})`,
  )
    .bind(ws, ...EMBEDDABLE_TYPES)
    .first()
    .catch(() => ({ c: 0 }));
  const total = Number(totalRow?.c) || 0;

  if (!nodes.length) {
    const stamped = await stampAstJobLastSync(env, ws);
    await env.DB.prepare(
      `UPDATE agentsam_code_index_job
          SET status = 'idle',
              progress_percent = 100,
              indexed_file_count = ?,
              symbol_count = ?,
              triggered_by = 'dashboard_ast_reindex',
              updated_at = datetime('now')
        WHERE id = ?`,
    )
      .bind(total, total, jobId)
      .run()
      .catch(() => null);
    return {
      ok: true,
      complete: true,
      job_id: jobId,
      embedded: 0,
      offset,
      total,
      last_sync_at: stamped.last_sync_at || null,
    };
  }

  await env.DB.prepare(
    `UPDATE agentsam_code_index_job
        SET status = 'running', started_at = COALESCE(started_at, datetime('now')), updated_at = datetime('now')
      WHERE id = ?`,
  )
    .bind(jobId)
    .run()
    .catch(() => null);

  const stampCancelledProgress = async (nextOffset) => {
    const progress = total ? Math.min(100, Math.round((nextOffset / total) * 100)) : 0;
    await env.DB.prepare(
      `UPDATE agentsam_code_index_job
          SET indexed_file_count = ?,
              progress_percent = ?,
              symbol_count = ?,
              updated_at = datetime('now')
        WHERE id = ? AND LOWER(COALESCE(status, '')) IN ('cancelled', 'canceled')`,
    )
      .bind(nextOffset, progress, nextOffset, jobId)
      .run()
      .catch(() => null);
  };

  if (await isAstReembedCancelled(env, jobId)) {
    await stampCancelledProgress(offset);
    return {
      ok: true,
      cancelled: true,
      complete: false,
      resume: false,
      job_id: jobId,
      embedded: 0,
      offset,
      total,
    };
  }

  let embedded = 0;
  let tokensIn = 0;
  let costUsd = 0;
  const errors = [];

  try {
    for (let i = 0; i < nodes.length; i += EMBED_BATCH) {
      if (await isAstReembedCancelled(env, jobId)) {
        await stampCancelledProgress(offset + i);
        return {
          ok: true,
          cancelled: true,
          complete: false,
          resume: false,
          job_id: jobId,
          embedded,
          offset: offset + i,
          total,
          tokens_in: tokensIn,
          cost_usd: costUsd,
        };
      }
      if (Date.now() - startedAt > cpuBudgetMs) break;
      const slice = nodes.slice(i, i + EMBED_BATCH);
      for (const node of slice) {
        if (Date.now() - startedAt > cpuBudgetMs) break;
        if (await isAstReembedCancelled(env, jobId)) {
          await stampCancelledProgress(offset + i);
          return {
            ok: true,
            cancelled: true,
            complete: false,
            resume: false,
            job_id: jobId,
            embedded,
            offset: offset + i,
            total,
            tokens_in: tokensIn,
            cost_usd: costUsd,
          };
        }
        const embedText = buildEmbedText(node);
        if (!embedText) continue;
        try {
          const { embedding, model } = await createAgentsamEmbedding(env, embedText, {
            spec: embedSpec,
            userId: opts.userId ?? null,
            workspaceId: ws,
            usage: {
              workspace_id: ws,
              tenant_id: tenantId,
              user_id: opts.userId ?? null,
              task_type: 'ast_symbol_reembed',
              tool_name: 'ast_symbol_reembed',
              ref_table: 'agentsam_code_index_job',
              ref_id: jobId,
            },
          });
          await upsertSymbolRow(env, node, workspaceUuid, embedding, embedText, {
            symbolsTable,
            embedModel: embedSpec.model,
          });
          embedded += 1;
          tokensIn += estimateTokens(embedText);
          void model;
        } catch (e) {
          errors.push(String(e?.message || e).slice(0, 160));
        }
      }
    }

    // Per-symbol usage already written via createAgentsamEmbedding opts.usage.
    // Batch rollup cost must follow the same D1 lane resolve (arm/catalog) — never
    // hardcode openai or a buried model id so a registry cutover reprices itself.
    if (embedded > 0) {
      const priced = await resolveUsageEventCostUsd(env.DB, {
        modelKey: embedSpec.modelKey || embedSpec.model || laneCfg.embed.modelKey,
        provider: embedSpec.provider || laneCfg.embed.provider || 'google',
        inputTokens: tokensIn,
        outputTokens: 0,
        pricingKind: 'embedding',
      });
      costUsd = Number(priced.costUsd) || 0;
    }

    const nextOffset = offset + nodes.length;
    const complete = nextOffset >= total;
    const progress = total ? Math.min(100, Math.round((nextOffset / total) * 100)) : 100;

    if (await isAstReembedCancelled(env, jobId)) {
      await stampCancelledProgress(nextOffset);
      return {
        ok: true,
        cancelled: true,
        complete: false,
        resume: false,
        job_id: jobId,
        embedded,
        offset: nextOffset,
        total,
        tokens_in: tokensIn,
        cost_usd: costUsd,
      };
    }

    await env.DB.prepare(
      `UPDATE agentsam_code_index_job
          SET status = ?,
              indexed_file_count = ?,
              progress_percent = ?,
              symbol_count = ?,
              last_error = ?,
              triggered_by = 'dashboard_ast_reindex',
              finished_at = CASE WHEN ? = 1 THEN datetime('now') ELSE finished_at END,
              completed_at = CASE WHEN ? = 1 THEN datetime('now') ELSE completed_at END,
              updated_at = datetime('now')
        WHERE id = ?
          AND LOWER(COALESCE(status, '')) NOT IN ('cancelled', 'canceled')`,
    )
      .bind(
        complete ? 'idle' : 'idle',
        complete ? total : nextOffset,
        progress,
        nextOffset,
        errors.length ? errors.slice(0, 3).join('; ').slice(0, 500) : null,
        complete ? 1 : 0,
        complete ? 1 : 0,
        jobId,
      )
      .run()
      .catch(() => null);

    let lastSync = null;
    if (complete) {
      const stamped = await stampAstJobLastSync(env, ws, { atIso: new Date().toISOString() });
      lastSync = stamped.last_sync_at || null;
    } else {
      // Keep job idle so next click / cron can resume via indexed_file_count offset.
      await env.DB.prepare(
        `UPDATE agentsam_code_index_job
            SET triggered_by = 'dashboard_ast_reindex_resume', updated_at = datetime('now')
          WHERE id = ?
            AND LOWER(COALESCE(status, '')) NOT IN ('cancelled', 'canceled')`,
      )
        .bind(jobId)
        .run()
        .catch(() => null);
    }

    return {
      ok: true,
      complete,
      job_id: jobId,
      embedded,
      offset: nextOffset,
      total,
      tokens_in: tokensIn,
      cost_usd: costUsd,
      errors: errors.slice(0, 5),
      last_sync_at: lastSync,
      resume: !complete,
    };
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 500);
    await env.DB.prepare(
      `UPDATE agentsam_code_index_job
          SET status = 'idle', last_error = ?, triggered_by = 'dashboard_ast_reindex', updated_at = datetime('now')
        WHERE id = ?
          AND LOWER(COALESCE(status, '')) NOT IN ('cancelled', 'canceled')`,
    )
      .bind(msg, jobId)
      .run()
      .catch(() => null);
    return { ok: false, error: msg, job_id: jobId, embedded };
  }
}
