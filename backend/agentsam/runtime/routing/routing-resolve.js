/**
 * Routing resolve path — task type mapping and arm selection for chat/auto.
 */
import { pickRoutingArmByThompson } from './thompson.js';
import { normalizeCanonicalTaskType, resolveThompsonArmTaskType } from './resolve-model-task-types.js';
import { filterArmsByCatalogCapabilities } from '../../catalog/model-capabilities.js';
import { isThompsonRoutingSamplingEnabled } from './routing-thompson-flag.js';
import {
  filterArmsForRouteKey,
  mergeModelRoutingMemoryPriors,
  queryRoutingArmsCandidates,
} from './routing-arms.js';

/** Task types that must keep their arm pool when tools are required (CDT / browser dispatch). */
const BROWSER_COMPUTER_USE_TASK_TYPES = new Set([
  'browser',
  'browser_ui_repair',
  'debug_live_page',
  'agent',
]);

/** Gate intent slugs → work intents (never execution modes). */
const INTENT_SLUG_TO_ROUTING_TASK = {
  question: 'project_question',
  explain: 'explain',
  code_help: 'search_code',
  fix_bug: 'search_code',
  write_code: 'code',
  plan: 'plan',
  deploy: 'deploy',
  // Bare "sql" is under-specified (D1 vs Supabase). Prefer d1_query; plane-specific
  // callers should pass task_type explicitly.
  sql: 'd1_query',
  sql_d1: 'sql_d1_generation',
  sql_supabase: 'supabase_query',
  summarize: 'summary',
  rag: 'rag',
  web_search: 'web_search',
  browser: 'browser',
  image_generation: 'image_generation',
};

/**
 * Map gate intent + request flags to `agentsam_routing_arms.task_type` (no tenant/workspace literals).
 * @param {{ intentSlug?: string, requireTools?: boolean, intentTaskType?: string, body?: Record<string, unknown> | null }} ctx
 */
export function resolveRoutingTaskType(ctx = {}) {
  const body = ctx.body && typeof ctx.body === 'object' ? ctx.body : {};
  const fromBody = body.task_type ?? body.taskType;
  if (fromBody != null && String(fromBody).trim() !== '') {
    return normalizeCanonicalTaskType(String(fromBody).trim());
  }
  const fromIntent = ctx.intentTaskType != null ? String(ctx.intentTaskType).trim() : '';
  if (fromIntent && BROWSER_COMPUTER_USE_TASK_TYPES.has(fromIntent)) {
    return normalizeCanonicalTaskType(fromIntent === 'browser' ? 'browser' : fromIntent);
  }
  // Debug/multitask/agent are execution modes — map to work intents for model arms.
  if (body.debug === true || String(body.mode || '').toLowerCase() === 'debug') return 'code';
  if (body.subagent === true || (body.subagent_profile_id != null && String(body.subagent_profile_id).trim() !== '')) {
    return 'workflow_orchestration';
  }
  if (body.workflow_step === true || body.workflow_run_id != null) return 'workflow_orchestration';
  if (body.terminal_session_id != null || body.pty_session_id != null) return 'terminal_execution';
  if (body.intent_classification_only === true) return 'intent_classification';
  if (body.rag_only === true || body.memory_search_only === true) return 'rag';
  if (body.skill_pick_only === true) return 'skill_invocation';
  if (ctx.requireTools) return 'tool_use';
  const slug = String(ctx.intentSlug ?? '').toLowerCase().trim();
  const mapped = INTENT_SLUG_TO_ROUTING_TASK[slug];
  if (!mapped) return 'quick';
  return normalizeCanonicalTaskType(mapped);
}

/**
 * Resolve default model for a task using Thompson sampling over D1 arms.
 * Falls back to static routing when table missing, empty, or on error (caller unchanged).
 *
 * @param {{ DB?: import('@cloudflare/workers-types').D1Database }} env
 * @param {{
 *   taskKey?: string,
 *   tenantId?: string | null,
 *   workspaceId?: string | null,
 *   mode?: string,
 *   toolRequired?: boolean,
 *   routeKey?: string | null,
 *   userId?: string | null,
 *   tenantId?: string | null,
 * }} ctx
 * @returns {Promise<{ modelId: string | null, armId: string | null, source: 'thompson' | 'fallback', fallbackReason?: string, fallbackModelKey?: string | null }>}
 */
export async function getDefaultModelForTask(env, ctx = {}) {
  try {
    const db = env?.DB;
    if (!db) {
      return { modelId: null, armId: null, source: 'fallback', fallbackReason: 'no_db' };
    }
    const workspaceId = ctx.workspaceId != null ? String(ctx.workspaceId).trim() : '';
    if (!workspaceId) {
      return { modelId: null, armId: null, source: 'fallback', fallbackReason: 'missing_workspace' };
    }
    const rawTaskKey =
      ctx.taskKey != null && String(ctx.taskKey).trim() !== ''
        ? String(ctx.taskKey).trim()
        : 'quick';
    // Modes / empty coerce via resolveThompsonArmTaskType (never throw).
    const taskType = resolveThompsonArmTaskType(rawTaskKey);
    const mode = ctx.mode != null && String(ctx.mode).trim() !== '' ? String(ctx.mode).trim() : 'agent';
    let arms = await queryRoutingArmsCandidates(env, {
      taskType,
      mode,
      workspaceId,
      toolRequired: !!ctx.toolRequired,
      routeKey: ctx.routeKey ?? null,
    });
    arms = await filterArmsForRouteKey(env, ctx.routeKey ?? null, arms);
    arms = await mergeModelRoutingMemoryPriors(env, workspaceId, taskType, arms, mode);
    const useThompson = await isThompsonRoutingSamplingEnabled(env, {
      userId: ctx.userId,
      tenantId: ctx.tenantId,
    });
    const arm = useThompson ? pickRoutingArmByThompson(arms) : arms[0] ?? null;
    if (!arm?.model_key) {
      return { modelId: null, armId: null, source: 'fallback', fallbackReason: 'no_eligible_arms' };
    }
    const mk = String(arm.model_key);
    const armId = arm.id != null ? String(arm.id).trim() : '';
    const fallbackModelKey =
      arm.fallback_model_key != null && String(arm.fallback_model_key).trim() !== ''
        ? String(arm.fallback_model_key).trim()
        : null;
    const catRow = await db
      .prepare(
        `SELECT id FROM agentsam_model_catalog WHERE model_key = ? AND is_active = 1 LIMIT 1`,
      )
      .bind(mk)
      .first()
      .catch(() => null);
    const modelId = catRow?.id != null ? String(catRow.id).trim() : '';
    if (!modelId) {
      return {
        modelId: null,
        armId: armId || null,
        source: 'fallback',
        fallbackReason: 'unknown_model_key',
        fallbackModelKey: fallbackModelKey || mk,
      };
    }
    return {
      modelId,
      armId: armId || null,
      source: 'thompson',
      fallbackModelKey,
    };
  } catch (e) {
    return {
      modelId: null,
      armId: null,
      source: 'fallback',
      fallbackReason: String(e?.message || e || 'routing_error'),
    };
  }
}

/**
 * Single-query routing arm resolution (workspace + global arms in one scan).
 * Replaces sequential getDefaultModelForTask + selectThompsonArm for chat turns.
 *
 * @param {object} env
 * @param {{ taskType: string, mode?: string, workspaceId: string, routeKey?: string|null,
 *            userId?: string|null, tenantId?: string|null, toolRequired?: boolean }}
 *          [opts]
 * @returns {Promise<{ source: 'thompson', modelId: string, modelKey: string, provider: string|null,
 *                     armId: string, taskType: string } | null>}
 */
export async function resolveRoutingArm(
  env,
  {
    taskType,
    intentSlug,
    mode,
    workspaceId,
    routeKey,
    userId,
    tenantId,
    toolRequired,
    excludeModelKeys,
  } = {},
) {
  if (!env?.DB || !taskType || !workspaceId) return null;
  const intentTaskType = normalizeCanonicalTaskType(taskType);
  const tt = resolveThompsonArmTaskType(intentTaskType);
  const md = mode != null && String(mode).trim() !== '' ? String(mode).trim() : 'agent';
  const ws = String(workspaceId).trim();
  const intent = String(intentSlug || '').trim().toLowerCase();
  const exclude = new Set(
    (Array.isArray(excludeModelKeys) ? excludeModelKeys : [])
      .map((k) => String(k || '').trim())
      .filter(Boolean),
  );
  try {
    let arms = await queryRoutingArmsCandidates(env, {
      taskType: tt,
      mode: md,
      workspaceId: ws,
      toolRequired: !!toolRequired,
      routeKey: routeKey ?? null,
    });
    if (intent) {
      arms = arms.filter((a) => {
        if (String(a.task_type ?? '').trim() === tt) return true;
        const armIntent = a.intent_slug != null ? String(a.intent_slug).trim().toLowerCase() : '';
        if (!armIntent) return false;
        return armIntent === intent || armIntent.startsWith(`${intent}_`);
      });
    }
    if (!arms.length) return null;

    arms = await filterArmsForRouteKey(env, routeKey ?? null, arms);
    if (!arms.length) return null;

    arms = await filterArmsByCatalogCapabilities(env, arms, {
      routeKey: routeKey ?? null,
      taskType: tt,
      toolRequired: !!toolRequired,
    });
    if (!arms.length) return null;

    arms = await mergeModelRoutingMemoryPriors(env, ws, tt, arms, md);

    if (exclude.size) {
      arms = arms.filter((a) => !exclude.has(String(a.model_key || '').trim()));
    }
    if (!arms.length) return null;

    const useThompson = await isThompsonRoutingSamplingEnabled(env, { userId, tenantId });
    const arm = useThompson
      ? pickRoutingArmByThompson(arms, { excludeModelKeys: [...exclude] })
      : (arms[0] ?? null);
    if (!arm?.model_key) return null;

    const mk = String(arm.model_key).trim();
    const catRow = await env.DB.prepare(
      `SELECT id, api_platform, provider FROM agentsam_model_catalog
       WHERE model_key = ? AND is_active = 1 LIMIT 1`,
    )
      .bind(mk)
      .first()
      .catch(() => null);
    const modelIdRaw = catRow?.id != null ? String(catRow.id).trim() : '';
    if (!modelIdRaw) return null;

    const armId = arm.id != null ? String(arm.id).trim() : '';
    return {
      source: 'thompson',
      modelId: modelIdRaw,
      modelKey: mk,
      provider:
        catRow?.api_platform != null
          ? String(catRow.api_platform)
          : catRow?.provider != null
            ? String(catRow.provider)
            : arm.provider != null
              ? String(arm.provider)
              : null,
      armId,
      taskType: tt,
    };
  } catch (e) {
    console.warn('[resolveRoutingArm]', e?.message ?? e);
    return null;
  }
}

/** Alias for {@link getDefaultModelForTask} — Thompson arm pick for auto model. */
export async function selectAutoModel(env, ctx = {}) {
  return getDefaultModelForTask(env, ctx);
}
