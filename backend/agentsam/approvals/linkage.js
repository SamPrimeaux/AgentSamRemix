/** Approval side effects that link queue decisions to execution records. */

export async function updateCommandRunApproval(env, commandRunId, status) {
  const id = String(commandRunId || '').trim();
  if (!env?.DB || !id) return;
  await env.DB
    .prepare(`UPDATE agentsam_command_run SET approval_status = ? WHERE id = ?`)
    .bind(String(status || '').trim(), id)
    .run()
    .catch(() => null);
}

export async function markDeniedPlanTask(env, taskId, note) {
  const id = String(taskId || '').trim();
  if (!env?.DB || !id) return;
  await env.DB
    .prepare(
      `UPDATE agentsam_plan_tasks
          SET status = 'skipped', completed_at = unixepoch(), output_summary = ?
        WHERE id = ?`,
    )
    .bind(String(note || 'Denied — no execution.').slice(0, 4000), id)
    .run()
    .catch(() => null);
}

export async function markDeniedExecutionStep(env, stepId, approvalId, note) {
  const id = String(stepId || '').trim();
  if (!env?.DB || !id) return;
  await env.DB
    .prepare(
      `UPDATE agentsam_execution_steps
          SET status = 'failed', output_json = ?, error_json = ?
        WHERE id = ?`,
    )
    .bind(
      JSON.stringify({ denied: true, approval_id: String(approvalId || '') }),
      JSON.stringify({ error: String(note || 'Denied — no execution.') }),
      id,
    )
    .run()
    .catch(() => null);
}

export async function linkApprovalDecision(env, row, status, note = '') {
  const decision = String(status || '').trim().toLowerCase();
  if (decision === 'approved') {
    await updateCommandRunApproval(env, row?.command_run_id, 'approved');
    return;
  }
  if (decision !== 'denied') return;
  let input = {};
  try {
    input = JSON.parse(String(row?.input_json || '{}'));
  } catch {
    input = {};
  }
  const denyNote = note || '[terminal] Denied — no command execution.';
  await updateCommandRunApproval(env, row?.command_run_id, 'denied');
  await markDeniedPlanTask(env, input.plan_task_id, denyNote);
  await markDeniedExecutionStep(
    env,
    input.execution_step_id || row?.execution_step_id,
    row?.id,
    denyNote,
  );
}
