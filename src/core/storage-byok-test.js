/**
 * Validate Cloudflare R2 S3-compatible credentials (ListBuckets + optional HeadBucket).
 */
import { getR2S3Host, signR2Request } from './r2.js';

const EMPTY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const TIMEOUT_MS = 12_000;

function check(id, status, latencyMs, detail = null) {
  return {
    id,
    status: status === 'pass' ? 'pass' : 'fail',
    latency_ms: latencyMs,
    ...(detail != null ? { detail: String(detail).slice(0, 500) } : {}),
  };
}

async function fetchWithTimeout(url, init) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function s3Env(cfAccountId, accessKeyId, secretAccessKey) {
  return {
    CLOUDFLARE_ACCOUNT_ID: String(cfAccountId || '').trim(),
    R2_ACCESS_KEY_ID: String(accessKeyId || '').trim(),
    R2_SECRET_ACCESS_KEY: String(secretAccessKey || '').trim(),
  };
}

async function listBucketsViaS3(env) {
  const accessKey = env.R2_ACCESS_KEY_ID;
  const secretKey = env.R2_SECRET_ACCESS_KEY;
  const host = getR2S3Host(env);
  if (!accessKey || !secretKey || !host) return { ok: false, error: 'missing_credentials' };

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);
  const headerMap = { host, 'x-amz-content-sha256': EMPTY_HASH, 'x-amz-date': amzDate };
  const sortedKeys = Object.keys(headerMap).sort();
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${headerMap[k]}\n`).join('');
  const signedHeaders = sortedKeys.join(';');
  const canonicalRequest = ['GET', '/', '', canonicalHeaders, signedHeaders, EMPTY_HASH].join('\n');

  async function sha256hex(message) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async function hmacBytes(key, message) {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      typeof key === 'string' ? new TextEncoder().encode(key) : key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    return new Uint8Array(
      await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message)),
    );
  }

  async function hmacHex(key, message) {
    const sig = await hmacBytes(key, message);
    return Array.from(sig)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async function getSigningKey(secret, date, region, service) {
    const kDate = await hmacBytes('AWS4' + secret, date);
    const kRegion = await hmacBytes(kDate, region);
    const kService = await hmacBytes(kRegion, service);
    return hmacBytes(kService, 'aws4_request');
  }

  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, await sha256hex(canonicalRequest)].join(
    '\n',
  );
  const signingKey = await getSigningKey(secretKey, dateStamp, 'auto', 's3');
  const signature = await hmacHex(signingKey, stringToSign);
  const headers = {
    ...headerMap,
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };

  const res = await fetchWithTimeout(`https://${host}/`, { method: 'GET', headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, error: text.slice(0, 200) || `list_buckets_${res.status}`, status: res.status };
  }
  const xml = await res.text();
  const buckets = [];
  for (const block of xml.match(/<Bucket>[\s\S]*?<\/Bucket>/gi) || []) {
    const name = (block.match(/<Name>([^<]*)<\/Name>/i) || [])[1];
    if (name) buckets.push(String(name));
  }
  return { ok: true, buckets };
}

/**
 * @param {{ cfAccountId: string, accessKeyId: string, secretAccessKey: string, bucketName?: string|null }} params
 */
export async function validateR2ByokCredentials(params) {
  const cfAccountId = String(params?.cfAccountId || '').trim();
  const accessKeyId = String(params?.accessKeyId || '').trim();
  const secretAccessKey = String(params?.secretAccessKey || '').trim();
  const bucketName = params?.bucketName != null ? String(params.bucketName).trim() : '';
  const warnings = [];
  const checks = [];

  if (!cfAccountId) {
    checks.push(check('account_id', 'fail', 0, 'Cloudflare Account ID is required'));
    return { ok: false, provider: 'cloudflare_r2', checks, warnings };
  }
  if (!accessKeyId || !secretAccessKey) {
    checks.push(check('credentials', 'fail', 0, 'R2 access key ID and secret are required'));
    return { ok: false, provider: 'cloudflare_r2', checks, warnings };
  }

  const env = s3Env(cfAccountId, accessKeyId, secretAccessKey);
  const t0 = Date.now();
  const listed = await listBucketsViaS3(env);
  const listMs = Date.now() - t0;

  if (!listed.ok) {
    checks.push(check('list_buckets', 'fail', listMs, listed.error || 'ListBuckets failed'));
    return { ok: false, provider: 'cloudflare_r2', checks, warnings };
  }
  checks.push(check('list_buckets', 'pass', listMs, `${listed.buckets.length} bucket(s) visible`));

  if (bucketName) {
    const inList = listed.buckets.some((b) => b === bucketName);
    if (!inList) {
      warnings.push(`Bucket "${bucketName}" was not returned by ListBuckets (may still exist with restricted listing).`);
    }
    const t1 = Date.now();
    const signed = await signR2Request('HEAD', bucketName, '', '', env);
    if (!signed) {
      checks.push(check('head_bucket', 'fail', Date.now() - t1, 'Could not sign HeadBucket request'));
      return { ok: false, provider: 'cloudflare_r2', checks, warnings };
    }
    const headRes = await fetchWithTimeout(signed.endpoint, { method: 'HEAD', headers: signed.headers });
    const headMs = Date.now() - t1;
    if (!headRes.ok && headRes.status !== 403) {
      checks.push(
        check('head_bucket', 'fail', headMs, `HeadBucket HTTP ${headRes.status} for ${bucketName}`),
      );
      return { ok: false, provider: 'cloudflare_r2', checks, warnings };
    }
    checks.push(
      check(
        'head_bucket',
        'pass',
        headMs,
        headRes.ok ? `Bucket ${bucketName} reachable` : `Bucket ${bucketName} exists (HTTP ${headRes.status})`,
      ),
    );
  }

  return { ok: true, provider: 'cloudflare_r2', checks, warnings, buckets: listed.buckets };
}
