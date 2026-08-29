/**
 * CMS client-worker bridge — IAM → client worker proxy using AGENTSAM_BRIDGE_KEY.
 */
import { buildCmsBridgeHeaders } from '../../backend/auth/cms-bridge-trust.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/** @param {string} apiProfile */
export function mapBridgePathToClient(apiProfile, bridgePath) {
  const profile = trim(apiProfile).toLowerCase();
  const path = trim(bridgePath).replace(/\/$/, '') || '/';

  if (profile === 'fuel_admin') {
    const rest = path.replace(/^\/api\/cms\/bridge\/admin\/cms/, '');
    return `/api/admin/cms${rest || ''}`;
  }
  if (profile === 'cpas_fragment') {
    const rest = path.replace(/^\/api\/cms\/bridge\/cms/, '');
    return `/api/cms${rest || ''}`;
  }
  return null;
}

/**
 * @param {string} apiProfile
 * @param {string} bridgePrefix
 */
export function bridgePrefixForProfile(apiProfile) {
  const profile = trim(apiProfile).toLowerCase();
  if (profile === 'fuel_admin') return '/api/cms/bridge/admin/cms';
  if (profile === 'cpas_fragment') return '/api/cms/bridge/cms';
  return null;
}

/**
 * Bridge is available when registry points at a client worker with a known API profile.
 * Operator-hub picks use cms_hosting "platform" but still bridge_supported.
 * @param {Record<string, unknown>|null|undefined} siteConfig
 */
export function isCmsBridgeEligible(siteConfig) {
  if (!siteConfig?.bridge_supported) return false;
  if (!trim(siteConfig.worker_base_url)) return false;
  return Boolean(bridgePrefixForProfile(siteConfig.api_profile));
}

/**
 * @param {any} env
 * @param {Request} request
 * @param {{ id?: string, tenant_id?: string }} authUser
 * @param {Record<string, unknown>} siteConfig
 * @param {string} bridgePath
 * @param {{ method?: string, body?: string, expectHtml?: boolean }} [overrides]
 */
export async function proxyCmsBridgeRequest(env, request, authUser, siteConfig, bridgePath, overrides = {}) {
  const base = trim(siteConfig?.worker_base_url);
  if (!base) {
    return { ok: false, status: 503, body: { error: 'CLIENT_WORKER_BASE_URL_MISSING' } };
  }

  const clientPath = mapBridgePathToClient(siteConfig.api_profile, bridgePath);
  if (!clientPath) {
    return { ok: false, status: 400, body: { error: 'BRIDGE_PROFILE_UNSUPPORTED', api_profile: siteConfig.api_profile } };
  }

  const url = new URL(clientPath, base.endsWith('/') ? base : `${base}/`);
  const incoming = new URL(request.url);
  incoming.searchParams.forEach((val, key) => url.searchParams.set(key, val));

  let headers;
  try {
    headers = buildCmsBridgeHeaders(env, authUser, siteConfig);
  } catch (e) {
    return { ok: false, status: 503, body: { error: e?.message || 'bridge_headers_failed' } };
  }

  const method = (overrides.method || request.method).toUpperCase();
  const init = {
    method,
    headers: {
      ...headers,
      ...(method !== 'GET' && method !== 'HEAD'
        ? { 'Content-Type': request.headers.get('Content-Type') || 'application/json' }
        : {}),
    },
  };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body =
      overrides.body != null ? overrides.body : await request.arrayBuffer();
  }

  try {
    const res = await fetch(url.toString(), init);
    const text = await res.text();
    if (overrides.expectHtml) {
      return { ok: res.ok, status: res.status, body: text, contentType: res.headers.get('Content-Type') };
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 4000) };
    }
    return { ok: res.ok, status: res.status, body: json, contentType: res.headers.get('Content-Type') };
  } catch (e) {
    return { ok: false, status: 502, body: { error: e?.message || 'bridge_fetch_failed' } };
  }
}

/**
 * Mint embed session on client worker (Agent 4 endpoint — may 401/404 until client ships).
 * @param {any} env
 * @param {{ id?: string, tenant_id?: string }} authUser
 * @param {Record<string, unknown>} siteConfig
 */
export async function mintCmsEmbedSession(env, authUser, siteConfig) {
  const base = trim(siteConfig?.worker_base_url);
  if (!base) {
    return { ok: false, status: 503, error: 'CLIENT_WORKER_BASE_URL_MISSING' };
  }

  let headers;
  try {
    headers = buildCmsBridgeHeaders(env, authUser, siteConfig);
  } catch (e) {
    return { ok: false, status: 503, error: e?.message || 'bridge_headers_failed' };
  }

  const url = `${base.replace(/\/$/, '')}/_internal/cms-embed-session`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id: siteConfig.workspace_id,
        project_slug: siteConfig.project_slug,
        studio_path: siteConfig.studio_path,
      }),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { error: text.slice(0, 400) };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, error: json?.error || `embed_session_http_${res.status}`, body: json };
    }
    const token = trim(json?.embed_token);
    const expiresAt = json?.expires_at ?? null;
    const embedUrl =
      token && siteConfig.studio_url
        ? `${siteConfig.studio_url}${siteConfig.studio_url.includes('?') ? '&' : '?'}embed_token=${encodeURIComponent(token)}&embed=1`
        : siteConfig.studio_url;
    return { ok: true, embed_url: embedUrl, expires_at: expiresAt, raw: json };
  } catch (e) {
    return { ok: false, status: 502, error: e?.message || 'embed_session_fetch_failed' };
  }
}
