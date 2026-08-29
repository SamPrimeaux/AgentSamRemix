/**
 * Plan mode message normalization + UX heuristics (Cursor parity).
 */

const PLAN_PREFIX_RE = /^\/plan\b\s*/i;
const REFINE_PREFIX_RE = /^(?:@plan\b|refine\s+plan:?)\s*/i;

/**
 * @param {string} message
 * @param {Record<string, unknown>} [body]
 */
export function normalizePlanModeMessage(message, body = {}) {
  let msg = String(message || '').trim();
  let forcePlan = false;
  let refinePlanId = null;

  const bodyPlanId = String(body.plan_id ?? body.planId ?? body.active_plan_id ?? '').trim();

  if (PLAN_PREFIX_RE.test(msg)) {
    forcePlan = true;
    msg = msg.replace(PLAN_PREFIX_RE, '').trim();
  }

  if (REFINE_PREFIX_RE.test(msg)) {
    forcePlan = true;
    refinePlanId = bodyPlanId || null;
    msg = msg.replace(REFINE_PREFIX_RE, '').trim();
  }

  if (body.force_plan_mode === true || body.forcePlanMode === true) {
    forcePlan = true;
  }

  return { message: msg, forcePlan, refinePlanId, goal: msg };
}

/**
 * Suggest Plan mode for complex / vague goals (composer banner).
 * @param {string} text
 */
export function suggestPlanMode(text) {
  const m = String(text || '').trim();
  if (!m || m.length < 12) return false;
  if (PLAN_PREFIX_RE.test(m)) return false;
  const words = m.split(/\s+/).filter(Boolean);
  if (words.length >= 12) return true;
  if (/\b(refactor|architect|migration|multi-?file|across|sprint|roadmap|strategy|redesign)\b/i.test(m)) {
    return true;
  }
  if (/\b(api|dashboard|worker|supabase|d1|schema|workflow)\b.*\b(and|plus|with)\b/i.test(m)) {
    return true;
  }
  const specific =
    /[/.`]|\.(js|ts|tsx|sql|md)\b|src\/|dashboard\//i.test(m);
  if (!specific && words.length >= 8) return true;
  return false;
}

/** @param {readonly { id: string }[]} modes @param {string} current */
export function nextAgentMode(modes, current) {
  const ids = modes.map((m) => m.id);
  const idx = ids.indexOf(current);
  const next = idx < 0 ? 0 : (idx + 1) % ids.length;
  return ids[next] || 'agent';
}
