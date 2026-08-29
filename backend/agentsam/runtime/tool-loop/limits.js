import { createAgentRunAbortScope } from '../run-cancel.js';
import { assertSpendKillSwitch } from '../../../identity/policy/spend-ledger.js';
import { buildLoopResult } from './outcome.js';

export function createAbortScopeForLoop({
  request,
  externalSignal,
  env,
  chatAgentRunId,
  sessionId,
}) {
  const abortScope = createAgentRunAbortScope({
    request,
    externalSignal,
    env,
    agentRunId: chatAgentRunId != null ? String(chatAgentRunId) : null,
  });
  if (sessionId) {
    abortScope.signal.addEventListener(
      'abort',
      () => {
        import('../../sessions/session-context.js')
          .then(({ cancelPendingFsaForConversation }) =>
            cancelPendingFsaForConversation(env, sessionId, 'stream_canceled'),
          )
          .catch(() => {});
      },
      { once: true },
    );
  }
  return abortScope;
}

export function createShouldStopRun(abortScope) {
  return async () => {
    if (abortScope.isAborted()) return true;
    try {
      await abortScope.throwIfAborted();
      return false;
    } catch {
      return true;
    }
  };
}

export function resolveEffectiveMaxToolCalls(maxToolCalls, userPolicy) {
  const modeMax = (() => {
    if (maxToolCalls === 0 || maxToolCalls === '0') return 0;
    const value = Number(maxToolCalls);
    if (Number.isFinite(value) && value > 0) return Math.max(1, Math.floor(value));
    return Math.max(1, Math.floor(Number(maxToolCalls) || 15));
  })();
  const policyMax = Math.floor(Number(userPolicy?.max_tool_chain_depth));
  return Number.isFinite(policyMax) && policyMax > 0
    ? Math.min(modeMax, policyMax)
    : modeMax;
}

export function checkRunTimeout({
  runStartedAt,
  maxRunMs,
  loopBag,
  scheduleLoopUsageTelemetry,
  synthesizeVisibleLoopHalt,
  emit,
  safeDone,
  modelKey,
  chatAgentRunId,
}) {
  if (Date.now() - runStartedAt <= maxRunMs) return null;
  loopBag.loopTimedOut = true;
  scheduleLoopUsageTelemetry(false);
  synthesizeVisibleLoopHalt(
    'agent_run_timeout',
    'I hit the run time limit before finishing a written answer. Prior tool results are still in the thread.',
  );
  emit('error', {
    message: 'Agent run timed out',
    code: 'agent_run_timeout',
    tool_calls_used: loopBag.toolCallsUsed,
    turns: loopBag.turnCount,
    agent_run_id: chatAgentRunId != null ? String(chatAgentRunId) : null,
    model_key: modelKey,
    executed_tools: [...new Set(loopBag.executedToolNames.map((name) => String(name || '').trim()).filter(Boolean))].slice(0, 24),
  });
  safeDone({
    tool_calls_used: loopBag.toolCallsUsed,
    turns: loopBag.turnCount,
    code: 'agent_run_timeout',
  });
  return buildLoopResult({
    loopBag,
    modelKey,
    chatAgentRunId,
    extras: { timedOut: true },
  });
}

export async function checkSpendGate({
  env,
  tenantId,
  workspaceId,
  routingWs,
  userId,
  sessionId,
  modelKey,
  loopBag,
  scheduleLoopUsageTelemetry,
  emit,
  safeDone,
  chatAgentRunId,
}) {
  const spendGate = await assertSpendKillSwitch(env, {
    tenantId,
    workspaceId: routingWs || workspaceId,
    userId,
    sessionId,
    modelKey,
  });
  if (spendGate.ok) return null;
  const code = spendGate.error || 'spend_cap_exceeded';
  scheduleLoopUsageTelemetry(false);
  emit('error', {
    message: spendGate.message || 'Spend cap reached',
    code,
    spent_usd: spendGate.spent_usd ?? null,
    cap_usd: spendGate.cap_usd ?? null,
    tool_calls_used: loopBag.toolCallsUsed,
    turns: loopBag.turnCount,
    agent_run_id: chatAgentRunId != null ? String(chatAgentRunId) : null,
    model_key: modelKey,
  });
  safeDone({
    tool_calls_used: loopBag.toolCallsUsed,
    turns: loopBag.turnCount,
    code,
    spend_blocked: true,
  });
  return buildLoopResult({
    loopBag,
    modelKey,
    chatAgentRunId,
    extras: { spendBlocked: true },
  });
}
