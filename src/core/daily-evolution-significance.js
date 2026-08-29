/**
 * Significance gate for daily_evolution_curator — v1 code-activity rules only.
 * SSOT: docs/platform/daily-evolution-curator-2026-08.md
 */

/** @param {Record<string, number>} subsystemCommits */
export function topSubsystems(subsystemCommits, limit = 3) {
  return Object.entries(subsystemCommits || {})
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .slice(0, Math.max(1, limit))
    .map(([name]) => name);
}

/**
 * @param {Record<string, unknown>|null|undefined} prior
 * @param {Record<string, unknown>|null|undefined} current
 */
export function coldToHotSubsystems(prior, current, limit = 3) {
  const priorHot = new Set(topSubsystems(prior?.subsystem_commits, limit));
  const currentHot = topSubsystems(current?.subsystem_commits, limit);
  return currentHot.filter((name) => name && !priorHot.has(name));
}

/**
 * v1: code activity only — router patch when work_mode shifts or a subsystem enters top-3 churn.
 * @param {{ available?: boolean, signals?: Record<string, unknown>, subsystem_commits?: Record<string, number> }} activity
 * @param {Record<string, unknown>|null|undefined} priorSnapshot value_json.signals from yesterday's brief
 */
export function evaluateCodeActivitySignificance(activity, priorSnapshot = null) {
  if (!activity?.available) {
    return {
      routerPatch: false,
      reasons: ['code_activity_unavailable'],
      signals: null,
    };
  }

  const signals = activity.signals || null;
  if (!signals) {
    return {
      routerPatch: false,
      reasons: ['signals_missing'],
      signals: null,
    };
  }

  if (!priorSnapshot) {
    return {
      routerPatch: true,
      reasons: ['no_prior_baseline'],
      signals,
      coldToHot: topSubsystems(activity.subsystem_commits, 3),
    };
  }

  const reasons = [];
  const priorMode = String(priorSnapshot.work_mode || '').trim();
  const curMode = String(signals.work_mode || '').trim();
  if (priorMode && curMode && priorMode !== curMode) {
    reasons.push(`work_mode:${priorMode}->${curMode}`);
  }

  const coldToHot = coldToHotSubsystems(priorSnapshot, activity, 3);
  if (coldToHot.length) {
    reasons.push(`cold_to_hot:${coldToHot.join(',')}`);
  }

  return {
    routerPatch: reasons.length > 0,
    reasons,
    signals,
    coldToHot,
  };
}
