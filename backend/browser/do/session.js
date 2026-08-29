/**
 * Live browser session row helpers + constants for AgentBrowserLiveV1.
 */
import {
  applyBrowserRunLiveViewMode,
  deleteBrowserRunSession,
  refreshBrowserRunLiveView,
} from '../cloudflare/browser-run.js';
import { emitEvent } from './events.js';
import { isBrowserSessionId } from '../sessions/scope.js';

export const LIVE_VIEW_URL_TTL_MS = 5 * 60 * 1000;
export const LIVE_VIEW_REFRESH_MS = 4 * 60 * 1000;
export const DEFAULT_AGENT_KEEP_ALIVE_MS = 600_000;
export const CLASS_NAME = 'AgentBrowserLiveV1';

/** @param {unknown} v */
export function normalizeStatus(v) {
  const s = String(v || 'active').toLowerCase();
  if (['starting', 'active', 'needs_human', 'paused', 'resuming', 'closed'].includes(s)) return s;
  return 'active';
}

/** @param {unknown} v */
export function normalizeResumeWhen(v) {
  const s = String(v || 'manual').toLowerCase();
  if (s === 'navigation' || s === 'selector') return s;
  return 'manual';
}

/**
 * @param {unknown} data
 * @param {number} [status]
 */
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** @param {string|null|undefined} url @param {string|null|undefined} mode */
export function embedLiveViewUrl(url, mode) {
  const m = String(mode || 'tab').toLowerCase() === 'devtools' ? 'devtools' : 'tab';
  return applyBrowserRunLiveViewMode(url, m);
}

/**
 * @param {{ sql: import('@cloudflare/workers-types').SqlStorage }} session
 * @returns {Record<string, unknown>|null}
 */
export function getSessionRow(session) {
  const rows = session.sql.exec('SELECT * FROM live_browser_session LIMIT 1').toArray();
  return rows[0] ?? null;
}

/**
 * @param {{ sql: import('@cloudflare/workers-types').SqlStorage }} session
 * @param {string} browserSessionId
 */
export function ensureBrowserSessionId(session, browserSessionId) {
  const row = getSessionRow(session);
  if (row?.browser_session_id) return String(row.browser_session_id);
  const id = String(browserSessionId || '').trim();
  if (!isBrowserSessionId(id)) return '';
  return id;
}

/** @deprecated Use ensureBrowserSessionId */
export function ensureAgentRunId(session, agentRunId) {
  return ensureBrowserSessionId(session, agentRunId);
}

/**
 * @param {Record<string, unknown>|null|undefined} row
 */
export function rowToLiveSession(row) {
  if (!row) return null;
  const expiresAt = row.devtools_url_expires_at
    ? new Date(Number(row.devtools_url_expires_at)).toISOString()
    : null;
  return {
    browser_session_id: row.browser_session_id,
    agent_run_id: row.agent_run_id ?? null,
    session_id: row.session_id,
    target_id: row.target_id,
    url: row.current_url,
    title: row.title,
    devtools_frontend_url: row.devtools_frontend_url,
    web_socket_debugger_url: row.web_socket_debugger_url,
    live_view_mode: row.live_view_mode || 'tab',
    status: row.status,
    expires_at: expiresAt,
    keep_alive_ms: row.keep_alive_ms,
    human_input_reason: row.human_input_reason,
    resume_when: row.resume_when,
    resume_selector: row.resume_selector,
    user_id: row.user_id,
    workspace_id: row.workspace_id,
  };
}

/**
 * @param {{ state: { storage: { setAlarm: (when: number) => Promise<void> } } }} session
 * @param {number|null} expiresAtMs
 */
export async function scheduleRefreshAlarm(session, expiresAtMs) {
  const exp = expiresAtMs || Date.now() + LIVE_VIEW_URL_TTL_MS;
  const when = Math.max(Date.now() + 5_000, exp - 60_000);
  await session.state.storage.setAlarm(when);
}

/**
 * @param {{ sql: import('@cloudflare/workers-types').SqlStorage }} session
 * @param {Record<string, unknown>} fields
 */
export function upsertSession(session, fields) {
  const now = Math.floor(Date.now() / 1000);
  const row = getSessionRow(session);
  if (!row) {
    session.sql.exec(
      `INSERT INTO live_browser_session (
        browser_session_id, agent_run_id, session_id, target_id, current_url, title,
        devtools_frontend_url, web_socket_debugger_url, live_view_mode, status,
        devtools_url_expires_at, keep_alive_ms, human_input_reason, resume_when,
        resume_selector, conversation_id, user_id, workspace_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      fields.browser_session_id,
      fields.agent_run_id ?? null,
      fields.session_id,
      fields.target_id ?? null,
      fields.current_url ?? null,
      fields.title ?? null,
      fields.devtools_frontend_url ?? null,
      fields.web_socket_debugger_url ?? null,
      fields.live_view_mode ?? 'tab',
      fields.status ?? 'starting',
      fields.devtools_url_expires_at ?? Date.now() + LIVE_VIEW_URL_TTL_MS,
      fields.keep_alive_ms ?? DEFAULT_AGENT_KEEP_ALIVE_MS,
      fields.human_input_reason ?? null,
      fields.resume_when ?? null,
      fields.resume_selector ?? null,
      fields.conversation_id ?? null,
      fields.user_id ?? null,
      fields.workspace_id ?? null,
      now,
    );
    return;
  }
  const merged = { ...row, ...fields, updated_at: now };
  session.sql.exec(
    `UPDATE live_browser_session SET
      agent_run_id = COALESCE(?, agent_run_id),
      session_id = ?, target_id = ?, current_url = ?, title = ?,
      devtools_frontend_url = ?, web_socket_debugger_url = ?, live_view_mode = ?,
      status = ?, devtools_url_expires_at = ?, keep_alive_ms = ?,
      human_input_reason = ?, resume_when = ?, resume_selector = ?,
      conversation_id = COALESCE(?, conversation_id),
      user_id = COALESCE(?, user_id), workspace_id = COALESCE(?, workspace_id),
      updated_at = ?
    WHERE browser_session_id = ?`,
    fields.agent_run_id ?? null,
    merged.session_id,
    merged.target_id ?? null,
    merged.current_url ?? null,
    merged.title ?? null,
    merged.devtools_frontend_url ?? null,
    merged.web_socket_debugger_url ?? null,
    merged.live_view_mode ?? 'tab',
    merged.status ?? 'active',
    merged.devtools_url_expires_at ?? Date.now() + LIVE_VIEW_URL_TTL_MS,
    merged.keep_alive_ms ?? DEFAULT_AGENT_KEEP_ALIVE_MS,
    merged.human_input_reason ?? null,
    merged.resume_when ?? null,
    merged.resume_selector ?? null,
    fields.conversation_id ?? null,
    fields.user_id ?? null,
    fields.workspace_id ?? null,
    now,
    merged.browser_session_id,
  );
}

/**
 * @param {any} session
 * @param {Request} request
 */
export async function handleSessionPatch(session, request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const row = getSessionRow(session);
  if (!row) return json({ ok: false, error: 'no session' }, 404);

  const toolName = body.tool_name != null ? String(body.tool_name) : '';
  const actionPhase = String(body.action_phase || body.phase || 'done').toLowerCase();
  const requestedUrl =
    body.requested_url != null
      ? String(body.requested_url)
      : body.requestedUrl != null
        ? String(body.requestedUrl)
        : null;
  const scrollDirection =
    body.scroll_direction != null
      ? String(body.scroll_direction)
      : body.direction != null
        ? String(body.direction)
        : null;

  const patch = {
    browser_session_id: row.browser_session_id,
    agent_run_id: body.agent_run_id ?? body.agentRunId ?? row.agent_run_id ?? null,
    session_id: row.session_id,
    current_url: body.url ?? body.current_url ?? row.current_url,
    title: body.title ?? row.title,
    status: body.status ?? row.status,
  };

  if (toolName && actionPhase === 'start') {
    emitEvent(session, 'browser_action_started', {
      tool_name: toolName,
      url: patch.current_url,
      title: patch.title,
      requested_url: requestedUrl,
    });
    upsertSession(session, patch);
    const updated = getSessionRow(session);
    return json({
      ok: true,
      live_session: updated ? rowToLiveSession(updated) : null,
    });
  }

  let liveSession = null;
  const urlCommitTools = new Set([
    'browser_navigate',
    'cdt_navigate_page',
    'browser_verify_current_page',
  ]);
  const urlVerified =
    body.verified === true ||
    body.url_verified === true ||
    (!urlCommitTools.has(toolName) && body.verified !== false);

  if (actionPhase === 'done' && patch.current_url && toolName !== 'browser_scroll' && urlVerified) {
    const refreshed = await refreshBrowserRunLiveView(session.env, {
      sessionId: String(row.session_id),
      targetId: row.target_id != null ? String(row.target_id) : null,
    });
    if (refreshed.ok) {
      const viewMode = row.live_view_mode ?? 'tab';
      const embedUrl = embedLiveViewUrl(refreshed.devtoolsFrontendUrl, viewMode);
      const expiresAt = Date.now() + LIVE_VIEW_URL_TTL_MS;
      upsertSession(session, {
        browser_session_id: row.browser_session_id,
        agent_run_id: patch.agent_run_id,
        session_id: row.session_id,
        target_id: refreshed.targetId ?? row.target_id,
        current_url: refreshed.url ?? patch.current_url,
        title: refreshed.title ?? patch.title,
        devtools_frontend_url: embedUrl,
        web_socket_debugger_url: refreshed.webSocketDebuggerUrl ?? row.web_socket_debugger_url,
        devtools_url_expires_at: expiresAt,
      });
      await scheduleRefreshAlarm(session, expiresAt);
      const updated = getSessionRow(session);
      liveSession = updated ? rowToLiveSession(updated) : null;

      const commitPayload = {
        agent_run_id: row.agent_run_id,
        browser_do_id: session.ctx.id.toString(),
        session_id: row.session_id,
        target_id: liveSession?.target_id ?? row.target_id,
        url: liveSession?.url ?? patch.current_url,
        title: liveSession?.title ?? patch.title,
        requested_url: requestedUrl,
        verified: true,
        live_view_url: liveSession?.devtools_frontend_url ?? embedUrl,
        live_view_mode: liveSession?.live_view_mode ?? viewMode,
        same_session_reused: true,
        tool_name: toolName,
      };
      emitEvent(session, 'browser_url_committed', commitPayload);
      if (toolName === 'browser_navigate' || toolName === 'cdt_navigate_page') {
        emitEvent(session, 'browser_navigated', {
          url: commitPayload.url,
          title: commitPayload.title,
          tool_name: toolName,
          verified: true,
        });
      }
      if (refreshed.devtoolsFrontendUrl && liveSession?.devtools_frontend_url) {
        emitEvent(session, 'browser_live_view_refresh', {
          devtools_frontend_url: liveSession.devtools_frontend_url,
          live_view_url: liveSession.devtools_frontend_url,
          url: liveSession.url,
          expires_at: liveSession.expires_at,
          live_view_mode: liveSession.live_view_mode,
        });
      }
    } else {
      upsertSession(session, patch);
      liveSession = rowToLiveSession(getSessionRow(session));
    }
  } else if (
    actionPhase === 'done' &&
    urlCommitTools.has(toolName) &&
    (body.verified === false || body.url_verified === false)
  ) {
    emitEvent(session, 'browser_verification_failed', {
      agent_run_id: row.agent_run_id,
      browser_do_id: session.ctx.id.toString(),
      session_id: row.session_id,
      target_id: row.target_id,
      requested_url: requestedUrl,
      url: patch.current_url,
      verified: false,
      tool_name: toolName,
    });
    liveSession = rowToLiveSession(getSessionRow(session));
  } else {
    upsertSession(session, patch);
    liveSession = rowToLiveSession(getSessionRow(session));
  }

  if (toolName && actionPhase === 'done') {
    const actionOk =
      body.ok === false
        ? false
        : urlCommitTools.has(toolName)
          ? urlVerified
          : body.verified !== false;
    emitEvent(session, 'browser_action_done', {
      tool_name: toolName,
      url: liveSession?.url ?? patch.current_url,
      title: liveSession?.title ?? patch.title,
      ok: actionOk,
      verified: urlCommitTools.has(toolName) ? urlVerified : body.verified !== false,
    });
    if (toolName === 'browser_scroll' && scrollDirection) {
      emitEvent(session, 'browser_scrolled', {
        tool_name: toolName,
        direction: scrollDirection,
        url: liveSession?.url ?? patch.current_url,
      });
    }
  }

  return json({
    ok: true,
    live_session: liveSession,
    browser_url_committed:
      actionPhase === 'done' &&
      patch.current_url &&
      toolName !== 'browser_scroll' &&
      urlVerified
        ? {
            url: liveSession?.url ?? patch.current_url,
            title: liveSession?.title ?? patch.title,
            verified: true,
            session_id: row.session_id,
            agent_run_id: row.agent_run_id,
          }
        : null,
  });
}

/**
 * @param {any} session
 */
export async function handleClose(session) {
  const row = getSessionRow(session);
  if (row?.session_id) {
    await deleteBrowserRunSession(session.env, { sessionId: String(row.session_id) }).catch(() => {});
  }
  if (row) {
    upsertSession(session, {
      browser_session_id: row.browser_session_id,
      agent_run_id: row.agent_run_id,
      session_id: row.session_id,
      status: 'closed',
      human_input_reason: null,
    });
    emitEvent(session, 'browser_session_closed', {
      browser_session_id: row.browser_session_id,
      agent_run_id: row.agent_run_id,
    });
  }
  await session.state.storage.deleteAlarm();
  if (session._hitlResolve) {
    session._hitlResolve();
    session._hitlResolve = null;
    session._hitlReject = null;
  }
  return json({ ok: true, status: 'closed' });
}
