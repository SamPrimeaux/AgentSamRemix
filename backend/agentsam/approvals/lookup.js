/** Scoped reads for the canonical Agent Sam approval queue. */

import { approvalQueueColumns } from './queue.js';

function scopeParts({ userId, workspaceId, tenantId }) {
  return {
    binds: [String(userId || '').trim(), String(workspaceId || '').trim(), String(tenantId || '').trim()],
    where: `(q.workspace_id = ? OR (q.workspace_id IS NULL AND q.tenant_id = ?))`,
  };
}

export async function countPendingApprovals(env, scope = {}) {
  if (!env?.DB) return 0;
  const { binds, where } = scopeParts(scope);
  const runId = String(scope.runId || '').trim();
  const sessionId = String(scope.sessionId || '').trim();
  const filters = [
    runId ? '(q.workflow_run_id = ? OR q.session_id = ? OR q.command_run_id = ?)' : '',
    sessionId ? 'q.session_id = ?' : '',
  ].filter(Boolean);
  const extra = filters.length ? ` AND ${filters.join(' AND ')}` : '';
  const extraBinds = [
    ...(runId ? [runId, runId, runId] : []),
    ...(sessionId ? [sessionId] : []),
  ];
  const row = await env.DB
    .prepare(
      `SELECT COUNT(*) AS c
         FROM agentsam_approval_queue q
        WHERE q.status = 'pending' AND q.user_id = ? AND ${where}${extra}`,
    )
    .bind(...binds, ...extraBinds)
    .first()
    .catch(() => ({ c: 0 }));
  return Number(row?.c || 0) || 0;
}

export async function findScopedPendingApproval(env, scope = {}) {
  if (!env?.DB) return null;
  const { binds, where } = scopeParts(scope);
  const runId = String(scope.runId || '').trim();
  const sessionId = String(scope.sessionId || '').trim();
  const proposalId = String(scope.proposalId || '').trim();
  const runFilter = runId ? ' AND (q.workflow_run_id = ? OR q.session_id = ? OR q.command_run_id = ?)' : '';
  const sessionFilter = sessionId && !proposalId ? ' AND q.session_id = ?' : '';
  const rows = [];
  if (proposalId) {
    rows.push({
      sql: `SELECT q.*
              FROM agentsam_approval_queue q
             WHERE q.id = ? AND q.status = 'pending' AND q.user_id = ? AND ${where}
             LIMIT 1`,
      binds: [proposalId, ...binds],
    });
  }
  rows.push({
    sql: `SELECT q.*
            FROM agentsam_approval_queue q
           WHERE q.status = 'pending' AND q.user_id = ? AND ${where}${runFilter}${sessionFilter}
           ORDER BY q.created_at ASC
           LIMIT 1`,
    binds: [...binds, ...(runId ? [runId, runId, runId] : []), ...(sessionFilter ? [sessionId] : [])],
  });
  for (const query of rows) {
    const row = await env.DB.prepare(query.sql).bind(...query.binds).first().catch(() => null);
    if (row) return row;
  }
  return null;
}

export async function findScopedExpiredSpawnJobs(env, scope = {}) {
  if (!env?.DB) return [];
  const { binds, where } = scopeParts(scope);
  const { results } = await env.DB
    .prepare(
      `SELECT id, merged_output, cost_cap_usd, total_cost_usd, workspace_id, user_id, master_run_id
         FROM agentsam_spawn_job
        WHERE status = 'awaiting_approval' AND user_id = ? AND ${where}
        ORDER BY created_at DESC
        LIMIT 8`,
    )
    .bind(...binds)
    .all()
    .catch(() => ({ results: [] }));
  return results || [];
}

export async function listPendingProposals(env, scope = {}) {
  if (!env?.DB) return [];
  const userId = String(scope.userId || '').trim();
  const workspaceId = String(scope.workspaceId || '').trim();
  const tenantId = String(scope.tenantId || '').trim();
  if (!userId) return [];
  let sql = `SELECT q.id, q.tenant_id, q.session_id AS agent_session_id, q.user_id AS proposed_by,
                    q.tool_name AS command_name,
                    COALESCE(json_extract(q.input_json, '$.command_text'), q.action_summary) AS command_text,
                    q.input_json AS filled_template, q.action_summary AS rationale,
                    q.risk_level, q.status, q.created_at
               FROM agentsam_approval_queue q
              WHERE q.status = 'pending' AND q.user_id = ?`;
  const binds = [userId];
  if (workspaceId) {
    sql += ' AND (q.workspace_id = ? OR (q.workspace_id IS NULL AND q.tenant_id = ?))';
    binds.push(workspaceId, tenantId);
  }
  sql += ' ORDER BY q.created_at DESC';
  const { results } = await env.DB.prepare(sql).bind(...binds).all().catch(() => ({ results: [] }));
  return results || [];
}

export async function findApprovalForActor(env, approvalId, scope = {}) {
  const id = String(approvalId || '').trim();
  if (!env?.DB || !id) return null;
  return env.DB
    .prepare(
      `SELECT id, status, tool_name, expires_at
         FROM agentsam_approval_queue
        WHERE id = ? AND user_id = ? AND workspace_id = ? AND tenant_id = ?
        LIMIT 1`,
    )
    .bind(id, String(scope.userId || '').trim(), String(scope.workspaceId || '').trim(), String(scope.tenantId || '').trim())
    .first()
    .catch(() => null);
}

export async function approvalQueueSupportsExecutionStep(env) {
  return (await approvalQueueColumns(env?.DB)).has('execution_step_id');
}
