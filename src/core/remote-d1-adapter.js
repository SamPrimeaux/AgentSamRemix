/**
 * D1Database-shaped adapter over Cloudflare D1 HTTP API (remote workspace databases).
 */

/**
 * @param {string} token
 * @param {string} accountId
 * @param {string} databaseId
 * @param {string} sql
 * @param {unknown[]} params
 */
export async function remoteD1Query(token, accountId, databaseId, sql, params = []) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sql: String(sql || ''),
        params: Array.isArray(params) ? params : [],
      }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    const msg = data?.errors?.[0]?.message || `cloudflare_d1_query_${res.status}`;
    throw new Error(String(msg));
  }
  const batch = Array.isArray(data?.result) ? data.result[0] : data?.result;
  return {
    results: batch?.results ?? batch?.rows ?? [],
    success: batch?.success !== false,
    meta: batch?.meta ?? {},
  };
}

/**
 * @param {{
 *   token: string,
 *   account_id: string,
 *   database_id: string,
 *   workspace_id?: string,
 *   via?: string,
 * }} grant
 */
export function createRemoteD1Adapter(grant) {
  const token = String(grant.token || '');
  const accountId = String(grant.account_id || '');
  const databaseId = String(grant.database_id || '');

  /**
   * @param {string} sql
   * @param {unknown[]} binds
   */
  function stmt(sql, binds = []) {
    return {
      async all() {
        const out = await remoteD1Query(token, accountId, databaseId, sql, binds);
        return {
          results: out.results || [],
          success: out.success,
          meta: out.meta || {},
        };
      },
      async run() {
        const out = await remoteD1Query(token, accountId, databaseId, sql, binds);
        return {
          success: out.success,
          meta: out.meta || {},
        };
      },
      async first() {
        const out = await remoteD1Query(token, accountId, databaseId, sql, binds);
        const rows = out.results || [];
        return rows.length ? rows[0] : null;
      },
    };
  }

  return {
    prepare(sql) {
      const bound = {
        bind(...params) {
          return stmt(sql, params);
        },
        all() {
          return stmt(sql, []).all();
        },
        run() {
          return stmt(sql, []).run();
        },
        first() {
          return stmt(sql, []).first();
        },
      };
      return bound;
    },
  };
}
