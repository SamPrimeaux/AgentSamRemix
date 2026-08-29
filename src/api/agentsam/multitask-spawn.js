/**
 * Multitask spawn + status HTTP handlers.
 * - Session: POST/GET under /api/agentsam/*
 * - Internal (MCP bridge): POST under /api/internal/agentsam/*
 */

import { jsonResponse } from '../../core/responses.js'; import { verifyBridgeKey } from '../../../backend/auth/bridge-key-auth.js'; import { getAuthUser } from '../../../backend/identity/index.js';
import {
  acceptMultitaskSpawn,
  getMultitaskStatus,
  cancelMultitaskFanout,
} from '../../../backend/agentsam/runtime/spawn/orchestrator.js';

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

function scopeFromBody(body, headers) {
  const authIn = body?.auth && typeof body.auth === 'object' ? body.auth : {};
  return {
    userId:
      trim(authIn.user_id) ||
      trim(body?.user_id) ||
      trim(headers.get('X-User-Id')),
    workspaceId:
      trim(authIn.workspace_id) ||
      trim(body?.workspace_id) ||
      trim(headers.get('X-Workspace-Id')) ||
      trim(headers.get('X-IAM-Workspace-Id')),
    tenantId:
      trim(authIn.tenant_id) ||
      trim(body?.tenant_id) ||
      trim(headers.get('X-Tenant-Id')) ||
      null,
    conversationId: trim(body?.conversation_id) || null,
    sessionId: trim(body?.session_id) || null,
  };
}

/**
 * POST /api/agentsam/multitask-spawn (session) or /api/internal/agentsam/multitask-spawn
 */
export async function handleMultitaskSpawn(request, env, ctx, opts = {}) {
  if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);

  const internal = opts.internal === true;
  let userId = '';
  let workspaceId = '';
  let tenantId = null;
  let conversationId = null;
  let sessionId = null;

  const body = await request.json().catch(() => ({}));

  if (internal) {
    if (!isInternalAuthorized(request, env)) {
      return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
    }
    const scope = scopeFromBody(body, request.headers);
    userId = scope.userId;
    workspaceId = scope.workspaceId;
    tenantId = scope.tenantId;
    conversationId = scope.conversationId;
    sessionId = scope.sessionId;
  } else {
    const authUser = await getAuthUser(request, env);
    if (!authUser?.id) return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
    userId = String(authUser.id).trim();
    workspaceId =
      trim(body.workspace_id) ||
      trim(request.headers.get('X-Workspace-Id')) ||
      trim(authUser.default_workspace_id) ||
      '';
    tenantId =
      trim(body.tenant_id) ||
      (authUser.tenant_id != null ? String(authUser.tenant_id).trim() : null);
    conversationId = trim(body.conversation_id) || null;
    sessionId = trim(body.session_id) || null;
  }

  if (!userId || !workspaceId) {
    return jsonResponse({ ok: false, error: 'user_id_and_workspace_id_required' }, 400);
  }

  const args = body.args && typeof body.args === 'object' ? body.args : body;
  conversationId =
    conversationId ||
    trim(args.conversation_id) ||
    trim(args.conversationId) ||
    null;
  sessionId = sessionId || trim(args.session_id) || trim(args.sessionId) || null;
  const out = await acceptMultitaskSpawn(env, ctx || { waitUntil() {} }, {
    userId,
    workspaceId,
    tenantId,
    conversationId,
    sessionId,
    lanes: args.lanes,
    merge: args.merge || args.merge_strategy,
    parentRunId: args.parent_run_id || args.parentRunId,
    costCapUsd: args.cost_cap_usd ?? args.costCapUsd,
    laneCostCapUsd: args.lane_cost_cap_usd ?? args.laneCostCapUsd,
    timeoutSeconds: args.timeout_seconds ?? args.timeoutSeconds,
    laneTimeoutSeconds: args.lane_timeout_seconds ?? args.laneTimeoutSeconds,
  });

  const status = out.ok ? 200 : out.error === 'subagent_spawn_disabled' ? 403 : 400;
  return jsonResponse(out, status);
}

/**
 * GET/POST /api/agentsam/multitask-status or POST /api/internal/agentsam/multitask-status
 */
export async function handleMultitaskStatus(request, env, opts = {}) {
  const method = (request.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  }

  const internal = opts.internal === true;
  const url = new URL(request.url);
  let body = {};
  if (method === 'POST') {
    body = await request.json().catch(() => ({}));
  }

  let userId = '';
  let workspaceId = '';
  let spawnJobId = '';

  if (internal) {
    if (!isInternalAuthorized(request, env)) {
      return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
    }
    const scope = scopeFromBody(body, request.headers);
    userId = scope.userId;
    workspaceId = scope.workspaceId;
    const args = body.args && typeof body.args === 'object' ? body.args : body;
    spawnJobId =
      trim(args.spawn_job_id) ||
      trim(args.fanout_id) ||
      trim(args.spawnJobId) ||
      trim(url.searchParams.get('spawn_job_id')) ||
      trim(url.searchParams.get('fanout_id'));
  } else {
    const authUser = await getAuthUser(request, env);
    if (!authUser?.id) return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
    userId = String(authUser.id).trim();
    workspaceId =
      trim(body.workspace_id) ||
      trim(url.searchParams.get('workspace_id')) ||
      trim(request.headers.get('X-Workspace-Id')) ||
      trim(authUser.default_workspace_id) ||
      '';
    spawnJobId =
      trim(body.spawn_job_id) ||
      trim(body.fanout_id) ||
      trim(url.searchParams.get('spawn_job_id')) ||
      trim(url.searchParams.get('fanout_id'));
  }

  if (!spawnJobId) {
    return jsonResponse({ ok: false, error: 'spawn_job_id_required' }, 400);
  }

  const out = await getMultitaskStatus(env, {
    userId,
    workspaceId,
    spawnJobId,
  });
  const status = out.ok ? 200 : out.error === 'forbidden' ? 403 : out.error === 'spawn_job_not_found' ? 404 : 400;
  return jsonResponse(out, status);
}

/**
 * POST /api/agentsam/multitask-cancel or /api/internal/agentsam/multitask-cancel
 * Force-stop parent + all child lanes (terminal cancelled, not soft-flag-only).
 */
export async function handleMultitaskCancel(request, env, opts = {}) {
  if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);

  const internal = opts.internal === true;
  const body = await request.json().catch(() => ({}));
  let userId = '';
  let workspaceId = '';
  let spawnJobId = '';
  let reason = '';

  if (internal) {
    if (!isInternalAuthorized(request, env)) {
      return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
    }
    const scope = scopeFromBody(body, request.headers);
    userId = scope.userId;
    workspaceId = scope.workspaceId;
    const args = body.args && typeof body.args === 'object' ? body.args : body;
    spawnJobId =
      trim(args.spawn_job_id) ||
      trim(args.fanout_id) ||
      trim(args.spawnJobId) ||
      trim(body.spawn_job_id) ||
      trim(body.fanout_id);
    reason = trim(args.reason || body.reason);
  } else {
    const authUser = await getAuthUser(request, env);
    if (!authUser?.id) return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
    userId = String(authUser.id).trim();
    workspaceId =
      trim(body.workspace_id) ||
      trim(request.headers.get('X-Workspace-Id')) ||
      trim(authUser.default_workspace_id) ||
      '';
    spawnJobId = trim(body.spawn_job_id) || trim(body.fanout_id);
    reason = trim(body.reason);
  }

  if (!userId || !workspaceId) {
    return jsonResponse({ ok: false, error: 'user_id_and_workspace_id_required' }, 400);
  }
  if (!spawnJobId) {
    return jsonResponse({ ok: false, error: 'spawn_job_id_required' }, 400);
  }

  const out = await cancelMultitaskFanout(env, {
    userId,
    workspaceId,
    spawnJobId,
    reason: reason || 'operator_cancelled',
  });
  const status =
    out.ok ? 200 : out.error === 'forbidden' ? 403 : out.error === 'spawn_job_not_found' ? 404 : 400;
  return jsonResponse(out, status);
}
