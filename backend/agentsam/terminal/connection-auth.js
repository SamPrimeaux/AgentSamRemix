import { resolveUserPtyToken, USER_PTY_TOKEN_SENTINEL } from '../../credentials/user-secrets.js';

/**
 * Resolve bridge auth token for a terminal_connections row.
 * Priority: user_secrets (user_pty_token) → Worker secret by name → PTY_AUTH_TOKEN / TERMINAL_SECRET.
 *
 * @param {Record<string, unknown>} env
 * @param {Record<string, unknown> | null | undefined} conn
 * @param {string | null | undefined} userId
 * @param {string | null | undefined} workspaceId
 * @returns {Promise<string | null>}
 */
export async function resolveConnectionAuthToken(env, conn, userId, workspaceId) {
  if (!conn) return null;
  const mode = String(conn.auth_mode || '').trim();
  if (mode === 'token_mint') return null;

  const uid = userId != null ? String(userId).trim() : '';
  const wid = workspaceId != null ? String(workspaceId).trim() : '';
  const secretName = String(conn.auth_token_secret_name || '').trim();

  if (mode === 'secret_name' && secretName === USER_PTY_TOKEN_SENTINEL && uid) {
    const fromD1 = await resolveUserPtyToken(env, uid, wid);
    if (fromD1) return fromD1;
  } else if (secretName && secretName !== USER_PTY_TOKEN_SENTINEL && env[secretName] != null) {
    const t = String(env[secretName]).trim();
    if (t) return t;
  }

  const fallback = String(env?.PTY_AUTH_TOKEN || env?.TERMINAL_SECRET || '').trim();
  return fallback || null;
}
