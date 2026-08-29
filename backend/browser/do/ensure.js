/**
 * Ensure + live-url refresh for AgentBrowserLiveV1 (Browser Run CDP).
 */
import { navigateBrowserRunTab, refreshBrowserRunLiveView } from '../cloudflare/browser-run.js';
import { bootstrapBrowserLeaseSession } from '../runtime/mybrowser-session.js';
import { emitEvent } from './events.js';
import {
  DEFAULT_AGENT_KEEP_ALIVE_MS,
  LIVE_VIEW_URL_TTL_MS,
  embedLiveViewUrl,
  ensureBrowserSessionId,
  getSessionRow,
  json,
  rowToLiveSession,
  scheduleRefreshAlarm,
  upsertSession,
} from './session.js';

/**
 * @param {any} session
 * @param {Request} request
 */
export async function handleEnsure(session, request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const browserSessionId = ensureBrowserSessionId(
    session,
    body.browser_session_id ?? body.browserSessionId,
  );
  if (!browserSessionId) {
    return json({ ok: false, error: 'browser_session_id required (bsess_*)' }, 400);
  }
  const agentRunId =
    body.agent_run_id != null
      ? String(body.agent_run_id).trim() || null
      : body.agentRunId != null
        ? String(body.agentRunId).trim() || null
        : null;

  const keepAliveMs = Math.min(
    600_000,
    Math.max(60_000, Number(body.keep_alive_ms ?? body.keepAliveMs) || DEFAULT_AGENT_KEEP_ALIVE_MS),
  );
  const targetUrl = body.url != null ? String(body.url).trim() : '';
  const liveViewMode = body.live_view_mode === 'devtools' || body.liveViewMode === 'devtools' ? 'devtools' : 'tab';

  let row = getSessionRow(session);
  let sessionId = row?.session_id ? String(row.session_id) : '';
  const wasClosed = row?.status === 'closed';

  if (!sessionId || wasClosed) {
    emitEvent(session, 'browser_session_starting', {
      browser_session_id: browserSessionId,
      agent_run_id: agentRunId,
      url: targetUrl || null,
    });
    const created = await bootstrapBrowserLeaseSession(session.env, { keepAliveMs });
    if (!created.ok) return json(created, 502);
    sessionId = created.sessionId;
    const expiresAt = Date.now() + LIVE_VIEW_URL_TTL_MS;
    upsertSession(session, {
      browser_session_id: browserSessionId,
      agent_run_id: agentRunId,
      session_id: sessionId,
      target_id: created.targetId ?? null,
      current_url: created.url ?? null,
      title: created.title ?? null,
      devtools_frontend_url: embedLiveViewUrl(created.devtoolsFrontendUrl ?? null, liveViewMode),
      web_socket_debugger_url: created.webSocketDebuggerUrl ?? null,
      live_view_mode: liveViewMode,
      status: 'starting',
      devtools_url_expires_at: expiresAt,
      keep_alive_ms: keepAliveMs,
      user_id: body.user_id ?? body.userId ?? null,
      workspace_id: body.workspace_id ?? body.workspaceId ?? null,
    });
    row = getSessionRow(session);
  }

  const deferHttpNav =
    body.defer_http_navigate === true || body.deferHttpNavigate === true;

  if (targetUrl && !(deferHttpNav && sessionId && !wasClosed)) {
    const navigated = await navigateBrowserRunTab(session.env, { sessionId, url: targetUrl });
    if (!navigated.ok) {
      const created = await bootstrapBrowserLeaseSession(session.env, { keepAliveMs });
      if (!created.ok) return json(created, 502);
      sessionId = created.sessionId;
      const retry = await navigateBrowserRunTab(session.env, { sessionId, url: targetUrl });
      if (!retry.ok) return json(retry, 502);
      const expiresAt = Date.now() + LIVE_VIEW_URL_TTL_MS;
      upsertSession(session, {
        browser_session_id: browserSessionId,
        agent_run_id: agentRunId,
        session_id: sessionId,
        target_id: retry.targetId ?? created.targetId ?? null,
        current_url: retry.url ?? targetUrl,
        title: retry.title ?? null,
        devtools_frontend_url: embedLiveViewUrl(
          retry.devtoolsFrontendUrl ?? created.devtoolsFrontendUrl ?? null,
          liveViewMode,
        ),
        web_socket_debugger_url: retry.webSocketDebuggerUrl ?? created.webSocketDebuggerUrl ?? null,
        live_view_mode: liveViewMode,
        status: 'active',
        devtools_url_expires_at: expiresAt,
        keep_alive_ms: keepAliveMs,
      });
    } else {
      const expiresAt = Date.now() + LIVE_VIEW_URL_TTL_MS;
      upsertSession(session, {
        browser_session_id: browserSessionId,
        agent_run_id: agentRunId,
        session_id: sessionId,
        target_id: navigated.targetId ?? row?.target_id ?? null,
        current_url: navigated.url ?? targetUrl,
        title: navigated.title ?? row?.title ?? null,
        devtools_frontend_url: embedLiveViewUrl(
          navigated.devtoolsFrontendUrl ?? row?.devtools_frontend_url ?? null,
          liveViewMode,
        ),
        web_socket_debugger_url: navigated.webSocketDebuggerUrl ?? row?.web_socket_debugger_url ?? null,
        live_view_mode: liveViewMode,
        status: 'active',
        devtools_url_expires_at: expiresAt,
        keep_alive_ms: keepAliveMs,
      });
    }
  } else if (row && sessionId) {
    const refreshed = await refreshBrowserRunLiveView(session.env, {
      sessionId,
      targetId: row.target_id != null ? String(row.target_id) : null,
    });
    if (refreshed.ok) {
      const expiresAt = Date.now() + LIVE_VIEW_URL_TTL_MS;
      upsertSession(session, {
        browser_session_id: browserSessionId,
        agent_run_id: agentRunId,
        session_id: sessionId,
        target_id: refreshed.targetId ?? row.target_id,
        current_url: refreshed.url ?? row.current_url,
        title: refreshed.title ?? row.title,
        devtools_frontend_url: embedLiveViewUrl(refreshed.devtoolsFrontendUrl, row.live_view_mode ?? liveViewMode),
        web_socket_debugger_url: refreshed.webSocketDebuggerUrl ?? row.web_socket_debugger_url,
        status: row.status === 'starting' ? 'active' : row.status,
        devtools_url_expires_at: expiresAt,
        keep_alive_ms: keepAliveMs,
      });
    }
  }

  row = getSessionRow(session);
  if (!row) return json({ ok: false, error: 'Failed to establish live browser session' }, 500);

  const liveSession = rowToLiveSession(row);
  emitEvent(session, 'browser_session_ready', liveSession ?? {});
  if (liveSession?.devtools_frontend_url) {
    emitEvent(session, 'browser_live_view_ready', {
      session_id: liveSession.session_id,
      target_id: liveSession.target_id,
      live_view_url: liveSession.devtools_frontend_url,
      url: liveSession.url,
      title: liveSession.title,
      expires_at: liveSession.expires_at,
      live_view_mode: liveSession.live_view_mode,
    });
  }

  await scheduleRefreshAlarm(session, Number(row.devtools_url_expires_at));

  return json({
    ok: true,
    live_session: liveSession,
    session_id: row.session_id,
    browser_session: {
      browser_session_id: browserSessionId,
      scope_id: browserSessionId,
      session_id: row.session_id,
      target_id: row.target_id,
      web_socket_debugger_url: row.web_socket_debugger_url,
      devtools_frontend_url: row.devtools_frontend_url,
    },
  });
}

/**
 * @param {any} session
 */
export async function handleLiveUrlRefresh(session) {
  const row = getSessionRow(session);
  if (!row?.session_id) return json({ ok: false, error: 'no session' }, 404);
  if (row.status === 'closed') return json({ ok: false, error: 'session closed' }, 410);

  const refreshed = await refreshBrowserRunLiveView(session.env, {
    sessionId: String(row.session_id),
    targetId: row.target_id != null ? String(row.target_id) : null,
  });
  if (!refreshed.ok) {
    emitEvent(session, 'browser_live_view_refresh_failed', { error: refreshed.error });
    return json(refreshed, 502);
  }

  const viewMode = row.live_view_mode ?? 'tab';
  const embedUrl = embedLiveViewUrl(refreshed.devtoolsFrontendUrl, viewMode);
  const expiresAt = Date.now() + LIVE_VIEW_URL_TTL_MS;
  upsertSession(session, {
    browser_session_id: row.browser_session_id,
    agent_run_id: row.agent_run_id,
    session_id: row.session_id,
    target_id: refreshed.targetId ?? row.target_id,
    current_url: refreshed.url ?? row.current_url,
    title: refreshed.title ?? row.title,
    devtools_frontend_url: embedUrl,
    web_socket_debugger_url: refreshed.webSocketDebuggerUrl ?? row.web_socket_debugger_url,
    devtools_url_expires_at: expiresAt,
  });

  emitEvent(session, 'browser_live_view_refresh', {
    devtools_frontend_url: embedUrl,
    url: refreshed.url,
    expires_at: new Date(expiresAt).toISOString(),
    live_view_mode: viewMode,
  });
  await scheduleRefreshAlarm(session, expiresAt);

  return json({
    ok: true,
    session_id: row.session_id,
    target_id: refreshed.targetId,
    devtools_frontend_url: embedUrl,
    web_socket_debugger_url: refreshed.webSocketDebuggerUrl,
    url: refreshed.url,
    title: refreshed.title,
    expires_at: new Date(expiresAt).toISOString(),
  });
}
