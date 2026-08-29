/**
 * Authenticated sandbox API — proxies to MY_CONTAINER Go HTTP service.
 * Surfaces in existing agent/editor UI via status bar + Context tab (no /dashboard/lab).
 *
 * Cost law: passive health / bootstrap must NOT run container exec or cold-start smoke.
 * Deep checks (exec + mounts) only with ?smoke=1 (explicit UI action).
 */
import { getAuthUser, jsonResponse } from '../core/auth.js';
import {
  probeMyContainer,
  proxySandboxContainer,
  runSandboxSmokeExec,
  fetchSandboxContainerJson,
} from '../../backend/agentsam/sandbox/my-container.js';
import {
  sandboxR2FusePublicSummary,
  sandboxR2FuseConfigured,
} from '../../backend/agentsam/sandbox/r2-fuse-env.js';

/**
 * @param {Request} request
 * @param {URL} url
 * @param {any} env
 */
export async function handleSandboxApi(request, url, env) {
  const method = request.method.toUpperCase();
  const path = url.pathname.replace(/\/$/, '') || '/';

  const authUser = await getAuthUser(request, env);
  if (!authUser) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  if (path === '/api/sandbox/health' && method === 'GET') {
    const wantSmoke =
      url.searchParams.get('smoke') === '1' ||
      url.searchParams.get('deep') === '1' ||
      url.searchParams.get('exec') === '1';
    const probe = await probeMyContainer(env);
    if (!wantSmoke) {
      return jsonResponse({
        ok: probe.ok === true,
        probe,
        exec_smoke: null,
        mounts: null,
        r2_fuse: sandboxR2FusePublicSummary(env, null),
        r2_fuse_configured: sandboxR2FuseConfigured(env),
        image: probe.image || null,
        mode: 'probe',
        checked_at: Date.now(),
      });
    }
    let exec_smoke = null;
    let mounts = null;
    if (probe.ok) {
      exec_smoke = await runSandboxSmokeExec(env);
      mounts = await fetchSandboxContainerJson(env, '/v1/mounts');
    }
    const r2_fuse = sandboxR2FusePublicSummary(env, mounts);
    return jsonResponse({
      ok: probe.ok && exec_smoke?.ok !== false,
      probe,
      exec_smoke,
      mounts,
      r2_fuse,
      r2_fuse_configured: sandboxR2FuseConfigured(env),
      image: probe.image || null,
      mode: 'smoke',
      checked_at: Date.now(),
    });
  }

  if (path.startsWith('/api/sandbox/v1/')) {
    const subpath = path.slice('/api/sandbox'.length);
    return proxySandboxContainer(env, request, subpath);
  }

  return jsonResponse({ error: 'Not found' }, 404);
}

/**
 * Compact runtime summary for status bundle + mobile Context tab.
 * Probe-only — never smoke-exec. Callers that must not wake the container
 * should use {@link deferredSandboxRuntimeSummary} instead.
 * @param {any} env
 */
export async function fetchSandboxRuntimeSummary(env) {
  const probe = await probeMyContainer(env);
  if (!probe.ok) {
    return {
      ok: false,
      lane: 'container',
      label: probe.error || 'Container unavailable',
      image: probe.image || null,
      mode: 'probe',
    };
  }
  return {
    ok: true,
    lane: 'container',
    label: 'CF sandbox reachable',
    image: probe.image || null,
    stdout: null,
    r2_fuse: sandboxR2FusePublicSummary(env, null),
    mode: 'probe',
  };
}

/**
 * Bootstrap / status-bundle placeholder — does not touch MY_CONTAINER.
 * Client polls /api/sandbox/health only when dock lane is sandbox, or after an
 * explicit Connect click in ContainerExplorer (never on Files-panel mount).
 */
export function deferredSandboxRuntimeSummary() {
  return {
    ok: null,
    lane: 'container',
    label: 'Sandbox deferred (dock lane)',
    image: null,
    deferred: true,
    mode: 'deferred',
  };
}
