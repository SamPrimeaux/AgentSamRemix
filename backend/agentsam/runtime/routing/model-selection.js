/**
 * Automatic model selection for the runtime dispatcher.
 *
 * Routing arms are the first candidate pool. Catalog fallback exists only for
 * degraded/partially migrated installations and is always chat-capability
 * guarded. Explicit model pins never enter this path.
 */
import { pickRoutingArmByThompson } from './thompson.js';
import { isThompsonRoutingSamplingEnabled } from './routing-thompson-flag.js';
import {
  queryRoutingArmsCandidates,
  filterArmsForRouteKey,
} from './routing.js';
import {
  normalizeMode,
  normalizeRouteKey,
  resolveRouteKeyFromOpts,
} from './route-keys.js';
import { catalogChatFallbackSqlGuard, isNonChatCatalogModel } from '../../catalog/chat-fallback-guard.js';

async function tableColumns(db, tableName) {
  try {
    const result = await db.prepare(`PRAGMA table_info(${tableName})`).all();
    return new Set((result?.results || []).map((row) => String(row.name || '').toLowerCase()));
  } catch {
    return new Set();
  }
}

function fallbackOrder(columns) {
  return columns.has('tier')
    ? `CASE LOWER(COALESCE(tier,'')) WHEN 'lite' THEN 0 WHEN 'micro' THEN 0
         WHEN 'fast' THEN 1 WHEN 'flash' THEN 1 WHEN 'standard' THEN 2
         WHEN 'heavy' THEN 3 WHEN 'power' THEN 3 WHEN 'reasoning' THEN 4
         WHEN 'specialized' THEN 5 WHEN 'frontier' THEN 6 ELSE 9 END, model_key ASC`
    : 'model_key ASC';
}

async function pickCatalogFallback(db, { provider = null, allowDegraded = false } = {}) {
  if (!db) return null;
  const columns = await tableColumns(db, 'agentsam_model_catalog');
  if (!columns.has('model_key') || !columns.has('is_active')) return null;

  const predicates = ['is_active = 1'];
  if (columns.has('is_degraded') && !allowDegraded) predicates.push('COALESCE(is_degraded,0) = 0');
  if (columns.has('budget_exhausted')) predicates.push('COALESCE(budget_exhausted,0) = 0');
  if (columns.has('supports_streaming')) predicates.push('COALESCE(supports_streaming,0) = 1');
  if (columns.has('tenant_id') && columns.has('workspace_id')) {
    predicates.push(`COALESCE(tenant_id,'') = ''`, `COALESCE(workspace_id,'') = ''`);
  }
  if (provider) predicates.push('LOWER(TRIM(provider)) = ?');
  predicates.push(...catalogChatFallbackSqlGuard({
    hasSupportsTools: columns.has('supports_tools'),
    hasRoutingLane: columns.has('routing_lane'),
    requireTools: true,
  }).split(/\s+AND\s+/).filter(Boolean).map((part) => part.startsWith('AND ') ? part : `AND ${part}`).map((part) => part.replace(/^AND /, '')));

  const sql = `SELECT model_key, provider, api_platform, routing_lane, supports_tools
                 FROM agentsam_model_catalog
                WHERE ${predicates.join(' AND ')}
                ORDER BY ${fallbackOrder(columns)}
                LIMIT 1`;
  try {
    const row = await db.prepare(sql).bind(...(provider ? [provider] : [])).first();
    const key = row?.model_key != null ? String(row.model_key).trim() : '';
    return key && !isNonChatCatalogModel(key, row) ? key : null;
  } catch {
    return null;
  }
}

function normalizeSelectionInputs(params = {}) {
  const mode = normalizeMode(params.mode);
  const routeKey = normalizeRouteKey(
    params.routeKey ?? params.route_key ?? params.chatRouteKey ?? resolveRouteKeyFromOpts({ mode }),
  );
  const rawTask = params.taskType ?? params.task_type;
  const taskType =
    rawTask != null && String(rawTask).trim() !== '' ? String(rawTask).trim() : mode;
  return { mode, routeKey, taskType };
}

/**
 * Resolve `auto` using the same route/mode/task normalization used by routing.
 * @param {any} env
 * @param {Record<string, any>} params
 */
export async function resolveAutoModelKey(env, params = {}) {
  const raw = params.modelKey ?? params.model_key;
  if (raw != null && String(raw).trim() && String(raw).trim().toLowerCase() !== 'auto') {
    return raw;
  }

  const { mode, routeKey, taskType } = normalizeSelectionInputs(params);
  const workspaceId =
    params.workspaceId != null && String(params.workspaceId).trim() !== ''
      ? String(params.workspaceId).trim()
      : '';

  if (env?.DB) {
    let arms = await queryRoutingArmsCandidates(env, {
      taskType,
      mode,
      workspaceId,
      toolRequired: !!params.toolRequired,
      routeKey,
    }).catch(() => []);
    arms = await filterArmsForRouteKey(env, routeKey, arms);
    if (arms.length) {
      const thompson = await isThompsonRoutingSamplingEnabled(env, {
        userId: params.userId,
        tenantId: params.tenantId,
      }).catch(() => false);
      const arm = thompson ? pickRoutingArmByThompson(arms) : arms[0];
      const modelKey = arm?.model_key != null ? String(arm.model_key).trim() : '';
      if (modelKey) {
        params.model = modelKey;
        params.provider = arm.provider ?? null;
        params.routing_arm_id = arm.id ?? null;
        return modelKey;
      }
    }

    const key = await pickCatalogFallback(env.DB, { allowDegraded: false });
    if (key) return key;
  }
  return null;
}

export { pickCatalogFallback, normalizeSelectionInputs };
