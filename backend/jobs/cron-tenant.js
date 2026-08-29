import { platformTenantIdFromEnv } from '../identity/users/tenant.js';
import { resolveIamSystemActor } from '../identity/system-actor.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/** Optional Workers `TENANT_ID` override (local dev / scripts). Production resolves from IAM service identity. */
export function cronTenantId(env) {
  return platformTenantIdFromEnv(env) || null;
}

/** Optional Workers `WORKSPACE_ID` override (local dev / scripts). */
export function cronWorkspaceId(env) {
  for (const key of ['WORKSPACE_ID', 'DEFAULT_WORKSPACE_ID', 'IAM_WORKSPACE_ID', 'D1_WORKSPACE_ID']) {
    const v = env?.[key] != null ? String(env[key]).trim() : '';
    if (v) return v;
  }
  return null;
}

/**
 * @param {any} env
 * @param {{ userId?: string|null, email?: string|null }} [owner]
 */
async function resolveOwnerActorFields(env, owner = null) {
  const userId = trim(owner?.userId);
  if (!userId || !env?.DB) return null;

  const row = await env.DB.prepare(
    `SELECT id, email, tenant_id, active_tenant_id, active_workspace_id, default_workspace_id,
            account_type, COALESCE(iam_owned, 0) AS iam_owned, status
       FROM auth_users
      WHERE id = ?
      LIMIT 1`,
  )
    .bind(userId)
    .first()
    .catch(() => null);

  if (!row?.id) return null;
  return {
    authUserId: trim(row.id),
    email: trim(row.email) || null,
    tenantId: trim(row.active_tenant_id) || trim(row.tenant_id) || null,
    workspaceId: trim(row.active_workspace_id) || trim(row.default_workspace_id) || null,
  };
}

/**
 * @param {any} env
 * @param {{ userId?: string|null, email?: string|null }} [owner]
 */
export async function resolveCronWorkspaceId(env, owner = null) {
  const fromEnv = cronWorkspaceId(env);
  if (fromEnv) return fromEnv;

  const ownerActor = await resolveOwnerActorFields(env, owner);
  if (ownerActor?.workspaceId) return ownerActor.workspaceId;

  const actor = await resolveIamSystemActor(env);
  if (actor?.workspaceId) return actor.workspaceId;

  return null;
}

/**
 * @param {any} env
 * @param {{ userId?: string|null, email?: string|null }} [owner]
 */
export async function resolveCronTenantId(env, owner = null) {
  const fromEnv = cronTenantId(env);
  if (fromEnv) return fromEnv;

  const ownerActor = await resolveOwnerActorFields(env, owner);
  if (ownerActor?.tenantId) return ownerActor.tenantId;

  const actor = await resolveIamSystemActor(env);
  if (actor?.tenantId) return actor.tenantId;

  if (env?.DB && owner?.email) {
    const row = await env.DB.prepare(
      `SELECT COALESCE(NULLIF(TRIM(active_tenant_id), ''), NULLIF(TRIM(tenant_id), '')) AS tid
       FROM auth_users WHERE LOWER(email) = LOWER(?) LIMIT 1`,
    )
      .bind(String(owner.email).trim())
      .first()
      .catch(() => null);
    if (row?.tid) return String(row.tid).trim();
  }

  const workspaceId = await resolveCronWorkspaceId(env, owner);
  if (env?.DB && workspaceId) {
    const ws = await env.DB.prepare(
      `SELECT tenant_id FROM agentsam_workspace WHERE id = ? LIMIT 1`,
    )
      .bind(workspaceId)
      .first()
      .catch(() => null);
    if (ws?.tenant_id) return String(ws.tenant_id).trim();
  }

  return 'system';
}
