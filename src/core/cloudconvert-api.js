/**
 * CloudConvert API v2 — jobs, operations, R2 storage lane, sync + async.
 */

import {
  buildCloudConvertTaskGraph,
  getR2S3Credentials,
  listCloudConvertPresets,
} from './cloudconvert-task-graph.js';

const CC_API = 'https://api.cloudconvert.com/v2';

function apiKey(env) {
  const k = String(env?.CLOUDCONVERT_API_KEY || '').trim();
  if (!k) throw new Error('CLOUDCONVERT_API_KEY not configured');
  return k;
}

/**
 * @param {any} env
 * @param {string} path
 * @param {{ method?: string, body?: unknown }} [opts]
 */
export async function cloudConvertFetch(env, path, opts = {}) {
  const method = opts.method || 'GET';
  const res = await fetch(`${CC_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey(env)}`,
      'Content-Type': 'application/json',
    },
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.message ||
      data?.error?.message ||
      (Array.isArray(data?.errors) ? data.errors[0]?.message : null) ||
      `CloudConvert HTTP ${res.status}`;
    throw new Error(String(msg).slice(0, 500));
  }
  return data;
}

/**
 * @param {any} env
 * @param {{ tasks: Record<string, unknown>, tag?: string, webhook_url?: string, redirect?: boolean }} payload
 */
export async function createCloudConvertJobPayload(env, payload) {
  const body = { tasks: payload.tasks };
  if (payload.tag) body.tag = payload.tag;
  if (payload.webhook_url) body.webhook_url = payload.webhook_url;
  if (payload.redirect) body.redirect = true;
  const data = await cloudConvertFetch(env, '/jobs', { method: 'POST', body });
  return data.data;
}

/**
 * Legacy simple convert — prefer preset workflows.
 * @param {any} env
 * @param {string} importUrl
 * @param {{ output_format?: string, tag?: string, input_format?: string, convert_options?: Record<string, unknown> }} opts
 */
export async function createCloudConvertJob(env, importUrl, opts = {}) {
  const outputFormat = String(opts.output_format || 'mp4').trim().toLowerCase().replace(/^\./, '');
  const inputFormat = String(opts.input_format || 'auto').trim().toLowerCase();
  const tasks = {
    'import-asset': { operation: 'import/url', url: importUrl },
    'convert-asset': {
      operation: 'convert',
      input: 'import-asset',
      output_format: outputFormat,
      ...(inputFormat !== 'auto' ? { input_format: inputFormat } : {}),
      ...(opts.convert_options || {}),
    },
    'export-asset': { operation: 'export/url', input: 'convert-asset' },
  };
  return createCloudConvertJobPayload(env, { tasks, tag: opts.tag });
}

/**
 * @param {any} env
 * @param {string} presetKey
 * @param {Parameters<typeof buildCloudConvertTaskGraph>[1]} ctx
 */
export async function createCloudConvertPresetJob(env, presetKey, ctx) {
  const exportMode = getR2S3Credentials(env) ? 's3' : 'url';
  const built = buildCloudConvertTaskGraph(presetKey, {
    ...ctx,
    exportMode,
  });
  const job = await createCloudConvertJobPayload(env, {
    tasks: built.tasks,
    tag: ctx.jobId,
    webhook_url: 'https://inneranimalmedia.com/api/webhooks/cloudconvert',
  });
  return {
    job,
    preset: built.preset,
    outputs: built.outputs,
    export_mode: exportMode,
    r2_outputs: built.r2_outputs,
  };
}

/**
 * Synchronous job (redirect: true) — small/quick tasks only.
 * @param {any} env
 * @param {string} presetKey
 * @param {Parameters<typeof buildCloudConvertTaskGraph>[1]} ctx
 */
export async function createCloudConvertSyncJob(env, presetKey, ctx) {
  const { tasks } = buildCloudConvertTaskGraph(presetKey, { ...ctx, exportMode: 'url' });
  const data = await cloudConvertFetch(env, '/jobs', {
    method: 'POST',
    body: { tasks, redirect: true },
  });
  return data.data;
}

/** @param {any} env @param {string} jobId */
export async function getCloudConvertJob(env, jobId) {
  const id = String(jobId || '').trim();
  if (!id) throw new Error('job id required');
  const data = await cloudConvertFetch(env, `/jobs/${id}`);
  return data.data;
}

/**
 * @param {any} env
 * @param {{ operation?: string, input_format?: string, output_format?: string }} [filters]
 */
export async function listCloudConvertOperations(env, filters = {}) {
  const params = new URLSearchParams();
  if (filters.operation) params.set('filter[operation]', filters.operation);
  if (filters.input_format) params.set('filter[input_format]', filters.input_format);
  if (filters.output_format) params.set('filter[output_format]', filters.output_format);
  params.set('include', 'options');
  const data = await cloudConvertFetch(env, `/operations?${params}`);
  return data.data || [];
}

export { listCloudConvertPresets, getR2S3Credentials, buildCloudConvertTaskGraph };

async function hmacBytes(key, message) {
  const enc = new TextEncoder();
  const keyMat =
    typeof key === 'string'
      ? await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      : key;
  const sig = await crypto.subtle.sign('HMAC', keyMat, enc.encode(message));
  return new Uint8Array(sig);
}

async function sha256hex(message) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(key, message) {
  const bytes = await hmacBytes(key, message);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function getSigningKey(secret, date) {
  const kDate = await hmacBytes(`AWS4${secret}`, date);
  const kRegion = await hmacBytes(kDate, 'auto');
  const kService = await hmacBytes(kRegion, 's3');
  return hmacBytes(kService, 'aws4_request');
}

/**
 * Presigned R2 GET fallback when import/s3 creds unavailable to CC job builder.
 * @param {any} env
 * @param {any} asset
 */
export async function buildAssetImportUrlForCloudConvert(env, asset) {
  const bucket = String(asset?.bucket || '').trim();
  const key = String(asset?.object_key || '').trim();
  if (!key) throw new Error('asset missing object_key');
  if (!bucket) throw new Error('r2_bucket_required');

  const accessKey = env?.R2_ACCESS_KEY_ID;
  const secretKey = env?.R2_SECRET_ACCESS_KEY;
  const accountId = String(env?.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const host = accountId ? `${accountId}.r2.cloudflarestorage.com` : '';
  if (accessKey && secretKey && host) {
    const now = new Date();
    const amzDate = `${now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15)}Z`;
    const dateStamp = amzDate.slice(0, 8);
    const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
    const encodedKey = key.split('/').map((seg) => encodeURIComponent(seg)).join('/');
    const params = new URLSearchParams({
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${accessKey}/${credentialScope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': '3600',
      'X-Amz-SignedHeaders': 'host',
    });
    const sortedPairs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
    const canonicalQueryString = sortedPairs
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const canonicalRequest = [
      'GET',
      `/${bucket}/${encodedKey}`,
      canonicalQueryString,
      `host:${host}\n`,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      await sha256hex(canonicalRequest),
    ].join('\n');
    const signingKey = await getSigningKey(secretKey, dateStamp);
    const signature = await hmacHex(signingKey, stringToSign);
    return `https://${host}/${bucket}/${encodedKey}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
  }

  return `https://inneranimalmedia.com/api/r2/buckets/${encodeURIComponent(bucket)}/object/${encodeURIComponent(key)}`;
}
