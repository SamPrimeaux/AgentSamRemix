/**
 * Cloudflare remote catalog (D1, zones) — requires resolved credential, no D1 SQL here.
 */
import { customerCloudflareSelectWorkspaceResource } from '../../../src/core/customer-cloudflare-dispatch.js';
import { listWorkspaceDataBindings } from '../../../src/core/workspace-data-bindings.js';
import { maskAccountId } from '../../../src/core/workspace-cloudflare-credentials.js';
import { resolveUserCloudflareCredential } from './credentials.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @param {{ token: string, account_id: string }} cf
 * @param {string} [accountIdParam]
 */
export async function listCloudflareD1Databases(cf, accountIdParam = '') {
  const accountId = trim(accountIdParam) || cf.account_id;
  if (!accountId) {
    return { ok: false, error: 'CLOUDFLARE_ACCOUNT_ID_REQUIRED', status: 400 };
  }
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database`,
    {
      headers: {
        Authorization: `Bearer ${cf.token}`,
        'Content-Type': 'application/json',
      },
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    const msg = data?.errors?.[0]?.message || `cloudflare_d1_list_${res.status}`;
    return { ok: false, error: 'CLOUDFLARE_D1_LIST_FAILED', message: String(msg), status: 400 };
  }
  return {
    ok: true,
    account_id_mask: maskAccountId(accountId),
    databases: Array.isArray(data?.result) ? data.result : [],
  };
}

/**
 * @param {{ token: string, account_id: string }} cf
 */
export async function listCloudflareZones(cf) {
  const accountId = cf.account_id;
  if (!accountId) {
    return { ok: false, error: 'CLOUDFLARE_ACCOUNT_ID_REQUIRED', status: 400 };
  }
  const zones = [];
  let page = 1;
  for (let guard = 0; guard < 20; guard += 1) {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones?account.id=${encodeURIComponent(accountId)}&page=${page}&per_page=50`,
      {
        headers: {
          Authorization: `Bearer ${cf.token}`,
          'Content-Type': 'application/json',
        },
      },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false) {
      const msg = data?.errors?.[0]?.message || `cloudflare_zones_list_${res.status}`;
      return { ok: false, error: 'CLOUDFLARE_ZONES_LIST_FAILED', message: String(msg), status: 400 };
    }
    const batch = Array.isArray(data?.result) ? data.result : [];
    for (const z of batch) {
      if (!z?.id) continue;
      zones.push({
        id: String(z.id),
        name: z.name != null ? String(z.name) : '',
        status: z.status != null ? String(z.status) : '',
      });
    }
    const info = data?.result_info;
    const totalPages = info?.total_pages != null ? Number(info.total_pages) : page;
    if (page >= totalPages || batch.length === 0) break;
    page += 1;
  }
  return { ok: true, account_id_mask: maskAccountId(accountId), zones };
}

/**
 * @param {any} env
 * @param {object} params
 */
export async function selectWorkspaceD1(env, params) {
  const {
    userId,
    tenantId,
    workspaceId,
    databaseId,
    accountId = '',
    displayName = '',
  } = params;
  const out = await customerCloudflareSelectWorkspaceResource(env, {
    user_id: userId,
    tenant_id: tenantId,
    workspace_id: workspaceId,
    account_id: accountId,
    database_id: databaseId,
    display_name: displayName || databaseId,
  });
  return {
    ok: true,
    binding_id: out.binding_id,
    database_id: databaseId,
    account_id_mask: maskAccountId(accountId),
    workspace_id: workspaceId,
  };
}

/**
 * @param {any} env
 * @param {object} scope
 * @param {string} [accountIdParam]
 */
export async function listD1ForScope(env, scope, accountIdParam = '') {
  const cf = await resolveUserCloudflareCredential(env, scope);
  if (!cf.ok) {
    return {
      ok: false,
      error: 'CLOUDFLARE_CREDENTIALS_MISSING',
      message: 'Add your Cloudflare API token in Keys & Secrets first.',
      status: 400,
    };
  }
  const listed = await listCloudflareD1Databases(cf, accountIdParam);
  if (!listed.ok) return listed;
  const bindings = await listWorkspaceDataBindings(env, scope.workspaceId, 'cloudflare_d1');
  return {
    ...listed,
    selected_binding: bindings.find((b) => b.selected_as_default === 1) ?? bindings[0] ?? null,
    workspace_id: scope.workspaceId,
  };
}

/**
 * @param {any} env
 * @param {object} scope
 */
export async function listZonesForScope(env, scope) {
  const cf = await resolveUserCloudflareCredential(env, scope);
  if (!cf.ok) {
    return {
      ok: false,
      error: 'CLOUDFLARE_CREDENTIALS_MISSING',
      message: 'Add your Cloudflare API token in Keys & Secrets first.',
      status: 400,
    };
  }
  const listed = await listCloudflareZones(cf);
  if (!listed.ok) return listed;
  return { ...listed, workspace_id: scope.workspaceId };
}
