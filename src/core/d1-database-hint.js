/**
 * Parse D1 targeting from tool params.
 * Tool faces require database_id (UUID). Names are not part of the public contract;
 * a non-UUID database_id/database field is ignored (caller must pass a real UUID).
 * workspace_slug / workspace_id / d1_lane are not accepted.
 */

export const D1_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {Record<string, unknown>|null|undefined} params
 * @returns {{
 *   database_id: string|null,
 *   database_name: string|null,
 *   binding: string|null,
 * }|null}
 */
export function parseD1DatabaseHint(params) {
  const p = params && typeof params === 'object' ? params : {};
  const resourceRef = String(p.resource_ref || p.resourceRef || '').trim();
  const resourceLooksLikeId = D1_UUID_RE.test(resourceRef);
  const rawIdField = String(p.database_id || p.databaseId || '').trim();
  const idFieldIsUuid = D1_UUID_RE.test(rawIdField);
  const directId = idFieldIsUuid ? rawIdField : resourceLooksLikeId ? resourceRef : '';
  if (directId) {
    return { database_id: directId, database_name: null, binding: null };
  }
  // Studio / legacy may still pass CF catalog name — keep for internal enrich only.
  const directName = String(p.database || p.database_name || p.databaseName || '').trim();
  if (directName) {
    return { database_id: null, database_name: directName, binding: null };
  }
  return null;
}

/**
 * Normalize agent-facing sql|queries into CF REST statements.
 * Agent face: queries[{sql,params}] · CF REST body uses { batch: [...] }.
 * @param {Record<string, unknown>|null|undefined} params
 * @returns {{ ok: true, statements: Array<{ sql: string, params: unknown[]|null }> } | { ok: false, error: string, user_message: string }}
 */
export function normalizeD1Statements(params) {
  const p = params && typeof params === 'object' ? params : {};
  const rawList = Array.isArray(p.queries)
    ? p.queries
    : Array.isArray(p.batch)
      ? p.batch
      : null;

  if (rawList) {
    /** @type {Array<{ sql: string, params: unknown[]|null }>} */
    const statements = [];
    for (let i = 0; i < rawList.length; i++) {
      const item = rawList[i];
      if (!item || typeof item !== 'object') {
        return {
          ok: false,
          error: 'invalid_batch_item',
          user_message: `queries[${i}] must be an object with sql.`,
        };
      }
      const sql = String(/** @type {Record<string, unknown>} */ (item).sql || '').trim();
      if (!sql) {
        return {
          ok: false,
          error: 'sql_required',
          user_message: `queries[${i}].sql is required.`,
        };
      }
      const paramsRaw = /** @type {Record<string, unknown>} */ (item).params;
      statements.push({
        sql,
        params: Array.isArray(paramsRaw) ? paramsRaw : paramsRaw == null ? null : null,
      });
    }
    if (!statements.length) {
      return {
        ok: false,
        error: 'sql_required',
        user_message: 'queries must contain at least one { sql, params? } entry.',
      };
    }
    return { ok: true, statements };
  }

  const sql = String(p.sql || p.query || '').trim();
  if (!sql) {
    return {
      ok: false,
      error: 'sql_required',
      user_message:
        'Pass sql (+ optional params) or queries: [{ sql, params }]. Same as Cloudflare D1 REST single vs batch.',
    };
  }
  return {
    ok: true,
    statements: [
      {
        sql,
        params: Array.isArray(p.params) ? p.params : p.params == null ? null : null,
      },
    ],
  };
}

/**
 * Cloudflare REST body: single {sql,params} or {batch:[...]}.
 * @param {Array<{ sql: string, params?: unknown[]|null }>} statements
 */
export function buildCloudflareD1QueryBody(statements) {
  const list = Array.isArray(statements) ? statements : [];
  if (list.length === 1) {
    const s = list[0];
    return {
      sql: String(s.sql || ''),
      params: Array.isArray(s.params) ? s.params : [],
    };
  }
  return {
    batch: list.map((s) => ({
      sql: String(s.sql || ''),
      params: Array.isArray(s.params) ? s.params : [],
    })),
  };
}
