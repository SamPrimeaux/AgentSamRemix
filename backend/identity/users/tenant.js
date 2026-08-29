/** Workers `TENANT_ID` binding — platform default tenant. */
export function platformTenantIdFromEnv(env) {
  const t = env?.TENANT_ID != null ? String(env.TENANT_ID).trim() : '';
  return t || null;
}

export function fallbackSystemTenantId(env) {
  return platformTenantIdFromEnv(env) || 'system';
}

export function resolveTelemetryTenantId(_env, explicitTenantId) {
  if (explicitTenantId != null && String(explicitTenantId).trim() !== '') {
    return String(explicitTenantId).trim();
  }
  return null;
}

export async function fetchAuthUserTenantId(env, userKey) {
  if (!env?.DB || userKey == null || String(userKey).trim() === '') return null;
  const k = String(userKey).trim();
  try {
    const u = await env.DB.prepare(
      `SELECT COALESCE(NULLIF(TRIM(active_tenant_id), ''), NULLIF(TRIM(tenant_id), '')) AS tenant_id
       FROM auth_users WHERE id = ? OR LOWER(email) = LOWER(?) LIMIT 1`,
    )
      .bind(k, k)
      .first();
    if (u && u.tenant_id != null && String(u.tenant_id).trim() !== '') {
      return String(u.tenant_id).trim();
    }
  } catch (e) {
    console.warn('[fetchAuthUserTenantId]', e?.message ?? e);
  }
  return null;
}

export async function resolveTenantAtLogin(env, userId) {
  return fetchAuthUserTenantId(env, userId);
}

export async function resolveUserEnrichment(env, authUser) {
  return authUser;
}
