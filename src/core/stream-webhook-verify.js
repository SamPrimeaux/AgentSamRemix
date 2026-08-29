/**
 * Cloudflare Stream VOD webhook signature (Webhook-Signature: time=...,sig1=...).
 * @see https://developers.cloudflare.com/stream/manage-video-library/using-webhooks/
 */

/** @param {string} a @param {string} b */
function timingSafeEqualUtf8(a, b) {
  const enc = new TextEncoder();
  const ea = enc.encode(a);
  const eb = enc.encode(b);
  if (ea.length !== eb.length) return false;
  let d = 0;
  for (let i = 0; i < ea.length; i += 1) d |= ea[i] ^ eb[i];
  return d === 0;
}

/**
 * @param {string} header
 */
export function parseStreamWebhookSignatureHeader(header) {
  const parts = String(header || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  /** @type {Record<string, string>} */
  const out = {};
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return {
    time: out.time || null,
    sig1: out.sig1 || null,
  };
}

/**
 * @param {string} secret
 * @param {string} signatureHeader
 * @param {string} rawBody
 * @param {{ maxSkewSec?: number }} [opts]
 */
export async function verifyStreamVodWebhookSignature(secret, signatureHeader, rawBody, opts = {}) {
  const key = String(secret || '').trim();
  if (!key) return { ok: false, reason: 'secret_missing' };

  const { time, sig1 } = parseStreamWebhookSignatureHeader(signatureHeader);
  if (!time || !sig1) return { ok: false, reason: 'signature_malformed' };

  const skew = Number(opts.maxSkewSec) > 0 ? Number(opts.maxSkewSec) : 600;
  const ts = Number(time);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'timestamp_invalid' };
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > skew) return { ok: false, reason: 'timestamp_stale' };

  const message = `${time}.${rawBody}`;
  const keyBytes = new TextEncoder().encode(key);
  const msgBytes = new TextEncoder().encode(message);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgBytes);
  const expected = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');

  if (!timingSafeEqualUtf8(expected, String(sig1).trim().toLowerCase())) {
    return { ok: false, reason: 'signature_mismatch' };
  }
  return { ok: true };
}

/**
 * Cloudflare Notifications generic webhook (cf-webhook-auth header).
 * @param {string} secret
 * @param {string | null | undefined} headerValue
 */
export function verifyCfNotificationWebhookSecret(secret, headerValue) {
  const key = String(secret || '').trim();
  if (!key) return { ok: false, reason: 'secret_missing' };
  const got = String(headerValue || '').trim();
  if (!got) return { ok: false, reason: 'header_missing' };
  if (!timingSafeEqualUtf8(got, key)) return { ok: false, reason: 'secret_mismatch' };
  return { ok: true };
}
