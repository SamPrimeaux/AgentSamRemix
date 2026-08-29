import { decideWorkflowApproval } from './repository.js';
import { computeNextNodeAfterWorkflowApproval } from '../durable/execute-node.js';
import { sendIamWorkflowEvent } from '../durable/service-client.js';

/**
 * Own the complete workflow approval transition, including durable wake-up.
 * HTTP callers provide intent; workflow owns persistence + continuation semantics.
 */
export async function transitionWorkflowApproval(env, {
  runId = null,
  approvalId = null,
  decision,
  approvedBy = null,
  tenantId = null,
  workspaceId = null,
} = {}) {
  const approval = await decideWorkflowApproval(env?.DB, {
    runId,
    approvalId,
    decision,
    approvedBy,
    tenantId,
    workspaceId,
  });
  if (!approval.ok) return approval;

  const resolvedRunId = approval.run_id;
  const instanceId = approval.workflow_instance_id;
  if (resolvedRunId && instanceId && env?.IAM_WORKFLOWS) {
    if (approval.decision === 'approved') {
      const next = await computeNextNodeAfterWorkflowApproval(env, resolvedRunId, 'approved');
      if (!next.ok) {
        return { ...approval, ok: false, error: next.error || 'approval_resume_failed' };
      }
      const wake = await sendIamWorkflowEvent(env, instanceId, {
        decision: 'approved',
        run_id: resolvedRunId,
        approval_id: approvalId,
        next_node_key: next.next_node_key ?? null,
        continuation_value: next.continuation_value ?? null,
      });
      if (wake?.error) {
        return { ...approval, ok: false, error: wake.error, durable_wake_failed: true };
      }
    } else {
      const wake = await sendIamWorkflowEvent(env, instanceId, {
        decision: 'denied',
        run_id: resolvedRunId,
        approval_id: approvalId,
      });
      if (wake?.error) {
        return { ...approval, ok: false, error: wake.error, durable_wake_failed: true };
      }
    }
  }

  return approval;
}
