/**
 * RealtimeKit (Dyte) webhook signature verification — RSA-SHA256.
 * Public key: https://api.realtime.cloudflare.com/.well-known/webhooks.json
 */

const WELL_KNOWN_URL = 'https://api.realtime.cloudflare.com/.well-known/webhooks.json';

/** @type {{ fetchedAt: number, publicKeyPem: string } | null} */
let cachedPublicKey = null;
const CACHE_MS = 60 * 60 * 1000;

function pemToSpkiDer(pem) {
  const b64 = String(pem)
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function fetchPublicKeyPem(env) {
  const fromEnv =
    env?.REALTIMEKIT_WEBHOOK_PUBLIC_KEY != null
      ? String(env.REALTIMEKIT_WEBHOOK_PUBLIC_KEY).trim()
      : '';
  if (fromEnv) return fromEnv;

  const now = Date.now();
  if (cachedPublicKey && now - cachedPublicKey.fetchedAt < CACHE_MS) {
    return cachedPublicKey.publicKeyPem;
  }

  const res = await fetch(WELL_KNOWN_URL, { cf: { cacheTtl: 3600 } });
  if (!res.ok) throw new Error(`webhook well-known ${res.status}`);
  const json = await res.json();
  const pem = json?.data?.publicKey ?? json?.publicKey ?? null;
  if (!pem || typeof pem !== 'string') throw new Error('webhook public key missing');
  cachedPublicKey = { fetchedAt: now, publicKeyPem: pem };
  return pem;
}

/**
 * Dyte/RTK signs JSON.stringify(parsedPayload) — not raw bytes with whitespace drift.
 * @param {object} env
 * @param {string} signatureBase64 dyte-signature header
 * @param {unknown} payload parsed JSON body
 */
export async function verifyRealtimeKitDyteSignature(env, signatureBase64, payload) {
  if (!signatureBase64) return false;
  try {
    const pem = await fetchPublicKeyPem(env);
    const key = await crypto.subtle.importKey(
      'spki',
      pemToSpkiDer(pem),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const sigBytes = Uint8Array.from(atob(signatureBase64), (c) => c.charCodeAt(0));
    const message = new TextEncoder().encode(JSON.stringify(payload));
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sigBytes, message);
  } catch {
    return false;
  }
}

/** @param {string} a @param {string} b */
export function timingSafeEqualUtf8(a, b) {
  const enc = new TextEncoder();
  const ea = enc.encode(a);
  const eb = enc.encode(b);
  if (ea.length !== eb.length) return false;
  let d = 0;
  for (let i = 0; i < ea.length; i += 1) d |= ea[i] ^ eb[i];
  return d === 0;
}

/** @param {object} env @param {Request} request */
export function verifyRealtimeKitWebhookSecret(env, request) {
  const secret =
    env?.REALTIMEKIT_WEBHOOK_SECRET != null ? String(env.REALTIMEKIT_WEBHOOK_SECRET).trim() : '';
  if (!secret) return false;
  const headers = [
    request.headers.get('X-Realtimekit-Webhook-Secret'),
    request.headers.get('X-IAM-Realtimekit-Webhook-Secret'),
    request.headers.get('X-Webhook-Secret'),
  ];
  const auth = (request.headers.get('Authorization') || '').trim();
  if (auth.startsWith('Bearer ')) headers.push(auth.slice(7).trim());
  for (const h of headers) {
    if (h && timingSafeEqualUtf8(String(h).trim(), secret)) return true;
  }
  return false;
}
