/**
 * Agent Sam terminal connection authority.
 *
 * Owns terminal_connections selection, health, user-hosted device CRUD, and
 * Agent-run lane -> connection lookup. Authorization/identity stay upstream.
 */

export const VALID_TERMINAL_PLATFORMS = Object.freeze(['macos', 'windows', 'linux']);
export const VALID_TERMINAL_SHELLS = Object.freeze({
  macos: Object.freeze(['/bin/zsh', '/bin/bash', '/bin/sh']),
  windows: Object.freeze(['powershell', 'pwsh']),
  linux: Object.freeze(['/bin/bash', '/bin/zsh', '/bin/sh']),
});

function trim(value) {
  return value == null ? '' : String(value).trim();
}

/** Same target aliases as the retiring terminal-exec-lane helper. */
function requireTerminalConnectionTargetType(raw) {
  const value = trim(raw).toLowerCase();
  if (!value || value === 'auto') {
    const error = new Error(value === 'auto' ? 'target_type_invalid' : 'target_type_required');
    error.code = error.message;
    throw error;
  }
  if (value === 'remote') return 'platform_vm';
  if (value === 'local') return 'user_hosted_tunnel';
  if (value === 'container' || value === 'ephemeral_container') return 'sandbox';
  return value;
}

/** @typedef {'user_hosted_tunnel'|'platform_vm'|'sandbox'} TerminalRouteMode */

const LOCAL_TARGET_TYPES = ['user_hosted_tunnel'];
const CLOUD_TARGET_TYPES = ['platform_vm', 'remote'];

const HEALTH_TERMINAL_CONN_SELECT = `
  id, ws_url, auth_token_secret_name, connection_type, ollama_url,
  shell, platform, user_id, workspace_id, tenant_id, auth_mode, token_verify_endpoint,
  target_type, target_priority, self_service_enabled, last_health_status, last_health_at,
  health_error, cwd_strategy, is_default, is_active, updated_at,
  username, remote_exec_user, privileged_target_id, ssh_identity_secret_name`;

/**
 * @param {string} wsUrl
 */
export function terminalHealthUrlFromWsUrl(wsUrl) {
  const raw = String(wsUrl || '').trim().split('?')[0];
  if (!raw) return '';
  try {
    let u = raw;
    if (u.startsWith('wss://')) u = `https://${u.slice(6)}`;
    else if (u.startsWith('ws://')) u = `http://${u.slice(7)}`;
    else if (!/^https?:\/\//i.test(u)) u = `https://${u.replace(/^\/+/, '')}`;
    return new URL('/health', new URL(u).origin).href;
  } catch {
    return '';
  }
}

/**
 * @param {string} wsUrl
 * @param {number} [timeoutMs]
 */
export async function probeTerminalLaneHealth(wsUrl, timeoutMs = 3200) {
  const healthUrl = terminalHealthUrlFromWsUrl(wsUrl);
  if (!healthUrl) return { ok: false, error: 'health_url_unresolved' };
  const t0 = Date.now();
  try {
    const res = await fetch(healthUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(Math.max(500, timeoutMs)),
    });
    const latency_ms = Date.now() - t0;
    if (!res.ok) {
      return { ok: false, error: `health_http_${res.status}`, latency_ms, health_url: healthUrl };
    }
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const workspaces_root =
      body && typeof body.workspaces_root === 'string' ? body.workspaces_root : null;
    return {
      ok: true,
      latency_ms,
      health_url: healthUrl,
      workspaces_root,
      status: body?.status ?? 'ok',
    };
  } catch (e) {
    return {
      ok: false,
      error: e?.message ? String(e.message) : 'health_probe_failed',
      latency_ms: Date.now() - t0,
      health_url: healthUrl,
    };
  }
}

/**
 * @param {string | null | undefined} targetType
 * @returns {'user_hosted_tunnel'|'platform_vm'|'sandbox'}
 */
export function resolveTerminalRouteMode(targetType) {
  const tt = String(targetType || '').trim();
  if (tt === 'user_hosted_tunnel') return 'user_hosted_tunnel';
  if (tt === 'sandbox') return 'sandbox';
  if (tt === 'platform_vm' || tt === 'remote') return 'platform_vm';
  const err = new Error(tt ? 'target_type_invalid' : 'target_type_required');
  err.code = err.message;
  throw err;
}

/**
 * @param {string} targetType
 */
export function isLocalTerminalTargetType(targetType) {
  return LOCAL_TARGET_TYPES.includes(String(targetType || '').trim());
}

/**
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {{
 *   userId: string,
 *   workspaceId: string,
 *   tenantId?: string|null,
 *   targetTypes: string[],
 * }} q
 */
async function listScopedConnections(db, q) {
  const { userId, workspaceId, tenantId, targetTypes } = q;
  if (!targetTypes.length) return [];
  const placeholders = targetTypes.map(() => '?').join(', ');

  const runQuery = (workspaceFilter) => {
    let sql = `SELECT ${HEALTH_TERMINAL_CONN_SELECT}
     FROM terminal_connections
     WHERE user_id = ? AND is_active = 1
       AND target_type IN (${placeholders})`;
    const binds = [userId, ...targetTypes];
    if (workspaceFilter) {
      sql += ' AND workspace_id = ?';
      binds.push(workspaceFilter);
    }
    if (tenantId) {
      sql += " AND (tenant_id = ? OR tenant_id IS NULL OR tenant_id = '')";
      binds.push(tenantId);
    }
    sql += ' ORDER BY is_default DESC, target_priority ASC, updated_at DESC LIMIT 8';
    return db.prepare(sql).bind(...binds).all().then((r) => r?.results || []);
  };

  const wid = String(workspaceId || '').trim();
  if (wid) {
    const scoped = await runQuery(wid);
    if (scoped.length) return scoped;
  }
  /** PTY is user-scoped — workspace switch must not kill a healthy lane. */
  return runQuery(null);
}

function orderConnectionsWithinLane(rows) {
  const list = [...rows];
  list.sort((a, b) => {
    const ap = Number(a.target_priority) || 999;
    const bp = Number(b.target_priority) || 999;
    if (ap !== bp) return ap - bp;
    return Number(b.is_default) - Number(a.is_default);
  });
  return list;
}

function resolutionNameForHealthyPick(mode) {
  return `health_${mode}`;
}

function laneNameForHealthyPick(targetType) {
  const tt = String(targetType || '').trim();
  if (isLocalTerminalTargetType(tt)) return 'mac_local';
  if (tt === 'sandbox') return 'sandbox';
  return 'gcp_primary';
}

/**
 * Hard-bind one lane: only connections matching resolved target_type.
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {{
 *   userId: string,
 *   workspaceId: string,
 *   tenantId?: string|null,
 *   targetType?: string|null,
 *   healthAware?: boolean,
 * }} opts
 */
export async function selectHealthyTerminalConnection(db, opts = {}) {
  const uid = String(opts.userId || '').trim();
  const wid = String(opts.workspaceId || '').trim();
  const tid = opts.tenantId != null ? String(opts.tenantId).trim() : '';
  if (!db || !uid || !wid) {
    return { connection: null, error: 'connection_missing', resolution: null, health: null };
  }

  const mode = resolveTerminalRouteMode(opts.targetType);
  const healthAware = opts.healthAware !== false;

  let targetTypes;
  if (mode === 'user_hosted_tunnel') targetTypes = LOCAL_TARGET_TYPES;
  else if (mode === 'sandbox') targetTypes = ['sandbox'];
  else targetTypes = CLOUD_TARGET_TYPES;

  const rows = await listScopedConnections(db, {
    userId: uid,
    workspaceId: wid,
    tenantId: tid || null,
    targetTypes,
  });

  if (!rows.length) {
    return { connection: null, error: 'connection_missing', resolution: null, health: null };
  }

  const ordered = orderConnectionsWithinLane(rows);

  if (!healthAware) {
    return {
      connection: ordered[0],
      error: null,
      resolution: 'static_priority',
      health: null,
    };
  }

  /** @type {Record<string, unknown>[]} */
  const probes = [];
  for (const row of ordered) {
    const ws = String(row.ws_url || '').trim();
    if (!ws) continue;
    const probe = await probeTerminalLaneHealth(ws);
    probes.push({ connection_id: row.id, target_type: row.target_type, ...probe });
    if (probe.ok) {
      return {
        connection: row,
        error: null,
        resolution: resolutionNameForHealthyPick(mode),
        lane: laneNameForHealthyPick(row.target_type),
        health: { probe, probes },
      };
    }
  }

  return {
    connection: null,
    error: 'lane_unhealthy',
    resolution: 'health_all_failed',
    health: { probes },
  };
}

export const VALID_TARGET_TYPES = Object.freeze(['platform_vm', 'user_hosted_tunnel', 'ssh_target', 'sandbox']);

const TERMINAL_CONN_SELECT = `
  id, ws_url, auth_token_secret_name, connection_type, ollama_url,
  shell, platform, username, user_id, workspace_id, tenant_id, auth_mode, token_verify_endpoint,
  target_type, target_priority, self_service_enabled, last_health_status, last_health_at,
  health_error, cwd_strategy, is_default, is_active, updated_at,
  remote_exec_user, privileged_target_id, ssh_identity_secret_name`;

/**
 * Authoritative terminal_connections row selection for routing.
 * Never selects another user's machine.
 *
 * @param {import('@cloudflare/workers-types').D1Database | null} db
 * @param {{
 *   userId?: string | null,
 *   workspaceId?: string | null,
 *   tenantId?: string | null,
 *   connectionId?: string | null,
 *   targetType?: string | null,
 *   clientSurface?: string | null,
 *   execLane?: string | null,
 *   skipLocalTunnel?: boolean,
 * }} opts
 * @returns {Promise<{ connection: Record<string, unknown> | null, error: string | null }>}
 */
export async function getSelectedTerminalConnection(db, opts = {}) {
  if (!db) return { connection: null, error: 'connection_missing' };

  const uid =
    opts.userId != null && String(opts.userId).trim() !== '' ? String(opts.userId).trim() : null;
  const wid =
    opts.workspaceId != null && String(opts.workspaceId).trim() !== ''
      ? String(opts.workspaceId).trim()
      : null;
  const tid =
    opts.tenantId != null && String(opts.tenantId).trim() !== ''
      ? String(opts.tenantId).trim()
      : null;
  const ttRaw =
    opts.targetType != null && String(opts.targetType).trim() !== ''
      ? String(opts.targetType).trim()
      : null;
  if (!ttRaw || ttRaw === 'auto') {
    return { connection: null, error: ttRaw === 'auto' ? 'target_type_invalid' : 'target_type_required' };
  }
  let tt;
  try {
    tt = requireTerminalConnectionTargetType(ttRaw);
  } catch (e) {
    return { connection: null, error: e?.code || e?.message || 'unsupported_target_type' };
  }

  if (!VALID_TARGET_TYPES.includes(tt)) {
    return { connection: null, error: 'unsupported_target_type' };
  }

  try {
    const connectionId =
      opts.connectionId != null && String(opts.connectionId).trim() !== ''
        ? String(opts.connectionId).trim()
        : null;

    if (connectionId) {
      const row = await db
        .prepare(
          `SELECT ${TERMINAL_CONN_SELECT}
           FROM terminal_connections
           WHERE id = ? AND is_active = 1
           LIMIT 1`,
        )
        .bind(connectionId)
        .first();
      if (row) {
        const rowWid = row.workspace_id != null ? String(row.workspace_id).trim() : '';
        if (wid && rowWid && rowWid !== wid) {
          return { connection: null, error: 'connection_forbidden' };
        }
        const rowUid = row.user_id != null ? String(row.user_id).trim() : '';
        if (rowUid && uid && rowUid !== uid) {
          return { connection: null, error: 'connection_forbidden' };
        }
        const rowTt = String(row.target_type || '').trim();
        // Stale pin from another lane (dock VM vs local tool) — ignore, look up this type.
        if (rowTt && rowTt === tt) {
          return { connection: row, error: null };
        }
      }
      // Missing or cross-lane pin: fall through to scoped lookup for `tt`.
    }

    if (uid && wid) {
      if (opts.healthAware !== false) {
        const healthy = await selectHealthyTerminalConnection(db, {
          userId: uid,
          workspaceId: wid,
          tenantId: tid,
          targetType: tt,
          healthAware: true,
          clientSurface: opts.clientSurface ?? null,
          execLane: opts.execLane ?? null,
          skipLocalTunnel: opts.skipLocalTunnel === true,
        });
        if (healthy.connection) {
          return {
            connection: healthy.connection,
            error: healthy.error,
            resolution: healthy.resolution,
            lane: healthy.lane ?? null,
            health: healthy.health ?? null,
          };
        }
        // Explicit/unhealthy: fail closed — never continue into a cross-lane static lookup.
        if (
          healthy.error &&
          healthy.error !== 'connection_missing'
        ) {
          return {
            connection: null,
            error: healthy.error,
            resolution: healthy.resolution,
            health: healthy.health ?? null,
          };
        }
      }

      let sql = `SELECT ${TERMINAL_CONN_SELECT}
         FROM terminal_connections
         WHERE user_id = ? AND workspace_id = ? AND is_active = 1 AND target_type = ?`;
      const binds = [uid, wid, tt];
      if (tid) {
        sql += " AND (tenant_id = ? OR tenant_id IS NULL OR tenant_id = '')";
        binds.push(tid);
      }
      sql += ' ORDER BY is_default DESC, target_priority ASC, updated_at DESC LIMIT 1';
      const row = await db.prepare(sql).bind(...binds).first();
      if (row) return { connection: row, error: null };
    }

    if (uid) {
      let sql = `SELECT ${TERMINAL_CONN_SELECT}
         FROM terminal_connections
         WHERE user_id = ? AND is_active = 1 AND target_type = ?`;
      const binds = [uid, tt];
      if (tid) {
        sql += " AND (tenant_id = ? OR tenant_id IS NULL OR tenant_id = '')";
        binds.push(tid);
      }
      sql += ' ORDER BY is_default DESC, target_priority ASC, updated_at DESC LIMIT 1';
      const row = await db.prepare(sql).bind(...binds).first();
      if (row) return { connection: row, error: null };
    }

    return { connection: null, error: 'connection_missing' };
  } catch (e) {
    console.warn('[getSelectedTerminalConnection]', e?.message ?? e);
    return { connection: null, error: e?.code || e?.message || 'connection_missing' };
  }
}

/**
 * Resolve PTY bridge row from D1 (terminal_connections).
 * Hard-bind: never substitute platform_vm when another target was requested.
 *
 * @param {import('@cloudflare/workers-types').D1Database | null} db
 * @param {string | null | undefined} userId
 * @param {string | null | undefined} workspaceId
 * @param {{ targetType?: string | null, connectionId?: string | null, tenantId?: string | null }} [opts]
 */
export async function getDefaultTerminalConnection(db, userId = null, workspaceId = null, opts = {}) {
  const targetTypeRaw = opts.targetType != null ? String(opts.targetType).trim() : '';
  if (!targetTypeRaw || targetTypeRaw === 'auto') {
    return null;
  }
  const sel = await getSelectedTerminalConnection(db, {
    userId,
    workspaceId,
    tenantId: opts.tenantId ?? null,
    connectionId: opts.connectionId ?? null,
    targetType: targetTypeRaw,
    healthAware: opts.healthAware !== false,
  });
  return sel.connection;
}

export function normalizeProvisionPlatformShell(platform, shell) {
  const pRaw = trim(platform).toLowerCase();
  const platformNorm = VALID_TERMINAL_PLATFORMS.includes(pRaw) ? pRaw : 'linux';
  const allowed = VALID_TERMINAL_SHELLS[platformNorm] || VALID_TERMINAL_SHELLS.linux;
  const shellRaw = trim(shell);
  return { platform: platformNorm, shell: allowed.includes(shellRaw) ? shellRaw : allowed[0] };
}

export async function listUserHostedTunnelConnections(db, userId, workspaceId = '') {
  if (!db || !userId) return [];
  const uid = trim(userId);
  const wid = trim(workspaceId);
  try {
    let sql = `SELECT ${HOSTED_CONN_SELECT}
      FROM terminal_connections
      WHERE user_id = ? AND target_type = 'user_hosted_tunnel'`;
    const binds = [uid];
    if (wid) {
      sql += ` AND (workspace_id = ? OR workspace_id IS NULL OR TRIM(COALESCE(workspace_id, '')) = '')`;
      binds.push(wid);
    }
    sql += ' ORDER BY is_default DESC, target_priority ASC, updated_at DESC LIMIT 50';
    const { results } = await db.prepare(sql).bind(...binds).all();
    return results || [];
  } catch {
    return [];
  }
}

export async function getUserHostedTunnelConnectionById(db, userId, connectionId) {
  if (!db || !userId || !connectionId) return null;
  try {
    return await db.prepare(
      `SELECT ${HOSTED_CONN_SELECT}
       FROM terminal_connections
       WHERE id = ? AND user_id = ? AND target_type = 'user_hosted_tunnel'
       LIMIT 1`,
    ).bind(trim(connectionId), trim(userId)).first();
  } catch {
    return null;
  }
}

export async function setDefaultUserHostedTunnelConnection(db, userId, workspaceId, connectionId) {
  if (!db || !userId || !workspaceId || !connectionId) return { ok: false, error: 'missing_context' };
  const uid = trim(userId);
  const wid = trim(workspaceId);
  const cid = trim(connectionId);
  const row = await getUserHostedTunnelConnectionById(db, uid, cid);
  if (!row?.id) return { ok: false, error: 'connection_not_found' };
  const rowWid = trim(row.workspace_id);
  if (rowWid && rowWid !== wid) return { ok: false, error: 'connection_forbidden' };
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    `UPDATE terminal_connections SET is_default = 0, updated_at = ?
     WHERE user_id = ? AND workspace_id = ? AND target_type = 'user_hosted_tunnel'`,
  ).bind(now, uid, wid).run();
  await db.prepare(
    `UPDATE terminal_connections SET is_default = 1, updated_at = ? WHERE id = ? AND user_id = ?`,
  ).bind(now, cid, uid).run();
  return { ok: true, connection_id: cid };
}

export async function createUserHostedTunnelConnection(db, opts = {}) {
  const userId = trim(opts.userId);
  const workspaceId = trim(opts.workspaceId);
  const tenantId = trim(opts.tenantId);
  if (!db || !userId || !workspaceId || !tenantId) {
    return { ok: false, error: 'missing_context', status: 400 };
  }
  const { platform, shell } = normalizeProvisionPlatformShell(opts.platform, opts.shell);
  const rawName = trim(opts.name || 'Remote machine');
  const name = rawName.slice(0, 120) || 'Remote machine';
  const connectionId = `conn_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const now = Math.floor(Date.now() / 1000);
  try {
    await db.prepare(
      `INSERT INTO terminal_connections
         (id, workspace_id, tenant_id, user_id, name, type, connection_type,
          ws_url, target_type, cwd_strategy, platform, shell, is_default, is_active,
          self_service_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pty', 'pty_tunnel',
          '', 'user_hosted_tunnel', 'host_default', ?, ?, 0, 0, 1, ?, ?)`,
    ).bind(connectionId, workspaceId, tenantId, userId, name, platform, shell, now, now).run();
  } catch (error) {
    return { ok: false, error: 'provision_failed', detail: error?.message || String(error), status: 500 };
  }
  return {
    ok: true,
    created: true,
    connection: { id: connectionId, name, platform, shell, is_active: false, ws_url_present: false, is_default: false },
  };
}

export function formatHostedTunnelConnectionRow(row) {
  if (!row) return null;
  const wsUrl = trim(row.ws_url);
  return {
    id: String(row.id),
    workspace_id: row.workspace_id != null ? String(row.workspace_id) : null,
    name: row.name != null ? String(row.name) : 'Remote machine',
    platform: row.platform ?? null,
    shell: row.shell ?? null,
    is_active: Number(row.is_active) === 1,
    is_default: Number(row.is_default) === 1,
    ws_url_present: !!wsUrl,
    hostname: wsUrl ? wsUrl.replace(/^wss?:\/\//i, '').split('/')[0] : null,
    updated_at: row.updated_at != null ? Number(row.updated_at) : null,
  };
}

export async function getUserHostedTunnelConnection(db, userId, workspaceId) {
  if (!db || !userId) return null;
  const uid = trim(userId);
  const wid = trim(workspaceId);
  const selectSql = `SELECT id, workspace_id, tenant_id, user_id, name, ws_url, target_type,
    platform, shell, is_active, is_default, cwd_strategy, updated_at
    FROM terminal_connections
    WHERE user_id = ? AND target_type = 'user_hosted_tunnel'`;
  try {
    if (wid) {
      const scoped = await db.prepare(
        `${selectSql} AND workspace_id = ? AND is_active = 1
         ORDER BY is_default DESC, target_priority ASC, updated_at DESC LIMIT 1`,
      ).bind(uid, wid).first();
      if (scoped?.ws_url) return scoped;
    }
    const global = await db.prepare(
      `${selectSql} AND is_active = 1
       AND (workspace_id IS NULL OR TRIM(COALESCE(workspace_id, '')) = '')
       ORDER BY is_default DESC, target_priority ASC, updated_at DESC LIMIT 1`,
    ).bind(uid).first();
    if (global?.ws_url) return global;
    return await db.prepare(
      `${selectSql} AND is_active = 1 AND ws_url IS NOT NULL AND TRIM(ws_url) != ''
       ORDER BY is_default DESC, target_priority ASC, updated_at DESC LIMIT 1`,
    ).bind(uid).first();
  } catch {
    return null;
  }
}

export async function provisionUserHostedTunnelConnection(db, opts = {}) {
  const userId = trim(opts.userId);
  const workspaceId = trim(opts.workspaceId);
  const tenantId = trim(opts.tenantId);
  if (!db || !userId || !workspaceId || !tenantId) {
    return { ok: false, error: 'missing_context', status: 400 };
  }
  const { platform, shell } = normalizeProvisionPlatformShell(opts.platform, opts.shell);
  if (opts.forceNew !== true) {
    const existing = await getUserHostedTunnelConnection(db, userId, workspaceId);
    if (existing?.id) {
      return {
        ok: true,
        created: false,
        connection: {
          id: String(existing.id),
          platform: existing.platform ?? platform,
          shell: existing.shell ?? shell,
          is_active: Number(existing.is_active) === 1,
          ws_url_present: !!trim(existing.ws_url),
        },
      };
    }
  }
  const connectionId = `conn_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const now = Math.floor(Date.now() / 1000);
  try {
    await db.prepare(
      `INSERT OR IGNORE INTO terminal_connections
         (id, workspace_id, tenant_id, user_id, name, type, connection_type,
          ws_url, target_type, cwd_strategy, platform, shell, is_default, is_active,
          self_service_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'Local Terminal', 'pty', 'pty_tunnel',
          '', 'user_hosted_tunnel', 'host_default', ?, ?, 0, 0, 1, ?, ?)`,
    ).bind(connectionId, workspaceId, tenantId, userId, platform, shell, now, now).run();
  } catch (error) {
    return { ok: false, error: 'provision_failed', detail: error?.message || String(error), status: 500 };
  }
  const row = await getUserHostedTunnelConnection(db, userId, workspaceId);
  if (!row?.id) return { ok: false, error: 'provision_failed', status: 500 };
  return {
    ok: true,
    created: true,
    connection: {
      id: String(row.id),
      platform: row.platform ?? platform,
      shell: row.shell ?? shell,
      is_active: Number(row.is_active) === 1,
      ws_url_present: !!trim(row.ws_url),
    },
  };
}

export function normalizeUserHostedTunnelWsUrl(raw) {
  let value = trim(raw);
  if (!value) return null;
  if (value.startsWith('https://')) value = `wss://${value.slice(8)}`;
  else if (value.startsWith('http://')) value = `ws://${value.slice(7)}`;
  else if (!value.startsWith('wss://') && !value.startsWith('ws://')) value = `wss://${value.replace(/^\/+/, '')}`;
  try {
    const url = new URL(value.split('?')[0]);
    if (url.protocol !== 'wss:' && url.protocol !== 'ws:') return null;
    if (!url.hostname) return null;
    return value.split('?')[0];
  } catch {
    return null;
  }
}

export async function activateUserHostedTunnelConnection(db, opts = {}) {
  const userId = trim(opts.userId);
  const workspaceId = trim(opts.workspaceId);
  if (!db || !userId || !workspaceId) return { ok: false, error: 'missing_context', status: 400 };
  const wsUrl = normalizeUserHostedTunnelWsUrl(opts.wsUrl);
  if (!wsUrl) return { ok: false, error: 'invalid_ws_url', status: 400 };
  const connectionId = trim(opts.connectionId);
  let row = null;
  if (connectionId) {
    row = await getUserHostedTunnelConnectionById(db, userId, connectionId);
    if (!row?.id) return { ok: false, error: 'connection_not_found', status: 404 };
    const rowWid = trim(row.workspace_id);
    if (rowWid && rowWid !== workspaceId) return { ok: false, error: 'connection_forbidden', status: 403 };
  } else {
    row = await getUserHostedTunnelConnection(db, userId, workspaceId);
    if (!row?.id) return { ok: false, error: 'connection_missing', status: 404 };
  }
  const id = String(row.id);
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    `UPDATE terminal_connections SET ws_url = ?, is_active = 1, updated_at = ? WHERE id = ? AND user_id = ?`,
  ).bind(wsUrl, now, id, userId).run();
  await setDefaultUserHostedTunnelConnection(db, userId, workspaceId, id);
  return { ok: true, connection: { id, ws_url_present: true, is_active: true } };
}

/** Resolve a persisted Agent-run dock lane to one concrete terminal connection. */
export async function resolveAgentRunTerminalConnection(db, agentRunId) {
  const runId = trim(agentRunId);
  if (!runId) {
    const error = new Error('agent_run_id_required');
    error.code = 'agent_run_id_required';
    throw error;
  }
  if (!db) {
    const error = new Error('db_required');
    error.code = 'db_required';
    throw error;
  }
  const row = await db.prepare(
    `SELECT user_id, workspace_id, tenant_id
       FROM agentsam_agent_run WHERE id = ? LIMIT 1`,
  ).bind(runId).first();
  if (!row) {
    const error = new Error('agent_run_not_found');
    error.code = 'agent_run_not_found';
    throw error;
  }
  const requestedLane = 'platform_vm';
  const targetType = requireTerminalConnectionTargetType(requestedLane);
  const userId = trim(row.user_id);
  const workspaceId = trim(row.workspace_id);
  if (!userId || !workspaceId) {
    const error = new Error('agent_run_scope_required');
    error.code = 'agent_run_scope_required';
    throw error;
  }
  const selected = await getSelectedTerminalConnection(db, {
    userId,
    workspaceId,
    tenantId: trim(row.tenant_id) || null,
    targetType,
    healthAware: true,
  });
  const connectionId = trim(selected?.connection?.id);
  if (!connectionId) {
    const error = new Error(selected?.error || 'connection_missing');
    error.code = selected?.error || 'connection_missing';
    throw error;
  }
  return { target_type: targetType, connection_id: connectionId, requested_lane: requestedLane };
}

/** Bind the user's PTY token secret marker to one local terminal connection. */
export async function setUserHostedTunnelConnectionAuth(db, opts = {}) {
  const userId = trim(opts.userId);
  const workspaceId = trim(opts.workspaceId);
  const connectionId = trim(opts.connectionId);
  const secretName = trim(opts.secretName);
  const authMode = trim(opts.authMode) || 'secret_name';
  if (!db || !userId || !workspaceId || !connectionId || !secretName) {
    return { ok: false, error: 'missing_context' };
  }
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    `UPDATE terminal_connections
     SET auth_token_secret_name = ?, auth_mode = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND workspace_id = ? AND target_type = 'user_hosted_tunnel'`,
  ).bind(secretName, authMode, now, connectionId, userId, workspaceId).run();
  return { ok: true };
}

/** Disable all local device connections for one actor/workspace after PTY token revocation. */
export async function deactivateUserHostedTunnelConnections(db, opts = {}) {
  const userId = trim(opts.userId);
  const workspaceId = trim(opts.workspaceId);
  if (!db || !userId || !workspaceId) return { ok: false, error: 'missing_context' };
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    `UPDATE terminal_connections
     SET is_active = 0, updated_at = ?
     WHERE user_id = ? AND workspace_id = ? AND target_type = 'user_hosted_tunnel'`,
  ).bind(now, userId, workspaceId).run();
  return { ok: true };
}

/** Validate that the local lane has a provisioned user device tunnel. */
export async function validateUserLocalTerminalAccess(db, userId, workspaceId) {
  const uid = trim(userId);
  const wid = trim(workspaceId);
  if (!uid) return { ok: false, error: 'auth_required', user_message: 'Sign in to use agentsam_terminal_local.' };
  if (!db) return { ok: false, error: 'db_unavailable', user_message: 'Terminal provisioning check unavailable.' };
  const conn = await getUserHostedTunnelConnection(db, uid, wid || null);
  if (!conn?.ws_url) return {
    ok: false,
    error: 'user_hosted_tunnel_not_provisioned',
    user_message: 'No device tunnel configured for your account. Install cloudflared and complete Settings → Terminal once — the same tunnel works for every workspace/repo you open.',
  };
  return { ok: true };
}
