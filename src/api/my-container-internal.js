/**
 * POST /api/internal/my-container/exec — run command in MY_CONTAINER sandbox-v2.
 * Auth: AGENTSAM_BRIDGE_KEY or IAM tunnel infrastructure actor.
 */
import { jsonResponse } from '../core/responses.js'; import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js'; import { getAuthUser } from '../../backend/identity/index.js';
import { userIsTunnelInfraActor } from '../../backend/identity/workspace/authority.js';
import {
  destroyContainerPoolInstance,
  purgeLegacyContainerInstances,
  tryContainerExec,
} from '../../backend/agentsam/sandbox/my-container.js';

/**
 * @param {Request} request
 * @param {any} env
 */
export async function handleMyContainerExec(request, env) {
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

  const out = await tryContainerExec(env, {
    command,
    cwd: body.cwd,
    timeout_ms: body.timeout_ms,
    authUser,
  });

  return jsonResponse(out, out.ok ? 200 : 502);
}

/**
 * POST /api/internal/my-container/purge-legacy — destroy stale DO instance names.
 * Auth: AGENTSAM_BRIDGE_KEY or IAM tunnel infrastructure actor.
 * @param {Request} request
 * @param {any} env
 */
export async function handleMyContainerPurgeLegacy(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const internal = verifyBridgeKey(request, env);
  if (!internal) {
    const authUser = await getAuthUser(request, env);
    if (!authUser || !(await userIsTunnelInfraActor(env, authUser))) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
  }

  let body = {};
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    body = {};
  }

  const names = Array.isArray(body.names) ? body.names.map(String) : undefined;
  const out = await purgeLegacyContainerInstances(env, names);
  return jsonResponse(out, out.ok ? 200 : 207);
}

/**
 * POST /api/internal/my-container/restart-pool — destroy live pool DO (cold start next exec).
 * Auth: AGENTSAM_BRIDGE_KEY or IAM tunnel infrastructure actor. Use after pinning a new container image digest.
 * @param {Request} request
 * @param {any} env
 */
export async function handleMyContainerRestartPool(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const internal = verifyBridgeKey(request, env);
  if (!internal) {
    const authUser = await getAuthUser(request, env);
    if (!authUser || !(await userIsTunnelInfraActor(env, authUser))) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
  }

  const out = await destroyContainerPoolInstance(env);
  return jsonResponse(out, out.ok ? 200 : 502);
}
