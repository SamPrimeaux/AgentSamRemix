/**
 * Worker facade for AgentBrowserLiveV1 (BROWSER_SESSION DO).
 * Auth: DO SQLite user_id/workspace_id — no separate D1 lease table.
 */

import { isBrowserSessionId } from './scope.js';

/**
 * @param {any} env
 */
export function browserLiveDoRequired(env) {
  return Boolean(env?.BROWSER_SESSION);
}

/**
 * @param {any} env
 * @returns {{ ok: true } | { ok: false, error: string, status: number }}
 */
export function assertBrowserLiveDoAvailable(env) {
  if (env?.BROWSER_SESSION) return { ok: true };
  const deployEnv = String(env?.ENVIRONMENT || 'production').toLowerCase();
  if (deployEnv === 'production') {
    return {
      ok: false,
      error: 'BROWSER_SESSION binding required for agent live browser in production',
      status: 503,
    };
  }
  return { ok: false, error: 'BROWSER_SESSION not configured', status: 503 };
}

/**
 * @param {any} env
 * @param {string} browserSessionId
 */
export function getBrowserLiveStub(env, browserSessionId) {
  const id = String(browserSessionId || '').trim();
  if (!isBrowserSessionId(id) || !env?.BROWSER_SESSION) return null;
  return env.BROWSER_SESSION.get(env.BROWSER_SESSION.idFromName(id));
}

/**
 * @param {any} env
 * @param {string} browserSessionId
 * @param {string} userId
 */
export async function assertBrowserSessionAccess(env, browserSessionId, userId) {
  const bsid = String(browserSessionId || '').trim();
  const uid = String(userId || '').trim();
  if (!isBrowserSessionId(bsid)) {
    return { ok: false, status: 400, code: 'bad_request', error: 'browser_session_id required (bsess_*)' };
  }
  if (!uid) {
    return { ok: false, status: 400, code: 'bad_request', error: 'user_id required' };
  }
  const gate = assertBrowserLiveDoAvailable(env);
  if (!gate.ok) return gate;

  const stub = getBrowserLiveStub(env, bsid);
  if (!stub) {
    return { ok: false, status: 503, code: 'do_unavailable', error: 'BROWSER_SESSION not configured' };
  }

  try {
    const res = await stub.fetch(new Request('https://browser-live.internal/session', { method: 'GET' }));
    let body = {};
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    const rowUser = String(body?.session?.user_id ?? body?.live_session?.user_id ?? '').trim();
    if (rowUser && rowUser !== uid) {
      return { ok: false, error: 'Forbidden', status: 403 };
    }
    const workspaceId = body?.session?.workspace_id ?? body?.live_session?.workspace_id ?? null;
    return { ok: true, workspace_id: workspaceId, unbound: !rowUser };
  } catch (e) {
    const message = String(e?.message ?? e);
    console.warn('[assertBrowserSessionAccess]', message);
    return { ok: false, status: 503, code: 'access_lookup_failed', error: message };
  }
}

/**
 * @deprecated Agent run access — not browser lease access. Use assertBrowserSessionAccess.
 * @param {any} env
 * @param {string} agentRunId
 * @param {string} userId
 */
export async function assertAgentRunAccess(env, agentRunId, userId) {
  const runId = String(agentRunId || '').trim();
  const uid = String(userId || '').trim();
  if (!runId || !uid) {
    return { ok: false, status: 400, code: 'bad_request', error: 'agent_run_id and user_id required' };
  }
  if (!env?.DB) {
    return { ok: false, status: 503, code: 'db_unavailable', error: 'database unavailable' };
  }

  try {
    const row = await env.DB.prepare(
      'SELECT id, user_id, workspace_id FROM agentsam_agent_run WHERE id = ? LIMIT 1',
    )
      .bind(runId)
      .first();
    if (!row) return { ok: false, error: 'agent run not found', status: 404 };
    if (String(row.user_id) !== uid) {
      return { ok: false, error: 'Forbidden', status: 403 };
    }
    return { ok: true, workspace_id: row.workspace_id ?? null };
  } catch (e) {
    const message = String(e?.message ?? e);
    console.warn('[assertAgentRunAccess]', message);
    return { ok: false, status: 503, code: 'access_lookup_failed', error: message };
  }
}

/**
 * @param {any} env
 * @param {string} browserSessionId
 * @param {string} path
 * @param {RequestInit} [init]
 */
export async function proxyToBrowserLiveDo(env, browserSessionId, path, init = {}) {
  const stub = getBrowserLiveStub(env, browserSessionId);
  if (!stub) {
    const gate = assertBrowserLiveDoAvailable(env);
    return { ok: false, error: gate.error || 'BROWSER_SESSION not configured', status: gate.status || 503 };
  }
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const url = `https://browser-live.internal${normalized}`;
  const res = await stub.fetch(new Request(url, init));
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = { error: res.statusText || 'DO request failed' };
  }
  return { ...body, ok: body.ok !== false && res.ok, status: res.status };
}

/**
 * @param {any} env
 * @param {string} browserSessionId
 * @param {{ url?: string|null, keepAliveMs?: number, liveViewMode?: string, userId?: string, workspaceId?: string, tool_name?: string, agentRunId?: string|null }} [opts]
 */
export async function ensureAgentLiveBrowserSessionViaDo(env, browserSessionId, opts = {}) {
  return proxyToBrowserLiveDo(env, browserSessionId, '/session/ensure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      browser_session_id: browserSessionId,
      agent_run_id: opts.agentRunId ?? opts.agent_run_id ?? null,
      url: opts.url ?? null,
      keep_alive_ms: opts.keepAliveMs,
      live_view_mode: opts.liveViewMode,
      user_id: opts.userId ?? opts.user_id,
      workspace_id: opts.workspaceId ?? opts.workspace_id,
      tool_name: opts.tool_name,
      defer_http_navigate: opts.deferHttpNavigate ?? opts.defer_http_navigate ?? false,
    }),
  });
}

/**
 * @param {any} env
 * @param {string} browserSessionId
 */
export async function getAgentLiveBrowserSessionViaDo(env, browserSessionId) {
  const out = await proxyToBrowserLiveDo(env, browserSessionId, '/session', { method: 'GET' });
  if (!out.ok) return null;
  return out.live_session ?? out.session ?? null;
}

/**
 * @param {any} env
 * @param {string} browserSessionId
 */
export async function refreshAgentLiveBrowserUrlViaDo(env, browserSessionId) {
  return proxyToBrowserLiveDo(env, browserSessionId, '/session/live-url', { method: 'GET' });
}

/**
 * @param {any} env
 * @param {string} browserSessionId
 * @param {{ url?: string, title?: string, tool_name?: string, action_phase?: string, ok?: boolean }} patch
 */
export async function patchAgentLiveBrowserSessionViaDo(env, browserSessionId, patch) {
  return proxyToBrowserLiveDo(env, browserSessionId, '/session/patch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

/**
 * @param {any} env
 * @param {string} browserSessionId
 * @param {number} [limit]
 */
export async function getBrowserLiveEventsViaDo(env, browserSessionId, limit = 50) {
  const n = Math.min(100, Math.max(1, Number(limit) || 50));
  return proxyToBrowserLiveDo(env, browserSessionId, `/events?limit=${n}`, { method: 'GET' });
}

/**
 * @param {any} env
 * @param {string} browserSessionId
 * @param {{ reason: string, url?: string, resumeWhen?: string, selector?: string, timeoutMs?: number, userId?: string, workspaceId?: string }} input
 */
export async function requestBrowserHumanInputViaDo(env, browserSessionId, input) {
  return proxyToBrowserLiveDo(env, browserSessionId, '/human-input/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      browser_session_id: browserSessionId,
      reason: input.reason,
      url: input.url,
      resume_when: input.resumeWhen ?? input.resume_when,
      selector: input.selector,
      timeout_ms: input.timeoutMs,
      user_id: input.userId,
      workspace_id: input.workspaceId,
    }),
  });
}

/**
 * @param {any} env
 * @param {string} browserSessionId
 */
export async function signalBrowserHumanInputResumeViaDo(env, browserSessionId) {
  return proxyToBrowserLiveDo(env, browserSessionId, '/human-input/resume', { method: 'POST' });
}

/**
 * @param {any} env
 * @param {string} browserSessionId
 */
export async function cancelBrowserHumanInputViaDo(env, browserSessionId) {
  return proxyToBrowserLiveDo(env, browserSessionId, '/human-input/cancel', { method: 'POST' });
}

/**
 * @param {any} env
 * @param {string} browserSessionId
 */
export async function closeAgentLiveBrowserSessionViaDo(env, browserSessionId) {
  return proxyToBrowserLiveDo(env, browserSessionId, '/session/close', { method: 'DELETE' });
}

/**
 * @param {any} env
 * @param {string} browserSessionId
 */
export async function getBrowserLiveDoHealth(env, browserSessionId) {
  return proxyToBrowserLiveDo(env, browserSessionId, '/health', { method: 'GET' });
}

/**
 * Proxy WebSocket upgrade to the DO /ws handler.
 * @param {any} env
 * @param {string} browserSessionId
 * @param {Request} request
 */
export async function proxyBrowserLiveWebSocket(env, browserSessionId, request) {
  const stub = getBrowserLiveStub(env, browserSessionId);
  if (!stub) {
    return new Response('BROWSER_SESSION not configured', { status: 503 });
  }
  return stub.fetch(
    new Request('https://browser-live.internal/ws', {
      headers: request.headers,
    }),
  );
}
