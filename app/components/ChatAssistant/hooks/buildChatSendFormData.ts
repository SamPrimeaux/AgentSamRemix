/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Mechanical peel from ChatAssistant.tsx — behavior-identical move.
 */

/**
 * FormData field stamping for Agent Sam chat send (peel A2).
 */
import {
  readSessionEnabledConnectors,
  flattenSessionEnabledTools,
} from '../../../src/lib/freshChatSession';
import { takePendingProjectBind } from '../../../lib/pendingProjectBind';
import { getDatabaseSurfaceContext } from '../../../src/lib/databaseStudioEvents';
import { detectClientSurface } from '../../../src/lib/clientSurface';
import { buildChatProjectContext, CHAT_RUNTIME_LANE_FULL_COMPILE } from '../../../lib/chatProjectContext';
import {
  resolveAttachmentFileForUpload,
  isImageAttachmentFile,
  resolveComposerImageHandlingMode,
  stageFileForAgentTools,
} from '../types';
import { isPlatformOperatorFromPolicy, tryReadDockExecLane } from '../../../src/lib/execLane';
import { getEditorLightweightPath, isChatTextCodeFile } from '../mentionContext';
import { buildGithubContextEnvelope } from '../../../types/contextEnvelope';
import { loadPersistedLocalDirectoryHandle } from '../../../src/lib/library/localHandleStore';
import { IAM_FILES_SOURCE_CONTEXT_REQUEST_EVENT } from '../../../src/lib/agentSamFilesystemTypes';
import { WEB_SEARCH_SOURCE_ID } from '../composer/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function appendChatSendFormFields(form: FormData, d: any): Promise<void> {
  const {
    messageForApi,
    sendMode,
    composerActionRef,
    resolvedActivePlanId,
    effectiveModelKey,
    useAutoRouting,
    chatModels,
    effectiveConvId,
    activeProject,
    designStudioSceneId,
    designStudioBlueprintId,
    designStudioCadJobId,
    sendWorkspaceId,
    filesSourceContextRef,
    explorerActiveSource,
    explorerActiveSourceRef,
    explorerActiveRepo,
    githubRepoContext,
    githubContextActive,
    sendOpts,
    defaultSubagentSlug,
    browserSurfaceRef,
    databaseSurfaceRef,
    designStudioSurfaceRef,
    mailSurfaceRef,
    fsChangeScopeRef,
    turnDatabaseSurface,
    dashboardRouteLabel,
    dashboardRouteKey,
    openFilePaths,
    activeFile,
    pickedElementRef,
    designModeContextRef,
    hostWorkspaceContext,
    activeWorkbenchTab,
    browserUrlProp,
    activePlanIdRef,
    workflowLedger,
    agentsamPolicy,
    cmsContext,
    composerSources,
    stagedAttachments,
    userMessage,
    clearAttachments,
    activeFileContent,
    chatGithubFilePath,
    chatGithubBranch,
    chatGithubFileContent,
    chatGithubContentSha,
    chatGithubContentTruncated,
  } = d;

  form.append('message', messageForApi);
  // Durable chat history stores only what the operator actually typed. Hidden file/context
  // material belongs to the current inference turn and must never be persisted as user text.
  form.append('user_message', userMessage);
  // Composer mode only — Thompson model pick is `model`, not `mode`.
  form.append('mode', sendMode);
  if (composerActionRef.current) {
    form.append('composer_action', composerActionRef.current);
    if (composerActionRef.current === 'create_image') {
      form.append('force_image_generation', '1');
    }
    composerActionRef.current = null;
  }
  if (resolvedActivePlanId) form.append('plan_id', resolvedActivePlanId);
  form.append('model', effectiveModelKey);
  if (!useAutoRouting) {
    const selectedModelProvider =
      chatModels.find((m) => m.model_key === effectiveModelKey)?.provider || 'anthropic';
    form.append('provider', selectedModelProvider);
  }
  form.append('conversationId', effectiveConvId);
  // One-shot project scope bind. Scope and prompt material are separate wires:
  // Context Hub selection explicitly attaches saved project context; project surfaces/URLs do not.
  const pendingBind = takePendingProjectBind();
  if (pendingBind?.kind === 'set' && pendingBind.projectId) {
    form.append('project_id', pendingBind.projectId);
    form.append('project_scope_explicit', '1');
    form.append('project_context_source', pendingBind.source);
    if (pendingBind.source === 'context_hub') {
      form.append('project_context_explicit', '1');
    }
  } else if (pendingBind?.kind === 'clear') {
    form.append('project_context_clear', '1');
  }
  form.append('contextMode', String(activeProject));
  if (designStudioSceneId?.trim()) form.append('scene_snapshot_id', designStudioSceneId.trim());
  if (designStudioBlueprintId?.trim()) form.append('blueprint_id', designStudioBlueprintId.trim());
  if (designStudioCadJobId?.trim()) form.append('cad_job_id', designStudioCadJobId.trim());
  if (sendWorkspaceId) form.append('workspace_id', sendWorkspaceId);
  const filesCtx = filesSourceContextRef.current;
  // Prefer live explorer plane over filesCtx — filesCtx has gone stale while explorer events stayed correct.
  const liveSource = String(
    explorerActiveSource || explorerActiveSourceRef.current || filesCtx?.source || '',
  )
    .trim()
    .toLowerCase();
  if (liveSource) {
    form.append('files_source', liveSource);
    if (filesCtx?.source_path) form.append('files_source_path', filesCtx.source_path);
    if (filesCtx?.r2_bucket) form.append('files_r2_bucket', filesCtx.r2_bucket);
    if (filesCtx?.r2_prefix) form.append('files_r2_prefix', filesCtx.r2_prefix);
    if (liveSource === 'local' && (filesCtx?.has_local_handle || filesCtx?.source === 'local')) {
      form.append('local_fsa_connected', '1');
      form.append('fsa_root', '1');
    }
  }
  // Event-driven explorer repo wins on the GitHub plane; never invent github on local/r2/drive.
  const explorerRepo = explorerActiveRepo?.trim() || '';
  const filesGithub =
    filesCtx?.source === 'github' ? filesCtx.github_repo?.trim() || '' : '';
  // A connected GitHub account/repo is capability state, not turn context.
  // Send only live explorer/files GitHub context or a repo explicitly activated
  // from the + drawer for this chat.
  const activeRepoForTurn =
    explorerRepo ||
    filesGithub ||
    (githubContextActive || liveSource === 'github' ? githubRepoContext?.trim() || '' : '');
  if (activeRepoForTurn) {
    form.append('active_repo', activeRepoForTurn);
  }
  // task_type / route_key: ONLY when the caller passed them explicitly (CAD operator
  // button, quickstart card). Never invent from message text, designStudioSurfaceRef,
  // or dashboardTaskType — that ambient class is banned (nuke-prellm-classifiers).
  if (sendOpts?.task_type?.trim()) form.append('task_type', sendOpts.task_type.trim());
  if (sendOpts?.route_key?.trim()) form.append('route_key', sendOpts.route_key.trim());
  const effectiveSubagentSlug = sendOpts?.subagent_slug?.trim() || defaultSubagentSlug?.trim() || '';
  if (effectiveSubagentSlug) form.append('subagent_slug', effectiveSubagentSlug);
  if (sendOpts?.quickstart_batch?.trim()) {
    form.append('quickstart_batch', sendOpts.quickstart_batch.trim());
  }
  if (sendOpts?.quickstart_card?.trim()) {
    form.append('quickstart_card', sendOpts.quickstart_card.trim());
  }
  if (sendOpts?.apply_eto_after_run) {
    form.append('apply_eto_after_run', 'true');
  }
  if (sendOpts?.force_plan_mode) {
    form.append('force_plan_mode', 'true');
  }
  if (sendOpts?.project_slug?.trim()) form.append('project_slug', sendOpts.project_slug.trim());
  if (sendOpts?.page_id?.trim()) form.append('page_id', sendOpts.page_id.trim());
  if (sendOpts?.bootstrap_cache_key?.trim()) {
    form.append('bootstrap_cache_key', sendOpts.bootstrap_cache_key.trim());
  }
  if (sendOpts?.collab_room?.trim()) form.append('collab_room', sendOpts.collab_room.trim());
  if (sendOpts?.live_session_id?.trim()) {
    form.append('live_session_id', sendOpts.live_session_id.trim());
  }
  const wid = String(sendWorkspaceId || '').trim();
  if (!wid) {
    throw new Error('workspace_id_required');
  }
  // Non-throwing: null when dock has no lane set. Server strips terminal tools
  // and continues the turn (agent-controller-execute-turn.js) instead of a
  // pre-dispatch dead end. Never invent a lane here — that is guard:terminal-lane-ssot's job.
  const dockExecLane = tryReadDockExecLane(wid);
  try {
    const browserCtxPayload: Record<string, unknown> = {
      ...(browserSurfaceRef.current && typeof browserSurfaceRef.current === 'object' ? browserSurfaceRef.current : {}),
      dashboard_route: typeof window !== 'undefined' ? window.location.pathname : '',
      dashboard_route_label: dashboardRouteLabel || null,
      dashboard_route_key: dashboardRouteKey || null,
    };
    if (turnDatabaseSurface) {
      browserCtxPayload.databaseContext = turnDatabaseSurface;
    } else if (databaseSurfaceRef.current && typeof databaseSurfaceRef.current === 'object') {
      browserCtxPayload.databaseContext = databaseSurfaceRef.current;
    } else if (
      typeof window !== 'undefined' &&
      window.location.pathname.startsWith('/dashboard/database')
    ) {
      const liveSnap = getDatabaseSurfaceContext();
      if (liveSnap && typeof liveSnap === 'object') {
        databaseSurfaceRef.current = liveSnap as Record<string, unknown>;
        browserCtxPayload.databaseContext = liveSnap;
      }
    }
    if (designStudioSurfaceRef.current && typeof designStudioSurfaceRef.current === 'object') {
      browserCtxPayload.designStudioContext = designStudioSurfaceRef.current;
    }
    if (mailSurfaceRef.current && typeof mailSurfaceRef.current === 'object') {
      browserCtxPayload.mailContext = mailSurfaceRef.current;
    }
    if (fsChangeScopeRef.current && typeof fsChangeScopeRef.current === 'object') {
      browserCtxPayload.fs_change_scope = fsChangeScopeRef.current;
    }
    const browserUrlFromSurface =
      typeof browserSurfaceRef.current?.url === 'string'
        ? String(browserSurfaceRef.current.url).trim()
        : '';
    const openFilesList = [
      ...(openFilePaths || []),
      activeFile ? getEditorLightweightPath(activeFile) || activeFile.name || '' : '',
    ]
      .map((p) => String(p || '').trim())
      .filter(Boolean);
    const picked = pickedElementRef.current;
    if (picked && typeof picked === 'object') {
      browserCtxPayload.selected_element = picked;
      browserCtxPayload.picked_element = picked;
    }
    const dmCtx = designModeContextRef.current;
    if (dmCtx?.design_mode_active || dmCtx?.design_mode?.active) {
      browserCtxPayload.design_mode = dmCtx.design_mode;
      browserCtxPayload.design_mode_active = true;
      browserCtxPayload.selected_elements = dmCtx.selected_elements;
      if (!browserCtxPayload.selected_element && dmCtx.selected_elements[0]) {
        browserCtxPayload.selected_element = dmCtx.selected_elements[0];
        browserCtxPayload.picked_element = dmCtx.selected_elements[0];
      }
    }
    const workspaceContextPacket = {
      ...(hostWorkspaceContext && typeof hostWorkspaceContext === 'object' ? hostWorkspaceContext : {}),
      activeTab: String(activeWorkbenchTab || 'Workspace'),
      browserUrl: browserUrlProp?.trim() || browserUrlFromSurface || null,
      openFiles: [...new Set(openFilesList)].slice(0, 32),
      plan_id: activePlanIdRef.current || null,
      workflow_run_id: workflowLedger.runId || null,
      dashboard_path: typeof window !== 'undefined' ? window.location.pathname : null,
      dashboard_route_key: dashboardRouteKey || null,
      client_surface: detectClientSurface(),
      exec_lane: dockExecLane,
      platform_operator_lane: isPlatformOperatorFromPolicy(agentsamPolicy),
      assume_mac_local: false,
      browser_surface:
        browserSurfaceRef.current && typeof browserSurfaceRef.current === 'object'
          ? browserSurfaceRef.current
          : null,
      picked_element: picked && typeof picked === 'object' ? picked : null,
      project_slug: cmsContext?.project_slug ?? null,
      page_id: cmsContext?.page_id ?? null,
      studio_panel: cmsContext?.studio_panel ?? null,
      live_session_id: cmsContext?.live_session_id ?? null,
      collab_room: cmsContext?.collab_room ?? null,
      bootstrap_cache_key: cmsContext?.bootstrap_cache_key ?? null,
      preview_url: cmsContext?.preview_url ?? null,
      public_domain: cmsContext?.public_domain ?? null,
      cms_hosting: cmsContext?.cms_hosting ?? null,
      api_profile: cmsContext?.api_profile ?? null,
      capabilities: cmsContext?.capabilities ?? null,
      r2_bucket: cmsContext?.r2_bucket ?? null,
      r2_key: cmsContext?.r2_key ?? null,
      composer_sources: composerSources.map((s) => ({
        id: s.id,
        label: s.label,
        kind: s.kind,
        provider_key: s.providerKey ?? null,
      })),
      web_search_enabled: composerSources.some((s) => s.id === WEB_SEARCH_SOURCE_ID),
      enabled_connectors: readSessionEnabledConnectors(),
      enabled_tools: flattenSessionEnabledTools(),
      designStudioContext:
        designStudioSurfaceRef.current && typeof designStudioSurfaceRef.current === 'object'
          ? designStudioSurfaceRef.current
          : null,
    };
    browserCtxPayload.workspaceContext = workspaceContextPacket;
    form.append('workspaceContext', JSON.stringify(workspaceContextPacket));
    form.append('browserContext', JSON.stringify(browserCtxPayload));
    pickedElementRef.current = null;
  } catch {
    /* ignore */
  }
  const toolAttIds: string[] = [];
  const imageHandlingMode = resolveComposerImageHandlingMode(userMessage);
  for (const a of stagedAttachments) {
    const uploadFile = await resolveAttachmentFileForUpload(a);
    const isImage = a.type === 'image' || isImageAttachmentFile(uploadFile);
    const isText = !isImage && isChatTextCodeFile(uploadFile);
    if (isImage) {
      form.append('images', uploadFile, uploadFile.name || 'image.png');
      form.append('files', uploadFile, uploadFile.name || 'image.png');
    } else {
      form.append('files', uploadFile, uploadFile.name || 'attachment');
    }

    // Text/code/log files are read from this multipart request as ephemeral inference
    // context by the Worker. Default vision images are inline-ephemeral too. Only create
    // att_* tool handles for binaries, or when the user explicitly asks to persist an image.
    const shouldStageForTools = !isText && (!isImage || imageHandlingMode === 'persisted_asset');
    if (shouldStageForTools) {
      let attId = a.agentAttachmentId;
      if (!attId || !attId.startsWith('att_')) {
        const staged = await stageFileForAgentTools(uploadFile);
        if (staged.ok && staged.attachment_id) attId = staged.attachment_id;
      }
      if (attId && attId.startsWith('att_')) toolAttIds.push(attId);
    }
  }
  if (toolAttIds.length) {
    form.append('staged_attachment_ids', JSON.stringify(toolAttIds));
  }
  form.append('image_handling_mode', imageHandlingMode);
  clearAttachments();

  if (activeFile) {
    const activePath = getEditorLightweightPath(activeFile) || activeFile.name || '';
    if (activePath) form.append('active_file_path', activePath);
    // Prefer stamped source_type; never let a stale githubRepo win over a local handle/path.
    const stamped =
      activeFile.source_type != null ? String(activeFile.source_type).trim().toLowerCase() : '';
    const activeSource =
      stamped === 'local' || stamped === 'github' || stamped === 'r2' || stamped === 'drive'
        ? stamped
        : activeFile.handle ||
            (activeFile.workspacePath && !(activeFile.githubRepo && activeFile.githubPath))
          ? 'local'
          : activeFile.githubRepo && activeFile.githubPath
            ? 'github'
            : activeFile.r2Key
              ? 'r2'
              : activeFile.driveFileId
                ? 'drive'
                : 'buffer';
    form.append('active_file_source', activeSource);
    form.append('active_file_r2_bucket', activeFile.r2Bucket ?? '');
    form.append('active_file_r2_key', activeFile.r2Key ?? '');
    if (activeSource === 'github') {
      form.append('active_file_github_repo', activeFile.githubRepo ?? '');
      form.append('active_file_github_path', activeFile.githubPath ?? '');
      form.append('active_file_github_branch', activeFile.githubBranch ?? '');
      if (activeFile.githubSha) form.append('active_file_github_sha', activeFile.githubSha);
    } else {
      form.append('active_file_github_repo', '');
      form.append('active_file_github_path', '');
      form.append('active_file_github_branch', '');
    }
    form.append('active_file_drive_id', activeFile.driveFileId ?? '');
    form.append('active_file_workspace_path', activeFile.workspacePath ?? '');
    if (activeSource === 'local' || activeFile.handle) {
      form.append('local_fsa_connected', '1');
      form.append('fsa_root', '1');
    }
    if (activeFileContent != null && activeFileContent !== '') {
      form.append(
        'active_file_content',
        activeFileContent.slice(0, 48000),
      );
    }
  } else if (activeRepoForTurn && liveSource === 'github') {
    // Sticky GitHub file context when the live Files plane is GitHub.
    form.append('active_file_source', 'github');
    form.append('active_file_github_repo', activeRepoForTurn);
    if (chatGithubFilePath?.trim()) {
      form.append('active_file_github_path', chatGithubFilePath.trim());
    }
    if (chatGithubBranch.trim()) {
      form.append('active_file_github_branch', chatGithubBranch.trim());
    }
    if (chatGithubContentSha?.trim()) {
      form.append('active_file_github_sha', chatGithubContentSha.trim());
    }
    if (chatGithubFileContent?.trim()) {
      form.append('active_file_content', chatGithubFileContent.slice(0, 48000));
    }
  }
  if (!form.has('local_fsa_connected') && liveSource === 'local') {
    try {
      const localRoot = await loadPersistedLocalDirectoryHandle();
      if (localRoot) {
        form.append('local_fsa_connected', '1');
        form.append('fsa_root', '1');
      }
    } catch {
      /* ignore */
    }
  }
  // Same priority as active_repo — explorer event wins over stale filesCtx.
  const ghCtxForm = activeRepoForTurn;
  if (ghCtxForm) form.append('github_repo_context', ghCtxForm);

  const activePathForProject =
    (activeFile ? getEditorLightweightPath(activeFile) || activeFile.name || '' : '').trim() ||
    (activeRepoForTurn ? chatGithubFilePath?.trim() : '') ||
    '';
  const projectPayload = buildChatProjectContext({
    githubRepo: ghCtxForm || null,
    branch: (activeFile?.githubBranch || chatGithubBranch || '').trim() || null,
    activeFilePath: activePathForProject || null,
  });
  form.append('project', JSON.stringify(projectPayload));
  form.append('runtime_lane', CHAT_RUNTIME_LANE_FULL_COMPILE);

  const contextEnvelopePayload =
    activeRepoForTurn && chatGithubFilePath?.trim()
      ? buildGithubContextEnvelope({
          conversationId: effectiveConvId,
          workspaceId: sendWorkspaceId || null,
          repo: activeRepoForTurn,
          path: chatGithubFilePath,
          branch: chatGithubBranch,
          content: chatGithubFileContent,
          contentSha: chatGithubContentSha,
          contentTruncated: chatGithubContentTruncated,
          execLane: dockExecLane,
        })
      : null;
  if (contextEnvelopePayload?.focus?.github?.path) {
    form.append('context_envelope', JSON.stringify(contextEnvelopePayload));
  }

}
