/** Settings HTTP composition. Domain handlers own behavior. */
import { handleKeysRequest } from './keys.js';
import { handleIndexRulesRequest } from './index-rules.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function mutationIsSameOrigin(request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return true;
  const expected = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  if (origin) return origin === expected;
  const referer = request.headers.get('referer');
  if (referer) {
    try { return new URL(referer).origin === expected; } catch { return false; }
  }
  return request.headers.get('sec-fetch-site') === 'same-origin';
}

export async function handleSettingsRequest(request, env, identity, scope) {
  const path = new URL(request.url).pathname.replace(/\/$/, '');
  if (!path.startsWith('/api/settings/')) return null;
  if (!mutationIsSameOrigin(request)) {
    return json({ ok: false, error: 'cross_origin_settings_mutation_rejected' }, 403);
  }

  // The bootstrap Gemini-only route used a second encryption key. Keep the old
  // URL loud so no caller can silently recreate that parallel authority.
  if (path === '/api/settings/ai-keys/gemini') {
    return json({
      ok: false,
      error: 'endpoint_retired',
      message: 'Use /api/settings/keys with provider=google. user_secrets is the single BYOK authority.',
    }, 410);
  }

  const keys = await handleKeysRequest(request, env, identity, scope);
  if (keys) return keys;

  const indexRules = await handleIndexRulesRequest(request, env, identity, scope);
  if (indexRules) return indexRules;

  return null;
}
