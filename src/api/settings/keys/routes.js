/**
 * Keys & Secrets HTTP router — path dispatch only; domain logic in backend/credentials/service.js
 */
import { jsonResponse } from '../../../core/auth.js';
import {
  auditKeys,
  createKey,
  getHints,
  listCloudflareD1,
  listCloudflareZonesRoute,
  listKeys,
  patchKey,
  putPtyDefaults,
  revealKey,
  revokeKey,
  rotateKey,
  selectCloudflareD1,
  validateKey,
} from '../../../../backend/credentials/service.js';

/** Canonical /api/settings/keys paths; legacy /api/settings/api-keys maps here. */
function normalizeKeysPath(pathLower) {
  if (pathLower.startsWith('/api/settings/api-keys')) {
    return pathLower.replace('/api/settings/api-keys', '/api/settings/keys');
  }
  return pathLower;
}

function respond(result) {
  if (!result) return null;
  if (result instanceof Response) return result;
  const status = Number(result.status) || 200;
  return jsonResponse(result.body, status);
}

/**
 * @returns {Promise<Response|null>}
 */
export async function handleSettingsKeysApi(request, env, ctx, authUser, url, pathLower, method) {
  void ctx;
  const keysPath = normalizeKeysPath(pathLower);
  if (!keysPath.startsWith('/api/settings/keys')) return null;

  if (keysPath === '/api/settings/keys/validate' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    return respond(await validateKey(env, authUser, request, body, null));
  }

  if (keysPath === '/api/settings/keys' && method === 'GET') {
    return respond(await listKeys(env, authUser, request, url));
  }

  if (keysPath === '/api/settings/keys' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    return respond(await createKey(env, authUser, request, body));
  }

  if (keysPath === '/api/settings/keys/audit' && method === 'GET') {
    return respond(await auditKeys(env, authUser, request, url));
  }

  if (keysPath === '/api/settings/keys/hints' && method === 'GET') {
    return respond(await getHints(env, authUser, request));
  }

  if (keysPath === '/api/settings/keys/pty-defaults' && method === 'PUT') {
    const body = await request.json().catch(() => ({}));
    return respond(await putPtyDefaults(env, authUser, request, body));
  }

  if (keysPath === '/api/settings/keys/cloudflare/d1' && method === 'GET') {
    return respond(await listCloudflareD1(env, authUser, request, url));
  }

  if (keysPath === '/api/settings/keys/cloudflare/zones' && method === 'GET') {
    return respond(await listCloudflareZonesRoute(env, authUser, request));
  }

  if (keysPath === '/api/settings/keys/cloudflare/d1/select' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    return respond(await selectCloudflareD1(env, authUser, request, body));
  }

  const validateIdMatch = keysPath.match(/^\/api\/settings\/keys\/([^/]+)\/validate$/);
  if (validateIdMatch && method === 'POST') {
    const id = decodeURIComponent(validateIdMatch[1] || '').trim();
    if (!id) return jsonResponse({ error: 'id required' }, 400);
    const body = await request.json().catch(() => ({}));
    return respond(await validateKey(env, authUser, request, body, id));
  }

  const revealMatch = keysPath.match(/^\/api\/settings\/keys\/([^/]+)\/reveal$/);
  if (revealMatch && method === 'POST') {
    const id = decodeURIComponent(revealMatch[1] || '').trim();
    if (!id) return jsonResponse({ error: 'id required' }, 400);
    return respond(await revealKey(env, authUser, request, id));
  }

  const rotateMatch = keysPath.match(/^\/api\/settings\/keys\/([^/]+)\/rotate$/);
  if (rotateMatch && method === 'POST') {
    const id = decodeURIComponent(rotateMatch[1] || '').trim();
    if (!id) return jsonResponse({ error: 'id required' }, 400);
    const body = await request.json().catch(() => ({}));
    return respond(await rotateKey(env, authUser, request, id, body));
  }

  const idMatch = keysPath.match(/^\/api\/settings\/keys\/([^/]+)$/);
  if (idMatch) {
    const id = decodeURIComponent(idMatch[1] || '').trim();
    if (!id) return jsonResponse({ error: 'id required' }, 400);
    if (method === 'PATCH') {
      const body = await request.json().catch(() => ({}));
      return respond(await patchKey(env, authUser, request, id, body));
    }
    if (method === 'DELETE') return respond(await revokeKey(env, authUser, request, id));
  }

  return null;
}

/** @deprecated alias — use handleSettingsKeysApi */
export const handleSettingsApiKeysApi = handleSettingsKeysApi;
