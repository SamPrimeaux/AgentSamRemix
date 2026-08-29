/**
 * Resolve agent chat turn context — domain only (no HTTP Response).
 *
 * Untrusted request aliases are inputs to resolution only. After success,
 * callers must read workspace/user/tenant/mode from turnContext.
 */

import { parseRequiredAgentRuntimeMode } from '../mode.js';
import { authorizeFirstWorkspace } from '../../../identity/workspace/index.js';
import { getWorkspaceTenantIdWithFallback } from '../../../identity/workspace/tenant.js';
import { resolveCanonicalUserId } from '../../../identity/users/index.js';

function trimOrNull(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s !== '' ? s : null;
}

function pickBodyWorkspaceId(body) {
  return trimOrNull(body?.workspace_id) || trimOrNull(body?.workspaceId) || null;
}

function pickProjectRef(body) {
  return trimOrNull(body?.project_id) || trimOrNull(body?.projectId) || null;
}

function pickClientSurface(body, request) {
  return (
    trimOrNull(body?.client_surface) ||
    trimOrNull(body?.clientSurface) ||
    trimOrNull(body?.surface) ||
    trimOrNull(request?.headers?.get?.('x-iam-client-surface')) ||
    null
  );
}

/**
 * @typedef {{
 *   code: string,
 *   message?: string,
 *   httpStatus: number,
 *   redirect?: string,
 *   details?: Record<string, unknown>,
 * }} TurnContextError
 */

/**
 * @param {object} input
 * @returns {Promise<
 *   | { ok: false, error: TurnContextError }
 *   | {
 *       ok: true,
 *       turnContext: object,
 *       body: object,
 *       message: string,
 *     }
 * >}
 */
export async function resolveAgentTurnContext(input) {
  const {
    env,
    request,
    body: rawBody,
    identity = null,
    ingestBypass = false,
  } = input;

  const body = rawBody && typeof rawBody === 'object' ? rawBody : {};

  /** @type {{ user_id: string|null, tenant_id: string|null, workspace_id: string|null, session_id?: string|null }} */
  let sessionHints;
  if (ingestBypass) {
    const tid = body.tenantId ?? body.tenant_id;
    const wid = body.workspaceId ?? body.workspace_id;
    const uid = body.userId ?? body.user_id;
    if (!tid || !wid || !uid) {
      return {
        ok: false,
        error: {
          code: 'ingest_fields_required',
          message: 'ingest requires tenantId, workspaceId, userId',
          httpStatus: 400,
        },
      };
    }
    sessionHints = {
      user_id: String(uid),
      tenant_id: String(tid),
      workspace_id: String(wid),
      session_id: body.sessionId ?? body.session_id ?? null,
    };
  } else {
    if (!identity?.userId) {
      return {
        ok: false,
        error: { code: 'unauthenticated', message: 'unauthenticated', httpStatus: 401 },
      };
    }
    sessionHints = {
      user_id: identity.userId,
      tenant_id: identity.tenantId ?? null,
      workspace_id: identity.workspaceId ?? identity.active_workspace_id ?? null,
      session_id: body.sessionId ?? body.session_id ?? null,
    };
  }

  const message = String(body.message || '').trim();
  if (!message) {
    return {
      ok: false,
      error: { code: 'message_required', message: 'message required', httpStatus: 400 },
    };
  }

  const modeParse = parseRequiredAgentRuntimeMode(body.mode);
  if (!modeParse.ok) {
    return {
      ok: false,
      error: {
        code: modeParse.error,
        message:
          modeParse.error === 'mode_required'
            ? 'mode required (ask|plan|agent|debug|multitask)'
            : `invalid mode '${modeParse.got}' (ask|plan|agent|debug|multitask; auto is model selection via model=auto)`,
        httpStatus: 400,
        details: modeParse.got != null ? { got: modeParse.got } : undefined,
      },
    };
  }

  const headerWorkspaceId = trimOrNull(request.headers.get('x-iam-workspace-id'));
  const bodyWorkspaceId = pickBodyWorkspaceId(body);
  const actorUserId =
    trimOrNull(identity?.userId) ||
    (ingestBypass ? trimOrNull(sessionHints.user_id) : null);

  const workspaceCandidates = [
    headerWorkspaceId,
    bodyWorkspaceId,
    sessionHints.workspace_id,
    identity?.workspaceId,
    identity?.active_workspace_id,
  ];
  const hasAnyCandidate = workspaceCandidates.some((c) => trimOrNull(c));
  if (!hasAnyCandidate) {
    return {
      ok: false,
      error: {
        code: 'WORKSPACE_CONTEXT_MISSING',
        message: 'workspace context missing',
        httpStatus: 400,
        redirect: '/onboarding',
      },
    };
  }

  let workspaceId = null;
  if (actorUserId && env?.DB) {
    try {
      workspaceId = await authorizeFirstWorkspace(env, actorUserId, workspaceCandidates);
    } catch (e) {
      console.warn('[runtime/turn/context] authorizeWorkspace', e?.message ?? e);
    }
  }
  if (!workspaceId) {
    return {
      ok: false,
      error: {
        code: 'WORKSPACE_ACCESS_DENIED',
        message:
          'workspace must exist in agentsam_workspace and the user must be a member (no phantom / archive ids)',
        httpStatus: 403,
      },
    };
  }

  body.workspace_id = workspaceId;
  body.workspaceId = workspaceId;

  let tenantId = null;
  try {
    tenantId = await getWorkspaceTenantIdWithFallback(env, workspaceId);
  } catch (e) {
    console.warn('[runtime/turn/context] workspace_tenant', e?.message ?? e);
  }
  if (!tenantId) {
    tenantId =
      trimOrNull(sessionHints.tenant_id) || trimOrNull(identity?.tenantId) || null;
  }

  let userId =
    trimOrNull(sessionHints.user_id) ||
    (ingestBypass ? null : trimOrNull(identity?.userId)) ||
    null;
  if (!userId) {
    return {
      ok: false,
      error: { code: 'UNAUTHENTICATED_USER', message: 'unauthenticated user', httpStatus: 401 },
    };
  }
  userId = await resolveCanonicalUserId(userId, env);
  if (!userId) {
    return {
      ok: false,
      error: {
        code: 'auth_user_id_required',
        message: 'Chat requires auth_users.id (au_*) from the authenticated session',
        httpStatus: 401,
      },
    };
  }

  const authUser =
    ingestBypass || !identity
      ? { id: userId, tenant_id: tenantId, email: null }
      : {
          id: userId,
          tenant_id: tenantId,
          email: identity.email ?? null,
          name: identity.name ?? null,
          person_uuid: identity.personUuid ?? null,
        };

  const conversationId =
    trimOrNull(body.conversationId) ||
    trimOrNull(body.session_id) ||
    trimOrNull(body.sessionId) ||
    trimOrNull(sessionHints.session_id) ||
    null;

  const turnContext = {
    userId,
    tenantId,
    workspaceId,
    conversationId,
    runtimeMode: modeParse.mode,
    ingestBypass: !!ingestBypass,
    authUser,
    projectRef: pickProjectRef(body),
    clientSurface: pickClientSurface(body, request),
    workSessionId:
      trimOrNull(body.work_session_id) || trimOrNull(body.workSessionId) || null,
  };

  return { ok: true, turnContext, body, message };
}

const CHAT_DISPATCH_MODES = new Set(['ask', 'plan', 'agent', 'debug', 'multitask', 'auto']);

/**
 * Normalize the run spine shared by chat turn and tool-loop context.
 *
 * @param {Record<string, unknown>|null|undefined} spine
 * @returns {{ agent_run_id: string|null, routing_arm_id: string|null, mode: string|null }}
 */
export function normalizeChatDispatchSpine(spine) {
  if (!spine || typeof spine !== 'object') {
    return { agent_run_id: null, routing_arm_id: null, mode: null };
  }
  const agentRunId = String(spine.agent_run_id ?? spine.agentRunId ?? '').trim();
  const routingArmId = String(spine.routing_arm_id ?? spine.routingArmId ?? '').trim();
  const rawMode = String(spine.mode ?? '').trim().toLowerCase();
  return {
    agent_run_id: agentRunId || null,
    routing_arm_id: routingArmId || null,
    mode: rawMode && CHAT_DISPATCH_MODES.has(rawMode) ? rawMode : rawMode ? 'auto' : null,
  };
}
