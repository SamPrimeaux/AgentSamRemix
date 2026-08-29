/**
 * Canonical Worker composition root.
 *
 * Wrangler temporarily enters through src/index.js, but the request lifecycle
 * lives here: prepare context once, dispatch backend HTTP first, then invoke an
 * injected legacy tail only when backend routing does not claim the request.
 * backend/worker never imports the legacy src implementation.
 */
import { AuthError } from '../auth/errors.js';
import { dispatchBackendHttpRoutes } from '../http/router.js';
import { prepareWorkerRequest, normalizedWorkerPath } from './request-context.js';
import { isCmsStudioHost, isPublicOAuthPath, isWorkerHtmlAuthShell } from './front-door-policy.js';
import { finalizeWorkerResponse, workerNotFoundResponse } from './response.js';

export const WORKER_ENTRY_STATUS = 'active-via-src-shim';

function authErrorResponse(request, error) {
  const url = new URL(request.url);
  const path = normalizedWorkerPath(url);
  const pathLower = path.toLowerCase();
  const wantsHtml = String(request.headers.get('Accept') || '').includes('text/html');

  if (wantsHtml && isWorkerHtmlAuthShell(url, pathLower)) {
    const nextTarget = `${url.origin}${path}${url.search || ''}`;
    const loginOrigin = isCmsStudioHost(url.hostname)
      ? 'https://inneranimalmedia.com'
      : url.origin;
    return Response.redirect(
      `${loginOrigin}/auth/login?next=${encodeURIComponent(nextTarget)}`,
      302,
    );
  }

  const status = Number(error?.status) || 401;
  const body =
    isPublicOAuthPath(pathLower) || pathLower.startsWith('/api/oauth/')
      ? { error: error?.code || 'unauthorized', error_description: 'Unauthorized' }
      : { error: 'Unauthorized', code: error?.code || 'UNAUTHORIZED' };
  return Response.json(body, { status });
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {ExecutionContext} ctx
 * @param {{ fallback?: ((route: any) => Promise<Response|null>|Response|null) | null }} [options]
 * @returns {Promise<Response>}
 */
export async function handleWorkerFetch(request, env, ctx, { fallback = null } = {}) {
  let route = null;
  try {
    route = await prepareWorkerRequest(request, env, ctx);
    route.withSessionHealing = (response) => finalizeWorkerResponse(route, response);

    if (route.earlyResponse) {
      return finalizeWorkerResponse(route, route.earlyResponse);
    }

    const backendResponse = await dispatchBackendHttpRoutes(route);
    if (backendResponse) return finalizeWorkerResponse(route, backendResponse);

    if (fallback) {
      const legacyResponse = await fallback(route);
      if (legacyResponse) return finalizeWorkerResponse(route, legacyResponse);
    }

    return finalizeWorkerResponse(route, workerNotFoundResponse(route));
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(request, error);
    console.error('[Worker Error]', error?.message || error);
    return Response.json(
      { error: 'Internal Server Error', detail: error?.message || 'Unknown worker error' },
      { status: 500 },
    );
  }
}

export default {
  fetch: handleWorkerFetch,
};
