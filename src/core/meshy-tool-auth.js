/**
 * Prime request auth cache for in-process agent tool → CAD Meshy calls.
 * Avoids bare HTTP to IAM_ORIGIN (401 without session cookies).
 */
import { fetchAuthUserTenantId, primeRequestAuth, primeRequestAuthWithContext } from './auth.js';

/** @type {WeakMap<Request, object>} */
const toolAuthPrimed = new WeakMap();

/**
 * @param {Request} request
 * @param {any} env
 * @param {{ userId: string; tenantId?: string | null; workspaceId?: string | null }} auth
 */
export async function primeRequestAuthForTool(request, env, auth) {
  if (toolAuthPrimed.has(request)) return;

  const userId = String(auth.userId || '').trim();
  if (!userId) return;

  let tenantId = auth.tenantId != null ? String(auth.tenantId).trim() : '';
  if (!tenantId && env?.DB) {
    try {
      tenantId = String(await fetchAuthUserTenantId(env, userId) || '').trim();
    } catch {
      /* platform Meshy key may still work */
    }
  }

  const bridgeKey = env?.AGENTSAM_BRIDGE_KEY != null ? String(env.AGENTSAM_BRIDGE_KEY).trim() : '';
  const mcpToken = env?.MCP_AUTH_TOKEN != null ? String(env.MCP_AUTH_TOKEN).trim() : '';
  const bearer = bridgeKey || mcpToken;

  if (bearer) {
    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${bearer}`);
    headers.set('X-User-Id', userId);
    if (tenantId) headers.set('X-Tenant-Id', tenantId);
    if (auth.workspaceId) headers.set('X-Workspace-Id', String(auth.workspaceId));

    const bridged = new Request(request.url, {
      method: request.method,
      headers,
      body: request.body,
    });

    await primeRequestAuth(bridged, env);
    toolAuthPrimed.set(request, { bridged });
    return;
  }

  // Agent tool loop: trusted in-process identity (no bridge HTTP round-trip)
  primeRequestAuthWithContext(request, {
    userId,
    email: null,
    name: null,
    displayName: null,
    personUuid: null,
    tenantId: tenantId || null,
    workspaceId: auth.workspaceId ? String(auth.workspaceId) : null,
    sessionId: null,
    isPlatformOperator: false,
    authType: 'mcp',
    membership: null,
    policy: {},
    capabilities: { canRunPty: false, canRunMcp: true, canDeploy: false },
  });
  toolAuthPrimed.set(request, { bridged: request });
}

/**
 * @param {Request} request
 * @returns {Request}
 */
export function bridgedToolRequest(request) {
  return toolAuthPrimed.get(request)?.bridged || request;
}
