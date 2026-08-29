/** Canonical D1 authority for agentsam_approval_queue rows. */

export async function approvalQueueColumns(db) {
  if (!db) return new Set();
  const { results } = await db.prepare('PRAGMA table_info(agentsam_approval_queue)').all().catch(() => ({ results: [] }));
  return new Set((results || []).map((row) => String(row?.name || '').toLowerCase()).filter(Boolean));
}

export async function insertApprovalQueueRow(env, row = {}) {
  if (!env?.DB) throw new Error('DB not configured');
  const columns = await approvalQueueColumns(env.DB);
  if (!columns.size) throw new Error('agentsam_approval_queue missing');
  const names = [];
  const binds = [];
  for (const [key, value] of Object.entries(row)) {
    if (value === undefined || !columns.has(String(key).toLowerCase())) continue;
    names.push(key);
    binds.push(value);
  }
  if (!names.length) throw new Error('approval_queue_row_empty');
  await env.DB
    .prepare(`INSERT INTO agentsam_approval_queue (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`)
    .bind(...binds)
    .run();
  return { id: row.id };
}

export async function getApprovalQueueRow(env, approvalId) {
  const id = String(approvalId || '').trim();
  if (!env?.DB || !id) return null;
  return env.DB
    .prepare('SELECT * FROM agentsam_approval_queue WHERE id = ? LIMIT 1')
    .bind(id)
    .first()
    .catch(() => null);
}

export async function setApprovalQueueStatus(env, approvalId, status, decidedBy) {
  const id = String(approvalId || '').trim();
  const next = String(status || '').trim().toLowerCase();
  if (!env?.DB || !id || !['approved', 'denied'].includes(next)) {
    throw new Error('approval_decision_invalid');
  }
  await env.DB
    .prepare(
      `UPDATE agentsam_approval_queue
          SET status = ?, decided_at = unixepoch(), approved_by = ?
        WHERE id = ?`,
    )
    .bind(next, String(decidedBy || '').slice(0, 200), id)
    .run();
  return getApprovalQueueRow(env, id);
}

export async function findPendingApprovalForCommandRun(env, commandRunId, executionStepId = null) {
  const runId = String(commandRunId || '').trim();
  if (!env?.DB || !runId) return null;
  const columns = await approvalQueueColumns(env.DB);
  const stepId = String(executionStepId || '').trim();
  const stepFilter = stepId && columns.has('execution_step_id') ? ' AND execution_step_id = ?' : '';
  const binds = stepFilter ? [runId, stepId] : [runId];
  return env.DB
    .prepare(
      `SELECT id, status
         FROM agentsam_approval_queue
        WHERE command_run_id = ?${stepFilter}
          AND lower(status) = 'pending'
        LIMIT 1`,
    )
    .bind(...binds)
    .first()
    .catch(() => null);
}

export async function approvalQueueApprovedForCommandRun(env, commandRunId, executionStepId = null) {
  const runId = String(commandRunId || '').trim();
  if (!env?.DB || !runId) return false;
  const columns = await approvalQueueColumns(env.DB);
  const stepId = String(executionStepId || '').trim();
  const stepFilter = stepId && columns.has('execution_step_id') ? ' AND execution_step_id = ?' : '';
  const binds = stepFilter ? [runId, stepId] : [runId];
  const row = await env.DB
    .prepare(
      `SELECT id
         FROM agentsam_approval_queue
        WHERE command_run_id = ?${stepFilter}
          AND lower(status) = 'approved'
          AND (expires_at IS NULL OR expires_at > unixepoch())
        LIMIT 1`,
    )
    .bind(...binds)
    .first()
    .catch(() => null);
  return Boolean(row?.id);
}
