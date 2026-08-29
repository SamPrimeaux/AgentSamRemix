/**
 * Per-user Cloudflare data-plane catalog — D1, R2, Hyperdrive, Vectorize via CF API.
 * Worker bindings are app-internal; user catalog is OAuth/BYOK only.
 */
import { getAgentsamWorkspace } from '../../backend/identity/workspace/agentsam-workspace.js';
import {
  customerCloudflareListAccounts,
  customerCloudflareListD1,
  customerCloudflareListHyperdrive,
  customerCloudflareListR2,
  customerCloudflareListVectorize,
} from './customer-cloudflare-dispatch.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function normLower(v) {
  return trim(v).toLowerCase();
}

/**
 * Workspace-selected BYO markers (customer accounts).
 * @param {any} env
 * @param {string} workspaceId
 */
async function resolveWorkspaceBindingSets(env, workspaceId) {
  const ws = trim(workspaceId);
  if (!ws || !env?.DB) {
    return {
      d1Ids: new Set(),
      r2Names: new Set(),
    };
  }
  const row = await getAgentsamWorkspace(env, ws);
  if (!row) {
    return { d1Ids: new Set(), r2Names: new Set() };
  }
  const d1Ids = new Set();
  const d1Id = trim(row.d1_database_id);
  if (d1Id) d1Ids.add(d1Id);
  const r2Names = new Set();
  for (const name of [row.byok_r2_bucket, row.r2_bucket]) {
    const n = normLower(name);
    if (n) r2Names.add(n);
  }
  return { d1Ids, r2Names };
}

/**
 * @param {any} env
 * @param {{
 *   user_id: string,
 *   tenant_id?: string,
 *   workspace_id?: string,
 * }} opts
 */
export async function buildCustomerCloudflareCatalog(env, opts) {
  const userId = trim(opts.user_id);
  const tenantId = trim(opts.tenant_id);
  const workspaceId = trim(opts.workspace_id);
  if (!workspaceId) {
    return {
      ok: false,
      error: 'workspace_context_required',
      user_message: 'Select a workspace to browse your Cloudflare data planes.',
    };
  }

  const accts = await customerCloudflareListAccounts(env, userId, tenantId, workspaceId);
  if (!accts.ok) {
    return {
      ok: false,
      error: accts.error || 'cloudflare_not_connected',
      user_message: 'Connect Cloudflare to list D1, R2, Hyperdrive, and Vectorize.',
    };
  }

  const accountId = trim(accts.accounts?.[0]?.id);
  if (!accountId) {
    return { ok: false, error: 'account_id_required', user_message: 'No Cloudflare account found.' };
  }

  const [d1Out, r2Out, hdOut, vxOut, workspaceSets] = await Promise.all([
    customerCloudflareListD1(env, userId, accountId, tenantId, workspaceId),
    customerCloudflareListR2(env, userId, accountId, tenantId, workspaceId),
    customerCloudflareListHyperdrive(env, userId, accountId, tenantId, workspaceId),
    customerCloudflareListVectorize(env, userId, accountId, tenantId, workspaceId),
    resolveWorkspaceBindingSets(env, workspaceId),
  ]);

  const boundD1Ids = workspaceSets.d1Ids;
  const boundR2Names = workspaceSets.r2Names;
  const boundHyperdriveIds = new Set();
  const boundVectorizeNames = new Set();

  const d1 = (d1Out.ok && Array.isArray(d1Out.databases) ? d1Out.databases : []).map((db) => {
    const id = trim(db.uuid || db.id);
    const name = trim(db.name);
    return {
      name,
      id,
      bound: id ? boundD1Ids.has(id) : false,
    };
  }).filter((row) => row.name);

  const r2 = (r2Out.ok && Array.isArray(r2Out.buckets) ? r2Out.buckets : []).map((b) => {
    const name = trim(b.name);
    return {
      name,
      bound: name ? boundR2Names.has(normLower(name)) : false,
    };
  }).filter((row) => row.name);

  const hyperdrive = (hdOut.ok && Array.isArray(hdOut.configs) ? hdOut.configs : []).map((cfg) => {
    const id = trim(cfg.id);
    const name = trim(cfg.name) || id;
    return {
      id,
      name,
      bound: id ? boundHyperdriveIds.has(id) : false,
    };
  }).filter((row) => row.id || row.name);

  const vectorize = (vxOut.ok && Array.isArray(vxOut.indexes) ? vxOut.indexes : []).map((idx) => {
    const name = trim(idx.name);
    return {
      name,
      description: trim(idx.description) || null,
      bound: name ? boundVectorizeNames.has(normLower(name)) : false,
    };
  }).filter((row) => row.name);

  return {
    ok: true,
    account_id_mask: accountId.length > 8 ? `${accountId.slice(0, 4)}…${accountId.slice(-4)}` : accountId,
    workspace_id: workspaceId,
    d1,
    r2,
    hyperdrive,
    vectorize,
    counts: {
      d1: d1.length,
      r2: r2.length,
      hyperdrive: hyperdrive.length,
      vectorize: vectorize.length,
    },
  };
}
