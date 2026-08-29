import { terminalLaneFromTargetType, targetTypeFromTerminalLane, transportNameForTerminalTarget } from './execution-plan.js';

/**
 * Hard-bind: return only the initial lane. Cross-lane FALLBACK is prohibited.
 * Export name kept for import stability; opts ignored for cascade purposes.
 */
export function resolveTerminalFallbackLanes(initialLane, _opts = {}) {
  const lane = String(initialLane || '').trim().toLowerCase();
  if (!lane) return [];
  return [lane];
}

export function terminalTargetCandidate(targetType, targetId = null) {
  const lane = terminalLaneFromTargetType(targetType);
  return {
    target_id: targetId || null,
    target_type: targetType || null,
    target_lane: lane,
    transport: transportNameForTerminalTarget(targetType, lane),
  };
}

/**
 * Single candidate for the requested target type (default platform_vm).
 * Never invents cross-lane 'auto' cascade.
 */
export async function resolveTerminalTargetCandidates(env, opts = {}) {
  const { requireTerminalTargetType } = await import('./execution-lane.js');
  let requestedType;
  try {
    requestedType = requireTerminalTargetType(opts.requestedType);
  } catch (e) {
    return [];
  }
  const pinnedId = String(opts.pinnedId || '').trim() || null;
  if (pinnedId) {
    return [terminalTargetCandidate(requestedType, pinnedId)];
  }
  return [terminalTargetCandidate(requestedType, null)];
}

export function targetTypeForFallbackLane(lane) {
  return targetTypeFromTerminalLane(lane);
}
