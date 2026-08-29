/**
 * Protocol-neutral PermissionBroker.
 *
 * tool loop → requiresConfirmation → PermissionBroker
 *   ├─ IAM dashboard adapter (approval_queue + SSE)
 *   └─ ACP client adapter (session/request_permission via notify hook)
 * → continue same turn when possible
 */

import { createApprovalRequest, needsApproval } from './agent-approval-gate.js';
import { formatToolApprovalPreview } from './agent-tool-validator.js';

/**
 * @typedef {{
 *   kind: 'dashboard' | 'acp',
 *   requestPermission?: (req: {
 *     toolName: string,
 *     toolArgs: unknown,
 *     toolCallId: string,
 *     riskLevel: string,
 *     proposalId: string,
 *     preview: string,
 *     rationale: string,
 *   }) => Promise<{ outcome: 'allow_once' | 'allow_always' | 'reject' | 'cancelled', optionId?: string }>,
 * }} PermissionAdapter
 */

/**
 * @param {any} validation
 * @param {any} modeConfig
 * @param {any} userPolicy
 */
export function permissionBrokerNeedsApproval(validation, modeConfig, userPolicy) {
  return needsApproval(validation, modeConfig, userPolicy);
}

/**
 * @param {any} env
 * @param {ExecutionContext|undefined} workerCtx
 * @param {{
 *   adapter?: PermissionAdapter|null,
 *   tenantId: string,
 *   sessionId: string,
 *   userId: string,
 *   workspaceId: string,
 *   personUuid?: string|null,
 *   toolName: string,
 *   toolArgs: unknown,
 *   toolCallId: string,
 *   riskLevel: string,
 *   rationale: string,
 *   ledgerExtras?: object,
 *   grantOnApproval?: boolean,
 *   agentRunId?: string|null,
 *   conversationId?: string|null,
 *   mcpCtx?: { personUuid?: string|null },
 *   emit?: (type: string, payload: object) => void,
 *   notifySam?: Function,
 *   resolveWorkerProjectId?: Function,
 *   loadAgentsamToolRow?: Function,
 *   validation: any,
 * }} opts
 */
export async function permissionBrokerRequestApproval(env, workerCtx, opts) {
  const adapter = opts.adapter && typeof opts.adapter === 'object' ? opts.adapter : null;
  const preview = formatToolApprovalPreview(opts.toolName, opts.toolArgs);

  const proposalId = await createApprovalRequest(env, workerCtx, {
    tenantId: opts.tenantId,
    sessionId: opts.sessionId,
    userId: opts.userId,
    workspaceId: opts.workspaceId,
    personUuid: opts.personUuid ?? opts.mcpCtx?.personUuid ?? null,
    toolName: opts.toolName,
    toolArgs: opts.toolArgs,
    toolCallId: opts.toolCallId,
    riskLevel: opts.riskLevel,
    rationale: opts.rationale,
    ledgerExtras: opts.ledgerExtras,
    grantOnApproval: opts.grantOnApproval === true,
    agentRunId: opts.agentRunId ?? null,
    conversationId: opts.conversationId ?? opts.sessionId,
  });

  if (adapter?.kind === 'acp' && typeof adapter.requestPermission === 'function') {
    try {
      const decision = await adapter.requestPermission({
        toolName: opts.toolName,
        toolArgs: opts.toolArgs,
        toolCallId: opts.toolCallId,
        riskLevel: opts.riskLevel,
        proposalId,
        preview,
        rationale: opts.rationale,
      });
      const outcome = decision?.outcome || 'cancelled';
      if (outcome === 'allow_once' || outcome === 'allow_always') {
        return {
          halted: false,
          sameTurnContinue: true,
          proposalId,
          decision: outcome,
          adapter: 'acp',
        };
      }
      return {
        halted: true,
        sameTurnContinue: false,
        proposalId,
        decision: outcome,
        adapter: 'acp',
      };
    } catch (e) {
      console.warn('[permission-broker] acp adapter', e?.message ?? e);
      // Fall through to dashboard halt semantics
    }
  }

  // Dashboard adapter (default): emit SSE approval events; halt turn for separate resume.
  if (typeof opts.emit === 'function') {
    opts.emit('approval_required', {
      proposal_id: proposalId,
      approval_id: proposalId,
      tool_name: opts.toolName,
      tool_args: opts.toolArgs,
      command_preview: preview,
      action_summary: opts.rationale,
      risk_level: opts.riskLevel,
      message: 'This action requires your approval.',
    });
    opts.emit('tool_approval_request', {
      tool: {
        name: opts.toolName,
        description: opts.rationale,
        parameters: opts.toolArgs && typeof opts.toolArgs === 'object' ? opts.toolArgs : {},
        preview,
        approval_id: proposalId,
        proposal_id: proposalId,
        risk_level: opts.riskLevel,
      },
    });
  }

  return {
    halted: true,
    sameTurnContinue: false,
    proposalId,
    decision: 'awaiting_dashboard',
    adapter: 'dashboard',
  };
}

/**
 * Build ACP adapter that asks the Client via session/request_permission.
 * @param {{
 *   requestClientPermission: (params: Record<string, unknown>) => Promise<{ outcome: string, optionId?: string }>,
 * }} hooks
 * @returns {PermissionAdapter}
 */
export function createAcpPermissionAdapter(hooks) {
  return {
    kind: 'acp',
    async requestPermission(req) {
      const result = await hooks.requestClientPermission({
        sessionId: undefined, // filled by caller context if needed
        toolCall: {
          toolCallId: req.toolCallId,
          title: req.toolName,
          kind: 'other',
          status: 'pending',
          rawInput: req.toolArgs,
        },
        options: [
          { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'allow-always', name: 'Allow always', kind: 'allow_always' },
          { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
        ],
        _meta: {
          iam: {
            proposal_id: req.proposalId,
            preview: req.preview,
            rationale: req.rationale,
            risk_level: req.riskLevel,
          },
        },
      });
      const optionId = result?.optionId || '';
      if (optionId === 'allow-once' || result?.outcome === 'selected' && optionId.includes('allow')) {
        if (optionId === 'allow-always') return { outcome: 'allow_always', optionId };
        return { outcome: 'allow_once', optionId: optionId || 'allow-once' };
      }
      if (optionId === 'allow-always') return { outcome: 'allow_always', optionId };
      if (optionId === 'reject' || result?.outcome === 'rejected') {
        return { outcome: 'reject', optionId: optionId || 'reject' };
      }
      return { outcome: 'cancelled', optionId };
    },
  };
}
