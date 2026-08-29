/**
 * CloudConvert webhook HMAC-SHA256 (CloudConvert-Signature header).
 * @see https://cloudconvert.com/api/v2/webhooks
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
 * @param {string} secret Signing secret from CloudConvert webhook settings (not API key).
 * @param {string} signatureHeader CloudConvert-Signature header value.
 * @param {string} rawBody Exact raw JSON body bytes as string.
 */
export async function verifyCloudConvertWebhookSignature(secret, signatureHeader, rawBody) {
  const key = String(secret || '').trim();
  if (!key) return { ok: false, reason: 'secret_missing' };

  const sig = String(signatureHeader || '').trim().toLowerCase();
  if (!sig) return { ok: false, reason: 'signature_missing' };

  const keyBytes = new TextEncoder().encode(key);
  const msgBytes = new TextEncoder().encode(String(rawBody ?? ''));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', cryptoKey, msgBytes);
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');

  if (!timingSafeEqualUtf8(expected, sig)) {
    return { ok: false, reason: 'signature_mismatch' };
  }
  return { ok: true };
}
