/**
 * Centralized mcpRuntimeContext builder — camelCase + snake_case pairs in one place.
 */

/**
 * @param {{
 *   userId: string|null|undefined,
 *   tenantId: string|null|undefined,
 *   workspaceId: string|null|undefined,
 *   sessionId: string|null|undefined,
 *   sessionAuthUser: any,
 *   profile: any,
 *   message: string,
 *   turnDecision: any,
 *   turnDecisionId?: string|null,
 *   fsaRootActive: boolean,
 *   filesSource: string,
 *   body: Record<string, unknown>,
 *   databaseSurfaceRaw: any,
 *   browserContextPayload: any,
 *   githubRepoCtx: string,
 *   scopedProjectRef: string|null|undefined,
 *   projectExecBindings: any,
 *   clientSurface: string|null,
 *   execLane: string|null,
 *   mayUsePrivilegedTerminal: boolean,
 *   allowlistKeySet?: Set<string>|null,
 * }} p
 */
export function buildMcpRuntimeContext(p) {
  const profile = p.profile || {};
  const body = p.body || {};
  const filesSource = p.filesSource || '';
  const filesSourceIsGithub = filesSource === 'github';
  const fsaRootActive = p.fsaRootActive === true;
  const githubRepoCtx = String(p.githubRepoCtx || '').trim();
  const scopedProjectRef =
    p.scopedProjectRef != null ? String(p.scopedProjectRef).trim() : '';
  const projectExecBindings =
    p.projectExecBindings && typeof p.projectExecBindings === 'object'
      ? p.projectExecBindings
      : null;

  const filesR2Bucket =
    String(body.files_r2_bucket || body.filesR2Bucket || '').trim() ||
    profile._files_r2_bucket ||
    null;
  const filesR2Prefix =
    String(body.files_r2_prefix || body.filesR2Prefix || '').trim() ||
    profile._files_r2_prefix ||
    null;
  const filesSourcePath =
    String(body.files_source_path || body.filesSourcePath || '').trim() ||
    profile._files_source_path ||
    null;

  /** @type {Record<string, unknown>} */
  const ctx = {
    userId: p.userId,
    tenantId: p.tenantId,
    workspaceId: p.workspaceId,
    sessionId: p.sessionId,
    authUser: p.sessionAuthUser ?? null,
    taskType: profile.routing_task_type,
    routeKey: profile.refined_route_key || profile.mode,
    writePolicy: profile.write_policy,
    userMessage: p.message,
    runtimeProfile: { ...profile },
    fsa_root: profile._fsa_root === true || fsaRootActive,
    files_source: filesSource || profile._files_source || null,
    files_source_path: filesSourcePath,
    files_r2_bucket: filesR2Bucket,
    filesR2Bucket,
    files_r2_prefix: filesR2Prefix,
    filesR2Prefix,
    r2_bucket: filesR2Bucket,
    r2_prefix: filesR2Prefix,
    mayUsePrivilegedTerminal: p.mayUsePrivilegedTerminal === true,
    mode: profile.mode ?? null,
    agent_mode: profile.mode ?? null,
    source_client: 'internal_agent',
    sourceClient: 'internal_agent',
    modelKey: profile.model_key ?? profile.modelKey ?? null,
    model_key: profile.model_key ?? profile.modelKey ?? null,
    routingArmId: profile.routing_arm_id ?? profile.routingArmId ?? null,
    routing_arm_id: profile.routing_arm_id ?? profile.routingArmId ?? null,
  };

  if (p.turnDecision && typeof p.turnDecision === 'object') {
    ctx.turnDecision = p.turnDecision;
    ctx.precomputedTurnDecision = p.turnDecision;
    ctx.turnDecisionId = p.turnDecision.decisionId || p.turnDecisionId || null;
  }

  if (p.databaseSurfaceRaw) {
    ctx.databaseContext = p.databaseSurfaceRaw;
    ctx.database_context = p.databaseSurfaceRaw;
  }
  if (p.browserContextPayload && typeof p.browserContextPayload === 'object') {
    ctx.browserContext = p.browserContextPayload;
    ctx.browser_context = p.browserContextPayload;
  }

  if (githubRepoCtx && !fsaRootActive && (!filesSource || filesSourceIsGithub)) {
    Object.assign(ctx, githubAliasPair(githubRepoCtx));
  }

  if (scopedProjectRef) {
    ctx.session_project_id = scopedProjectRef;
    ctx.project_id = scopedProjectRef;
    ctx.projectId = scopedProjectRef;
  }

  if (projectExecBindings) {
    const bindingProjectId = String(
      projectExecBindings.projectId || projectExecBindings.project_id || '',
    ).trim();
    const bindingWorkspaceId = String(
      projectExecBindings.workspaceId || projectExecBindings.workspace_id || '',
    ).trim();
    if (!scopedProjectRef && bindingProjectId) {
      ctx.session_project_id = bindingProjectId;
      ctx.project_id = bindingProjectId;
      ctx.projectId = bindingProjectId;
    }
    if (bindingWorkspaceId) {
      ctx.project_execution_workspace_id = bindingWorkspaceId;
      ctx.execution_workspace_id = bindingWorkspaceId;
    }
  }

  if (p.clientSurface) {
    ctx.client_surface = p.clientSurface;
    ctx.clientSurface = p.clientSurface;
  }
  if (p.execLane) {
    ctx.exec_lane = p.execLane;
    ctx.execLane = p.execLane;
  }
  if (p.allowlistKeySet instanceof Set && p.allowlistKeySet.size) {
    ctx.allowlistKeySet = p.allowlistKeySet;
  }

  return ctx;
}

function githubAliasPair(repo) {
  const r = String(repo || '').trim();
  return {
    selectedGithubRepoContext: r,
    github_repo_context: r,
    githubRepoContext: r,
    active_repo: r,
    activeRepo: r,
    github_repo: r,
    githubRepo: r,
  };
}
