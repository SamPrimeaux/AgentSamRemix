/**
 * Resend webhook verification (Svix / Standard Webhooks).
 *
 * Path → secret (LOCKED):
 *   POST /api/email/inbound          → RESEND_INBOUND_WEBHOOK_SECRET  (email.received)
 *   POST /api/webhooks/resend        → RESEND_WEBHOOK_SECRET          (delivery, bounce, …)
 *   POST /api/integrations/resend/webhook → RESEND_WEBHOOK_SECRET
 *
 * Resend signs with whsec_…; headers are svix-id / svix-timestamp / svix-signature.
 * Custom X-Resend-*-Secret headers are not sent by Resend — kept only as optional ops escape.
 */

const TOLERANCE_SEC = 300;

/** @param {Uint8Array} a @param {Uint8Array} b */
function timingSafeEqualBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** @param {string} b64 */
function base64ToBytes(b64) {
  const bin = atob(String(b64 || '').replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** @param {string} secret */
function decodeWebhookSecret(secret) {
  const s = String(secret || '').trim();
  if (s.startsWith('whsec_')) {
    return base64ToBytes(s.slice('whsec_'.length));
  }
  return new TextEncoder().encode(s);
}

/**
 * @param {string} pathLower
 * @returns {'inbound' | 'general'}
 */
export function resendWebhookLaneForPath(pathLower) {
  const p = String(pathLower || '').toLowerCase();
  if (p === '/api/email/inbound') return 'inbound';
  return 'general';
}

/**
 * @param {'inbound' | 'general'} lane
 * @param {Record<string, unknown>} env
 * @returns {{ secret: string, envName: string }}
 */
export function resendSecretForLane(lane, env) {
  if (lane === 'inbound') {
    const secret = env?.RESEND_INBOUND_WEBHOOK_SECRET
      ? String(env.RESEND_INBOUND_WEBHOOK_SECRET).trim()
      : '';
    return { secret, envName: 'RESEND_INBOUND_WEBHOOK_SECRET' };
  }
  const secret = env?.RESEND_WEBHOOK_SECRET ? String(env.RESEND_WEBHOOK_SECRET).trim() : '';
  return { secret, envName: 'RESEND_WEBHOOK_SECRET' };
}

/**
 * @param {string} rawBody
 * @param {Headers} headers
 * @param {string} secret
 * @returns {Promise<boolean>}
 */
export async function verifyResendSvixSignature(rawBody, headers, secret) {
  if (!secret || typeof rawBody !== 'string') return false;
  const id = (headers.get('svix-id') || '').trim();
  const timestamp = (headers.get('svix-timestamp') || '').trim();
  const signatureHeader = (headers.get('svix-signature') || '').trim();
  if (!id || !timestamp || !signatureHeader) return false;

  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > TOLERANCE_SEC) return false;

  const signedPayload = `${id}.${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    'raw',
    decodeWebhookSecret(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const expected = new Uint8Array(sigBuf);

  const parts = signatureHeader.split(/\s+/).filter(Boolean);
  for (const part of parts) {
    const b64 = part.startsWith('v1,') ? part.slice(3) : part;
    if (!b64) continue;
    try {
      if (timingSafeEqualBytes(expected, base64ToBytes(b64))) return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

/**
 * @param {string} rawBody
 * @param {Headers} headers
 * @param {URL} url
 * @param {Record<string, unknown>} env
 * @param {{ pathLower?: string, lane?: 'inbound' | 'general' }} [opts]
 * @returns {Promise<{ ok: boolean, mode?: string, reason?: string, lane?: string }>}
 */
export async function verifyResendWebhookRequest(rawBody, headers, url, env, opts = {}) {
  const lane =
    opts.lane === 'inbound' || opts.lane === 'general'
      ? opts.lane
      : resendWebhookLaneForPath(opts.pathLower || url?.pathname || '');
  const { secret, envName } = resendSecretForLane(lane, env);

  const hasSvix =
    !!(headers.get('svix-id') || '').trim() &&
    !!(headers.get('svix-timestamp') || '').trim() &&
    !!(headers.get('svix-signature') || '').trim();

  if (hasSvix) {
    if (!secret) {
      return { ok: false, reason: `${envName}_missing`, lane };
    }
    if (await verifyResendSvixSignature(rawBody, headers, secret)) {
      return { ok: true, mode: `svix_${lane}`, lane };
    }
    return { ok: false, reason: 'svix_signature_mismatch', lane };
  }

  // Ops-only escape (curl / manual). Resend never sends these headers.
  const shared =
    (headers.get('X-Resend-Inbound-Secret') ||
      headers.get('X-Resend-Webhook-Secret') ||
      url.searchParams.get('secret') ||
      '')
      .trim();

  if (!secret) {
    return { ok: false, reason: `${envName}_missing`, lane };
  }

  if (shared && shared === secret) {
    return { ok: true, mode: `shared_${lane}`, lane };
  }

  return {
    ok: false,
    reason: hasSvix ? 'svix_signature_mismatch' : 'missing_svix_headers',
    lane,
  };
}
