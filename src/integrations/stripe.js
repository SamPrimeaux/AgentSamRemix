/**
 * Stripe REST helper + webhook signature verification (Web Crypto only).
 * Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET on the Worker — never from D1.
 */

function hexToBytes(hex) {
  const h = String(hex || '').trim();
  if (h.length % 2 !== 0) return null;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(out[i])) return null;
  }
  return out;
}

function timingSafeEqualBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * @param {string} rawBody
 * @param {string} sigHeader Stripe-Signature header value
 * @param {string} secret STRIPE_WEBHOOK_SECRET
 * @param {{ toleranceSec?: number }} [opts]
 * @returns {Promise<boolean>}
 */
export async function verifyStripeSignature(rawBody, sigHeader, secret, opts = {}) {
  const toleranceSec = opts.toleranceSec ?? 600;
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

  const encoder = new TextEncoder();
  const keyMaterial = encoder.encode(secret);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const payload = encoder.encode(`${t}.${rawBody}`);
  const sigBuf = await crypto.subtle.sign('HMAC', cryptoKey, payload);
  const expected = new Uint8Array(sigBuf);

  for (const v1hex of v1List) {
    const candidate = hexToBytes(v1hex);
    if (candidate && timingSafeEqualBytes(expected, candidate)) return true;
  }
  return false;
}

/**
 * @param {any} env Worker env (needs STRIPE_SECRET_KEY)
 * @param {string} method
 * @param {string} path API path starting with / e.g. /checkout/sessions
 * @param {Record<string, string | number | undefined | null> | URLSearchParams | string | undefined} [body] application/x-www-form-urlencoded
 */
export async function stripeRequest(env, method, path, body) {
  const key = env.STRIPE_SECRET_KEY;
  if (!key || String(key).trim() === '') {
    throw new Error('STRIPE_SECRET_KEY not configured');
  }
  const p = path.startsWith('/') ? path : `/${path}`;
  let encoded;
  if (body == null) encoded = undefined;
  else if (typeof body === 'string') encoded = body;
  else if (body instanceof URLSearchParams) encoded = body.toString();
  else if (Object.keys(body).length === 0) encoded = undefined;
  else {
    encoded = new URLSearchParams(
      Object.entries(body).reduce((acc, [k, v]) => {
        if (v === undefined || v === null) return acc;
        acc[k] = String(v);
        return acc;
      }, /** @type {Record<string, string>} */ ({})),
    ).toString();
  }
  const res = await fetch(`https://api.stripe.com/v1${p}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: encoded,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = j?.error?.message || res.statusText || 'Stripe request failed';
    throw new Error(`Stripe ${method} ${p} failed: ${msg}`);
  }
  return j;
}
