/**
 * Terminal assist → agentsam_agent_run + agentsam_tool_chain + agentsam_error_log.
 */

import { fireForgetAgentToolChainRow } from '../../backend/telemetry/tool-chain.js';
import { fetchModelCostUsd } from './agent-model-resolver.js';
import {
  createAgentRunId,
  startAgentRun,
  finalizeAgentRun,
} from '../../backend/telemetry/agent-run.js';
import { scheduleAgentsamErrorLog } from '../../backend/telemetry/error-log.js';
import { normalizeCanonicalTaskType } from './resolveModel.js';

const TASK_TYPE = normalizeCanonicalTaskType('terminal_execution');

/** @param {unknown} result */
export function extractDispatchUsage(result) {
  const usage =
    result && typeof result === 'object' && result.usage && typeof result.usage === 'object'
      ? result.usage
      : result &&
          typeof result === 'object' &&
          result.response &&
          typeof result.response === 'object' &&
          result.response.usage &&
          typeof result.response.usage === 'object'
        ? result.response.usage
        : null;
  if (!usage) {
    return { inputTokens: 0, outputTokens: 0 };
  }
  return {
    inputTokens: Math.max(
      0,
      Math.floor(
        Number(
          usage.input_tokens ??
            usage.inputTokens ??
            usage.prompt_tokens ??
            usage.promptTokens ??
            0,
        ) || 0,
      ),
    ),
    outputTokens: Math.max(
      0,
      Math.floor(
        Number(
          usage.output_tokens ??
            usage.outputTokens ??
            usage.completion_tokens ??
            usage.completionTokens ??
            0,
        ) || 0,
      ),
    ),
  };
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   workspaceId: string,
 *   tenantId: string,
 *   sessionId?: string | null,
 *   agentRunId?: string | null,
 *   errorCode: string,
 *   errorMessage: string,
 *   mode?: string | null,
 *   command?: string | null,
 * }} o
 */
export function logTerminalAssistError(env, ctx, o) {
  const ws = o.workspaceId != null ? String(o.workspaceId).trim() : '';
  const tid = o.tenantId != null ? String(o.tenantId).trim() : '';
  const msg = o.errorMessage != null ? String(o.errorMessage).slice(0, 8000) : '';
  if (!ws || !tid || !msg) return;
  scheduleAgentsamErrorLog(env, ctx, {
    workspaceId: ws,
    tenantId: tid,
    sessionId: o.sessionId ?? null,
    errorCode: o.errorCode,
    errorType: 'terminal_assist',
    errorMessage: msg,
    source: 'terminal_assist',
    sourceId: o.agentRunId ?? o.sessionId ?? null,
    contextJson: JSON.stringify({
      terminal_session_id: o.sessionId ?? null,
      mode: o.mode ?? null,
      command: o.command != null ? String(o.command).slice(0, 400) : null,
    }),
  });
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   userId: string,
 *   workspaceId: string,
 * }} scope
 */
export function mintTerminalAssistAgentRunId(env, ctx, scope) {
  const uid = scope.userId != null ? String(scope.userId).trim() : '';
  const ws = scope.workspaceId != null ? String(scope.workspaceId).trim() : '';
  if (!uid || !ws || !env?.DB || !ctx?.waitUntil) return null;
  return createAgentRunId({ label: 'terminal_assist' });
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   agentRunId: string,
 *   userId: string,
 *   tenantId: string | null,
 *   workspaceId: string,
 *   sessionId?: string | null,
 *   modelKey: string,
 *   mode?: string | null,
 * }} p
 */
export function startTerminalAssistAgentRun(env, ctx, p) {
  const start = startAgentRun(env, {
    runId: p.agentRunId,
    userId: p.userId,
    tenantId: p.tenantId,
    workspaceId: p.workspaceId,
    conversationId: p.sessionId ?? null,
    routingArmId: null,
    modelKey: p.modelKey,
    taskType: TASK_TYPE,
    mode: p.mode === 'agent' ? 'agent' : 'ask',
  });
  if (ctx?.waitUntil) ctx.waitUntil(start);
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   agentRunId: string,
 *   userId: string,
 *   tenantId: string | null,
 *   workspaceId: string,
 *   sessionId?: string | null,
 *   modelKey: string,
 *   mode?: string | null,
 *   command?: string | null,
 *   success: boolean,
 *   errorMessage?: string | null,
 *   inputTokens?: number,
 *   outputTokens?: number,
 *   durationMs: number,
 * }} p
 */
export async function finalizeTerminalAssistAgentRun(env, ctx, p) {
  const inputTokens = Math.max(0, Math.floor(Number(p.inputTokens) || 0));
  const outputTokens = Math.max(0, Math.floor(Number(p.outputTokens) || 0));
  const costUsd = await fetchModelCostUsd(env, p.modelKey, inputTokens, outputTokens);
  const durationMs = Math.max(0, Math.floor(Number(p.durationMs) || 0));
  const errMsg =
    p.success || p.errorMessage == null || String(p.errorMessage).trim() === ''
      ? null
      : String(p.errorMessage).slice(0, 8000);

  if (ctx?.waitUntil) ctx.waitUntil(finalizeAgentRun(env, {
    runId: p.agentRunId,
    userId: p.userId,
    tenantId: p.tenantId,
    workspaceId: p.workspaceId,
    conversationId: p.sessionId ?? null,
    routingArmId: null,
    modelKey: p.modelKey,
    taskType: TASK_TYPE,
    mode: p.mode === 'agent' ? 'agent' : 'ask',
    success: !!p.success,
    inputTokens,
    outputTokens,
    costUsd,
    durationMs,
    errorMessage: errMsg,
  }));

  void fireForgetAgentToolChainRow(env, {
    toolKey: 'terminal_assist',
    agentSessionId: p.sessionId ?? null,
    terminalSessionId: p.sessionId ?? null,
    tenantId: p.tenantId,
    userId: p.userId,
    workspaceId: p.workspaceId,
    agentRunId: p.agentRunId,
    conversationId: p.sessionId ?? null,
    ctx,
    durationMs,
    inputTokens,
    outputTokens,
    costUsd,
    error: p.success ? null : { message: errMsg || 'terminal_assist_failed' },
    toolInputJson: JSON.stringify({
      mode: p.mode ?? null,
      command: p.command != null ? String(p.command).slice(0, 400) : null,
    }),
  });

  if (!p.success && errMsg) {
    logTerminalAssistError(env, ctx, {
      workspaceId: p.workspaceId,
      tenantId: String(p.tenantId || '').trim(),
      sessionId: p.sessionId ?? null,
      agentRunId: p.agentRunId,
      errorCode: 'terminal_assist_failed',
      errorMessage: errMsg,
      mode: p.mode ?? null,
      command: p.command ?? null,
    });
  }
}
