/**
 * GET /api/agent/bootstrap
 *
 * Agent Sam L2 startup. Identity/workspace scope is supplied by the Worker
 * request gate; this route never reselects the request workspace.
 */
import { listAgentModels } from '../../agentsam/catalog/models.js';
import { resolveAgentSamBootstrap } from '../../services/bootstrap/resolve.js';

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {import('../../identity/contracts/identity-context.js').IdentityContext} identity
 */
export async function handleAgentSamBootstrap(request, env, identity) {
  if (request.method.toUpperCase() !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }
  if (!identity?.authenticated || !identity?.user?.id) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const userId = String(identity.user.id);
  const workspaceId = identity.workspace?.id ? String(identity.workspace.id) : '';
  const tenantId = identity.tenant?.id ? String(identity.tenant.id) : '';
  if (!workspaceId) {
    return json({ error: 'WORKSPACE_CONTEXT_MISSING', code: 'WORKSPACE_CONTEXT_MISSING' }, 400);
  }
  if (!tenantId) {
    return json({ error: 'TENANT_CONTEXT_MISSING', code: 'TENANT_CONTEXT_MISSING' }, 400);
  }

  const [authorityResult, modelsResult] = await Promise.allSettled([
    resolveAgentSamBootstrap(env, {
      userId,
      requestedWorkspaceId: workspaceId,
    }),
    listAgentModels(env, { showInPicker: true }),
  ]);

  if (authorityResult.status === 'rejected') {
    return json(
      { error: authorityResult.reason?.message ?? 'agent_authority_compile_failed' },
      500,
    );
  }

  const authority = authorityResult.value;
  if (!authority?.ok) {
    const forbidden = authority?.code === 'BOOTSTRAP_FORBIDDEN' || authority?.error === 'workspace_forbidden';
    const unavailable = authority?.error === 'database_not_configured';
    return json(
      {
        error: authority?.error || 'agent_authority_unavailable',
        code: authority?.code || null,
      },
      forbidden ? 403 : unavailable ? 503 : 400,
    );
  }

  const models = modelsResult.status === 'fulfilled' ? modelsResult.value : [];
  return json(
    {
      ok: true,
      fetched_at: Date.now(),
      identity: {
        user_id: userId,
        tenant_id: tenantId,
        workspace_id: workspaceId,
      },
      authority: {
        capabilities: authority.capabilities ?? {},
        governance_roles: authority.governance_roles ?? [],
        policy: authority.policy ?? null,
        byok: authority.byok ?? null,
        policy_hash: authority.policy_hash ?? null,
        context_hash: authority.context_hash ?? null,
        bootstrap_version: authority.bootstrap_version ?? null,
        compiler_version: authority.generated_from_version ?? null,
        cache_hit: authority.cache_hit === true,
        kv_cache_hit: authority.kv_cache_hit === true,
        refreshed: authority.refreshed === true,
      },
      // Compatibility convenience: existing Agent consumers expect the policy as a top-level concept.
      agent_policy: authority.policy ?? null,
      models,
      _meta: {
        l2_version: 1,
        canonical_path: '/api/agent/bootstrap',
        excluded: ['chat_history', 'terminal', 'git', 'workflows'],
      },
    },
    200,
  );
}
