/**
 * classify-intent — GUTTED (pre-LLM nuke 2026-08).
 * No keyword/heuristic/LLM message → taskType. Mode owns turn shape.
 */

/**
 * @deprecated Always false — URL nav is not a pre-LLM taskType router.
 * @param {string} _message
 */
export function messageHasBrowserUrlNavigation(_message) {
  return false;
}

/**
 * @deprecated Always mode-default chat — no regex matrix.
 * @param {string} _message
 */
export function inferIntentHeuristically(_message) {
  return {
    taskType: 'agent',
    mode: 'agent',
    confidence: 0,
    matchedBy: 'mode',
    escalateCue: false,
  };
}

/**
 * @deprecated No D1 keyword table reads on chat send.
 * @param {unknown} _env
 * @param {string} _message
 * @param {object} [_opts]
 */
export async function inferIntentFromKeywords(_env, _message, _opts = {}) {
  return inferIntentHeuristically('');
}

/**
 * @deprecated Never escalate — classifier path removed.
 * @param {string} _message
 * @param {object} [_kw]
 */
export function shouldEscalateChatIntent(_message, _kw) {
  return false;
}

/**
 * @deprecated No LLM intent classifier.
 * @param {unknown} _env
 * @param {string} _message
 * @param {object} [_opts]
 */
export async function classifyIntentWithModel(_env, _message, _opts = {}) {
  return inferIntentHeuristically('');
}

/**
 * @param {string} taskType
 * @param {string} mode
 * @param {{ confidence?: number, matchedBy?: string|null, escalated?: boolean, modelKey?: string|null, provider?: string|null, armId?: string|null, reason?: string|null }} [extra]
 */
export function buildClassifyResult(taskType, mode, extra = {}) {
  return {
    taskType: String(taskType || 'agent'),
    mode: String(mode || 'agent'),
    confidence: extra.confidence ?? 1,
    matchedBy: extra.matchedBy ?? 'mode',
    escalated: extra.escalated === true,
    intent: String(taskType || 'agent'),
    modelKey: extra.modelKey ?? null,
    provider: extra.provider ?? null,
    armId: extra.armId ?? null,
    reason: extra.reason ?? null,
  };
}

/**
 * Delegates to mode-only turn decision. No keyword front door.
 * @param {unknown} env
 * @param {string} message
 * @param {object} [ctx]
 */
export async function classifyIntent(env, message, ctx = {}) {
  void env;
  void message;
  const mode = String(ctx?.mode || 'agent').trim().toLowerCase() || 'agent';
  return buildClassifyResult(mode, mode, {
    confidence: 1,
    matchedBy: 'mode',
    escalated: false,
  });
}

/**
 * @deprecated No-op — classifier arm rewards retired from hot path.
 */
export async function recordIntentClassificationArmOutcome() {
  return { ok: false, reason: 'classifier_removed' };
}
