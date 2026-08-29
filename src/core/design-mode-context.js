/**
 * Design Mode — detect from browserContext (no composer mode).
 * When active, session binds agentsam_tool_profiles.profile_key = design_mode.
 */

/**
 * @param {unknown} browserContext
 * @returns {boolean}
 */
export function isDesignModeBrowserContext(browserContext) {
  if (!browserContext || typeof browserContext !== 'object') return false;
  const bc = /** @type {Record<string, unknown>} */ (browserContext);
  const dm = bc.design_mode ?? bc.designMode;
  if (dm && typeof dm === 'object') {
    const active = /** @type {Record<string, unknown>} */ (dm).active;
    if (active === true || active === 1 || String(active).trim().toLowerCase() === 'true') {
      return true;
    }
  }
  if (bc.design_mode_active === true || bc.design_mode_active === 1) return true;
  return false;
}

/**
 * @param {Record<string, unknown>|null|undefined} body
 * @returns {boolean}
 */
export function isDesignModeActiveFromBody(body) {
  if (!body || typeof body !== 'object') return false;
  let browserContext = body.browserContext ?? body.browser_context ?? null;
  if (typeof browserContext === 'string') {
    try {
      browserContext = JSON.parse(browserContext);
    } catch {
      browserContext = null;
    }
  }
  if (isDesignModeBrowserContext(browserContext)) return true;
  const wc = body.workspaceContext ?? body.workspace_context;
  if (wc && typeof wc === 'object') {
    const nested =
      /** @type {Record<string, unknown>} */ (wc).browserContext ||
      /** @type {Record<string, unknown>} */ (wc).design_mode;
    if (isDesignModeBrowserContext(wc) || isDesignModeBrowserContext(nested)) return true;
  }
  return false;
}
