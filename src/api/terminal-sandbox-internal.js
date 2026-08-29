/**
 * POST /api/internal/terminal/sandbox/exec — per-user CF Container sandbox (MCP + bridge).
 * Auth: AGENTSAM_BRIDGE_KEY or IAM tunnel infrastructure actor.
 */
import { jsonResponse } from '../core/responses.js'; import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js'; import { getAuthUser } from '../../backend/identity/index.js';
import { userIsTunnelInfraActor } from '../../backend/identity/workspace/authority.js';
import { runMcpZoneSandboxCommand } from '../../backend/agentsam/mcp/sandbox-exec.js';

/**
 * @param {Request} request
 * @param {any} env
 */
export async function handleTerminalSandboxExec(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const internal = verifyBridgeKey(request, env);
  let authUser = null;
  if (!internal) {
    authUser = await getAuthUser(request, env);
    if (!authUser || !(await userIsTunnelInfraActor(env, authUser))) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json' }, 400);
  }

  const command = String(body.command || '').trim();
  if (!command) {
    return jsonResponse({ ok: false, error: 'command_required' }, 400);
  }

  const zoneSlugRaw = body.zone_slug ?? body.zoneSlug ?? null;
  const userId = String(body.user_id || body.userId || authUser?.id || '').trim() || null;
  const username = String(body.username || body.user_name || '').trim() || null;
  const workspaceId =
    String(body.workspace_id || body.workspaceId || authUser?.workspace_id || '').trim() || null;
  const tenantId =
    String(body.tenant_id || body.tenantId || authUser?.tenant_id || '').trim() || null;

  if (!zoneSlugRaw && !userId && !username && !workspaceId) {
    return jsonResponse(
      { ok: false, error: 'zone_slug_or_user_required', user_message: 'Pass zone_slug (username), user_id, or workspace_id.' },
      400,
    );
  }

  // MCP internal calls authenticate via AGENTSAM_BRIDGE_KEY and pass user/workspace in the body.
  // Without synthesizing authUser, CLOUDFLARE_API_TOKEN is never injected into the sandbox.
  if (!authUser && userId) {
    authUser = {
      id: userId,
      user_id: userId,
      tenant_id: tenantId,
      workspace_id: workspaceId,
    };
  } else if (authUser) {
    authUser = {
      ...authUser,
      id: authUser.id || userId,
      user_id: authUser.user_id || authUser.id || userId,
      tenant_id: authUser.tenant_id || tenantId,
      workspace_id: authUser.workspace_id || workspaceId,
    };
  }

  const sb = await runMcpZoneSandboxCommand(env, request, {
    command,
    zoneSlug: zoneSlugRaw,
    tenantId,
    userId,
    username,
    workspaceId,
    sessionId: body.session_id ?? body.sessionId ?? null,
    config: body.config && typeof body.config === 'object' ? body.config : { target_type: 'container' },
    language: body.language,
    path: body.path ?? body.cwd,
    authUser,
  });

  return jsonResponse(
    {
      ok: sb.ok,
      error: sb.error || null,
      ...sb.body,
    },
    sb.ok ? 200 : 502,
  );
}
