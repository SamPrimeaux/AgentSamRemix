/**
 * Anthropic Managed Agents webhook signature verification (Web Crypto).
 * Matches the scheme used with whsec_-prefixed signing secrets: HMAC-SHA256 over `${t}.${rawBody}`,
 * comma-separated `t=` / `v1=` pairs in X-Webhook-Signature (same shape as Stripe webhooks).
 * @see https://platform.claude.com/docs/en/managed-agents/webhooks
 */

/** @param {string} hex */
function hexToBytes(hex) {
  const h = String(hex || '').trim();
  if (h.length % 2 !== 0) return null;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(out[i])) return null;
  }
  return out;
}

/** @param {Uint8Array} a @param {Uint8Array} b */
function timingSafeEqualBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Decode whsec_ signing material (base64 payload after prefix, per common webhook providers).
 * @param {string} secret
 * @returns {Uint8Array}
 */
export function decodeWhsecSigningKey(secret) {
  const s = String(secret || '').trim();
  if (!s.startsWith('whsec_')) {
    return new TextEncoder().encode(s);
  }
  const b64 = s.slice('whsec_'.length);
  try {
    const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return new TextEncoder().encode(b64);
  }
}

/**
 * @param {string} rawBody
 * @param {string} sigHeader X-Webhook-Signature
 * @param {string} secret whsec_-prefixed or raw
 * @param {{ toleranceSec?: number }} [opts]
 * @returns {Promise<boolean>}
 */
export async function verifyAnthropicWebhookSignature(rawBody, sigHeader, secret, opts = {}) {
  const toleranceSec = opts.toleranceSec ?? 300;
  if (!secret || !sigHeader || typeof rawBody !== 'string') return false;

  const parts = String(sigHeader)
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  /** @type {Record<string, string[]>} */
  const acc = {};
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (!acc[k]) acc[k] = [];
    acc[k].push(v);
  }
  const tsList = acc.t;
  const v1List = acc.v1;
  if (!tsList?.length || !v1List?.length) return false;

  const t = parseInt(tsList[0], 10);
  if (!Number.isFinite(t)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > toleranceSec) return false;

  const keyMaterial = decodeWhsecSigningKey(secret);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const encoder = new TextEncoder();
  const payload = encoder.encode(`${t}.${rawBody}`);
  const sigBuf = await crypto.subtle.sign('HMAC', cryptoKey, payload);
  const expected = new Uint8Array(sigBuf);

  for (const v1hex of v1List) {
    const candidate = hexToBytes(v1hex);
    if (candidate && timingSafeEqualBytes(expected, candidate)) return true;
  }
  return false;
}
