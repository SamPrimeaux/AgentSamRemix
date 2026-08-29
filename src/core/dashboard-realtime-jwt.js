/**
 * Mint short-lived HS256 JWTs for Supabase Realtime + RLS using the project's JWT secret.
 * Requires env SUPABASE_JWT_SECRET (Settings → API → JWT Secret in Supabase dashboard).
 *
 * `sub` is the D1/auth user id — use in RLS for per-user kanban mirrors, e.g. owner_id = sub on kanban_boards_mirror.
 */

function b64urlEncodeJson(obj) {
  const s = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(s);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlEncodeBytes(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * @param {any} env
 * @param {{ userId: string, tenantId: string, workspaceId: string | null, isSuperadmin?: boolean, ttlSec?: number }} o
 * @returns {Promise<string | null>}
 */
export async function mintDashboardSupabaseJwt(env, o) {
  const secret = env?.SUPABASE_JWT_SECRET != null ? String(env.SUPABASE_JWT_SECRET).trim() : '';
  if (!secret) return null;

  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.min(Math.max(Number(o.ttlSec) || 300, 60), 3600);
  const payload = {
    aud: 'authenticated',
    role: 'authenticated',
    sub: String(o.userId),
    iss: 'inneranimalmedia-dashboard',
    iat: now,
    exp: now + ttl,
    tenant_id: String(o.tenantId),
    workspace_id: o.workspaceId ? String(o.workspaceId) : '',
  };

  const header = { alg: 'HS256', typ: 'JWT' };
  const enc = new TextEncoder();
  const signingInput = `${b64urlEncodeJson(header)}.${b64urlEncodeJson(payload)}`;

  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(signingInput));
  return `${signingInput}.${b64urlEncodeBytes(new Uint8Array(sig))}`;
}
