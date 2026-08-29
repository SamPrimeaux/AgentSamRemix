/**
 * Human-in-the-loop (HITL) request / resume / cancel for AgentBrowserLiveV1.
 */
import { refreshBrowserRunLiveView } from '../cloudflare/browser-run.js';
import { emitEvent } from './events.js';
import { handleEnsure } from './ensure.js';
import {
  getSessionRow,
  json,
  normalizeResumeWhen,
  rowToLiveSession,
  upsertSession,
} from './session.js';

/**
 * @param {any} session
 */
export async function handleHumanInputCancel(session) {
  const row = getSessionRow(session);
  if (row) {
    upsertSession(session, {
      agent_run_id: row.agent_run_id,
      session_id: row.session_id,
      status: 'active',
      human_input_reason: null,
    });
  }
  if (session._hitlReject) {
    session._hitlReject(new Error('human input cancelled by user'));
    session._hitlResolve = null;
    session._hitlReject = null;
  } else if (session._hitlResolve) {
    session._hitlResolve();
    session._hitlResolve = null;
  }
  emitEvent(session, 'browser_human_input_cancelled', { agent_run_id: row?.agent_run_id ?? null });
  return json({ ok: true, cancelled: true });
}

/**
 * @param {any} session
 * @param {Request} request
 */
export async function handleHumanInputRequest(session, request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const reason = String(body.reason || '').trim();
  if (!reason) return json({ ok: false, error: 'reason required' }, 400);

  const ensureRes = await handleEnsure(
    session,
    new Request('https://do/session/ensure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  if (!ensureRes.ok) {
    const errBody = await ensureRes.json().catch(() => ({}));
    return json(errBody, ensureRes.status);
  }

  const row = getSessionRow(session);
  const resumeWhen = normalizeResumeWhen(body.resume_when ?? body.resumeWhen);
  upsertSession(session, {
    agent_run_id: row?.agent_run_id,
    session_id: row?.session_id,
    status: 'needs_human',
    human_input_reason: reason,
    resume_when: resumeWhen,
    resume_selector: body.selector != null ? String(body.selector) : null,
  });

  emitEvent(session, 'browser_human_input_required', {
    reason,
    resume_when: resumeWhen,
    live_view_url: row?.devtools_frontend_url ?? null,
    url: row?.current_url ?? null,
  });

  const timeoutMs = Math.min(
    600_000,
    Math.max(5_000, Number(body.timeout_ms ?? body.timeoutMs) || 300_000),
  );

  try {
    await waitForHumanResume(session, timeoutMs, resumeWhen, row);
    const after = getSessionRow(session);
    if (after) {
      upsertSession(session, {
        agent_run_id: after.agent_run_id,
        session_id: after.session_id,
        status: 'active',
        human_input_reason: null,
      });
    }
    emitEvent(session, 'browser_human_input_resumed', { agent_run_id: after?.agent_run_id });
    return json({
      ok: true,
      human_input_required: true,
      resumed: true,
      reason,
      resume_when: resumeWhen,
      live_session: after ? rowToLiveSession(after) : null,
    });
  } catch (e) {
    return json({
      ok: false,
      human_input_required: true,
      resumed: false,
      error: String(e?.message || e),
    }, 408);
  }
}

/**
 * @param {any} session
 * @param {number} timeoutMs
 * @param {string} resumeWhen
 * @param {Record<string, unknown>|null} row
 */
function waitForHumanResume(session, timeoutMs, resumeWhen, row) {
  return new Promise((resolve, reject) => {
    session._hitlResolve = resolve;
    session._hitlReject = reject;
    const timer = setTimeout(() => {
      if (session._hitlReject) {
        session._hitlReject(new Error('human input resume timed out'));
        session._hitlResolve = null;
        session._hitlReject = null;
      }
    }, timeoutMs);

    const origResolve = session._hitlResolve;
    session._hitlResolve = () => {
      clearTimeout(timer);
      origResolve?.();
      session._hitlResolve = null;
      session._hitlReject = null;
    };

    if (resumeWhen === 'navigation' && row?.session_id) {
      const startUrl = row.current_url != null ? String(row.current_url) : '';
      const poll = async () => {
        while (session._hitlResolve) {
          const refreshed = await refreshBrowserRunLiveView(session.env, {
            sessionId: String(row.session_id),
          }).catch(() => null);
          if (refreshed?.ok && refreshed.url && startUrl && refreshed.url !== startUrl) {
            session._hitlResolve?.();
            return;
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
      };
      poll().catch(() => {});
    }
  });
}

/**
 * @param {any} session
 */
export async function handleHumanInputResume(session) {
  const row = getSessionRow(session);
  if (!row) return json({ ok: false, error: 'no session' }, 404);
  upsertSession(session, {
    agent_run_id: row.agent_run_id,
    session_id: row.session_id,
    status: 'resuming',
    human_input_reason: null,
  });
  if (session._hitlResolve) {
    session._hitlResolve();
    session._hitlResolve = null;
    session._hitlReject = null;
  }
  emitEvent(session, 'browser_human_input_resumed', { agent_run_id: row.agent_run_id });
  const updated = getSessionRow(session);
  return json({
    ok: true,
    agent_run_id: row.agent_run_id,
    session_id: row.session_id,
    live_session: updated ? rowToLiveSession(updated) : null,
  });
}
