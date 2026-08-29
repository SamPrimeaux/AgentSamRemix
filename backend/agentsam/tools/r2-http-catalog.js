/**
 * Catalog R2 ops via canonical HTTP routes in r2-api.js (session auth + S3 fallback parity).
 */
import { handleR2Api } from '../../../src/api/r2-api.js';

/**
 * @param {Request|null|undefined} source
 */
function forwardRequestHeaders(source) {
  const headers = new Headers();
  if (!source?.headers) return headers;
  for (const name of ['Cookie', 'Authorization', 'CF-Access-Jwt-Assertion']) {
    const value = source.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

function catalogOrigin(env) {
  return String(env?.IAM_ORIGIN || 'https://inneranimalmedia.com').replace(/\/$/, '');
}

/**
 * DELETE /api/r2/delete — bucket + key required.
 * @param {any} env
 * @param {Record<string, unknown>} runContext
 * @param {string} bucket
 * @param {string} key
 */
export async function invokeR2DeleteHttp(env, runContext, bucket, key) {
  const url = new URL(`${catalogOrigin(env)}/api/r2/delete`);
  url.searchParams.set('bucket', bucket);
  url.searchParams.set('key', key);
  const req = new Request(url.toString(), {
    method: 'DELETE',
    headers: forwardRequestHeaders(runContext?.request),
  });
  const res = await handleR2Api(req, url, env);
  const text = await res.text().catch(() => '');
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 4000) };
  }
  if (!res.ok) {
    return {
      ok: false,
      error: body?.error || `HTTP ${res.status}`,
      status: res.status,
      body,
    };
  }
  return { ok: true, status: res.status, body };
}
