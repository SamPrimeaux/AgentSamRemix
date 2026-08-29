/**
 * Agent Live Browser Session facade — BROWSER_SESSION DO is the ONLY live session authority.
 */
import { applyBrowserRunLiveViewMode } from '../cloudflare/browser-run.js';
import {
  assertBrowserLiveDoAvailable,
  browserLiveDoRequired,
  cancelBrowserHumanInputViaDo,
  closeAgentLiveBrowserSessionViaDo,
  ensureAgentLiveBrowserSessionViaDo,
  getAgentLiveBrowserSessionViaDo,
  patchAgentLiveBrowserSessionViaDo,
  refreshAgentLiveBrowserUrlViaDo,
  requestBrowserHumanInputViaDo,
  signalBrowserHumanInputResumeViaDo,
} from './client.js';
import { resolveBrowserSessionScopeId } from './scope.js';

/** Cloudflare Live View URL validity (~5 min); refresh before expiry. */
export const LIVE_VIEW_URL_TTL_MS = 5 * 60 * 1000;
export const LIVE_VIEW_REFRESH_MS = 4 * 60 * 1000;
export const DEFAULT_AGENT_KEEP_ALIVE_MS = 600_000;

/**
 * @typedef {Object} AgentLiveBrowserSession
 * @property {string} browserSessionId
 * @property {string|null} [agentRunId]
 * @property {string} sessionId
 * @property {string|null} targetId
 * @property {string|null} currentUrl
 * @property {string|null} [title]
 * @property {string|null} devtoolsFrontendUrl
 * @property {string|null} webSocketDebuggerUrl
 * @property {'tab'|'devtools'} liveViewMode
 * @property {'starting'|'active'|'needs_human'|'paused'|'resuming'|'closed'} status
 * @property {string|null} [expiresAt]
 * @property {number} keepAliveMs
 * @property {string|null} [humanInputReason]
 * @property {'manual'|'navigation'|'selector'} [resumeWhen]
 * @property {string|null} [resumeSelector]
 */

/**
 * @param {Record<string, unknown>|null|undefined} raw
 * @param {string} scopeId
 * @returns {AgentLiveBrowserSession|null}
 */
export function toAgentLiveBrowserSession(raw, scopeId) {
  if (!raw || typeof raw !== 'object') return null;
  const sessionId = String(raw.sessionId || raw.session_id || '').trim();
  if (!sessionId) return null;
  const mode = String(raw.liveViewMode || raw.live_view_mode || 'tab').toLowerCase();
  const liveViewMode = mode === 'devtools' ? 'devtools' : 'tab';
  const rawEmbedUrl =
    raw.devtoolsFrontendUrl != null
      ? String(raw.devtoolsFrontendUrl)
      : raw.devtools_frontend_url != null
        ? String(raw.devtools_frontend_url)
        : null;
  return {
    browserSessionId: scopeId,
    agentRunId:
      raw.agentRunId != null
        ? String(raw.agentRunId)
        : raw.agent_run_id != null
          ? String(raw.agent_run_id)
          : null,
    sessionId,
    targetId: raw.targetId != null ? String(raw.targetId) : raw.target_id != null ? String(raw.target_id) : null,
    currentUrl:
      raw.currentUrl != null
        ? String(raw.currentUrl)
        : raw.current_url != null
          ? String(raw.current_url)
          : null,
    title: raw.title != null ? String(raw.title) : null,
    devtoolsFrontendUrl: rawEmbedUrl
      ? applyBrowserRunLiveViewMode(rawEmbedUrl, liveViewMode)
      : null,
    webSocketDebuggerUrl:
      raw.webSocketDebuggerUrl != null
        ? String(raw.webSocketDebuggerUrl)
        : raw.web_socket_debugger_url != null
          ? String(raw.web_socket_debugger_url)
          : null,
    liveViewMode,
    status: normalizeLiveSessionStatus(raw.status),
    expiresAt:
      raw.expiresAt != null
        ? String(raw.expiresAt)
        : raw.devtools_url_expires_at != null
          ? String(raw.devtools_url_expires_at)
          : null,
    keepAliveMs: Number(raw.keepAliveMs ?? raw.keep_alive_ms) || DEFAULT_AGENT_KEEP_ALIVE_MS,
    humanInputReason:
      raw.humanInputReason != null
        ? String(raw.humanInputReason)
        : raw.human_input_reason != null
          ? String(raw.human_input_reason)
          : null,
    resumeWhen: normalizeResumeWhen(raw.resumeWhen ?? raw.resume_when),
    resumeSelector:
      raw.resumeSelector != null
        ? String(raw.resumeSelector)
        : raw.resume_selector != null
          ? String(raw.resume_selector)
          : null,
  };
}

/** @param {unknown} v */
function normalizeLiveSessionStatus(v) {
  const s = String(v || 'active').toLowerCase();
  if (['starting', 'active', 'needs_human', 'paused', 'resuming', 'closed'].includes(s)) return s;
  return 'active';
}

/** @param {unknown} v */
function normalizeResumeWhen(v) {
  const s = String(v || 'manual').toLowerCase();
  if (s === 'navigation' || s === 'selector') return s;
  return 'manual';
}

/**
 * @param {AgentLiveBrowserSession} session
 */
export function liveSessionPayload(session) {
  return {
    browser_session_id: session.browserSessionId,
    agent_run_id: session.agentRunId,
    session_id: session.sessionId,
    target_id: session.targetId,
    url: session.currentUrl,
    title: session.title,
    devtools_frontend_url: session.devtoolsFrontendUrl,
    web_socket_debugger_url: session.webSocketDebuggerUrl,
    live_view_mode: session.liveViewMode,
    status: session.status,
    expires_at: session.expiresAt,
    keep_alive_ms: session.keepAliveMs,
  };
}

/**
 * @param {any} env
 * @param {string} scopeId
 */
export async function getAgentLiveBrowserSession(env, scopeId) {
  const id = String(scopeId || '').trim();
  if (!id) return null;
  if (!browserLiveDoRequired(env)) {
    assertBrowserLiveDoAvailable(env);
    return null;
  }
  const live = await getAgentLiveBrowserSessionViaDo(env, id);
  if (live) return toAgentLiveBrowserSession(live, id);
  return null;
}

/**
 * Patch live session via DO only — never writes live truth to KV.
 * @param {any} env
 * @param {string} scopeId
 * @param {AgentLiveBrowserSession} session
 */
export async function persistAgentLiveBrowserSession(env, scopeId, session) {
  if (!browserLiveDoRequired(env)) return;
  await patchAgentLiveBrowserSessionViaDo(env, scopeId, {
    url: session.currentUrl,
    title: session.title,
  }).catch(() => {});
}

/**
 * Ensure a Browser Run session exists for this agent run.
 * DO bound → client ensure; unbound → 503 (no KV ensure path).
 * @param {any} env
 * @param {string} scopeId
 * @param {{ url?: string|null, keepAliveMs?: number, liveViewMode?: 'tab'|'devtools', userId?: string, workspaceId?: string, tool_name?: string }} [opts]
 */
export async function ensureAgentLiveBrowserSession(env, scopeId, opts = {}) {
  if (browserLiveDoRequired(env)) {
    return ensureAgentLiveBrowserSessionViaDo(env, scopeId, opts);
  }
  return assertBrowserLiveDoAvailable(env);
}

/**
 * @param {any} env
 * @param {{ sessionId: string, scopeId?: string|null, targetId?: string|null }} opts
 */
export async function refreshAgentLiveBrowserLiveUrl(env, opts) {
  const scopeId = opts?.scopeId != null ? String(opts.scopeId).trim() : '';
  if (!scopeId) {
    return { ok: false, error: 'scopeId required', status: 400 };
  }
  if (!browserLiveDoRequired(env)) {
    return assertBrowserLiveDoAvailable(env);
  }
  return refreshAgentLiveBrowserUrlViaDo(env, scopeId);
}

/**
 * @param {any} env
 * @param {string} scopeId
 */
export async function closeAgentLiveBrowserSession(env, scopeId) {
  const id = String(scopeId || '').trim();
  if (!id) return { ok: false, error: 'scope_id required' };
  if (!browserLiveDoRequired(env)) {
    return assertBrowserLiveDoAvailable(env);
  }
  return closeAgentLiveBrowserSessionViaDo(env, id);
}

/**
 * @param {any} env
 * @param {string} scopeId
 * @param {{ reason: string, url?: string, resumeWhen?: string, selector?: string, timeoutMs?: number }} input
 */
export async function requestBrowserHumanInput(env, scopeId, input) {
  const reason = String(input?.reason || '').trim();
  if (!reason) return { ok: false, error: 'reason required' };
  if (!browserLiveDoRequired(env)) {
    return assertBrowserLiveDoAvailable(env);
  }
  return requestBrowserHumanInputViaDo(env, scopeId, input);
}

/**
 * @param {any} env
 * @param {string} scopeId
 */
export async function signalHumanInputResume(env, scopeId) {
  const id = String(scopeId || '').trim();
  if (!id) return { ok: false, error: 'browser_session_id required' };
  if (!browserLiveDoRequired(env)) {
    return assertBrowserLiveDoAvailable(env);
  }
  return signalBrowserHumanInputResumeViaDo(env, id);
}

/**
 * @param {any} env
 * @param {string} scopeId
 */
export async function cancelBrowserHumanInput(env, scopeId) {
  const id = String(scopeId || '').trim();
  if (!id) return { ok: false, error: 'browser_session_id required' };
  if (!browserLiveDoRequired(env)) {
    return assertBrowserLiveDoAvailable(env);
  }
  return cancelBrowserHumanInputViaDo(env, id);
}

export { resolveBrowserSessionScopeId, resolveBrowserRunScopeId } from './scope.js';

const BROWSER_TOOL_RE = /^(browser_|cdt_|playwright_screenshot)/;

/**
 * Emit live-browser SSE events from agent tool lifecycle.
 * @param {(type: string, payload: Record<string, unknown>) => void} emit
 * @param {'start'|'done'} phase
 * @param {string} toolName
 * @param {unknown} execResult
 */
export function emitBrowserLiveSessionSse(emit, phase, toolName, execResult) {
  if (typeof emit !== 'function' || !BROWSER_TOOL_RE.test(String(toolName || ''))) return;

  if (phase === 'start') {
    emit('browser_session_starting', { tool_name: toolName });
    emit('browser_action_started', { tool_name: toolName });
    return;
  }

  if (phase !== 'done' || !execResult || typeof execResult !== 'object') return;
  let body = /** @type {Record<string, unknown>} */ (execResult);
  if (body.body && typeof body.body === 'object' && !body.live_session) {
    body = /** @type {Record<string, unknown>} */ (body.body);
  }
  const live = body.live_session && typeof body.live_session === 'object' ? body.live_session : null;
  const liveRec = live ? /** @type {Record<string, unknown>} */ (live) : null;

  if (liveRec) {
    emit('browser_session_ready', liveRec);
    if (liveRec.devtools_frontend_url) {
      emit('browser_live_view_ready', {
        session_id: liveRec.session_id,
        target_id: liveRec.target_id,
        live_view_url: liveRec.devtools_frontend_url,
        url: liveRec.url,
        title: liveRec.title,
        expires_at: liveRec.expires_at,
        live_view_mode: liveRec.live_view_mode ?? 'tab',
      });
    }
  }

  if (toolName === 'browser_request_human_input' || body.human_input_required) {
    emit('browser_human_input_required', {
      session_id: liveRec?.session_id ?? body.session_id ?? null,
      target_id: liveRec?.target_id ?? null,
      live_view_url: liveRec?.devtools_frontend_url ?? null,
      reason: body.reason ?? liveRec?.human_input_reason ?? 'Human input required',
      expires_at: liveRec?.expires_at ?? null,
      resume_when: body.resume_when ?? 'manual',
    });
    if (body.resumed) {
      emit('browser_human_input_resumed', {
        session_id: liveRec?.session_id ?? null,
        target_id: liveRec?.target_id ?? null,
      });
    }
  }

  emit('browser_action_done', {
    tool_name: toolName,
    ok: body.ok !== false && !body.error,
    url: body.url ?? liveRec?.url ?? null,
    live_session: liveRec,
    verified: body.verified ?? body.url_verified ?? null,
  });

  if (body.browser_url_committed && typeof body.browser_url_committed === 'object') {
    const commit = body.browser_url_committed;
    if (commit.verified === true) {
      emit('browser_url_committed', commit);
    }
  } else if (
    body.url &&
    (toolName === 'browser_navigate' || toolName === 'cdt_navigate_page') &&
    body.verified === true &&
    body.url_verified === true &&
    body.live_view_verified !== false
  ) {
    emit('browser_url_committed', {
      agent_run_id: liveRec?.agent_run_id ?? body.agent_run_id ?? null,
      session_id: liveRec?.session_id ?? body.session_id ?? null,
      target_id: liveRec?.target_id ?? null,
      url: body.url,
      title: body.title ?? liveRec?.title ?? null,
      verified: true,
      live_view_url: liveRec?.devtools_frontend_url ?? null,
      live_view_mode: liveRec?.live_view_mode ?? 'tab',
      same_session_reused: true,
      tool_name: toolName,
      smoke_debug: body.smoke_debug ?? null,
    });
  }
}
