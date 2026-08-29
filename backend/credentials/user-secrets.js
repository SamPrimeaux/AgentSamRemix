/**
 * Per-user encrypted secrets (PTY auth tokens) — USER_SECRET_ENCRYPTION_KEY only.
 * Not VAULT_MASTER_KEY / AGENTSAM_BRIDGE_KEY (internal worker trust).
 */
import { logSecretAudit } from '../../src/core/security-scan.js';

export const USER_PTY_TOKEN_SENTINEL = 'user_pty_token';
export const PTY_AUTH_SECRET_NAME = 'pty_auth_token';
export const PTY_AUTH_SERVICE_NAME = 'iam_pty';
export const TUNNEL_META_SECRET_NAME = 'tunnel_meta';
export const TUNNEL_META_SERVICE_NAME = 'cfd_tunnel';

/** Per-connection tunnel metadata secret (multi-machine hosted tunnels). */
export function tunnelMetaSecretName(connectionId = '') {
  const id = String(connectionId || '').trim();
  return id ? `tunnel_meta_${id}` : TUNNEL_META_SECRET_NAME;
}

export const CF_CREDENTIALS_HELP = {
  error: 'cloudflare_credentials_missing',
  message: 'Add your Cloudflare API token in Settings → API Keys first.',
  required_scopes: [
    'Account → Cloudflare Tunnel → Edit',
    'Zone → DNS → Edit (only your zones)',
    'Account → Account → Read',
  ],
  setup_url: 'https://dash.cloudflare.com/profile/api-tokens',
};

function hexToBytes(hex) {
  const h = String(hex || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(h)) {
    throw new Error('encryption_key_invalid');
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function requireEncryptionKey(env) {
  const keyHex = String(env?.USER_SECRET_ENCRYPTION_KEY || '').trim();
  if (!keyHex) throw new Error('encryption_key_missing');
  return hexToBytes(keyHex);
}

async function importAesKey(env) {
  const keyBytes = requireEncryptionKey(env);
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** @returns {Promise<{ ciphertext: string, iv: string }>} */
export async function encryptUserSecret(env, plaintext) {
  const key = await importAesKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(String(plaintext ?? '')),
  );
  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(enc))),
    iv: btoa(String.fromCharCode(...iv)),
  };
}

/** @returns {Promise<string | null>} */
export async function decryptUserSecret(env, ciphertext, iv) {
  try {
    const key = await importAesKey(env);
    const ivBytes = Uint8Array.from(atob(String(iv || '')), (c) => c.charCodeAt(0));
    const ctBytes = Uint8Array.from(atob(String(ciphertext || '')), (c) => c.charCodeAt(0));
    const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, key, ctBytes);
    return new TextDecoder().decode(dec);
  } catch (_) {
    return null;
  }
}

export function generatePtyToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function tokenLast4(token) {
  const s = String(token || '').trim();
  return s.length >= 4 ? s.slice(-4) : s || '????';
}

function packEncryptedPayload(enc) {
  return JSON.stringify({ v: 1, iv: enc.iv, ct: enc.ciphertext });
}

function unpackEncryptedPayload(raw) {
  try {
    const o = JSON.parse(String(raw || ''));
    if (o?.iv && o?.ct) return { iv: String(o.iv), ciphertext: String(o.ct) };
  } catch (_) {}
  return null;
}

/** @type {Set<string> | null} */
let userSecretsColumnsCache = null;

async function userSecretsColumns(db) {
  if (userSecretsColumnsCache) return userSecretsColumnsCache;
  const res = await db.prepare(`PRAGMA table_info(user_secrets)`).all();
  userSecretsColumnsCache = new Set((res.results || []).map((r) => String(r.name)));
  return userSecretsColumnsCache;
}

/**
 * @param {Record<string, unknown>} env
 * @param {{ userId: string, tenantId: string, workspaceId?: string | null, secretName: string, serviceName: string, plaintextValue: string, description?: string, secretType?: string }} opts
 */
export async function upsertUserSecret(env, opts) {
  if (!env?.DB) return { ok: false, error: 'db_missing' };
  const userId = String(opts.userId || '').trim();
  const tenantId = String(opts.tenantId || '').trim();
  const secretName = String(opts.secretName || '').trim();
  const serviceName = String(opts.serviceName || '').trim();
  const plaintext = String(opts.plaintextValue ?? '');
  if (!userId || !tenantId || !secretName || !serviceName || !plaintext) {
    return { ok: false, error: 'missing_fields' };
  }

  let enc;
  try {
    enc = await encryptUserSecret(env, plaintext);
  } catch (e) {
    const msg = e?.message === 'encryption_key_missing' ? 'encryption_key_missing' : 'encrypt_failed';
    return { ok: false, error: msg };
  }

  const secretType = String(opts.secretType || 'token').trim() || 'token';
  const last4 = opts.last4 != null ? String(opts.last4).slice(-4) : tokenLast4(plaintext);
  const payload = packEncryptedPayload(enc);
  const metadata = JSON.stringify({ last4 });
  const now = Math.floor(Date.now() / 1000);
  const cols = await userSecretsColumns(env.DB);

  const existing = await env.DB.prepare(
    `SELECT id, metadata_json FROM user_secrets
     WHERE user_id = ? AND secret_name = ? AND service_name = ?
     LIMIT 1`,
  )
    .bind(userId, secretName, serviceName)
    .first()
    .catch(() => null);

  let secretId;
  let previousLast4 = null;
  if (existing?.id) {
    secretId = String(existing.id);
    try {
      const m = JSON.parse(String(existing.metadata_json || '{}'));
      if (m?.last4) previousLast4 = String(m.last4);
    } catch (_) {}
    const sets = [
      'secret_value_encrypted = ?',
      'metadata_json = ?',
      'secret_type = ?',
      'description = ?',
      'is_active = 1',
      'updated_at = ?',
    ];
    const binds = [
      payload,
      metadata,
      secretType,
      opts.description || null,
      now,
    ];
    if (cols.has('tenant_id')) {
      /* tenant_id fixed on update */
    }
    if (cols.has('workspace_id') && opts.workspaceId) {
      sets.push('workspace_id = ?');
      binds.push(String(opts.workspaceId).trim());
    }
    binds.push(secretId, userId);
    await env.DB.prepare(
      `UPDATE user_secrets SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
    )
      .bind(...binds)
      .run();
  } else {
    secretId = `usec_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const fields = [
      'id',
      'user_id',
      'tenant_id',
      'secret_name',
      'secret_value_encrypted',
      'secret_type',
      'description',
      'service_name',
      'metadata_json',
      'is_active',
      'created_at',
      'updated_at',
    ];
    const vals = ['?', '?', '?', '?', '?', '?', '?', '?', '?', '1', '?', '?'];
    const binds = [
      secretId,
      userId,
      tenantId,
      secretName,
      payload,
      secretType,
      opts.description || null,
      serviceName,
      metadata,
      now,
      now,
    ];
    if (cols.has('workspace_id') && opts.workspaceId) {
      fields.push('workspace_id');
      vals.push('?');
      binds.push(String(opts.workspaceId).trim());
    }
    await env.DB.prepare(
      `INSERT INTO user_secrets (${fields.join(', ')}) VALUES (${vals.join(', ')})`,
    )
      .bind(...binds)
      .run();
  }

  return { ok: true, secretId, last4, previousLast4 };
}

/** @returns {Promise<Record<string, unknown> | null>} */
export async function resolveUserTunnelMeta(env, userId, workspaceId, connectionId = null) {
  if (!env?.DB || !userId) return null;
  const uid = String(userId).trim();
  const secretName = tunnelMetaSecretName(connectionId);
  const row = await env.DB.prepare(
    `SELECT secret_value_encrypted FROM user_secrets
     WHERE user_id = ? AND secret_name = ? AND service_name = ? AND is_active = 1
     LIMIT 1`,
  )
    .bind(uid, secretName, TUNNEL_META_SERVICE_NAME)
    .first()
    .catch(() => null);
  if (!row?.secret_value_encrypted) {
    if (connectionId) return null;
    // Legacy single-tunnel row (pre multi-connection).
    const legacy = await env.DB.prepare(
      `SELECT secret_value_encrypted FROM user_secrets
       WHERE user_id = ? AND secret_name = ? AND service_name = ? AND is_active = 1
       LIMIT 1`,
    )
      .bind(uid, TUNNEL_META_SECRET_NAME, TUNNEL_META_SERVICE_NAME)
      .first()
      .catch(() => null);
    if (!legacy?.secret_value_encrypted) return null;
    const packed = unpackEncryptedPayload(legacy.secret_value_encrypted);
    if (!packed) return null;
    const plain = await decryptUserSecret(env, packed.ciphertext, packed.iv);
    if (!plain) return null;
    try {
      return JSON.parse(plain);
    } catch (_) {
      return null;
    }
  }
  const packed = unpackEncryptedPayload(row.secret_value_encrypted);
  if (!packed) return null;
  const plain = await decryptUserSecret(env, packed.ciphertext, packed.iv);
  if (!plain) return null;
  try {
    return JSON.parse(plain);
  } catch (_) {
    return null;
  }
}

/** @returns {Promise<string | null>} */
export async function resolveUserPtyToken(env, userId, workspaceId) {
  if (!env?.DB || !userId) return null;
  const uid = String(userId).trim();
  const cols = await userSecretsColumns(env.DB);
  let row = null;
  if (workspaceId && cols.has('workspace_id')) {
    row = await env.DB.prepare(
      `SELECT secret_value_encrypted FROM user_secrets
       WHERE user_id = ? AND secret_name = ? AND service_name = ? AND is_active = 1
         AND (workspace_id = ? OR workspace_id IS NULL OR workspace_id = '')
       ORDER BY CASE WHEN workspace_id = ? THEN 0 ELSE 1 END, updated_at DESC
       LIMIT 1`,
    )
      .bind(uid, PTY_AUTH_SECRET_NAME, PTY_AUTH_SERVICE_NAME, String(workspaceId).trim(), String(workspaceId).trim())
      .first()
      .catch(() => null);
  }
  if (!row) {
    row = await env.DB.prepare(
      `SELECT secret_value_encrypted FROM user_secrets
       WHERE user_id = ? AND secret_name = ? AND service_name = ? AND is_active = 1
       LIMIT 1`,
    )
      .bind(uid, PTY_AUTH_SECRET_NAME, PTY_AUTH_SERVICE_NAME)
      .first()
      .catch(() => null);
  }
  if (!row?.secret_value_encrypted) return null;
  const packed = unpackEncryptedPayload(row.secret_value_encrypted);
  if (!packed) return null;
  return decryptUserSecret(env, packed.ciphertext, packed.iv);
}

/**
 * @param {Record<string, unknown>} env
 */
export async function writeSecretAuditLog(env, opts) {
  try {
    await logSecretAudit(env, {
      secretId: opts.secretId,
      tenantId: opts.tenantId,
      userId: opts.userId,
      eventType: opts.eventType,
      triggeredBy: opts.triggeredBy,
      previousLast4: opts.previousLast4 ?? null,
      newLast4: opts.newLast4 ?? null,
      notes: opts.notes ?? null,
      ipAddress: opts.ipAddress ?? null,
      userAgent: opts.userAgent ?? null,
      secretSource: opts.secretSource || 'user_secrets',
    });
  } catch (_) {}
}

function auditFromRequest(request) {
  return {
    ipAddress: request?.headers?.get('cf-connecting-ip') || request?.headers?.get('x-forwarded-for') || null,
    userAgent: request?.headers?.get('user-agent') || null,
  };
}

/**
 * @param {Record<string, unknown>} env
 * @param {import('../../src/core/auth.js').AuthUser} authUser
 * @param {string} workspaceId
 * @param {Request} request
 * @param {{ rotate?: boolean }} [opts]
 */
export async function generateUserPtyAuthToken(env, authUser, workspaceId, request, opts = {}, deps = {}) {
  try {
    requireEncryptionKey(env);
  } catch (e) {
    return { ok: false, error: e?.message || 'encryption_key_missing', status: 500 };
  }

  const userId = String(authUser.id).trim();
  const wid = String(workspaceId).trim();
  const { resolvePtyTenantIdForUser } = await import('../agentsam/terminal/pty-workspace-paths.js');
  const tenantId = await resolvePtyTenantIdForUser(env, authUser, userId);
  if (!tenantId) return { ok: false, error: 'tenant_missing', status: 403 };

  const token = generatePtyToken();
  const upsert = await upsertUserSecret(env, {
    userId,
    tenantId,
    workspaceId: wid,
    secretName: PTY_AUTH_SECRET_NAME,
    serviceName: PTY_AUTH_SERVICE_NAME,
    plaintextValue: token,
    description: 'PTY bridge authentication token — used by ExecOS',
  });
  if (!upsert.ok) return { ok: false, error: upsert.error, status: 500 };

  const { getUserHostedTunnelConnection, provisionUserHostedTunnelConnection, setUserHostedTunnelConnectionAuth } = deps;
  let conn = await getUserHostedTunnelConnection(env.DB, userId, wid);
  if (!conn?.id) {
    const prov = await provisionUserHostedTunnelConnection(env.DB, { userId, workspaceId: wid, tenantId });
    if (!prov.ok) return { ok: false, error: prov.error || 'provision_failed', status: prov.status || 500 };
    conn = await getUserHostedTunnelConnection(env.DB, userId, wid);
  }
  const connectionId = conn?.id ? String(conn.id) : null;
  if (connectionId) {
    await setUserHostedTunnelConnectionAuth(env.DB, { userId, workspaceId: wid, connectionId, secretName: USER_PTY_TOKEN_SENTINEL, authMode: 'secret_name' }).catch(() => {});
  }

  const audit = auditFromRequest(request);
  await writeSecretAuditLog(env, {
    secretId: upsert.secretId,
    secretSource: 'user_secrets',
    tenantId,
    userId,
    eventType: opts.rotate ? 'rotated' : 'created',
    triggeredBy: userId,
    previousLast4: upsert.previousLast4,
    newLast4: upsert.last4,
    notes: 'PTY auth token generated from dashboard',
    ...audit,
  });

  return {
    ok: true,
    token,
    last4: upsert.last4,
    connection_id: connectionId,
    instructions:
      'Set this as PTY_AUTH_TOKEN in your ExecOS .env file. It will not be shown again.',
  };
}

/**
 * @param {Record<string, unknown>} env
 * @param {string} userId
 * @param {string} workspaceId
 */
export async function getUserPtyAuthTokenStatus(env, userId, workspaceId, deps = {}) {
  const uid = String(userId).trim();
  const wid = String(workspaceId).trim();
  const row = await env.DB.prepare(
    `SELECT id, metadata_json, created_at, updated_at, is_active
     FROM user_secrets
     WHERE user_id = ? AND secret_name = ? AND service_name = ?
     LIMIT 1`,
  )
    .bind(uid, PTY_AUTH_SECRET_NAME, PTY_AUTH_SERVICE_NAME)
    .first()
    .catch(() => null);

  const conn = await deps.getUserHostedTunnelConnection?.(env.DB, uid, wid) || null;
  let last4 = null;
  if (row?.metadata_json) {
    try {
      const m = JSON.parse(String(row.metadata_json));
      if (m?.last4) last4 = String(m.last4);
    } catch (_) {}
  }

  return {
    ok: true,
    has_token: !!(row && Number(row.is_active) === 1),
    last4,
    created_at: row?.created_at ?? null,
    updated_at: row?.updated_at ?? null,
    connection_id: conn?.id ? String(conn.id) : null,
    connection_active: !!(conn && Number(conn.is_active) === 1),
  };
}

/**
 * @param {Record<string, unknown>} env
 * @param {import('../../src/core/auth.js').AuthUser} authUser
 * @param {string} workspaceId
 * @param {Request} request
 */
export async function revokeUserPtyAuthToken(env, authUser, workspaceId, request, deps = {}) {
  const userId = String(authUser.id).trim();
  const wid = String(workspaceId).trim();
  const { resolvePtyTenantIdForUser } = await import('../agentsam/terminal/pty-workspace-paths.js');
  const tenantId = await resolvePtyTenantIdForUser(env, authUser, userId);
  if (!tenantId) return { ok: false, error: 'tenant_missing', status: 403 };

  const row = await env.DB.prepare(
    `SELECT id, metadata_json FROM user_secrets
     WHERE user_id = ? AND secret_name = ? AND service_name = ? AND is_active = 1
     LIMIT 1`,
  )
    .bind(userId, PTY_AUTH_SECRET_NAME, PTY_AUTH_SERVICE_NAME)
    .first()
    .catch(() => null);

  let previousLast4 = null;
  if (row?.metadata_json) {
    try {
      const m = JSON.parse(String(row.metadata_json));
      if (m?.last4) previousLast4 = String(m.last4);
    } catch (_) {}
  }

  const now = Math.floor(Date.now() / 1000);
  if (row?.id) {
    await env.DB.prepare(
      `UPDATE user_secrets SET is_active = 0, updated_at = ? WHERE id = ? AND user_id = ?`,
    )
      .bind(now, String(row.id), userId)
      .run()
      .catch(() => {});
  }

  await deps.deactivateUserHostedTunnelConnections?.(env.DB, { userId, workspaceId: wid }).catch(() => {});

  if (row?.id) {
    const audit = auditFromRequest(request);
    await writeSecretAuditLog(env, {
      secretId: String(row.id),
      secretSource: 'user_secrets',
      tenantId,
      userId,
      eventType: 'revoked',
      triggeredBy: userId,
      previousLast4,
      newLast4: null,
      notes: 'PTY auth token revoked from dashboard',
      ...audit,
    });
  }

  return { ok: true, revoked: !!row?.id };
}
