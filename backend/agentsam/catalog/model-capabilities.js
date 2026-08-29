/**
 * agentsam_model_catalog capability gates for Thompson routing + Anthropic dispatch.
 * Eligibility: route_key × tier (model class). Dead scout/workhorse/orchestrator/boss removed.
 */

/** Model class (tier) allowed per statistical route_key. */
export const ROUTE_KEY_ALLOWED_TIERS = Object.freeze({
  quick: Object.freeze(['lite', 'fast']),
  intent_classification: Object.freeze(['lite', 'fast']),
  general: Object.freeze(['lite', 'fast', 'standard']),
  summary: Object.freeze(['lite', 'fast', 'standard']),
  planning: Object.freeze(['standard', 'heavy', 'reasoning']),
  research: Object.freeze(['standard', 'heavy', 'reasoning']),
  rag: Object.freeze(['standard', 'heavy', 'reasoning']),
  code: Object.freeze(['standard', 'heavy', 'reasoning']),
  code_debug: Object.freeze(['standard', 'heavy', 'reasoning']),
  tool_orchestration: Object.freeze(['standard', 'heavy', 'reasoning']),
  vision: Object.freeze(['standard', 'heavy', 'specialized']),
  image_generation: Object.freeze(['specialized']),
  embeddings: Object.freeze(['specialized', 'lite', 'fast']),
});

/**
 * @param {string | null | undefined} raw
 * @returns {Record<string, string>}
 */
export function parseCostNotesCapabilities(raw) {
  const out = {};
  if (raw == null || String(raw).trim() === '') return out;
  for (const part of String(raw).split(';')) {
    const p = part.trim();
    if (!p || !p.includes('=')) continue;
    const i = p.indexOf('=');
    out[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  }
  return out;
}

/**
 * @param {Record<string, unknown> | null | undefined} row
 */
export function catalogCapabilitiesFromRow(row) {
  const notes = parseCostNotesCapabilities(row?.cost_notes);
  const lane =
    row?.routing_lane != null && String(row.routing_lane).trim() !== ''
      ? String(row.routing_lane).trim()
      : notes.routing_lane || 'unknown';

  const num = (col, noteKey, fallback) => {
    if (row && row[col] != null && row[col] !== '') {
      const n = Number(row[col]);
      if (Number.isFinite(n)) return n;
    }
    if (notes[noteKey] != null) {
      const v = notes[noteKey].toLowerCase();
      if (v === '1' || v === 'true') return 1;
      if (v === '0' || v === 'false') return 0;
    }
    return fallback;
  };

  const thinking =
    row?.thinking_policy != null && String(row.thinking_policy).trim() !== ''
      ? String(row.thinking_policy).trim()
      : notes.thinking_policy || 'omitted';

  const tier =
    row?.tier != null && String(row.tier).trim() !== ''
      ? String(row.tier).trim().toLowerCase()
      : 'unknown';

  const effortDefault =
    row?.effort_default != null && String(row.effort_default).trim() !== ''
      ? String(row.effort_default).trim().toLowerCase()
      : null;

  return {
    tier,
    routing_lane: lane,
    effort_default: effortDefault,
    effort_param:
      row?.effort_param != null && String(row.effort_param).trim() !== ''
        ? String(row.effort_param).trim()
        : null,
    supports_code_execution: num('supports_code_execution', 'supports_code_execution', 0) === 1,
    supports_compaction: num('supports_compaction', 'supports_compaction', 0) === 1,
    supports_effort_scaling: num('supports_effort_scaling', 'supports_effort_scaling', 0) === 1,
    supports_apply_patch: num('supports_apply_patch', 'supports_apply_patch', 0) === 1,
    supports_hosted_shell: num('supports_hosted_shell', 'supports_hosted_shell', 0) === 1,
    supports_programmatic_tool_calling:
      num(
        'supports_programmatic_tool_calling',
        'supports_programmatic_tool_calling',
        0,
      ) === 1,
    supports_realtime: num('supports_realtime', 'supports_realtime', 0) === 1,
    thinking_policy: thinking,
    max_context_tokens: Math.max(
      0,
      Math.floor(
        Number(row?.context_window) ||
          Number(notes.max_context) ||
          Number(notes.max_context_tokens) ||
          0,
      ),
    ),
    supports_prompt_cache:
      num('supports_cache', 'supports_prompt_cache', 0) === 1 ||
      num('supports_prompt_cache', 'supports_prompt_cache', 0) === 1,
  };
}

/**
 * route_key × tier gate. Unknown class with a known allowlist → deny (fail closed).
 * No allowlist for route → allow (legacy arm task_type paths).
 * @param {ReturnType<typeof catalogCapabilitiesFromRow>|null} cap
 * @param {string} routeKey
 * @param {boolean} toolRequired
 */
export function catalogAllowsRoute(cap, routeKey, toolRequired) {
  if (!cap) return true;
  const rk = String(routeKey || '').trim().toLowerCase();
  const allowed = ROUTE_KEY_ALLOWED_TIERS[rk];
  if (!allowed) return true;
  const tier = String(cap.tier || '').trim().toLowerCase();
  if (!tier || tier === 'unknown') return false;
  if (!allowed.includes(tier)) return false;
  if (
    toolRequired &&
    (rk === 'code' || rk === 'code_debug' || rk === 'tool_orchestration') &&
    !cap.supports_code_execution &&
    tier === 'lite'
  ) {
    return false;
  }
  return true;
}

/** @deprecated Use catalogAllowsRoute — kept as thin alias for any stragglers. */
export function catalogAllowsTask(cap, taskType, toolRequired) {
  return catalogAllowsRoute(cap, taskType, toolRequired);
}

/**
 * @param {any} env
 * @param {string} modelKey
 */
export async function loadCatalogCapabilities(env, modelKey) {
  const mk = modelKey != null ? String(modelKey).trim() : '';
  if (!mk || !env?.DB) return null;
  const select = ['model_key', 'context_window'];
  for (const c of [
    'tier',
    'effort_default',
    'effort_param',
    'routing_lane',
    'supports_code_execution',
    'supports_compaction',
    'supports_effort_scaling',
    'supports_apply_patch',
    'supports_hosted_shell',
    'supports_programmatic_tool_calling',
    'supports_realtime',
    'thinking_policy',
  ]) select.push(c);

  try {
    const row = await env.DB.prepare(
      `SELECT ${select.join(', ')} FROM agentsam_model_catalog WHERE model_key = ? AND is_active = 1 LIMIT 1`,
    )
      .bind(mk)
      .first();
    return row ? catalogCapabilitiesFromRow(row) : null;
  } catch {
    return null;
  }
}

/**
 * @param {any} env
 * @param {Array<Record<string, unknown>>} arms
 * @param {{ routeKey?: string, taskType?: string, toolRequired?: boolean }} q
 */
export async function filterArmsByCatalogCapabilities(env, arms, q) {
  if (!arms?.length || !env?.DB) return arms || [];
  const routeKey =
    q.routeKey != null && String(q.routeKey).trim()
      ? String(q.routeKey).trim()
      : q.taskType != null
        ? String(q.taskType).trim()
        : 'general';
  const toolReq = !!q.toolRequired;
  const keys = [...new Set(arms.map((a) => String(a.model_key || '').trim()).filter(Boolean))];
  if (!keys.length) return arms;

  const select = ['model_key', 'context_window'];
  for (const c of [
    'tier',
    'effort_default',
    'effort_param',
    'routing_lane',
    'supports_code_execution',
    'supports_compaction',
    'supports_effort_scaling',
    'supports_apply_patch',
    'supports_hosted_shell',
    'supports_programmatic_tool_calling',
    'supports_realtime',
    'thinking_policy',
  ]) select.push(c);

  const placeholders = keys.map(() => '?').join(',');
  let rows = [];
  try {
    const res = await env.DB.prepare(
      `SELECT ${select.join(', ')} FROM agentsam_model_catalog
       WHERE model_key IN (${placeholders}) AND is_active = 1`,
    )
      .bind(...keys)
      .all();
    rows = res.results || [];
  } catch {
    return arms;
  }

  const capByKey = Object.fromEntries(
    rows.map((r) => [String(r.model_key).trim(), catalogCapabilitiesFromRow(r)]),
  );

  return arms.filter((a) => {
    const mk = String(a.model_key || '').trim();
    const cap = capByKey[mk];
    if (!cap) return true;
    return catalogAllowsRoute(cap, routeKey, toolReq);
  });
}

/**
 * Features_json fragment for agentsam_ai / Anthropic integration.
 * @param {ReturnType<typeof catalogCapabilitiesFromRow> | null} cap
 */
export function anthropicFeaturesFromCatalogCapabilities(cap) {
  if (!cap) return {};
  return {
    compaction: cap.supports_compaction,
    anthropic_code_execution: cap.supports_code_execution,
    thinking: cap.thinking_policy === 'adaptive_and_enabled' || cap.thinking_policy === 'adaptive_only',
    effort_scaling: cap.supports_effort_scaling,
    thinking_policy: cap.thinking_policy,
    routing_lane: cap.routing_lane,
    tier: cap.tier,
    effort_default: cap.effort_default,
    /** Top-level automatic cache_control when agentsam_ai.supports_cache or features_json enables it. */
    prompt_cache: cap.supports_prompt_cache,
  };
}

// Legacy exports kept so anthropic.js / routing imports that still name scout sets do not throw.
// They are empty / unused for eligibility after the route×tier cutover.
export const SCOUT_TASK_TYPES = new Set([
  'intent_classification',
  'task_type_detection',
  'tool_prefilter',
  'cheap_summary',
  'file_relevance_triage',
  'sse_state_labeling',
  'prompt_risk_scan',
  'context_budget_estimation',
  'plan_title_generation',
  'small_json_transform',
]);
export const BUILDER_TASK_TYPES = new Set();
export const BOSS_TASK_TYPES = new Set();
