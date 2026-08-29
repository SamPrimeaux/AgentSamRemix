import { compactPayloadForJournal, assertJournalPayloadUnderCeiling } from '../../telemetry/execution-journal-compact.js';
import { compactStepResultsJson, compactWorkflowInputJson } from './journal.js';

export async function getWorkflowRun(db, runId) {
  if (!db || !runId) return null;
  return db.prepare(`SELECT * FROM agentsam_workflow_runs WHERE id = ? LIMIT 1`).bind(String(runId)).first();
}

export function parseWorkflowRunJson(raw, fallback = {}) {
  if (raw && typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(String(raw || ''));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export async function hasPendingWorkflowApproval(db, runId) {
  const row = await db.prepare(
    `SELECT id FROM agentsam_approval_queue WHERE workflow_run_id = ? AND status = 'pending' LIMIT 1`,
  ).bind(runId).first().catch(() => null);
  return !!row?.id;
}

export async function createWorkflowRun(db, p) {
  const runId = p.runId || `wrun_${crypto.randomUUID().replace(/-/g,'').slice(0,16)}`;
  const runGroupId = p.runGroupId || `rg_${crypto.randomUUID().replace(/-/g,'').slice(0,16)}`;
  const inputJson = await compactWorkflowInputJson(p.input ?? {});
  await db.prepare(
    `INSERT INTO agentsam_workflow_runs (
       id, workflow_id, workflow_key, tenant_id, workspace_id, run_group_id,
       user_id, user_email, trigger_type, status,
       input_json, output_json, step_results_json, metadata_json,
       steps_total, steps_completed, environment, graph_mode, current_node_key,
       started_at, created_at, updated_at
     ) VALUES (
       ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running',
       ?, '{}', '[]', ?, ?, 0, 'production', 1, ?,
       unixepoch(), datetime('now'), datetime('now')
     )`,
  ).bind(
    runId, p.workflowId, p.workflowKey, p.tenantId, p.workspaceId, runGroupId,
    p.userId ?? null, p.userEmail ?? null, p.triggerType,
    inputJson, JSON.stringify(p.metadata || {}), Number(p.stepsTotal || 0), p.currentNodeKey || null,
  ).run();
  return { runId, runGroupId };
}

export async function markWorkflowRunNode(db, runId, nodeKey) {
  await db.prepare(
    `UPDATE agentsam_workflow_runs
        SET current_node_key = ?, heartbeat_at = unixepoch(), updated_at = datetime('now')
      WHERE id = ?`,
  ).bind(nodeKey, runId).run().catch(() => null);
}

export async function persistWorkflowRunJournal(db, runId, journalSteps) {
  const list = Array.isArray(journalSteps) ? journalSteps : [];
  await db.prepare(
    `UPDATE agentsam_workflow_runs
        SET steps_completed = ?, step_results_json = ?, updated_at = datetime('now')
      WHERE id = ?`,
  ).bind(list.length, compactStepResultsJson(list), runId).run();
}

export async function markWorkflowRunAwaitingApproval(db, runId, usage, modelUsed, approvalId = null) {
  await db.prepare(
    `UPDATE agentsam_workflow_runs SET
       status = 'awaiting_approval', approval_id = COALESCE(?, approval_id),
       input_tokens = ?, output_tokens = ?, cost_usd = ?, model_used = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).bind(
    approvalId, Number(usage?.inputTokens || 0), Number(usage?.outputTokens || 0), Number(usage?.costUsd || 0), modelUsed ?? null, runId,
  ).run();
}

export async function markWorkflowRunRunning(db, runId, nodeKey = null) {
  await db.prepare(
    `UPDATE agentsam_workflow_runs
        SET status = 'running', current_node_key = COALESCE(?, current_node_key), updated_at = datetime('now')
      WHERE id = ?`,
  ).bind(nodeKey, runId).run();
}

export async function finalizeWorkflowRun(db, p) {
  const finalStatus = p.ok ? 'completed' : 'failed';
  const packedOut = await compactPayloadForJournal(p.output ?? {}, { field: 'output_json' });
  assertJournalPayloadUnderCeiling(packedOut.jsonText, { digest: packedOut.digest, field: 'output_json' });
  const journalJson = compactStepResultsJson(p.journalSteps || []);
  await db.prepare(
    `UPDATE agentsam_workflow_runs SET
       status = ?, output_json = ?, step_results_json = ?, steps_completed = ?,
       input_tokens = ?, output_tokens = ?, cost_usd = ?, model_used = ?, duration_ms = ?,
       completed_at = unixepoch(), kill_reason = ?, error_message = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).bind(
    finalStatus, packedOut.jsonText, journalJson, (p.journalSteps || []).length,
    Number(p.usage?.inputTokens || 0), Number(p.usage?.outputTokens || 0), Number(p.usage?.costUsd || 0),
    p.modelUsed ?? null, Number(p.durationMs || 0), p.killReason ?? null,
    !p.ok && p.killReason ? String(p.killReason).slice(0,4000) : null, p.runId,
  ).run();
  return finalStatus;
}

export async function patchWorkflowRunMetadata(db, runId, patch) {
  const row = await db.prepare(`SELECT metadata_json FROM agentsam_workflow_runs WHERE id = ? LIMIT 1`).bind(runId).first();
  const current = parseWorkflowRunJson(row?.metadata_json, {});
  const next = { ...(current && typeof current === 'object' ? current : {}), ...(patch || {}) };
  await db.prepare(
    `UPDATE agentsam_workflow_runs SET metadata_json = ?, updated_at = datetime('now') WHERE id = ?`,
  ).bind(JSON.stringify(next), runId).run();
  return next;
}

export async function finalizeWorkflowRunWithStatus(db, p) {
  const status = String(p.status || 'completed').toLowerCase();
  const packedOut = await compactPayloadForJournal(p.output ?? {}, { field: 'output_json' });
  assertJournalPayloadUnderCeiling(packedOut.jsonText, { digest: packedOut.digest, field: 'output_json' });
  const journalSteps = Array.isArray(p.journalSteps) ? p.journalSteps : [];
  await db.prepare(
    `UPDATE agentsam_workflow_runs SET
       status = ?, output_json = ?, step_results_json = ?, steps_completed = ?,
       kill_reason = COALESCE(?, kill_reason), completed_at = unixepoch(),
       duration_ms = COALESCE(duration_ms, CAST((unixepoch() - started_at) * 1000 AS INTEGER)),
       updated_at = datetime('now')
     WHERE id = ?`,
  ).bind(status, packedOut.jsonText, compactStepResultsJson(journalSteps), journalSteps.length, p.killReason ?? null, p.runId).run();
  return status;
}

export async function getWorkflowRunForScope(db, { runId, userId, workspaceId }) {
  if (!db || !runId || !userId || !workspaceId) return null;
  return db.prepare(
    `SELECT * FROM agentsam_workflow_runs
      WHERE id = ? AND user_id = ? AND workspace_id = ? LIMIT 1`,
  ).bind(String(runId), String(userId), String(workspaceId)).first();
}

export async function loadWorkflowRunDetail(db, { runId, userId, workspaceId }) {
  const run = await getWorkflowRunForScope(db, { runId, userId, workspaceId });
  if (!run) return null;
  const [stepsRes, approvalsRes] = await Promise.all([
    db.prepare(
      `SELECT id, execution_id, workflow_run_id, node_key, node_type, status,
              edge_taken, approval_id, input_json, output_json, error_json,
              latency_ms, created_at_unix AS created_at
         FROM agentsam_execution_steps
        WHERE workflow_run_id = ? ORDER BY created_at_unix ASC`,
    ).bind(runId).all(),
    db.prepare(
      `SELECT id, status, workflow_run_id, execution_step_id, risk_level,
              tool_name, action_summary, created_at
         FROM agentsam_approval_queue
        WHERE workflow_run_id = ? ORDER BY created_at DESC`,
    ).bind(runId).all(),
  ]);
  return {
    run,
    steps: stepsRes?.results || [],
    approvals: approvalsRes?.results || [],
  };
}

export async function listRecentWorkflowRuns(db, {
  tenantId,
  workspaceId = null,
  query = '',
  limit = 10,
} = {}) {
  const tid = String(tenantId || '').trim();
  if (!db || !tid) return [];
  const safeLimit = Math.max(1, Math.min(50, Math.floor(Number(limit) || 10)));
  const where = ['tenant_id = ?'];
  const binds = [tid];
  const wid = String(workspaceId || '').trim();
  if (wid) { where.push('workspace_id = ?'); binds.push(wid); }
  const q = String(query || '').trim();
  if (q) {
    where.push('(workflow_key LIKE ? OR id LIKE ?)');
    const like = `%${q.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
    binds.push(like, like);
  }
  const { results } = await db.prepare(
    `SELECT id, workflow_key, status, created_at, workspace_id
       FROM agentsam_workflow_runs
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC LIMIT ?`,
  ).bind(...binds, safeLimit).all();
  return results || [];
}

export async function setWorkflowRunStepsTotal(db, runId, stepsTotal) {
  if (!db || !runId) return false;
  const result = await db.prepare(
    `UPDATE agentsam_workflow_runs
        SET steps_total = ?, updated_at = datetime('now')
      WHERE id = ?`,
  ).bind(Math.max(0, Math.floor(Number(stepsTotal) || 0)), String(runId)).run();
  return (result?.meta?.changes ?? result?.changes ?? 0) > 0;
}

export async function finalizePlanBackedWorkflowRun(db, {
  runId,
  planId,
  completed = 0,
  failed = 0,
  skipped = 0,
  durationMs = 0,
} = {}) {
  if (!db || !runId) return false;
  const output = JSON.stringify({
    plan_id: planId ?? null,
    tasks_completed: Number(completed) || 0,
    tasks_failed: Number(failed) || 0,
    tasks_skipped: Number(skipped) || 0,
  });
  const result = await db.prepare(
    `UPDATE agentsam_workflow_runs
        SET status = 'completed', duration_ms = ?, steps_completed = ?,
            output_json = ?, completed_at = unixepoch(), updated_at = datetime('now')
      WHERE id = ?`,
  ).bind(
    Math.max(0, Math.floor(Number(durationMs) || 0)),
    Math.max(0, Math.floor(Number(completed) || 0)),
    output,
    String(runId),
  ).run();
  return (result?.meta?.changes ?? result?.changes ?? 0) > 0;
}

export async function getLatestWorkflowRunForScope(db, {
  workspaceId,
  userId,
  workflowKey = null,
  workflowId = null,
} = {}) {
  if (!db || !workspaceId || !userId) return null;
  const clauses = ['workspace_id = ?', 'user_id = ?'];
  const binds = [String(workspaceId), String(userId)];
  const key = workflowKey != null ? String(workflowKey).trim() : '';
  const id = workflowId != null ? String(workflowId).trim() : '';
  if (key && id) {
    clauses.push('(workflow_key = ? OR workflow_id = ?)');
    binds.push(key, id);
  } else if (key) {
    clauses.push('workflow_key = ?');
    binds.push(key);
  } else if (id) {
    clauses.push('workflow_id = ?');
    binds.push(id);
  }
  return db.prepare(
    `SELECT * FROM agentsam_workflow_runs
      WHERE ${clauses.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT 1`,
  ).bind(...binds).first();
}
