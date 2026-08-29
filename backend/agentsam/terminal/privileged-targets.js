/**
 * D1-driven sudo / privileged ops policy per terminal_connections target.
 * Mac and unlisted targets stay locked unless a row exists in agentsam_privileged_targets.
 */

/** @typedef {{ allowed: true, sudoersUser?: string|null, target?: object|null }} SudoAllowed */
/** @typedef {{ allowed: false, reason: string }} SudoDenied */

/**
 * Normalize sudo operand to allowlist token (apt, systemctl, cloudflared, workspace, …).
 * Supports /usr/local/sbin/iam-ops-* wrappers and bare binaries.
 * @param {string} command
 * @returns {string|null}
 */
export function sudoAllowlistTokenFromCommand(command) {
  const trimmed = String(command || '').trim();
  if (!/\bsudo\b/i.test(trimmed)) return null;

  const segments = trimmed.split(/\s*(?:&&|\|\||\||;)\s*/);
  const tokens = [];
  for (const segment of segments) {
    const parts = segment.trim().split(/\s+/);
    if (!parts.length || !/^sudo$/i.test(parts[0])) continue;
    const cmdWord = parts[1];
    if (!cmdWord) return null;
    const base = cmdWord.replace(/^.*\//, '');
    if (base.startsWith('iam-ops-')) {
      tokens.push(base.slice('iam-ops-'.length));
      continue;
    }
    if (base === 'apt-get') {
      tokens.push('apt');
      continue;
    }
    tokens.push(base);
  }
  return tokens.length ? tokens[tokens.length - 1] : null;
}

/**
 * @param {string|null|undefined} allowedCommandsJson
 * @param {string} command
 * @returns {boolean}
 */
export function commandMatchesAllowedList(allowedCommandsJson, command) {
  if (!allowedCommandsJson) return true;
  let allowed;
  try {
    allowed = JSON.parse(String(allowedCommandsJson));
  } catch {
    return false;
  }
  if (!Array.isArray(allowed) || allowed.length === 0) return true;

  const trimmed = String(command || '').trim();
  const segments = trimmed.split(/\s*(?:&&|\|\||\||;)\s*/);
  for (const segment of segments) {
    const parts = segment.trim().split(/\s+/);
    if (!parts.length || !/^sudo$/i.test(parts[0])) continue;
    const token = sudoAllowlistTokenFromCommand(segment);
    if (!token || !allowed.includes(token)) return false;
  }
  return true;
}

/**
 * Resolve privileged target lookup id from a terminal_connections row id.
 * @param {import('@cloudflare/workers-types').D1Database|null|undefined} db
 * @param {string|null|undefined} connectionId
 * @returns {Promise<string|null>}
 */
export async function resolvePrivilegedTargetLookupId(db, connectionId) {
  const cid = String(connectionId || '').trim();
  if (!cid || !db) return cid || null;
  try {
    const row = await db
      .prepare(
        `SELECT privileged_target_id FROM terminal_connections WHERE id = ? LIMIT 1`,
      )
      .bind(cid)
      .first();
    const mapped = row?.privileged_target_id != null ? String(row.privileged_target_id).trim() : '';
    return mapped || cid;
  } catch {
    return cid;
  }
}

/**
 * @param {import('@cloudflare/workers-types').D1Database|null|undefined} db
 * @param {string|null|undefined} targetId terminal_connections.id or privileged_target_id
 * @returns {Promise<object|null>}
 */
export async function loadPrivilegedTarget(db, targetId) {
  const lookup = String(targetId || '').trim();
  if (!lookup || !db) return null;
  try {
    return await db
      .prepare(
        `SELECT * FROM agentsam_privileged_targets
         WHERE target_id = ? AND enabled = 1
         LIMIT 1`,
      )
      .bind(lookup)
      .first();
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, unknown>|null|undefined} env
 * @param {string|null|undefined} targetId
 * @param {string} command
 * @returns {Promise<SudoAllowed|SudoDenied>}
 */
export async function checkSudoPermission(env, targetId, command) {
  const cmd = String(command || '').trim();
  if (!/\bsudo\b/i.test(cmd)) {
    return { allowed: true };
  }

  const escalation = [
    /\bsudo\s+-[uSgH]/i,
    /\bsudo\s+--(?:user|group|login)=/i,
    /\bsudo\s+su\b/i,
    /\bsudo\s+\/bin\/(?:ba)?sh\b/i,
    /\bsudo\s+\/usr\/bin\/(?:ba)?sh\b/i,
  ];
  for (const pattern of escalation) {
    if (pattern.test(cmd)) {
      return { allowed: false, reason: 'sudo privilege escalation not permitted' };
    }
  }

  const db = env?.DB;
  const lookupId = await resolvePrivilegedTargetLookupId(db, targetId);
  const target = await loadPrivilegedTarget(db, lookupId);

  if (!target) {
    return { allowed: false, reason: 'sudo not permitted: target not in privileged allowlist' };
  }

  const mode = String(target.privilege_mode || 'none').trim();
  if (mode === 'none') {
    return { allowed: false, reason: 'sudo not permitted: target explicitly disabled' };
  }

  if (mode === 'full_sudo') {
    return { allowed: true, sudoersUser: target.sudoers_user ?? null, target };
  }

  if (mode === 'scoped_sudo') {
    if (!commandMatchesAllowedList(target.allowed_commands, cmd)) {
      const token = sudoAllowlistTokenFromCommand(cmd);
      return {
        allowed: false,
        reason: token
          ? `sudo not permitted: '${token}' not in allowlist for this target`
          : 'sudo not permitted: command not in allowlist for this target',
      };
    }
    return { allowed: true, sudoersUser: target.sudoers_user ?? null, target };
  }

  return { allowed: false, reason: 'sudo not permitted: unknown privilege_mode' };
}

/**
 * @param {SudoDenied} check
 * @returns {{ ok: false, error: string, blocked: true, detail: { stderr: string } }}
 */
export function formatTerminalExec403(check) {
  return {
    ok: false,
    error: 'terminal_exec_403',
    blocked: true,
    detail: { stderr: `IAM Security: blocked: ${check.reason}` },
  };
}

/**
 * Tunnel-owner session flag for ExecOS Operator-Cwd.
 * Does not skip ExecOS — only stamps X-IAM-Operator-Cwd when this auth user is the owner
 * (exact tunnel_owner_user_id, or same person_uuid via userIdIsIamTunnelOwner).
 *
 * @param {any} env
 * @param {import('@cloudflare/workers-types').D1Database|null|undefined} db
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function resolveIsTunnelOwnerSession(env, db, userId) {
  const uid = String(userId || '').trim();
  if (!uid) return false;
  const runtimeEnv = env || (db ? { DB: db } : null);
  if (!runtimeEnv) return false;
  try {
    const { userIdIsIamTunnelOwner } = await import('../../identity/workspace/grants.js');
    return (await userIdIsIamTunnelOwner(runtimeEnv, uid)) === true;
  } catch {
    return false;
  }
}

/**
 * Resolve on-box exec identity for audit + transport headers (distinct from auth_users).
 *
 * platform_vm:
 *   - Session user_id matches terminal_connections.user_id on conn_gcp_iam_tunnel →
 *     logical execUser = owner Unix user (authorizing human on this host)
 *   - Everyone else → logical execUser = tunnel_daemon_unix_user (agent plane)
 *   - transportExecUser always = daemon Unix (ExecOS process user)
 * user_hosted_tunnel (Mac):
 *   - Exec-Identity stays the host OS login (unchanged)
 *   - isTunnelOwner uses the same owner check so Operator-Cwd can authorize operator-repo cwd
 * Do not trust terminal_connections.remote_exec_user alone to escalate to owner Unix.
 *
 * @param {import('@cloudflare/workers-types').D1Database|null|undefined} db
 * @param {Record<string, unknown>|null|undefined} connection
 * @param {object|null|undefined} privilegedTarget
 * @param {{ env?: any, userId?: string|null, workspaceId?: string|null }} [opts]
 * @returns {Promise<{
 *   execUser: string|null,
 *   transportExecUser: string|null,
 *   sshIdentitySecret: string|null,
 *   privilegedTargetId: string|null,
 *   isTunnelOwner: boolean,
 * }>}
 */
export async function resolveTerminalExecIdentity(
  db,
  connection,
  privilegedTarget = null,
  opts = {},
) {
  let conn = connection && typeof connection === 'object' ? { ...connection } : null;
  // Always merge identity columns from D1 by id. DO-cached / health-slim rows often omit them.
  if (db && conn?.id) {
    try {
      const full = await db
        .prepare(
          `SELECT username, remote_exec_user, platform, target_type, privileged_target_id, ssh_identity_secret_name, user_id, workspace_id
           FROM terminal_connections WHERE id = ? LIMIT 1`,
        )
        .bind(String(conn.id))
        .first();
      if (full && typeof full === 'object') conn = { ...conn, ...full };
    } catch (_) {
      /* keep row as-is */
    }
  }
  let privilegedTargetId =
    conn?.privileged_target_id != null ? String(conn.privileged_target_id).trim() : '';
  if (!privilegedTargetId && conn?.id) {
    privilegedTargetId = await resolvePrivilegedTargetLookupId(db, String(conn.id));
  }
  const target = privilegedTarget || (privilegedTargetId ? await loadPrivilegedTarget(db, privilegedTargetId) : null);
  const platform = conn?.platform != null ? String(conn.platform).trim().toLowerCase() : '';
  const targetType = conn?.target_type != null ? String(conn.target_type).trim() : '';
  const username = conn?.username != null ? String(conn.username).trim() : '';
  const rowRemote =
    conn?.remote_exec_user != null ? String(conn.remote_exec_user).trim() : '';
  const sudoers =
    target?.sudoers_user != null ? String(target.sudoers_user).trim() : '';

  const userId =
    (opts?.userId != null ? String(opts.userId).trim() : '') ||
    (conn?.user_id != null ? String(conn.user_id).trim() : '');
  const workspaceId =
    (opts?.workspaceId != null ? String(opts.workspaceId).trim() : '') ||
    (conn?.workspace_id != null ? String(conn.workspace_id).trim() : '');
  const env = opts?.env || null;
  const runtimeEnv = env || (db ? { DB: db } : null);

  let execUser = null;
  let transportExecUser = null;
  let isTunnelOwner = false;

  if (targetType === 'platform_vm') {
    let daemonUnix =
      (sudoers || '') ||
      (target?.sudoers_user != null ? String(target.sudoers_user).trim() : '');
    let ownerUnix = null;

    if (runtimeEnv) {
      try {
        const { userIdIsIamTunnelOwner } = await import('../../identity/workspace/grants.js');
        const { loadIamTunnelOwnerConfig } = await import('../../../backend/identity/workspace/tunnel-owner.js');
        const cfg = await loadIamTunnelOwnerConfig(runtimeEnv);
        if (cfg?.daemonUnixUser) daemonUnix = daemonUnix || cfg.daemonUnixUser;
        if (userId) {
          isTunnelOwner = await userIdIsIamTunnelOwner(runtimeEnv, userId);
          if (isTunnelOwner) ownerUnix = cfg?.unixUser || null;
        }
      } catch (_) {
        isTunnelOwner = false;
        ownerUnix = null;
      }
    }

    // Fail closed when daemon identity cannot be resolved from D1/target.
    if (!daemonUnix) {
      execUser = null;
      transportExecUser = null;
    } else {
      execUser = isTunnelOwner && ownerUnix ? ownerUnix : daemonUnix;
      transportExecUser = daemonUnix;
    }
  } else {
    // Mac / device tunnel: X-IAM-Exec-Identity must match the OS login on that host.
    execUser =
      rowRemote ||
      sudoers ||
      (targetType === 'user_hosted_tunnel' && (platform === 'macos' || platform === 'darwin')
        ? username || null
        : null) ||
      null;
    transportExecUser = execUser;
    // ExecOS still requires X-IAM-Operator-Cwd for operator-repo cwd. Stamp it for
    // the tunnel owner on Mac local too — VM already did; sandbox must not.
    if (userId && targetType === 'user_hosted_tunnel') {
      isTunnelOwner = await resolveIsTunnelOwnerSession(env, db, userId);
    }
  }

  const sshIdentitySecret =
    conn?.ssh_identity_secret_name != null ? String(conn.ssh_identity_secret_name).trim() : null;
  return {
    execUser,
    transportExecUser,
    sshIdentitySecret,
    privilegedTargetId: privilegedTargetId || (target?.target_id != null ? String(target.target_id) : null),
    isTunnelOwner: !!isTunnelOwner,
  };
}

/** @param {{ execUser?: string|null, transportExecUser?: string|null, privilegedTargetId?: string|null, userId?: string|null, isTunnelOwner?: boolean }} identity */
export function buildExecTransportHeaders(identity = {}) {
  const headers = { 'Content-Type': 'application/json' };
  // Prefer transportExecUser (daemon wire) when set; else logical execUser.
  const logical =
    identity.execUser != null ? String(identity.execUser).trim() : '';
  const transport =
    (identity.transportExecUser != null ? String(identity.transportExecUser).trim() : '') ||
    logical;
  if (transport) headers['X-IAM-Exec-Identity'] = transport;
  // Tracking only: owner Unix : daemon Unix when an agent runs on the owner's behalf.
  if (logical && transport && logical !== transport) {
    headers['X-IAM-Exec-Actor'] = `${logical}:${transport}`;
  } else if (logical) {
    headers['X-IAM-Exec-Actor'] = logical;
  }
  const pt = identity.privilegedTargetId != null ? String(identity.privilegedTargetId).trim() : '';
  if (pt) headers['X-IAM-Privileged-Target'] = pt;
  const userId = identity.userId != null ? String(identity.userId).trim() : '';
  if (userId) headers['X-User-Id'] = userId;
  if (identity.isTunnelOwner === true) headers['X-IAM-Operator-Cwd'] = '1';
  return headers;
}
