/** Cursor / Agent Sam alignment snapshots. Alignment is not a workflow. */
import { ensureExecutionParent } from '../../telemetry/executions/ledger.js';
import { upsertAgentsamMemory } from '../../../src/core/memory.js';

function newAlignmentId() {
  return `align_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export async function recordAlignmentSnapshot(env, ctx, payload) {
  const tenantId = payload?.tenantId != null ? String(payload.tenantId).trim() : '';
  const workspaceId = payload?.workspaceId != null ? String(payload.workspaceId).trim() : '';
  const userId = payload?.userId != null ? String(payload.userId).trim() : '';
  if (!env?.DB || !tenantId || !workspaceId || !userId) {
    return { ok: false, error: 'missing tenant_id, workspace_id, or user_id' };
  }

  const alignmentId = newAlignmentId();
  const summary = {
    todo_id: payload.todoId ?? null,
    plan_task_id: payload.planTaskId ?? null,
    plan_id: payload.planId ?? null,
    session_id: payload.sessionId ?? null,
    summary: payload.summary != null ? String(payload.summary).slice(0, 8000) : '',
    files_changed: Array.isArray(payload.filesChanged) ? payload.filesChanged.map(String).slice(0, 200) : [],
    source: 'cursor_alignment',
  };

  const executionId = await ensureExecutionParent(env, {
    executionType: 'alignment',
    runId: alignmentId,
    executionKey: 'cursor_alignment',
    tenantId,
    workspaceId,
    userId,
    status: 'completed',
    durationMs: 0,
    completedAtUnix: Math.floor(Date.now() / 1000),
  });

  if (payload.memory !== false) {
    const memKey = payload.todoId != null && String(payload.todoId).trim()
      ? `alignment:${String(payload.todoId).trim()}`
      : `alignment:${alignmentId.slice(-12)}`;
    await upsertAgentsamMemory(
      env,
      {
        tenantId,
        userId,
        workspaceId,
        memoryType: 'project',
        key: memKey,
        value: JSON.stringify({ ...summary, alignment_id: alignmentId, execution_id: executionId }),
        source: 'alignment_sync',
      },
      { ctx },
    );
  }

  return { ok: true, alignment_id: alignmentId, execution_id: executionId };
}
