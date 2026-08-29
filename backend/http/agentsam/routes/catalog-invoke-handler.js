/**
 * POST catalog-invoke — in-app agentsam_tools dispatch (same path as agent chat tools).
 * Mounted at /api/mcp/catalog-invoke and /api/agent/catalog-invoke on the main worker.
 *
 * CRITICAL: human catalog requests never receive service-owned platform credentials.
 */
import { jsonResponse } from '../shared.js';
import { getAuthUser, resolveIdentityOptional } from '../../../identity/resolve-identity.js';
import { dispatchByToolCode } from './dispatch-by-tool-code.js';

/**
 * @param {Request} request
 * @param {any} env
 * @param {ExecutionContext} [ctx]
 */
export async function handleCatalogInvokeApi(request, env, ctx) {
  if ((request.method || 'GET').toUpperCase() !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const body = await request.json().catch(() => ({}));
  const toolName = String(body.tool_name || body.tool || body.tool_key || '').trim();
  const args =
    body.arguments && typeof body.arguments === 'object'
      ? body.arguments
      : body.params && typeof body.params === 'object'
        ? body.params
        : body.args && typeof body.args === 'object'
          ? body.args
          : {};

  if (!toolName) return jsonResponse({ error: 'tool_name required' }, 400);

  const authUser = await getAuthUser(request, env);
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

  const identity = await resolveIdentityOptional(request, env).catch(() => null);

  const workspaceId =
    identity?.workspace?.id != null && String(identity.workspace.id).trim() !== ''
      ? String(identity.workspace.id).trim()
      : authUser.workspace_id != null
        ? String(authUser.workspace_id).trim()
        : '';
  const userId =
    identity?.user?.id != null && String(identity.user.id).trim() !== ''
      ? String(identity.user.id).trim()
      : authUser?.id != null
        ? String(authUser.id).trim()
        : '';
  const tenantId =
    identity?.tenant?.id != null && String(identity.tenant.id).trim() !== ''
      ? String(identity.tenant.id).trim()
      : authUser.tenant_id != null
        ? String(authUser.tenant_id).trim()
        : '';

  if (!workspaceId || !userId) {
    return jsonResponse({ error: 'WORKSPACE_CONTEXT_MISSING' }, 400);
  }

  const conversationId =
    body.conversation_id != null && String(body.conversation_id).trim() !== ''
      ? String(body.conversation_id).trim()
      : body.session_id != null && String(body.session_id).trim() !== ''
        ? String(body.session_id).trim()
        : body.conversationId != null && String(body.conversationId).trim() !== ''
          ? String(body.conversationId).trim()
          : null;
  const agentRunId =
    body.agent_run_id != null && String(body.agent_run_id).trim() !== ''
      ? String(body.agent_run_id).trim()
      : body.agentRunId != null && String(body.agentRunId).trim() !== ''
        ? String(body.agentRunId).trim()
        : null;

  const catalogOut = await dispatchByToolCode(env, toolName, args, {
    tenantId,
    userId,
    workspaceId,
    authUser,
    request,
    ctx,
    client_surface: 'mcp',
    clientSurface: 'mcp',
    source_tool: 'mcp_catalog_invoke',
    sourceTool: 'mcp_catalog_invoke',
    conversationId,
    conversation_id: conversationId,
    sessionId: conversationId,
    agentRunId,
    agent_run_id: agentRunId,
    // This is a human-initiated request. Service-owned credentials are never
    // a fallback for it; internal jobs must mark their own call explicitly.
    isOperatorCall: false,
    isInternalAgent: false,
  });

  if (catalogOut?.ok === false) {
    return jsonResponse(
      {
        ok: false,
        error: catalogOut.error ?? 'dispatch_failed',
        tool_key: catalogOut.tool_key ?? toolName,
        body: catalogOut.body ?? null,
      },
      422,
    );
  }

  return jsonResponse({
    ok: true,
    result: catalogOut.result ?? catalogOut,
    tool_key: catalogOut.tool_key ?? toolName,
    auth_source: catalogOut.auth_source ?? null,
  });
}
