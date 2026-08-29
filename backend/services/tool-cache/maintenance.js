/**
 * Nightly tool-cache cleanup — TTL/stale expiration + row cap.
 */

const TOOL_CACHE_MAX_ROWS = 5000;
const TOOL_CACHE_DELETE_BATCH = 500;
const TOOL_CACHE_DELETE_MAX_BATCHES = 40;

async function deleteInBatches(env, sql, bind = []) {
  let deleted = 0;
  for (let i = 0; i < TOOL_CACHE_DELETE_MAX_BATCHES; i++) {
    const stmt = env.DB.prepare(`${sql} LIMIT ${TOOL_CACHE_DELETE_BATCH}`);
    const res = bind.length ? await stmt.bind(...bind).run() : await stmt.run();
    const n = Number(res?.meta?.changes) || 0;
    deleted += n;
    if (n < TOOL_CACHE_DELETE_BATCH) break;
  }
  return deleted;
}

/**
 * @param {any} env
 */
export async function runToolCacheMaintenance(env) {
  if (!env?.DB) return { rowsWritten: 0, metadata: {} };

  const now = Math.floor(Date.now() / 1000);

  const staleDel = await deleteInBatches(
    env,
    `DELETE FROM agentsam_tool_cache
      WHERE stale_until_unix IS NOT NULL
        AND stale_until_unix < ${now}`,
  ).catch(() => 0);

  const invalidatedDel = await deleteInBatches(
    env,
    `DELETE FROM agentsam_tool_cache
      WHERE status = 'invalidated'
        AND invalidated_at_unix IS NOT NULL
        AND invalidated_at_unix < ${now - 86400}`,
  ).catch(() => 0);

  let capDel = 0;
  const countRow = await env.DB.prepare(`SELECT COUNT(*) AS n FROM agentsam_tool_cache`)
    .first()
    .catch(() => null);
  const total = Number(countRow?.n) || 0;
  if (total > TOOL_CACHE_MAX_ROWS) {
    const excess = total - TOOL_CACHE_MAX_ROWS;
    const capRes = await env.DB.prepare(
      `DELETE FROM agentsam_tool_cache
       WHERE id IN (
         SELECT id FROM agentsam_tool_cache
         ORDER BY created_at_unix ASC
         LIMIT ?
       )`,
    )
      .bind(excess)
      .run()
      .catch(() => null);
    capDel = Number(capRes?.meta?.changes) || 0;
  }

  const rowsWritten = staleDel + invalidatedDel + capDel;
  return {
    rowsWritten,
    deleted: rowsWritten,
    metadata: {
      stale_deleted: staleDel,
      invalidated_deleted: invalidatedDel,
      cap_deleted: capDel,
    },
  };
}
