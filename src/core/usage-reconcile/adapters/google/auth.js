/**
 * Service-account access token for BigQuery (REST).
 * Env: GOOGLE_BILLING_SA_JSON (full key JSON string) or GOOGLE_APPLICATION_CREDENTIALS (path, Node only).
 */

async function loadServiceAccount(env) {
  const raw = String(env.GOOGLE_BILLING_SA_JSON || '').trim();
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error('GOOGLE_BILLING_SA_JSON is not valid JSON');
    }
  }
  const path = String(env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
  if (path) {
    try {
      const { readFileSync } = await import('node:fs');
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      throw new Error(`GOOGLE_APPLICATION_CREDENTIALS read failed: ${error?.message || error}`);
    }
  }
  throw new Error(
    'GOOGLE_BILLING_SA_JSON (or GOOGLE_APPLICATION_CREDENTIALS) not bound — create key for iam-billing-reader',
  );
}

function b64url(bytes) {
  let bin = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  const b64 = typeof btoa === 'function'
    ? btoa(bin)
    : Buffer.from(arr).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemToArrayBuffer(pem) {
  const b64 = String(pem)
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const bin = typeof atob === 'function'
    ? atob(b64)
    : Buffer.from(b64, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function signJwtRs256(sa, claimSet) {
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = b64url(new TextEncoder().encode(JSON.stringify(claimSet)));
  const data = new TextEncoder().encode(`${header}.${payload}`);
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, data);
  return `${header}.${payload}.${b64url(sig)}`;
}

/** @param {any} env @returns {Promise<string>} */
export async function getBigQueryAccessToken(env) {
  const sa = await loadServiceAccount(env);
  if (!sa.client_email || !sa.private_key) {
    throw new Error('billing SA JSON missing client_email/private_key');
  }
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signJwtRs256(sa, {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/bigquery.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`google token HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return String(body.access_token);
}
