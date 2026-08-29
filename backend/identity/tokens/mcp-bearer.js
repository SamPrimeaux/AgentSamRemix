/**
 * HMAC-based MCP bearer token system.
 *
 * One signing key (TOKEN_SIGNING_KEY), unlimited users, zero per-user secrets.
 */
import { resolveFirstMembershipWorkspaceId } from '../workspace/membership.js';

function b64EncodeUtf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function b64DecodeUtf8(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function trimId(value) {
  return value == null ? '' : String(value).trim();
}

async function signPayload(payload, signingKey) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(signingKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function resolvePlatformMasterFromDb(env, bearer) {
  const isMcp = env.MCP_AUTH_TOKEN && bearer === env.MCP_AUTH_TOKEN;
  const isBridge = env.AGENTSAM_BRIDGE_KEY && bearer === env.AGENTSAM_BRIDGE_KEY;
  if (!isMcp && !isBridge) return null;

  const userId = trimId(env.MCP_AUTH_IDENTITY_USER_ID);
  if (!userId || !userId.startsWith('au_') || !env?.DB) return null;
  let row = null;
  try {
    row = await env.DB.prepare(
      `SELECT id, tenant_id, active_workspace_id, active_tenant_id
       FROM auth_users WHERE id = ? LIMIT 1`,
    ).bind(userId).first();
  } catch {
    return null;
  }
  if (!row?.id) return null;

  const tenantId = trimId(row.active_tenant_id) || trimId(row.tenant_id) || null;
  const workspaceId =
    trimId(row.active_workspace_id) ||
    (await resolveFirstMembershipWorkspaceId(env, userId));
  if (!workspaceId || !tenantId) return null;
  return {
    userId,
    workspaceId,
    tenantId,
    tokenType: isBridge ? 'bridge' : 'master',
    allowedTools: null,
    rateLimitPerHour: null,
    tokenId: null,
  };
}

export async function generateMcpToken(
  env,
  { userId, workspaceId, tenantId, label, allowedTools = null, rateLimitPerHour = 1000, expiresInDays = null },
) {
  if (!env?.TOKEN_SIGNING_KEY) throw new Error('TOKEN_SIGNING_KEY not set');
  const uid = trimId(userId);
  if (!uid) throw new Error('userId required for MCP token');

  const jti = `tok_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const iat = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ userId: uid, workspaceId, tenantId, iat, jti });
  const b64 = b64EncodeUtf8(payload);
  const hmac = await signPayload(b64, env.TOKEN_SIGNING_KEY);
  const bearer = `${b64}.${hmac}`;
  const expiresAt = expiresInDays
    ? Math.floor(Date.now() / 1000) + expiresInDays * 86400
    : null;

  await env.DB.prepare(`
    INSERT INTO mcp_workspace_tokens
      (id, workspace_id, tenant_id, user_id, label, token_hash,
       allowed_tools, rate_limit_per_hour, is_active, expires_at)
    VALUES (?,?,?,?,?,?,?,1,?)
  `).bind(
    jti,
    workspaceId,
    tenantId,
    uid,
    label,
    hmac,
    allowedTools ? JSON.stringify(allowedTools) : null,
    rateLimitPerHour,
    expiresAt,
  ).run();
  return { bearer, tokenId: jti };
}

export async function validateMcpToken(env, bearer) {
  if (!bearer) return null;
  if (!bearer.includes('.')) return validateLegacyToken(env, bearer);
  if (!env?.TOKEN_SIGNING_KEY) return null;

  try {
    const dotIdx = bearer.lastIndexOf('.');
    const b64 = bearer.slice(0, dotIdx);
    const hmac = bearer.slice(dotIdx + 1);
    const expected = await signPayload(b64, env.TOKEN_SIGNING_KEY);
    if (expected !== hmac) return null;

    const payload = JSON.parse(b64DecodeUtf8(b64));
    const { userId, workspaceId, tenantId, jti } = payload;
    const uid = trimId(userId);
    if (!jti || !uid) return null;

    const row = await env.DB.prepare(`
      SELECT is_active, allowed_tools, rate_limit_per_hour, expires_at, user_id
      FROM mcp_workspace_tokens
      WHERE id = ? AND workspace_id = ? AND tenant_id = ?
      LIMIT 1
    `).bind(jti, workspaceId, tenantId).first().catch(() => null);
    if (!row?.is_active) return null;
    if (row.expires_at && row.expires_at < Math.floor(Date.now() / 1000)) return null;
    if (trimId(row.user_id) && trimId(row.user_id) !== uid) return null;

    return {
      userId: uid,
      workspaceId,
      tenantId,
      tokenId: jti,
      allowedTools: row.allowed_tools ? JSON.parse(row.allowed_tools) : null,
      rateLimitPerHour: row.rate_limit_per_hour,
      tokenType: 'user',
    };
  } catch {
    return null;
  }
}

async function validateLegacyToken(env, bearer) {
  const master = await resolvePlatformMasterFromDb(env, bearer);
  if (master) return master;

  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bearer));
  const hexHash = Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  const row = await env.DB.prepare(`
    SELECT id, workspace_id, tenant_id, user_id, allowed_tools,
           rate_limit_per_hour, is_active, expires_at
    FROM mcp_workspace_tokens
    WHERE token_hash = ? AND is_active = 1
      AND user_id IS NOT NULL AND trim(user_id) != ''
    LIMIT 1
  `).bind(hexHash).first().catch(() => null);
  if (!row || (row.expires_at && row.expires_at < Math.floor(Date.now() / 1000))) return null;

  const userId = trimId(row.user_id);
  if (!userId) return null;
  return {
    userId,
    workspaceId: row.workspace_id,
    tenantId: row.tenant_id,
    tokenId: row.id,
    allowedTools: row.allowed_tools ? JSON.parse(row.allowed_tools) : null,
    rateLimitPerHour: row.rate_limit_per_hour,
    tokenType: 'legacy',
  };
}
