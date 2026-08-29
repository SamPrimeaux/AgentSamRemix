/**
 * POST /api/internal/trigger-workers-build
 * Triggers per-workspace Workers Builds Deploy Hook URL.
 * Auth: AGENTSAM_BRIDGE_KEY, MCP OAuth / session bearer (same as /api/agent/git/publish).
 */
import { jsonResponse } from '../core/responses.js'; import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js'; import { authUserFromRequest } from '../../backend/identity/index.js';
import { postWorkersDeployHook, redactDeployHookUrl } from '../../backend/http/agentsam/routes/deploy-hook-runtime.js';
import { resolveCronWorkspaceId } from '../../backend/jobs/cron-tenant.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function verifyBridgeOrInternal(request, env) {
  if (verifyBridgeKey(request, env)) return true;
  const auth = request.headers.get('Authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const bridge = trim(env?.AGENTSAM_BRIDGE_KEY);
  return Boolean(bridge && bearer && bearer === bridge);
}

export async function handleTriggerWorkersBuild(request, env, ctx) {
  void ctx;
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const internalOk = verifyBridgeOrInternal(request, env);
  let authUser = null;
  if (!internalOk) {
    authUser = await authUserFromRequest(request, env);
    if (!authUser?.id) {
      return jsonResponse(
        {
          error: 'Unauthorized',
          hint: 'Use X-Internal-Secret, AGENTSAM_BRIDGE_KEY, MCP OAuth bearer, or POST /api/agent/git/publish with session',
        },
        401,
      );
    }
  }

  let workspaceId =
    trim(body.workspace_id) ||
    trim(body.workspaceId) ||
    trim(authUser?.active_workspace_id) ||
    trim(authUser?.workspace_id) ||
    '';
  if (!workspaceId && internalOk) {
    workspaceId = (await resolveCronWorkspaceId(env)) || '';
  }
  if (!workspaceId) {
    return jsonResponse({ error: 'workspace_id_required' }, 400);
  }
  const workerName = trim(body.worker_name) || trim(body.workerName) || null;

  if (authUser?.id && env?.DB) {
    try {
      const row = await env.DB.prepare(
        'SELECT id FROM agentsam_workspace WHERE id = ? LIMIT 1',
      )
        .bind(workspaceId)
        .first();
      if (!row) {
        return jsonResponse({ error: 'workspace not found', workspace_id: workspaceId }, 404);
      }
    } catch {
      /* non-fatal */
    }
  }

  const result = await postWorkersDeployHook(env, { workspaceId, workerName });
  if (result.error === 'deploy_hook_url not configured') {
    return jsonResponse({ error: result.error, workspace_id: workspaceId }, 503);
  }
  if (result.error && result.status === 0) {
    return jsonResponse({ error: result.error, workspace_id: workspaceId }, 400);
  }

  const buildUuid = result.json?.result?.build_uuid ?? result.json?.build_uuid ?? null;
  const httpOk = result.ok ? 200 : 502;
  return jsonResponse(
    {
      ok: result.ok,
      workspace_id: workspaceId,
      worker_name: workerName,
      deploy_hook_url_redacted: redactDeployHookUrl(result.deploy_hook_url),
      deploy_hook_source: result.source ?? null,
      build_uuid: buildUuid,
      http_status: result.status,
      cloudflare: result.json ?? null,
      detail: result.raw ?? null,
      error: result.error ?? null,
    },
    httpOk,
  );
}
