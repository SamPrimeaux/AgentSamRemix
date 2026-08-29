import { resolveThompsonArmTaskType } from './resolveModel.js';
import { estimateModelRunCostUsd } from '../../backend/telemetry/model-pricing.js';
import {
  resolveRoutingArmByModelKey,
  loadChatRoutingArmsModelKeyOrder,
} from '../../backend/agentsam/runtime/routing/routing.js';
import { triggerEvalAfterNRuns } from './eval-runner.js';
import { parseJsonSafe } from './agent-prompt-builder.js';
import { armTaskTypeForRouteKey } from '../../backend/agentsam/runtime/routing/route-keys.js';
import { resolveCronWorkspaceId } from '../../backend/jobs/cron-tenant.js';

let modelTierMigrationStarted = false;

const AI_MODEL_ROW_SQL = `id, name, provider, model_key, api_platform,
  secret_key_name, supports_tools, supports_vision,
  supports_cache, context_max_tokens, output_max_tokens,
  input_rate_per_mtok, output_rate_per_mtok,
  cache_write_rate_per_mtok, cache_read_rate_per_mtok,
  cache_write_1h_rate_per_mtok, pricing_extras_json,
  size_class, sort_order, tool_invocation_style,
  thinking_mode, effort, system_prompt,
  features_json, picker_group, is_global,
  allowed_tenants_json`;

/** USD from agentsam_model_pricing (via estimateModelRunCostUsd pricing spine). */
export async function fetchModelCostUsd(env, modelKey, inputTokens, outputTokens, cacheReadTokens = 0) {
  if (!env?.DB || !modelKey || (!inputTokens && !outputTokens)) return 0;
  try {
    const priced = await estimateModelRunCostUsd(env.DB, {
      modelKey: String(modelKey),
      inputTokens: Math.max(0, Math.floor(Number(inputTokens) || 0)),
      outputTokens: Math.max(0, Math.floor(Number(outputTokens) || 0)),
      cacheReadTokens: Math.max(0, Math.floor(Number(cacheReadTokens) || 0)),
    });
    return Number(priced?.costUsd) || 0;
  } catch {
    return 0;
  }
}

/**
 * Effective workspace_id via resolveEffectiveWorkspaceId (header/session/tenant/membership).
 * @param {any} env
 * @param {Request} request
 * @param {string|null|undefined} userId
 * @param {Record<string, unknown>} [cache]
 */
/** Derives cost tier label from catalog metadata_json / overlay features_json for workspace tier gating. */
export function modelCostTierFromRow(row) {
  const meta = parseJsonSafe(row?.features_json ?? row?.metadata_json, {}) || {};
  const t = meta.cost_tier;
  if (t != null && String(t).trim() !== '') return String(t).trim();
  return 'free';
}

/**
 * Restricts the candidate model chain to tiers allowed for this workspace (agentsam_model_tier).
 */
export async function filterWorkspaceModelTierPool(env, workspaceId, chainRows) {
  if (!env?.DB || !workspaceId || !chainRows?.length) return chainRows || [];
  try {
    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM agentsam_model_tier',
    ).first();
    if (!count?.n) return chainRows;
  } catch {
    return chainRows;
  }
  try {
    const { results } = await env.DB.prepare(
      `SELECT cost_tier FROM agentsam_model_tier
       WHERE workspace_id = ? AND is_active = 1
       ORDER BY tier_level ASC`,
    )
      .bind(String(workspaceId).trim())
      .all();
    const rows = results || [];
    if (!rows.length) return chainRows;
    const allowed = new Set(
      rows
        .map((r) => r?.cost_tier)
        .filter((t) => t != null && String(t).trim() !== '')
        .map((t) => String(t).trim()),
    );
    if (!allowed.size) return chainRows;
    return chainRows.filter((r) => { const ct = modelCostTierFromRow(r); return !ct || allowed.has(ct); });
  } catch (e) {
    console.warn('[agent] model tier filter', e?.message ?? e);
    return chainRows;
  }
}

/** Map catalog row → legacy agentsam_ai-shaped object for dispatch helpers. */
function catalogRowToAiShape(c) {
  if (!c?.model_key) return null;
  return {
    id: c.id,
    name: c.display_name || c.model_key,
    provider: c.provider,
    model_key: c.model_key,
    api_platform: c.api_platform,
    secret_key_name: null,
    supports_tools: Number(c.supports_tools) === 1 ? 1 : 0,
    supports_vision: Number(c.supports_vision) === 1 ? 1 : 0,
    supports_cache: Number(c.cost_per_1k_cached_in) > 0 ? 1 : 0,
    context_max_tokens: c.context_window,
    output_max_tokens: c.max_output_tokens,
    input_rate_per_mtok: Number(c.cost_per_1k_in || 0) * 1000,
    output_rate_per_mtok: Number(c.cost_per_1k_out || 0) * 1000,
    cache_write_rate_per_mtok: null,
    cache_read_rate_per_mtok:
      Number(c.cost_per_1k_cached_in || 0) > 0 ? Number(c.cost_per_1k_cached_in) * 1000 : null,
    cache_write_1h_rate_per_mtok: null,
    pricing_extras_json: null,
    size_class: c.tier || '',
    sort_order: 0,
    tool_invocation_style: null,
    thinking_mode: null,
    effort: c.reasoning_effort || null,
    system_prompt: null,
    features_json: null,
    picker_group: c.provider || '',
    is_global: 1,
    allowed_tenants_json: null,
  };
}

export async function resolveAiModelRowById(env, id, tenantIdOpt) {
  if (!env.DB || id == null || id === '') return null;
  const tenantId =
    tenantIdOpt != null && String(tenantIdOpt).trim() !== ''
      ? String(tenantIdOpt).trim()
      : null;
  if (!tenantId) return null;
  try {
    const cat = await env.DB.prepare(
      `SELECT * FROM agentsam_model_catalog
       WHERE (id = ? OR model_key = ?) AND COALESCE(is_active, 1) = 1 LIMIT 1`,
    )
      .bind(id, id)
      .first();
    if (cat) return catalogRowToAiShape(cat);
    // Legacy: older clients may still pass agentsam_ai.id
    return await env.DB.prepare(
      `SELECT ${AI_MODEL_ROW_SQL}
       FROM agentsam_ai
       WHERE id = ?
         AND mode = 'model' AND status = 'active'
         AND (is_global = 1 OR allowed_tenants_json LIKE ('%"' || ? || '"%'))
       LIMIT 1`,
    ).bind(id, tenantId).first();
  } catch (_) {
    return null;
  }
}

export function metadataObject(row) {
  return parseJsonSafe(row?.features_json ?? row?.metadata_json, {}) || {};
}

export function rowIsGranite(row) {
  const mk = String(row?.model_key || '').toLowerCase();
  if (mk.includes('granite')) return true;
  const meta = metadataObject(row);
  if (meta.fallback_only === true) return true;
  return false;
}

/** External paid/cloud APIs — excludes Workers AI / Cloudflare-hosted chat fallbacks. */
export function rowIsExternalProvider(row) {
  const plat = String(row?.api_platform || '').toLowerCase();
  const prov = String(row?.provider || '').toLowerCase();
  if (plat === 'workers_ai' || prov === 'cloudflare') return false;
  return true;
}

export function normalizeGateParseFailure(originalMessage) {
  return { intent: 'auto', rewritten_query: originalMessage, confidence: 0.75 };
}

/** Map heuristic taskType + mode → routing arm intent_slug prefix (e.g. code_agent). */
export function intentSlugFromHeuristic(taskType, mode, modeConfig) {
  const tt = resolveThompsonArmTaskType(taskType || 'quick');
  const md =
    String(mode || modeConfig?.slug || modeConfig?.mode || 'agent').trim().toLowerCase() || 'agent';
  return `${tt}_${md}`;
}

/**
 * Classify for routing-arm slug selection.
 *
 * When `env.DB` is available: authority is {@link resolveTurnDecision} → one
 * `agentsam_intent_decisions` row (spine). Never use bare regex as authority.
 *
 * Mode-only turn shape — no keyword/heuristic classify.
 */
export async function gateRewriteAndClassify(_env, modeConfig, message, _tenantId) {
  const raw = String(message || '');
  const mode = String(modeConfig?.slug || modeConfig?.mode || 'agent').toLowerCase() || 'agent';
  return {
    intent: mode,
    rewritten_query: raw,
    confidence: 1,
    taskType: mode,
    mode,
    matchedBy: 'mode',
  };
}

/**
 * D1 agentsam_capability_aliases → preferred tool_key names for a classified taskType.
 * @param {any} env
 * @param {string} taskType
 * @returns {Promise<string[]>}
 */
/**
 * Arm outcome → single-writer applyRewardEvent (weight 0.5).
 * Inline pow(0.995) decay removed — decayRoutingArms() owns decay.
 *
 * Always ledger-writes. Presence of agentsam_performance_eto_events must NOT
 * skip learning — the old "ETO owns Thompson" early-exit only bumped
 * total_executions and left success_alpha/beta + cost_n frozen whenever
 * applyEtoToRoutingArms did not land a reward event (common in prod).
 * ETO batch apply remains a backfill and skips runs already in the ledger.
 */
export async function recordArmOutcome(env, ctx, armId, success, routingInfo) {
  if (!env.DB || !armId) return;
  try {
    const { applyRewardEvent, resolveTenantIdForReward } = await import('./reward-events.js');
    const arm = await env.DB.prepare(
      `SELECT id, workspace_id, task_type, model_key, provider FROM agentsam_routing_arms WHERE id = ? LIMIT 1`,
    )
      .bind(armId)
      .first();
    if (!arm?.id) return;
    let workspaceId =
      (routingInfo?.workspaceId != null ? String(routingInfo.workspaceId).trim() : '') ||
      (arm.workspace_id != null ? String(arm.workspace_id).trim() : '');
    if (!workspaceId) {
      workspaceId = (await resolveCronWorkspaceId(env)) || '';
      if (!workspaceId) {
        console.warn('[routing] recordArmOutcome skipped — no workspace_id');
        return;
      }
    }
    const routeKey = routingInfo?.routeKey ?? routingInfo?.chatRouteKey ?? null;
    const taskType = routeKey != null && String(routeKey).trim()
      ? armTaskTypeForRouteKey(routeKey, { mode: routingInfo?.mode })
      : resolveThompsonArmTaskType(
          (routingInfo?.taskType != null ? String(routingInfo.taskType).trim() : '') ||
            (arm.task_type != null ? String(arm.task_type).trim() : ''),
        );
    const tenantId = await resolveTenantIdForReward(env, {
      tenantId: routingInfo?.tenantId,
      workspaceId,
    });
    if (!tenantId) {
      console.warn('[routing] recordArmOutcome skipped — no tenant_id');
    } else {
      const runKey =
        routingInfo?.agentRunId != null
          ? String(routingInfo.agentRunId).trim()
          : `${armId}:${Math.floor(Date.now() / 1000)}`;
      await applyRewardEvent(env, {
        tenant_id: tenantId,
        workspace_id: workspaceId,
        task_type: taskType,
        route_key: routeKey,
        signal_type: success ? 'auto_success' : 'auto_error',
        signal_value: 0.5,
        signal_source: 'system',
        routing_arm_id: armId,
        model_key: routingInfo?.modelKey ?? arm.model_key ?? null,
        provider: arm.provider ?? null,
        apply_cost: false,
        apply_latency: false,
        apply_execution: true,
        agent_run_id: routingInfo?.agentRunId ?? null,
        failure_category: success ? null : routingInfo?.failure_category ?? null,
        dedup_key: `arm_outcome:${runKey}:${success ? 'ok' : 'err'}`,
        reason: 'recordArmOutcome',
      });
    }

    if (ctx?.waitUntil && routingInfo) {
      ctx.waitUntil(triggerEvalAfterNRuns(env, ctx, {
        armId,
        taskType: routingInfo.taskType,
        routeKey,
        mode: routingInfo.mode,
        modelKey: routingInfo.modelKey,
        workspaceId
      }).catch(e => console.warn('[eval] triggerEvalAfterNRuns failed:', e?.message)));
    }
  } catch (e) {
    console.warn('[routing] recordArmOutcome failed:', e?.message);
  }
}

/** Vague "create a skill" requests should interview first, not auto-run the plan executor. */
export function dedupeModelsByKey(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows || []) {
    const k = r?.model_key;
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

/** DB-driven tool-capable fallback chain (agentsam_model_catalog SSOT). */
export async function loadToolFallbackChain(env, opts = {}) {
  if (!env.DB) return [];
  const tenantId =
    opts.tenantId != null && String(opts.tenantId).trim() !== ''
      ? String(opts.tenantId).trim()
      : '';
  if (!tenantId) return [];
  void tenantId;
  const excludeModelKeys = Array.isArray(opts.excludeModelKeys)
    ? [...new Set(opts.excludeModelKeys.map((k) => String(k || '').trim()).filter(Boolean))]
    : [];
  const limRaw = Number(opts.limit);
  const lim = Number.isFinite(limRaw) && limRaw > 0 ? Math.min(Math.floor(limRaw), 50) : 3;
  try {
    let sql = `SELECT *
       FROM agentsam_model_catalog
       WHERE COALESCE(is_active, 1) = 1
         AND supports_tools = 1
         AND model_key IS NOT NULL
         AND LOWER(COALESCE(api_platform, provider, '')) NOT IN ('workers_ai', 'ollama', 'cloudflare')`;
    const binds = [];
    if (excludeModelKeys.length) {
      sql += ` AND model_key NOT IN (${excludeModelKeys.map(() => '?').join(',')})`;
      binds.push(...excludeModelKeys);
    }
    sql += ` ORDER BY COALESCE(cost_per_1k_in, 999999) ASC, display_name ASC LIMIT ?`;
    binds.push(lim);
    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    return (results || []).map(catalogRowToAiShape).filter(Boolean);
  } catch (_) {
    return [];
  }
}

export async function resolveAgentsamAiRowByModelKey(env, tenantId, modelKey) {
  if (!env.DB || !modelKey) return null;
  void tenantId;
  const mk = String(modelKey).trim();
  if (!mk) return null;
  try {
    const cat = await env.DB.prepare(
      `SELECT * FROM agentsam_model_catalog
       WHERE model_key = ? AND COALESCE(is_active, 1) = 1 LIMIT 1`,
    )
      .bind(mk)
      .first();
    if (cat) return catalogRowToAiShape(cat);
    if (!tenantId) return null;
    return await env.DB.prepare(
      `SELECT ${AI_MODEL_ROW_SQL}
       FROM agentsam_ai
       WHERE model_key = ?
         AND mode = 'model' AND status = 'active'
         AND (is_global = 1 OR allowed_tenants_json LIKE ('%"' || ? || '"%'))
       LIMIT 1`,
    ).bind(mk, tenantId).first();
  } catch (_) {
    return null;
  }
}

export async function loadAgentsamAiActiveModelKeysOrdered(env) {
  if (!env?.DB) return [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT model_key FROM agentsam_model_catalog
       WHERE COALESCE(is_active, 1) = 1
       ORDER BY provider ASC, display_name ASC LIMIT 40`,
    ).all();
    return (results || []).map((r) => String(r.model_key || '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Chat SSE tail of the model chain: `agentsam_routing_arms` (chat + mode + is_eligible, decayed_score),
 * resolved via `agentsam_model_catalog`; then catalog-ordered keys from D1 (no hardcoded SKUs).
 */
export async function loadChatRoutingFallbackRows(env, opts = {}) {
  const tenantId =
    opts.tenantId != null && String(opts.tenantId).trim() !== ''
      ? String(opts.tenantId).trim()
      : '';
  if (!tenantId) return [];
  const mode = opts.mode;
  const excludeModelKeys = Array.isArray(opts.excludeModelKeys)
    ? opts.excludeModelKeys.map((k) => String(k || '').trim()).filter(Boolean)
    : [];
  const excludeSet = new Set(excludeModelKeys);
  const requireTools = !!opts.requireTools;

  const ws =
    opts.workspaceId != null && String(opts.workspaceId).trim() !== ''
      ? String(opts.workspaceId).trim()
      : '';
  let keyOrder = await loadChatRoutingArmsModelKeyOrder(env, mode, ws, {
    toolRequired: requireTools,
    routeKey: opts.routeKey ?? null,
  });
  keyOrder = keyOrder.filter((k) => !excludeSet.has(k));

  const rows = [];
  const seen = new Set();
  const enrichWithRoutingArmId = async (r) => {
    if (!r?.model_key) return r;
    const lookup = await resolveRoutingArmByModelKey(env, {
      modelKey: String(r.model_key).trim(),
      taskType: 'chat',
      mode,
      workspaceId: ws,
    });
    return { ...r, routing_arm_id: lookup?.armId ?? null };
  };
  for (const mk of keyOrder) {
    const r = await resolveAgentsamAiRowByModelKey(env, tenantId, mk);
    if (r?.model_key && !seen.has(r.model_key)) {
      seen.add(r.model_key);
      rows.push(await enrichWithRoutingArmId(r));
    }
  }

  if (!rows.length) {
    for (const mk of await loadAgentsamAiActiveModelKeysOrdered(env)) {
      if (excludeSet.has(mk)) continue;
      const r = await resolveAgentsamAiRowByModelKey(env, tenantId, mk);
      if (r?.model_key && !seen.has(r.model_key)) {
        seen.add(r.model_key);
        rows.push(await enrichWithRoutingArmId(r));
      }
    }
  }

  return filterChainToolPolicy(rows, requireTools);
}

export function filterChainToolPolicy(rows, requireTools) {
  if (!requireTools || !rows?.length) return rows || [];
  return rows.filter((r) => Number(r.supports_tools) === 1);
}

/** AUTO routing: drop Granite when any non-Granite external provider is available in the pool. */
export function filterGraniteAutoChain(rows, externalNonGraniteExists) {
  if (!rows?.length) return [];
  if (!externalNonGraniteExists) return rows;
  return rows.filter((r) => !rowIsGranite(r));
}

export function withTimeout(promise, ms) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`timeout_after_${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

export async function runModelTierMigration(env) {
  // No-op: model tiers are managed and seeded in D1 (agentsam_model_tier).
  // Kept to avoid breaking older code paths that still call this function.
  void env;
}

export function kickoffModelTierMigration(env, ctx) {
  if (modelTierMigrationStarted) return;
  modelTierMigrationStarted = true;
  try {
    const p = runModelTierMigration(env).catch((e) => {
      console.warn('[agent] model tier migration failed:', e?.message);
    });
    ctx?.waitUntil?.(p);
  } catch (e) {
    console.warn('[agent] model tier migration kickoff failed:', e?.message);
  }
}

// ─── Approval Gate ────────────────────────────────────────────────────────────

