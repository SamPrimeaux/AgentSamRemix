/**
 * Inject Database Studio live surface into catalog tool args when the model omits resource_ref.
 * Studio selection is authoritative — never invent a platform D1/Supabase resource.
 */

/**
 * @param {Record<string, unknown>|null|undefined} runContext
 * @returns {Record<string, unknown>|null}
 */
export function extractDatabaseStudioContext(runContext) {
  if (!runContext || typeof runContext !== 'object') return null;
  const direct =
    runContext.databaseContext ||
    runContext.database_context ||
    runContext.databaseSurface ||
    null;
  if (direct && typeof direct === 'object') return /** @type {Record<string, unknown>} */ (direct);

  const browser =
    runContext.browserContext ||
    runContext.browser_context ||
    runContext.browserContextPayload ||
    null;
  if (browser && typeof browser === 'object') {
    const nested =
      /** @type {Record<string, unknown>} */ (browser).databaseContext ||
      /** @type {Record<string, unknown>} */ (browser).database_context ||
      null;
    if (nested && typeof nested === 'object') return /** @type {Record<string, unknown>} */ (nested);
  }
  return null;
}

/**
 * @param {Record<string, unknown>|null|undefined} studio
 * @returns {{
 *   provider: string,
 *   resourceRef: string,
 *   resourceScope: string,
 *   activeSchema: string,
 *   isPlatformSupabase: boolean,
 *   isD1: boolean,
 * }|null}
 */
export function normalizeDatabaseStudioSelection(studio) {
  if (!studio || typeof studio !== 'object') return null;
  const provider = String(studio.provider || studio.datasource || '')
    .trim()
    .toLowerCase();
  const resourceRef = String(studio.resourceRef || studio.resource_ref || studio.datasource_binding || '')
    .trim();
  const resourceScope = String(studio.resourceScope || studio.resource_scope || '')
    .trim()
    .toLowerCase();
  const activeSchema = String(studio.activeSchema || studio.active_schema || '').trim();
  if (!provider && !resourceRef) return null;
  const isD1 = provider === 'd1' || (!provider && Boolean(resourceRef) && resourceRef !== 'platform_supabase');
  const isPlatformSupabase =
    provider === 'supabase' &&
    (resourceRef === 'platform_supabase' || resourceScope === 'platform');
  return {
    provider: provider || (isD1 ? 'd1' : 'supabase'),
    resourceRef,
    resourceScope,
    activeSchema,
    isPlatformSupabase,
    isD1: isD1 || provider === 'd1',
  };
}

/**
 * Normalize D1 targeting: non-UUID database_id/databaseId → database name lane.
 * @param {Record<string, unknown>} params
 * @returns {Record<string, unknown>}
 */
export function normalizeD1TargetParams(params) {
  const p = params && typeof params === 'object' ? { ...params } : {};
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const key of ['database_id', 'databaseId']) {
    const raw = String(p[key] || '').trim();
    if (!raw || uuidRe.test(raw)) continue;
    if (!String(p.database || p.database_name || p.databaseName || '').trim()) {
      p.database = raw;
    }
    delete p[key];
  }
  return p;
}

/**
 * Merge Studio selection into D1 tool params when the model omitted targeting.
 * @param {Record<string, unknown>} params
 * @param {Record<string, unknown>|null|undefined} runContext
 * @returns {Record<string, unknown>}
 */
export function enrichD1ParamsFromStudioContext(params, runContext) {
  const p = normalizeD1TargetParams(params);
  const hasHint = Boolean(
    String(p.resource_ref || p.resourceRef || p.database_id || p.databaseId || p.database || p.database_name || '')
      .trim(),
  );
  if (hasHint) return p;

  const sel = normalizeDatabaseStudioSelection(extractDatabaseStudioContext(runContext));
  if (!sel?.resourceRef || !sel.isD1) return p;

  const looksLikeId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    sel.resourceRef,
  );
  p.resource_ref = sel.resourceRef;
  if (looksLikeId) p.database_id = sel.resourceRef;
  else p.database = sel.resourceRef;
  return p;
}

/**
 * Merge Studio selection into Supabase tool params; prefer platform Hyperdrive when Studio says platform.
 * @param {Record<string, unknown>} params
 * @param {Record<string, unknown>|null|undefined} runContext
 * @returns {{
 *   params: Record<string, unknown>,
 *   preferPlatform: boolean,
 *   strippedListProjects: boolean,
 * }}
 */
export function enrichSupabaseParamsFromStudioContext(params, runContext) {
  const p = params && typeof params === 'object' ? { ...params } : {};
  const sel = normalizeDatabaseStudioSelection(extractDatabaseStudioContext(runContext));
  if (!sel || sel.isD1) {
    return { params: p, preferPlatform: false, strippedListProjects: false };
  }

  const existingRef = String(p.resource_ref || p.resourceRef || '').trim();
  if (!existingRef && sel.resourceRef) {
    p.resource_ref = sel.resourceRef;
  }

  const resolvedRef = String(p.resource_ref || p.resourceRef || sel.resourceRef || '').trim();
  const preferPlatform =
    resolvedRef === 'platform_supabase' ||
    sel.isPlatformSupabase ||
    (sel.provider === 'supabase' && sel.resourceScope === 'platform');

  let strippedListProjects = false;
  if (preferPlatform) {
    p.resource_ref = 'platform_supabase';
    p.data_plane = 'platform_supabase';
    // Platform face is already selected — list_projects is the customer OAuth lane.
    const op = String(p.operation || '').trim().toLowerCase();
    if (op === 'list_projects') {
      delete p.operation;
      strippedListProjects = true;
    }
    if (sel.activeSchema && !String(p.schema || '').trim()) {
      p.schema = sel.activeSchema;
    }
  } else if (sel.resourceRef && !String(p.project || p.project_ref || '').trim()) {
    p.project = sel.resourceRef;
    p.project_ref = sel.resourceRef;
  }

  return {
    params: p,
    preferPlatform,
    strippedListProjects,
  };
}
