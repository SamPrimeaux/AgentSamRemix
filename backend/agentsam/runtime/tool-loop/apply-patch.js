import { executeApplyPatchCalls } from '../../filesystem/apply-patch.js';
import { TOOL_OUTPUT_SSE_MAX } from '../../../../src/core/agent-tool-loader.js';

/**
 * OpenAI apply_patch pending batch handling at start of dispatch.
 * @param {object} ctx
 */
export async function dispatchPendingApplyPatchCalls(ctx) {
  const {
    env,
    emit,
    pendingApplyPatchCalls: pendingIn,
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
    toolCallsUsed: toolCallsUsedIn,
    executedToolNames: executedToolNamesIn,
  } = ctx;

  let pendingApplyPatchCalls = Array.isArray(pendingIn) ? [...pendingIn] : [];
  const toolResults = [];
  let toolCallsUsed = toolCallsUsedIn;
  const executedToolNames = [...executedToolNamesIn];
  let openaiResponsesAccumulatedInputOut = openaiResponsesAccumulatedInput;

  if (pendingApplyPatchCalls.length) {
    const patchRunContext = {
      userId,
      tenantId,
      workspaceId: routingWs || workspaceId,
      sessionId,
      conversationId: sessionId,
      agentRunId: chatAgentRunId,
      modelKey,
      request,
    };
    const writePolicy =
      mcpCtx?.write_policy ||
      mcpCtx?.runtimeProfile?.write_policy ||
      mcpCtx?.sessionWritePolicy ||
      null;
    console.info(
      '[agent] openai_apply_patch_calls',
      JSON.stringify({
        count: pendingApplyPatchCalls.length,
        call_ids: pendingApplyPatchCalls.map((c) => c.call_id).slice(0, 8),
        turn: turnCount,
      }),
    );
    const patchOutputs = await executeApplyPatchCalls(env, pendingApplyPatchCalls, patchRunContext, {
      writePolicy,
    });
    for (const out of patchOutputs) {
      const callId = String(out.call_id || '').trim();
      const status = String(out.status || 'failed') === 'completed' ? 'completed' : 'failed';
      const log = out.output != null ? String(out.output) : status;
      emit('tool_result', {
        tool: 'apply_patch',
        output: log.slice(0, TOOL_OUTPUT_SSE_MAX),
        status,
        call_id: callId,
      });
      if (status === 'failed') {
        emit('error', {
          message: `apply_patch failed: ${log.slice(0, 500)}`,
          code: 'openai_apply_patch_failed',
          call_id: callId,
        });
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: callId,
        content: log,
        apply_patch_call_output: { status, output: log },
        ...(status !== 'completed' ? { is_error: true } : {}),
      });
      if (openaiPtcActive && Array.isArray(openaiResponsesAccumulatedInputOut) && callId) {
        openaiResponsesAccumulatedInputOut = [...openaiResponsesAccumulatedInputOut];
        openaiResponsesAccumulatedInputOut.push({
          type: 'apply_patch_call_output',
          call_id: callId,
          status,
          output: log,
        });
      }
      executedToolNames.push('apply_patch');
    }
    pendingApplyPatchCalls = [];
  }

  return {
    toolResults,
    toolCallsUsed,
    executedToolNames,
    openaiResponsesAccumulatedInput: openaiResponsesAccumulatedInputOut,
    pendingApplyPatchCalls,
  };
}
