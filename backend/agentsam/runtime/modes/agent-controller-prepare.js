/**
 * Agent turn prepare: hydrate → vision → tools/codemode → system prompt → emit context.
 */

import { createAgentRunId, startAgentRun } from '../../../telemetry/agent-run.js';
import { parseThreadSlashCommand } from '../../sessions/thread-on-demand.js';
import { runtimeContextPayload, legacyContextPayload } from './runtime-context.js';
import { reportAgentControllerWarning } from './agent-controller-report.js';
import { finalizeAgentTurnToolMenu } from './agent-controller-tool-menu.js';
import { resolveAgentRunTimeoutMs } from './agent-controller-timeouts.js';
import { hydrateAgentChatHistory } from './agent-controller-history.js';
import { resolveAgentVisionContext } from './agent-controller-vision.js';
import { buildAgentSurfaceContextBlock } from './agent-controller-context-block.js';

/** Stop mid-prepare (hydrate / codemode) — client abort alone does not kill Worker work. */
async function assertPrepareNotCancelled(env, runId, services = {}) {
  const rid = runId != null ? String(runId).trim() : '';
  if (!rid || !env?.DB) return;
  if (typeof services.isAgentRunCancelRequested === 'function' &&
      await services.isAgentRunCancelRequested(env, rid)) {
    const error = typeof services.makeAgentRunAbortError === 'function'
      ? services.makeAgentRunAbortError('agent_run_cancelled')
      : Object.assign(new Error('agent_run_cancelled'), { code: 'agent_run_cancelled', name: 'AbortError' });
    throw error;
  }
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {(type: string, payload: object) => Promise<any>} emit
 * @param {object} bound — from resolveAgentControllerBindings
 * @param {any} input — original controller input
 */
export async function prepareAgentControllerTurn(env, ctx, emit, bound, input) {
  const services = input.services || {};
  const {
    profile,
    body,
    message,
    projectBindings,
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

  // Durable run row first — hydrate/vision/prompt can stall for tens of seconds.
  const { parseExecLaneFromWorkspaceContext } = services;
  const wsCtxForLane =
    browserContextPayload &&
    typeof browserContextPayload === 'object' &&
    browserContextPayload.workspaceContext &&
    typeof browserContextPayload.workspaceContext === 'object'
      ? browserContextPayload.workspaceContext
      : null;
  const laneParse = typeof parseExecLaneFromWorkspaceContext === 'function'
    ? parseExecLaneFromWorkspaceContext(wsCtxForLane)
    : { ok: false, lane: null };
  const requestedLane = laneParse.ok ? laneParse.lane : null;

  const chatAgentRunId =
    env?.DB && userId && workspaceId
      ? createAgentRunId(quickstartBatch ? { label: quickstartBatch } : {})
      : null;
  let agentRunStartPromise = null;
  if (chatAgentRunId && userId && workspaceId) {
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
    // Await D1 insert before hydrate/codemode so Stop's conversation cancel can
    // find the row. waitUntil alone raced: cancel → none_found → insert → stuck running.
    if (agentRunStartPromise) {
      await agentRunStartPromise.catch((e) => {
        reportAgentControllerWarning(env, 'agent_run_start_insert', e, {
          workspaceId,
          tenantId,
          sessionId,
          meta: { agent_run_id: chatAgentRunId },
        });
      });
    }
    emit('status', {
      phase: 'agent_run_scheduled',
      conversation_id: sessionId || null,
      agent_run_id: chatAgentRunId,
    });
    await assertPrepareNotCancelled(env, chatAgentRunId, services);
  }

  let chatMessages = [{ role: 'user', content: message }];
  let boot = null;
  const rawBodyTaskType = body.task_type ?? body.taskType ?? null;
  const routeKeyPin = body.route_key ?? body.routeKey ?? profile.refined_route_key ?? null;
  const progressiveDiscovery = profile._progressive_tool_discovery === true;
  const useCodemodeGuess =
    !progressiveDiscovery &&
    (typeof services.shouldUseCodemodeForRequest === 'function'
      ? services.shouldUseCodemodeForRequest(env, {
      agentLikeTooling:
        profile.mode === 'agent' || profile.mode === 'debug' || profile.mode === 'multitask',
      resolvedRoutingTaskType: profile.routing_task_type,
      rawBodyTaskType: rawBodyTaskType != null ? String(rawBodyTaskType) : '',
      routeKey: routeKeyPin != null ? String(routeKeyPin) : null,
      routeKeyPin: routeKeyPin != null ? String(routeKeyPin) : null,
      })
      : false);
  // Codemode is a gateway over the authorized tool menu — not a parallel privilege plane.
  // Pass the already-resolved session actor + run spine; never re-derive isSuperadmin here.
  const codemodeRunContext = {
    workspaceId,
    tenantId,
    userId,
    sessionId,
    conversationId: sessionId,
    conversation_id: sessionId,
    agentRunId: chatAgentRunId,
    agent_run_id: chatAgentRunId,
    routingArmId: profile.routing_arm_id ?? null,
    routing_arm_id: profile.routing_arm_id ?? null,
    modelKey: profile.model_key ?? null,
    model_key: profile.model_key ?? null,
    // Nested catalog telemetry inherits composer mode + client (stats only — not auth).
    mode: profile.mode ?? 'agent',
    agent_mode: profile.mode ?? 'agent',
    source_client: 'internal_agent',
    sourceClient: 'internal_agent',
    authUser: sessionAuthUser ?? null,
    user: sessionAuthUser ?? null,
    active_repo: activeRepo || null,
    activeRepo: activeRepo || null,
    github_repo: activeRepo || null,
    selectedGithubRepoContext: activeRepo || null,
    files_source: filesSource || null,
    filesSource: filesSource || null,
    activeFileEnvelope: activeFileEnvelope || null,
    exec_lane: requestedLane || null,
    execLane: requestedLane || null,
  };
  if (sessionId) {
    try {
      const { bootstrapAgentSession } = await import('../../sessions/session-context.js');
      boot = await bootstrapAgentSession(env, sessionId, {
        historyLimit: 500,
        // Never build Codemode before the final authorized tool menu exists.
        prepareCodemode: false,
        runContext: codemodeRunContext,
      });
    } catch (e) {
      reportAgentControllerWarning(env, 'session_bootstrap', e, {
        workspaceId,
        tenantId,
        sessionId,
      });
      boot = null;
    }
  }
  try {
    const { messagesFromDoBootstrap } = await import('../../sessions/chat-do-client.js');
    const hydrated = await hydrateAgentChatHistory(env, {
      sessionId,
      message,
      bodyMessages: body.messages,
      turnNonce: body.turn_nonce ?? body.turnNonce ?? body.client_turn_id ?? null,
      preloadedMessages: boot ? messagesFromDoBootstrap(boot) : null,
    });
    chatMessages = hydrated.chatMessages;
  } catch (e) {
    reportAgentControllerWarning(env, 'history_hydrate', e, {
      workspaceId,
      tenantId,
      sessionId,
      meta: { phase: 'hydrate' },
    });
  }
  await assertPrepareNotCancelled(env, chatAgentRunId, services);
  emit('status', { phase: 'model_prep', conversation_id: sessionId || null });

  let visionUploadActive = false;
  let visionUploadError = null;
  let imageHandlingMode = 'ephemeral_vision';
  let visionUploadFiles = [];
  let visionErrorUserMessage = (_c, m) => String(m || 'Vision upload failed');
  let VISION_ERROR_CODES = {};
  let chatMessagesHaveVisionUpload = () => false;
  try {
    const vision = await resolveAgentVisionContext(env, {
      body,
      message,
      sessionId,
      chatMessages,
      services,
    });
    chatMessages = vision.chatMessages;
    visionUploadActive = vision.visionUploadActive;
    visionUploadError = vision.visionUploadError;
    imageHandlingMode = vision.imageHandlingMode;
    visionUploadFiles = vision.visionUploadFiles;
    visionErrorUserMessage = vision.visionErrorUserMessage;
    VISION_ERROR_CODES = vision.VISION_ERROR_CODES;
    chatMessagesHaveVisionUpload = vision.chatMessagesHaveVisionUpload;
    if (visionUploadError) {
      reportAgentControllerWarning(env, 'vision_upload_failed', visionUploadError.message || visionUploadError.code, {
        workspaceId,
        tenantId,
        sessionId,
        meta: {
          code: visionUploadError.code,
          fileCount: visionUploadFiles.length,
          mode: imageHandlingMode,
          detail: visionUploadError.detail ?? {},
        },
      });
    }
  } catch (e) {
    reportAgentControllerWarning(env, 'vision_resolve_failed', e, {
      workspaceId,
      tenantId,
      sessionId,
    });
  }
  const createSubagentFlow = typeof services.resolveCreateSubagentFlow === 'function'
    ? services.resolveCreateSubagentFlow(chatMessages)
    : { active: false };

  // Profile compile already resolved the prompt route — do not leave this unbound
  // (buildSystemPrompt / routeKey below ReferenceError → agent_setup_error).
  const promptRouteRow = profile._prompt_route_row ?? null;

  const toolMenu = await finalizeAgentTurnToolMenu(env, ctx, {
    profile,
    message,
    workspaceId,
    userId,
    tenantId,
    sessionId: sessionId,
    subagentProfileRow: subagentProfileRow,
    requestedLane: requestedLane,
    createSubagentFlow: createSubagentFlow,
    progressiveDiscovery: progressiveDiscovery,
    useCodemodeGuess: useCodemodeGuess,
    codemodeRunContext: codemodeRunContext,
    chatAgentRunId: chatAgentRunId,
    assertNotCancelled: (checkEnv, runId) =>
      assertPrepareNotCancelled(checkEnv, runId, services),
    services,
  });
  let tools = toolMenu.tools;
  const toolKeys = toolMenu.toolKeys;
  const execLane = toolMenu.execLane;
  const slashSkill = toolMenu.slashSkill;
  let codemodeRuntime = toolMenu.codemodeRuntime;
  const requireTools = toolMenu.requireTools;
  const terminalLaneStatus = toolMenu.terminalLaneStatus;


  const { buildSystemPrompt } = services;
  const { runAgentToolLoop } = await import('../tool-loop/index.js');
  const minimalAsk =
    profile.max_tools === 0 &&
    !profile.context_policy?.include_rag &&
    !profile.context_policy?.include_memory;

  const { contextBlock: surfaceContextBlock, databaseSurfaceRaw } = buildAgentSurfaceContextBlock({
    body,
    message,
    browserContextPayload,
    activeFileEnvelope,
    profile,
    filesSource,
    filesSourcePath: String(body.files_source_path || body.filesSourcePath || '').trim() || null,
    activeRepo,
    activeBranch: String(
      body.active_branch ?? body.activeBranch ?? body.github_branch ?? body.active_file_github_branch ?? '',
    ).trim() || null,
    fsaRoot: fsaRootActive,
    services,
  });
  let contextBlock = surfaceContextBlock;

  const sessionProjectBlock = String(input.sessionProjectContextBlock || '').trim();
  const workspaceProjectBlock = String(input.projectContextBlock || '').trim();
  const projectBlock = sessionProjectBlock || workspaceProjectBlock;
  // A scoped project is not prompt consent. Only the explicit context flag may
  // authorize saved project context for this turn.
  const projectContextExplicit =
    input.projectContextExplicit === true ||
    body.project_context_explicit === true ||
    body.project_context_explicit === 1 ||
    body.project_context_explicit === '1';
  const scopedProjectRef = Object.prototype.hasOwnProperty.call(input, 'sessionProjectRef')
    ? input.sessionProjectRef
    : body.project_id ?? body.projectId ?? null;
  if (projectBlock && projectContextExplicit) {
    contextBlock = contextBlock ? `${contextBlock}\n\n${projectBlock}` : projectBlock;
    console.info(
      '[agent-controller] project_session_context_injected',
      JSON.stringify({
        chars: projectBlock.length,
        source: sessionProjectBlock ? 'session_project' : 'workspace_project',
        project_ref: input.sessionProjectRef ?? null,
      }),
    );
  } else if (projectBlock) {
    console.info(
      '[agent-controller] project_session_context_skipped',
      JSON.stringify({
        chars: projectBlock.length,
        reason: 'not_project_context_explicit',
        project_ref: input.sessionProjectRef ?? null,
      }),
    );
  }

  let systemPrompt;
  if (env?.DB) {
    if (typeof buildSystemPrompt !== 'function') {
      throw new Error('agent_prompt_builder_required');
    }
    systemPrompt = await buildSystemPrompt(
      env,
      tenantId,
      profile.mode,
      contextBlock,
      null,
      promptRouteRow,
      {
        request: input.request,
        sessionId,
        planId: body.planId ?? body.plan_id ?? null,
        taskId: body.taskId ?? body.task_id ?? null,
        message,
        taskType: profile.routing_task_type,
        routeKey: promptRouteRow?.route_key ?? body.route_key ?? body.routeKey ?? null,
        workspaceId,
        userId,
        projectId: scopedProjectRef,
        projectRef: scopedProjectRef,
        minimalAsk,
        ctx: input.ctx ?? null,
        authUser: sessionAuthUser ?? input.session?.authUser ?? null,
        conversationId: sessionId,
        activeRepo: activeRepo || null,
        active_repo: activeRepo || null,
        githubRepoContext: activeRepo || null,
        activeBranch: String(
          body.active_branch ?? body.activeBranch ?? body.github_branch ?? body.active_file_github_branch ?? '',
        ).trim() || null,
        progressiveToolDiscovery: progressiveDiscovery,
        progressive_tool_discovery: progressiveDiscovery,
        fsaRoot: fsaRootActive,
        filesSource: filesSource || null,
        filesSourcePath: String(body.files_source_path || body.filesSourcePath || '').trim() || null,
      },
    );
  } else {
    systemPrompt = 'You are Agent Sam. Be direct and helpful.';
  }

  /** @type {Array<{ layer_key: string, content?: string|null }>} */
  const volatileManifestBlocks = [];
  if (surfaceContextBlock) {
    volatileManifestBlocks.push({ layer_key: 'lane_context', content: surfaceContextBlock });
  }

  if (env?.DB && tenantId && workspaceId && userId) {
    try {
      const { buildKnowledgeBootstrap, formatKnowledgePacketForPrompt } = services;
      if (typeof buildKnowledgeBootstrap !== 'function' ||
          typeof formatKnowledgePacketForPrompt !== 'function') {
        throw new Error('knowledge_bootstrap_services_required');
      }
      const packet = await buildKnowledgeBootstrap(env, {
        tenantId,
        workspaceId,
        userId,
        projectId: scopedProjectRef || undefined,
        task: message?.slice(0, 500) || undefined,
        agentRunId: chatAgentRunId || undefined,
        tokenBudget: minimalAsk ? 1500 : 4000,
      });
      if (packet?.ok !== false) {
        const block = formatKnowledgePacketForPrompt(packet, { maxChars: minimalAsk ? 2500 : 8000 });
        if (block) {
          systemPrompt = `${systemPrompt}\n\n${block}`;
          volatileManifestBlocks.push({ layer_key: 'knowledge_bootstrap', content: block });
        }
      }
    } catch (e) {
      reportAgentControllerWarning(env, 'knowledge_bootstrap_skipped', e, {
        workspaceId,
        tenantId,
        sessionId,
      });
    }
  }

  try {
    const { extractCmsAgentContext, formatCmsContextForAgent } = services;
    if (typeof extractCmsAgentContext !== 'function' ||
        typeof formatCmsContextForAgent !== 'function') {
      throw new Error('cms_context_services_required');
    }
    const cmsCtx = extractCmsAgentContext(body, browserContextPayload);
    if (cmsCtx) {
      const cmsBlock = formatCmsContextForAgent(cmsCtx);
      if (cmsBlock) {
        systemPrompt = `${systemPrompt}\n\n${cmsBlock}`;
        volatileManifestBlocks.push({ layer_key: 'cms_context', content: cmsBlock });
      }
    }
  } catch (e) {
    reportAgentControllerWarning(env, 'cms_site_spine_skipped', e, {
      workspaceId,
      tenantId,
      sessionId,
    });
  }

  if (slashSkill?.matched && slashSkill.promptBlock) {
    systemPrompt = `${systemPrompt}\n\n${slashSkill.promptBlock}`;
    systemPrompt = `${systemPrompt}\n\n## Active skill command\nThe user invoked \`/${slashSkill.trigger}\`. Follow the skill playbook above and use the tools on your menu. Do not spawn multitask children for this skill.`;
    volatileManifestBlocks.push({ layer_key: 'skill_command', content: slashSkill.promptBlock });
  }

  if (requestedLane) {
    const terminalTool = `agentsam_terminal_${requestedLane}`;
    const laneLabel =
      requestedLane === 'local' ? 'Local (Mac)' : requestedLane === 'remote' ? 'VM (GCP)' : 'Sandbox';
    const terminalBlock = `Dock exec_lane is **${requestedLane}** (${laneLabel}). Terminal tool: ${terminalTool}.`;
    systemPrompt = `${systemPrompt}

## Terminal dock hard-bind
Dock exec_lane is **${requestedLane}** (${laneLabel}). For shell questions (pwd, whoami, ls, hostname, cwd, path) you MUST call \`${terminalTool}\` and report that tool's stdout only. Never invent a cwd. Never claim sandbox, local, or remote unless that is the bound lane. If the tool fails, say it failed — do not guess another host.`;
    volatileManifestBlocks.push({ layer_key: 'terminal_dock', content: terminalBlock });
  }

  let promptManifest = null;
  if (env?.DB && promptRouteRow) {
    try {
      const { resolveStablePrefixFragments, compilePromptManifest, augmentPromptManifestVolatile } =
        services;
      if (typeof resolveStablePrefixFragments !== 'function' ||
          typeof compilePromptManifest !== 'function' ||
          typeof augmentPromptManifestVolatile !== 'function') {
        throw new Error('prompt_manifest_services_required');
      }
      const stableFragments = await resolveStablePrefixFragments(env, promptRouteRow, tenantId);
      const prefixTokens = stableFragments.reduce(
        (n, f) => n + Math.max(0, Math.floor(Number(f.body_tokens) || 0)),
        0,
      );
      const cacheableTokens = stableFragments
        .filter((f) => f.is_cacheable !== false)
        .reduce((n, f) => n + Math.max(0, Math.floor(Number(f.body_tokens) || 0)), 0);
      promptManifest = await compilePromptManifest({
        routeKey: promptRouteRow?.route_key ?? profile.refined_route_key ?? null,
        taskType: profile.routing_task_type ?? null,
        mode: profile.mode ?? null,
        stableFragments,
        prefixTokens,
        cacheableTokens,
      });
      promptManifest = await augmentPromptManifestVolatile(promptManifest, volatileManifestBlocks);
    } catch (e) {
      reportAgentControllerWarning(env, 'prompt_manifest_compile', e, {
        workspaceId,
        tenantId,
        sessionId,
      });
    }
  }

  if (chatAgentRunId && ctx?.waitUntil) {
    if (typeof services.fireAgentHooks !== 'function') {
      throw new Error('hook_dispatcher_required');
    }
    ctx.waitUntil(
      services.fireAgentHooks(env, ctx, 'start', {
        tenant_id: tenantId,
        workspace_id: workspaceId,
        user_id: userId,
        agent_run_id: chatAgentRunId,
        conversation_id: sessionId,
        session_id: sessionId,
      }).catch((e) =>
        reportAgentControllerWarning(env, 'hook_dispatcher_start', e, {
          workspaceId,
          tenantId,
          sessionId,
          sourceId: chatAgentRunId,
        }),
      ),
    );
  }

  emit('runtime_context', runtimeContextPayload(profile, { modelOverride: input.modelOverride ?? null }));
  emit(
    'context',
    legacyContextPayload(profile, {
      toolsCount: tools.length,
      modelOverride: input.modelOverride ?? null,
      routingArmId: profile.routing_arm_id,
      routingTaskType: profile.routing_task_type,
      extra: {
        ...(chatAgentRunId ? { agent_run_id: chatAgentRunId } : {}),
        ...(subagentProfileRow
          ? { subagent_profile_id: subagentProfileRow.id, subagent_slug: subagentProfileRow.slug }
          : {}),
      },
    }),
  );

  const { maxRunMs, source: maxRunSource } = resolveAgentRunTimeoutMs(profile);
  if (maxRunSource === 'default_target') {
    reportAgentControllerWarning(env, 'agent_run_timeout_default', 'profile.max_runtime_ms missing; using default target', {
      workspaceId,
      tenantId,
      sessionId,
      meta: { maxRunMs, profile_id: profile.profile_id || null },
    });
  }

  const threadSlashAction = (typeof services.parseThreadSlashCommand === 'function'
    ? services.parseThreadSlashCommand
    : parseThreadSlashCommand)(message);

  if (userId && workspaceId && sessionId && !threadSlashAction) {
    try {
      const approxTokens = Math.ceil(
        chatMessages
          .map((m) => {
            if (typeof m?.content === 'string') return m.content;
            try {
              return JSON.stringify(m?.content ?? '');
            } catch {
              return '';
            }
          })
          .join('').length / 4,
      );
      if (typeof services.scheduleChatExecutionContextSnapshot !== 'function') {
        throw new Error('execution_context_snapshot_required');
      }
      services.scheduleChatExecutionContextSnapshot(env, ctx, {
        agentRunId: chatAgentRunId,
        workspaceId,
        tenantId,
        conversationId: sessionId,
        contextTokens: approxTokens,
      });
    } catch (e) {
      reportAgentControllerWarning(env, 'context_snapshot', e, {
        workspaceId,
        tenantId,
        sessionId,
        sourceId: chatAgentRunId,
      });
    }
  }

  return {
    bound,
    input,
    chatMessages,
    visionUploadActive,
    visionUploadError,
    imageHandlingMode,
    visionUploadFiles,
    visionErrorUserMessage,
    VISION_ERROR_CODES,
    chatMessagesHaveVisionUpload,
    createSubagentFlow,
    tools,
    codemodeRuntime,
    requireTools,
    runAgentToolLoop,
    databaseSurfaceRaw,
    systemPrompt,
    chatAgentRunId,
    agentRunStartPromise,
    maxRunMs,
    threadSlashAction,
    scopedProjectRef,
    projectBindings,
    execLane,
    toolKeys,
    slashSkill,
    terminalLaneStatus,
    promptManifest,
  };
}
