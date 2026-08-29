import { shouldEnforceWorkflowApproval } from '../approvals/policy.js';
import { buildWorkflowParamRoot } from './common.js';

export async function executeWorkflowApproval(env, handlerKey, input, runContext, node, config = {}) {
  if (runContext?.smoke || !shouldEnforceWorkflowApproval(runContext?.workflowMeta)) {
    return { ok: true, output: { status: 'approved', signed_off: true, skipped_approval: true, node_key: node?.node_key } };
  }
  if (!env?.DB) return { ok: false, error: 'DB not available for approval gate' };
  const flat = buildWorkflowParamRoot(input, runContext);
  const approvalId = `appr_${crypto.randomUUID().replace(/-/g,'').slice(0,16)}`;
  const values = {
    id: approvalId,
    tenant_id: flat.tenant_id,
    workspace_id: flat.workspace_id,
    user_id: flat.user_id,
    workflow_run_id: flat.run_id,
    workflow_key: runContext?.workflowKey ?? null,
    handler_key: handlerKey,
    tool_name: config.tool_name || `workflow:${String(node?.node_key || handlerKey || 'gate').slice(0,120)}`,
    action_summary: config.action_summary || node?.title || 'Workflow approval required',
    input_json: JSON.stringify(flat).slice(0,8000),
    approval_type: config.approval_type || 'workflow',
    risk_level: config.risk_level || node?.risk_level || 'high',
    status: 'pending',
    expires_at: Math.floor(Date.now()/1000) + (Number(config.ttl_sec) || 86400),
    created_at: Math.floor(Date.now()/1000),
  };
  const fields = Object.keys(values).filter((key) => values[key] !== undefined);
  await env.DB.prepare(
    `INSERT INTO agentsam_approval_queue (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`,
  ).bind(...fields.map((key) => values[key])).run();
  return { ok: true, output: { approval_id: approvalId, status: 'pending', awaiting_approval: true } };
}
