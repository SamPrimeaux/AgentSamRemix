/**
 * POST /api/internal/agentsam/workspace-argv
 * MCP thin adapter → canonical runRepositoryIntelligence on the main worker.
 * Auth: AGENTSAM_BRIDGE_KEY (Bearer or X-Internal-Secret).
 * Never accepts a caller-supplied filesystem root, command, or argv.
 */
import { jsonResponse } from '../core/responses.js'; import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js';
import { parseHandlerConfig } from '../../backend/credentials/resolver.js';
import { loadAuthUserById } from '../../backend/identity/users/index.js';
import {
  runRepositoryIntelligence,
  toMcpRepoIntelligenceBody,
  typedWorkspaceArgvParams,
} from '../../backend/agentsam/terminal/workspace-argv.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function isInternalAuthorized(request, env) {
  if (verifyBridgeKey(request, env)) return true;
  const auth = request.headers.get('Authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const bridge = env?.AGENTSAM_BRIDGE_KEY != null ? String(env.AGENTSAM_BRIDGE_KEY).trim() : '';
  if (bridge && bearer === bridge) return true;
  const header = (request.headers.get('X-Internal-Secret') || '').trim();
  if (bridge && header === bridge) return true;
  const mcpTok = env?.MCP_AUTH_TOKEN != null ? String(env.MCP_AUTH_TOKEN).trim() : '';
  if (mcpTok && bearer === mcpTok) return true;
  return false;
}

/**
 * @param {Request} request
 * @param {any} env
 */
export async function handleInternalWorkspaceArgv(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  }
  if (!isInternalAuthorized(request, env)) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }

  const body = await request.json().catch(() => ({}));
  const authIn = body.auth && typeof body.auth === 'object' ? body.auth : {};
  const args = body.args && typeof body.args === 'object' ? body.args : {};

  const workspaceId =
    trim(authIn.workspace_id) ||
    trim(body.workspace_id) ||
    trim(request.headers.get('X-Workspace-Id')) ||
    trim(request.headers.get('X-IAM-Workspace-Id'));
  const userId =
    trim(authIn.user_id) || trim(body.user_id) || trim(request.headers.get('X-User-Id'));
  const tenantId =
    trim(authIn.tenant_id) || trim(body.tenant_id) || trim(request.headers.get('X-Tenant-Id')) || null;
  const toolKey = trim(body.tool_key || body.toolKey);

  if (!workspaceId || !userId) {
    return jsonResponse({ ok: false, error: 'workspace_scope_required' }, 400);
  }
  if (!toolKey) {
    return jsonResponse({ ok: false, error: 'tool_key_required' }, 400);
  }
  if (!env?.DB) {
    return jsonResponse({ ok: false, error: 'db_required' }, 500);
  }

  const row = await env.DB.prepare(
    `SELECT tool_key, handler_type, handler_config, is_active, oauth_visible
       FROM agentsam_tools
      WHERE lower(tool_key) = lower(?)
      LIMIT 1`,
  )
    .bind(toolKey)
    .first();

  if (!row || Number(row.is_active ?? 1) !== 1) {
    return jsonResponse({ ok: false, error: 'tool_inactive_or_missing', tool_key: toolKey }, 404);
  }

  const config = parseHandlerConfig(row.handler_config);
  if (String(config?.dispatcher || '').trim() !== 'workspace_argv') {
    return jsonResponse(
      {
        ok: false,
        error: 'workspace_argv_dispatcher_required',
        tool_key: toolKey,
      },
      400,
    );
  }

  const runContextIn = body.runContext && typeof body.runContext === 'object' ? body.runContext : {};
  const execLane = trim(runContextIn.exec_lane || runContextIn.execLane || body.exec_lane);
  const clientSurface = trim(runContextIn.client_surface || runContextIn.clientSurface) || 'mcp';
  const loadedUser = await loadAuthUserById(env, userId);
  const authUser = loadedUser?.id
    ? loadedUser
    : { id: userId, tenant_id: tenantId, workspace_id: workspaceId };
  const result = await runRepositoryIntelligence({
    env,
    config,
    params: typedWorkspaceArgvParams(args),
    runContext: {
      exec_lane: execLane || null,
      client_surface: clientSurface,
      authUser,
    },
    workspaceId,
    userId,
    tenantId,
    agentRunId: trim(body.agent_run_id) || null,
  });

  const payload = toMcpRepoIntelligenceBody(result, {
    workspaceId: result?.body?.target_workspace_id || workspaceId,
  });
  const status = payload.ok ? 200 : payload.error === 'unauthorized' ? 401 : 400;
  return jsonResponse(payload, status);
}
