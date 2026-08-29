/**
 * Compatibility exports for callers that have not yet moved to identity/index.js.
 *
 * Workspace selection and authorization have one implementation in
 * resolve-identity.js. New code must import from ../identity/index.js.
 */
import {
  fetchAuthUserWorkspacePrefs,
  resolveIdentity,
} from './resolve-identity.js';

export { fetchAuthUserWorkspacePrefs };

/**
 * @param {any} env
 * @param {{
 *   request?: Request|null,
 *   queryWorkspaceId?: string|null,
 * }} opts
 */
export async function resolveWorkspaceIdForRequest(env, opts = {}) {
  const identity = await resolveIdentity(opts.request ?? null, env, {
    required: false,
    workspaceIdOverride: opts.queryWorkspaceId ?? null,
  });
  return identity?.workspace?.id || '';
}
