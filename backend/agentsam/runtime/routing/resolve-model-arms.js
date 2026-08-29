/**
 * Routing-arm pool helpers for Thompson (diversify, dedupe, forced explore).
 */

export const THOMPSON_CANDIDATE_LIMIT = 8;

/** Forced-exploration floor for under-sampled arms (alpha+beta). */
const THOMPSON_FORCE_EXPLORE_RATE = 0.03;
const THOMPSON_UNDER_SAMPLED_AB = 4;

/**
 * Thompson must not sample only the top-N priority rows (Anthropic scouts at 200+ block OpenAI).
 * @param {Array<Record<string, unknown>>} arms
 * @param {number} cap
 */
export function diversifyArmsForThompsonDraw(arms, cap = THOMPSON_CANDIDATE_LIMIT) {
  const list = Array.isArray(arms) ? arms : [];
  if (!list.length) return [];
  const byProvider = new Map();
  for (const arm of list) {
    const p = String(arm.provider || 'unknown').trim().toLowerCase() || 'unknown';
    if (!byProvider.has(p)) byProvider.set(p, []);
    byProvider.get(p).push(arm);
  }
  const providers = [...byProvider.keys()];
  const pool = [];
  let guard = 0;
  while (pool.length < cap && guard < cap * Math.max(providers.length, 1) * 2) {
    guard += 1;
    for (const p of providers) {
      const bucket = byProvider.get(p);
      if (bucket?.length && pool.length < cap) pool.push(bucket.shift());
    }
  }
  return pool.length ? pool : list.slice(0, cap);
}

/**
 * Global bandit row: empty workspace_id. Workspace clones are not in the pool.
 */
export function isGlobalRoutingArm(arm) {
  return !String(arm?.workspace_id ?? '').trim();
}

/**
 * One global arm per model_key. Workspace clones are dropped even if they
 * have a higher decayed_score — workspace is not a Thompson dimension.
 * @param {Array<Record<string, unknown>>} arms
 */
export function preferGlobalArmPerModelKey(arms) {
  const list = (Array.isArray(arms) ? arms : []).filter(isGlobalRoutingArm);
  /** @type {Map<string, Record<string, unknown>>} */
  const byMk = new Map();
  for (const arm of list) {
    const mk = String(arm?.model_key || '').trim();
    if (!mk) continue;
    const prev = byMk.get(mk);
    if (!prev) {
      byMk.set(mk, arm);
      continue;
    }
    const prevScore = Number(prev?.decayed_score) || 0;
    const nextScore = Number(arm?.decayed_score) || 0;
    if (nextScore > prevScore) {
      byMk.set(mk, arm);
    } else if (nextScore === prevScore) {
      const prevPriority = Number(prev?.priority) || 0;
      const nextPriority = Number(arm?.priority) || 0;
      if (nextPriority > prevPriority) byMk.set(mk, arm);
    }
  }
  return [...byMk.values()];
}

/**
 * With small probability, put under-sampled arms first so new/global twins get traffic.
 * @param {Array<Record<string, unknown> & { draw?: number }>} ranked
 */
export function applyForcedExplorationFloor(ranked, opts = {}) {
  const list = Array.isArray(ranked) ? ranked.slice() : [];
  if (list.length < 2) return list;
  const rate = Number(opts.rate ?? THOMPSON_FORCE_EXPLORE_RATE);
  const thr = Number(opts.underSampledAb ?? THOMPSON_UNDER_SAMPLED_AB);
  const roll = typeof opts.random === 'function' ? opts.random() : Math.random();
  if (!(rate > 0) || roll >= rate) return list;
  const under = list.filter((a) => {
    const ab = (Number(a.success_alpha) || 1) + (Number(a.success_beta) || 1);
    return ab < thr;
  });
  if (!under.length) return list;
  const pick =
    under[Math.floor((typeof opts.random === 'function' ? opts.random() : Math.random()) * under.length)];
  return [pick, ...list.filter((a) => a !== pick)];
}
