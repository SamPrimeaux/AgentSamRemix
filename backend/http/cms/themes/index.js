import { authUserFromRequest } from '../../../identity/resolve-identity.js';
import { httpJsonResponse as jsonResponse } from '../../responses.js';
import { handleCmsThemeReadRoute } from './read.js';
import { handleCmsThemeCreateRoute } from './create.js';
import { handleCmsThemePackageRoute } from './package.js';
import { handleCmsThemeApplyRoute } from './apply.js';
import { handleCmsThemeUpdateRoute } from './update.js';

const ROUTES = new Set([
  'GET /api/themes',
  'GET /api/user/preferences',
  'GET /api/themes/active',
  'POST /api/themes/create',
  'POST /api/themes/package',
  'POST /api/themes/apply',
  'GET /api/themes/detail',
  'POST /api/themes/update',
  'POST /api/themes/delete',
]);

export function isCmsThemeHttpPath(pathLower) {
  return pathLower === '/api/user/preferences' || pathLower === '/api/themes' || pathLower.startsWith('/api/themes/');
}

export async function dispatchCmsThemeHttpRoutes({
  request,
  url,
  env,
  authCtx = undefined,
  authUser: routeAuthUser = null,
}) {
  const pathLower = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
  const method = request.method.toUpperCase();

  if (!env?.DB) return jsonResponse({ error: 'DB not configured' }, 503);
  if (!ROUTES.has(`${method} ${pathLower}`)) return jsonResponse({ error: 'Theme route not found' }, 404);

  const authUser = await authUserFromRequest(request, env, authCtx, routeAuthUser).catch(() => null);
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

  const route = { pathLower, request, url, env, authUser };
  try {
    return (
      (await handleCmsThemeReadRoute(route)) ||
      (await handleCmsThemeCreateRoute(route)) ||
      (await handleCmsThemePackageRoute(route)) ||
      (await handleCmsThemeApplyRoute(route)) ||
      (await handleCmsThemeUpdateRoute(route)) ||
      jsonResponse({ error: 'Theme route not found' }, 404)
    );
  } catch (error) {
    return jsonResponse({ error: error?.message || String(error) }, 500);
  }
}
