/**
 * Ambient chat context — identity only.
 *
 * Full IDE/CMS dumps stay out of the prompt. Lean open-workspace awareness
 * Files rail and editor state remain runtime bindings, not prompt-policy prose.
 */

/**
 * Minimal always-on session block (who can act — not what this job is about).
 * @param {Record<string, unknown>|null|undefined} identity
 * @returns {string|null}
 */
export function formatAmbientIdentityForAgent(identity) {
  if (!identity || typeof identity !== 'object') return null;
  const userId = identity.user_id != null ? String(identity.user_id).trim() : '';
  const role = identity.role != null ? String(identity.role).trim() : '';
  const tenantId = identity.tenant_id != null ? String(identity.tenant_id).trim() : '';
  const workspaceId = identity.workspace_id != null ? String(identity.workspace_id).trim() : '';
  const email = identity.email != null ? String(identity.email).trim() : '';
  const credentialLane =
    identity.credential_lane != null
      ? String(identity.credential_lane).trim()
      : 'byok';

  if (!userId && !workspaceId && !tenantId) return null;

  const lines = [
    '[Session identity — who can act. Open Files rail / editor facts live in "What you currently see" when present; answer awareness questions from that block without rediscovering via tools.]',
    `user_id: ${userId || '(none)'}`,
    email ? `email: ${email}` : null,
    `role: ${role || 'user'}`,
    `tenant_id: ${tenantId || '(none)'}`,
    `workspace_id: ${workspaceId || '(none)'}`,
    `credential_lane: ${credentialLane || 'byok'}`,
  ].filter(Boolean);
  return lines.join('\n');
}

/**
 * @deprecated Prefer formatAmbientIdentityForAgent. Kept so callers that still pass
 * IDE packets do not reintroduce place/repo dumps into the prompt.
 * @param {Record<string, unknown>|null|undefined} raw
 * @returns {string|null}
 */
export function formatWorkspaceContextForAgent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  // If a caller accidentally passes an identity-shaped object, format it.
  if (
    raw.user_id ||
    raw.userId ||
    raw.tenant_id ||
    raw.tenantId ||
    raw.workspace_id ||
    raw.workspaceId ||
    raw.credential_lane ||
    raw.credentialLane
  ) {
    return formatAmbientIdentityForAgent({
      user_id: raw.user_id ?? raw.userId,
      email: raw.email,
      role: raw.role,
      tenant_id: raw.tenant_id ?? raw.tenantId,
      workspace_id: raw.workspace_id ?? raw.workspaceId,
      credential_lane: raw.credential_lane ?? raw.credentialLane,
    });
  }
  // IDE / place packets are intentionally not ambient anymore.
  return null;
}

/**
 * @param {unknown} browserContext
 * @param {unknown} body
 * @returns {Record<string, unknown>|null}
 */
export function normalizeWorkspaceContextPacket(browserContext, body) {
  const fromBrowser =
    browserContext && typeof browserContext === 'object'
      ? /** @type {Record<string, unknown>} */ (browserContext).workspaceContext
      : null;
  const fromBody =
    body && typeof body === 'object'
      ? /** @type {Record<string, unknown>} */ (body).workspaceContext
      : null;
  const raw =
    fromBrowser && typeof fromBrowser === 'object'
      ? fromBrowser
      : fromBody && typeof fromBody === 'object'
        ? fromBody
        : null;
  if (!raw || typeof raw !== 'object') return null;

  const openFiles = Array.isArray(raw.openFiles)
    ? raw.openFiles.map((f) => String(f || '').trim()).filter(Boolean).slice(0, 32)
    : [];

  const browserRoot =
    browserContext && typeof browserContext === 'object'
      ? /** @type {Record<string, unknown>} */ (browserContext)
      : null;
  const picked =
    raw?.picked_element ??
    raw?.selected_element ??
    browserRoot?.picked_element ??
    browserRoot?.selected_element ??
    null;

  return {
    activeTab: raw.activeTab != null ? String(raw.activeTab).trim() : '',
    browserUrl: raw.browserUrl != null ? String(raw.browserUrl).trim() : '',
    openFiles,
    plan_id: raw.plan_id != null ? String(raw.plan_id).trim() : null,
    workflow_run_id: raw.workflow_run_id != null ? String(raw.workflow_run_id).trim() : null,
    dashboard_path: raw.dashboard_path != null ? String(raw.dashboard_path).trim() : null,
    dashboard_route_key:
      raw.dashboard_route_key != null ? String(raw.dashboard_route_key).trim() : null,
    dev_server_url: raw.dev_server_url != null ? String(raw.dev_server_url).trim() : null,
    active_file: raw.active_file != null ? String(raw.active_file).trim() : null,
    terminal_tail: Array.isArray(raw.terminal_tail)
      ? raw.terminal_tail.map((l) => String(l || '').trim()).filter(Boolean).slice(-12)
      : null,
    browser_surface:
      raw.browser_surface && typeof raw.browser_surface === 'object' ? raw.browser_surface : null,
    picked_element: picked && typeof picked === 'object' ? picked : null,
    project_slug: raw.project_slug != null ? String(raw.project_slug).trim() : null,
    page_id: raw.page_id != null ? String(raw.page_id).trim() : null,
    studio_panel: raw.studio_panel != null ? String(raw.studio_panel).trim() : null,
    live_session_id: raw.live_session_id != null ? String(raw.live_session_id).trim() : null,
    collab_room: raw.collab_room != null ? String(raw.collab_room).trim() : null,
    bootstrap_cache_key:
      raw.bootstrap_cache_key != null ? String(raw.bootstrap_cache_key).trim() : null,
    preview_url: raw.preview_url != null ? String(raw.preview_url).trim() : null,
    public_domain: raw.public_domain != null ? String(raw.public_domain).trim() : null,
    cms_hosting: raw.cms_hosting != null ? String(raw.cms_hosting).trim() : null,
    api_profile: raw.api_profile != null ? String(raw.api_profile).trim() : null,
    capabilities: Array.isArray(raw.capabilities)
      ? raw.capabilities.map((c) => String(c || '').trim()).filter(Boolean)
      : null,
    r2_bucket: raw.r2_bucket != null ? String(raw.r2_bucket).trim() : null,
    r2_key: raw.r2_key != null ? String(raw.r2_key).trim() : null,
    workspace_id: raw.workspace_id != null ? String(raw.workspace_id).trim() : null,
    workspace_source: raw.workspace_source != null ? String(raw.workspace_source).trim() : null,
    github_repo: raw.github_repo != null ? String(raw.github_repo).trim() : null,
    r2_prefix: raw.r2_prefix != null ? String(raw.r2_prefix).trim() : null,
    root_path: raw.root_path != null ? String(raw.root_path).trim() : null,
    web_search_enabled: raw.web_search_enabled === true,
    antigravity_sandbox_enabled: raw.antigravity_sandbox_enabled === true,
  };
}

/**
 * Append ambient identity only. IDE/CMS/repo packets are never injected here.
 * @param {string} systemPrompt
 * @param {unknown} browserContext
 * @param {unknown} body
 * @param {Record<string, unknown>|null|undefined} [identity]
 */
export function appendAmbientWorkspaceContextToPrompt(systemPrompt, browserContext, body, identity) {
  let out = String(systemPrompt || '');
  if (out.includes('[Session identity')) return out;

  const fromArg =
    identity && typeof identity === 'object'
      ? identity
      : body && typeof body === 'object' && /** @type {Record<string, unknown>} */ (body).ambient_identity
        ? /** @type {Record<string, unknown>} */ (body).ambient_identity
        : null;

  // Never format the IDE workspaceContext packet into the prompt.
  void browserContext;
  const block = formatAmbientIdentityForAgent(
    fromArg && typeof fromArg === 'object'
      ? /** @type {Record<string, unknown>} */ (fromArg)
      : null,
  );
  if (!block) return out;
  return `${out}\n\n## Session\n${block}`;
}

/**
 * @param {Record<string, unknown>|null|undefined} browserContext
 */
export function extractComposerFlagsFromBrowserContext(browserContext) {
  const root =
    browserContext && typeof browserContext === 'object'
      ? /** @type {Record<string, unknown>} */ (browserContext)
      : null;
  if (!root) {
    return { web_search_enabled: false, antigravity_sandbox_enabled: false };
  }
  const ws =
    root.workspaceContext && typeof root.workspaceContext === 'object'
      ? root.workspaceContext
      : root;
  if (!ws || typeof ws !== 'object') {
    return { web_search_enabled: false, antigravity_sandbox_enabled: false };
  }
  return {
    web_search_enabled: ws.web_search_enabled === true,
    antigravity_sandbox_enabled: ws.antigravity_sandbox_enabled === true,
  };
}
