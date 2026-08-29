/**
 * Platform-owner R2 access — bucket allowlist from D1 registry only.
 * Tables: r2_bucket_list, r2_bucket_bindings, project_storage (storage_type r2).
 * Platform operators may use Worker bindings when present, otherwise account S3 credentials.
 * Non-operators remain blocked from auth_source=platform R2 paths.
 */
export {
  userMayUseWorkspaceCredentials,
  resolveGrantAuthUserRow,
} from '../../backend/identity/workspace/grants.js';

/**
 * @param {any} env
 * @returns {Promise<Map<string, string>>} lowercase name → canonical name
 */
export async function loadR2BucketRegistry(env) {
  /** @type {Map<string, string>} */
  const byLower = new Map();

  const add = (name) => {
    const canonical = String(name || '').trim();
    if (!canonical) return;
    byLower.set(canonical.toLowerCase(), canonical);
  };

  if (env?.DB) {
    try {
      const { results: listRows } = await env.DB.prepare(
        `SELECT bucket_name AS name FROM r2_bucket_list
          WHERE bucket_name IS NOT NULL AND trim(bucket_name) != ''`,
      ).all();
      for (const row of listRows || []) add(row.name);

      const { results: bindingRows } = await env.DB.prepare(
        `SELECT DISTINCT r2_bucket AS name FROM r2_bucket_bindings
          WHERE r2_bucket IS NOT NULL AND trim(r2_bucket) != ''`,
      ).all();
      for (const row of bindingRows || []) add(row.name);

      const { results: storageRows } = await env.DB.prepare(
        `SELECT storage_name, storage_id FROM project_storage
          WHERE lower(storage_type) = 'r2'
            AND COALESCE(lower(status), 'active') = 'active'`,
      ).all();
      for (const row of storageRows || []) {
        add(row.storage_id);
        add(row.storage_name);
      }
    } catch (_) {}
  }

  try {
    const { listBoundR2BucketNames } = await import('../api/r2-api.js');
    for (const name of listBoundR2BucketNames(env)) add(name);
  } catch (_) {}

  return byLower;
}

/**
 * Resolve a bucket param against D1 registry (case-insensitive). Binding labels
 * (e.g. DASHBOARD) are resolved via r2-api when they map to a registered name.
 * @param {any} env
 * @param {string} raw
 */
export async function resolveRegisteredR2BucketName(env, raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';

  const registry = await loadR2BucketRegistry(env);
  const direct = registry.get(trimmed.toLowerCase());
  if (direct) return direct;

  try {
    const { resolveR2BucketName } = await import('../api/r2-api.js');
    const mapped = resolveR2BucketName(env, trimmed);
    if (mapped) {
      const hit = registry.get(String(mapped).toLowerCase());
      if (hit) return hit;
    }
  } catch (_) {}

  return trimmed;
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} runContext
 */
export async function resolveToolRunAuthUser(env, runContext) {
  const existing = runContext?.authUser ?? runContext?.user ?? null;
  const userId = String(
    runContext?.userId ?? runContext?.user_id ?? existing?.id ?? '',
  ).trim();
  if (!userId || !env?.DB) return existing;

  if (existing?.id) return existing;

  try {
    const row = await env.DB.prepare(
      `SELECT id, email, tenant_id, active_workspace_id, active_tenant_id
         FROM auth_users
        WHERE id = ?
        LIMIT 1`,
    )
      .bind(userId)
      .first();
    if (!row?.id) return existing;
    return { ...(existing && typeof existing === 'object' ? existing : {}), ...row };
  } catch {
    return existing;
  }
}

/**
 * @param {any} env
 * @param {string} bucketOrBinding
 */
export async function assertOwnerPlatformR2Bucket(env, bucketOrBinding) {
  const normalized = await resolveRegisteredR2BucketName(env, bucketOrBinding);
  if (!normalized) {
    return { ok: false, error: 'bucket_required', bucket: '' };
  }
  const registry = await loadR2BucketRegistry(env);
  const canonical = registry.get(normalized.toLowerCase());
  if (canonical) return { ok: true, bucket: canonical };

  const preview = [...registry.values()].sort((a, b) => a.localeCompare(b)).slice(0, 32);
  return {
    ok: false,
    error: 'platform_r2_bucket_not_registered',
    bucket: normalized,
    allowed_preview: preview,
    user_message:
      'Bucket is not in D1 R2 registry (r2_bucket_list, r2_bucket_bindings, or project_storage). Register the bucket in D1 first.',
  };
}

/**
 * @param {any} env
 * @param {string} bucketName
 */
export async function ownerHasPlatformR2Transport(env, bucketName) {
  try {
    const { getR2Binding } = await import('../api/r2-api.js');
    if (getR2Binding(env, bucketName)) return { ok: true, via: 'binding' };
  } catch (_) {}

  if (env?.R2_ACCESS_KEY_ID && env?.R2_SECRET_ACCESS_KEY && getR2S3Host(env)) {
    return { ok: true, via: 's3' };
  }

  return {
    ok: false,
    via: null,
    user_message:
      'No Worker binding for this bucket and platform R2 S3 credentials are not configured.',
  };
}

function getR2S3Host(env) {
  const id = env?.CLOUDFLARE_ACCOUNT_ID != null ? String(env.CLOUDFLARE_ACCOUNT_ID).trim() : '';
  return id ? `${id}.r2.cloudflarestorage.com` : null;
}
