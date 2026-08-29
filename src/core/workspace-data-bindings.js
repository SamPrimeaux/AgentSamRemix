/**
 * Workspace BYO resource selection — SSOT is agentsam_workspace columns (d1_database_id,
 * cloudflare_account_id, byok_r2_bucket, …). Legacy agentsam_workspace_data_bindings dropped in 597.
 */

import {
  getAgentsamWorkspace,
  parseWorkspaceMetadata,
  resolveWorkspaceByokR2Bucket,
  resolveWorkspaceCloudflareAccountId,
  resolveWorkspaceDeployUrl,
} from '../../backend/identity/workspace/agentsam-workspace.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @param {any} env
 * @param {string} workspaceId
 * @param {string} provider
 */
export async function getDefaultWorkspaceDataBinding(env, workspaceId, provider) {
  const ws = trim(workspaceId);
  const prov = trim(provider).toLowerCase();
  if (!ws || !prov) return null;

  const row = await getAgentsamWorkspace(env, ws);
  if (!row) return null;

  const accountId = resolveWorkspaceCloudflareAccountId(row);
  const byokR2 = resolveWorkspaceByokR2Bucket(row);
  const deployUrl = resolveWorkspaceDeployUrl(row);
  const meta = parseWorkspaceMetadata(row.metadata_json);

  if (prov === 'cloudflare_d1' || prov === 'cloudflare') {
    const d1Id = trim(row.d1_database_id);
    if (prov === 'cloudflare_d1' && !d1Id) return null;
    return {
      id: row.id,
      workspace_id: ws,
      provider: prov,
      external_database_id: d1Id || null,
      external_account_id: accountId,
      cloudflare_account_id: accountId,
      byok_r2_bucket: byokR2,
      deploy_url: deployUrl,
      d1_binding: trim(row.d1_binding) || null,
      worker_name: trim(row.worker_name) || null,
      r2_bucket: trim(row.r2_bucket) || null,
      selected_as_default: 1,
      metadata_json: row.metadata_json,
    };
  }

  if (prov === 'cloudflare_r2') {
    if (!byokR2 && !trim(row.r2_bucket)) return null;
    return {
      id: row.id,
      workspace_id: ws,
      provider: 'cloudflare_r2',
      external_account_id: accountId,
      cloudflare_account_id: accountId,
      byok_r2_bucket: byokR2 || trim(row.r2_bucket) || null,
      deploy_url: deployUrl,
      selected_as_default: 1,
      metadata_json: row.metadata_json,
    };
  }

  if (prov === 'supabase') {
    const ref =
      trim(meta.supabase_project_ref) ||
      trim(meta.project_ref) ||
      trim(meta.external_project_ref) ||
      null;
    if (!ref) return null;
    return {
      id: row.id,
      workspace_id: ws,
      provider: 'supabase',
      external_project_ref: ref,
      external_project_id: trim(meta.supabase_project_id) || trim(meta.project_id) || null,
      external_account_id: accountId,
      cloudflare_account_id: accountId,
      deploy_url: deployUrl,
      selected_as_default: 1,
      metadata_json: row.metadata_json,
    };
  }

  return null;
}

/**
 * @param {any} env
 * @param {string} workspaceId
 * @param {string} [provider]
 */
export async function listWorkspaceDataBindings(env, workspaceId, provider = null) {
  if (provider) {
    const binding = await getDefaultWorkspaceDataBinding(env, workspaceId, provider);
    return binding ? [binding] : [];
  }
  const cf = await getDefaultWorkspaceDataBinding(env, workspaceId, 'cloudflare_d1');
  const r2 = await getDefaultWorkspaceDataBinding(env, workspaceId, 'cloudflare_r2');
  const supa = await getDefaultWorkspaceDataBinding(env, workspaceId, 'supabase');
  return [cf, r2, supa].filter(Boolean);
}

/**
 * @param {any} env
 * @param {{
 *   id: string,
 *   tenant_id: string,
 *   user_id: string,
 *   workspace_id: string,
 *   provider: string,
 *   connection_id?: string|null,
 *   external_account_id?: string|null,
 *   external_project_id?: string|null,
 *   external_project_ref?: string|null,
 *   external_database_id?: string|null,
 *   byok_r2_bucket?: string|null,
 *   deploy_url?: string|null,
 *   display_name?: string|null,
 *   selected_as_default?: boolean|number,
 *   capabilities_json?: string|null,
 *   scopes_json?: string|null,
 *   health_status?: string|null,
 *   metadata_json?: string|null,
 * }} row
 */
export async function upsertWorkspaceDataBinding(env, row) {
  if (!env?.DB) throw new Error('DB unavailable');
  const ws = String(row.workspace_id);
  const provider = String(row.provider).toLowerCase();
  const existing = (await getAgentsamWorkspace(env, ws)) || { metadata_json: '{}' };
  const meta = parseWorkspaceMetadata(existing.metadata_json);

  if (provider === 'cloudflare_d1' && row.external_database_id != null) {
    await env.DB.prepare(
      `UPDATE agentsam_workspace
          SET d1_database_id = ?, updated_at = unixepoch()
        WHERE id = ?`,
    )
      .bind(String(row.external_database_id), ws)
      .run();
  }

  if (row.external_account_id != null) {
    const acct = String(row.external_account_id);
    meta.cloudflare_account_id = acct;
    meta.account_id = acct;
    await env.DB.prepare(
      `UPDATE agentsam_workspace
          SET cloudflare_account_id = ?,
              metadata_json = json_set(
                json_set(COALESCE(metadata_json, '{}'), '$.cloudflare_account_id', ?),
                '$.account_id', ?
              ),
              updated_at = unixepoch()
        WHERE id = ?`,
    )
      .bind(acct, acct, acct, ws)
      .run();
  }

  if (row.byok_r2_bucket != null) {
    const bucket = String(row.byok_r2_bucket);
    meta.byok_r2_bucket = bucket;
    await env.DB.prepare(
      `UPDATE agentsam_workspace
          SET byok_r2_bucket = ?,
              metadata_json = json_set(COALESCE(metadata_json, '{}'), '$.byok_r2_bucket', ?),
              updated_at = unixepoch()
        WHERE id = ?`,
    )
      .bind(bucket, bucket, ws)
      .run();
  }

  if (row.deploy_url != null) {
    const url = String(row.deploy_url);
    meta.deploy_url = url;
    await env.DB.prepare(
      `UPDATE agentsam_workspace
          SET deploy_url = ?,
              metadata_json = json_set(COALESCE(metadata_json, '{}'), '$.deploy_url', ?),
              updated_at = unixepoch()
        WHERE id = ?`,
    )
      .bind(url, url, ws)
      .run();
  }

  if (provider === 'supabase') {
    if (row.external_project_ref != null) {
      meta.supabase_project_ref = String(row.external_project_ref);
      meta.project_ref = String(row.external_project_ref);
    }
    if (row.external_project_id != null) {
      meta.supabase_project_id = String(row.external_project_id);
    }
    await env.DB.prepare(
      `UPDATE agentsam_workspace
          SET metadata_json = ?, updated_at = unixepoch()
        WHERE id = ?`,
    )
      .bind(JSON.stringify(meta), ws)
      .run();
  }
}
