/**
 * Data-plane guards — user tools use OAuth + user_secrets (BYOK) only.
 * Worker bindings (env.DB / env.HYPERDRIVE) are app-owned; not a user permission surface.
 */

export const PLATFORM_DATA_PLANES = Object.freeze([
  'platform_d1',
  'platform_supabase',
  'platform_supabase_agentsam',
]);

/** Full reach within caller OAuth account — not cross-account, not workspace-pinned. */
export const USER_ACCOUNT_DATA_PLANE = 'user_account';

function trimId(v) {
  return v == null ? '' : String(v).trim();
}

const PLATFORM_TOOL_NAME_RE =
  /^(d1_|hyperdrive_|platform_d1|platform_hyperdrive|platform_supabase|supabase_query|supabase_write|supabase_schema)/i;

const CUSTOMER_TOOL_NAME_RE =
  /^(customer_|public_learning_)/i;

/** @param {string} dataPlane */
export function isPlatformDataPlane(dataPlane) {
  return PLATFORM_DATA_PLANES.includes(String(dataPlane || '').trim());
}

/** @param {string} dataPlane */
export function isCustomerDataPlane(dataPlane) {
  const p = String(dataPlane || '');
  return p.startsWith('customer_');
}

/** @param {string} code @param {Record<string, unknown>} [fields] */
export function logDataPlaneSecurityEvent(code, fields = {}) {
  console.info(`[data-plane] ${code}`, JSON.stringify({ ts: new Date().toISOString(), ...fields }));
}

/** @param {string} toolName @param {Record<string, unknown>|null|undefined} [handlerConfig] */
export function isPlatformOnlyCatalogTool(toolName, handlerConfig = null) {
  const n = String(toolName || '').trim();
  if (!n) return false;
  if (PLATFORM_TOOL_NAME_RE.test(n)) return true;
  const cfg = handlerConfig && typeof handlerConfig === 'object' ? handlerConfig : {};
  if (cfg.admin_only === true || cfg.admin_only === 1) return true;
  const plane = String(cfg.data_plane || '').trim();
  if (isPlatformDataPlane(plane)) return true;
  if (String(cfg.dispatcher || '') === 'database_assistant' && isPlatformDataPlane(plane)) return true;
  return false;
}

/** @param {string} toolName */
export function isCustomerOrPublicCatalogTool(toolName) {
  const n = String(toolName || '').trim();
  return CUSTOMER_TOOL_NAME_RE.test(n) || n.startsWith('public_learning');
}

/**
 * @param {Record<string, unknown>|null|undefined} resolvedContext
 * @param {{ database_id?: string|null, project_ref?: string|null, provider?: string|null }} [opts]
 */
export function assertUserAccountInfraAccess(resolvedContext, opts = {}) {
  const ctx = resolvedContext || {};
  const databaseId = trimId(opts.database_id);

  if (ctx.cloudflare_oauth_connected !== true && ctx.supabase_oauth_connected !== true) {
    const provider = trimId(opts.provider).toLowerCase();
    if (provider === 'cloudflare' || provider === 'cloudflare_d1') {
      logDataPlaneSecurityEvent('customer_connection_required', {
        user_id: ctx.user_id ?? null,
        provider: 'cloudflare_d1',
        auth_scope: USER_ACCOUNT_DATA_PLANE,
      });
      return deny(
        'cloudflare_not_connected',
        'Connect Cloudflare in Integrations or add keys in Settings before using D1 tools.',
      );
    }
  }

  logDataPlaneSecurityEvent('user_account_infra_access', {
    user_id: ctx.user_id ?? null,
    workspace_id: ctx.workspace_id ?? null,
    provider: opts.provider ?? null,
    database_id: databaseId || null,
    project_ref: opts.project_ref ?? null,
    auth_scope: USER_ACCOUNT_DATA_PLANE,
  });
  return allow('user_account_infra_ok');
}

export function assertDataPlaneAccess(resolvedContext, dataPlane, operation = '', opts = {}) {
  const plane = String(dataPlane || resolvedContext?.data_plane || '').trim();
  const op = String(operation || '').trim();
  const ctx = resolvedContext || {};

  const meta = {
    data_plane: plane,
    operation: op,
    user_id: ctx.user_id ?? null,
    workspace_id: ctx.workspace_id ?? null,
    tenant_id: ctx.tenant_id ?? null,
  };

  if (plane === 'platform_access_denied' || isPlatformDataPlane(plane)) {
    logDataPlaneSecurityEvent('access_denied', { ...meta, reason: 'platform_plane_not_user_scoped' });
    return deny(
      'customer_connection_required',
      'Connect your account in Integrations or Keys (OAuth / BYOK). Worker bindings are app-internal only.',
    );
  }

  if (plane === 'customer_supabase') {
    const connected =
      ctx.customer_connection_ok === true ||
      ctx.supabase_oauth_connected === true ||
      (ctx.project_ref != null && String(ctx.project_ref).trim() !== '') ||
      (ctx.external_project_id != null && String(ctx.external_project_id).trim() !== '');
    if (!connected) {
      logDataPlaneSecurityEvent('customer_connection_required', { ...meta, provider: 'supabase' });
      return deny(
        'supabase_not_connected',
        'Connect Supabase in Integrations or add keys in Settings, then pick a project.',
      );
    }
    logDataPlaneSecurityEvent('selected_customer_data_plane', {
      ...meta,
      provider: 'supabase',
      project_ref: ctx.project_ref ?? null,
      auth_scope: USER_ACCOUNT_DATA_PLANE,
    });
    return allow('user_account_supabase_ok');
  }

  if (plane === 'customer_cloudflare_d1' || plane === USER_ACCOUNT_DATA_PLANE) {
    const databaseId = trimId(opts.database_id ?? ctx.database_id);
    const oauthConnected =
      ctx.cloudflare_oauth_connected === true || ctx.customer_connection_ok === true;
    const bindingConnected =
      ctx.account_id != null &&
      String(ctx.account_id).trim() !== '' &&
      ctx.database_id != null &&
      String(ctx.database_id).trim() !== '';

    if (!oauthConnected && !bindingConnected) {
      logDataPlaneSecurityEvent('customer_connection_required', { ...meta, provider: 'cloudflare_d1' });
      return deny(
        'cloudflare_not_connected',
        'Connect Cloudflare in Integrations or add keys in Settings before using D1 tools.',
      );
    }

    logDataPlaneSecurityEvent('selected_customer_data_plane', {
      ...meta,
      provider: 'cloudflare_d1',
      auth_scope: USER_ACCOUNT_DATA_PLANE,
      database_id: databaseId || null,
    });
    return allow('user_account_cloudflare_d1_ok');
  }

  if (plane === 'customer_cloudflare_r2') {
    logDataPlaneSecurityEvent('selected_customer_data_plane', { ...meta, provider: 'cloudflare_r2' });
    return allow('customer_cloudflare_r2_ok');
  }

  if (plane === 'public_learning') {
    return allow('public_learning_ok');
  }

  return allow('ok');
}

/** @param {string} reason @param {string} userMessage */
function deny(reason, userMessage) {
  const errorCode =
    reason === 'customer_database_not_connected'
      ? 'customer_database_not_connected'
      : reason === 'cloudflare_not_connected'
        ? 'cloudflare_not_connected'
        : reason === 'supabase_not_connected'
          ? 'supabase_not_connected'
        : reason === 'platform_d1_denied_non_operator'
          ? 'platform_d1_denied'
          : 'access_denied';
  return {
    allowed: false,
    reason,
    error: errorCode,
    user_message: userMessage,
  };
}

/** @param {string} reason */
function allow(reason) {
  return { allowed: true, reason, error: null, user_message: null };
}
