/**
 * GET /api/dashboard/bootstrap
 *
 * Authenticated application-shell bootstrap. This endpoint is observational:
 * it consumes the already-resolved IdentityContext and never selects a
 * workspace, remints a session, compiles Agent Sam authority, or writes cache.
 */
import { listAccessibleWorkspaces } from '../../identity/workspace/authority.js';
import { resolveDashboardBootstrapTheme } from '../../services/cms/theme/payload.js';
import { hydrateCmsThemeCssVarsFromR2 } from '../../services/cms/adapters/cloudflare/theme.js';

export const DASHBOARD_BOOTSTRAP_L1_KEYS = Object.freeze([
  'ok',
  'fetched_at',
  'me',
  'feature_flags',
  'workspaces',
  'identity',
  'status',
  'theme',
  'client',
  '_meta',
]);

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function asFeatureFlags(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {import('../../identity/contracts/identity-context.js').IdentityContext} identity
 * @param {{ featureFlags?: Record<string, unknown>|null, avatarUrl?: string|null }} [options]
 */
export async function handleDashboardBootstrap(request, env, identity, options = {}) {
  if (request.method.toUpperCase() !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }
  if (!identity?.authenticated || !identity?.user?.id) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const userId = String(identity.user.id);
  const workspaceId = identity.workspace?.id ? String(identity.workspace.id) : null;
  const tenantId = identity.tenant?.id ? String(identity.tenant.id) : null;
  const featureFlags = asFeatureFlags(options.featureFlags);

  const themeAuth = {
    id: userId,
    tenant_id: tenantId,
    email: identity.user.email ?? null,
    display_name: identity.user.displayName ?? null,
  };

  const [workspaceResult, themeResult] = await Promise.allSettled([
    env?.DB
      ? listAccessibleWorkspaces(env.DB, env, themeAuth, {
          orderBy: 'COALESCE(aw.display_name, aw.name, aw.id) ASC',
          limit: 500,
        })
      : Promise.resolve([]),
    resolveDashboardBootstrapTheme(env, themeAuth, workspaceId, {
      cache: false,
      hydrateCssVars: (themeEnv, row) =>
        hydrateCmsThemeCssVarsFromR2(themeEnv, row, { persist: false }),
    }),
  ]);

  const workspaceRowsRaw =
    workspaceResult.status === 'fulfilled' ? workspaceResult.value : [];
  const workspaceRows = workspaceRowsRaw.map((row) => {
    const id = String(row?.id || '').trim();
    const slug = String(row?.slug || row?.handle || id).trim() || id;
    return {
      id,
      name: String(row?.name || row?.display_name || slug || id),
      slug,
      handle: slug,
      status: row?.status != null ? String(row.status) : null,
      role: row?.member_role != null ? String(row.member_role) : 'member',
      github_repo:
        row?.github_repo != null && String(row.github_repo).trim()
          ? String(row.github_repo).trim()
          : null,
      database_studio_name: null,
    };
  });
  const theme = themeResult.status === 'fulfilled' ? themeResult.value : null;
  const currentWorkspace =
    (workspaceId && workspaceRows.find((row) => row.id === workspaceId)) ||
    (workspaceId ? { id: workspaceId, name: workspaceId, slug: workspaceId, role: null } : null);

  const capabilities = identity.capabilities || {
    canRunPty: false,
    canRunMcp: false,
    canDeploy: false,
  };

  const supabaseUrl =
    env?.SUPABASE_URL != null ? String(env.SUPABASE_URL).trim().replace(/\/$/, '') : '';
  const supabaseAnonKey =
    env?.SUPABASE_ANON_KEY != null ? String(env.SUPABASE_ANON_KEY).trim() : '';

  return json({
    ok: true,
    fetched_at: Date.now(),
    me: {
      authenticated: true,
      user: {
        id: userId,
        email: identity.user.email ?? null,
        name: identity.user.displayName ?? null,
        avatar_url: options.avatarUrl ?? null,
        tenant_id: tenantId,
      },
      workspace: currentWorkspace
        ? {
            id: currentWorkspace.id,
            name: currentWorkspace.name,
            slug: currentWorkspace.slug,
            role: currentWorkspace.role ?? identity.membership?.role ?? null,
          }
        : null,
      workspaces: workspaceRows,
      capabilities,
      feature_flags: featureFlags,
    },
    feature_flags: featureFlags,
    identity: {
      workspace_id: workspaceId,
      tenant_id: tenantId,
      github_repo: currentWorkspace?.github_repo ?? null,
      capabilities,
    },
    workspaces: {
      data: workspaceRows,
      current: workspaceId,
      current_source: workspaceId ? 'identity.workspace.id' : null,
    },
    status: {
      // Reaching this authenticated endpoint is the L1 worker-health proof.
      health: { status: 'ok', worker: 'inneranimalmedia' },
    },
    theme,
    client:
      supabaseUrl && supabaseAnonKey
        ? {
            supabaseUrl,
            supabaseAnonKey,
            supabase_url: supabaseUrl,
            supabase_anon_key: supabaseAnonKey,
          }
        : null,
    _meta: {
      l1_version: 4,
      read_only: true,
      parallel_queries: 2,
      l2_excluded: [
        'agent_authority',
        'agent_policy',
        'agent_models',
        'agent_sessions',
        'notifications',
        'git',
        'terminal',
        'tunnel',
        'sandbox',
      ],
    },
  });
}
