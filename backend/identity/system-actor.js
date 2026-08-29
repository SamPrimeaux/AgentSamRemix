/**
 * IAM system/cron actor — resolved from auth_users (iam_owned service identity).
 * Cache lane: MCP_TOKENS (env.KV) — agent authority, not SESSION_CACHE.
 */
import { isIamServiceIdentity, loadAuthUserById } from './users/index.js';

/** SSOT key — mirrored in backend/services/bootstrap/kv-keys.js */
const CACHE_KEY = 'iam:mcp:system-actor:v1';
const CACHE_TTL_SEC = 300;

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/** MCP_TOKENS binding — never SESSION_CACHE for agent/system actor. */
function agentKv(env) {
  return env?.KV || null;
}

function pickWorkspaceId(row) {
  return trim(row?.active_workspace_id) || trim(row?.default_workspace_id) || '';
}

function pickTenantId(row) {
  return trim(row?.active_tenant_id) || trim(row?.tenant_id) || '';
}

/**
 * @param {Record<string, unknown>|null|undefined} row
 */
export function mapAuthUserToSystemActor(row) {
  if (!row || !isIamServiceIdentity(row)) return null;
  const authUserId = trim(row.id);
  if (!authUserId) return null;
  return {
    authUserId,
    email: trim(row.email) || null,
    tenantId: pickTenantId(row) || null,
    workspaceId: pickWorkspaceId(row) || null,
    accountType: trim(row.account_type) || null,
  };
}

/**
 * @param {any} env
 */
async function queryIamServiceActorFromD1(env) {
  if (!env?.DB) return null;
  const { results } = await env.DB.prepare(
    `SELECT id, email, name, display_name, tenant_id, role,
            account_type, identity_label,
            COALESCE(iam_owned, 0) AS iam_owned,
            COALESCE(downgrade_protected, 0) AS downgrade_protected,
            default_workspace_id, active_workspace_id, active_tenant_id,
            status, supabase_user_id, user_key
       FROM auth_users
      WHERE COALESCE(iam_owned, 0) = 1
        AND LOWER(COALESCE(account_type, '')) IN ('agent', 'service', 'system')
        AND (status IS NULL OR TRIM(status) = '' OR LOWER(status) = 'active')
      ORDER BY CASE LOWER(COALESCE(account_type, ''))
                 WHEN 'agent' THEN 0
                 WHEN 'service' THEN 1
                 ELSE 2
               END,
               id ASC
      LIMIT 8`,
  )
    .all()
    .catch(() => ({ results: [] }));

  for (const row of results || []) {
    const actor = mapAuthUserToSystemActor(row);
    if (actor) return actor;
  }
  return null;
}

/**
 * @param {any} kv
 * @param {{ authUserId: string, email?: string|null, tenantId?: string|null, workspaceId?: string|null, accountType?: string|null }} actor
 */
async function writeSystemActorCache(kv, actor) {
  if (!kv || !actor?.authUserId) return;
  try {
    await kv.put(CACHE_KEY, JSON.stringify(actor), { expirationTtl: CACHE_TTL_SEC });
  } catch (e) {
    console.warn('[system-actor] cache write', e?.message ?? e);
  }
}

/**
 * @param {any} env
 * @param {{ forceRefresh?: boolean }} [opts]
 */
export async function resolveIamSystemActor(env, opts = {}) {
  const forceRefresh = opts.forceRefresh === true;
  const kv = agentKv(env);

  if (!forceRefresh && kv) {
    try {
      const cached = await kv.get(CACHE_KEY, 'json');
      const cachedId = trim(cached?.authUserId);
      if (cachedId) {
        const row = await loadAuthUserById(env, cachedId);
        const actor = mapAuthUserToSystemActor(row);
        if (actor) return actor;
      }
    } catch (e) {
      console.warn('[system-actor] cache read', e?.message ?? e);
    }
  }

  const actor = await queryIamServiceActorFromD1(env);
  if (!actor) return null;

  if (kv) await writeSystemActorCache(kv, actor);
  return actor;
}

/** @param {any} env @param {{ forceRefresh?: boolean }} [opts] */
export async function resolveIamSystemActorId(env, opts = {}) {
  const actor = await resolveIamSystemActor(env, opts);
  return actor?.authUserId || null;
}

/** @param {any} env @param {{ forceRefresh?: boolean }} [opts] */
export async function resolveIamSystemActorTenantId(env, opts = {}) {
  const actor = await resolveIamSystemActor(env, opts);
  return actor?.tenantId || null;
}

/** @param {any} env @param {{ forceRefresh?: boolean }} [opts] */
export async function resolveIamSystemActorWorkspaceId(env, opts = {}) {
  const actor = await resolveIamSystemActor(env, opts);
  return actor?.workspaceId || null;
}
