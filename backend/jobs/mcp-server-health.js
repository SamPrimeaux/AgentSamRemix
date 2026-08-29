/**
 * Periodic health probes for agentsam_mcp_servers (HTTP GET /health or /mcp → /health).
 */
import { completeCronRun, failCronRun, startCronRun } from './cron-run-ledger.js';
import { pragmaTableInfo } from '../services/retention.js';

const CRON_MCP_HEALTH = '*/30 * * * *';

/**
 * @param {any} env
 */
export async function checkMcpServerHealth(env) {
  if (!env?.DB) return { rowsRead: 0, rowsWritten: 0 };

  const cols = await pragmaTableInfo(env.DB, 'agentsam_mcp_servers');
  if (!cols.size) return { rowsRead: 0, rowsWritten: 0 };

  const hasHealthUrl = cols.has('health_check_url');
  const hasLatency = cols.has('avg_latency_ms');
  const selectHealthUrl = hasHealthUrl ? ', health_check_url' : '';

  const { results } = await env.DB.prepare(
    `SELECT id, server_key, url${selectHealthUrl}
     FROM agentsam_mcp_servers
     WHERE COALESCE(is_active, 1) = 1
       AND url IS NOT NULL
       AND TRIM(url) != ''
       AND LOWER(TRIM(url)) != 'internal'`,
  ).all();

  let rowsWritten = 0;
  const now = Math.floor(Date.now() / 1000);

  for (const server of results || []) {
    const serverKey = server?.server_key != null ? String(server.server_key).trim() : '';
    if (!serverKey) continue;

    let checkUrl = hasHealthUrl && server.health_check_url ? String(server.health_check_url).trim() : '';
    if (!checkUrl) {
      const base = String(server.url || '').trim().replace(/\/$/, '');
      checkUrl = base.includes('/mcp') ? base.replace(/\/mcp$/i, '/health') : `${base}/health`;
    }

    try {
      const start = Date.now();
      const res = await fetch(checkUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      const latency = Date.now() - start;
      const status = res.ok ? 'healthy' : 'degraded';

      if (hasLatency) {
        await env.DB.prepare(
          `UPDATE agentsam_mcp_servers
           SET health_status = ?, avg_latency_ms = ?, last_health_at = ?, updated_at = ?
           WHERE server_key = ? OR id = ?`,
        )
          .bind(status, latency, now, now, serverKey, server.id ?? serverKey)
          .run();
      } else {
        await env.DB.prepare(
          `UPDATE agentsam_mcp_servers
           SET health_status = ?, last_health_at = ?, updated_at = ?
           WHERE server_key = ? OR id = ?`,
        )
          .bind(status, now, now, serverKey, server.id ?? serverKey)
          .run();
      }
      rowsWritten += 1;
    } catch {
      await env.DB.prepare(
        `UPDATE agentsam_mcp_servers
         SET health_status = 'unreachable', last_health_at = ?, updated_at = ?
         WHERE server_key = ? OR id = ?`,
      )
        .bind(now, now, serverKey, server.id ?? serverKey)
        .run();
      rowsWritten += 1;
    }
  }

  return { rowsRead: (results || []).length, rowsWritten };
}

/**
 * @param {any} env
 */
export async function runMcpServerHealthCron(env) {
  const begun = await startCronRun(env, {
    jobName: 'mcp_server_health',
    cronExpression: CRON_MCP_HEALTH,
    tenantId: null,
    workspaceId: null,
  });
  const runId = begun?.runId ?? null;
  const startedAt = begun?.startedAt ?? Date.now();
  try {
    const out = await checkMcpServerHealth(env);
    if (runId) await completeCronRun(env, runId, startedAt, out);
    return out;
  } catch (e) {
    if (runId) await failCronRun(env, runId, startedAt, e);
    throw e;
  }
}
