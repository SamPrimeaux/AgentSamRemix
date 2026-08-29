/**
 * Meshy webhook verification — shared secret / optional HMAC headers.
 * Meshy documents HTTPS delivery; secret is shown in dashboard Webhooks UI.
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
 * @param {string} secret
 * @param {string} rawBody
 */
async function hmacSha256Hex(secret, rawBody) {
  const keyBytes = new TextEncoder().encode(String(secret || '').trim());
  const msgBytes = new TextEncoder().encode(String(rawBody ?? ''));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', cryptoKey, msgBytes);
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {string} rawBody
 */
export async function verifyMeshyWebhookRequest(request, env, rawBody) {
  const secret = String(env?.MESHYAI_WEBHOOK_SECRET || '').trim();
  if (!secret) return { ok: true, verified: false, reason: 'secret_not_configured' };

  const auth = String(request.headers.get('Authorization') || '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    if (timingSafeEqualUtf8(token, secret)) {
      return { ok: true, verified: true, method: 'authorization_bearer' };
    }
  }

  const headerNames = [
    'x-meshy-webhook-secret',
    'x-webhook-secret',
    'meshy-webhook-secret',
    'x-meshy-secret',
  ];
  for (const name of headerNames) {
    const val = String(request.headers.get(name) || '').trim();
    if (val && timingSafeEqualUtf8(val, secret)) {
      return { ok: true, verified: true, method: name };
    }
  }

  const url = new URL(request.url);
  const querySecret = String(url.searchParams.get('secret') || '').trim();
  if (querySecret && timingSafeEqualUtf8(querySecret, secret)) {
    return { ok: true, verified: true, method: 'query_secret' };
  }

  const sigHeaders = [
    'x-meshy-signature',
    'x-webhook-signature',
    'meshy-signature',
  ];
  const expectedHex = await hmacSha256Hex(secret, rawBody);
  for (const name of sigHeaders) {
    const sig = String(request.headers.get(name) || '').trim().toLowerCase();
    if (!sig) continue;
    const normalized = sig.startsWith('sha256=') ? sig.slice(7) : sig;
    if (timingSafeEqualUtf8(normalized, expectedHex)) {
      return { ok: true, verified: true, method: name };
    }
  }

  // Meshy may not yet send a documented signature header — accept but flag unverified
  // so webhook deliveries are not auto-disabled while we observe real headers in logs.
  return { ok: true, verified: false, reason: 'no_matching_signature' };
}
