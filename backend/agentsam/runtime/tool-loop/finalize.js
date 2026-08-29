import { scheduleRecordMcpToolExecution, recordMcpToolOtlpSpan } from '../../../../src/core/mcp-tool-execution.js';
import { cadToolSseExtrasFromOutput } from './helpers.js';
import { isImageGenerationTool } from '../../tools/image_generation.js';
import { fireForgetAgentToolChainRow } from '../../../telemetry/tool-chain.js';
import { tryBroadcastMonacoPatchFromToolOutput } from '../../../../src/core/collab-broadcast.js';
import {
  appendChatToolSessionLedgerStep,
} from '../../../../src/core/agent-tool-validator.js';
import {
  scheduleAgentsamToolCallLog,
  toolLogFieldsFromValidation,
} from '../../../../src/core/agent-prompt-builder.js';
import { extractToolExecUsage } from '../../../telemetry/tool-exec-telemetry.js';
import { extractToolCacheProvenance } from '../../../../shared/agent-runtime/tool-cache-session.js';
import { TOOL_OUTPUT_SSE_MAX } from '../../../../src/core/agent-tool-loader.js';
import { CODEMODE_TOOL_NAME } from '../../../../src/core/codemode-constants.js';

/**
 * Post-exec SSE, ledger, agentsam_tool_call_log, toolResults push, timeout handling.
 * @param {object} ctx
 */
export async function finalizeToolHostCall(ctx) {
  const {
    call,
    validation,
    toolOutput,
    execErr,
    execResult,
    toolRows,
    toolT0,
    toolStartNs,
    toolBudgetMs,
    toolResults,
    emit,
    env,
    ctx: workerCtx,
    tenantId,
    sessionId,
    userId,
    workspaceId,
    chatAgentRunId,
    chatToolLedger,
    attributedRoutingArmId,
    runSpineIds,
    ledgerIdentityFields,
    canonicalToolChainUserId,
    previousToolChainId: previousToolChainIdIn,
    toolChainRootId: toolChainRootIdIn,
    cacheProvenance: cacheProvenanceIn,
    appendOpenaiPtcFunctionCallOutput,
    retireOpenWebSearchTools,
    runStartedAt,
    maxRunMs,
    loopTimedOut: loopTimedOutIn,
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
    wrapperChainId: wrapperChainIdIn,
  } = ctx;

  let previousToolChainId = previousToolChainIdIn;
  let toolChainRootId = toolChainRootIdIn;
  let loopTimedOut = loopTimedOutIn;
  const cacheProvenance = cacheProvenanceIn ?? null;

  const toolDurMs = Date.now() - toolT0;
  let toolDoneExtra = {};
  if (!execErr && call.name === 'excalidraw_plan_map_create') {
    try {
      const parsed = JSON.parse(String(toolOutput || '{}'));
      if (parsed && parsed.artifact_id && !parsed.error) {
        toolDoneExtra = {
          artifact_type: 'excalidraw',
          artifact_id: String(parsed.artifact_id),
          public_url: parsed.public_url != null ? String(parsed.public_url) : null,
        };
      }
    } catch (_) {
      /* ignore */
    }
  }
  if (!execErr && call.name === 'illustration_create') {
    try {
      const parsed = JSON.parse(String(toolOutput || '{}'));
      if (parsed && !parsed.error && parsed.ok !== false) {
        toolDoneExtra = {
          schema: parsed.schema ?? 'iam.illustration.v1',
          lane: parsed.lane ?? null,
          engine: parsed.engine ?? null,
          surface: parsed.surface ?? null,
          ...(parsed.artifact_id
            ? {
                artifact_type: parsed.artifact_type ?? 'excalidraw',
                artifact_id: String(parsed.artifact_id),
                public_url: parsed.public_url != null ? String(parsed.public_url) : null,
              }
            : {}),
          ...(parsed.job_id || parsed.cad_job_id
            ? { job_id: String(parsed.job_id ?? parsed.cad_job_id) }
            : {}),
        };
      }
    } catch (_) {
      /* ignore */
    }
  }
  if (!execErr) {
    const cadExtras = cadToolSseExtrasFromOutput(call.name, toolOutput);
    if (cadExtras.job_id) {
      toolDoneExtra = { ...toolDoneExtra, ...cadExtras };
    }
  }
  if (call.name === 'search_web') {
    try {
      const parsed = (() => {
        if (execResult && typeof execResult === 'object') return execResult;
        return JSON.parse(String(toolOutput || '{}'));
      })();
      const tel = parsed?.telemetry;
      if (tel && typeof tel === 'object') {
        toolDoneExtra = {
          lane: 'open_web_search',
          backend: tel.backend ?? parsed.provider ?? 'tavily',
          cache_hit: !!parsed.cache_hit,
          search_depth: tel.search_depth ?? 'basic',
          result_count: tel.result_count ?? 0,
          estimated_credits: tel.estimated_credits ?? 1,
        };
        console.log(
          '[agent] execution_lane_selected',
          JSON.stringify({
            lane: 'open_web_search',
            backend: toolDoneExtra.backend,
            reason: parsed.cache_hit ? 'tavily_cache_hit' : 'tavily_search_complete',
            cache_hit: toolDoneExtra.cache_hit,
            max_results: parsed.max_results ?? 5,
            search_depth: toolDoneExtra.search_depth,
            query_hash: tel.query_hash ?? null,
            duration_ms: tel.duration_ms ?? toolDurMs,
          }),
        );
        if (!execErr) {
          emit('execution_lane_selected', {
            lane: 'open_web_search',
            backend: toolDoneExtra.backend,
            reason: parsed.cache_hit ? 'tavily_cache_hit' : 'tavily_search_complete',
            cache_hit: toolDoneExtra.cache_hit,
            max_results: parsed.max_results ?? 5,
            search_depth: toolDoneExtra.search_depth,
          });
        }
      }
      if (!execErr && parsed?.budget_exhausted === true) {
        retireOpenWebSearchTools(parsed.budget_scope || 'budget_exhausted');
      }
    } catch (_) {
      /* ignore */
    }
  }
  emit('tool_output', {
    tool_name: call.name,
    chunk: String(toolOutput || '').slice(0, TOOL_OUTPUT_SSE_MAX),
  });
  emit('tool_done', {
    tool_name: call.name,
    tool_call_id: call.id,
    status: execErr ? 'error' : 'ok',
    duration_ms: toolDurMs,
    rows: toolRows ?? null,
    ...toolDoneExtra,
    ...(execErr
      ? {
          error:
            execErr && typeof execErr === 'object' && 'message' in execErr
              ? String(execErr.message || '').slice(0, 4000)
              : String(execErr || '').slice(0, 4000),
        }
      : {}),
  });
  if (!execErr) {
    try {
      const { emitBrowserLiveSessionSse } = await import('../../../browser/sessions/live-session.js');
      const parsedForBrowser =
        execResult && typeof execResult === 'object'
          ? execResult
          : (() => {
              try {
                return JSON.parse(String(toolOutput || 'null'));
              } catch {
                return null;
              }
            })();
      emitBrowserLiveSessionSse(emit, 'done', call.name, parsedForBrowser);
    } catch {
      /* non-fatal */
    }
    // Universal staging card — present-step SSE (agentsam_stage_file).
    if (String(call.name || '').trim() === 'agentsam_stage_file') {
      try {
        const stageBody =
          execResult && typeof execResult === 'object'
            ? execResult.body && typeof execResult.body === 'object'
              ? execResult.body
              : execResult
            : (() => {
                try {
                  return JSON.parse(String(toolOutput || 'null'));
                } catch {
                  return null;
                }
              })();
        const { fileStagedSsePayload } = await import('../../../../src/core/agentsam-stage-file.js');
        const payload = fileStagedSsePayload(stageBody, {
          conversationId: sessionId,
          agentRunId: chatAgentRunId,
          toolCallId: call.id,
        });
        if (payload) emit('file_staged', payload);
      } catch (e) {
        console.warn('[agent] file_staged_emit', e?.message ?? e);
      }
    }
  }
  if (!execErr) {
    try {
      const parsed = JSON.parse(String(toolOutput || 'null'));
      if (parsed && typeof parsed === 'object') {
        const url =
          typeof parsed.screenshot_url === 'string' && parsed.screenshot_url.trim()
            ? parsed.screenshot_url.trim()
            : typeof parsed.result_url === 'string' && parsed.result_url.trim()
              ? parsed.result_url.trim()
              : typeof parsed.image_url === 'string'
                ? parsed.image_url
                : typeof parsed.public_url === 'string'
                  ? parsed.public_url
                  : typeof parsed.url === 'string' && /^(https?:|data:)/i.test(parsed.url)
                    ? parsed.url
                    : null;
        if (isImageGenerationTool(call.name)) {
          const urls = [];
          if (Array.isArray(parsed.preview_urls)) {
            for (const u of parsed.preview_urls) {
              if (typeof u === 'string' && u.trim() && u.length < 8000) urls.push(u.trim());
            }
          }
          if (Array.isArray(parsed.variations)) {
            for (const v of parsed.variations) {
              if (!v || typeof v !== 'object') continue;
              const vu =
                typeof v.image_url === 'string'
                  ? v.image_url
                  : typeof v.preview_url === 'string'
                    ? v.preview_url
                    : '';
              if (vu.trim() && vu.length < 8000) urls.push(vu.trim());
            }
          }
          if (url && url.length < 8000) urls.push(url);
          const seen = new Set();
          for (const u of urls) {
            if (seen.has(u)) continue;
            seen.add(u);
            emit('preview_artifact', {
              artifact: {
                id: `sse_${call.id || crypto.randomUUID().replace(/-/g, '').slice(0, 12)}_${seen.size}`,
                kind: 'image',
                title: call.name,
                imageUrl: u,
              },
            });
          }
        } else if (url && url.length < 8000) {
          emit('preview_artifact', {
            artifact: {
              id: `sse_${call.id || crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
              kind: 'image',
              title: call.name,
              imageUrl: url,
            },
          });
        }
        if (workspaceId) {
          void tryBroadcastMonacoPatchFromToolOutput(env, workspaceId, toolOutput).catch(() => {});
        }
      }
    } catch (_) {
      /* not JSON — skip preview */
    }
  }
  if (chatToolLedger) {
    try {
      await appendChatToolSessionLedgerStep(env, emit, chatToolLedger, {
        tool_name: call.name,
        ok: !execErr,
        duration_ms: toolDurMs,
        output_preview: String(toolOutput || '').slice(0, 8000),
        error: execErr ? String(execErr.message || execErr).slice(0, 2000) : null,
        input_json:
          call.input && typeof call.input === 'object'
            ? call.input
            : call.input != null
              ? { value: call.input }
              : {},
      });
    } catch (e) {
      console.warn('[agent] chat_tool_session_ledger_step', e?.message ?? e);
    }
  }
  const toolUsageFromExec = extractToolExecUsage(execResult);
  const toolUsageFromOut = extractToolExecUsage(toolOutput);
  const toolUsage = {
    inputTokens: Math.max(toolUsageFromExec.inputTokens, toolUsageFromOut.inputTokens),
    outputTokens: Math.max(toolUsageFromExec.outputTokens, toolUsageFromOut.outputTokens),
    inputCostUsd: Math.max(toolUsageFromExec.inputCostUsd, toolUsageFromOut.inputCostUsd),
    outputCostUsd: Math.max(toolUsageFromExec.outputCostUsd, toolUsageFromOut.outputCostUsd),
    totalCostUsd: Math.max(toolUsageFromExec.totalCostUsd, toolUsageFromOut.totalCostUsd),
    modelUsed: toolUsageFromExec.modelUsed || toolUsageFromOut.modelUsed,
    provider: toolUsageFromExec.provider || toolUsageFromOut.provider,
  };
  const mcpExecId = scheduleRecordMcpToolExecution(env, workerCtx, {
    tenant_id: tenantId,
    workspace_id: workspaceId,
    session_id: sessionId,
    tool_name: call.name,
    tool_id: validation.mcpToolId ?? null,
    input_json: JSON.stringify(call.input || {}),
    output_json: toolOutput.slice(0, 50000),
    success: !execErr,
    error_message: execErr ? String(execErr.message || execErr).slice(0, 4000) : null,
    duration_ms: toolDurMs,
    user_id: userId,
    invoked_by: userId || 'iam_agent',
    status: execErr ? 'error' : 'completed',
    skip_tool_chain_row: true,
    skip_tool_call_log: true,
    ...runSpineIds,
  });
  let nestedOutcomes = null;
  const wrapperChainId =
    wrapperChainIdIn != null && String(wrapperChainIdIn).trim() !== ''
      ? String(wrapperChainIdIn).trim()
      : null;
  if (String(call.name || '') === CODEMODE_TOOL_NAME && env?.DB) {
    try {
      if (wrapperChainId) {
        const nest = await env.DB.prepare(
          `SELECT outcome FROM agentsam_tool_chain
           WHERE parent_chain_id = ?
           ORDER BY started_at DESC
           LIMIT 40`,
        )
          .bind(wrapperChainId)
          .all();
        nestedOutcomes = (nest?.results || [])
          .map((r) => (r?.outcome != null ? String(r.outcome) : null))
          .filter(Boolean);
      } else if (chatAgentRunId) {
        const since = Math.floor(Date.now() / 1000) - 180;
        const nest = await env.DB.prepare(
          `SELECT outcome FROM agentsam_tool_chain
           WHERE agent_run_id = ? AND tool_key != ?
             AND started_at >= ?
           ORDER BY started_at DESC
           LIMIT 40`,
        )
          .bind(String(chatAgentRunId), CODEMODE_TOOL_NAME, since)
          .all();
        nestedOutcomes = (nest?.results || [])
          .map((r) => (r?.outcome != null ? String(r.outcome) : null))
          .filter(Boolean);
      }
    } catch {
      nestedOutcomes = null;
    }
  }

  previousToolChainId = await fireForgetAgentToolChainRow(env, {
    toolName: call.name,
    agentSessionId: sessionId,
    workspaceId,
    userId: canonicalToolChainUserId,
    error: execErr,
    ok: !execErr,
    body: toolOutput,
    nestedOutcomes,
    costUsd: toolUsage.totalCostUsd,
    inputTokens: toolUsage.inputTokens,
    outputTokens: toolUsage.outputTokens,
    mcpToolCallId: mcpExecId,
    durationMs: toolDurMs,
    terminalSessionId: null,
    tenantId,
    chainId: wrapperChainId,
    parentChainId: null,
    toolInputJson: JSON.stringify(call.input || {}),
    workflowRunId: null,
    executionStepId: null,
    modelKey,
    routingArmId: attributedRoutingArmId(),
    ...runSpineIds,
    ctx: workerCtx,
  });
  if (previousToolChainId && !toolChainRootId) toolChainRootId = previousToolChainId;
  // Lean tool_call_log after chain id exists — mode from same run context as agent_run.mode.
  const toolCacheProvenance =
    cacheProvenance != null
      ? extractToolCacheProvenance({ __cacheProvenance: cacheProvenance })
      : extractToolCacheProvenance(execResult);
  scheduleAgentsamToolCallLog(env, workerCtx, {
    tenantId,
    sessionId,
    toolName: call.name,
    status: execErr
      ? execErr &&
        typeof execErr === 'object' &&
        'code' in execErr &&
        /** @type {{ code?: string }} */ (execErr).code === 'tool_timeout'
        ? 'timeout'
        : 'error'
      : 'success',
    durationMs: toolDurMs,
    costUsd: toolUsage.totalCostUsd,
    inputTokens: toolUsage.inputTokens,
    outputTokens: toolUsage.outputTokens,
    userId,
    workspaceId,
    errorMessage: execErr ? String(execErr.message || execErr).slice(0, 4000) : null,
    routingArmId: attributedRoutingArmId(),
    mode,
    modelKey,
    tool_chain_id: previousToolChainId,
    ...toolCacheProvenance,
    ...toolLogFieldsFromValidation(validation),
    ...runSpineIds,
    ...ledgerIdentityFields,
  });
  recordMcpToolOtlpSpan(env, workerCtx, {
    tenant_id: tenantId,
    workspace_id: workspaceId,
    toolName: call.name,
    start_time_unix_nano: toolStartNs,
    end_time_unix_nano: Date.now() * 1_000_000,
    execErr,
  });
  emit('tool_result', { tool: call.name, output: toolOutput.slice(0, TOOL_OUTPUT_SSE_MAX) });
  const tr = { type: 'tool_result', tool_use_id: call.id, content: toolOutput };
  if (call.caller != null) tr.caller = call.caller;
  if (execErr) tr.is_error = true;
  toolResults.push(tr);
  appendOpenaiPtcFunctionCallOutput(call, toolOutput);

  if (Date.now() - runStartedAt > maxRunMs) {
    loopTimedOut = true;
    scheduleLoopUsageTelemetry(false);
    if (toolResults.length) conversationMessages.push({ role: 'user', content: toolResults });
    synthesizeVisibleLoopHalt(
      'agent_run_timeout',
      'I hit the run time limit while tools were still running. Prior tool results are still in the thread.',
    );
    emit('error', {
      message: 'Agent run timed out',
      code: 'agent_run_timeout',
      tool_calls_used: toolCallsUsed,
      turns: turnCount,
      agent_run_id: chatAgentRunId != null ? String(chatAgentRunId) : null,
      model_key: modelKey,
      executed_tools: [...new Set(executedToolNames.map((n) => String(n || '').trim()).filter(Boolean))].slice(
        0,
        24,
      ),
    });
    safeDone({ tool_calls_used: toolCallsUsed, turns: turnCount, code: 'agent_run_timeout' });
    return {
      earlyReturn: {
        totalUsage,
        toolCallsUsed,
        executedToolNames,
        modelKey,
        turnCount,
        timedOut: true,
        workflowRunId: null,
        agentRunId: chatAgentRunId != null ? String(chatAgentRunId) : null,
        chainRootId: toolChainRootId,
      },
      previousToolChainId,
      toolChainRootId,
      loopTimedOut,
    };
  }

  return {
    previousToolChainId,
    toolChainRootId,
    loopTimedOut,
  };
}
