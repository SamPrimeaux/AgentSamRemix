// guard-dup-allow: backend/browser domain peel from src/core (residual closeout)
/**
 * BYOK R2 S3 PUT for user-owned buckets (browser capture save path).
 */

function getR2S3Host(env) {
  if (!env || env.CLOUDFLARE_ACCOUNT_ID == null) return null;
  const id = String(env.CLOUDFLARE_ACCOUNT_ID).trim();
  return id ? `${id}.r2.cloudflarestorage.com` : null;
}

function r2ObjectPathForS3(key) {
  const k = String(key || '').replace(/^\/+/, '');
  if (!k) return '';
  return `/${k.split('/').map((s) => encodeURIComponent(s)).join('/')}`;
}

async function sha256hex(message) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacBytes(key, message) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    typeof key === 'string' ? new TextEncoder().encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

async function hmacHex(key, message) {
  const sig = await hmacBytes(key, message);
  return Array.from(sig).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function getSigningKey(secret, date, region, service) {
  const kDate = await hmacBytes(`AWS4${secret}`, date);
  const kRegion = await hmacBytes(kDate, region);
  const kService = await hmacBytes(kRegion, service);
  return hmacBytes(kService, 'aws4_request');
}

async function signR2Request(method, bucket, path, query, env, payloadOpts = null) {
  const accessKey = env.R2_ACCESS_KEY_ID;
  const secretKey = env.R2_SECRET_ACCESS_KEY;
  if (!accessKey || !secretKey) return null;
  const host = getR2S3Host(env);
  if (!host) return null;
  const region = 'auto';
  const service = 's3';
  const endpoint = `https://${host}/${bucket}${path}${query ? `?${query}` : ''}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);

  const payload = payloadOpts?.body || '';
  const bodyBytes = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
  const payloadHash = await sha256hex(bodyBytes);

  const headerMap = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (bodyBytes.length > 0) {
    headerMap['content-type'] = payloadOpts?.contentType || 'application/octet-stream';
    headerMap['content-length'] = bodyBytes.byteLength.toString();
  }
  const extra = payloadOpts?.extraHeaders || {};
  for (const [k, v] of Object.entries(extra)) {
    if (v != null && String(v).trim()) headerMap[String(k).toLowerCase()] = String(v).trim();
  }

  const sortedKeys = Object.keys(headerMap).sort();
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${headerMap[k]}\n`).join('');
  const signedHeaders = sortedKeys.join(';');
  const canonicalRequest = [method, `/${bucket}${path}`, query || '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, await sha256hex(canonicalRequest)].join('\n');

  const signingKey = await getSigningKey(secretKey, dateStamp, region, service);
  const signature = await hmacHex(signingKey, stringToSign);

  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers = { Authorization: authHeader, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  if (bodyBytes.length > 0) {
    headers['Content-Type'] = payloadOpts?.contentType || 'application/octet-stream';
    headers['Content-Length'] = bodyBytes.byteLength.toString();
  }
  for (const [k, v] of Object.entries(extra)) {
    if (v != null && String(v).trim()) headers[k] = String(v).trim();
  }

  return { endpoint, headers, bodyBytes };
}

/**
 * @param {any} env
 * @param {any} binding
 * @param {string} s3BucketName
 * @param {string} key
 * @param {ArrayBuffer|Uint8Array|string} body
 * @param {string} [contentType]
 * @param {Record<string, string>} [customMetadata]
 */
export async function r2PutViaBindingOrS3(
  env,
  binding,
  s3BucketName,
  key,
  body,
  contentType,
  customMetadata = {},
) {
  const ct = contentType || 'application/octet-stream';
  /** @type {Record<string, string>} */
  const meta = {};
  if (customMetadata && typeof customMetadata === 'object') {
    for (const [k, v] of Object.entries(customMetadata)) {
      if (v == null) continue;
      const ks = String(k).trim();
      const vs = String(v).trim();
      if (ks && vs) meta[ks] = vs;
    }
  }
  const putOpts = {
    httpMetadata: { contentType: ct },
    ...(Object.keys(meta).length ? { customMetadata: meta } : {}),
  };

  if (binding && binding.put) {
    await binding.put(key, body, putOpts);
    return true;
  }
  if (!s3BucketName || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) return false;
  const path = r2ObjectPathForS3(key);
  /** @type {Record<string, string>} */
  const extraHeaders = {};
  for (const [k, v] of Object.entries(meta)) {
    const headerName = `x-amz-meta-${k.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`;
    extraHeaders[headerName] = v;
  }
  const signed = await signR2Request('PUT', s3BucketName, path, '', env, {
    body,
    contentType: ct,
    extraHeaders,
  });
  if (!signed) return false;
  const res = await fetch(signed.endpoint, {
    method: 'PUT',
    headers: signed.headers,
    body: signed.bodyBytes.byteLength ? signed.bodyBytes : undefined,
  });
  return res.ok;
}
