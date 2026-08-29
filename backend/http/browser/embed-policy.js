/**
 * GET/POST/DELETE /api/agentsam/browser/embed-policy — D1-driven iframe embed policy
 * with live X-Frame-Options / frame-ancestors probe (self-healing).
 *
 * GET    ?url=<url>[&probe=0] -> { host, embed_mode, source }  source: d1 | seed | probe | default
 * POST   { host_suffix, embed_mode, note? } -> manual upsert (operator override)
 * DELETE { host_suffix } -> remove row
 *
 * Resolution order: D1 row (operator override wins) -> hardcoded seed -> live probe
 * (result upserted with source='probe') -> default 'passive'. Probe failures are
 * never persisted, so a transient outage cannot poison the table.
 */
import { getAuthUser } from '../../identity/index.js';
import { httpJsonResponse as jsonResponse } from '../responses.js';
import {
  EMBED_MODES,
  ensureEmbedPolicyTable,
  hostFromUrl,
  originRequiresBrowserRunEmbed,
  probeEmbedMode,
  resolveEmbedModeFromD1,
  upsertEmbedPolicy,
} from '../../browser/policy/embed.js';

export async function handleBrowserEmbedPolicy(request, env) {
  const user = await getAuthUser(request, env);
  if (!user) return new Response('Unauthorized', { status: 401 });

  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (method === 'GET') {
    const target = String(url.searchParams.get('url') || url.searchParams.get('origin') || '').trim();
    const host = hostFromUrl(target);
    if (!host) return jsonResponse({ error: 'url or origin required' }, 400);

    await ensureEmbedPolicyTable(env);

    const row = await resolveEmbedModeFromD1(env, host);
    if (row) {
      return jsonResponse({
        host,
        embed_mode: row.embed_mode,
        source: 'd1',
        matched_suffix: row.host_suffix,
      });
    }

    if (originRequiresBrowserRunEmbed(target)) {
      return jsonResponse({ host, embed_mode: 'browser_run', source: 'seed' });
    }

    if (url.searchParams.get('probe') === '0') {
      return jsonResponse({ host, embed_mode: 'passive', source: 'default' });
    }

    const probeUrl = /^https?:\/\//i.test(target) ? target : `https://${host}/`;
    const probed = await probeEmbedMode(probeUrl);
    if (probed.ok && probed.embed_mode) {
      await upsertEmbedPolicy(env, {
        hostSuffix: host,
        embedMode: probed.embed_mode,
        source: 'probe',
        note: probed.header || `probe status ${probed.status}`,
      });
      return jsonResponse({
        host,
        embed_mode: probed.embed_mode,
        source: 'probe',
        header: probed.header ?? null,
      });
    }
    return jsonResponse({
      host,
      embed_mode: 'passive',
      source: 'default',
      probe_error: probed.error || 'probe_failed',
    });
  }

  if (method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch (_) {
      body = {};
    }
    const hostSuffix = String(body.host_suffix || body.host || '').trim().toLowerCase();
    const embedMode = String(body.embed_mode || '').trim().toLowerCase();
    if (!hostSuffix) return jsonResponse({ error: 'host_suffix required' }, 400);
    if (!EMBED_MODES.includes(embedMode)) {
      return jsonResponse({ error: `embed_mode must be one of ${EMBED_MODES.join(', ')}` }, 400);
    }
    const ok = await upsertEmbedPolicy(env, {
      hostSuffix,
      embedMode,
      source: 'manual',
      note: body.note != null ? String(body.note).slice(0, 300) : null,
    });
    return jsonResponse({ ok, host_suffix: hostSuffix, embed_mode: embedMode }, ok ? 200 : 503);
  }

  if (method === 'DELETE') {
    let body = {};
    try {
      body = await request.json();
    } catch (_) {
      body = {};
    }
    const hostSuffix = String(body.host_suffix || body.host || '').trim().toLowerCase();
    if (!hostSuffix) return jsonResponse({ error: 'host_suffix required' }, 400);
    if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 503);
    try {
      await env.DB.prepare('DELETE FROM agentsam_browser_embed_policy WHERE host_suffix = ?')
        .bind(hostSuffix)
        .run();
      return jsonResponse({ ok: true });
    } catch (err) {
      return jsonResponse({ ok: false, error: String(err).slice(0, 200) }, 500);
    }
  }

  return new Response('Method not allowed', { status: 405 });
}
