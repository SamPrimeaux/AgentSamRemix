/**
 * agentsam_d1_query / agentsam_d1_write / agentsam_d1_delete agent face
 * = Cloudflare Bindings MCP `d1_database_query`.
 * Name/label differs; args do not.
 */
import { D1_UUID_RE } from './d1-database-hint.js';

/** Cloudflare Bindings MCP `d1_database_query` description. */
export const CLOUDFLARE_D1_DATABASE_QUERY_DESCRIPTION =
  'Query a D1 database in your Cloudflare account. Pass database_id (UUID) + sql. If database_id is omitted, the session workspace pin is used. List UUIDs with agentsam_cf_d1_list. Credentials resolve from your connected Cloudflare account.';

/** Cloudflare Bindings MCP `d1_database_query` inputSchema (byte-identical keys). */
export const CLOUDFLARE_D1_DATABASE_QUERY_INPUT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    database_id: { type: 'string' },
    sql: { type: 'string' },
    params: {
      anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
    },
  },
  required: ['database_id', 'sql'],
};

const CF_SQL_FACE_KEYS = new Set([
  'agentsam_d1_query',
  'd1_query',
  'agentsam_d1_write',
  'd1_write',
  'agentsam_d1_delete',
  'd1_delete',
]);

export function isAgentsamD1CfSqlFaceTool(toolKey) {
  return CF_SQL_FACE_KEYS.has(String(toolKey || '').trim().toLowerCase());
}

export function agentsamD1QueryInputSchema() {
  return JSON.parse(JSON.stringify(CLOUDFLARE_D1_DATABASE_QUERY_INPUT_SCHEMA));
}

/**
 * Cloudflare `d1_database_query` args only: database_id + sql required, params optional.
 * Ignores queries[] / batch / query alias / workspace pin.
 *
 * @param {Record<string, unknown>|null|undefined} params
 * @returns {{
 *   ok: true,
 *   database_id: string,
 *   statements: Array<{ sql: string, params: string[]|null }>,
 * } | { ok: false, error: string, user_message: string }}
 */
export function normalizeCloudflareD1QueryFace(params) {
  const p = params && typeof params === 'object' && !Array.isArray(params) ? params : {};
  const databaseId = String(p.database_id || p.databaseId || '').trim();
  if (!D1_UUID_RE.test(databaseId)) {
    return {
      ok: false,
      error: 'database_id_required',
      user_message:
        'database_id (UUID) and sql are required — same args as Cloudflare d1_database_query. List UUIDs with agentsam_cf_d1_list.',
    };
  }
  const sql = String(p.sql || '').trim();
  if (!sql) {
    return {
      ok: false,
      error: 'sql_required',
      user_message:
        'sql is required — same args as Cloudflare d1_database_query. Do not pass queries[].',
    };
  }
  const rawParams = p.params;
  /** @type {string[]|null} */
  let bind = null;
  if (Array.isArray(rawParams)) {
    bind = rawParams.map((v) => (v == null ? '' : String(v)));
  }
  return {
    ok: true,
    database_id: databaseId,
    statements: [{ sql, params: bind }],
  };
}

/**
 * Auth for a Cloudflare D1 REST call — caller identity only.
 * Not workspace/tenant/studio targeting. Analogous to Bindings MCP login.
 *
 * @param {Record<string, unknown>|null|undefined} runContext
 * @param {string} databaseId
 */
export function buildCloudflareD1AuthCtx(runContext, databaseId) {
  const userId = String(runContext?.userId ?? runContext?.user_id ?? '').trim();
  const id = String(databaseId || '').trim();
  return {
    user_id: userId || null,
    database_id: id || null,
    authUser: runContext?.authUser ?? runContext?.user ?? null,
    account_scoped: true,
  };
}
