/**
 * agentsam_cron_runs ledger — canonical shape for scheduled jobs.
 * @see migrations/261_agentsam_cron_runs.sql
 */

function safeJsonStringify(value) {
  if (value == null) return '{}';
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return '{}';
    try {
      JSON.parse(s);
      return s;
    } catch {
      return JSON.stringify({ value: s });
    }
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
}

/**
 * @param {any} env
 * @param {{ jobName: string, cronExpression?: string|null, tenantId?: string|null, workspaceId?: string|null }} args
 * @returns {Promise<{ runId: string, startedAt: number } | null>}
 */
export async function startCronRun(env, args) {
  if (!env?.DB) return null;
  const jobName = args?.jobName != null ? String(args.jobName).trim() : '';
  if (!jobName) return null;

  const runId = `acr_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const startedAt = Date.now();
  const cronExpression = args?.cronExpression != null ? String(args.cronExpression) : null;
  const tenantId = args?.tenantId != null ? String(args.tenantId) : null;
  const workspaceId = args?.workspaceId != null ? String(args.workspaceId) : null;

  try {
    await env.DB.prepare(
      `INSERT INTO agentsam_cron_runs
        (id, job_name, cron_expression, status, tenant_id, workspace_id, started_at)
       VALUES (?, ?, ?, 'running', ?, ?, unixepoch())`,
    )
      .bind(runId, jobName, cronExpression, tenantId, workspaceId)
      .run();
    return { runId, startedAt };
  } catch (e) {
    console.warn('[cron-ledger] startCronRun failed', e?.message ?? e);
    return null;
  }
}

/**
 * @param {any} env
 * @param {string | null | undefined} runId
 * @param {number} startedAt from startCronRun (Date.now ms)
 * @param {{ rowsRead?: number, rowsWritten?: number, metadata?: any }} [result]
 */
export async function completeCronRun(env, runId, startedAt, result = {}) {
  if (!env?.DB || !runId) return false;
  const durationMs = Math.max(0, Date.now() - (Number(startedAt) || Date.now()));
  const rowsRead = Number(result?.rowsRead ?? 0) || 0;
  const rowsWritten = Number(result?.rowsWritten ?? 0) || 0;
  const metadataJson = safeJsonStringify(result?.metadata ?? {});

  try {
    await env.DB.prepare(
      `UPDATE agentsam_cron_runs
       SET status='completed', completed_at=unixepoch(),
           duration_ms=?, rows_read=?, rows_written=?, metadata_json=?
       WHERE id=?`,
    )
      .bind(durationMs, rowsRead, rowsWritten, metadataJson, String(runId))
      .run();
    return true;
  } catch (e) {
    console.warn('[cron-ledger] completeCronRun failed', e?.message ?? e);
    return false;
  }
}

/**
 * @param {any} env
 * @param {string | null | undefined} runId
 * @param {number} startedAt
 * @param {any} error
 */
export async function failCronRun(env, runId, startedAt, error) {
  if (!env?.DB || !runId) return false;
  const durationMs = Math.max(0, Date.now() - (Number(startedAt) || Date.now()));
  const msg =
    error?.message != null ? String(error.message) : String(error ?? 'unknown_error');

  try {
    await env.DB.prepare(
      `UPDATE agentsam_cron_runs
       SET status='failed', completed_at=unixepoch(),
           duration_ms=?, error_message=?
       WHERE id=?`,
    )
      .bind(durationMs, msg.slice(0, 4000), String(runId))
      .run();
    return true;
  } catch (e) {
    console.warn('[cron-ledger] failCronRun failed', e?.message ?? e);
    return false;
  }
}
