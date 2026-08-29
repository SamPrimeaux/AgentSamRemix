/**
 * rag-intent-router — GUTTED (pre-LLM nuke 2026-08).
 */

/** @deprecated Always empty. */
export async function loadRagIntentRoutes(_env) {
  return [];
}

/** @deprecated Always null. */
export function classifyRagIntentKey(_message) {
  return null;
}

/** @deprecated No message → lane order. */
export async function resolveRagIntentLaneOrder(_env, _message) {
  return { primary_lane: null, order: [], source: 'removed' };
}
