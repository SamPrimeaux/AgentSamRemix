/**
 * MY_CONTAINER lane — health probe, exec, render dispatch.
 * Image: registry …/inneranimalmedia:sandbox-v3 (basic, 1 GiB).
 * Instance id: inneranimalmedia (matches worker name — single platform pool).
 */

export const CONTAINER_IMAGE_REF =
  'registry.cloudflare.com/ede6590ac0d2fb7daf155b35653457b2/inneranimalmedia:sandbox-v3';
export const CONTAINER_IMAGE_TAG = 'inneranimalmedia:sandbox-go-v5';

/** Legacy getByName ids from pre-inneranimalmedia pool routing — safe to destroy. */
export const LEGACY_CONTAINER_INSTANCE_NAMES = Object.freeze([
  'meaux-pool',
  'specialist',
  'sam',
  'engineer',
  'default',
]);

/** Default MY_CONTAINER pool id — must match worker name (wrangler name = inneranimalmedia). */
export const CONTAINER_POOL_ID_DEFAULT = 'inneranimalmedia';

/** @param {any} env */
export function resolveContainerPoolId(env) {
  const fromEnv = String(env?.CONTAINER_POOL_ID || '').trim();
  return fromEnv || CONTAINER_POOL_ID_DEFAULT;
}

const CONTAINER_PORT = 8080;
/** Worker → DO → container HTTP (includes cold start). */
export const CONTAINER_FETCH_TIMEOUT_MS = 120_000;
/** In-container command budget after instance is up (server.mjs caps at 120s). */
export const CONTAINER_EXEC_COMMAND_TIMEOUT_MS = 90_000;
/** Agent/MCP Promise.race budget — cold start (10–20s+) + command headroom. */
export const CONTAINER_TOOL_EXECUTION_BUDGET_MS = 120_000;

/** @param {string} toolName */
export function isContainerExecToolName(toolName) {
  const n = String(toolName || '').trim().toLowerCase();
  return (
    n === 'agentsam_terminal_sandbox' ||
    n === 'agentsam_code_interpreter' ||
    n === 'python_execute' ||
    n === 'agentsam_container_exec' ||
    n === 'terminal_run' ||
    n === 'terminal_execute' ||
    n === 'terminal_wrangler' ||
    n === 'run_command' ||
    n === 'bash'
  );
}

/**
 * @param {any} stub
 * @param {string} path
 * @param {RequestInit} [init]
 */
async function containerFetch(stub, path, init = {}) {
  const method = String(init?.method || 'GET').toUpperCase();
  const isPost = method === 'POST';
  const maxAttempts = isPost ? 3 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
    const ac = new AbortController();
    const externalSignal = init?.signal || null;
    const onAbort = () => ac.abort(externalSignal?.reason || new Error('container_exec_cancelled'));
    if (externalSignal?.aborted) onAbort();
    else externalSignal?.addEventListener?.('abort', onAbort, { once: true });
    const timer = setTimeout(() => ac.abort(new Error('container_fetch_timeout')), CONTAINER_FETCH_TIMEOUT_MS);
    try {
      const res = await stub.fetch(`http://container${path}`, {
        ...init,
        signal: ac.signal,
      });
      if (isPost && res.status >= 500 && attempt < maxAttempts) {
        continue;
      }
      return res;
    } catch (e) {
      const msg = String(e?.message || e);
      const retryable = /abort|timeout|disconnect|VMStopped|suddenly disconnected/i.test(msg);
      if (!externalSignal?.aborted && isPost && retryable && attempt < maxAttempts) {
        continue;
      }
      throw e;
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener?.('abort', onAbort);
    }
  }

  throw new Error('container_fetch_exhausted');
}

/** @param {any} env */
function containerNamespace(env) {
  return env?.MY_CONTAINER || env?.MOVIEMODE_RENDER || null;
}

/**
 * Interactive Sandbox PTY — WebSocket upgrade to container /v1/pty.
 * No cross-lane fallback. On 404 / missing health.pty (stale image), destroy pool once and retry.
 *
 * @param {any} env
 * @param {{ cwd?: string|null, shell?: string|null, cols?: number|null, rows?: number|null }} [opts]
 * @returns {Promise<{ ok: true, webSocket: WebSocket, cwd: string, transport: string, host_kind: string } | { ok: false, error: string }>}
 */
export async function tryContainerPtyConnect(env, opts = {}) {
  const ns = containerNamespace(env);
  if (!ns?.getByName) {
    return { ok: false, error: 'container_unbound' };
  }

  const cwd = String(opts.cwd || '/tmp').trim() || '/tmp';
  const shell = String(opts.shell || '/bin/bash').trim() || '/bin/bash';
  const cols = Number.isFinite(Number(opts.cols)) ? Math.max(20, Number(opts.cols)) : 80;
  const rows = Number.isFinite(Number(opts.rows)) ? Math.max(5, Number(opts.rows)) : 24;

  /**
   * @param {boolean} allowRecycle
   * @returns {Promise<{ ok: true, webSocket: WebSocket, cwd: string, transport: string, host_kind: string, pool_id: string, image: string } | { ok: false, error: string, recycle?: boolean }>}
   */
  const attempt = async (allowRecycle) => {
    try {
      const stub = await getContainerStub(env);
      if (!stub) return { ok: false, error: 'container_unbound' };

      // Stale pool instances (pre-/v1/pty) return HTTP 404 — detect via health before upgrade.
      try {
        const healthRes = await stub.fetch('http://container/health');
        const health = await healthRes.json().catch(() => null);
        if (healthRes.ok && health && health.pty !== true && allowRecycle) {
          await destroyContainerPoolInstance(env);
          return { ok: false, error: 'container_pty_image_stale', recycle: true };
        }
      } catch (_) {
        /* cold start — proceed to upgrade */
      }

      const path = `/v1/pty?cwd=${encodeURIComponent(cwd)}&shell=${encodeURIComponent(shell)}&cols=${cols}&rows=${rows}`;
      const req = new Request(`http://container${path}`, {
        method: 'GET',
        headers: {
          Upgrade: 'websocket',
          Connection: 'Upgrade',
          'Sec-WebSocket-Key': btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))),
          'Sec-WebSocket-Version': '13',
        },
      });
      let res = await stub.fetch(req);
      // Alias for older images that only registered /pty (still recycle if both miss).
      if (res.status === 404) {
        const alt = new Request(
          `http://container/pty?cwd=${encodeURIComponent(cwd)}&shell=${encodeURIComponent(shell)}&cols=${cols}&rows=${rows}`,
          {
            method: 'GET',
            headers: {
              Upgrade: 'websocket',
              Connection: 'Upgrade',
              'Sec-WebSocket-Key': btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))),
              'Sec-WebSocket-Version': '13',
            },
          },
        );
        res = await stub.fetch(alt);
      }
      if (res.status === 404 && allowRecycle) {
        await destroyContainerPoolInstance(env);
        return { ok: false, error: 'container_pty_upgrade_failed_404', recycle: true };
      }
      if (res.status !== 101 || !res.webSocket) {
        return { ok: false, error: `container_pty_upgrade_failed_${res.status}` };
      }
      return {
        ok: true,
        webSocket: res.webSocket,
        cwd,
        transport: 'container_ws',
        host_kind: 'cf_container',
        pool_id: resolveContainerPoolId(env),
        image: CONTAINER_IMAGE_TAG,
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e).slice(0, 400) || 'container_pty_failed' };
    }
  };

  let first = await attempt(true);
  if (first.ok) return first;
  if (first.recycle) {
    // Brief pause so destroy settles, then cold-start on current image.
    await new Promise((r) => setTimeout(r, 750));
    const second = await attempt(false);
    if (second.ok) return second;
    return {
      ok: false,
      error: second.error || first.error || 'container_pty_unavailable',
    };
  }
  return { ok: false, error: first.error || 'container_pty_unavailable' };
}

/**
 * @param {any} env
 * @param {{ ports?: number[] }} [opts]
 */
async function getContainerStub(env) {
  const ns = containerNamespace(env);
  if (!ns?.getByName) return null;
  return ns.getByName(resolveContainerPoolId(env));
}

/**
 * @param {any} env
 */
export async function probeMyContainer(env) {
  const ns = containerNamespace(env);
  if (!ns?.getByName) {
    return { ok: false, bound: false, lane: 'container', image: null };
  }
  try {
    const stub = await getContainerStub(env);
    if (!stub) {
      return { ok: false, bound: false, lane: 'container', image: CONTAINER_IMAGE_TAG };
    }
    const res = await containerFetch(stub, '/health');
    const text = await res.text().catch(() => '');
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = { bodyPreview: text.slice(0, 200) };
    }
    return {
      ok: res.ok && json?.ok !== false,
      bound: true,
      lane: 'container',
      status: res.status,
      image: CONTAINER_IMAGE_TAG,
      pool_id: resolveContainerPoolId(env),
      response: json,
    };
  } catch (e) {
    return {
      ok: false,
      bound: true,
      lane: 'container',
      image: CONTAINER_IMAGE_TAG,
      error: String(e?.message || e).slice(0, 400),
    };
  }
}

/** @deprecated use probeMyContainer */
export const probeMoviemodeRenderContainer = probeMyContainer;

/**
 * Single platform container instance — always inneranimalmedia (worker name).
 * zone_slug is metadata + cwd isolation only, not a separate DO instance id.
 * @param {any} env
 * @param {string} [_zoneSlug]
 */
async function getZoneContainerStub(env, _zoneSlug) {
  return getContainerStub(env);
}

/**
 * Per-zone sandbox exec (zone_slug → Container DO instance id).
 * @param {any} env
 * @param {{ command: string, zone_slug?: string, cwd?: string, timeout_ms?: number }} opts
 */
export async function tryZoneContainerExec(env, opts) {
  const command = String(opts?.command || '').trim();
  const zoneSlug = String(opts?.zone_slug || 'specialist').trim() || 'specialist';
  if (!command) {
    return { ok: false, error: 'command_required', lane: 'container', zone_slug: zoneSlug };
  }

  const ns = containerNamespace(env);
  if (!ns?.getByName) {
    return { ok: false, error: 'container_unbound', lane: 'container', zone_slug: zoneSlug };
  }

  try {
    const stub = await getZoneContainerStub(env, zoneSlug);
    if (!stub) {
      return { ok: false, error: 'container_unbound', lane: 'container', zone_slug: zoneSlug };
    }

    const res = await containerFetch(stub, '/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command,
        cwd: opts.cwd ? String(opts.cwd) : '/tmp',
        timeout_ms:
          opts.timeout_ms != null && Number.isFinite(Number(opts.timeout_ms))
            ? Number(opts.timeout_ms)
            : CONTAINER_EXEC_COMMAND_TIMEOUT_MS,
      }),
    });

    const data = await res.json().catch(() => ({}));
    return {
      lane: 'container',
      zone_slug: zoneSlug,
      pool_id: resolveContainerPoolId(env),
      image: CONTAINER_IMAGE_TAG,
      http_status: res.status,
      ...data,
    };
  } catch (e) {
    const msg = String(e?.message || e);
    const timedOut = /abort|timeout/i.test(msg);
    return {
      ok: false,
      lane: 'container',
      zone_slug: zoneSlug,
      image: CONTAINER_IMAGE_TAG,
      error: timedOut ? 'container_start_timeout' : msg.slice(0, 400),
    };
  }
}

/**
 * @param {any} env
 * @param {{ command: string, cwd?: string, timeout_ms?: number, signal?: AbortSignal|null }} opts
 */
export async function tryContainerExec(env, opts) {
  let command = String(opts?.command || '').trim();
  if (!command) {
    return { ok: false, error: 'command_required', lane: 'container' };
  }

  if (!opts?.skip_wrangler_normalize) {
    const { prepareContainerShellCommand } = await import('../../../src/core/wrangler-terminal-guidance.js');
    const prep = await prepareContainerShellCommand(env, opts?.authUser ?? null, command, 'sandbox');
    if (!prep.ok) {
      return {
        ok: false,
        lane: 'container',
        image: CONTAINER_IMAGE_TAG,
        error: prep.error,
        guidance: prep.guidance,
      };
    }
    command = prep.command;
  }

  const ns = containerNamespace(env);
  if (!ns?.getByName) {
    return { ok: false, error: 'container_unbound', lane: 'container' };
  }

  const body = JSON.stringify({
    command,
    cwd: opts.cwd ? String(opts.cwd) : '/tmp',
    timeout_ms:
      opts.timeout_ms != null && Number.isFinite(Number(opts.timeout_ms))
        ? Number(opts.timeout_ms)
        : CONTAINER_EXEC_COMMAND_TIMEOUT_MS,
  });

  try {
    const stub = await getContainerStub(env);
    if (!stub) {
      return { ok: false, error: 'container_unbound', lane: 'container' };
    }

    const init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      ...(opts?.signal ? { signal: opts.signal } : {}),
    };
    let res = await containerFetch(stub, '/v1/exec', init);
    if (res.status === 404) {
      res = await containerFetch(stub, '/exec', init);
    }

    const data = await res.json().catch(() => ({}));
    return {
      lane: 'container',
      image: CONTAINER_IMAGE_TAG,
      pool_id: resolveContainerPoolId(env),
      http_status: res.status,
      ...data,
    };
  } catch (e) {
    const msg = String(e?.message || e);
    const timedOut = /abort|timeout/i.test(msg);
    return {
      ok: false,
      lane: 'container',
      image: CONTAINER_IMAGE_TAG,
      error: timedOut ? 'container_start_timeout' : msg.slice(0, 400),
    };
  }
}


/**
 * Execute in a fresh named container instance and destroy that exact instance afterward.
 * This is the sandbox lane's ephemeral lifecycle (spin up → exec → destroy).
 * @param {any} env
 * @param {{ command: string, cwd?: string, timeout_ms?: number, authUser?: any, instance_name?: string, signal?: AbortSignal|null }} opts
 */
export async function tryEphemeralContainerExec(env, opts) {
  let command = String(opts?.command || '').trim();
  if (!command) return { ok: false, error: 'command_required', lane: 'container', lifecycle: 'ephemeral' };

  if (!opts?.skip_wrangler_normalize) {
    const { prepareContainerShellCommand } = await import('../../../src/core/wrangler-terminal-guidance.js');
    const prep = await prepareContainerShellCommand(env, opts?.authUser ?? null, command, 'sandbox');
    if (!prep.ok) {
      return {
        ok: false,
        lane: 'container',
        lifecycle: 'ephemeral',
        image: CONTAINER_IMAGE_TAG,
        error: prep.error,
        guidance: prep.guidance,
      };
    }
    command = prep.command;
  }

  const ns = containerNamespace(env);
  if (!ns?.getByName) {
    return { ok: false, error: 'container_unbound', lane: 'container', lifecycle: 'ephemeral' };
  }

  const instanceName = String(opts?.instance_name || `ephemeral-${crypto.randomUUID()}`).trim();
  const stub = ns.getByName(instanceName);
  const body = JSON.stringify({
    command,
    cwd: opts?.cwd ? String(opts.cwd) : '/tmp',
    timeout_ms:
      opts?.timeout_ms != null && Number.isFinite(Number(opts.timeout_ms))
        ? Number(opts.timeout_ms)
        : CONTAINER_EXEC_COMMAND_TIMEOUT_MS,
  });

  let result = null;
  let destroy = { ok: false, destroyed: false };
  try {
    const fetchOnce = async (path) => {
      const ac = new AbortController();
      const onAbort = () => ac.abort(opts?.signal?.reason || new Error('terminal_job_cancelled'));
      if (opts?.signal?.aborted) onAbort();
      else opts?.signal?.addEventListener?.('abort', onAbort, { once: true });
      const timer = setTimeout(() => ac.abort(new Error('container_exec_timeout')), CONTAINER_FETCH_TIMEOUT_MS);
      try {
        return await stub.fetch(`http://container${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: ac.signal,
        });
      } finally {
        clearTimeout(timer);
        opts?.signal?.removeEventListener?.('abort', onAbort);
      }
    };
    // Batch commands may be non-idempotent: never retry an exec POST automatically.
    let res = await fetchOnce('/v1/exec');
    if (res.status === 404) res = await fetchOnce('/exec');
    const data = await res.json().catch(() => ({}));
    result = {
      lane: 'container',
      lifecycle: 'ephemeral',
      instance_name: instanceName,
      image: CONTAINER_IMAGE_TAG,
      http_status: res.status,
      ...data,
    };
  } catch (e) {
    const msg = String(e?.message || e);
    result = {
      ok: false,
      lane: 'container',
      lifecycle: 'ephemeral',
      instance_name: instanceName,
      image: CONTAINER_IMAGE_TAG,
      error: /abort|timeout/i.test(msg) ? 'container_start_timeout' : msg.slice(0, 400),
    };
  } finally {
    try {
      const res = await stub.fetch('http://container/__admin/destroy', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      destroy = {
        ok: res.ok && data?.destroyed !== false,
        destroyed: data?.destroyed !== false,
        http_status: res.status,
        error: data?.error || null,
      };
    } catch (e) {
      destroy = { ok: false, destroyed: false, error: String(e?.message || e).slice(0, 300) };
    }
  }

  return { ...result, cleanup: destroy };
}

/**
 * Destroy legacy DO container instances (dashboard clutter from old zone routing).
 * @param {any} env
 * @param {string[]} [names]
 */
export async function purgeLegacyContainerInstances(env, names = LEGACY_CONTAINER_INSTANCE_NAMES) {
  const ns = containerNamespace(env);
  if (!ns?.getByName) {
    return { ok: false, error: 'container_unbound', results: [] };
  }

  const poolId = resolveContainerPoolId(env);
  /** @type {Array<{ name: string, ok: boolean, error?: string }>} */
  const results = [];

  for (const raw of names) {
    const name = String(raw || '').trim();
    if (!name || name === poolId) continue;
    try {
      const stub = ns.getByName(name);
      const res = await stub.fetch('http://container/__admin/destroy', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      results.push({ name, ok: res.ok && data?.destroyed !== false, error: data?.error });
    } catch (e) {
      results.push({ name, ok: false, error: String(e?.message || e).slice(0, 200) });
    }
  }

  return { ok: results.every((r) => r.ok), pool_id: poolId, results };
}

/**
 * Stop/destroy the live pool DO so billing stops and the next exec cold-starts.
 * Prefer stop() — destroy() can fail loud when the image calls process.exit on SIGTERM.
 * @param {any} env
 */
export async function destroyContainerPoolInstance(env) {
  const ns = containerNamespace(env);
  const poolId = resolveContainerPoolId(env);
  if (!ns?.getByName) {
    return { ok: false, error: 'container_unbound', pool_id: poolId };
  }
  const stub = ns.getByName(poolId);
  /** @type {{ ok: boolean, pool_id: string, stopped?: boolean, destroyed?: boolean, error?: string|null, http_status?: number }} */
  const out = { ok: false, pool_id: poolId, stopped: false, destroyed: false, error: null };

  try {
    if (typeof stub.stop === 'function') {
      await stub.stop();
      out.stopped = true;
      out.ok = true;
    }
  } catch (e) {
    out.error = String(e?.message || e).slice(0, 300);
  }

  try {
    const res = await stub.fetch('http://container/__admin/destroy', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    out.http_status = res.status;
    out.destroyed = data?.destroyed !== false && res.ok;
    if (out.destroyed) out.ok = true;
    if (data?.error) out.error = String(data.error).slice(0, 300);
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 300);
    // process.exit during teardown is noisy but often still stops the instance.
    if (/process\.exit/i.test(msg) && out.stopped) {
      out.ok = true;
      out.error = null;
    } else if (!out.ok) {
      out.error = msg;
    }
  }

  return out;
}

/**
 * @param {any} env
 * @param {string} jobId
 * @param {Record<string, unknown>} job
 */
export async function tryMoviemodeRenderOnContainer(env, jobId, job) {
  const ns = containerNamespace(env);
  if (!ns?.getByName) {
    return { handled: false, fallback: true, reason: 'container_unbound' };
  }

  try {
    const stub = await getContainerStub(env);
    if (!stub) {
      return { handled: false, fallback: true, reason: 'container_unbound' };
    }

    const res = await stub.fetch('http://container/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobId,
        session: job.session,
        config: job.config,
        outputFilename: job.outputFilename,
        workspaceId: job.workspaceId,
        tenantId: job.tenantId,
        userId: job.userId,
        origin: env.IAM_ORIGIN || 'https://inneranimalmedia.com',
      }),
    });
    const data = await res.json().catch(() => ({}));

    if (res.status === 404 || res.status === 501 || data.fallback === true) {
      return {
        handled: false,
        fallback: true,
        reason: data.error || `container_http_${res.status}`,
        containerStatus: res.status,
      };
    }

    if (!res.ok) {
      return {
        handled: false,
        fallback: true,
        reason: data.error || `container_http_${res.status}`,
        containerStatus: res.status,
      };
    }

    return { handled: true, fallback: false, result: data };
  } catch (e) {
    return {
      handled: false,
      fallback: true,
      reason: 'container_error',
      error: String(e?.message || e).slice(0, 400),
    };
  }
}

/** Smoke exec for in-app runtime confirmation (status bar / Context tab). */
export async function runSandboxSmokeExec(env) {
  return tryContainerExec(env, {
    command: 'echo iam-sandbox-ok',
    cwd: '/tmp',
    timeout_ms: 20_000,
  });
}

/**
 * GET JSON from container HTTP API (e.g. /v1/mounts).
 * @param {any} env
 * @param {string} path
 */
export async function fetchSandboxContainerJson(env, path) {
  const stub = await getContainerStub(env);
  if (!stub) return null;
  try {
    const res = await containerFetch(stub, path);
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

/**
 * Proxy authenticated sandbox HTTP to container (Go /v1/* API).
 * @param {any} env
 * @param {Request} request
 * @param {string} subpath e.g. /v1/mounts
 */
export async function proxySandboxContainer(env, request, subpath) {
  const ns = containerNamespace(env);
  if (!ns?.getByName) {
    return Response.json({ ok: false, error: 'container_unbound' }, { status: 503 });
  }
  try {
    const stub = await getContainerStub(env);
    if (!stub) {
      return Response.json({ ok: false, error: 'container_unbound' }, { status: 503 });
    }
    /** @type {RequestInit} */
    const init = { method: request.method, headers: request.headers };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = await request.text();
    }
    const res = await containerFetch(stub, subpath, init);
    return new Response(res.body, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('Content-Type') || 'application/json; charset=utf-8',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e).slice(0, 400) }, { status: 502 });
  }
}
