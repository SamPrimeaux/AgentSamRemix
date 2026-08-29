/**
 * agentsam_route_requirements — capability / SLA gates for routing arms.
 */
export async function loadRouteRequirementsRow(env, routeKey) {
  const rk = routeKey != null ? String(routeKey).trim() : '';
  if (!rk || !env?.DB) return null;
  return env.DB
    .prepare(`SELECT * FROM agentsam_route_requirements WHERE route_key = ? LIMIT 1`)
    .bind(rk)
    .first()
    .catch(() => null);
}

function parseBlockedProviders(raw) {
  if (raw == null || raw === '') return [];
  try {
    const j = JSON.parse(String(raw));
    return Array.isArray(j) ? j.map((x) => String(x || '').toLowerCase()) : [];
  } catch {
    return String(raw)
      .split(/[,|]/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
}

export function armMatchesRouteRequirements(arm, req) {
  if (!req) return true;
  if (Number(req.requires_tools) === 1 && Number(arm.supports_tools) !== 1) return false;
  if (Number(req.requires_vision) === 1) {
    const v = Number(arm.supports_vision);
    if (Number.isFinite(v) && v !== 1) return false;
  }
  if (Number(req.requires_json_mode) === 1) {
    const j = Number(arm.supports_structured_output);
    if (Number.isFinite(j) && j !== 1) return false;
  }
  const minQ = Number(req.min_quality_score);
  if (Number.isFinite(minQ) && minQ > 0) {
    const aq = Number(arm.avg_quality_score);
    const qn = Number(arm.quality_n);
    const coldStart = !Number.isFinite(qn) || qn < 5;
    if (!coldStart && (!Number.isFinite(aq) || aq < minQ)) return false;
  }
  const maxLat = Number(req.max_latency_p50_ms);
  if (Number.isFinite(maxLat) && maxLat > 0) {
    const lm = Number(arm.latency_mean);
    if (Number.isFinite(lm) && lm > maxLat) return false;
  }
  const maxCost = Number(req.max_cost_per_1k_in);
  if (Number.isFinite(maxCost) && maxCost > 0) {
    const cap = Number(arm.max_cost_per_call_usd);
    if (Number.isFinite(cap) && cap > maxCost) return false;
  }
  const blocked = parseBlockedProviders(req.blocked_providers);
  if (blocked.length) {
    const p = String(arm.provider || '').toLowerCase();
    if (blocked.includes(p)) return false;
  }
  const prefTier = req.preferred_tier != null ? String(req.preferred_tier).trim() : '';
  if (prefTier && arm.preferred_tier != null && String(arm.preferred_tier).trim() !== prefTier) {
    return false;
  }
  return true;
}

/**
 * Filter pre-fetched arms by `agentsam_route_requirements` for `route_key` (capability / SLA gates).
 * @param {any} env
 * @param {string | null | undefined} routeKey
 * @param {Record<string, unknown>[] | null | undefined} arms
 */
export async function filterArmsForRouteKey(env, routeKey, arms) {
  const req = await loadRouteRequirementsRow(env, routeKey);
  if (!req || !arms?.length) return arms || [];
  return arms.filter((a) => armMatchesRouteRequirements(a, req));
}

function buildRouteRejectMessage(req, modelKey, routeKey) {
  const mk = modelKey != null ? String(modelKey).trim() : 'model';
  const rk = routeKey != null ? String(routeKey).trim() : 'route';
  const parts = [`"${mk}" does not meet policy for route "${rk}".`];
  if (Number(req?.requires_tools) === 1) parts.push('This route requires a tool-capable model.');
  if (Number(req?.requires_vision) === 1) parts.push('This route requires vision support.');
  if (Number(req?.requires_json_mode) === 1) parts.push('This route requires structured JSON output support.');
  const blocked = parseBlockedProviders(req?.blocked_providers);
  if (blocked.length) parts.push(`Blocked providers for this route: ${blocked.join(', ')}.`);
  const minQ = Number(req?.min_quality_score);
  if (Number.isFinite(minQ) && minQ > 0) {
    parts.push(`Minimum quality score ${minQ} not met.`);
  }
  const maxLat = Number(req?.max_latency_p50_ms);
  if (Number.isFinite(maxLat) && maxLat > 0) {
    parts.push(`Latency must be at or below ${maxLat}ms (p50).`);
  }
  parts.push('Use Auto routing or choose another model.');
  return parts.join(' ');
}

/**
 * Merge agentsam_ai picker row with agentsam_routing_arms telemetry for route SLA checks.
 * @param {Record<string, unknown> | null | undefined} aiRow
 * @param {Record<string, unknown> | null | undefined} armRow
 */
export function mergeAiRowWithRoutingArmForPolicy(aiRow, armRow) {
  const ai = aiRow && typeof aiRow === 'object' ? aiRow : {};
  const arm = armRow && typeof armRow === 'object' ? armRow : {};
  return {
    ...arm,
    model_key: arm.model_key ?? ai.model_key,
    supports_tools: arm.supports_tools ?? ai.supports_tools,
    supports_vision: arm.supports_vision ?? ai.supports_vision,
    supports_structured_output: arm.supports_structured_output ?? ai.supports_structured_output,
    provider: arm.provider ?? ai.provider,
    avg_quality_score: arm.avg_quality_score,
    latency_mean: arm.latency_mean,
    max_cost_per_call_usd: arm.max_cost_per_call_usd,
    preferred_tier: arm.preferred_tier,
  };
}

/**
 * Cursor-style explicit pick gate: reject when model cannot satisfy agentsam_route_requirements.
 * @returns {Promise<{ ok: true } | { ok: false, code: string, message: string }>}
 */
export async function validateModelAgainstRouteRequirements(
  env,
  { routeKey, aiRow, armRow, taskType, modelKey } = {},
) {
  const rk = routeKey != null ? String(routeKey).trim() : '';
  if (!rk) return { ok: true };
  const req = await loadRouteRequirementsRow(env, rk);
  if (!req) return { ok: true };
  let policyRow = mergeAiRowWithRoutingArmForPolicy(aiRow, armRow);
  const mk =
    modelKey != null && String(modelKey).trim() !== ''
      ? String(modelKey).trim()
      : policyRow.model_key != null
        ? String(policyRow.model_key).trim()
        : '';
  if (Number(req.requires_tools) === 1 && Number(policyRow.supports_tools) !== 1 && env?.DB && mk) {
    try {
      const cat = await env.DB.prepare(
        `SELECT supports_tools, supports_json_mode
         FROM agentsam_model_catalog WHERE model_key = ? AND is_active = 1 LIMIT 1`,
      )
        .bind(mk)
        .first();
      if (cat) {
        policyRow = {
          ...policyRow,
          model_key: mk,
          supports_tools: cat.supports_tools ?? policyRow.supports_tools,
          supports_structured_output:
            cat.supports_json_mode ?? policyRow.supports_structured_output,
        };
      }
    } catch {
      /* non-fatal */
    }
  }
  if (armMatchesRouteRequirements(policyRow, req)) return { ok: true };
  const label = mk || 'model';
  return {
    ok: false,
    code: 'route_model_requirements_not_met',
    message: buildRouteRejectMessage(req, label, rk),
  };
}
