/**
 * OIDC id_token (RS256) for IAM MCP OAuth issuer.
 * Private key: Wrangler secret OIDC_ID_TOKEN_RSA_PRIVATE_KEY (PKCS#8 PEM).
 * Public JWKS: GET /.well-known/jwks.json (published keys + optional env.OIDC_ID_TOKEN_JWKS).
 */
import publishedJwks from './oidc-id-token-jwks-published.json' with { type: 'json' };

const DEFAULT_KID = publishedJwks?.keys?.[0]?.kid || 'iam-oidc-rs256-1';

function b64urlEncodeJson(obj) {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlEncodeBytes(bytes) {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemToPkcs8Der(pem) {
  const stripped = String(pem || '')
    .replace(/-----BEGIN[^-]+-----/g, '')
    .replace(/-----END[^-]+-----/g, '')
    .replace(/\s/g, '');
  if (!stripped) throw new Error('invalid_pem');
  const raw = atob(stripped);
  const der = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) der[i] = raw.charCodeAt(i);
  return der;
}

/** @type {Map<string, CryptoKey>} */
const privateKeyCache = new Map();

/**
 * @param {any} env
 * @returns {Promise<{ cryptoKey: CryptoKey, kid: string }>}
 */
export async function resolveIamOidcSigningKey(env) {
  const pem = String(env?.OIDC_ID_TOKEN_RSA_PRIVATE_KEY || '').trim();
  if (!pem) {
    throw new Error('OIDC_ID_TOKEN_RSA_PRIVATE_KEY not set');
  }
  const cacheKey = pem.slice(0, 64);
  if (privateKeyCache.has(cacheKey)) {
    return { cryptoKey: privateKeyCache.get(cacheKey), kid: resolveIamOidcKeyId(env) };
  }
  const der = pemToPkcs8Der(pem);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  privateKeyCache.set(cacheKey, cryptoKey);
  return { cryptoKey, kid: resolveIamOidcKeyId(env) };
}

/**
 * @param {any} env
 */
export function resolveIamOidcKeyId(env) {
  const jwks = loadIamOidcJwksDocument(env);
  const kid = jwks?.keys?.[0]?.kid;
  return String(kid || DEFAULT_KID).trim() || DEFAULT_KID;
}

/**
 * @param {any} env
 * @returns {{ keys: object[] }}
 */
export function loadIamOidcJwksDocument(env) {
  const raw = env?.OIDC_ID_TOKEN_JWKS;
  if (raw) {
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (parsed && Array.isArray(parsed.keys) && parsed.keys.length) {
        return { keys: parsed.keys.map(sanitizePublicJwk) };
      }
    } catch (_) {}
  }
  return {
    keys: (publishedJwks?.keys || []).map(sanitizePublicJwk),
  };
}

function sanitizePublicJwk(jwk) {
  const out = { ...jwk };
  delete out.d;
  delete out.p;
  delete out.q;
  delete out.dp;
  delete out.dq;
  delete out.qi;
  if (!out.alg) out.alg = 'RS256';
  if (!out.use) out.use = 'sig';
  return out;
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} claims
 * @param {number} ttlSeconds
 */
export async function signIamOidcIdToken(env, claims, ttlSeconds = 3600) {
  const { cryptoKey, kid } = await resolveIamOidcSigningKey(env);

  const now = Math.floor(Date.now() / 1000);
  const ttl = Number(ttlSeconds) > 0 ? Number(ttlSeconds) : 3600;
  const payload = { iat: now, exp: now + ttl, ...claims };
  const header = { alg: 'RS256', typ: 'JWT', kid };

  const segments = `${b64urlEncodeJson(header)}.${b64urlEncodeJson(payload)}`;
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(segments),
  );
  return `${segments}.${b64urlEncodeBytes(new Uint8Array(sig))}`;
}

/**
 * Build OIDC id_token claims for MCP OAuth token response.
 * @param {object} input
 */
export function buildIamMcpIdTokenClaims(input) {
  const {
    issuer,
    userId,
    email,
    name,
    clientId,
    audience,
    authTime,
    nonce,
  } = input;
  const claims = {
    iss: String(issuer || '').trim(),
    sub: String(userId || '').trim(),
    aud: String(clientId || '').trim(),
    azp: String(clientId || '').trim(),
  };
  if (audience) claims.resource = String(audience);
  if (email) claims.email = String(email);
  if (name) claims.name = String(name);
  if (authTime) claims.auth_time = Number(authTime);
  if (nonce) claims.nonce = String(nonce);
  return claims;
}

/**
 * @param {any} env
 */
export function iamOidcJwksResponse(env) {
  const doc = loadIamOidcJwksDocument(env);
  return new Response(JSON.stringify(doc), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
