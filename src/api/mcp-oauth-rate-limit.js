/**
 * Lightweight rate limits for IAM MCP OAuth authorize/token endpoints.
 */

function oauthRateLimitKv(env) {
  return env.SESSION_CACHE || env.OAUTH_KV || null;
}

/**
 * @param {*} env
 * @param {Request} request
 * @param {'authorize'|'token'} bucket
 * @param {number} [maxPerHour]
 */
export async function checkMcpOAuthRateLimit(env, request, bucket, maxPerHour = 60) {
  const kv = oauthRateLimitKv(env);
  if (!kv) return { ok: true };

  const ip = String(request.headers.get('cf-connecting-ip') || 'unknown').trim();
  let clientId = '';
  try {
    const url = new URL(request.url);
    clientId =
      bucket === 'authorize'
        ? String(url.searchParams.get('client_id') || '').trim()
        : '';
  } catch (_) {}

  const window = Math.floor(Date.now() / 3600000);
  const key = `mcp_oauth_rl:${bucket}:${ip}:${clientId || '_'}:${window}`;
  const cur = parseInt((await kv.get(key)) || '0', 10);
  if (cur >= maxPerHour) {
    return { ok: false, error: 'rate_limit_exceeded', retry_after: 3600 };
  }
  await kv.put(key, String(cur + 1), { expirationTtl: 7200 });
  return { ok: true };
}
