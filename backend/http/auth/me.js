/**
 * GET /api/auth/me
 *
 * Thin browser whoami transport: session proof → D1 identity authority.
 */
import { proveBrowserSession } from '../../auth/session-proof.js';
import { whoAmI } from '../../identity/whoami.js';

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * @param {Request} request
 * @param {any} env
 * @returns {Promise<Response>}
 */
export async function handleAuthMe(request, env) {
  if (request.method.toUpperCase() !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const proof = await proveBrowserSession(request, env);
  if (!proof) return json({ error: 'Unauthorized' }, 401);

  const identity = await whoAmI(env, proof);
  if (!identity.ok) {
    const status =
      identity.error === 'database_unavailable' || identity.error === 'identity_read_failed'
        ? 503
        : identity.error === 'user_not_found'
          ? 401
          : 401;
    return json({ error: identity.error }, status);
  }

  return json({
    authenticated: true,
    user: identity.user,
    tenant: identity.tenant,
    workspace: identity.workspace
      ? {
          id: identity.workspace.id,
          source: 'active_pin',
        }
      : null,
    membership: identity.membership,
    session: identity.session,
  });
}
