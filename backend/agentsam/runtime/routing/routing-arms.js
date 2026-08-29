/**
 * D1 routing arm loading, candidate queries, and arm resolution.
 */
import { resolveThompsonArmTaskType } from './resolve-model-task-types.js';
import { armTaskTypeForRouteKey } from './route-keys.js';
import { preferGlobalArmPerModelKey } from './resolve-model-arms.js';
import { catalogChatFallbackSqlGuard } from '../../catalog/chat-fallback-guard.js';

export { mergeModelRoutingMemoryPriors } from './routing-thompson.js';

export const ROUTING_ARMS_TABLE = 'agentsam_routing_arms';

/** @param {import('@cloudflare/workers-types').D1Database | undefined} db */
export async function pragmaRoutingArmsColumns(db) {
  const safe = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(ROUTING_ARMS_TABLE) ? ROUTING_ARMS_TABLE : '';
  if (!safe || !db) return new Set();
  try {
    const { results } = await db.prepare(`PRAGMA table_info(${safe})`).all();
    return new Set((results || []).map((r) => String(r.name || '').toLowerCase()));
  } catch {
    return new Set();
  }
}
export {
  armMatchesRouteRequirements,
  filterArmsForRouteKey,
  loadRouteRequirementsRow,
  mergeAiRowWithRoutingArmForPolicy,
  validateModelAgainstRouteRequirements,
} from './routing-route-req.js';

export function banditTaskType(taskType, routeKey) {
  return routeKey != null && String(routeKey).trim()
    ? armTaskTypeForRouteKey(routeKey)
    : resolveThompsonArmTaskType(taskType);
}

/** Labeled Anthropic smoketest batches — provider chain must not fall through to Gemini/OpenAI. */
export function isAnthropicSmoketestQuickstartBatch(batch) {
  return /anthropic_smoketest_quickstart|anthropic_quickstart_seed/i.test(String(batch || ''));
}

/**
 * Single composer/arm mode for lookup — no auto/agent/ask retry list.
 * @param {string} _taskType unused; kept for call-site compatibility
 * @param {string} mode
 * @returns {string[]} length-1
 */
export function routingModesForArmLookup(_taskType, mode) {
  const m = String(mode || 'agent').trim() || 'agent';
  return [m];
}

/** Columns read from agentsam_routing_arms rows (Thompson, route gates, chain assembly). */
const ROUTING_ARM_SELECT_FIELDS = [
  'id',
  'model_key',
  'fallback_model_key',
  'task_type',
  'mode',
  'intent_slug',
  'workspace_id',
  'provider',
  'supports_tools',
  'supports_vision',
  'supports_structured_output',
  'success_alpha',
  'success_beta',
  'decayed_score',
  'priority',
  'latency_mean',
  'cost_mean',
  'avg_quality_score',
  'quality_n',
  'max_cost_per_call_usd',
  'preferred_tier',
  'reasoning_effort',
];

/** @param {Set<string>} armCols lowercase column names from PRAGMA table_info */
function routingArmsSelectList(armCols) {
  const picked = ROUTING_ARM_SELECT_FIELDS.filter((c) => armCols.has(c));
  if (!picked.length) return 'ra.rowid';
  return picked.map((c) => `ra.${c}`).join(', ');
}

function pickIdColumn(cols) {
  if (cols.has('id')) return 'id';
  if (cols.has('arm_id')) return 'arm_id';
  return null;
}

function pickModelColumn(cols) {
  if (cols.has('model_id')) return 'model_id';
  if (cols.has('ai_model_id')) return 'ai_model_id';
  return null;
}

function pickTaskColumn(cols) {
  if (cols.has('task_key')) return 'task_key';
  if (cols.has('intent_slug')) return 'intent_slug';
  if (cols.has('task_type')) return 'task_type';
  return null;
}

function isActiveRow(row, cols) {
  if (cols.has('is_active')) return Number(row.is_active) !== 0;
  if (cols.has('active')) return Number(row.active) !== 0;
  return true;
}

/**
 * Load eligible routing arms for Thompson sampling.
 * @param {{ DB?: import('@cloudflare/workers-types').D1Database }} env
 * @param {{ taskKey?: string, tenantId?: string | null }} ctx
 */
async function loadEligibleArms(env, ctx) {
  const db = env?.DB;
  if (!db) return { cols: new Set(), arms: [] };

  const cols = await pragmaRoutingArmsColumns(db);
  if (!cols.size) return { cols, arms: [] };

  const idCol = pickIdColumn(cols);
  const modelCol = pickModelColumn(cols);
  if (!idCol || !modelCol) return { cols, arms: [] };

  const parts = [];
  const binds = [];

  const taskCol = pickTaskColumn(cols);
  const tk = ctx.taskKey != null ? String(ctx.taskKey).trim() : '';
  if (taskCol && tk) {
    parts.push(`${taskCol} = ?`);
    binds.push(tk);
  }

  if (cols.has('tenant_id') && ctx.tenantId != null && String(ctx.tenantId).trim() !== '') {
    parts.push(`(tenant_id = ? OR tenant_id IS NULL OR tenant_id = '')`);
    binds.push(String(ctx.tenantId).trim());
  }

  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';

  const q = `SELECT * FROM ${ROUTING_ARMS_TABLE} ${where}`;
  try {
    const stmt = binds.length ? db.prepare(q).bind(...binds) : db.prepare(q);
    const { results } = await stmt.all();
    const arms = (results || []).filter((r) => isActiveRow(r, cols));
    return { cols, arms };
  } catch {
    return { cols, arms: [] };
  }
}

/** Routes/tasks that need sandbox/code-interpreter SKUs — not generic MCP/agent tools. */
const CODE_EXECUTION_ROUTE_KEYS = new Set([
  'code_sandbox',
  'python_execute',
  'cdt_evaluate_script',
  'code_interpreter',
]);

const CODE_EXECUTION_TASK_TYPES = new Set([
  'python_execute',
  'code_sandbox',
  'cdt_evaluate_script',
]);

function routingRequiresCodeExecution(routeKey, taskType) {
  const rk = routeKey != null ? String(routeKey).trim().toLowerCase() : '';
  if (rk && CODE_EXECUTION_ROUTE_KEYS.has(rk)) return true;
  const tt = taskType != null ? String(taskType).trim().toLowerCase() : '';
  return CODE_EXECUTION_TASK_TYPES.has(tt);
}

/**
 * Low-cost catalog models are reserved for simple, low-risk turns.
 */
function shouldEscalateFromLowCostModel(q) {
  const mutates = !!q.mutates;
  const steps = Number(q.estimatedSteps) || 0;

  // The catalog identifies the low-cost model class; task vocabulary does not.
  return steps > 1 || mutates || !!q.toolRequired;
}

/**
 * Live D1: arms reference canonical catalog keys. Block the **base** SKU `gpt-5.5` only (not API-accessible).
 * `gpt-5.5-pro` may exist in catalog; eligibility is governed by `agentsam_model_catalog.is_active`.
 * Workers AI (`provider` / `wai-*` / `@cf/*`) remains last in the candidate order.
 */
async function filterNanoEscalation(env, results, q, tt, toolReq) {
  if (!results?.length) return results || [];
  const first = results[0];
  const modelKey = String(first?.model_key || '').trim();
  if (!modelKey || !env?.DB) return results;
  const catalog = await env.DB
    .prepare(
      `SELECT tier FROM agentsam_model_catalog
       WHERE model_key = ? AND is_active = 1 LIMIT 1`,
    )
    .bind(modelKey)
    .first()
    .catch(() => null);
  const isLowCostCatalogModel = String(catalog?.tier || '').trim().toLowerCase() === 'lite';
  if (isLowCostCatalogModel && shouldEscalateFromLowCostModel({
    toolRequired: toolReq,
    taskType: tt,
    mutates: q.mutates,
    estimatedSteps: q.estimatedSteps,
  })) {
    console.log('[routing] escalating from low-cost catalog model due to task complexity', {
      taskType: tt,
      modelKey,
    });
    return results.filter((r) => String(r?.model_key || '').trim() !== modelKey);
  }
  return results;
}

export async function queryRoutingArmsCandidates(env, q) {
  const db = env?.DB;
  if (!db) return [];
  // Model-arm lookup only — fine intent stays on callers for tool profiles.
  const tt = resolveThompsonArmTaskType(q.taskType != null ? q.taskType : 'agent');
  const m = q.mode != null && String(q.mode).trim() !== '' ? String(q.mode).trim() : 'agent';
  const toolReq = !!q.toolRequired;
  const routeKey = q.routeKey != null ? String(q.routeKey).trim() : '';
  const toolsClause = toolReq ? ' AND ra.supports_tools = 1' : '';
  const armCols = new Set([
    'id',
    'model_key',
    'fallback_model_key',
    'task_type',
    'mode',
    'intent_slug',
    'workspace_id',
    'provider',
    'supports_tools',
    'supports_vision',
    'success_alpha',
    'success_beta',
    'decayed_score',
    'priority',
    'latency_mean',
    'cost_mean',
    'avg_quality_score',
    'quality_n',
    'max_cost_per_call_usd',
    'reasoning_effort',
  ]);
  const sharedArmScope = '';

  const catalogCols = new Set(['supports_code_execution']);
  const needCodeExec = toolReq && routingRequiresCodeExecution(routeKey, tt);
  const catalogOk =
    needCodeExec && catalogCols.has('supports_code_execution')
      ? ` AND EXISTS (
           SELECT 1 FROM agentsam_model_catalog mc
           WHERE mc.model_key = ra.model_key AND mc.is_active = 1
             AND COALESCE(mc.supports_tools, 0) = 1
             AND COALESCE(mc.supports_code_execution, 0) = 1
         )`
      : toolReq
        ? ` AND EXISTS (
           SELECT 1 FROM agentsam_model_catalog mc
           WHERE mc.model_key = ra.model_key AND mc.is_active = 1
             AND COALESCE(mc.supports_tools, 0) = 1
         )`
        : ` AND EXISTS (SELECT 1 FROM agentsam_model_catalog mc WHERE mc.model_key = ra.model_key AND mc.is_active = 1)`;
  /** Base-only ban; `gpt-5.5-pro` is allowed through only when catalog marks it active. */
  const blockGpt55Base = ` AND lower(trim(ra.model_key)) != 'gpt-5.5'`;
  const baseWhere = `ra.task_type = ? AND ra.mode = ? AND ra.is_active = 1 AND ra.is_eligible = 1 AND ra.is_paused = 0 AND ra.budget_exhausted = 0${toolsClause}${catalogOk}${blockGpt55Base}`;

  /** Higher `priority` wins; higher `decayed_score` wins; Workers AI remains last. */
  const orderCore = `ra.decayed_score DESC, COALESCE(ra.priority, 0) DESC, ra.rowid ASC`;
  const orderSql = `(CASE WHEN LOWER(COALESCE(ra.provider,'')) IN ('cloudflare','workers_ai')
           OR ra.model_key LIKE 'wai-%' OR ra.model_key LIKE '@cf/%' THEN 1 ELSE 0 END) ASC,
       ${orderCore}`;

  const modesToTry = routingModesForArmLookup(tt, m);

  const armSelect = routingArmsSelectList(armCols);

  const fetchArmsForMode = async (modeTry) => {
    const sqlGlobal =
      `SELECT ${armSelect} FROM ${ROUTING_ARMS_TABLE} ra WHERE ${baseWhere} AND COALESCE(TRIM(ra.workspace_id), '') = ''${sharedArmScope} ORDER BY ${orderSql} LIMIT 40`;
    const result = await db.prepare(sqlGlobal).bind(tt, modeTry).all();
    const filtered = await filterNanoEscalation(env, result.results || [], q, tt, toolReq);
    return preferGlobalArmPerModelKey(filtered);
  };

  try {
    for (const modeTry of modesToTry) {
      const globalRows = await fetchArmsForMode(modeTry);
      if (globalRows.length) return globalRows;
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Ordered active catalog keys for chat/tool chains when routing arms return nothing (global rows only).
 * @param {{ DB?: import('@cloudflare/workers-types').D1Database }} env
 */
export async function loadActiveCatalogModelKeysOrdered(env) {
  const db = env?.DB;
  if (!db) return [];
  const cols = new Set([
    'model_key',
    'is_active',
    'tier',
    'routing_lane',
    'supports_tools',
  ]);
  const hasTenant = cols.has('tenant_id') && cols.has('workspace_id');
  const hasTier = cols.has('tier');
  const hasDegraded = cols.has('is_degraded');
  const scope = hasTenant ? `AND COALESCE(tenant_id,'') = '' AND COALESCE(workspace_id,'') = ''` : '';
  const degradedClause = hasDegraded ? `AND COALESCE(is_degraded,0) = 0` : '';
  const chatGuard = catalogChatFallbackSqlGuard({
    hasSupportsTools: cols.has('supports_tools'),
    hasRoutingLane: cols.has('routing_lane'),
    requireTools: true,
  });
  const orderBy = hasTier
    ? `CASE LOWER(COALESCE(tier,'')) WHEN 'lite' THEN 0 WHEN 'micro' THEN 0 WHEN 'fast' THEN 1 WHEN 'flash' THEN 1 WHEN 'standard' THEN 2 WHEN 'heavy' THEN 3 WHEN 'power' THEN 3 WHEN 'reasoning' THEN 4 WHEN 'specialized' THEN 5 WHEN 'frontier' THEN 6 ELSE 9 END, model_key ASC`
    : 'model_key ASC';
  try {
    const { results } = await db
      .prepare(
        `SELECT model_key FROM agentsam_model_catalog
         WHERE is_active = 1 ${degradedClause} ${scope} ${chatGuard}
         ORDER BY ${orderBy}
         LIMIT 40`,
      )
      .all();
    return (results || [])
      .map((r) => String(r?.model_key ?? '').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Resolve the bandit arm for an explicit model_key (global pool only).
 * `workspaceId` is ignored — workspace is not a Thompson dimension.
 * @returns {Promise<{ armId: string, arm: Record<string, unknown> } | null>}
 */
export async function resolveRoutingArmByModelKey(
  env,
  { modelKey, taskType, mode, workspaceId } = {},
) {
  const mk = modelKey != null ? String(modelKey).trim() : '';
  const tt = resolveThompsonArmTaskType(
    taskType != null && String(taskType).trim() !== '' ? taskType : 'agent',
  );
  const md = mode != null && String(mode).trim() !== '' ? String(mode).trim() : 'agent';
  void workspaceId;
  if (!env?.DB || !mk) return null;
  try {
    const sharedArmScope = '';
    const globalWs = `AND COALESCE(TRIM(workspace_id), '') = ''`;
    let arm = null;
    for (const modeTry of routingModesForArmLookup(tt, md)) {
      arm = await env.DB.prepare(
        `SELECT * FROM ${ROUTING_ARMS_TABLE}
         WHERE model_key = ? AND task_type = ? AND mode = ?
           AND is_active = 1 AND is_eligible = 1 AND is_paused = 0
           ${globalWs}
           ${sharedArmScope}
         ORDER BY COALESCE(priority, 0) DESC, rowid ASC
         LIMIT 1`,
      )
        .bind(mk, tt, modeTry)
        .first();
      if (arm?.id) break;
    }
    if (!arm?.id) return null;
    const armId = arm.id != null ? String(arm.id).trim() : '';
    if (!armId) return null;
    return { armId, arm };
  } catch (e) {
    console.warn('[routing] resolveRoutingArmByModelKey', e?.message ?? e);
    return null;
  }
}

export async function loadChatRoutingArmsModelKeyOrder(env, mode, workspaceId, opts = {}) {
  const m = mode != null && String(mode).trim() !== '' ? String(mode).trim() : 'agent';
  const ws = workspaceId != null ? String(workspaceId).trim() : '';
  const rows = await queryRoutingArmsCandidates(env, {
    // Soft Q&A → Thompson `quick` × composer mode (ask is mode, not task_type).
    taskType: 'quick',
    mode: m,
    workspaceId: ws,
    toolRequired: !!opts.toolRequired,
    routeKey: opts.routeKey ?? null,
  });
  const keys = rows.map((r) => String(r?.model_key ?? '').trim()).filter(Boolean);
  if (keys.length) return keys;
  return loadActiveCatalogModelKeysOrdered(env);
}
