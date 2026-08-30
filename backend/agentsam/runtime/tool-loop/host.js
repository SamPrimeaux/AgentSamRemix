/**
 * Tool-loop host: validateToolCall → needsApproval → dispatchToolCallWithBudget.
 * Mode allowlist/ceiling is enforced here; the model only proposes.
 */
import {
  validateToolCall,
  dispatchToolCallWithBudget,
} from '../../../../src/core/agent-tool-validator.js';
import { needsApproval } from '../../../../src/core/agent-approval-gate.js';
import {
  scheduleRoutingArmBanditUpdate,
  scheduleRoutingArmQualityUpdate,
} from '../routing/routing.js';
import { assertToolAllowedByMode } from './ceiling.js';
import { dispatchPendingApplyPatchCalls } from './apply-patch.js';
import { runToolHostPreflight } from './preflight.js';
import { executeToolHostCall } from './execute.js';
import { finalizeToolHostCall } from './finalize.js';
import { allocateDecisionTurnUsageShares } from '../../../../src/core/decision-turn-tool-attribution.js';
import { isProgrammaticFunctionCall } from '../../providers/openai-ptc.js';

export {
  validateToolCall,
  dispatchToolCallWithBudget,
  needsApproval,
};

export { assertToolAllowedByMode };

const PARALLEL_FS_READ_TOOLS = new Set(['fs_read_file', 'fs_search_files', 'fs_list_dir']);

function isParallelizableFsRead(call) {
  const n = String(call?.name || call?.tool_name || '').trim();
  return PARALLEL_FS_READ_TOOLS.has(n);
}

/**
 * Write mutable loop fields back onto L.
 * @param {Record<string, any>} L
 * @param {Record<string, any>} state
 */
function writebackLoopState(L, state) {
  Object.assign(L, {
    activeTools: state.activeTools,
    toolCallsUsed: state.toolCallsUsed,
    chatToolLedger: state.chatToolLedger,
    toolChainRootId: state.toolChainRootId,
    forceTextOnlyAfterRepeatHalt: state.forceTextOnlyAfterRepeatHalt,
    lastToolArgsFingerprint: state.lastToolArgsFingerprint,
    repeatedSameToolArgsCount: state.repeatedSameToolArgsCount,
    lastToolNameOnly: state.lastToolNameOnly,
    repeatedSameToolNameCount: state.repeatedSameToolNameCount,
    consecutiveEmptyHostedShellRecovers: state.consecutiveEmptyHostedShellRecovers,
    openaiPtcActive: state.openaiPtcActive,
    openaiResponsesAccumulatedInput: state.openaiResponsesAccumulatedInput,
    loopTimedOut: state.loopTimedOut,
  });
}

/**
 * Build earlyReturn payload shared by cancel/timeout/approval paths.
 * @param {Record<string, any>} state
 * @param {Record<string, any>} extra
 */
function buildEarlyReturn(state, extra) {
  const {
    totalUsage,
    toolCallsUsed,
    executedToolNames,
    modelKey,
    turnCount,
    chatAgentRunId,
    toolChainRootId,
  } = state;
  return {
    totalUsage,
    toolCallsUsed,
    executedToolNames,
    modelKey,
    turnCount,
    workflowRunId: null,
    agentRunId: chatAgentRunId != null ? String(chatAgentRunId) : null,
    chainRootId: toolChainRootId,
    ...extra,
  };
}

/**
 * Validate, approve, and execute each model-proposed tool call.
 * @param {Record<string, any>} L
 * @param {object[]} clientToolCalls
 * @param {object[]} pendingApplyPatchCalls
 * @param {Record<string, number>|null} [decisionTurnUsage]
 */
export async function dispatchToolCallsViaHost(
  L,
  clientToolCalls,
  pendingApplyPatchCalls,
  decisionTurnUsage = null,
) {
  const {
    env,
    ctx,
    emit,
    request,
    modelKey,
    mode,
    modeConfig,
    userPolicy,
    sessionId,
    tenantId,
    userId,
    workspaceId,
    routingWs,
    mcpCtx,
    authUserParam,
    activeFileEnvelopeParam,
    codemodeRuntimeParam,
    chatAgentRunId,
    abortScope,
    runSpineIds,
    ledgerIdentityFields,
    attributedRoutingArmId,
    effectiveMaxToolCalls,
    runStartedAt,
    maxRunMs,
    totalUsage,
    executedToolNames: executedToolNamesIn,
    turnCount,
    conversationMessages,
    retrieveKnownSymbols,
    userTextForForce,
    canonicalToolChainUserId,
    shouldStopRun,
    exitCancelled,
    synthesizeVisibleLoopHalt,
    appendOpenaiPtcFunctionCallOutput,
    stubMissingToolResults,
    reconcileOpenaiPtcPendingOutputs,
    retireOpenWebSearchTools,
    scheduleLoopUsageTelemetry,
    safeDone,
    routingTaskType,
    chatRouteKey,
    qualityScore,
    imageAskForTurn,
  } = L;

  let {
    activeTools,
    toolCallsUsed,
    chatToolLedger,
    toolChainRootId,
    forceTextOnlyAfterRepeatHalt,
    lastToolArgsFingerprint,
    repeatedSameToolArgsCount,
    lastToolNameOnly,
    repeatedSameToolNameCount,
    consecutiveEmptyHostedShellRecovers,
    openaiPtcActive,
    openaiResponsesAccumulatedInput,
    loopTimedOut,
  } = L;

  let executedToolNames = executedToolNamesIn;

  const patchOut = await dispatchPendingApplyPatchCalls({
    env,
    emit,
    pendingApplyPatchCalls,
    userId,
    tenantId,
    workspaceId,
    routingWs,
    sessionId,
    chatAgentRunId,
    modelKey,
    request,
    mcpCtx,
    turnCount,
    openaiPtcActive,
    openaiResponsesAccumulatedInput,
    toolCallsUsed,
    executedToolNames,
  });

  const toolResults = [...patchOut.toolResults];
  toolCallsUsed = patchOut.toolCallsUsed;
  executedToolNames = patchOut.executedToolNames;
  openaiResponsesAccumulatedInput = patchOut.openaiResponsesAccumulatedInput;

  const decisionShares = await allocateDecisionTurnUsageShares(
    env,
    modelKey,
    decisionTurnUsage,
    Array.isArray(clientToolCalls) ? clientToolCalls.length : 0,
  );
  let decisionShareCursor = 0;
  const takeDecisionShare = () => {
    const share = decisionShares[decisionShareCursor] || {
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
    decisionShareCursor += 1;
    return share;
  };

  let previousToolChainId = null;
  let chatHaltedForApproval = false;

  const loopState = () => ({
    activeTools,
    toolCallsUsed,
    chatToolLedger,
    toolChainRootId,
    forceTextOnlyAfterRepeatHalt,
    lastToolArgsFingerprint,
    repeatedSameToolArgsCount,
    lastToolNameOnly,
    repeatedSameToolNameCount,
    consecutiveEmptyHostedShellRecovers,
    openaiPtcActive,
    openaiResponsesAccumulatedInput,
    loopTimedOut,
    totalUsage,
    executedToolNames,
    modelKey,
    turnCount,
    chatAgentRunId,
  });

  const preflightArgs = (call) => ({
    L,
    call,
    clientToolCalls,
    toolResults,
    chatHaltedForApproval,
    shouldStopRun,
    exitCancelled,
    effectiveMaxToolCalls,
    toolCallsUsed,
    turnCount,
    emit,
    appendOpenaiPtcFunctionCallOutput,
    stubMissingToolResults,
    env,
    ctx,
    tenantId,
    sessionId,
    userId,
    workspaceId,
    mode,
    modeConfig,
    mcpCtx,
    userPolicy,
    attributedRoutingArmId,
    runSpineIds,
    ledgerIdentityFields,
    chatAgentRunId,
    toolChainRootId,
    modelKey,
    activeTools,
    chatToolLedger,
    forceTextOnlyAfterRepeatHalt,
    lastToolArgsFingerprint,
    repeatedSameToolArgsCount,
    lastToolNameOnly,
    repeatedSameToolNameCount,
  });

  const applyPreflightMutations = (preflight) => {
    if (preflight.forceTextOnlyAfterRepeatHalt != null) {
      forceTextOnlyAfterRepeatHalt = preflight.forceTextOnlyAfterRepeatHalt;
    }
    if (preflight.lastToolArgsFingerprint !== undefined) {
      lastToolArgsFingerprint = preflight.lastToolArgsFingerprint;
    }
    if (preflight.repeatedSameToolArgsCount !== undefined) {
      repeatedSameToolArgsCount = preflight.repeatedSameToolArgsCount;
    }
    if (preflight.lastToolNameOnly !== undefined) {
      lastToolNameOnly = preflight.lastToolNameOnly;
    }
    if (preflight.repeatedSameToolNameCount !== undefined) {
      repeatedSameToolNameCount = preflight.repeatedSameToolNameCount;
    }
    if (preflight.chatToolLedger !== undefined) {
      chatToolLedger = preflight.chatToolLedger;
    }
    if (preflight.chatHaltedForApproval != null) {
      chatHaltedForApproval = preflight.chatHaltedForApproval;
    }
  };

  const execArgs = (execCall, validation, used) => ({
    call: execCall,
    validation,
    ctx,
    emit,
    env,
    request,
    mode,
    tenantId,
    userId,
    workspaceId,
    sessionId,
    mcpCtx,
    authUserParam,
    activeFileEnvelopeParam,
    codemodeRuntimeParam,
    chatAgentRunId,
    abortScope,
    runSpineIds,
    turnCount,
    conversationMessages,
    retrieveKnownSymbols,
    userTextForForce,
    imageAskForTurn,
    runStartedAt,
    maxRunMs,
    exitCancelled,
    toolCallsUsed: used,
    executedToolNames,
    activeTools,
  });

  const finalizeArgs = (execCall, validation, execOut, decisionUsageShare = null) => ({
    call: execCall,
    validation,
    toolOutput: execOut.toolOutput,
    execErr: execOut.execErr,
    execResult: execOut.execResult,
    toolRows: execOut.toolRows,
    toolT0: execOut.toolT0,
    toolStartNs: execOut.toolStartNs,
    toolBudgetMs: execOut.toolBudgetMs,
    wrapperChainId: execOut.wrapperChainId ?? null,
    cacheProvenance: execOut.cacheProvenance ?? null,
    toolResults,
    emit,
    env,
    ctx,
    tenantId,
    sessionId,
    userId,
    workspaceId,
    routingWs,
    chatAgentRunId,
    chatToolLedger,
    attributedRoutingArmId,
    runSpineIds,
    ledgerIdentityFields,
    canonicalToolChainUserId,
    previousToolChainId,
    toolChainRootId,
    appendOpenaiPtcFunctionCallOutput,
    retireOpenWebSearchTools,
    runStartedAt,
    maxRunMs,
    loopTimedOut,
    scheduleLoopUsageTelemetry,
    conversationMessages,
    synthesizeVisibleLoopHalt,
    safeDone,
    modelKey,
    mode,
    turnCount,
    toolCallsUsed,
    executedToolNames,
    totalUsage,
    decisionUsageShare,
  });

  const batchFsReads =
    Array.isArray(clientToolCalls) &&
    clientToolCalls.length > 1 &&
    clientToolCalls.every(isParallelizableFsRead);
  const batchProgrammaticCalls =
    Array.isArray(clientToolCalls) &&
    clientToolCalls.length > 1 &&
    clientToolCalls.every(isProgrammaticFunctionCall);

  const batches = batchFsReads || batchProgrammaticCalls
    ? [clientToolCalls]
    : (Array.isArray(clientToolCalls) ? clientToolCalls : []).map((c) => [c]);

  batchLoop: for (const batch of batches) {
    const prepared = [];
    for (const call of batch) {
      const decisionUsageShare = takeDecisionShare();
      const preflight = await runToolHostPreflight({
        ...preflightArgs(call),
        decisionUsageShare,
      });
      applyPreflightMutations(preflight);
      if (preflight.action === 'return') {
        writebackLoopState(L, loopState());
        return { earlyReturn: preflight.earlyReturn };
      }
      if (preflight.action === 'break') break batchLoop;
      if (preflight.action === 'continue') continue;
      prepared.push({
        execCall: preflight.call ?? call,
        validation: preflight.validation,
        decisionUsageShare,
      });
    }
    if (!prepared.length) continue;

    const execOuts = await Promise.all(
      prepared.map((p, i) => executeToolHostCall(execArgs(p.execCall, p.validation, toolCallsUsed + i))),
    );

    if (prepared.length === 1) {
      const execOut = execOuts[0];
      if (execOut.earlyReturn) {
        writebackLoopState(L, loopState());
        return { earlyReturn: execOut.earlyReturn };
      }
      toolCallsUsed = execOut.toolCallsUsed;
      executedToolNames = execOut.executedToolNames;
      activeTools = execOut.activeTools;
    } else {
      for (const execOut of execOuts) {
        if (execOut.earlyReturn) {
          writebackLoopState(L, loopState());
          return { earlyReturn: execOut.earlyReturn };
        }
        const added = execOut.executedToolNames?.[execOut.executedToolNames.length - 1];
        if (added) executedToolNames.push(added);
        if (execOut.activeTools) activeTools = execOut.activeTools;
      }
      toolCallsUsed += execOuts.length;
    }

    for (let i = 0; i < execOuts.length; i++) {
      const execOut = execOuts[i];
      const { execCall, validation, decisionUsageShare } = prepared[i];
      const finalizeOut = await finalizeToolHostCall(
        finalizeArgs(execCall, validation, execOut, decisionUsageShare),
      );
      previousToolChainId = finalizeOut.previousToolChainId;
      toolChainRootId = finalizeOut.toolChainRootId;
      loopTimedOut = finalizeOut.loopTimedOut;
      if (finalizeOut.earlyReturn) {
        writebackLoopState(L, loopState());
        return { earlyReturn: finalizeOut.earlyReturn };
      }
    }
  }

  if (chatHaltedForApproval) {
    stubMissingToolResults(
      clientToolCalls,
      toolResults,
      'halted_for_approval',
      'Awaiting user approval; remaining parallel tool calls were not executed.',
    );
    reconcileOpenaiPtcPendingOutputs('halted_for_approval');
    if (toolResults.length) {
      conversationMessages.push({ role: 'user', content: toolResults });
    }
    safeDone({ halted_for_approval: true, tool_calls_used: toolCallsUsed, turns: turnCount });
    writebackLoopState(L, loopState());
    return {
      earlyReturn: buildEarlyReturn(loopState(), { haltedForApproval: true }),
    };
  }

  stubMissingToolResults(
    clientToolCalls,
    toolResults,
    'missing_tool_result_closed',
    'Closed unpaired tool_use before the next model turn.',
  );
  reconcileOpenaiPtcPendingOutputs('post_tool_batch');
  if (toolResults.length) conversationMessages.push({ role: 'user', content: toolResults });

  if (routingWs && routingTaskType) {
    if (!attributedRoutingArmId()) {
      scheduleRoutingArmBanditUpdate(env, ctx, {
        taskType: routingTaskType,
        routeKey: chatRouteKey,
        mode: mode || 'ask',
        modelKey,
        workspaceId: routingWs,
        success: true,
        lastChainId: previousToolChainId,
      });
    }
    const qs = Number(qualityScore);
    if (Number.isFinite(qs)) {
      scheduleRoutingArmQualityUpdate(env, ctx, {
        taskType: routingTaskType,
        routeKey: chatRouteKey,
        mode: mode || 'ask',
        modelKey,
        workspaceId: routingWs,
        qualityScore: qs,
      });
    }
  }

  writebackLoopState(L, loopState());

  return { ok: true };
}
