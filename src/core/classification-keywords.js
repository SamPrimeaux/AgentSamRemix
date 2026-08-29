/**
 * classification-keywords — GUTTED (pre-LLM nuke 2026-08).
 * No runtime reads of agentsam_classification_keywords / agentsam_intent_keywords.
 */

/**
 * @deprecated Always empty — keyword tables retired from chat hot path.
 * @param {unknown} _env
 * @param {string} _purpose
 */
export async function loadClassificationKeywords(_env, _purpose) {
  return { patterns: [], re: null, source: 'removed' };
}

/**
 * @deprecated Always empty.
 * @param {unknown} _env
 * @param {string} _label
 */
export async function loadClassificationKeywordsByLabel(_env, _label) {
  return { patterns: [], re: null, source: 'removed' };
}

/**
 * @deprecated Empty bootstrap — image intent regex removed.
 */
export function getBootstrapImageIntentBundle() {
  return {
    primary: { re: null, patterns: [] },
    secondary: { re: null, patterns: [] },
    reject: { re: null, patterns: [] },
    revision: { re: null, patterns: [] },
  };
}

/**
 * @deprecated
 * @param {unknown} _env
 */
export async function loadImageIntentBundle(_env) {
  return getBootstrapImageIntentBundle();
}

/**
 * @deprecated Always null.
 * @param {string} _message
 * @param {object} [_kw]
 */
export function matchClassificationKeyword(_message, _kw) {
  return null;
}
