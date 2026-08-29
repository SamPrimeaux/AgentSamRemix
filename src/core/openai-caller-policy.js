/**
 * OpenAI Programmatic Tool Calling — agentsam_tools.caller_policy SSOT (fail-closed).
 *
 * Wire values match OpenAI Responses `allowed_callers`:
 *   omitted / ["direct"] | ["programmatic"] | ["direct","programmatic"]
 *
 * NULL / missing / invalid policy ⇒ ["direct"] only (never open-default to programmatic).
 * Writes / approvals / terminal mutations must stay direct-only in D1 seeds.
 *
 * Defer-loading law (tkt_oai_ptc_schemas): any tool whose effective callers include
 * "programmatic" must NOT set defer_loading:true — programs cannot run tool_search.
 * Prefer excluding defer_loading; alternatively preload the full programmatic-eligible
 * set when openai_ptc=1 (see migrations/985 + agentsam_tools.caller_policy).
 */

const ALLOWED = new Set(['direct', 'programmatic']);

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
export function parseCallerPolicy(raw) {
  if (raw == null || raw === '') return ['direct'];
  let parsed = raw;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return ['direct'];
    try {
      parsed = JSON.parse(t);
    } catch {
      return ['direct'];
    }
  }
  if (!Array.isArray(parsed) || !parsed.length) return ['direct'];
  const out = [];
  const seen = new Set();
  for (const item of parsed) {
    const v = String(item || '')
      .trim()
      .toLowerCase();
    if (!ALLOWED.has(v) || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out.length ? out : ['direct'];
}

/**
 * @param {unknown} rawPolicy
 * @returns {boolean}
 */
export function callerPolicyAllowsProgrammatic(rawPolicy) {
  return parseCallerPolicy(rawPolicy).includes('programmatic');
}

/**
 * Map D1 caller_policy → Responses `allowed_callers`.
 * When PTC flag is off, never advertise programmatic (fail-closed on the wire).
 *
 * @param {unknown} rawPolicy
 * @param {{ openaiPtcEnabled?: boolean }} [opts]
 * @returns {string[]}
 */
export function allowedCallersFromCallerPolicy(rawPolicy, opts = {}) {
  const policy = parseCallerPolicy(rawPolicy);
  if (opts.openaiPtcEnabled === true) return policy;
  return ['direct'];
}

/**
 * Normalize OpenAI caller.type from a function_call item (or string).
 * @param {unknown} caller
 * @returns {'direct'|'programmatic'}
 */
export function normalizeFunctionCallCallerType(caller) {
  if (caller == null || caller === '') return 'direct';
  if (typeof caller === 'string') {
    const t = caller.trim().toLowerCase();
    if (t === 'program' || t === 'programmatic') return 'programmatic';
    return 'direct';
  }
  if (typeof caller === 'object') {
    const t = String(caller.type || '')
      .trim()
      .toLowerCase();
    if (t === 'program' || t === 'programmatic') return 'programmatic';
  }
  return 'direct';
}

/**
 * Invoke-time re-check: even if the model somehow requests programmatic on a
 * direct-only tool, deny (same authz surface as wire policy).
 *
 * @param {unknown} rawPolicy
 * @param {unknown} caller
 * @returns {{ ok: true } | { ok: false, reason: string, allowed_callers: string[], caller_type: string }}
 */
export function assertCallerAllowedAtInvoke(rawPolicy, caller) {
  const allowed = parseCallerPolicy(rawPolicy);
  const callerType = normalizeFunctionCallCallerType(caller);
  if (callerType === 'programmatic' && !allowed.includes('programmatic')) {
    return {
      ok: false,
      reason: 'caller_policy_denies_programmatic',
      allowed_callers: allowed,
      caller_type: callerType,
    };
  }
  if (callerType === 'direct' && !allowed.includes('direct')) {
    return {
      ok: false,
      reason: 'caller_policy_denies_direct',
      allowed_callers: allowed,
      caller_type: callerType,
    };
  }
  return { ok: true };
}

/**
 * Strip defer_loading when programmatic is allowed (OpenAI: deferred tools are
 * unavailable to programs until tool_search loads them; a running program cannot search).
 *
 * @param {Record<string, unknown>} toolDef
 * @param {string[]} allowedCallers
 * @returns {Record<string, unknown>}
 */
export function applyDeferLoadingLaw(toolDef, allowedCallers) {
  if (!toolDef || typeof toolDef !== 'object') return toolDef;
  if (!Array.isArray(allowedCallers) || !allowedCallers.includes('programmatic')) {
    return toolDef;
  }
  if (toolDef.defer_loading === true) {
    const { defer_loading: _drop, ...rest } = toolDef;
    return rest;
  }
  return toolDef;
}
