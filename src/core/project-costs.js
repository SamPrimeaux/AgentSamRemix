/**
 * project_costs — per-project spend line items (allocations + measured AI usage).
 */
import { pragmaTableInfo } from '../../backend/services/retention.js';
import { resolveUsageEventCostUsd } from '../../backend/telemetry/pricing.js';

const PROJECT_COST_COLUMNS = [
  'project_id',
  'cost_type',
  'amount',
  'description',
  'workspace_id',
  'tenant_id',
  'user_id',
  'provider',
  'model_key',
  'task_type',
  'input_tokens',
  'output_tokens',
  'total_tokens',
  'quality_tier',
  'quality_score',
  'currency',
  'source_kind',
  'source_id',
  'routing_arm_id',
  'image_count',
  'metadata_json',
];

function numOrZero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function strOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

/**
 * @param {unknown} raw
 */
export function parseProjectCostMetadata(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return { ...(/** @type {Record<string, unknown>} */ (raw)) };
  try {
    const o = JSON.parse(String(raw));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

/**
 * @param {import('@cloudflare/workers-types').D1Database} db
 */
export async function projectCostsTableReady(db) {
  const cols = await pragmaTableInfo(db, 'project_costs');
  return cols.has('model_key') && cols.has('input_tokens');
}

/**
 * @param {any} env
 * @param {{
 *   projectId: string,
 *   costType: string,
 *   amount?: number|null,
 *   description?: string|null,
 *   workspaceId?: string|null,
 *   tenantId?: string|null,
 *   userId?: string|null,
 *   provider?: string|null,
 *   modelKey?: string|null,
 *   taskType?: string|null,
 *   inputTokens?: number,
 *   outputTokens?: number,
 *   qualityTier?: string|null,
 *   qualityScore?: number|null,
 *   currency?: string|null,
 *   sourceKind?: string|null,
 *   sourceId?: string|null,
 *   routingArmId?: string|null,
 *   imageCount?: number,
 *   metadata?: Record<string, unknown>|null,
 *   pricingKind?: string|null,
 * }} opts
 */
export async function insertProjectCost(env, opts) {
  if (!env?.DB) throw new Error('db_unavailable');
  const projectId = strOrNull(opts.projectId);
  const costType = strOrNull(opts.costType);
  if (!projectId || !costType) throw new Error('project_id_and_cost_type_required');

  const inputTokens = Math.max(0, Math.floor(numOrZero(opts.inputTokens)));
  const outputTokens = Math.max(0, Math.floor(numOrZero(opts.outputTokens)));
  const totalTokens = inputTokens + outputTokens;
  const imageCount = Math.max(0, Math.floor(numOrZero(opts.imageCount)));
  const modelKey = strOrNull(opts.modelKey);

  let amount = opts.amount != null ? numOrZero(opts.amount) : 0;
  if (!(amount > 0) && modelKey) {
    const priced = await resolveUsageEventCostUsd(env.DB, {
      modelKey,
      provider: opts.provider,
      inputTokens,
      outputTokens,
      pricingKind: opts.pricingKind || (imageCount > 0 || costType === 'ai_image' ? 'image' : 'standard'),
      computedCostUsdOverride: opts.amount != null && amount > 0 ? amount : null,
    }).catch(() => ({ costUsd: 0 }));
    if (priced.costUsd > 0) amount = priced.costUsd;
  }

  const metadata = opts.metadata && typeof opts.metadata === 'object' ? opts.metadata : {};
  const row = {
    project_id: projectId,
    cost_type: costType,
    amount,
    description: strOrNull(opts.description),
    workspace_id: strOrNull(opts.workspaceId),
    tenant_id: strOrNull(opts.tenantId),
    user_id: strOrNull(opts.userId),
    provider: strOrNull(opts.provider),
    model_key: modelKey,
    task_type: strOrNull(opts.taskType),
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    quality_tier: strOrNull(opts.qualityTier),
    quality_score: opts.qualityScore != null && Number.isFinite(Number(opts.qualityScore)) ? Number(opts.qualityScore) : null,
    currency: strOrNull(opts.currency) || 'USD',
    source_kind: strOrNull(opts.sourceKind) || 'manual',
    source_id: strOrNull(opts.sourceId),
    routing_arm_id: strOrNull(opts.routingArmId),
    image_count: imageCount,
    metadata_json: JSON.stringify(metadata),
  };

  const cols = await pragmaTableInfo(env.DB, 'project_costs');
  const fields = PROJECT_COST_COLUMNS.filter((c) => cols.has(c));
  if (!fields.includes('project_id') || !fields.includes('cost_type') || !fields.includes('amount')) {
    throw new Error('project_costs_schema_incomplete');
  }

  const placeholders = fields.map(() => '?').join(', ');
  await env.DB.prepare(
    `INSERT INTO project_costs (${fields.join(', ')}, created_at) VALUES (${placeholders}, datetime('now'))`,
  )
    .bind(...fields.map((k) => row[k]))
    .run();

  const idRow = await env.DB.prepare(`SELECT last_insert_rowid() AS id`).first();
  return { id: idRow?.id, ...row };
}

/**
 * @param {any} env
 * @param {string} projectId
 * @param {{ limit?: number }} [opts]
 */
export async function listProjectCosts(env, projectId, opts = {}) {
  if (!env?.DB) return [];
  const pid = strOrNull(projectId);
  if (!pid) return [];
  const limit = Math.min(200, Math.max(1, Math.floor(numOrZero(opts.limit) || 50)));
  const cols = await pragmaTableInfo(env.DB, 'project_costs');
  const hasMetrics = cols.has('model_key');

  const sql = hasMetrics
    ? `SELECT id, project_id, cost_type, amount, description, workspace_id, tenant_id, user_id,
              provider, model_key, task_type, input_tokens, output_tokens, total_tokens,
              quality_tier, quality_score, currency, source_kind, source_id, routing_arm_id,
              image_count, metadata_json, created_at
         FROM project_costs
         WHERE CAST(project_id AS TEXT) = ?
         ORDER BY datetime(created_at) DESC
         LIMIT ?`
    : `SELECT id, project_id, cost_type, amount, description, created_at
         FROM project_costs
         WHERE CAST(project_id AS TEXT) = ?
         ORDER BY datetime(created_at) DESC
         LIMIT ?`;

  const { results } = await env.DB.prepare(sql).bind(pid, limit).all();
  return (results || []).map((r) => ({
    ...r,
    metadata: parseProjectCostMetadata(r.metadata_json),
  }));
}

/**
 * @param {any} env
 * @param {string} projectId
 */
export async function summarizeProjectCosts(env, projectId) {
  const rows = await listProjectCosts(env, projectId, { limit: 200 });
  let totalUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let imageCount = 0;
  const byModel = /** @type {Record<string, number>} */ ({});
  for (const r of rows) {
    totalUsd += numOrZero(r.amount);
    inputTokens += numOrZero(r.input_tokens);
    outputTokens += numOrZero(r.output_tokens);
    imageCount += numOrZero(r.image_count);
    const mk = r.model_key ? String(r.model_key) : 'unknown';
    byModel[mk] = (byModel[mk] || 0) + numOrZero(r.amount);
  }
  return {
    line_items: rows.length,
    total_usd: Math.round(totalUsd * 1_000_000) / 1_000_000,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    image_count: imageCount,
    by_model_usd: byModel,
  };
}
