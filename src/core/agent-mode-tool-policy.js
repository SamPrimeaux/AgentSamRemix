/**
 * Compatibility adapter for callers that still expect a mode policy object.
 * Tool-name authorization was removed in favor of D1 capability evaluation
 * after canonical agentsam_tools resolution.
 */

/** @typedef {{ allowTools: string[], denyTools: string[], requireApprovalTools: string[] }} ModeToolPolicy */

/**
 * @param {string} modeSlug
 */
function basePolicyForMode(modeSlug) {
  void modeSlug;
  /** @type {ModeToolPolicy} */
  return { allowTools: [], denyTools: [], requireApprovalTools: [] };
}

/**
 * @param {any} env
 * @param {string} modeSlug
 * @param {{ routeKey?: string|null, taskType?: string|null }} [opts]
 * @returns {Promise<ModeToolPolicy>}
 */
export async function loadModeToolPolicy(env, modeSlug, opts = {}) {
  void env;
  void opts;
  return basePolicyForMode(modeSlug);
}
