import { isDesignModeActiveFromBody } from './design-mode-context.js';

export { isDesignModeActiveFromBody, isDesignModeBrowserContext } from './design-mode-context.js';

/**
 * Resolve which agentsam_tool_profile_bindings.task_type drives the session menu.
 * Prefer explicit task_type, then route/surface, else composer mode.
 * Design Mode is NOT a composer mode — when browserContext.design_mode.active,
 * Agent/Multitask auto-bind profile design_mode (user never swaps modes).
 * @param {string} composerMode
 * @param {Record<string, unknown>|null|undefined} body
 */
export function resolveSessionProfileTaskType(composerMode, body) {
  const mode = String(composerMode || 'agent').trim().toLowerCase() || 'agent';
  const task = String(body?.task_type || '').trim().toLowerCase();
  if (task) return task;

  // Plan / Ask / Debug own their kits — Design Mode browser toggle does not override.
  if (mode === 'plan' || mode === 'ask' || mode === 'debug') return mode;

  const route = String(body?.route_key || '').trim().toLowerCase();
  if (
    route === 'design_studio_base' ||
    route === 'cad_generation' ||
    route === 'meshy_generate' ||
    route === 'meshy_transform' ||
    route === 'meshy_animation' ||
    route === 'meshy_manage'
  ) {
    return route;
  }
  if (route === 'design_studio') return 'design_studio_base';
  if (
    route === 'database_studio' ||
    route === 'database_schema' ||
    route === 'd1_query' ||
    route === 'supabase_query' ||
    route === 'supabase_write'
  ) {
    return route === 'database_schema'
      ? 'database_schema'
      : route === 'database_studio'
        ? 'database_studio'
        : route;
  }

  let browserContext = body?.browserContext ?? body?.browser_context ?? null;
  if (typeof browserContext === 'string') {
    try {
      browserContext = JSON.parse(browserContext);
    } catch {
      browserContext = null;
    }
  }
  const databaseContext =
    (browserContext &&
      typeof browserContext === 'object' &&
      /** @type {Record<string, unknown>} */ (browserContext).databaseContext) ||
    body?.databaseContext ||
    body?.database_context ||
    null;
  if (databaseContext && typeof databaseContext === 'object') {
    const surface = String(
      /** @type {Record<string, unknown>} */ (databaseContext).surface || '',
    ).toLowerCase();
    const provider = String(
      /** @type {Record<string, unknown>} */ (databaseContext).provider ||
        /** @type {Record<string, unknown>} */ (databaseContext).datasource ||
        '',
    ).toLowerCase();
    const routePath = String(
      /** @type {Record<string, unknown>} */ (databaseContext).route || '',
    );
    if (
      surface === 'database' ||
      provider === 'd1' ||
      provider === 'supabase' ||
      routePath.includes('/dashboard/database')
    ) {
      return 'database_studio';
    }
  }

  // Auto Design Mode kit while Browser Design Mode is on (Agent / Multitask composers).
  if (isDesignModeActiveFromBody(body)) return 'design_mode';

  return mode;
}
