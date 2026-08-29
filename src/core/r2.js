/**
 * Persistence Layer: R2 Storage
 * Handles Cloudflare R2 and S3-failover logic.
 * Deconstructed from legacy worker.js.
 */

import { escapeXmlText } from './r2-xml.js';

/**
 * Returns the S3-compatible host for R2.
 */
export function getR2S3Host(env) {
  if (!env || env.CLOUDFLARE_ACCOUNT_ID == null) return null;
  const id = String(env.CLOUDFLARE_ACCOUNT_ID).trim();
  return id ? `${id}.r2.cloudflarestorage.com` : null;
}

// --- S3 Failover & Signing Helpers ---

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
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

async function hmacHex(key, message) {
  const sig = await hmacBytes(key, message);
  return Array.from(sig).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function getSigningKey(secret, date, region, service) {
  const kDate = await hmacBytes('AWS4' + secret, date);
  const kRegion = await hmacBytes(kDate, region);
  const kService = await hmacBytes(kRegion, service);
  return hmacBytes(kService, 'aws4_request');
}

export function r2ObjectPathForS3(key) {
  const k = String(key || '').replace(/^\/+/, '');
  if (!k) return '';
  return `/${k.split('/').map((s) => encodeURIComponent(s)).join('/')}`;
}

/** SigV4 for R2 S3 API. */
export async function signR2Request(method, bucket, path, query, env, payloadOpts = null) {
  const accessKey = env.R2_ACCESS_KEY_ID;
  const secretKey = env.R2_SECRET_ACCESS_KEY;
  if (!accessKey || !secretKey) return null;
  const host = getR2S3Host(env);
  if (!host) return null;
  const region = 'auto';
  const service = 's3';
  const endpoint = `https://${host}/${bucket}${path}${query ? '?' + query : ''}`;

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

  const fetchHeaders = {
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    Authorization: authHeader,
  };
  if (bodyBytes.length > 0) {
    fetchHeaders['content-type'] = headerMap['content-type'];
    fetchHeaders['content-length'] = headerMap['content-length'];
  }
  for (const k of sortedKeys) {
    if (k === 'host' || k === 'x-amz-content-sha256' || k === 'x-amz-date') continue;
    fetchHeaders[k] = headerMap[k];
  }

  return { endpoint, headers: fetchHeaders, bodyBytes };
}

/** Parse HTTP Range: bytes=start-end (inclusive). Returns null if invalid/absent. */
export function parseHttpRange(rangeHeader, totalSize) {
  if (!rangeHeader || totalSize == null || totalSize < 0) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(String(rangeHeader).trim());
  if (!m) return null;
  let start = m[1] === '' ? null : parseInt(m[1], 10);
  let end = m[2] === '' ? null : parseInt(m[2], 10);
  if (start == null && end == null) return null;
  if (start == null && end != null) {
    const suffixLen = end;
    start = Math.max(0, totalSize - suffixLen);
    end = totalSize - 1;
  } else {
    start = start ?? 0;
    end = end == null ? totalSize - 1 : end;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) return null;
  end = Math.min(end, totalSize - 1);
  if (start >= totalSize) return null;
  return { offset: start, length: end - start + 1, start, end, total: totalSize };
}

/** Fetch object bytes with optional Range (binding or S3). */
export async function r2FetchObjectWithRange(env, binding, s3BucketName, key, rangeHeader) {
  const path = r2ObjectPathForS3(key);

  if (binding?.get) {
    let head = null;
    if (binding.head) {
      const h = await binding.head(key);
      if (h) head = { size: h.size ?? 0, contentType: h.httpMetadata?.contentType || null, etag: h.etag || null };
    }
    const totalSize = head?.size ?? null;
    const parsed = totalSize != null ? parseHttpRange(rangeHeader, totalSize) : null;
    const getOpts = parsed ? { range: { offset: parsed.offset, length: parsed.length } } : undefined;
    const obj = await binding.get(key, getOpts);
    if (!obj) return null;
    const body = await obj.arrayBuffer();
    const contentType = obj.httpMetadata?.contentType || head?.contentType || null;
    return {
      body,
      contentType,
      etag: obj.etag || head?.etag || null,
      size: totalSize,
      range: parsed,
    };
  }

  if (!s3BucketName || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) return null;

  let headMeta = null;
  const headSigned = await signR2Request('HEAD', s3BucketName, path, '', env);
  if (headSigned) {
    const headRes = await fetch(headSigned.endpoint, { method: 'HEAD', headers: headSigned.headers });
    if (headRes.ok) {
      headMeta = {
        size: parseInt(headRes.headers.get('content-length') || '0', 10) || 0,
        contentType: headRes.headers.get('content-type'),
        etag: headRes.headers.get('etag'),
      };
    }
  }

  const extraHeaders = {};
  if (rangeHeader) extraHeaders.range = rangeHeader;
  const signed = await signR2Request('GET', s3BucketName, path, '', env, { extraHeaders });
  if (!signed) return null;
  const res = await fetch(signed.endpoint, { method: 'GET', headers: signed.headers });
  if (res.status === 404) return null;
  if (!res.ok && res.status !== 206) return null;

  const body = await res.arrayBuffer();
  const cr = res.headers.get('content-range');
  let parsed = null;
  if (cr) {
    const rm = /bytes (\d+)-(\d+)\/(\d+)/.exec(cr);
    if (rm) {
      parsed = {
        offset: parseInt(rm[1], 10),
        length: parseInt(rm[2], 10) - parseInt(rm[1], 10) + 1,
        start: parseInt(rm[1], 10),
        end: parseInt(rm[2], 10),
        total: parseInt(rm[3], 10),
      };
    }
  } else if (headMeta?.size != null && rangeHeader) {
    parsed = parseHttpRange(rangeHeader, headMeta.size);
  }

  return {
    body,
    contentType: res.headers.get('content-type') || headMeta?.contentType || null,
    etag: res.headers.get('etag') || headMeta?.etag || null,
    size: headMeta?.size ?? body.byteLength,
    range: parsed,
    status: res.status,
    acceptRanges: res.headers.get('accept-ranges') || (headMeta ? 'bytes' : null),
    contentRange: cr,
  };
}

/** Build streaming Response for R2 object GET with Range support. */
export async function r2ObjectGetResponse(request, env, binding, s3BucketName, key, contentTypeHint) {
  const rangeHeader = request.headers.get('Range');
  const method = (request.method || 'GET').toUpperCase();

  if (method === 'HEAD') {
    const meta = await r2HeadViaBindingOrS3(env, binding, s3BucketName, key);
    if (!meta) return null;
    const headers = new Headers();
    if (meta.contentType) headers.set('Content-Type', meta.contentType);
    if (meta.size != null) headers.set('Content-Length', String(meta.size));
    if (meta.etag) headers.set('ETag', meta.etag);
    if (meta.last_modified) headers.set('Last-Modified', meta.last_modified);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cache-Control', 'private, max-age=3600');
    return new Response(null, { status: 200, headers });
  }

  const fetched = await r2FetchObjectWithRange(env, binding, s3BucketName, key, rangeHeader);
  if (!fetched) return null;

  const ct = fetched.contentType || contentTypeHint || 'application/octet-stream';
  const headers = new Headers();
  headers.set('Content-Type', ct);
  headers.set('Accept-Ranges', fetched.acceptRanges || 'bytes');
  headers.set('Cache-Control', 'private, max-age=3600');
  if (fetched.etag) headers.set('ETag', fetched.etag);

  if (fetched.range) {
    headers.set(
      'Content-Range',
      fetched.contentRange || `bytes ${fetched.range.start}-${fetched.range.end}/${fetched.range.total}`,
    );
    headers.set('Content-Length', String(fetched.body.byteLength));
    return new Response(fetched.body, { status: 206, headers });
  }

  const len = fetched.size != null ? fetched.size : fetched.body.byteLength;
  headers.set('Content-Length', String(fetched.body.byteLength || len));
  return new Response(fetched.body, { status: fetched.status === 206 ? 206 : 200, headers });
}

export async function r2GetViaBindingOrS3(env, binding, s3BucketName, key) {
  const fetched = await r2FetchObjectViaBindingOrS3(env, binding, s3BucketName, key);
  if (!fetched) return null;
  const text = new TextDecoder().decode(fetched.body);
  return { text: async () => text };
}

/** Fetch object bytes + metadata via Worker binding or account S3 API. */
export async function r2FetchObjectViaBindingOrS3(env, binding, s3BucketName, key) {
  if (binding?.get) {
    const obj = await binding.get(key);
    if (!obj) return null;
    const body = await obj.arrayBuffer();
    return {
      body,
      contentType: obj.httpMetadata?.contentType || null,
      etag: obj.etag || null,
    };
  }
  if (!s3BucketName || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) return null;
  const path = r2ObjectPathForS3(key);
  const signed = await signR2Request('GET', s3BucketName, path, '', env);
  if (!signed) return null;
  const res = await fetch(signed.endpoint, { method: 'GET', headers: signed.headers });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const body = await res.arrayBuffer();
  return {
    body,
    contentType: res.headers.get('content-type'),
    etag: res.headers.get('etag'),
  };
}

/**
 * @param {any} env
 * @param {any} binding
 * @param {string} s3BucketName
 * @param {string} key
 * @param {ArrayBuffer|Uint8Array|string} body
 * @param {string} [contentType]
 * @param {Record<string, string>} [customMetadata] string→string only (R2 / x-amz-meta-*)
 * @returns {Promise<boolean>}
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
    // S3 user metadata — ASCII header names; values trimmed strings
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

export async function r2DeleteViaBindingOrS3(env, binding, s3BucketName, key) {
  if (binding && binding.delete) {
    await binding.delete(key);
    return true;
  }
  if (!s3BucketName || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) return false;
  const path = r2ObjectPathForS3(key);
  const signed = await signR2Request('DELETE', s3BucketName, path, '', env);
  if (!signed) return false;
  const res = await fetch(signed.endpoint, { method: 'DELETE', headers: signed.headers });
  return res.ok;
}

/** HeadObject — metadata without body (binding head() or S3 HEAD). */
export async function r2HeadViaBindingOrS3(env, binding, s3BucketName, key) {
  if (binding?.head) {
    const obj = await binding.head(key);
    if (!obj) return null;
    return {
      key,
      size: obj.size ?? null,
      contentType: obj.httpMetadata?.contentType || null,
      etag: obj.etag || null,
      last_modified: obj.uploaded ? new Date(obj.uploaded).toISOString() : null,
      customMetadata:
        obj.customMetadata && typeof obj.customMetadata === 'object'
          ? { ...obj.customMetadata }
          : {},
    };
  }
  if (!s3BucketName || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) return null;
  const path = r2ObjectPathForS3(key);
  const signed = await signR2Request('HEAD', s3BucketName, path, '', env);
  if (!signed) return null;
  const res = await fetch(signed.endpoint, { method: 'HEAD', headers: signed.headers });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const lm = res.headers.get('last-modified');
  /** @type {Record<string, string>} */
  const customMetadata = {};
  res.headers.forEach((value, name) => {
    const lower = String(name).toLowerCase();
    if (lower.startsWith('x-amz-meta-')) {
      customMetadata[lower.slice('x-amz-meta-'.length)] = String(value);
    }
  });
  return {
    key,
    size: parseInt(res.headers.get('content-length') || '0', 10) || null,
    contentType: res.headers.get('content-type'),
    etag: res.headers.get('etag'),
    last_modified: lm || null,
    customMetadata,
  };
}

/** DeleteObjects — bulk delete (binding accepts array; S3 DeleteObjects XML). */
export async function r2DeleteManyViaBindingOrS3(env, binding, s3BucketName, keys) {
  const unique = [...new Set((keys || []).map((k) => String(k || '').trim()).filter(Boolean))];
  if (!unique.length) return { deleted: 0, errors: [] };

  if (binding?.delete) {
    await binding.delete(unique);
    return { deleted: unique.length, errors: [] };
  }

  if (!s3BucketName || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    return { deleted: 0, errors: unique.map((key) => ({ key, error: 'no_binding_or_credentials' })) };
  }

  const errors = [];
  let deleted = 0;
  const chunkSize = 1000;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const objectsXml = chunk.map((k) => `<Object><Key>${escapeXmlText(k)}</Key></Object>`).join('');
    const body = `<?xml version="1.0" encoding="UTF-8"?><Delete>${objectsXml}</Delete>`;
    const signed = await signR2Request('POST', s3BucketName, '', 'delete=', env, {
      body,
      contentType: 'application/xml',
    });
    if (!signed) {
      for (const key of chunk) errors.push({ key, error: 'sign_failed' });
      continue;
    }
    const res = await fetch(signed.endpoint, {
      method: 'POST',
      headers: signed.headers,
      body: signed.bodyBytes.byteLength ? signed.bodyBytes : undefined,
    });
    if (!res.ok) {
      for (const key of chunk) errors.push({ key, error: `delete_objects_${res.status}` });
      continue;
    }
    const xml = await res.text();
    const errBlocks = xml.match(/<Error>[\s\S]*?<\/Error>/g) || [];
    for (const block of errBlocks) {
      const ek = (block.match(/<Key>([^<]*)<\/Key>/) || [])[1];
      const code = (block.match(/<Code>([^<]*)<\/Code>/) || [])[1] || 'Error';
      if (ek) errors.push({ key: ek, error: code });
    }
    const deletedInChunk = chunk.length - errBlocks.length;
    deleted += Math.max(0, deletedInChunk);
  }
  return { deleted, errors };
}

function buildS3ListQuery(prefix, limit) {
  const params = {
    'list-type': '2',
    prefix: prefix || '',
    'max-keys': String(Math.max(1, Number(limit) || 100)),
  };
  const keys = Object.keys(params).sort();
  return keys.map((k) => `${k}=${encodeURIComponent(params[k])}`).join('&');
}

export async function r2ListViaBindingOrS3(env, binding, s3BucketName, prefix, limit) {
  const lim = Math.max(1, Number(limit) || 100);
  if (binding && binding.list) {
    const list = await binding.list({ prefix, limit: lim });
    return (list.objects || []).map(o => ({ key: o.key, size: o.size, last_modified: o.uploaded }));
  }

  if (!s3BucketName || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) return [];
  const query = buildS3ListQuery(prefix, lim);
  const signed = await signR2Request('GET', s3BucketName, '', query, env);
  if (!signed) return [];

  const res = await fetch(signed.endpoint, { method: 'GET', headers: signed.headers });
  if (!res.ok) return [];

  const xml = await res.text();
  const objects = [];
  const contents = xml.match(/<Contents>[\s\S]*?<\/Contents>/g) || [];

  for (const item of contents) {
    const key = (item.match(/<Key>([^<]*)<\/Key>/) || [])[1];
    const size = parseInt((item.match(/<Size>([^<]*)<\/Size>/) || [])[1] || '0', 10);
    const lastModified = (item.match(/<LastModified>([^<]*)<\/LastModified>/) || [])[1];
    if (key) objects.push({ key, size, last_modified: lastModified });
  }

  return objects;
}
