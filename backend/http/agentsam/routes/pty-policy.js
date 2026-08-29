/**
 * D1 agentsam_user_policy.can_run_pty gate + PTY backend bearer checks.
 */
import { resolveUserPtyToken } from '../../../credentials/user-secrets.js';

/**
 * Load auth_users row for PTY backend register (Bearer user token path).
 * @param {import('@cloudflare/workers-types').D1Database | null} db
 * @param {string} userId
 */
export async function loadAuthUserRowForPty(db, userId) {
  if (!db || !userId) return null;
  try {
    return await db
      .prepare(`SELECT id, email, person_uuid, tenant_id, active_tenant_id FROM auth_users WHERE id = ? LIMIT 1`)
      .bind(String(userId).trim())
      .first();
  } catch (_) {
    return null;
  }
}

/**
 * Validate ExecOS Bearer against platform or per-user encrypted token.
 * @param {Record<string, unknown>} env
 * @param {string} token
 * @param {string} [userId]
 * @param {string} [workspaceId]
 */
export async function ptyBackendBearerValid(env, token, userId = '', workspaceId = '') {
  const t = String(token || '').trim();
  if (!t) return false;
  if (t === String(env?.PTY_AUTH_TOKEN || '').trim()) return true;
  if (t === String(env?.TERMINAL_SECRET || '').trim()) return true;
  const uid = String(userId || '').trim();
  const wid = String(workspaceId || '').trim();
  if (uid) {
    const userTok = await resolveUserPtyToken(env, uid, wid);
    if (userTok && t === userTok) return true;
  }
  return false;
}

/**
 * D1 agentsam_user_policy.can_run_pty gate (replaces superadmin-only terminal checks).
 * @param {Record<string, unknown>} env
 * @param {string} userId
 * @param {string} workspaceId
 */
export async function userCanRunPtyFromPolicy(env, userId, workspaceId) {
  if (!env?.DB || !userId) return false;
  const uid = String(userId).trim();
  try {
    const au = await env.DB.prepare(
      `SELECT is_superadmin FROM auth_users WHERE id = ? LIMIT 1`,
    )
      .bind(uid)
      .first();
    if (Number(au?.is_superadmin) === 1) return true;
  } catch (_) {
    /* fall through */
  }
  if (!workspaceId) return false;
  try {
    const policy = await env.DB.prepare(
      'SELECT can_run_pty FROM agentsam_user_policy WHERE user_id = ? AND workspace_id = ? LIMIT 1',
    )
      .bind(uid, String(workspaceId).trim())
      .first();
    return Number(policy?.can_run_pty) === 1;
  } catch (_) {
    return false;
  }
}
