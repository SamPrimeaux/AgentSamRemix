/**
 * Legacy production-dispatch entry only.
 * Runtime ownership is backend/http/cms/themes/*; backend/http/router.js handles
 * these URLs before src/core/production-dispatch.js. Delete this file with the
 * production-dispatch retirement cut.
 */
import { dispatchCmsThemeHttpRoutes } from '../../backend/http/cms/themes/index.js';

export async function handleThemesApi(request, url, env, ctx) {
  void ctx;
  return dispatchCmsThemeHttpRoutes({ request, url, env });
}
