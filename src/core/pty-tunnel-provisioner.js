/**
 * BYOK Cloudflare tunnel provisioning for user-hosted PTY (never platform CLOUDFLARE_API_TOKEN).
 */
import { cfApi } from './customer-cloudflare-dispatch.js';
import { resolveWorkspaceCloudflareCredentials } from './workspace-cloudflare-credentials.js';
import {
  upsertUserSecret,
  writeSecretAuditLog,
  USER_PTY_TOKEN_SENTINEL,
  TUNNEL_META_SERVICE_NAME,
  tunnelMetaSecretName,
  resolveUserTunnelMeta,
} from '../../backend/credentials/user-secrets.js';

/**
 * Platform break-glass token — only for IAM-account-level ops.
 * NEVER used for customer/user CF account operations.
 * @param {Record<string, unknown>} env
 */
export function getPlatformCfToken(env) {
  const t = String(env?.CLOUDFLARE_BREAK_GLASS_ADMIN_TOKEN || '').trim();
  if (!t) throw new Error('CLOUDFLARE_BREAK_GLASS_ADMIN_TOKEN not configured');
  return t;
}

function normalizeHostname(host) {
  return String(host || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^wss?:\/\//, '')
    .split('/')[0]
    .split(':')[0];
}

function toWsUrl(hostname) {
  const h = normalizeHostname(hostname);
  return h ? `wss://${h}` : '';
}

/** @param {string} hostname @param {string} zoneName */
function dnsRecordName(hostname, zoneName) {
  const host = normalizeHostname(hostname);
  const zone = String(zoneName || '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
  if (!host || !zone) return host;
  if (host === zone) return '@';
  const suffix = `.${zone}`;
  if (host.endsWith(suffix)) return host.slice(0, -suffix.length);
  return host;
}

function tunnelNameValid(name) {
  return /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/i.test(String(name || '').trim());
}

/**
 * @param {Record<string, unknown>} env
 * @param {string} tunnelUrl
 * @param {string} userId
 * @param {string} [workspaceId]
 */
export async function tryAutoActivateUserHostedTunnel(env, tunnelUrl, userId, workspaceId = '') {
  if (!env?.DB || !tunnelUrl || !userId) return { activated: false };
  const host = normalizeHostname(tunnelUrl);
  if (!host) return { activated: false };
  const uid = String(userId).trim();
  const wid = workspaceId != null ? String(workspaceId).trim() : '';
  const now = Math.floor(Date.now() / 1000);

  let sql = `SELECT id, ws_url FROM terminal_connections
     WHERE user_id = ? AND target_type = 'user_hosted_tunnel' AND is_active = 0`;
  const binds = [uid];
  if (wid) {
    sql += ' AND workspace_id = ?';
    binds.push(wid);
  }
  sql += ' ORDER BY updated_at DESC LIMIT 5';
  const rows = await env.DB.prepare(sql).bind(...binds).all().catch(() => ({ results: [] }));
  for (const row of rows.results || []) {
    const wsHost = normalizeHostname(String(row.ws_url || ''));
    if (wsHost && wsHost === host) {
      await env.DB.prepare(
        `UPDATE terminal_connections SET is_active = 1, updated_at = ? WHERE id = ? AND user_id = ?`,
      )
        .bind(now, String(row.id), uid)
        .run()
        .catch(() => {});
      return { activated: true, connection_id: String(row.id) };
    }
  }
  return { activated: false };
}

/**
 * @param {any} env
 * @param {{ userId: string, tenantId: string, workspaceId: string, tunnelName: string, hostname: string, zoneId: string, port?: number, platform?: string, shell?: string, connectionId?: string, connectionName?: string }} opts
 */
export async function provisionPtyTunnel(env, opts, deps = {}) {
  const userId = String(opts.userId || '').trim();
  const tenantId = String(opts.tenantId || '').trim();
  const workspaceId = String(opts.workspaceId || '').trim();
  const tunnelName = String(opts.tunnelName || '').trim();
  const hostname = normalizeHostname(opts.hostname);
  const zoneId = String(opts.zoneId || '').trim();
  const port = Number(opts.port) > 0 ? Number(opts.port) : 3099;

  if (!userId || !tenantId || !workspaceId) {
    return { ok: false, error: 'missing_scope', step_failed: 'validate' };
  }
  if (!tunnelNameValid(tunnelName)) {
    return { ok: false, error: 'invalid_tunnel_name', step_failed: 'validate' };
  }
  if (!hostname || !hostname.includes('.')) {
    return { ok: false, error: 'invalid_hostname', step_failed: 'validate' };
  }
  if (!zoneId) {
    return { ok: false, error: 'zone_id_required', step_failed: 'validate' };
  }

  const creds = await resolveWorkspaceCloudflareCredentials(env, userId, tenantId, workspaceId);
  if (!creds.ok || !creds.token || !creds.account_id) {
    return {
      ok: false,
      error: creds.error || 'cloudflare_credentials_missing',
      step_failed: 'credentials',
    };
  }

  const token = creds.token;
  const accountId = creds.account_id;
  let tunnelId;
  let runToken;
  let dnsRecordId = null;

  try {
    const created = await cfApi(token, `/accounts/${encodeURIComponent(accountId)}/cfd_tunnel`, {
      method: 'POST',
      body: JSON.stringify({ name: tunnelName, config_src: 'cloudflare' }),
    });
    tunnelId = created?.id != null ? String(created.id) : '';
    runToken =
      created?.token != null
        ? String(created.token)
        : created?.credentials?.token != null
          ? String(created.credentials.token)
          : '';
    if (!tunnelId) {
      return { ok: false, error: 'tunnel_create_no_id', step_failed: 'create_tunnel' };
    }
  } catch (e) {
    return { ok: false, error: e?.message || 'tunnel_create_failed', step_failed: 'create_tunnel' };
  }

  try {
    await cfApi(token, `/accounts/${encodeURIComponent(accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}/configurations`, {
      method: 'PUT',
      body: JSON.stringify({
        config: {
          ingress: [
            { hostname, service: `http://127.0.0.1:${port}`, originRequest: {} },
            { service: 'http_status:404' },
          ],
        },
      }),
    });
  } catch (e) {
    return { ok: false, error: e?.message || 'ingress_failed', step_failed: 'configure_ingress', tunnel_id: tunnelId };
  }

  try {
    const zone = await cfApi(token, `/zones/${encodeURIComponent(zoneId)}`);
    const zoneName = zone?.name != null ? String(zone.name) : '';
    const recordName = dnsRecordName(hostname, zoneName);
    const dns = await cfApi(token, `/zones/${encodeURIComponent(zoneId)}/dns_records`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'CNAME',
        name: recordName,
        content: `${tunnelId}.cfargotunnel.com`,
        proxied: true,
        ttl: 1,
      }),
    });
    dnsRecordId = dns?.id != null ? String(dns.id) : null;
  } catch (e) {
    return {
      ok: false,
      error: e?.message || 'dns_failed',
      step_failed: 'dns',
      tunnel_id: tunnelId,
    };
  }

  if (!runToken) {
    try {
      const tok = await cfApi(
        token,
        `/accounts/${encodeURIComponent(accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}/token`,
      );
      runToken = typeof tok === 'string' ? tok : tok?.token != null ? String(tok.token) : '';
    } catch (e) {
      return { ok: false, error: e?.message || 'token_failed', step_failed: 'run_token', tunnel_id: tunnelId };
    }
  }

  const wsUrl = toWsUrl(hostname);
  const now = Math.floor(Date.now() / 1000);
  const platform = String(opts.platform || 'windows').trim() || 'windows';
  const shell = String(opts.shell || 'powershell').trim() || 'powershell';
  const connectionName =
    String(opts.connectionName || tunnelName || 'Remote machine').trim().slice(0, 120) ||
    'Remote machine';

  const { getUserHostedTunnelConnectionById, setDefaultUserHostedTunnelConnection } = deps;

  let connectionId = String(opts.connectionId || '').trim();
  if (connectionId) {
    const row = await getUserHostedTunnelConnectionById(env.DB, userId, connectionId);
    if (!row?.id) return { ok: false, error: 'connection_not_found', step_failed: 'validate' };
    const rowWid = row.workspace_id != null ? String(row.workspace_id).trim() : '';
    if (rowWid && rowWid !== workspaceId) {
      return { ok: false, error: 'connection_forbidden', step_failed: 'validate' };
    }
  } else {
    connectionId = `conn_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    await env.DB.prepare(
      `INSERT OR IGNORE INTO terminal_connections
         (id, workspace_id, tenant_id, user_id, name, type, connection_type,
          ws_url, target_type, cwd_strategy, platform, shell, is_default, is_active,
          auth_token_secret_name, auth_mode, self_service_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pty', 'pty_tunnel',
          '', 'user_hosted_tunnel', 'host_default', ?, ?, 0, 0, ?, 'secret_name', 1, ?, ?)`,
    )
      .bind(
        connectionId,
        workspaceId,
        tenantId,
        userId,
        connectionName,
        platform,
        shell,
        USER_PTY_TOKEN_SENTINEL,
        now,
        now,
      )
      .run();
  }

  await env.DB.prepare(
    `UPDATE terminal_connections
     SET ws_url = ?, auth_token_secret_name = ?, auth_mode = 'secret_name',
         name = COALESCE(?, name), platform = ?, shell = ?, is_active = 0, self_service_enabled = 1,
         cwd_strategy = 'host_default', updated_at = ?
     WHERE id = ? AND user_id = ?`,
  )
    .bind(wsUrl, USER_PTY_TOKEN_SENTINEL, connectionName, platform, shell, now, connectionId, userId)
    .run();

  await setDefaultUserHostedTunnelConnection(env.DB, userId, workspaceId, connectionId);

  const meta = {
    tunnel_id: tunnelId,
    tunnel_name: tunnelName,
    run_token: runToken,
    hostname,
    zone_id: zoneId,
    dns_record_id: dnsRecordId,
    account_id: accountId,
    connection_id: connectionId,
    port,
  };

  const metaUpsert = await upsertUserSecret(env, {
    userId,
    tenantId,
    workspaceId,
    secretName: tunnelMetaSecretName(connectionId),
    serviceName: TUNNEL_META_SERVICE_NAME,
    plaintextValue: JSON.stringify(meta),
    description: 'Cloudflare tunnel metadata for user-hosted PTY',
    secretType: 'custom',
    last4: hostname.slice(-4),
  });
  if (!metaUpsert.ok) {
    return { ok: false, error: metaUpsert.error || 'meta_store_failed', step_failed: 'store_meta', tunnel_id: tunnelId };
  }

  await writeSecretAuditLog(env, {
    secretId: metaUpsert.secretId,
    secretSource: 'user_secrets',
    tenantId,
    userId,
    eventType: 'created',
    triggeredBy: userId,
    newLast4: metaUpsert.last4,
    notes: `PTY tunnel provisioned: ${hostname}`,
  });

  return {
    ok: true,
    tunnel_id: tunnelId,
    tunnel_name: tunnelName,
    run_token: runToken,
    hostname,
    ws_url: wsUrl,
    connection_id: connectionId,
    dns_record_id: dnsRecordId,
  };
}

/**
 * @param {any} env
 * @param {{ userId: string, tenantId: string, workspaceId: string, connectionId?: string }} opts
 */
export async function deprovisionPtyTunnel(env, opts) {
  const userId = String(opts.userId || '').trim();
  const tenantId = String(opts.tenantId || '').trim();
  const workspaceId = String(opts.workspaceId || '').trim();
  const connectionId = String(opts.connectionId || '').trim();
  const meta = connectionId
    ? await resolveUserTunnelMeta(env, userId, workspaceId, connectionId)
    : await resolveUserTunnelMeta(env, userId, workspaceId);
  if (!meta?.tunnel_id) {
    const now = Math.floor(Date.now() / 1000);
    if (connectionId) {
      await env.DB.prepare(
        `UPDATE terminal_connections SET is_active = 0, updated_at = ?
         WHERE id = ? AND user_id = ? AND target_type = 'user_hosted_tunnel'`,
      )
        .bind(now, connectionId, userId)
        .run()
        .catch(() => {});
    } else {
      await env.DB.prepare(
        `UPDATE terminal_connections SET is_active = 0, updated_at = ?
         WHERE user_id = ? AND workspace_id = ? AND target_type = 'user_hosted_tunnel'`,
      )
        .bind(now, userId, workspaceId)
        .run()
        .catch(() => {});
    }
    return { ok: true, tunnel_id: null, dns_record_deleted: false, already_absent: true };
  }

  const creds = await resolveWorkspaceCloudflareCredentials(env, userId, tenantId, workspaceId);
  if (!creds.ok || !creds.token || !creds.account_id) {
    return { ok: false, error: creds.error || 'cloudflare_credentials_missing' };
  }

  const token = creds.token;
  const accountId = creds.account_id;
  const tunnelId = String(meta.tunnel_id);
  let dnsDeleted = false;

  if (meta.dns_record_id && meta.zone_id) {
    try {
      await cfApi(
        token,
        `/zones/${encodeURIComponent(String(meta.zone_id))}/dns_records/${encodeURIComponent(String(meta.dns_record_id))}`,
        { method: 'DELETE' },
      );
      dnsDeleted = true;
    } catch (_) {}
  }

  try {
    await cfApi(
      token,
      `/accounts/${encodeURIComponent(accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}`,
      { method: 'DELETE' },
    );
  } catch (e) {
    return { ok: false, error: e?.message || 'tunnel_delete_failed', tunnel_id: tunnelId };
  }

  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `UPDATE user_secrets SET is_active = 0, updated_at = ?
     WHERE user_id = ? AND secret_name = ? AND service_name = ?`,
  )
    .bind(now, userId, TUNNEL_META_SECRET_NAME, TUNNEL_META_SERVICE_NAME)
    .run()
    .catch(() => {});

  await env.DB.prepare(
    `UPDATE terminal_connections SET is_active = 0, updated_at = ?
     WHERE user_id = ? AND workspace_id = ? AND target_type = 'user_hosted_tunnel'`,
  )
    .bind(now, userId, workspaceId)
    .run()
    .catch(() => {});

  return { ok: true, tunnel_id: tunnelId, dns_record_deleted: dnsDeleted };
}

/**
 * @param {any} env
 * @param {{ userId: string, tenantId: string, workspaceId: string, connectionId?: string }} opts
 */
export async function getPtyTunnelStatus(env, opts, deps = {}) {
  const userId = String(opts.userId || '').trim();
  const workspaceId = String(opts.workspaceId || '').trim();
  const tenantId = String(opts.tenantId || '').trim();
  const connectionIdOpt = String(opts.connectionId || '').trim();

  const { getUserHostedTunnelConnection, getUserHostedTunnelConnectionById } = deps;
  let conn = null;
  let connectionId = connectionIdOpt;
  if (connectionId) {
    conn = await getUserHostedTunnelConnectionById(env.DB, userId, connectionId);
  } else {
    conn = await getUserHostedTunnelConnection(env.DB, userId, workspaceId);
    connectionId = conn?.id != null ? String(conn.id) : '';
  }

  const meta = await resolveUserTunnelMeta(
    env,
    userId,
    workspaceId,
    connectionId || null,
  );

  const base = {
    ok: true,
    tunnel_id: meta?.tunnel_id != null ? String(meta.tunnel_id) : null,
    tunnel_name: meta?.tunnel_name != null ? String(meta.tunnel_name) : null,
    hostname: meta?.hostname != null ? String(meta.hostname) : null,
    zone_id: meta?.zone_id != null ? String(meta.zone_id) : null,
    connection_id: conn?.id != null ? String(conn.id) : meta?.connection_id != null ? String(meta.connection_id) : null,
    connection_active: !!(conn && Number(conn.is_active) === 1),
    cf_status: 'unknown',
    connections_count: 0,
    has_run_token: !!(meta?.run_token && String(meta.run_token).trim()),
    run_token: meta?.run_token != null ? String(meta.run_token) : null,
  };

  if (!meta?.tunnel_id || !tenantId) return base;

  const creds = await resolveWorkspaceCloudflareCredentials(env, userId, tenantId, workspaceId);
  if (!creds.ok || !creds.token || !creds.account_id) return base;

  try {
    const tunnel = await cfApi(
      creds.token,
      `/accounts/${encodeURIComponent(creds.account_id)}/cfd_tunnel/${encodeURIComponent(String(meta.tunnel_id))}`,
    );
    base.cf_status = tunnel?.status != null ? String(tunnel.status) : 'unknown';
    const conns = tunnel?.connections;
    base.connections_count = Array.isArray(conns) ? conns.length : 0;
  } catch (_) {
    base.cf_status = 'unknown';
  }

  return base;
}
