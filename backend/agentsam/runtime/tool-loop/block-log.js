/**
 * Durable ledger for tool_host preflight blocks (budget, ceiling, transport, halt).
 */
import { scheduleAgentsamToolCallLog } from '../../../../src/core/agent-prompt-builder.js';

/**
 * @param {any} env
 * @param {any} workerCtx
 * @param {object} fields
 */
export function scheduleHostToolBlockedLog(env, workerCtx, fields) {
  const toolName = String(fields.toolName || '').trim() || 'unknown';
  const reason = String(fields.reason || 'tool_blocked').trim() || 'tool_blocked';
  const arm =
    typeof fields.attributedRoutingArmId === 'function'
      ? fields.attributedRoutingArmId()
      : null;
  const share =
    fields.decisionUsageShare && typeof fields.decisionUsageShare === 'object'
      ? fields.decisionUsageShare
      : null;
  scheduleAgentsamToolCallLog(env, workerCtx, {
    tenantId: fields.tenantId,
    sessionId: fields.sessionId,
    toolName,
    status: 'blocked',
    durationMs: 0,
    costUsd: Number(share?.costUsd) || 0,
    inputTokens: Math.max(0, Math.floor(Number(share?.inputTokens) || 0)),
    outputTokens: Math.max(0, Math.floor(Number(share?.outputTokens) || 0)),
    userId: fields.userId,
    workspaceId: fields.workspaceId,
    errorMessage: reason,
    routingArmId: arm,
    mode: fields.mode ?? null,
    modelKey: fields.modelKey ?? fields.model_key ?? null,
    model_key_source: fields.model_key_source ?? fields.modelKeySource ?? 'agent_run',
    source_client: fields.source_client ?? fields.sourceClient ?? 'internal_agent',
    tool_key: toolName,
    tool_category: fields.tool_category ?? fields.toolCategory,
    handler_key: fields.handler_key ?? fields.handlerKey,
    agentsam_tools_id: fields.agentsam_tools_id ?? fields.agentsamToolsId,
    ...(fields.runSpineIds && typeof fields.runSpineIds === 'object' ? fields.runSpineIds : {}),
    ...(fields.ledgerIdentityFields && typeof fields.ledgerIdentityFields === 'object'
      ? fields.ledgerIdentityFields
      : {}),
  });
}
