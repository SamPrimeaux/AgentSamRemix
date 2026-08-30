/**
 * Generic durable-operation status ledger.
 *
 * Harvested from agent/harvest-agentsamfast-gold (deleted branch) and
 * rewritten against agentsam_operations (migrations/1325_agentsam_operations.sql)
 * instead of the branch's Cloudflare-Workflow class -- that class was left
 * behind because "who owns durable execution" (iam-workflows' Workflow
 * binding, Workflow Studio's saved defs, MY_QUEUE's live traffic) is an
 * unmapped, separate decision, not something to settle inside a branch
 * cleanup.
 *
 * This file has ONE job: answer "did this thing finish, and if not, where
 * did it stop" for anything that wants to record its own progress. It does
 * not execute anything, retry anything, or orchestrate anything -- callers
 * do that and just report status here.
 *
 * NOT WIRED to any route, cron, or queue consumer. Nothing calls this yet.
 *
 * Hard rule: transitioning to 'waiting_for_approval' MUST create a row in
 * agentsam_approval_queue (see requestOperationApproval below), because
 * that is the only status that already has a real notification path --
 * backend/jobs/approval-notify.js sweeps agentsam_approval_queue and pushes
 * at 10 minutes, emails + halts at 20. An operation that sits in
 * 'waiting_for_approval' with no approval_queue_id is invisible to that
 * sweep and will rot silently -- this is the exact failure Sam described:
 * rows stuck 'running'/'waiting_for_approval' in the DB that were actually
 * dead I/O, not agents doing something rogue.
 *
 * That sweep itself is currently NOT running in production (no cron
 * trigger in wrangler.jsonc, no scheduled() export on the live Worker
 * entry backend/src/index.ts) -- confirmed 2026-08-30. Wiring that is a
 * separate, deliberate infra change, not implied by adding this file.
 */

import { insertApprovalQueueRow, getApprovalQueueRow } from '../agentsam/approvals/queue.js';

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/**
 * @param {any} env
 * @param {{ tenantId?: string|null, workspaceId: string, userId: string,
 *   operationType: string, title: string, triggerSource?: string,
 *   runId?: string, idempotencyKey?: string, inputJson?: unknown }} input
 */
export async function createOperation(env, input) {
  if (!env?.DB) throw new Error('DB not configured');
  const id = newId('op');
  await env.DB.prepare(
    `INSERT INTO agentsam_operations
       (id, tenant_id, workspace_id, user_id, operation_type, title,
        trigger_source, run_id, idempotency_key, input_json, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued')`,
  )
    .bind(
      id,
      input.tenantId ?? null,
      input.workspaceId,
      input.userId,
      input.operationType,
      input.title,
      input.triggerSource ?? 'api',
      input.runId ?? null,
      input.idempotencyKey ?? null,
      input.inputJson != null ? JSON.stringify(input.inputJson).slice(0, 16384) : null,
    )
    .run();
  return { id };
}

/** @param {any} env @param {string} workspaceId @param {string} operationId */
export async function getOperation(env, workspaceId, operationId) {
  if (!env?.DB) return null;
  return env.DB.prepare(
    `SELECT * FROM agentsam_operations WHERE id = ? AND workspace_id = ? LIMIT 1`,
  )
    .bind(operationId, workspaceId)
    .first()
    .catch(() => null);
}

/**
 * Plain status transition. Does NOT handle 'waiting_for_approval' --
 * use requestOperationApproval for that so the approval_queue_id link and
 * notification sweep entry are never skipped.
 * @param {any} env @param {string} operationId
 * @param {'queued'|'running'|'paused'|'completed'|'failed'|'cancelled'|'rolled_back'} status
 * @param {{ outputJson?: unknown, errorJson?: unknown }} [extra]
 */
export async function transitionOperation(env, operationId, status, extra = {}) {
  if (!env?.DB) throw new Error('DB not configured');
  if (status === 'waiting_for_approval') {
    throw new Error('use requestOperationApproval, not transitionOperation, for waiting_for_approval');
  }
  const completedAt = ['completed', 'failed', 'cancelled', 'rolled_back'].includes(status)
    ? Math.floor(Date.now() / 1000)
    : null;
  await env.DB.prepare(
    `UPDATE agentsam_operations
        SET status = ?, updated_at = unixepoch(),
            output_json = COALESCE(?, output_json),
            error_json = COALESCE(?, error_json),
            completed_at = COALESCE(?, completed_at)
      WHERE id = ?`,
  )
    .bind(
      status,
      extra.outputJson != null ? JSON.stringify(extra.outputJson).slice(0, 16384) : null,
      extra.errorJson != null ? JSON.stringify(extra.errorJson).slice(0, 4096) : null,
      completedAt,
      operationId,
    )
    .run();
}

/**
 * The only correct way to put an operation into 'waiting_for_approval'.
 * Creates the agentsam_approval_queue row so backend/jobs/approval-notify.js
 * can find and notify on it once that sweep is actually wired.
 *
 * @param {any} env
 * @param {{ id: string, tenantId?: string|null, workspaceId: string, userId: string }} operation
 * @param {{ toolName?: string, actionSummary: string, approvalType?: string, riskLevel?: string }} approval
 */
export async function requestOperationApproval(env, operation, approval) {
  if (!env?.DB) throw new Error('DB not configured');
  const approvalId = newId('appr');
  await insertApprovalQueueRow(env, {
    id: approvalId,
    tenant_id: operation.tenantId ?? null,
    workspace_id: operation.workspaceId,
    user_id: operation.userId,
    tool_name: approval.toolName ?? null,
    action_summary: approval.actionSummary,
    approval_type: approval.approvalType ?? 'operation_step',
    risk_level: approval.riskLevel ?? 'medium',
    status: 'pending',
    created_at: Math.floor(Date.now() / 1000),
  });
  await env.DB.prepare(
    `UPDATE agentsam_operations
        SET status = 'waiting_for_approval', approval_queue_id = ?, updated_at = unixepoch()
      WHERE id = ?`,
  )
    .bind(approvalId, operation.id)
    .run();
  return { approvalId };
}

/**
 * Poll-friendly: resolve an operation waiting on approval back to
 * running/failed once a human has decided. Does not resume any work
 * itself -- caller re-enters its own logic based on the returned status.
 * @param {any} env @param {string} operationId
 */
export async function checkOperationApproval(env, operationId) {
  const op = await env.DB.prepare(`SELECT * FROM agentsam_operations WHERE id = ?`)
    .bind(operationId)
    .first()
    .catch(() => null);
  if (!op || !op.approval_queue_id) return { resolved: false, status: op?.status ?? null };
  const approval = await getApprovalQueueRow(env, op.approval_queue_id);
  if (!approval || approval.status === 'pending') return { resolved: false, status: 'waiting_for_approval' };
  const nextStatus = approval.status === 'approved' ? 'running' : 'failed';
  await transitionOperation(env, operationId, nextStatus, {
    errorJson: approval.status !== 'approved' ? { reason: `approval_${approval.status}` } : undefined,
  });
  return { resolved: true, status: nextStatus, approvalStatus: approval.status };
}

/** @param {any} env @param {string} operationId @param {string} stepKey @param {{ status: string, outputJson?: unknown, error?: string }} update */
export async function recordStep(env, operationId, stepKey, update) {
  if (!env?.DB) throw new Error('DB not configured');
  const existing = await env.DB.prepare(
    `SELECT id FROM agentsam_operation_steps WHERE operation_id = ? AND step_key = ? LIMIT 1`,
  )
    .bind(operationId, stepKey)
    .first()
    .catch(() => null);
  if (existing) {
    await env.DB.prepare(
      `UPDATE agentsam_operation_steps
          SET status = ?, output_json = COALESCE(?, output_json), error = COALESCE(?, error), updated_at = unixepoch()
        WHERE id = ?`,
    )
      .bind(
        update.status,
        update.outputJson != null ? JSON.stringify(update.outputJson).slice(0, 16384) : null,
        update.error ?? null,
        existing.id,
      )
      .run();
    return { id: existing.id };
  }
  const id = newId('opstep');
  await env.DB.prepare(
    `INSERT INTO agentsam_operation_steps (id, operation_id, step_key, status, output_json, error)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      operationId,
      stepKey,
      update.status,
      update.outputJson != null ? JSON.stringify(update.outputJson).slice(0, 16384) : null,
      update.error ?? null,
    )
    .run();
  return { id };
}
