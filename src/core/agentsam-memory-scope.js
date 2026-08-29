/**
 * Memory semantic scope vs transport provenance.
 * Transport (MCP bridge workspace) must never become semantic scope.
 */

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * Resolve auth from MCP/workspace context — never from agent args for user/tenant.
 * @param {Record<string, unknown>} env
 * @param {Record<string, unknown>} workspace
 */
export async function resolveMemoryAuth(env, workspace) {
  const tenantId = trim(workspace?.tenant_id);
  const userId = trim(workspace?.user_id);
  const workspaceId = trim(workspace?.workspace_id) || null;
  return {
    tenant_id: tenantId,
    user_id: userId,
    workspace_id: workspaceId,
  };
}

/**
 * MCP transport silos — suffix convention, not enumerated workspace ids.
 * @param {string} workspaceKey
 */
export function isTransportWorkspaceKey(workspaceKey) {
  const k = trim(workspaceKey);
  if (!k.startsWith('ws_')) return false;
  const bareMcp = `ws_${'mcp'}`;
  return k.endsWith('_mcp_server') || k.endsWith('_mcp') || k === bareMcp;
}

/**
 * Infer chatgpt from external client key
 * @param {Record<string, unknown>} workspace
 * @param {Record<string, unknown>} args
 */
export function resolveSourceClient(workspace = {}, args = {}) {
  const explicit = trim(args.source_client || args.client || args.external_client_key);
  if (explicit) return explicit.slice(0, 64);
  const ext = trim(workspace.external_client_key || workspace.oauth_client_id);
  if (/chatgpt|openai/i.test(ext)) return 'chatgpt';
  if (/claude|anthropic/i.test(ext)) return 'claude';
  if (/cursor/i.test(ext)) return 'cursor';
  if (trim(workspace.token_id) === 'bridge') return 'mcp_bridge';
  if (trim(workspace.workspace_id) && isTransportWorkspaceKey(workspace.workspace_id)) {
    return 'mcp';
  }
  return 'dashboard';
}

/**
 * Resolve semantic scope for a memory write/search.
 * Never uses transport MCP workspace as semantic project scope.
 *
 * @param {{
 *   auth: { tenant_id: string, user_id: string, workspace_id?: string|null, authorized_workspaces?: string[] },
 *   args?: Record<string, unknown>,
 *   env?: any,
 * }} opts
 */
export async function resolveMemorySemanticScope(opts = {}) {
  const auth = opts.auth || {};
  const args = opts.args || {};
  const errors = [];
  const transportWorkspaceKey =
    trim(args.transport_workspace_key) ||
    (isTransportWorkspaceKey(auth.workspace_id) ? trim(auth.workspace_id) : null) ||
    (isTransportWorkspaceKey(args.workspace_id) ? trim(args.workspace_id) : null);

  const sourceClient = resolveSourceClient(
    { ...auth, workspace_id: auth.workspace_id, token_id: args.token_id, external_client_key: args.external_client_key },
    args,
  );

  // Agent-supplied tenant/user already rejected in draftMemoryCommit.
  const requestedProject =
    trim(args.active_project_workspace_key) ||
    trim(args.project_workspace_id) ||
    trim(args.semantic_workspace_id) ||
    (!isTransportWorkspaceKey(args.workspace_id) ? trim(args.workspace_id) : '') ||
    (!isTransportWorkspaceKey(auth.workspace_id) ? trim(auth.workspace_id) : '');

  let scopeType = trim(args.scope_type) || 'user';
  let scopeId = trim(args.scope_id) || trim(auth.user_id);
  let activeProjectWorkspaceKey = requestedProject || null;

  // Preferences default to user scope
  const memType = trim(args.memory_type).toLowerCase();
  if (memType === 'preference' && !trim(args.scope_type)) {
    scopeType = 'user';
    scopeId = trim(auth.user_id);
  }
  if (isTransportWorkspaceKey(activeProjectWorkspaceKey)) {
    errors.push('transport_workspace_cannot_be_semantic_scope');
    activeProjectWorkspaceKey = null;
  }

  if (!activeProjectWorkspaceKey) {
    errors.push('workspace_id_required');
  }

  // Every project workspace must be authorized by membership or an explicit grant.
  if (activeProjectWorkspaceKey && opts.env?.DB && auth.user_id) {
    try {
      const member = await opts.env.DB.prepare(
        `SELECT 1 AS ok FROM workspace_members
          WHERE user_id = ? AND workspace_id = ? AND COALESCE(status,'active') = 'active'
          LIMIT 1`,
      )
        .bind(auth.user_id, activeProjectWorkspaceKey)
        .first();
      if (!member && !(auth.authorized_workspaces || []).includes(activeProjectWorkspaceKey)) {
        errors.push('workspace_not_authorized');
      }
    } catch {
      /* membership table may vary */
    }
  }

  // Require UUID mapping when projecting
  let supabaseWorkspaceId = null;
  if (opts.env?.DB && activeProjectWorkspaceKey) {
    try {
      const row = await opts.env.DB.prepare(
        `SELECT supabase_workspace_id FROM agentsam_workspace WHERE id = ? LIMIT 1`,
      )
        .bind(activeProjectWorkspaceKey)
        .first();
      supabaseWorkspaceId = trim(row?.supabase_workspace_id) || null;
      if (!supabaseWorkspaceId) errors.push('workspace_uuid_mapping_missing');
    } catch {
      errors.push('workspace_uuid_lookup_failed');
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    transport_workspace_key: transportWorkspaceKey,
    source_client: sourceClient,
    authenticated_actor_id: trim(auth.user_id),
    scope_type: scopeType,
    scope_id: scopeId,
    active_project_workspace_key: activeProjectWorkspaceKey,
    /** @deprecated alias — semantic project workspace stored on row.workspace_id */
    workspace_id: activeProjectWorkspaceKey,
    supabase_workspace_id: supabaseWorkspaceId,
  };
}
