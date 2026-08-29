import {
  loadAgentSamUserPolicyCached,
  loadMembershipCached,
  readAuthRev,
} from '../permissions/index.js';
import { computeAuthCapabilities, trimSessionField } from './fields.js';
import { getSession } from './read.js';
import { writeIamSessionToKv } from './kv.js';
import { mintBrowserSessionToken } from './mint.js';
import { resolveRequestWorkspace } from '../workspace/request-resolve.js';

/**
 * Resolve workspace at login through the canonical request workspace policy.
 * @param {*} env
 * @param {object|null} userRow auth_users row
 * @param {{ workspaceId?: string|null }} [opts]
 * @returns {Promise<string|null>}
 */
export async function resolveWorkspaceIdAtLogin(env, userRow, opts = {}) {
  const userId = trimSessionField(userRow?.id);
  const tenantId =
    trimSessionField(userRow?.active_tenant_id) || trimSessionField(userRow?.tenant_id) || null;
  const result = await resolveRequestWorkspace(env, {
    userId,
    tenantId,
    requestedWorkspaceId: opts.workspaceId,
    storedActiveWorkspaceId: userRow?.active_workspace_id,
    authType: 'session',
  });
  return result.id;
}

/**
 * Keep auth_sessions + KV aligned with auth_users.active_workspace_id.
 * @param {*} env
 * @param {Request} request
 * @param {string} userId auth_users.id
 * @param {string} workspaceId
 */
export async function syncSessionWorkspaceId(env, request, userId, workspaceId) {
  const ws = trimSessionField(workspaceId);
  const uid = trimSessionField(userId);
  if (!ws || !uid || !env?.DB) return null;

  const session = await getSession(env, request).catch(() => null);
  const sessionId = trimSessionField(session?.session_id || session?.id);
  if (!sessionId) return null;

  try {
    await env.DB.prepare(
      `UPDATE auth_sessions
       SET workspace_id = ?, last_active_at = ?
       WHERE id = ? AND user_id = ?`,
    )
      .bind(ws, Date.now(), sessionId, uid)
      .run();
  } catch {}

  const tenantId = trimSessionField(session?.tenant_id) || null;
  if (env.SESSION_CACHE && session) {
    await writeIamSessionToKv(env, sessionId, uid, tenantId, session.expires_at ?? null, {
      workspaceId: ws,
      personUuid: session.person_uuid,
      supabaseUserId: session.supabase_user_id,
      email: session.email,
      provider: session.provider,
      displayName: session.display_name,
      avatarUrl: session.avatar_url,
      providerSubject: session.provider_subject,
      workSessionId: session.work_session_id,
      lastActiveAt: Date.now(),
    });
  }

  try {
    const membership = await loadMembershipCached(env, uid, ws);
    const policy = await loadAgentSamUserPolicyCached(env, uid, ws);
    const authRev = await readAuthRev(env, uid);
    const capabilities = computeAuthCapabilities(membership, policy);
    const sessionToken = await mintBrowserSessionToken(env, {
      sessionId,
      userId: uid,
      tenantId,
      workspaceId: ws,
      email: session?.email,
      personUuid: session?.person_uuid,
      displayName: session?.display_name,
      authRev,
      capabilities,
    });
    return { sessionId, sessionToken };
  } catch (error) {
    console.warn('[syncSessionWorkspaceId] remint failed', error?.message ?? error);
    return null;
  }
}
