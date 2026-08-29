/**
 * Per-user Cloudflare R2 S3 credentials — user_secrets bundle (compat path).
 * Canonical implementation: backend/credentials/cloudflare/r2-credentials.js
 */
import { fetchAuthUserTenantId } from './auth.js';
import {
  getUserR2Summary,
  loadUserR2Credentials,
  saveUserR2Credentials,
} from '../../backend/credentials/cloudflare/r2-credentials.js';
import { updateUserSecretMetadata } from '../../backend/credentials/user-secret-store.js';

/** Last 6 characters for display / r2_access_key_id preview column. */
export function r2AccessKeyPreview(fullAccessKeyId) {
  const s = String(fullAccessKeyId || '').trim();
  if (s.length <= 6) return s;
  return s.slice(-6);
}

/**
 * Load decrypted Cloudflare R2 API credentials for a user (active bundle).
 * @returns {Promise<{ accessKeyId: string, secretAccessKey: string, cfAccountId: string } | null>}
 */
export async function loadUserCloudflareR2Credentials(env, userId) {
  const creds = await loadUserR2Credentials(env, userId);
  if (!creds?.accessKeyId || !creds.secretAccessKey) return null;
  return {
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    cfAccountId: creds.cfAccountId || '',
  };
}

/**
 * Merge user R2 S3 credentials into env for SigV4 calls.
 * Users without BYOK rows do not inherit Worker env R2 secrets.
 */
export async function mergeR2S3EnvFromUserStorage(env, authUser) {
  if (!env) return env;
  const userCreds = authUser?.id ? await loadUserCloudflareR2Credentials(env, authUser.id) : null;
  if (userCreds) {
    return {
      ...env,
      R2_ACCESS_KEY_ID: userCreds.accessKeyId,
      R2_SECRET_ACCESS_KEY: userCreds.secretAccessKey,
      CLOUDFLARE_ACCOUNT_ID: userCreds.cfAccountId || env.CLOUDFLARE_ACCOUNT_ID,
    };
  }
  return {
    ...env,
    R2_ACCESS_KEY_ID: undefined,
    R2_SECRET_ACCESS_KEY: undefined,
  };
}

/**
 * Upsert Cloudflare R2 credentials for the authenticated user.
 */
export async function upsertUserCloudflareR2Keys(
  env,
  { userId, tenantId, personUuid, cfAccountId, r2AccessKeyId, r2SecretAccessKey },
) {
  void personUuid;
  let tid = String(tenantId || '').trim();
  if (!tid) tid = (await fetchAuthUserTenantId(env, userId)) || `user:${userId}`;

  const out = await saveUserR2Credentials(env, {
    userId,
    tenantId: tid,
    workspaceId: null,
    cfAccountId,
    accessKeyId: r2AccessKeyId,
    secretAccessKey: r2SecretAccessKey,
    bucket: null,
    validateOnCreate: false,
  });
  if (!out.ok) {
    throw new Error(out.message || out.error || 'Could not save R2 credentials');
  }

  const secretId = out.secretId || out.item?.id;
  return {
    id: secretId,
    cf_account_id: cfAccountId,
    r2_access_key_id_preview: r2AccessKeyPreview(r2AccessKeyId),
    access_key_registry: null,
  };
}

/**
 * Active R2 key row summary for dashboard (no secret material).
 * @returns {Promise<object|null>}
 */
export async function getUserCloudflareR2KeySummary(env, userId) {
  const r2 = await getUserR2Summary(env, userId);
  if (!r2) return null;

  return {
    id: r2.id,
    provider: 'cloudflare_r2',
    status: r2.status || 'active',
    cf_account_id: r2.cf_account_id,
    r2_access_key_id_preview: r2.r2_access_key_id_preview,
    validated_at: r2.validated_at != null ? Number(r2.validated_at) : null,
    validation_status:
      r2.validated_at != null ? 'pass' : null,
    created_at: r2.created_at != null ? Number(r2.created_at) : null,
    configured: true,
  };
}

/**
 * Persist validation outcome on the active R2 user_secrets bundle.
 */
export async function markUserCloudflareR2Validated(env, userId, { ok, checks }) {
  void checks;
  const uid = String(userId || '').trim();
  if (!uid || !env?.DB) return;

  const summary = await getUserR2Summary(env, uid);
  if (!summary?.id) return;

  let tenantId = (await fetchAuthUserTenantId(env, uid)) || '';
  await updateUserSecretMetadata(env, {
    userId: uid,
    tenantId,
    secretId: String(summary.id),
    patchMeta: {
      validated_at: Math.floor(Date.now() / 1000),
      validation_status: ok ? 'pass' : 'fail',
    },
  });
}
