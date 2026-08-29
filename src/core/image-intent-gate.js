/**
 * image-intent-gate — GUTTED (pre-LLM nuke 2026-08).
 * No message → image fast path. Explicit composer_action / forceImage only (turn-decision).
 */

/**
 * @deprecated Always false.
 */
export function isExplicitImagePlanningIntent(_message) {
  return false;
}

/**
 * @deprecated Always false.
 */
export function isPrimaryImageGenerationIntentSync(_message, _kw = null) {
  return false;
}

/**
 * @deprecated Always false.
 */
export function hasImageGenerationIntentSync(_message, _kw = null) {
  return false;
}

/**
 * @deprecated Always false.
 */
export async function isPrimaryImageGenerationIntent(_env, _message, _ctx = {}) {
  return false;
}

/**
 * @returns {Promise<{isMatch: false, matchedBy: 'neither', reason: string}>}
 */
export async function evaluatePrimaryImageGenerationIntent(_env, _message, _ctx = {}) {
  return { isMatch: false, matchedBy: 'neither', reason: 'phase1_skip_llm_removed' };
}

/**
 * @deprecated Prefer turn-decision forceImage / composer_action only.
 */
export async function resolvePrimaryImageGenerationIntent(env, message, ctx = {}) {
  if (ctx.turnDecision?.imageIntent) {
    return {
      isMatch: !!ctx.turnDecision.imageIntent.isMatch,
      matchedBy: ctx.turnDecision.imageIntent.matchedBy || 'neither',
      reason: ctx.turnDecision.imageIntent.reason || 'turn_decision',
    };
  }
  return evaluatePrimaryImageGenerationIntent(env, message, ctx);
}

/**
 * @deprecated Always false — revision cues are not a pre-LLM router.
 */
export function isImageRevisionFollowUpCue(_message) {
  return false;
}
