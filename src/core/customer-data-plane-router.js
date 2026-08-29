import { getDefaultWorkspaceDataBinding } from './workspace-data-bindings.js';
import { resolveCloudflareUserConnection } from './workspace-cloudflare-credentials.js';
import { isPlatformDataPlane } from './data-plane-access-guard.js';
import { getUserSupabaseToken } from '../../backend/identity/oauth/user-token.js';

/** @typedef {'platform_d1'|'platform_supabase'|'platform_access_denied'|'resource_required'|'public_learning'|'customer_supabase'|'customer_cloudflare_d1'|'customer_cloudflare_r2'|'customer_github'|'customer_drive'} DataPlane */

function messageWantsPublicLearning(_message) {
  return false;
}

function messageWantsCustomerSupabase(_message) {
  return false;
}

function messageWantsCustomerCloudflareD1(_message) {
  return false;
}

function messageWantsCustomerCloudflareR2(_message) {
  return false;
}

function messageWantsPlatformAgentsam(_message) {
  return false;
}

/**
 * @param {{
 *   user_id?: string|null,
 *   tenant_id?: string|null,
 *   workspace_id?: string|null,
 *   intent?: string|null,
 *   message?: string|null,
 *   requested_provider?: string|null,
 *   requested_project_id?: string|null,
 *   requested_resource?: string|null,
 *   operation_type?: string|null,
 *   authUser?: unknown,
 * }} input
 * @param {any} env
 */
export async function resolveCustomerDataPlane(env, input) {
  const message = String(input.message || input.intent || '').trim();
  const workspaceId = input.workspace_id != null ? String(input.workspace_id).trim() : '';
  const userId = input.user_id != null ? String(input.user_id).trim() : '';
  const tenantId = input.tenant_id != null ? String(input.tenant_id).trim() : '';
  const requestedProvider = input.requested_provider != null ? String(input.requested_provider).trim().toLowerCase() : '';

  /** @type {DataPlane} */
  let data_plane = 'resource_required';
  let owner_type = 'customer';
  let provider = null;
  let degraded_reason = 'resource_not_selected';
  let requires_approval = false;
  let customer_connection_ok = false;

  const providerMap = {
    supabase: 'customer_supabase',
    customer_supabase: 'customer_supabase',
    cloudflare: 'customer_cloudflare_d1',
    cloudflare_d1: 'customer_cloudflare_d1',
    cloudflare_r2: 'customer_cloudflare_r2',
    github: 'customer_github',
    google_drive: 'customer_drive',
    drive: 'customer_drive',
    public_learning: 'public_learning',
    platform_d1: 'customer_cloudflare_d1',
    platform_supabase: 'customer_supabase',
    platform_supabase_agentsam: 'customer_supabase',
  };

  const wantsCustomer =
    messageWantsCustomerSupabase(message) ||
    messageWantsCustomerCloudflareD1(message) ||
    messageWantsCustomerCloudflareR2(message);

  if (requestedProvider && providerMap[requestedProvider]) {
    data_plane = providerMap[requestedProvider];
  } else if (messageWantsPublicLearning(message)) {
    data_plane = 'public_learning';
  } else if (messageWantsCustomerCloudflareR2(message)) {
    data_plane = 'customer_cloudflare_r2';
  } else if (messageWantsCustomerCloudflareD1(message)) {
    data_plane = 'customer_cloudflare_d1';
  } else if (messageWantsCustomerSupabase(message)) {
    data_plane = 'customer_supabase';
  } else if (messageWantsPlatformAgentsam(message)) {
    data_plane = 'customer_supabase';
    degraded_reason = 'use_connected_supabase_or_keys';
  } else if (wantsCustomer) {
    data_plane = messageWantsCustomerCloudflareD1(message)
      ? 'customer_cloudflare_d1'
      : messageWantsCustomerCloudflareR2(message)
        ? 'customer_cloudflare_r2'
        : 'customer_supabase';
  } else {
    data_plane = 'resource_required';
    degraded_reason = 'resource_not_selected';
  }

  if (isPlatformDataPlane(data_plane)) {
    data_plane = data_plane.includes('supabase') ? 'customer_supabase' : 'customer_cloudflare_d1';
  }

  owner_type = data_plane === 'public_learning' ? 'public_learning' : 'customer';

  if (data_plane.startsWith('customer_')) {
    provider = data_plane.replace('customer_', '');
  }

  let connection_id = null;
  let project_ref = null;
  let external_project_id = input.requested_project_id != null ? String(input.requested_project_id) : null;
  let external_database_id = null;
  let external_account_id = null;
  let schema = 'public';
  let permissions = { read: true, write: false, ddl: false };
  let policy = { owner_type, data_plane };

  if (data_plane === 'customer_supabase' && workspaceId) {
    const binding = await getDefaultWorkspaceDataBinding(env, workspaceId, 'supabase');
    connection_id = binding?.connection_id != null ? String(binding.connection_id) : 'supabase_oauth';
    project_ref = binding?.external_project_ref != null ? String(binding.external_project_ref) : null;
    external_project_id =
      binding?.external_project_id != null ? String(binding.external_project_id) : external_project_id;
    let oauthConnected = false;
    if (userId) {
      try {
        const tok = await getUserSupabaseToken(env, userId, workspaceId);
        oauthConnected = Boolean(tok?.access_token);
      } catch {
        oauthConnected = false;
      }
    }
    customer_connection_ok = Boolean(project_ref || external_project_id || oauthConnected);
    if (!customer_connection_ok) {
      degraded_reason = degraded_reason || 'supabase_not_connected';
    }
    permissions = { read: true, write: true, ddl: false };
    requires_approval = true;
  }

  if (data_plane === 'customer_supabase' && !workspaceId && userId) {
    connection_id = 'supabase_oauth';
    try {
      const tok = await getUserSupabaseToken(env, userId, null);
      customer_connection_ok = Boolean(tok?.access_token);
    } catch {
      customer_connection_ok = false;
    }
    if (!customer_connection_ok) {
      degraded_reason = degraded_reason || 'supabase_not_connected';
    }
    permissions = { read: true, write: true, ddl: false };
  }

  if (data_plane === 'customer_cloudflare_d1') {
    connection_id = 'cloudflare_oauth';
    if (workspaceId) {
      const binding = await getDefaultWorkspaceDataBinding(env, workspaceId, 'cloudflare_d1');
      if (binding?.connection_id != null) connection_id = String(binding.connection_id);
      external_account_id = binding?.external_account_id != null ? String(binding.external_account_id) : null;
      external_database_id = binding?.external_database_id != null ? String(binding.external_database_id) : null;
    }
    const cfConn = userId
      ? await resolveCloudflareUserConnection(env, userId, workspaceId || null)
      : { connected: false, account_id: null };
    if (cfConn.connected && !external_account_id && cfConn.account_id) {
      external_account_id = cfConn.account_id;
    }
    customer_connection_ok =
      cfConn.connected === true || Boolean(external_account_id && external_database_id);
    if (!customer_connection_ok) {
      degraded_reason = degraded_reason || 'cloudflare_not_connected';
    }
    requires_approval = true;
  }

  if (data_plane === 'public_learning') {
    schema = 'public';
    permissions = { read: true, write: false, ddl: false };
    requires_approval = false;
  }

  const operation_type = input.operation_type != null ? String(input.operation_type) : null;
  if (operation_type && /^(propose_migration|apply|ddl|dml|delete|update|insert)/i.test(operation_type)) {
    requires_approval = true;
  }

  return {
    data_plane,
    owner_type,
    provider,
    connection_id,
    project_ref,
    account_id: external_account_id,
    database_id: external_database_id,
    external_project_id,
    schema,
    permissions,
    policy,
    requires_approval,
    degraded_reason,
    customer_connection_ok,
    tenant_id: tenantId || null,
    workspace_id: workspaceId || null,
    user_id: userId || null,
  };
}
