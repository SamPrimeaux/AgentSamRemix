/**
 * Per-user terminal connection provisioning.
 */
import { userHasPolicyGrant } from '../workspace/grants.js';

export async function hashBridgeKey(key) {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(String(key || '')),
  );
  return Array.from(new Uint8Array(buf))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function generateUserBridgeKey(
  env,
  userId,
  tenantId,
  workspaceId,
  opts = {},
) {
  if (!env?.DB || !userId || !tenantId || !workspaceId) {
    throw new Error('generateUserBridgeKey: missing DB, user, tenant, or workspace');
  }
  const wid = String(workspaceId).trim();
  const authMode = String(opts.authMode || 'bridge').trim() || 'bridge';
  if (!['bridge', 'token_mint'].includes(authMode)) {
    throw new Error('generateUserBridgeKey: invalid authMode');
  }

  try {
    const exists = await env.DB.prepare(
      `SELECT id FROM terminal_connections
        WHERE user_id = ? AND workspace_id = ? LIMIT 1`,
    ).bind(userId, wid).first();
    if (exists?.id) return null;
  } catch {}

  const raw = `iamb_${crypto.randomUUID().replace(/-/g, '')}`;
  const hash = authMode === 'token_mint' ? null : await hashBridgeKey(raw);
  const connId =
    `conn_${userId.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 48)}_${crypto.randomUUID().slice(0, 6)}`;
  const now = Math.floor(Date.now() / 1000);
  const tokenVerify = authMode === 'token_mint' ? '/api/terminal/session/verify' : null;

  await env.DB.prepare(
    `INSERT INTO terminal_connections
       (id, name, type, ws_url, connection_type, workspace_id, tenant_id, user_id,
        shell, bridge_key_hash, auth_mode, token_verify_endpoint, is_default, is_active,
        created_at, updated_at)
     VALUES (?, 'IAM Bridge', 'pty', '', 'pty_tunnel', ?, ?, ?,
       '/bin/zsh', ?, ?, ?, 0, 1, ?, ?)`,
  ).bind(
    connId,
    wid,
    tenantId,
    userId,
    hash,
    authMode,
    tokenVerify,
    now,
    now,
  ).run();
  return authMode === 'token_mint' ? null : raw;
}

export async function ensureUserTerminalConnection(
  env,
  userId,
  workspaceId,
  tenantId,
) {
  if (!env?.DB || !userId) return null;
  const uid = String(userId).trim();
  if (!uid) return null;

  let wid = workspaceId != null ? String(workspaceId).trim() : '';
  let tid = tenantId != null ? String(tenantId).trim() : '';
  if (!wid || !tid) {
    const row = await env.DB.prepare(
      `SELECT COALESCE(NULLIF(TRIM(active_tenant_id), ''), NULLIF(TRIM(tenant_id), '')) AS tenant_id,
              TRIM(COALESCE(NULLIF(active_workspace_id, ''), NULLIF(default_workspace_id, ''))) AS workspace_id
         FROM auth_users WHERE id = ? LIMIT 1`,
    ).bind(uid).first().catch(() => null);
    if (!tid) tid = row?.tenant_id != null ? String(row.tenant_id).trim() : '';
    if (!wid) wid = row?.workspace_id != null ? String(row.workspace_id).trim() : '';
  }
  if (!tid || !wid) return null;

  let connId = null;
  try {
    const existing = await env.DB.prepare(
      `SELECT id FROM terminal_connections
        WHERE user_id = ? AND workspace_id = ? AND is_active = 1 LIMIT 1`,
    ).bind(uid, wid).first();
    if (existing?.id) {
      connId = String(existing.id);
      if (await userHasPolicyGrant(env, uid, wid)) {
        await env.DB.prepare(
          `UPDATE terminal_connections
              SET cwd_strategy = 'host_default', updated_at = unixepoch()
            WHERE id = ? AND cwd_strategy != 'host_default'`,
        ).bind(connId).run().catch(() => {});
      }
    } else {
      connId = `conn_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
      await env.DB.prepare(
        `INSERT INTO terminal_connections
           (id, workspace_id, tenant_id, name, type, connection_type,
            ws_url, auth_mode, token_verify_endpoint, shell, platform,
            user_id, is_default, is_active, cwd_strategy, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, unixepoch(), unixepoch())`,
      ).bind(
        connId,
        wid,
        tid,
        'Default Terminal',
        'pty',
        'pty_tunnel',
        'wss://terminal.inneranimalmedia.com',
        'token_mint',
        '/api/terminal/session/verify',
        '/bin/zsh',
        'linux',
        uid,
        'host_default',
      ).run();
    }
  } catch (error) {
    console.warn('[ensureUserTerminalConnection] terminal_connections', error?.message ?? error);
    return null;
  }

  try {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO agentsam_user_policy
         (user_id, workspace_id, tenant_id, can_run_pty)
       VALUES (?, ?, ?, 1)`,
    ).bind(uid, wid, tid).run();
  } catch (error) {
    console.warn('[ensureUserTerminalConnection] agentsam_user_policy', error?.message ?? error);
  }
  return connId;
}
