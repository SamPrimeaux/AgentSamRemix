// guard-dup-allow: backend telemetry peel; legacy execution callers migrate separately.
/**
 * Canonical lightweight execution envelope.
 * Domain run tables own their lifecycle; agentsam_executions only gives steps
 * one stable parent keyed by (execution_type, run_id).
 */
function clean(value) {
  return value != null && String(value).trim() !== '' ? String(value).trim() : null;
}

function newExecutionId() {
  return `exec_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

async function loadRunIdentity(db, executionType, runId) {
  const type = String(executionType || '').trim().toLowerCase();
  try {
    if (type === 'agent') {
      return await db.prepare(
        `SELECT tenant_id, workspace_id, user_id FROM agentsam_agent_run WHERE id = ? LIMIT 1`,
      ).bind(runId).first();
    }
    if (type === 'command') {
      return await db.prepare(
        `SELECT tenant_id, workspace_id, user_id, selected_command_slug AS execution_key
           FROM agentsam_command_run WHERE id = ? LIMIT 1`,
      ).bind(runId).first();
    }
  } catch {
    return null;
  }
  return null;
}

export async function findExecutionParentId(env, executionType, runId) {
  if (!env?.DB) return null;
  const type = clean(executionType);
  const rid = clean(runId);
  if (!type || !rid) return null;
  const row = await env.DB.prepare(
    `SELECT id FROM agentsam_executions WHERE execution_type = ? AND run_id = ? LIMIT 1`,
  ).bind(type, rid).first().catch(() => null);
  return row?.id != null ? String(row.id) : null;
}

export async function ensureExecutionParent(env, p = {}) {
  if (!env?.DB) return null;
  const executionType = clean(p.executionType);
  const runId = clean(p.runId);
  if (!executionType || !runId) return null;
  const existing = await findExecutionParentId(env, executionType, runId);
  if (existing) return existing;

  const identity = await loadRunIdentity(env.DB, executionType, runId);
  const tenantId = clean(p.tenantId) || clean(identity?.tenant_id);
  const workspaceId = clean(p.workspaceId) || clean(identity?.workspace_id);
  const userId = clean(p.userId) || clean(identity?.user_id);
  const executionKey = clean(p.executionKey) || clean(identity?.execution_key);
  if (!tenantId || !workspaceId) return null;

  const id = newExecutionId();
  const status = clean(p.status) || 'running';
  const durationMs = Math.max(0, Math.floor(Number(p.durationMs) || 0));
  const startedAtUnix = Math.max(0, Math.floor(Number(p.startedAtUnix) || Date.now() / 1000));
  const completedAtUnix = p.completedAtUnix != null
    ? Math.max(0, Math.floor(Number(p.completedAtUnix) || 0))
    : ['completed', 'failed', 'cancelled', 'timed_out'].includes(status)
      ? Math.floor(Date.now() / 1000)
      : null;

  await env.DB.prepare(
    `INSERT OR IGNORE INTO agentsam_executions
       (id, tenant_id, workspace_id, user_id, execution_type, run_id, execution_key,
        status, duration_ms, started_at_unix, completed_at_unix, error_log_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, tenantId, workspaceId, userId, executionType, runId, executionKey,
    status, durationMs, startedAtUnix, completedAtUnix, clean(p.errorLogId),
  ).run();
  return findExecutionParentId(env, executionType, runId);
}

export async function finishExecutionParent(env, p = {}) {
  if (!env?.DB) return false;
  const executionId = clean(p.executionId);
  if (!executionId) return false;
  const res = await env.DB.prepare(
    `UPDATE agentsam_executions
        SET status = ?, duration_ms = ?, completed_at_unix = ?, error_log_id = COALESCE(?, error_log_id)
      WHERE id = ?`,
  ).bind(
    clean(p.status) || 'completed',
    Math.max(0, Math.floor(Number(p.durationMs) || 0)),
    Math.max(0, Math.floor(Number(p.completedAtUnix) || Date.now() / 1000)),
    clean(p.errorLogId),
    executionId,
  ).run().catch(() => null);
  return Boolean(res?.success);
}

export async function finishExecutionForRun(env, p = {}) {
  const executionId = await findExecutionParentId(env, p.executionType, p.runId);
  if (!executionId) return false;
  return finishExecutionParent(env, { ...p, executionId });
}
