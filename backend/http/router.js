/**
 * Backend HTTP composition boundary — post-middleware domain routes owned by backend/http/*.
 *
 * Lane A contract (identity/session): callers pass the primed authCtx from the Worker front door.
 * This router maps authCtx → portable IdentityContext once; route handlers consume that result
 * and must not independently authenticate or reselect the request workspace.
 */
import { identityContextFromAuthContext } from '../identity/contracts/identity-context.js';
import { verifyBridgeKey } from '../auth/bridge-key-auth.js';
import { handleAuthMe } from './auth/me.js';
import { handleAgentSamBootstrap } from './agentsam/bootstrap.js';
import { handleAgentRequest } from './agentsam/index.js';
import { handleDashboardBootstrap } from './dashboard/bootstrap.js';
import { dispatchSettingsHttpRoutes } from './settings/index.js';
import { dispatchCmsThemeHttpRoutes, isCmsThemeHttpPath } from './cms/themes/index.js';
import { handleBrowserCapturesApi } from './browser/captures.js';
import { handleBrowserCaptureContextInternal } from './browser/capture-context-internal.js';
import { handleBrowserTrust } from './browser/trust.js';
import { handleBrowserEmbedPolicy } from './browser/embed-policy.js';
import { handleWorkflowsApi } from './workflows/recent-runs.js';
import { handleInternalWorkflowRequest } from './workflows/internal.js';
import { handleAcpRequest } from './acp/handler.js';
import { handleCursorAcpMessage } from './acp/cursor.js';
import { dispatchInternalHttpRoutes } from './internal/index.js';
import { handleCommandsHttp } from './commands.js';
import { handleCompanyHttp } from './company.js';
import { handleClientConfigHttp } from './config.js';
import { handleContactHttp } from './contact.js';
import { handleHubHttp } from './hub.js';
import { handleSearchHttp } from './search.js';
import { handleOpsDeskHttp } from './ops-desk.js';
import { handleAgentPolicyHttp } from './agent-policy.js';

/**
 * @typedef {object} BackendHttpRouteContext
 * @property {Request} request
 * @property {URL} url
 * @property {object} env
 * @property {ExecutionContext} ctx
 * @property {import('../identity/contracts/identity-context.js').IdentityContext} [identity]
 * @property {import('../identity/resolve-identity.js').AuthContext | null} [authCtx]
 * @property {Record<string, unknown> | null} [authUser]
 * @property {string} pathLower
 * @property {string} methodUpper
 */

function portableIdentity(rc) {
  if (rc?.identity && typeof rc.identity.authenticated === 'boolean') {
    return rc.identity;
  }
  return identityContextFromAuthContext(rc?.authCtx ?? null);
}

/**
 * Dispatch backend-owned HTTP surfaces.
 *
 * @param {BackendHttpRouteContext} rc
 * @returns {Promise<Response|null>}
 */
export async function dispatchBackendHttpRoutes(rc) {
  const { request, url, env, ctx, pathLower, methodUpper, authCtx = null, authUser = null } = rc;

  // Browser whoami proves its own browser session and intentionally runs before
  // workspace-required request context in the live Worker.
  if (pathLower === '/api/auth/me' && methodUpper === 'GET') {
    return handleAuthMe(request, env);
  }

  if (pathLower.startsWith('/api/internal/')) {
    const internalResponse = await dispatchInternalHttpRoutes({ request, env, ctx, pathLower });
    if (internalResponse) return internalResponse;
  }

  if (pathLower.startsWith('/api/browser/captures')) {
    return handleBrowserCapturesApi(request, url, env);
  }

  if (pathLower === '/api/internal/browser/capture-context') {
    const response = await handleBrowserCaptureContextInternal(request, url, env);
    if (response) return response;
  }

  if (pathLower.startsWith('/api/agentsam/browser/trust')) {
    return handleBrowserTrust(request, env);
  }

  if (pathLower.startsWith('/api/agentsam/browser/embed-policy')) {
    return handleBrowserEmbedPolicy(request, env);
  }

  if (pathLower === '/api/workflows') {
    return handleWorkflowsApi(request, url, env);
  }

  if (pathLower.startsWith('/api/internal/workflow/')) {
    const response = await handleInternalWorkflowRequest(request, env, url);
    if (response) return response;
  }

  if (pathLower === '/api/acp' || pathLower.startsWith('/api/acp/')) {
    return handleAcpRequest(request, env, ctx, { identity: portableIdentity(rc) });
  }

  if (pathLower === '/api/cursor/acp' && methodUpper === 'POST') {
    return handleCursorAcpMessage(request, env, ctx, { identity: portableIdentity(rc) });
  }

  if (pathLower === '/api/agent/policy' && methodUpper === 'GET') {
    if (!authUser || !authCtx) return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
    return handleAgentPolicyHttp(request, env, authCtx);
  }

  if (pathLower.startsWith('/api/search')) {
    return handleSearchHttp(request, url, env, ctx);
  }

  if (pathLower === '/api/commands' || pathLower.startsWith('/api/commands/')) {
    return handleCommandsHttp(request, url, env);
  }

  if (pathLower.startsWith('/api/ops-desk')) {
    return handleOpsDeskHttp(request, url, env);
  }

  if (pathLower.startsWith('/api/hub')) {
    return handleHubHttp(request, url, env, ctx);
  }

  if (pathLower === '/api/config/client') {
    return handleClientConfigHttp(request, env);
  }

  if (pathLower === '/api/contact' && methodUpper === 'POST') {
    return handleContactHttp(request, env);
  }

  if (pathLower === '/api/company') {
    return handleCompanyHttp(request, url, env);
  }

  if (pathLower === '/api/dashboard/bootstrap') {
    const identity = portableIdentity(rc);
    const session = authCtx?.sessionRaw;
    return handleDashboardBootstrap(request, env, identity, {
      featureFlags:
        session?.feature_flags && typeof session.feature_flags === 'object'
          ? session.feature_flags
          : {},
      avatarUrl:
        session?.avatar_url != null && String(session.avatar_url).trim()
          ? String(session.avatar_url).trim()
          : null,
    });
  }

  if (pathLower === '/api/agent/bootstrap') {
    return handleAgentSamBootstrap(request, env, portableIdentity(rc));
  }

  if (pathLower === '/api/agent' || pathLower.startsWith('/api/agent/')) {
    const response = await handleAgentRequest(request, env, ctx, {
      identity: portableIdentity(rc),
      routeAuth: { authCtx, authUser },
      ingestBypass: verifyBridgeKey(request, env),
      planServices: rc.planServices ?? null,
      chatServices: rc.chatServices ?? null,
    });
    if (response) return response;
  }

  if (isCmsThemeHttpPath(pathLower)) {
    return dispatchCmsThemeHttpRoutes({ request, url, env, authCtx, authUser });
  }

  if (
    pathLower.startsWith('/api/settings') ||
    pathLower.startsWith('/api/tenant') ||
    pathLower.startsWith('/api/ai')
  ) {
    return dispatchSettingsHttpRoutes(request, env, ctx, {
      url,
      pathLower,
      methodUpper,
      authCtx,
      authUser,
    });
  }

  return null;
}
