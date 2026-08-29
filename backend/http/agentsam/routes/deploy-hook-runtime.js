/**
 * Cloudflare Workers Builds — Deploy Hooks (POST URL acts as credential).
 * @see https://developers.cloudflare.com/workers/ci-cd/builds/deploy-hooks/
 */

import { resolveCronWorkspaceId } from '../../../jobs/cron-tenant.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * Redact deploy hook URL for API responses (keep last path segment).
 * @param {string|null|undefined} url
 */
export function redactDeployHookUrl(url) {
  const raw = trim(url);
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const parts = u.pathname.split('/').filter(Boolean);
    const tail = parts[parts.length - 1] || '***';
    return `${u.origin}${u.pathname.replace(tail, '***')}`;
  } catch {
    return '***';
  }
}

/**
 * @param {string} raw
 */
function validateDeployHookUrl(raw) {
  const urlStr = trim(raw);
  if (!urlStr) return { ok: false, error: 'deploy_hook_url missing' };
  let url;
  try {
    url = new URL(urlStr);
  } catch {
    return { ok: false, error: 'invalid deploy_hook_url' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, error: 'deploy hook URL must use https' };
  }
  if (!url.pathname.includes('/workers/builds/deploy_hooks/')) {
    return {
      ok: false,
      error: 'deploy hook URL must contain /workers/builds/deploy_hooks/',
    };
  }
  return { ok: true, url: urlStr };
}

/**
 * Resolution order:
 * 1. explicit deployHookUrl arg
 * 2. hookConfig.url / handler_config.url
 * 3. agentsam_workspace.metadata_json.deploy_hook_url
 * 4. AGENT_SAM_DEPLOY_HOOK_URL (IAM platform fallback)
 *
 * @param {any} env
 * @param {{ deployHookUrl?: string|null, workspaceId?: string|null, workerName?: string|null, hookConfig?: Record<string, unknown>|null }} opts
 */
export async function resolveWorkersDeployHookUrl(env, opts = {}) {
  const explicit = trim(opts.deployHookUrl);
  if (explicit) {
    const v = validateDeployHookUrl(explicit);
    if (v.ok) return { ok: true, url: v.url, source: 'explicit' };
    return v;
  }

  const cfg = opts.hookConfig && typeof opts.hookConfig === 'object' ? opts.hookConfig : {};
  const fromHook = trim(cfg.url);
  if (fromHook) {
    const v = validateDeployHookUrl(fromHook);
    if (v.ok) return { ok: true, url: v.url, source: 'hook_config' };
  }

  const wsId = trim(opts.workspaceId);
  if (wsId && env?.DB) {
    try {
      const row = await env.DB.prepare(
        `SELECT metadata_json FROM agentsam_workspace WHERE id = ? LIMIT 1`,
      )
        .bind(wsId)
        .first();
      if (row?.metadata_json) {
        let meta = {};
        try {
          meta = typeof row.metadata_json === 'string' ? JSON.parse(row.metadata_json) : row.metadata_json;
        } catch {
          meta = {};
        }
        const fromMeta = trim(meta.deploy_hook_url);
        if (fromMeta) {
          const v = validateDeployHookUrl(fromMeta);
          if (v.ok) return { ok: true, url: v.url, source: 'workspace_metadata' };
        }
      }
    } catch {
      /* ignore */
    }
  }

  const fallback =
    typeof env?.AGENT_SAM_DEPLOY_HOOK_URL === 'string' ? env.AGENT_SAM_DEPLOY_HOOK_URL.trim() : '';
  if (fallback) {
    const v = validateDeployHookUrl(fallback);
    if (v.ok) return { ok: true, url: v.url, source: 'env_fallback' };
  }

  return { ok: false, error: 'deploy_hook_url not configured' };
}

/**
 * @param {object} env Worker env
 * @param {{ deployHookUrl?: string|null, workspaceId?: string|null, workerName?: string|null, hookConfig?: Record<string, unknown>|null }} [opts]
 * @returns {Promise<{ ok: boolean, status: number, json?: object, raw?: string, error?: string, deploy_hook_url?: string, source?: string }>}
 */
export async function postWorkersDeployHook(env, opts = {}) {
  const resolved = await resolveWorkersDeployHookUrl(env, opts);
  if (!resolved.ok) {
    return { ok: false, status: 0, error: resolved.error || 'deploy_hook_url not configured' };
  }

  try {
    const res = await fetch(resolved.url, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    let cfOk = res.ok;
    if (json && typeof json === 'object' && 'success' in json) {
      cfOk = Boolean(json.success) && (!Array.isArray(json.errors) || json.errors.length === 0);
    }
    return {
      ok: cfOk,
      status: res.status,
      json,
      raw: text.slice(0, 800),
      deploy_hook_url: resolved.url,
      source: resolved.source,
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: e?.message || String(e),
      deploy_hook_url: resolved.url,
      source: resolved.source,
    };
  }
}

/** IAM platform default — thin wrapper for legacy callers. */
export async function postAgentSamDeployHook(env, opts = {}) {
  const workspaceId = opts.workspaceId ?? (await resolveCronWorkspaceId(env));
  return postWorkersDeployHook(env, {
    ...opts,
    workspaceId,
  });
}
