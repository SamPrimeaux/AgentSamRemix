import { AUTH_COOKIE_NAME } from '../../auth/constants.js';
import {
  loadAgentSamUserPolicyCached,
  loadMembershipCached,
  readAuthRev,
} from '../permissions/index.js';
import { isLegacySessionId, isEdgeSessionToken } from '../../auth/session-tokens.js';
import { computeAuthCapabilities, trimSessionField } from './fields.js';
import { getSession } from './read.js';
import { mintBrowserSessionToken } from './mint.js';

/** Lazy legacy UUID cookie → edge JWT upgrade (Set-Cookie on response). */
const requestSessionUpgrade = new WeakMap();

/**
 * @param {Request} request
 * @param {any} env
 * @param {{ session?: Record<string, any> | null }} [opts]
 */
export async function primeLegacySessionUpgrade(request, env, opts = {}) {
  if (!request || requestSessionUpgrade.has(request)) return;
  requestSessionUpgrade.set(request, null);

  const cookieHeader = request.headers.get('Cookie') || '';
  const regex = new RegExp(`(?:^|;\\s*)${AUTH_COOKIE_NAME}=([^;]+)`, 'g');
  let match;
  let hasEdge = false;
  let hasLegacy = false;
  while ((match = regex.exec(cookieHeader)) !== null) {
    const raw = trimSessionField(decodeURIComponent(String(match[1] || '')));
    if (!raw) continue;
    if (isEdgeSessionToken(raw)) hasEdge = true;
    else if (isLegacySessionId(raw)) hasLegacy = true;
  }
  if (!hasLegacy || hasEdge) return;

  const session = Object.prototype.hasOwnProperty.call(opts, 'session')
    ? opts.session
    : await getSession(env, request).catch(() => null);
  const userId = trimSessionField(session?.user_id);
  const sessionId = trimSessionField(session?.session_id || session?.id);
  if (!userId || !sessionId) return;

  try {
    const workspaceId = trimSessionField(session?.workspace_id) || null;
    const tenantId = trimSessionField(session?.tenant_id) || null;
    const membership = workspaceId ? await loadMembershipCached(env, userId, workspaceId) : null;
    const policy = await loadAgentSamUserPolicyCached(env, userId, workspaceId || '');
    const authRev = await readAuthRev(env, userId);
    const capabilities = computeAuthCapabilities(membership, policy);
    const sessionToken = await mintBrowserSessionToken(env, {
      sessionId,
      userId,
      tenantId,
      workspaceId,
      email: session?.email,
      personUuid: session?.person_uuid,
      displayName: session?.display_name,
      authRev,
      capabilities,
    });
    requestSessionUpgrade.set(request, sessionToken);
  } catch (error) {
    console.warn('[primeLegacySessionUpgrade]', error?.message ?? error);
  }
}

/**
 * @param {Request} request
 * @returns {string | null}
 */
export function peekSessionUpgradeToken(request) {
  if (!request || !requestSessionUpgrade.has(request)) return null;
  return requestSessionUpgrade.get(request) ?? null;
}
