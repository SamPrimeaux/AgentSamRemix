import { clearWorkflowContinuation } from '../runs/continuation.js';
import { getWorkflowRun, parseWorkflowRunJson } from '../runs/repository.js';

export async function decideWorkflowApproval(db, {
  runId = null,
  approvalId = null,
  decision,
  approvedBy = null,
  tenantId = null,
  workspaceId = null,
} = {}) {
  if (!db) return { ok: false, error: 'DB unavailable' };
  const normalized = String(decision || '').toLowerCase();
  if (!['approved', 'denied', 'rejected'].includes(normalized)) {
    return { ok: false, error: 'invalid_decision' };
  }
  const tid = String(tenantId || '').trim();
  const wid = String(workspaceId || '').trim();
  if (!tid || !wid) return { ok: false, error: 'approval_scope_required' };

  const dbStatus = normalized === 'approved' ? 'approved' : 'denied';
  let updated;
  if (approvalId) {
    const sql = runId
      ? `UPDATE agentsam_approval_queue
            SET status = ?, approved_by = ?, decided_at = unixepoch()
          WHERE id = ? AND workflow_run_id = ? AND status = 'pending'
            AND EXISTS (
              SELECT 1 FROM agentsam_workflow_runs wr
               WHERE wr.id = agentsam_approval_queue.workflow_run_id
                 AND wr.tenant_id = ? AND wr.workspace_id = ?
            )`
      : `UPDATE agentsam_approval_queue
            SET status = ?, approved_by = ?, decided_at = unixepoch()
          WHERE id = ? AND status = 'pending'
            AND EXISTS (
              SELECT 1 FROM agentsam_workflow_runs wr
               WHERE wr.id = agentsam_approval_queue.workflow_run_id
                 AND wr.tenant_id = ? AND wr.workspace_id = ?
            )`;
    const args = runId
      ? [dbStatus, approvedBy, approvalId, String(runId), tid, wid]
      : [dbStatus, approvedBy, approvalId, tid, wid];
    updated = await db.prepare(sql).bind(...args).run();
  } else if (runId) {
    updated = await db.prepare(
      `UPDATE agentsam_approval_queue
          SET status = ?, approved_by = ?, decided_at = unixepoch()
        WHERE workflow_run_id = ? AND status = 'pending'
          AND EXISTS (
            SELECT 1 FROM agentsam_workflow_runs wr
             WHERE wr.id = agentsam_approval_queue.workflow_run_id
               AND wr.tenant_id = ? AND wr.workspace_id = ?
          )`,
    ).bind(dbStatus, approvedBy, String(runId), tid, wid).run();
  } else {
    return { ok: false, error: 'approval_id_or_run_id_required' };
  }

  const changes = updated?.meta?.changes ?? updated?.changes ?? 0;
  if (!changes) return { ok: false, error: 'approval_not_found_or_decided', changes: 0 };

  let resolvedRunId = runId ? String(runId) : null;
  if (!resolvedRunId && approvalId) {
    const row = await db.prepare(
      `SELECT aq.workflow_run_id
         FROM agentsam_approval_queue aq
         JOIN agentsam_workflow_runs wr ON wr.id = aq.workflow_run_id
        WHERE aq.id = ? AND wr.tenant_id = ? AND wr.workspace_id = ?
        LIMIT 1`,
    ).bind(approvalId, tid, wid).first().catch(() => null);
    resolvedRunId = row?.workflow_run_id ? String(row.workflow_run_id) : null;
  }

  if (resolvedRunId) {
    if (normalized === 'approved') {
      await db.prepare(
        `UPDATE agentsam_workflow_runs
            SET status = 'running', updated_at = datetime('now')
          WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND status = 'awaiting_approval'`,
      ).bind(resolvedRunId, tid, wid).run().catch(() => null);
    } else {
      await db.prepare(
        `UPDATE agentsam_workflow_runs
            SET status = 'failed', kill_reason = 'approval_rejected', updated_at = datetime('now')
          WHERE id = ? AND tenant_id = ? AND workspace_id = ?`,
      ).bind(resolvedRunId, tid, wid).run().catch(() => null);
      await clearWorkflowContinuation(db, resolvedRunId);
    }
  }

  const run = resolvedRunId ? await getWorkflowRun(db, resolvedRunId).catch(() => null) : null;
  if (run && (String(run.tenant_id || '') !== tid || String(run.workspace_id || '') !== wid)) {
    return { ok: false, error: 'approval_not_found_or_decided', changes: 0 };
  }
  const metadata = parseWorkflowRunJson(run?.metadata_json, {});
  return {
    ok: true,
    decision: normalized === 'approved' ? 'approved' : 'denied',
    changes,
    run_id: resolvedRunId,
    run,
    workflow_instance_id: metadata?.cf_workflow_instance_id ?? null,
  };
}
