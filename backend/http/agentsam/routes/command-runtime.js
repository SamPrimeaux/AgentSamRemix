import { dispatchByToolCode } from './dispatch-by-tool-code.js';
import { commandHandlerKind, commandHandlerRef, commandShellLine, renderShellLine } from '../../../agentsam/catalog/command-row.js';
import {
  executeCommand as executeBackendCommand,
  completeCommand,
  handleAgentApprovalDecision as decideBackendApproval,
} from '../../../agentsam/commands/execute.js';

export async function dispatchAgentsamCommand(env, cmdRow, args = {}, runContext = {}) {
  const kind = commandHandlerKind(cmdRow);
  const ref = commandHandlerRef(cmdRow);
  const slug = String(cmdRow?.slug || '').trim();
  const rendered = renderShellLine(commandShellLine(cmdRow), args);
  const merged = { command: rendered, args, ...(typeof args === 'object' && args ? args : {}) };
  switch (kind) {
    case 'shell':
      if (!rendered) throw new Error(`[dispatch] ${slug} shell_line is empty`);
      return dispatchByToolCode(env, 'terminal_run', merged, runContext);
    case 'tool':
      if (!ref) throw new Error(`[dispatch] ${slug} tool handler_ref missing`);
      return dispatchByToolCode(env, ref, merged, runContext);
    case 'workflow':
      if (!ref) throw new Error(`[dispatch] ${slug} workflow handler_ref missing`);
      return dispatchByToolCode(env, 'agentsam_run_agent', {
        workflow_key: ref,
        input: { ...args },
        tenant_id: runContext?.tenantId ?? runContext?.tenant_id ?? env?.TENANT_ID ?? null,
        workspace_id: runContext?.workspaceId ?? runContext?.workspace_id ?? null,
        user_id: runContext?.userId ?? runContext?.user_id ?? null,
        trigger_type: 'agent',
      }, runContext);
    case 'script': {
      const { executeAgentsamScript } = await import('../../../../src/core/execute-agentsam-script.js');
      return executeAgentsamScript(env, {
        scriptSlug: ref || slug.replace(/^\//, ''),
        workspaceId: runContext?.workspaceId ?? runContext?.workspace_id,
        tenantId: runContext?.tenantId ?? runContext?.tenant_id,
        userId: runContext?.userId ?? runContext?.user_id,
        triggerSource: 'agent_sam',
      }, merged, runContext);
    }
    case 'in_app': {
      const key = String(ref || slug).trim().toLowerCase();
      if (key.startsWith('plan.') || key === 'plan' || key === 'plan.start') {
        const { dispatchInAppPlanCommand } = await import('./plan-on-demand.js');
        return dispatchInAppPlanCommand(env, null, key, args, runContext);
      }
      const { dispatchInAppThreadCommand } = await import('../../../agentsam/sessions/thread-on-demand.js');
      return dispatchInAppThreadCommand(env, null, ref || slug, args, runContext);
    }
    default:
      throw new Error(`[dispatch] unknown handler_kind=${kind} for ${slug}`);
  }
}

export function executeCommand(env, ctx, input) {
  return executeBackendCommand(env, ctx, input, { dispatchCommand: dispatchAgentsamCommand });
}
export function handleAgentApprovalDecision(env, ctx, input) {
  return decideBackendApproval(env, ctx, input, { dispatchCommand: dispatchAgentsamCommand });
}
export { completeCommand };
