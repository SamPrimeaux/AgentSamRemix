import { evaluateGuardrails } from '../../../../src/core/guardrails.js';
import { scheduleRecordMcpToolExecution } from '../../../../src/core/mcp-tool-execution.js';
import { loadAgentsamToolRow } from '../../../../src/core/agentsam-tools-catalog.js';
import { toolArgumentsParseErrorMessage } from '../../../../src/core/tool-arguments-json.js';
import {
  REPEATED_SAME_TOOL_ARGS_LIMIT,
  CODEBASE_RETRIEVE_TOOL_KEYS,
  toolCallArgsFingerprint,
  toolRepeatIdentity,
  repeatedNameHaltLimit,
  innerToolKeyFromRepeatIdentity,
} from './helpers.js';
import {
  validateToolCall,
  formatToolApprovalPreview,
  chatToolSessionSseBase,
  createChatToolSessionLedger,
} from '../../../../src/core/agent-tool-validator.js';
import {
  auditToolDecision,
} from '../../../../src/core/agent-approval-gate.js';
import {
  permissionBrokerNeedsApproval,
  permissionBrokerRequestApproval,
} from '../../../../src/core/permission-broker.js';
import {
  scheduleAgentsamToolCallLog,
  toolLogFieldsFromValidation,
} from '../../../../src/core/agent-prompt-builder.js';
import { shouldOpenChatToolSessionLedger, TOOL_OUTPUT_SSE_MAX } from '../../../../src/core/agent-tool-loader.js';
import { notifyUser } from '../../../identity/notify-user.js';
import { assertToolAllowedByMode } from './ceiling.js';
import { scheduleHostToolBlockedLog } from './block-log.js';

/**
 * Per-call gates before exec: budget, repeat halt, parse error, args repair,
 * mode ceiling, github fs deny, validateToolCall block, guardrails, approval halt.
 * @param {object} ctx
 * @returns {Promise<{ action: 'continue'|'break'|'return'|'proceed', earlyReturn?: object, validation?: object, call?: object, chatHaltedForApproval?: boolean, chatToolLedger?: object, forceTextOnlyAfterRepeatHalt?: boolean, lastToolArgsFingerprint?: string|null, repeatedSameToolArgsCount?: number, lastToolNameOnly?: string|null, repeatedSameToolNameCount?: number }>}
 */
export async function runToolHostPreflight(ctx) {
  const {
    L,
    call: callIn,
    clientToolCalls,
    toolResults,
    chatHaltedForApproval: chatHaltedForApprovalIn,
    shouldStopRun,
    exitCancelled,
    effectiveMaxToolCalls,
    toolCallsUsed,
    turnCount,
    emit,
    appendOpenaiPtcFunctionCallOutput,
    stubMissingToolResults,
    env,
    ctx: workerCtx,
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
    chatToolLedger: chatToolLedgerIn,
    forceTextOnlyAfterRepeatHalt: forceTextOnlyAfterRepeatHaltIn,
    lastToolArgsFingerprint: lastToolArgsFingerprintIn,
    repeatedSameToolArgsCount: repeatedSameToolArgsCountIn,
    lastToolNameOnly: lastToolNameOnlyIn,
    repeatedSameToolNameCount: repeatedSameToolNameCountIn,
    decisionUsageShare,
  } = ctx;

  const decisionTok = {
    costUsd: Number(decisionUsageShare?.costUsd) || 0,
    inputTokens: Math.max(0, Math.floor(Number(decisionUsageShare?.inputTokens) || 0)),
    outputTokens: Math.max(0, Math.floor(Number(decisionUsageShare?.outputTokens) || 0)),
  };

  let call = callIn;
  let chatHaltedForApproval = chatHaltedForApprovalIn;
  let forceTextOnlyAfterRepeatHalt = forceTextOnlyAfterRepeatHaltIn;
  let lastToolArgsFingerprint = lastToolArgsFingerprintIn;
  let repeatedSameToolArgsCount = repeatedSameToolArgsCountIn;
  let lastToolNameOnly = lastToolNameOnlyIn;
  let repeatedSameToolNameCount = repeatedSameToolNameCountIn;
  let chatToolLedger = chatToolLedgerIn;

  if (chatHaltedForApproval) {
    return { action: 'break' };
  }
  if (await shouldStopRun()) {
    return { action: 'return', earlyReturn: exitCancelled() };
  }
  if (toolCallsUsed >= effectiveMaxToolCalls) {
    emit('tool_blocked', { tool: call.name, reason: 'max_tool_calls_reached' });
    const blockedOut = JSON.stringify({
      ok: false,
      error: 'max_tool_calls_reached',
      tool: call.name,
      tool_calls_used: toolCallsUsed,
      max_tool_calls: effectiveMaxToolCalls,
      message:
        'Tool call budget reached. Stop calling tools and write the best answer from evidence already collected (call-graph hops, file reads). Do not fall back to fs_search_files for hops already retrieved.',
    });
    scheduleHostToolBlockedLog(env, workerCtx, {
      tenantId,
      workspaceId,
      sessionId,
      userId,
      mode,
      modelKey,
      toolName: call.name,
      reason: 'max_tool_calls_reached',
      call,
      outputJson: {
        blocked: true,
        reason: 'max_tool_calls_reached',
        tool_calls_used: toolCallsUsed,
        max_tool_calls: effectiveMaxToolCalls,
        source: 'tool_host_preflight',
      },
      attributedRoutingArmId,
      runSpineIds,
      ledgerIdentityFields,
      decisionUsageShare,
    });
    toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: blockedOut });
    appendOpenaiPtcFunctionCallOutput(call, blockedOut);
    forceTextOnlyAfterRepeatHalt = true;
    return {
      action: 'continue',
      forceTextOnlyAfterRepeatHalt,
      lastToolArgsFingerprint,
      repeatedSameToolArgsCount,
      lastToolNameOnly,
      repeatedSameToolNameCount,
    };
  }
  const callFp = toolCallArgsFingerprint(call.name, call.input);
  if (callFp === lastToolArgsFingerprint) {
    repeatedSameToolArgsCount += 1;
  } else {
    lastToolArgsFingerprint = callFp;
    repeatedSameToolArgsCount = 1;
  }
  const nameOnly = toolRepeatIdentity(call.name, call.input);
  if (nameOnly && nameOnly === lastToolNameOnly) {
    repeatedSameToolNameCount += 1;
  } else {
    lastToolNameOnly = nameOnly || null;
    repeatedSameToolNameCount = nameOnly ? 1 : 0;
  }
  const nameHaltLimit = repeatedNameHaltLimit(nameOnly);
  const haltSameArgs = repeatedSameToolArgsCount >= REPEATED_SAME_TOOL_ARGS_LIMIT;
  const haltSameName =
    repeatedSameToolNameCount >= nameHaltLimit &&
    !CODEBASE_RETRIEVE_TOOL_KEYS.has(nameOnly);
  if (haltSameArgs || haltSameName) {
    const errorCode = haltSameArgs ? 'repeated_tool_call_same_args' : 'repeated_tool_call_same_name';
    const innerToolKey = innerToolKeyFromRepeatIdentity(nameOnly);
    console.warn(
      `[agent] ${errorCode}`,
      JSON.stringify({
        tool_name: call.name,
        inner_tool_key: innerToolKey,
        repeat_identity: nameOnly,
        args_streak: repeatedSameToolArgsCount,
        name_streak: repeatedSameToolNameCount,
        name_halt_limit: nameHaltLimit,
        turn: turnCount,
      }),
    );
    const haltBody = JSON.stringify({
      ok: false,
      error: errorCode,
      tool: call.name,
      inner_tool_key: innerToolKey,
      args_streak: repeatedSameToolArgsCount,
      name_streak: repeatedSameToolNameCount,
      message: haltSameArgs
        ? 'Same tool called repeatedly with identical arguments. Stop calling tools and answer using evidence already collected.'
        : innerToolKey
          ? `Codemode called ${innerToolKey} repeatedly with no progress. Stop wrapping the same catalog tool and answer using evidence already collected.`
          : 'Same tool called too many times with varying arguments and no progress. Stop calling tools and answer using evidence already collected. If you were mid call-graph trace, summarize hops already collected or continue with a different tool.',
    });
    emit('tool_start', {
      tool_name: call.name,
      tool_call_id: call.id,
      input_preview: JSON.stringify(call.input || {}).slice(0, 200),
    });
    emit('tool_result', { tool: call.name, output: haltBody.slice(0, TOOL_OUTPUT_SSE_MAX) });
    toolResults.push({
      type: 'tool_result',
      tool_use_id: call.id,
      content: haltBody,
      is_error: true,
    });
    appendOpenaiPtcFunctionCallOutput(call, haltBody);
    scheduleHostToolBlockedLog(env, workerCtx, {
      tenantId,
      workspaceId,
      sessionId,
      userId,
      mode,
      modelKey,
      toolName: call.name,
      reason: errorCode,
      call,
      outputJson: {
        blocked: true,
        reason: errorCode,
        args_streak: repeatedSameToolArgsCount,
        name_streak: repeatedSameToolNameCount,
        source: 'tool_host_preflight',
      },
      attributedRoutingArmId,
      runSpineIds,
      ledgerIdentityFields,
      decisionUsageShare,
    });
    forceTextOnlyAfterRepeatHalt = true;
    stubMissingToolResults(
      clientToolCalls,
      toolResults,
      'skipped_due_to_repeat_halt',
      'Skipped because a repeated-tool halt stopped the batch.',
    );
    // Ledger siblings closed by stub — otherwise only SSE shows them.
    const primaryId = String(call.id || '').trim();
    for (const sibling of clientToolCalls || []) {
      const sid = String(sibling?.id || '').trim();
      if (!sid || sid === primaryId) continue;
      const stubRow = toolResults.find((r) => String(r?.tool_use_id || '') === sid);
      if (!stubRow || !/skipped_due_to_repeat_halt/.test(String(stubRow.content || ''))) continue;
      scheduleHostToolBlockedLog(env, workerCtx, {
        tenantId,
        workspaceId,
        sessionId,
        userId,
      mode,
      modelKey,
        toolName: sibling.name,
        reason: 'skipped_due_to_repeat_halt',
        call: sibling,
        outputJson: {
          blocked: true,
          reason: 'skipped_due_to_repeat_halt',
          halted_by: call.name,
          source: 'tool_host_preflight',
        },
        attributedRoutingArmId,
        runSpineIds,
        ledgerIdentityFields,
        decisionUsageShare,
      });
    }
    return {
      action: 'break',
      forceTextOnlyAfterRepeatHalt,
      lastToolArgsFingerprint,
      repeatedSameToolArgsCount,
      lastToolNameOnly,
      repeatedSameToolNameCount,
    };
  }
  if (call.input && typeof call.input === 'object' && call.input.__parse_error === true) {
    const rawFull = String(call.raw_input != null ? call.raw_input : call.input.__raw || '');
    const raw = rawFull.slice(0, 50_000);
    const userMsg = toolArgumentsParseErrorMessage(call.name, rawFull.slice(0, 160));
    scheduleAgentsamToolCallLog(env, workerCtx, {
      tenantId,
      sessionId,
      toolName: call.name,
      status: 'error',
      durationMs: 0,
      costUsd: decisionTok.costUsd,
      inputTokens: decisionTok.inputTokens,
      outputTokens: decisionTok.outputTokens,
      userId,
      mode,
      modelKey,
      workspaceId,
      errorMessage: 'tool_arguments_json_parse_error',
      inputSummary: JSON.stringify({ __parse_error: true, raw_len: rawFull.length }).slice(0, 200),
      inputJson: { __parse_error: true, __raw: raw, raw_len: rawFull.length },
      outputJson: { error: 'tool_arguments_json_parse_error', user_message: userMsg },
      routingArmId: attributedRoutingArmId(),
      ...runSpineIds,
      ...ledgerIdentityFields,
    });
    scheduleRecordMcpToolExecution(env, workerCtx, {
      tenant_id: tenantId,
      workspace_id: workspaceId,
      user_id: userId,
      session_id: sessionId,
      tool_name: call.name,
      tool_id: null,
      input_json: JSON.stringify({ __parse_error: true, __raw: raw.slice(0, 8000), raw_len: rawFull.length }),
      success: false,
      error_message: 'tool_arguments_json_parse_error',
      duration_ms: 0,
      status: 'error',
      skip_tool_call_log: true,
      ...runSpineIds,
    });
    emit('tool_error', {
      tool: call.name,
      tool_name: call.name,
      tool_call_id: call.id,
      error: userMsg,
      code: 'tool_arguments_json_parse_error',
    });
    emit('text', { text: userMsg });
    toolResults.push({
      type: 'tool_result',
      tool_use_id: call.id,
      content: userMsg,
      is_error: true,
    });
    appendOpenaiPtcFunctionCallOutput(call, userMsg);
    return {
      action: 'continue',
      lastToolArgsFingerprint,
      repeatedSameToolArgsCount,
      lastToolNameOnly,
      repeatedSameToolNameCount,
    };
  }
  if (call.input && typeof call.input === 'object' && call.input.__tool_args_repaired) {
    console.warn(
      '[agent] tool_args_repaired',
      JSON.stringify({
        tool: call.name,
        truncated: !!call.input.__tool_args_truncated,
        keys: Object.keys(call.input).filter((k) => !k.startsWith('__')),
      }),
    );
    emit('status', {
      phase: 'tool_args_repaired',
      tool: call.name,
      message:
        'Tool arguments were truncated mid-stream and repaired — content may be incomplete; continue with another write/edit if needed.',
    });
    const cleaned = { ...call.input };
    delete cleaned.__tool_args_repaired;
    delete cleaned.__tool_args_truncated;
    delete cleaned.__parse_error;
    delete cleaned.__raw;
    call = { ...call, input: cleaned };
  }
  const ceiling = await assertToolAllowedByMode(env, mode, call.name);
  if (!ceiling.ok) {
    const blockedOut = JSON.stringify({
      ok: false,
      error: 'mode_ceiling',
      tool: call.name,
      mode,
      reason: ceiling.reason,
      message: `Tool "${call.name}" is not allowed in ${mode} mode.`,
    });
    emit('tool_blocked', { tool: call.name, reason: 'mode_ceiling', mode });
    scheduleHostToolBlockedLog(env, workerCtx, {
      tenantId,
      workspaceId,
      sessionId,
      userId,
      toolName: call.name,
      reason: 'mode_ceiling',
      call,
      outputJson: {
        blocked: true,
        reason: 'mode_ceiling',
        mode,
        ceiling_reason: ceiling.reason,
        source: 'tool_host_preflight',
      },
      attributedRoutingArmId,
      runSpineIds,
      ledgerIdentityFields,
      decisionUsageShare,
    });
    toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: blockedOut });
    appendOpenaiPtcFunctionCallOutput(call, blockedOut);
    return {
      action: 'continue',
      call,
      lastToolArgsFingerprint,
      repeatedSameToolArgsCount,
      lastToolNameOnly,
      repeatedSameToolNameCount,
    };
  }
  {
    const { denyFsToolOnGithubFilesSource } = await import('../../filesystem/transport.js');
    const githubFsDeny = denyFsToolOnGithubFilesSource(call.name, mcpCtx);
    if (githubFsDeny) {
      const blockedOut = JSON.stringify({ ok: false, ...githubFsDeny });
      emit('tool_blocked', {
        tool: call.name,
        reason: 'wrong_tool_for_github_files_source',
        hint: githubFsDeny.hint,
      });
      scheduleHostToolBlockedLog(env, workerCtx, {
        tenantId,
        workspaceId,
        sessionId,
        userId,
        toolName: call.name,
        reason: 'wrong_tool_for_github_files_source',
        call,
        outputJson: {
          blocked: true,
          reason: 'wrong_tool_for_github_files_source',
          hint: githubFsDeny.hint ?? null,
          source: 'tool_host_preflight',
        },
        attributedRoutingArmId,
        runSpineIds,
        ledgerIdentityFields,
        decisionUsageShare,
      });
      toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: blockedOut });
      appendOpenaiPtcFunctionCallOutput(call, blockedOut);
      return {
        action: 'continue',
        call,
        lastToolArgsFingerprint,
        repeatedSameToolArgsCount,
        lastToolNameOnly,
        repeatedSameToolNameCount,
      };
    }
  }
  const validation = await validateToolCall(
    env,
    mcpCtx?.runtimeProfile || mode,
    call,
    {
      ...mcpCtx,
      _activeToolNames: (activeTools || [])
        .map((t) => t.name || t.tool_key || t.tool_name)
        .filter(Boolean),
    },
    userPolicy,
  );
  if (!validation.allowed) {
    scheduleRecordMcpToolExecution(env, workerCtx, {
      tenant_id: tenantId,
      workspace_id: workspaceId,
      user_id: userId,
      session_id: sessionId,
      tool_name: call.name,
      tool_id: validation.mcpToolId ?? null,
      input_json: JSON.stringify(call.input || {}),
      success: false,
      error_message: validation.reason,
      duration_ms: 0,
      status: 'error',
      skip_tool_call_log: true,
      ...runSpineIds,
    });
    scheduleAgentsamToolCallLog(env, workerCtx, {
      tenantId,
      sessionId,
      toolName: call.name,
      status: 'blocked',
      durationMs: 0,
      costUsd: decisionTok.costUsd,
      inputTokens: decisionTok.inputTokens,
      outputTokens: decisionTok.outputTokens,
      userId,
      mode,
      modelKey,
      workspaceId,
      errorMessage: validation.reason,
      inputSummary: JSON.stringify(call.input || {}).slice(0, 200),
      inputJson: call.input && typeof call.input === 'object' ? call.input : {},
      outputJson: { blocked: true, reason: validation.reason },
      routingArmId: attributedRoutingArmId(),
      ...toolLogFieldsFromValidation(validation),
      ...runSpineIds,
      ...ledgerIdentityFields,
    });
    await auditToolDecision(env, {
      tenantId,
      workspaceId,
      userId,
      toolName: call.name,
      eventType: 'tool_blocked',
      message: `Blocked: ${call.name} — ${validation.reason}`,
      riskLevel: 'blocked',
      reason: validation.reason,
    });
    emit('tool_blocked', { tool: call.name, reason: validation.reason });
    const blockedOut = `Tool not available in ${mode} mode: ${validation.reason}`;
    toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: blockedOut });
    appendOpenaiPtcFunctionCallOutput(call, blockedOut);
    return {
      action: 'continue',
      call,
      lastToolArgsFingerprint,
      repeatedSameToolArgsCount,
      lastToolNameOnly,
      repeatedSameToolNameCount,
    };
  }
  const grTool = await evaluateGuardrails(env, workerCtx, {
    applies_to: 'mcp_tool',
    tenant_id: tenantId,
    workspace_id: workspaceId,
    user_id: userId,
    session_id: sessionId,
    conversation_id: sessionId,
    request_id:
      chatAgentRunId != null
        ? String(chatAgentRunId)
        : toolChainRootId != null
          ? String(toolChainRootId)
          : sessionId,
    run_group_id: chatAgentRunId != null ? String(chatAgentRunId) : null,
    route_path: '/api/agent/chat',
    tool_name: call.name,
    tool_input: call.input,
    model_key: modelKey,
  });
  if (grTool.blocked) {
    scheduleRecordMcpToolExecution(env, workerCtx, {
      tenant_id: tenantId,
      workspace_id: workspaceId,
      user_id: userId,
      session_id: sessionId,
      tool_name: call.name,
      tool_id: validation.mcpToolId ?? null,
      input_json: JSON.stringify(call.input || {}),
      success: false,
      error_message: grTool.decision?.reason || 'guardrail_blocked',
      duration_ms: 0,
      status: 'blocked',
      skip_tool_call_log: true,
      ...runSpineIds,
    });
    scheduleAgentsamToolCallLog(env, workerCtx, {
      tenantId,
      sessionId,
      toolName: call.name,
      status: 'blocked',
      durationMs: 0,
      costUsd: decisionTok.costUsd,
      inputTokens: decisionTok.inputTokens,
      outputTokens: decisionTok.outputTokens,
      userId,
      mode,
      modelKey,
      workspaceId,
      errorMessage: grTool.decision?.reason || 'guardrail_blocked',
      inputSummary: JSON.stringify(call.input || {}).slice(0, 200),
      inputJson: call.input && typeof call.input === 'object' ? call.input : {},
      outputJson: {
        blocked: true,
        reason: grTool.decision?.reason || 'guardrail_blocked',
      },
      routingArmId: attributedRoutingArmId(),
      ...toolLogFieldsFromValidation(validation),
      ...runSpineIds,
      ...ledgerIdentityFields,
    });
    await auditToolDecision(env, {
      tenantId,
      workspaceId,
      userId,
      toolName: call.name,
      eventType: 'tool_blocked',
      message: `Guardrail blocked: ${call.name}`,
      riskLevel: 'blocked',
      reason: grTool.decision?.reason || 'guardrail',
    });
    emit('tool_blocked', { tool: call.name, reason: grTool.decision?.reason || 'guardrail' });
    const blockedOut = grTool.decision?.reason || 'Blocked by guardrail.';
    toolResults.push({
      type: 'tool_result',
      tool_use_id: call.id,
      content: blockedOut,
      is_error: true,
    });
    appendOpenaiPtcFunctionCallOutput(call, blockedOut);
    return {
      action: 'continue',
      call,
      lastToolArgsFingerprint,
      repeatedSameToolArgsCount,
      lastToolNameOnly,
      repeatedSameToolNameCount,
    };
  }
  if (permissionBrokerNeedsApproval(validation, { ...modeConfig, mode }, userPolicy)) {
    const preview = formatToolApprovalPreview(call.name, call.input);
    const { isCommandPreviewAllowlisted } = await import('../../../../src/core/agent-approval-policy.js');
    const allowlisted = await isCommandPreviewAllowlisted(env, {
      userId,
      workspaceId,
      command: preview,
    });
    if (allowlisted) {
      // Always Run / allowlist hit — skip halt; fall through to tool execution.
    } else {
      const { resolveWorkerProjectId } = await import('../../../../src/core/worker-identity.js');
      const githubRepo = String(
        call.input?.repo || call.input?.repository || call.input?.repository_full_name || '',
      ).trim();
      const githubBranch = String(call.input?.branch || call.input?.ref || '').trim();
      const githubPath = String(call.input?.path || call.input?.github_path || '').trim();
      const githubTargetLabel =
        githubRepo.includes('/')
          ? githubBranch
            ? `${githubRepo}@${githubBranch}`
            : githubRepo
          : '';
      const serverLabel =
        githubTargetLabel ||
        (validation.serverKey != null && String(validation.serverKey).trim() !== ''
          ? String(validation.serverKey).trim()
          : resolveWorkerProjectId(env));
      let toolDescription = `Agent requested ${call.name} (${validation.riskLevel} risk)`;
      if (githubTargetLabel) {
        const pathBit = githubPath ? ` · ${githubPath}` : '';
        toolDescription = `${call.name} → ${githubTargetLabel}${pathBit}`.slice(0, 120);
      } else {
        try {
          const catalogRow = await loadAgentsamToolRow(env, call.name);
          if (catalogRow?.description && String(catalogRow.description).trim()) {
            const d = String(catalogRow.description).trim();
            if (d.length <= 120) toolDescription = d;
          }
        } catch {
          /* non-fatal */
        }
      }
      const brokerResult = await permissionBrokerRequestApproval(env, workerCtx, {
        adapter: ctx.permissionAdapter || null,
        tenantId,
        sessionId,
        userId,
        workspaceId,
        personUuid: mcpCtx.personUuid,
        toolName: call.name,
        toolArgs: call.input,
        toolCallId: call.id,
        riskLevel: validation.riskLevel,
        rationale: toolDescription,
        ledgerExtras: toolLogFieldsFromValidation(validation),
        grantOnApproval: validation.grantOnApproval === true,
        agentRunId: runSpineIds?.agent_run_id ?? chatAgentRunId ?? null,
        conversationId: runSpineIds?.conversation_id ?? sessionId,
        mcpCtx,
        emit,
        validation,
      });
      if (brokerResult.sameTurnContinue) {
        // ACP (or future) adapter approved in-band — continue same turn.
      } else {
        notifyUser(env, {
          userId,
          tenantId,
          subject: `Approval required: ${call.name}`,
          body: `Tool: ${call.name}\nRisk: ${validation.riskLevel}\nArgs: ${JSON.stringify(call.input || {}).slice(0, 500)}\n\nApprove: ${(env.IAM_ORIGIN || '').replace(/\/$/, '')}/dashboard/overview?proposal=${brokerResult.proposalId}`,
          category: 'approval',
        }, workerCtx).catch(() => {});
        // Dashboard adapter already emitted via broker; ensure server label on tool_approval if needed.
        if (brokerResult.adapter === 'dashboard') {
          /* events emitted inside permissionBrokerRequestApproval */
        }
        void serverLabel;
        chatHaltedForApproval = true;
        return {
          action: 'break',
          call,
          chatHaltedForApproval,
          lastToolArgsFingerprint,
          repeatedSameToolArgsCount,
          lastToolNameOnly,
          repeatedSameToolNameCount,
        };
      }
    }
  }
  if (
    shouldOpenChatToolSessionLedger({
      chatAgentRunId,
      mode,
      tools: activeTools,
      chatToolLedger,
    })
  ) {
    try {
      chatToolLedger = createChatToolSessionLedger({
        tenantId,
        workspaceId,
        userId,
        sessionId,
        modelKey,
        stepsTotal: 0,
        chatAgentRunId,
        routingArmId: attributedRoutingArmId(),
        requestedMode: mode,
      });
      if (chatToolLedger) {
        emit('workflow_start', {
          ...chatToolSessionSseBase(chatToolLedger),
          steps_total: null,
        });
      }
    } catch (e) {
      console.warn('[agent] chat_tool_session_ledger_create', e?.message ?? e);
    }
  }
  return {
    action: 'proceed',
    call,
    validation,
    chatToolLedger,
    chatHaltedForApproval,
    lastToolArgsFingerprint,
    repeatedSameToolArgsCount,
    lastToolNameOnly,
    repeatedSameToolNameCount,
  };
}
