/**
 * Agent Sam chat spine — session context (DO) → model → tool loop.
 * Tools/write_policy: resolveRuntimeProfile once per session (cached on DO).
 * Intent authority is still one resolveTurnDecision per turn (routing spine law).
 */
import { jsonResponse } from '../core/responses.js';
import { logRuntimeProfile } from '../core/runtime-profile.js';
import { normalizeAgentRuntimeMode } from '../../backend/agentsam/runtime/mode.js';
import { executeAskTurn } from '../../backend/agentsam/runtime/modes/ask-controller.js';
import { executePlanTurn } from '../../backend/agentsam/runtime/modes/plan-controller.js';
import { executeAgentTurn } from '../../backend/agentsam/runtime/modes/agent-controller-entry.js';
import { executeDebugTurn } from '../../backend/agentsam/runtime/modes/debug-controller.js';
import { executeMultitaskTurn } from '../../backend/agentsam/runtime/modes/multitask-controller.js';
import { resolveIntegrationUserId } from '../../backend/identity/oauth/integration-user-id.js';
import { scheduleChatSessionTitleInsert } from '../../backend/agentsam/sessions/index.js';
import { normalizePlanModeMessage } from '../core/plan-mode-utils.js';
import { parseProjectContextFromBody } from '../../backend/agentsam/runtime/project-context.js';
import { scheduleWorkspaceConversationPin } from '../core/agentsam-workspace-state.js';
import {
  parseSessionProjectIdFromChatBody,
  resolveConversationProjectRef,
} from '../../backend/agentsam/sessions/index.js';
import { loadSessionProjectContextSystemBlock, resolveProjectExecutionBindings } from '../core/project-session-context.js';
import { resolveWorkspaceBindings } from '../../backend/identity/workspace/agentsam-workspace.js';
import { loadOrBootstrapSessionContext } from '../../backend/agentsam/sessions/session-context.js';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'Access-Control-Allow-Origin': '*',
};

/**
 * @param {any} env
 * @param {Request} request
 * @param {any} ctx
 * @param {Record<string, unknown>} pre
 * @returns {Promise<Response>}
 */
export async function executeAgentChatSpine(env, request, ctx, pre) {
  const body = /** @type {Record<string, unknown>} */ (pre.body || {});
  const rawMessage = String(pre.message || '').trim();
  const planNorm = normalizePlanModeMessage(rawMessage, body);
  const message = planNorm.message;
  if (planNorm.forcePlan) {
    body.force_plan_mode = true;
  }
  if (planNorm.refinePlanId) {
    body.plan_id = planNorm.refinePlanId;
    body.refine_plan = true;
  }
  const tenantId = pre.tenantId != null ? String(pre.tenantId) : null;
  let userId = pre.userId != null ? String(pre.userId) : null;
  if (userId) {
    const canonicalUserId = await resolveIntegrationUserId(env, { id: userId });
    if (canonicalUserId) userId = canonicalUserId;
  }
  /**
   * Turn execution workspace — authority is pre.workspaceId from buildAgentTurnContext.
   * Do not re-read body/header aliases here; that reopens phantom/archive switching.
   */
  const workspaceId = pre.workspaceId != null ? String(pre.workspaceId).trim() : '';
  const sessionId = pre.sessionId != null ? String(pre.sessionId) : null;
  if (!workspaceId) {
    return jsonResponse({ error: 'workspace_resolution_failed' }, 400);
  }

  const authUser = pre.authUser || { id: userId, tenant_id: tenantId };
  const quickstartBatch = pre.quickstartBatch != null ? String(pre.quickstartBatch) : '';
  const activeFileEnvelope = pre.activeFileEnvelope ?? null;
  const subagentProfileRow = pre.subagentProfileRow ?? null;
  const browserContextPayload = pre.browserContextPayload ?? null;
  const handoffResume = pre.handoffResume ?? null;

  // NOTE: requestedMode is only used to compile the immutable RuntimeProfile.
  // Dispatch must always use profile.mode_controller.
  let requestedMode = normalizeAgentRuntimeMode(pre.requestedMode ?? body.mode);
  if (planNorm.forcePlan) requestedMode = 'plan';

  const rawModel =
    body.model ?? body.model_key ?? body.modelKey ?? pre.handoffResume?.fallbackModelKey ?? null;
  let modelOverride =
    rawModel != null && String(rawModel).trim() !== '' && String(rawModel).trim().toLowerCase() !== 'auto'
      ? String(rawModel).trim()
      : null;

  const { collectChatVisionUploadFiles } = await import('../core/chat-composer-attachments.js');
  const visionUploadFiles = collectChatVisionUploadFiles(body);
  const requireVision = visionUploadFiles.length > 0;

  const projectContext =
    pre.projectContext ?? parseProjectContextFromBody(body) ?? null;

  const { resolveDesignStudioChatOverrides } = await import('../core/design-studio-context.js');
  const designStudioOverrides = resolveDesignStudioChatOverrides(browserContextPayload, body, message);
  const chosenSubagentSlug =
    (body.subagent_slug != null && String(body.subagent_slug).trim()) ||
    (body.subagentSlug != null && String(body.subagentSlug).trim()) ||
    '';
  const chosenToolProfileKey =
    subagentProfileRow?.tool_profile_key != null &&
    String(subagentProfileRow.tool_profile_key).trim()
      ? String(subagentProfileRow.tool_profile_key).trim()
      : null;
  const runtimeOverrides = {
    model_key: modelOverride,
    // Honor client-chosen slug only — never design-studio / route presets.
    subagent_slug: chosenSubagentSlug || null,
    tool_profile_key: chosenToolProfileKey,
    route_key:
      designStudioOverrides?.route_key ?? body.route_key ?? body.routeKey ?? null,
    task_type:
      body.task_type ?? body.taskType ?? null,
  };

  const forceImage =
    body.force_image_generation === true ||
    body.force_image_generation === 1 ||
    body.force_image_generation === '1' ||
    body.force_image_generation === 'true' ||
    String(body.composer_action || '').trim().toLowerCase() === 'create_image';

  if (!sessionId) {
    return jsonResponse({ error: 'conversation_id required for session context' }, 400);
  }

  // Front-door: one agentsam_intent_decisions row per turn (tkt_p0_infer_intent_heuristically).
  const turnCtx = {
    tenantId,
    workspaceId,
    userId,
    conversationId: sessionId,
    mode: requestedMode,
  };
  const { resolveTurnDecision } = await import('../core/turn-decision.js');
  const turnDecision = await resolveTurnDecision(env, message, turnCtx, {
    forceImage,
    composerAction: body.composer_action != null ? String(body.composer_action) : null,
    mode: requestedMode,
    // Explicit picker pin wins — no Thompson/cheap intent LLM side-calls this turn.
    skipLlmClassify: !!modelOverride,
  });

  const requestedSessionProjectRef = parseSessionProjectIdFromChatBody(body);
  const projectContextSource = String(body.project_context_source || '').trim();
  // Scope and prompt material are separate authorities:
  // - project_composer may bind the conversation to a project for tooling/resource scope.
  // - only project_context_explicit=1 authorizes saved project context in this turn's prompt.
  const projectContextExplicit =
    body.project_context_explicit === true ||
    body.project_context_explicit === 1 ||
    body.project_context_explicit === '1';
  const projectScopeExplicit =
    projectContextExplicit ||
    projectContextSource === 'project_composer';
  const projectContextClear =
    body.project_context_clear === true ||
    body.project_context_clear === 1 ||
    body.project_context_clear === '1';
  const conversationProject = await resolveConversationProjectRef(env, {
    conversationId: sessionId,
    userId,
    tenantId,
    requestedProjectRef: requestedSessionProjectRef,
    explicit: projectScopeExplicit || projectContextClear,
    clear: projectContextClear,
  });
  const sessionProjectRef = conversationProject.projectRef;
  console.info(
    '[agent-chat-spine] project_context_resolved',
    JSON.stringify({
      conversation_id: sessionId,
      project_ref: sessionProjectRef,
      source: conversationProject.source,
      ignored_request_ref:
        !projectContextExplicit &&
        requestedSessionProjectRef &&
        requestedSessionProjectRef !== sessionProjectRef
          ? requestedSessionProjectRef
          : null,
    }),
  );

  if (!requireVision && turnDecision.imageFastPath === true) {
    const { handleDirectImageGenerationChatStream } = await import('../../backend/agentsam/tools/image_generation.js');
    scheduleChatSessionTitleInsert(env, ctx, {
      conversationId: sessionId,
      tenantId,
      userId,
      workspaceId,
      message,
      modelKey: null,
      activeFileEnvelope,
      body,
      projectRef: sessionProjectRef,
      projectExplicit: projectScopeExplicit || projectContextClear,
    });
    scheduleWorkspaceConversationPin(env, ctx, {
      conversationId: sessionId,
      workspaceId,
    });
    return handleDirectImageGenerationChatStream(env, ctx, {
      request,
      message,
      userId,
      tenantId,
      workspaceId,
      sessionId,
      authUser,
      turnDecisionId: turnDecision.decisionId,
      turnDecision,
    });
  }

  const sessionCtx = await loadOrBootstrapSessionContext(env, {
    conversationId: sessionId,
    mode: requestedMode,
    workspaceId,
    userId,
    tenantId,
    message,
    turnDecision,
    body,
    activeFileEnvelope,
    forceRefresh: body.refresh_session_context === true,
  });

  const composerMode = sessionCtx.mode || requestedMode;
  // Classifier labels are telemetry / image fast-path only — never model or route SSOT.
  const turnTaskType = String(
    turnDecision?.taskSpec?.taskType || turnDecision?.chatResult?.taskType || '',
  )
    .trim()
    .toLowerCase();
  const { modeToDefaultRouteKey } = await import('../../backend/agentsam/runtime/routing/route-keys.js');
  const modeRouteKey = modeToDefaultRouteKey(composerMode);
  const routeKey =
    body.route_key != null && String(body.route_key).trim() !== ''
      ? String(body.route_key).trim().toLowerCase()
      : body.routeKey != null && String(body.routeKey).trim() !== ''
        ? String(body.routeKey).trim().toLowerCase()
        : modeRouteKey;
  let modelKey = modelOverride;
  let routingArmId = null;
  let routingSelectedBy = modelOverride ? 'requested' : null;
  let selectedProvider = null;
  try {
    const { resolveModelForTask } = await import('../core/resolveModel.js');
    const resolved = await resolveModelForTask(env, {
      mode: composerMode,
      prefer_mode_profile: true,
      workspace_id: workspaceId,
      tenant_id: tenantId,
      user_id: userId,
      requested_model_key: modelOverride,
      // Ask still needs tool-capable models (inspect/search/github). Write gates are
      // mode write_policy + validateToolCall — not "no tools".
      require_tools: true,
      require_vision: requireVision,
    });
    modelKey = resolved?.model_key || modelKey;
    routingArmId = resolved?.arm_id || resolved?.routing_arm_id || null;
    routingSelectedBy = resolved?.resolution_source || routingSelectedBy;
    selectedProvider =
      resolved?.provider != null && String(resolved.provider).trim() !== ''
        ? String(resolved.provider).trim()
        : null;
  } catch (e) {
    console.warn('[agent-chat-spine] resolveModelForTask', e?.message ?? e);
  }
  if (!modelKey) {
    return jsonResponse({ error: 'no_model_resolved' }, 503);
  }

  const profile = sessionCtx.runtimeProfile;
  if (!profile || typeof profile !== 'object') {
    return jsonResponse(
      {
        error: 'session_runtime_profile_missing',
        detail: 'resolveRuntimeProfile did not yield a cached RuntimeProfile for this session',
      },
      503,
    );
  }
  // Per-turn model bind (Thompson / pin) — tools+ceilings already from resolveRuntimeProfile.
  // Must refresh selected_provider too: session-cached profiles otherwise keep a prior
  // turn's provider (e.g. openai) after resolveModel pinned google/gemini.
  profile.model_key = modelKey;
  profile.routing_arm_id = routingArmId;
  profile.routing_selected_by = routingSelectedBy;
  profile.selected_provider = selectedProvider;
  if (routeKey) profile.refined_route_key = routeKey;
  profile._session_roots = sessionCtx.roots;
  profile._fsa_root = sessionCtx.roots?.fsa_root === true;
  profile._files_source = String(body.files_source || body.filesSource || '').trim().toLowerCase() || null;
  profile._files_source_path =
    String(body.files_source_path || body.filesSourcePath || '').trim() || null;
  profile._files_r2_bucket =
    String(body.files_r2_bucket || body.filesR2Bucket || body.r2_bucket || '').trim() || null;
  profile._files_r2_prefix =
    String(body.files_r2_prefix || body.filesR2Prefix || body.r2_prefix || '').trim() || null;
  if (profile.source && typeof profile.source === 'object') {
    profile.source.turn_decision_id = turnDecision.decisionId;
    profile.source.compile_lane = 'session_context';
    profile.source.session_scoped = true;
  }

  logRuntimeProfile(profile, {
    path: 'executeAgentChatSpine.session_context',
    conversation_id: sessionId,
    live: true,
    // Raw request pins — separate from profile.mode / refined_route_key so mismatches show.
    requestedMode,
    requestedRouteKey:
      body.route_key != null && String(body.route_key).trim() !== ''
        ? String(body.route_key).trim().toLowerCase()
        : body.routeKey != null && String(body.routeKey).trim() !== ''
          ? String(body.routeKey).trim().toLowerCase()
          : null,
  });

  scheduleChatSessionTitleInsert(env, ctx, {
    conversationId: sessionId,
    tenantId,
    userId,
    workspaceId,
    message,
    modelKey: profile.model_key ?? modelOverride,
    activeFileEnvelope,
    body,
    projectRef: sessionProjectRef,
    projectExplicit: projectScopeExplicit || projectContextClear,
  });

  scheduleWorkspaceConversationPin(env, ctx, {
    conversationId: sessionId,
    workspaceId,
  });

  // Workspace bindings = this turn's authorized execution workspace only.
  // Never use sessionProjectRef here — that is a projects.id and silently
  // rebinds CF/tool context to whichever agentsam_workspace matches project_id.
  const workspaceBindingIdentifier = workspaceId;
  console.info(
    '[agent-chat-spine] workspace_bindings_resolved',
    JSON.stringify({
      conversation_id: sessionId,
      source: 'turn_workspace_id',
      identifier: workspaceBindingIdentifier,
      session_project_ref: sessionProjectRef || null,
    }),
  );
  const workspaceBindings = await resolveWorkspaceBindings(env, workspaceBindingIdentifier);
  const projectExecutionBindings = sessionProjectRef
    ? await resolveProjectExecutionBindings(env, sessionProjectRef, workspaceId)
    : null;
  const sessionProjectContextBlock =
    sessionProjectRef && projectContextExplicit
      ? await loadSessionProjectContextSystemBlock(env, sessionProjectRef, workspaceId)
      : '';
  // Project context is opt-in and conversation-scoped. Never pick an ambient
  // "active" project from a workspace that contains many unrelated projects.
  // Sticky project_ref may remain for tooling; prompt blob only when explicit.
  const projectContextBlock = '';

  // Spine job: dispatch by compiled immutable profile only.
  // Multi-agent spawn is tools (agentsam_multitask_*) — not skill-resume hijack.
  const controllerInput = {
    request,
    body,
    message,
    profile,
    session: {
      userId,
      workspaceId,
      tenantId,
      sessionId,
      authUser,
    },
    modelOverride,
    quickstartBatch,
    activeFileEnvelope,
    subagentProfileRow,
    browserContextPayload,
    handoffResume,
    projectContextBlock,
    sessionProjectContextBlock,
    sessionProjectRef: sessionProjectRef || null,
    projectContextExplicit,
    projectExecutionBindings,
    workspaceBindings,
    chatTurnMeta: pre.chatTurnMeta ?? null,
    turnDecision,
    turnDecisionId: turnDecision.decisionId,
    emit: typeof pre.emit === 'function' ? pre.emit : null, planServices: pre.planServices || null, services: pre.services || null,
  };

  switch (profile.mode_controller) {
    case 'ask_controller':
      return executeAskTurn(env, ctx, controllerInput);
    case 'plan_controller':
      return executePlanTurn(env, ctx, controllerInput);
    case 'agent_controller':
      return executeAgentTurn(env, ctx, controllerInput);
    case 'debug_controller':
      return executeDebugTurn(env, ctx, controllerInput);
    case 'multitask_controller':
      return executeMultitaskTurn(env, ctx, controllerInput);
    default:
      throw new Error(`Unsupported mode_controller: ${profile.mode_controller}`);
  }
}
