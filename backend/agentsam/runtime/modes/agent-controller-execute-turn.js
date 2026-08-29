/**
 * Agent turn execute: vision fail-fast → quickstart → tool loop → accounting.
 */

import { startAgentRun } from '../../../telemetry/agent-run.js';
import { runThreadActionOnDemand } from '../../sessions/thread-on-demand.js';
import { reportAgentControllerWarning } from './agent-controller-report.js';
import { buildMcpRuntimeContext } from './agent-controller-mcp-context.js';
import { tryQuickstartIntake } from './agent-controller-quickstart.js';
import { finalizeAgentControllerAccounting } from './agent-controller-accounting.js';

/**
 * @param {any} env
 * @param {any} ctx
 * @param {(type: string, payload: object) => Promise<any>} emit
 * @param {() => Promise<void>} closeStream
 * @param {Awaited<ReturnType<typeof import('./agent-controller-prepare.js').prepareAgentControllerTurn>>} prepared
 */
export async function executeAgentControllerTurn(env, ctx, emit, closeStream, prepared) {
  const services = prepared.input?.services || {};
  const {
    bound,
    input,
    visionUploadError,
    visionUploadFiles,
    visionErrorUserMessage,
    VISION_ERROR_CODES,
    chatMessagesHaveVisionUpload,
    createSubagentFlow,
    codemodeRuntime,
    execLane,
    toolKeys,
    slashSkill,
    terminalLaneStatus,
    requireTools,
    runAgentToolLoop,
    promptManifest,
    databaseSurfaceRaw,
    systemPrompt,
    chatAgentRunId,
    agentRunStartPromise: preparedAgentRunStartPromise,
    maxRunMs,
    threadSlashAction,
    scopedProjectRef,
    projectBindings,
  } = prepared;
  let tools = Array.isArray(prepared.tools) ? prepared.tools : [];
  let { chatMessages } = prepared;

  const {
    profile,
    body,
    message,
    filesSource,
    fsaRootActive,
    activeRepo,
    userId,
    tenantId,
    workspaceId,
    sessionId,
    sessionAuthUser,
    quickstartBatch,
    activeFileEnvelope,
    subagentProfileRow,
    handoffResume,
    browserContextPayload,
    chatTurnMeta,
    userPolicy,
  } = bound;

  const chatT0 = Date.now();
  // Prefer the row scheduled in prepare (before quickstart / long prep).
  let agentRunStartPromise = preparedAgentRunStartPromise || null;
  let loopStats = null;
  let clientAborted = false;
  const reqSignal = input.request?.signal ?? null;
  let onRequestAbort = null;
  try {
    if (visionUploadError) {
      const failText = visionErrorUserMessage(visionUploadError.code, visionUploadError.message);
      emit('text', { text: failText });
      emit('error', {
        message: failText,
        code: visionUploadError.code || VISION_ERROR_CODES.VISION_ADAPTER_FAILED,
        detail: visionUploadError.detail ?? {},
      });
      emit('done', {});
      return;
    }
    if (visionUploadFiles.length && !chatMessagesHaveVisionUpload(chatMessages)) {
      const failText = visionErrorUserMessage(VISION_ERROR_CODES.NO_IMAGE_FILE_IN_REQUEST);
      emit('text', { text: failText });
      emit('error', { message: failText, code: VISION_ERROR_CODES.NO_IMAGE_FILE_IN_REQUEST });
      emit('done', {});
      return;
    }

    const qs = await tryQuickstartIntake(env, emit, {
      quickstartBatch,
      chatMessages,
      threadSlashAction,
      createSubagentFlow,
      message,
      userId,
      workspaceId,
      sessionId,
      tenantId,
      body,
      profile,
      subagentProfileRow,
      chatMessagesHaveVisionUpload,
      planIntake: services.planIntake,
    });
    chatMessages = qs.chatMessages;
    if (qs.handled) return;

    if (threadSlashAction && userId && workspaceId && sessionId) {
      const runThread = typeof services.runThreadActionOnDemand === 'function'
        ? services.runThreadActionOnDemand
        : runThreadActionOnDemand;
      const threadOut = await runThread(env, ctx, {
        action: threadSlashAction,
        userId,
        workspaceId,
        tenantId,
        conversationId: sessionId,
        agentRunId: chatAgentRunId,
        messages: chatMessages,
      });
      emit('thread_action', { type: 'thread_action', ...threadOut });
      if (threadOut.user_message) {
        emit('text', { text: threadOut.user_message });
      }
      emit('done', {});
      return;
    }

    const dispatchSpine = chatAgentRunId
      ? { agent_run_id: chatAgentRunId, routing_arm_id: profile.routing_arm_id, mode: profile.mode }
      : null;

    const githubRepoCtx = String(
      activeRepo ||
        body.active_repo ||
        body.activeRepo ||
        body.selectedGithubRepoContext ||
        body.github_repo_context ||
        body.githubRepoContext ||
        '',
    ).trim();
    const projectExecBindings =
      input.projectExecutionBindings && typeof input.projectExecutionBindings === 'object'
        ? input.projectExecutionBindings
        : projectBindings;
    const wsCtx =
      browserContextPayload &&
      typeof browserContextPayload === 'object' &&
      browserContextPayload.workspaceContext &&
      typeof browserContextPayload.workspaceContext === 'object'
        ? browserContextPayload.workspaceContext
        : null;
    let clientSurface = null;
    if (wsCtx && typeof wsCtx === 'object') {
      const rawSurface = String(wsCtx.client_surface || '').trim();
      clientSurface = rawSurface || null;
    }
    // Tool menu + terminal lane finalized in prepare — immutable here.
    // Do not re-filter tools or mutate profile.tool_allowlist; Codemode already
    // wrapped the post-lane menu.
    if (terminalLaneStatus) {
      emit('status', terminalLaneStatus);
    } else if (!execLane) {
      emit('status', {
        phase: 'no_terminal_lane',
        detail:
          'No terminal dock connected (Local / VM / Sandbox) — shell commands unavailable this turn.',
        code: 'exec_lane_required',
      });
    }

    if (!agentRunStartPromise && chatAgentRunId && userId && workspaceId) {
      agentRunStartPromise = startAgentRun(env, {
        runId: chatAgentRunId,
        userId,
        tenantId,
        workspaceId,
        conversationId: sessionId,
        routingArmId: profile.routing_arm_id,
        agentSlug: subagentProfileRow?.id ?? null,
        subagentProfileId: subagentProfileRow?.id ?? null,
        modelKey: profile.model_key,
        selectedModel: profile.model_key,
        taskType: profile.routing_task_type,
        mode: profile.mode,
        routingStrategy:
          profile.routing_selected_by || (input.modelOverride ? 'requested' : 'thompson'),
        selectedBy:
          profile.routing_selected_by || (input.modelOverride ? 'requested' : 'thompson'),
      });
    }

    const { readSessionGrantsPin, coerceAllowlistKeySet, userMayUsePrivilegedTerminal } = services;
    if (typeof readSessionGrantsPin !== 'function' || typeof coerceAllowlistKeySet !== 'function') {
      throw new Error('session_envelope_services_required');
    }
    const sessionRoots =
      profile._session_roots && typeof profile._session_roots === 'object'
        ? profile._session_roots
        : null;
    const policyHash =
      sessionRoots?.session_grants_policy_hash != null
        ? String(sessionRoots.session_grants_policy_hash).trim()
        : sessionRoots?.actor_policy_hash != null
          ? String(sessionRoots.actor_policy_hash).trim()
          : '';
    const pinnedGrants = readSessionGrantsPin(sessionRoots, policyHash);
    const mayUsePrivilegedTerminal =
      pinnedGrants?.mayUsePrivilegedTerminal === true
        ? true
        : userId
          ? typeof userMayUsePrivilegedTerminal === 'function'
            ? await userMayUsePrivilegedTerminal(env, sessionAuthUser || { id: userId }, workspaceId)
            : false
          : false;
    const allowlistKeySet =
      coerceAllowlistKeySet(sessionRoots?.allowlist_key_set) ||
      (sessionRoots?.allowlist_key_set instanceof Set ? sessionRoots.allowlist_key_set : null);
    const turnDecision =
      input.turnDecision && typeof input.turnDecision === 'object' ? input.turnDecision : null;
    const mcpRuntimeContext = buildMcpRuntimeContext({
      userId,
      tenantId,
      workspaceId,
      sessionId,
      sessionAuthUser,
      profile,
      message,
      turnDecision,
      turnDecisionId: input.turnDecisionId ?? null,
      fsaRootActive,
      filesSource,
      body,
      databaseSurfaceRaw,
      browserContextPayload,
      githubRepoCtx,
      scopedProjectRef,
      projectExecBindings,
      clientSurface,
      execLane,
      mayUsePrivilegedTerminal,
      allowlistKeySet,
    });

    if (reqSignal) {
      if (reqSignal.aborted) clientAborted = true;
      else {
        onRequestAbort = () => {
          clientAborted = true;
        };
        reqSignal.addEventListener('abort', onRequestAbort, { once: true });
      }
    }
    if (agentRunStartPromise) {
      await agentRunStartPromise.catch((e) =>
        reportAgentControllerWarning(env, 'agent_run_start', e, {
          workspaceId,
          tenantId,
          sessionId,
          sourceId: chatAgentRunId,
        }),
      );
    }

    {
      const { isAntigravityModelKey, streamAntigravitySandboxInteraction } = services;
      if (typeof isAntigravityModelKey !== 'function') {
        throw new Error('antigravity_policy_service_required');
      }
      if (isAntigravityModelKey(profile.model_key)) {
        emit('status', { phase: 'antigravity_sandbox' });
        if (typeof streamAntigravitySandboxInteraction !== 'function') {
          throw new Error('antigravity_interaction_service_required');
        }
        const agResult = await streamAntigravitySandboxInteraction(env, {
          message,
          workspaceId: workspaceId || '',
          tenantId: tenantId || null,
          userId: userId || null,
          modelKey: profile.model_key,
          conversationId: sessionId || null,
          parentRunId: chatAgentRunId || null,
          role: 'primary',
          emit,
        });
        if (agResult?.ok) {
          const text =
            String(agResult.output_text || agResult.message || '').trim() ||
            'Antigravity completed.';
          emit('text', { text });
          loopStats = {
            totalUsage: agResult.usage || {},
            modelKey: profile.model_key,
            antigravity: true,
          };
        } else {
          const errMsg = String(agResult?.message || 'Antigravity sandbox failed');
          emit('error', { message: errMsg, code: 'antigravity_error' });
          emit('text', { text: `**Antigravity error:** ${errMsg}` });
          loopStats = null;
        }
        emit('done', {});
        return;
      }
    }

    const runDeadlineController = new AbortController();
    if (typeof services.withAbortableAgentRunTimeout !== 'function') {
      throw new Error('agent_run_timeout_service_required');
    }
    loopStats = await services.withAbortableAgentRunTimeout(
      () =>
        runAgentToolLoop(env, ctx, emit, {
          request: input.request,
          messages: chatMessages,
          tools,
          systemPrompt,
          modelKey: profile.model_key,
          temperature: profile.temperature,
          maxToolCalls: profile.max_tool_calls,
          mode: profile.mode,
          modeConfig: {
            max_runtime_ms: maxRunMs,
            max_turns: profile.max_turns,
            max_tool_calls: profile.max_tool_calls,
            temperature: profile.temperature,
          },
          userPolicy,
          sessionId,
          tenantId,
          userId,
          workspaceId,
          authUser: sessionAuthUser ?? null,
          routingTaskType: profile.routing_task_type,
          mcpRuntimeContext,
          routingArmId: profile.routing_arm_id,
          dispatchSpine,
          agentSlug: subagentProfileRow?.id ?? null,
          chatAgentRunId,
          chatRouteKey: profile.refined_route_key,
          activeFileEnvelope,
          handoffDepth: handoffResume?.depth ?? 0,
          rootSessionId: handoffResume?.rootSessionId ?? sessionId,
          runStartedAt: chatT0,
          maxRuntimeMs: maxRunMs,
          runtimeProfile: profile,
          codemodeRuntime,
          chatTurnMeta,
          persistedUserMessage:
            body._durable_user_message ?? body.user_message ?? body.userMessage ?? message,
          signal: runDeadlineController.signal,
          promptManifest: promptManifest ?? null,
        }),
      maxRunMs + 5000,
      runDeadlineController,
    );
  } catch (e) {
    const msg = String(e?.message || e || '');
    const isTimeout = msg.includes('agent_run_timeout') || /\bTimeout\b/i.test(msg);
    const isAbort =
      clientAborted || e?.name === 'AbortError' || /aborted|AbortError/i.test(msg);
    if (isTimeout) {
      loopStats = {
        timedOut: true,
        cancelled: false,
        totalUsage: {},
        modelKey: profile.model_key,
      };
      emit('error', { message: 'Agent run timed out', code: 'agent_run_timeout' });
    } else if (isAbort) {
      loopStats = {
        cancelled: true,
        timedOut: false,
        totalUsage: {},
        modelKey: profile.model_key,
      };
    } else {
      reportAgentControllerWarning(env, 'loop_failed', e, {
        workspaceId,
        tenantId,
        sessionId,
        sourceId: chatAgentRunId,
        meta: { code: e?.code || 'agent_spine_error' },
      });
      if (!e?.alreadyEmitted) {
        emit('error', {
          message: e?.message ?? 'Agent loop failed',
          code: e?.code || 'agent_spine_error',
        });
      }
    }
    if (!loopStats?.cancelled) {
      emit('done', {});
    }
  } finally {
    if (reqSignal && onRequestAbort) {
      reqSignal.removeEventListener('abort', onRequestAbort);
    }
    const accountingTask = finalizeAgentControllerAccounting(env, ctx, {
      chatAgentRunId,
      userId,
      workspaceId,
      tenantId,
      sessionId,
      agentRunStartPromise,
      loopStats,
      clientAborted,
      profile,
      sessionAuthUser,
      services,
      quickstartBatch,
      chatT0,
    });
    // waitUntil is backup only — after long tool loops, CF can drop nested
    // waitUntil work once the SSE response closes, leaving status=running and
    // completed_at NULL while the chat UI is already past the turn.
    if (ctx?.waitUntil) ctx.waitUntil(accountingTask);
    await Promise.race([
      accountingTask.catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);

    await Promise.race([
      closeStream().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
  }
}
