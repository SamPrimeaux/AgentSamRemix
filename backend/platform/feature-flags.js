/**
 * Feature flags from D1 — gates rollout, environment, expiry, and tenant/user allowlists.
 */

export async function isFeatureEnabled(env, flagKey, { userId, tenantId } = {}) {
  if (!env?.DB || !flagKey) return false;
  try {
    const row = await env.DB.prepare(
      `
      SELECT enabled_globally, enabled_for_users, enabled_for_tenants,
             rollout_pct, environment, expires_at, is_archived
      FROM agentsam_feature_flag
      WHERE flag_key = ? AND COALESCE(is_archived, 0) = 0
      LIMIT 1
    `,
    )
      .bind(flagKey)
      .first();

    if (!row) return await isFeatureEnabledFallback(env, flagKey, { userId, tenantId });

    if (row.expires_at != null && Number(row.expires_at) < Math.floor(Date.now() / 1000)) {
      return false;
    }

    const environment = env.ENVIRONMENT || 'production';
    const rowEnvironment = row.environment != null ? String(row.environment) : 'all';
    if (rowEnvironment !== 'all' && rowEnvironment !== environment) return false;

    if (Number(row.enabled_globally) === 1) return true;

    const uid = userId != null ? String(userId).trim() : '';
    if (uid) {
      const override = await env.DB.prepare(
        `SELECT enabled FROM agentsam_user_feature_override
         WHERE user_id = ? AND flag_key = ? LIMIT 1`,
      )
        .bind(uid, flagKey)
        .first()
        .catch(() => null);
      if (override != null) return Number(override.enabled) === 1;
    }

    if (userId) {
      try {
        const users = JSON.parse(row.enabled_for_users || '[]');
        if (Array.isArray(users) && users.includes(userId)) return true;
      } catch {
        /* ignore malformed allowlists */
      }
    }

    if (tenantId) {
      try {
        const tenants = JSON.parse(row.enabled_for_tenants || '[]');
        if (Array.isArray(tenants) && tenants.includes(tenantId)) return true;
      } catch {
        /* ignore malformed allowlists */
      }
    }

    if (Number(row.rollout_pct) > 0 && userId) {
      let hash = 0;
      const value = userId + flagKey;
      for (let i = 0; i < value.length; i++) {
        hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
      }
      if ((hash % 100) < Number(row.rollout_pct)) return true;
    }
    return false;
  } catch {
    return isFeatureEnabledFallback(env, flagKey, { userId, tenantId });
  }
}

/** When extended columns are missing, fall back to global bit + per-user override table. */
async function isFeatureEnabledFallback(env, flagKey, { userId, tenantId } = {}) {
  void tenantId;
  try {
    const row = await env.DB.prepare(
      `SELECT enabled_globally FROM agentsam_feature_flag WHERE flag_key = ? LIMIT 1`,
    )
      .bind(flagKey)
      .first();
    if (!row) return false;
    if (Number(row.enabled_globally) === 1) return true;

    const uid = userId != null ? String(userId).trim() : '';
    if (!uid) return false;
    const override = await env.DB.prepare(
      `SELECT enabled FROM agentsam_user_feature_override
       WHERE user_id = ? AND flag_key = ? LIMIT 1`,
    )
      .bind(uid, flagKey)
      .first()
      .catch(() => null);
    return override != null && Number(override.enabled) === 1;
  } catch {
    return false;
  }
}
