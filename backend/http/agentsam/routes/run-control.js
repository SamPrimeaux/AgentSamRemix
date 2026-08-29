/**
 * Agent run control routes — cancel by run id or conversation.
 * Peeled from agent.js so Stop / orphan-kill work is not buried in the facade.
 * Moved under backend/http/agentsam/routes for tkt_43ac75f20fe24f33.
 *
 * POST /api/agent/run/:runId/cancel
 * POST /api/agent/conversation/:id/cancel-runs
 */

import { jsonResponse } from '../shared.js';
import {
  requestAgentRunCancel,
  requestAgentRunCancelByConversation,
} from '../../../agentsam/runtime/run-cancel.js';

/**
 * @param {Request} request
 * @param {URL} url
 * @param {any} env
 * @param {{ userId?: string|null, workspaceId?: string|null, tenantId?: string|null } | null} identity
 * @returns {Promise<Response|null>} Response when matched; null to continue dispatcher
 */
export async function handleAgentRunControlApi(request, url, env, identity) {
  const method = request.method.toUpperCase();
  // Preserve id case from the raw path; only normalize for route matching.
  const pathRaw = (url.pathname || '').replace(/\/$/, '') || '/';
  const path = pathRaw.toLowerCase();

  const runCancelMatch = path.match(/^\/api\/agent\/run\/([^/]+)\/cancel$/);
  if (runCancelMatch && method === 'POST') {
    if (!identity?.userId) return jsonResponse({ error: 'unauthenticated' }, 401);
    const runIdRaw = pathRaw.match(/^\/api\/agent\/run\/([^/]+)\/cancel$/i)?.[1] || runCancelMatch[1];
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    // Chat Stop sends force_terminal so pre-model hangs leave status=cancelled
    // even when the tool loop never polls cancel_requested.
    const forceTerminal = body?.force_terminal === true || body?.forceTerminal === true;
    const out = await requestAgentRunCancel(
      env,
      decodeURIComponent(runIdRaw),
      {
        userId: identity.userId,
        workspaceId: identity.workspaceId,
        tenantId: identity.tenantId,
      },
      {
        forceTerminal,
        reason:
          body?.reason != null ? String(body.reason).slice(0, 500) : 'agent_run_cancelled',
      },
    );
    if (!out.ok) {
      const status = out.error === 'forbidden' ? 403 : out.error === 'run_not_found' ? 404 : 400;
      return jsonResponse(out, status);
    }
    return jsonResponse(out);
  }

  const convCancelMatch = path.match(/^\/api\/agent\/conversation\/([^/]+)\/cancel-runs$/);
  if (convCancelMatch && method === 'POST') {
    if (!identity?.userId) return jsonResponse({ error: 'unauthenticated' }, 401);
    const convIdRaw =
      pathRaw.match(/^\/api\/agent\/conversation\/([^/]+)\/cancel-runs$/i)?.[1] || convCancelMatch[1];
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const forceTerminal = body?.force_terminal !== false && body?.forceTerminal !== false;
    const out = await requestAgentRunCancelByConversation(
      env,
      decodeURIComponent(convIdRaw),
      {
        userId: identity.userId,
        workspaceId: identity.workspaceId,
        tenantId: identity.tenantId,
      },
      {
        forceTerminal,
        reason:
          body?.reason != null
            ? String(body.reason).slice(0, 500)
            : 'agent_run_cancelled_by_conversation',
      },
    );
    if (!out.ok) {
      const status =
        out.error === 'unauthenticated' ? 401 : out.error === 'missing_conversation_id' ? 400 : 400;
      return jsonResponse(out, status);
    }
    return jsonResponse(out);
  }

  return null;
}
