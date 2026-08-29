/**
 * Umbrella dispatch — routes to public learning, customer Supabase/Cloudflare, or platform assistant.
 * SECURITY: no platform fallback when customer DB is missing.
 */
import { resolveCustomerDataPlane } from './customer-data-plane-router.js';
import { dispatchPublicLearning } from './public-learning-dispatch.js';
import { dispatchCustomerSupabase } from './customer-supabase-dispatch.js';
import { dispatchCustomerCloudflare } from './customer-cloudflare-dispatch.js';
import { dispatchDatabaseAssistant } from './database-assistant-dispatch.js';
import { assertDataPlaneAccess, isPlatformDataPlane, USER_ACCOUNT_DATA_PLANE } from './data-plane-access-guard.js';
import { resolveCloudflareUserConnection } from './workspace-cloudflare-credentials.js';

/**
 * @param {any} env
 * @param {{
 *   message?: string,
 *   operation: string,
 *   authUser?: unknown,
 *   user_id?: string|null,
 *   tenant_id?: string|null,
 *   workspace_id?: string|null,
 *   requested_provider?: string|null,
 *   table?: string,
 *   schema?: string,
 *   resource_ref?: string|null,
 *   sql?: string,
 *   params?: unknown[],
 *   migration_sql?: string,
 *   approval_id?: string|null,
 *   agent_run_id?: string|null,
 *   data_plane?: string|null,
 *   project_ref?: string|null,
 *   project_id?: string|null,
 *   log_sql?: string|null,
 *   iso_timestamp_start?: string|null,
 *   iso_timestamp_end?: string|null,
 * }} opts
 */
export async function dispatchCustomerDataPlaneOperation(env, opts) {
  const plane = await resolveCustomerDataPlane(env, {
    user_id: opts.user_id,
    tenant_id: opts.tenant_id,
    workspace_id: opts.workspace_id,
    message: opts.message,
    requested_provider: opts.data_plane || opts.requested_provider,
    operation_type: opts.operation,
    authUser: opts.authUser,
  });

  const userId = opts.user_id != null ? String(opts.user_id).trim() : '';
  const cfConn =
    userId && (plane.data_plane === 'customer_cloudflare_d1' || plane.data_plane === USER_ACCOUNT_DATA_PLANE)
      ? await resolveCloudflareUserConnection(env, userId, plane.workspace_id)
      : { connected: false };

  const access = assertDataPlaneAccess(
    {
      ...plane,
      cloudflare_oauth_connected: cfConn.connected === true,
      supabase_oauth_connected: plane.customer_connection_ok === true && plane.data_plane === 'customer_supabase',
      database_id: opts.project_id,
    },
    plane.data_plane,
    opts.operation,
    {
      sql: opts.sql,
      migration_sql: opts.migration_sql,
      database_id: opts.project_ref || opts.project_id,
    },
  );

  if (!access.allowed) {
    return {
      ok: false,
      operation: opts.operation,
      data_plane: plane.data_plane,
      error: access.error,
      reason: access.reason,
      user_message: access.user_message,
      duration_ms: 0,
      onboarding_required:
        access.reason === 'customer_database_not_connected' ||
        access.error === 'cloudflare_not_connected' ||
        access.error === 'supabase_not_connected',
    };
  }

  const explicitResourceRef = String(
    opts.resource_ref || opts.project_ref || opts.project_id || '',
  ).trim();
  if (
    ['customer_supabase', 'customer_cloudflare_d1'].includes(plane.data_plane) &&
    !(plane.data_plane === 'customer_supabase' && opts.operation === 'list_projects') &&
    !explicitResourceRef
  ) {
    return {
      ok: false,
      operation: opts.operation,
      data_plane: plane.data_plane,
      error: 'explicit_resource_required',
      reason: 'resource_not_selected',
      duration_ms: 0,
    };
  }

  const base = {
    operation: opts.operation,
    user_id: opts.user_id ?? plane.user_id,
    tenant_id: opts.tenant_id ?? plane.tenant_id,
    workspace_id: opts.workspace_id ?? plane.workspace_id,
    table: opts.table,
    schema: opts.schema ?? plane.schema,
    resource_ref: opts.resource_ref ?? (explicitResourceRef || null),
    sql: opts.sql,
    params: Array.isArray(opts.params) ? opts.params : [],
    migration_sql: opts.migration_sql,
    approval_id: opts.approval_id,
    agent_run_id: opts.agent_run_id,
    authUser: opts.authUser,
    query: opts.sql,
    limit: 25,
    project_ref: opts.project_ref ?? (explicitResourceRef || null),
    project_id: opts.project_id ?? null,
    log_sql: opts.log_sql ?? null,
    iso_timestamp_start: opts.iso_timestamp_start ?? null,
    iso_timestamp_end: opts.iso_timestamp_end ?? null,
  };

  switch (plane.data_plane) {
    case 'public_learning':
      return dispatchPublicLearning(env, base);
    case 'customer_supabase':
      return dispatchCustomerSupabase(env, base);
    case 'customer_cloudflare_d1':
    case 'customer_cloudflare_r2':
      return dispatchCustomerCloudflare(env, base);
    case 'platform_supabase':
    case 'platform_supabase_agentsam':
    case 'platform_d1':
      if (!isPlatformDataPlane(plane.data_plane)) {
        return {
          ok: false,
          error: 'access_denied',
          reason: 'invalid_platform_plane',
          data_plane: plane.data_plane,
        };
      }
      return dispatchDatabaseAssistant(env, {
        operation: opts.operation,
        authUser: opts.authUser,
        tenant_id: opts.tenant_id,
        workspace_id: opts.workspace_id,
        schema: opts.schema || null,
        table: opts.table,
        resource_ref: opts.resource_ref ?? null,
        sql: opts.sql,
        params: Array.isArray(opts.params) ? opts.params : [],
        migration_sql: opts.migration_sql,
        approval_id: opts.approval_id,
        agent_run_id: opts.agent_run_id,
      });
    default:
      return {
        ok: false,
        error: access.error || 'access_denied',
        reason: plane.degraded_reason || access.reason || 'data_plane_denied',
        user_message: access.user_message,
        data_plane: plane.data_plane,
      };
  }
}

export { resolveCustomerDataPlane };
