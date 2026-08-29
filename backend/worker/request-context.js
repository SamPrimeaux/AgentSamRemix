import {
  getRequestAuth,
  peekRequestAuth,
  primeLegacySessionUpgrade,
  primeRequestAuth,
  userFromAuthContext,
} from '../identity/index.js';
import { identityContextFromAuthContext } from '../identity/contracts/identity-context.js';
import { workerAuthMode } from './front-door-policy.js';
import { wrapEnvKvBinding } from './kv-storage-policy.js';
import { isLikelySecretProbePath, isLikelyWordPressProbePath } from './probes.js';

export function normalizedWorkerPath(url) {
  return String(url.pathname || '/').replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
}

function requestContextFromAuth(authCtx, authMode) {
  if (!authCtx?.userId) {
    return {
      identity: null,
      auth: null,
      publicRoute: authMode === 'soft',
      error: 'unauthenticated',
    };
  }
  return {
    userId: authCtx.userId,
    workspaceId: authCtx.workspaceId ?? null,
    tenantId: authCtx.tenantId ?? null,
    authType:
      authCtx.authType === 'mcp' || authCtx.authType === 'bridge' ? 'bearer' : 'session',
  };
}

/**
 * One Worker identity object. Portable IdentityContext is canonical; flat aliases
 * remain temporarily for backend handlers not yet converted to the nested shape.
 */
function workerIdentityFromAuthContext(authCtx) {
  const identity = identityContextFromAuthContext(authCtx);
  return {
    ...identity,
    userId: authCtx?.userId ?? null,
    tenantId: authCtx?.tenantId ?? null,
    workspaceId: authCtx?.workspaceId ?? null,
    email: authCtx?.email ?? null,
    name: authCtx?.name ?? authCtx?.displayName ?? null,
    personUuid: authCtx?.personUuid ?? null,
    sessionId: authCtx?.sessionId ?? null,
    error:
      authCtx?.userId && authCtx?.tenantId && !authCtx?.workspaceId
        ? 'WORKSPACE_CONTEXT_MISSING'
        : null,
  };
}

/**
 * Resolve request identity exactly once at the backend Worker boundary.
 *
 * Public/machine routes use soft priming: a valid browser session is cached for
 * downstream consumers, but missing/broken browser auth never blocks the route.
 * The legacy fallback receives the already-resolved auth/session/identity state;
 * it must not authenticate again.
 */
export async function prepareWorkerRequest(request, rawEnv, ctx) {
  const env = wrapEnvKvBinding(rawEnv);
  const url = new URL(request.url);
  const path = normalizedWorkerPath(url);
  const pathLower = path.toLowerCase();
  const methodUpper = String(request.method || 'GET').toUpperCase();

  if (isLikelySecretProbePath(pathLower) || isLikelyWordPressProbePath(pathLower)) {
    return {
      request,
      url,
      env,
      ctx,
      path,
      pathLower,
      methodUpper,
      authMode: 'none',
      authCtx: null,
      authUser: null,
      identity: workerIdentityFromAuthContext(null),
      legacyIdentity: null,
      requestContext: requestContextFromAuth(null, 'none'),
      earlyResponse: new Response(null, { status: 404 }),
    };
  }

  const authMode = workerAuthMode({ url, pathLower, methodUpper });
  let authCtx = null;
  if (authMode === 'soft') {
    await primeRequestAuth(request, env);
    authCtx = peekRequestAuth(request) ?? null;
  } else if (authMode === 'optional' || authMode === 'required') {
    authCtx = await getRequestAuth(request, env, {
      required: authMode === 'required',
    });
  }

  if (authMode !== 'none') {
    await primeLegacySessionUpgrade(request, env, {
      session: authCtx?.sessionRaw ?? null,
    });
  }

  const identity = workerIdentityFromAuthContext(authCtx);
  return {
    request,
    url,
    env,
    ctx,
    path,
    pathLower,
    methodUpper,
    authMode,
    authCtx,
    authUser: authCtx ? userFromAuthContext(authCtx) : null,
    identity,
    legacyIdentity: authCtx ? identity : null,
    requestContext: requestContextFromAuth(authCtx, authMode),
    earlyResponse: null,
  };
}
