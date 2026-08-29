/**
 * R2 S3 credential bundle — single user_secrets row (access + secret atomic).
 */
import { getDefaultWorkspaceDataBinding, upsertWorkspaceDataBinding } from '../../../src/core/workspace-data-bindings.js';
import { validateR2ByokCredentials } from '../../../src/core/storage-byok-test.js';
import {
  buildProviderKeyMetadata,
  createUserSecret,
  decryptUserSecretPlaintext,
  getUserSecretScoped,
  lastFourOfSecret,
  listUserSecrets,
  newSecretId,
  parseSecretMetadata,
  revokeUserSecret,
  rotateUserSecretValue,
  R2_SECRET_NAME,
  R2_SERVICE_NAME,
  toSafeSecretItem,
  updateUserSecretMetadata,
} from '../user-secret-store.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @param {any} env
 * @param {string} userId
 */
export async function findUserR2SecretRow(env, userId) {
  const items = await listUserSecrets(env, { userId, tenantId: '', categoryFilter: 'provider' });
  const hit = items.find((i) => trim(i.provider).toLowerCase() === R2_SERVICE_NAME);
  if (!hit) return null;
  return getUserSecretScoped(env, { userId, tenantId: '', secretId: hit.id });
}

/**
 * @param {any} env
 * @param {string} userId
 */
export async function loadUserR2Credentials(env, userId) {
  const row = await findUserR2SecretRow(env, userId);
  if (!row) return null;
  const bundle = await decryptUserSecretPlaintext(env, {
    userId,
    tenantId: trim(row.tenant_id),
    secretId: String(row.id),
  });
  if (!bundle || typeof bundle !== 'object') return null;
  const meta = parseSecretMetadata(row);
  return {
    secretId: String(row.id),
    cfAccountId: trim(meta.cloudflare_account_id),
    accessKeyId: trim(bundle.access_key_id),
    secretAccessKey: trim(bundle.secret_access_key),
    defaultBucket: trim(meta.default_bucket) || null,
  };
}

/**
 * @param {any} env
 * @param {object} params
 */
export async function saveUserR2Credentials(env, params) {
  const {
    userId,
    tenantId,
    workspaceId,
    cfAccountId,
    accessKeyId,
    secretAccessKey,
    bucket = null,
    validateOnCreate = false,
  } = params;

  if (validateOnCreate) {
    const check = await validateR2ByokCredentials({
      cfAccountId,
      accessKeyId,
      secretAccessKey,
      bucketName: bucket ?? undefined,
    });
    if (!check.ok) return { ok: false, error: 'validation_failed', ...check };
  }

  const secretId = newSecretId();
  const preview = lastFourOfSecret(accessKeyId);
  const metadata = {
    kind: 'credential_bundle',
    category: 'provider',
    provider: R2_SERVICE_NAME,
    label: bucket ? `Cloudflare R2 · ${bucket}` : 'Cloudflare R2',
    cloudflare_account_id: cfAccountId,
    access_key_preview: preview,
    default_bucket: bucket,
    last_four: preview,
    validation_status: validateOnCreate ? 'pass' : null,
    validated_at: validateOnCreate ? Math.floor(Date.now() / 1000) : null,
  };

  const plaintext = JSON.stringify({
    access_key_id: accessKeyId,
    secret_access_key: secretAccessKey,
  });

  const existing = await findUserR2SecretRow(env, userId);
  let row;
  if (existing) {
    row = await rotateUserSecretValue(env, {
      userId,
      tenantId,
      secretId: String(existing.id),
      plaintext,
    });
    await updateUserSecretMetadata(env, {
      userId,
      tenantId,
      secretId: String(existing.id),
      patchMeta: metadata,
      description: metadata.label,
    });
    row = await getUserSecretScoped(env, { userId, tenantId, secretId: String(existing.id) });
  } else {
    row = await createUserSecret(env, {
      userId,
      tenantId,
      secretId,
      serviceName: R2_SERVICE_NAME,
      secretName: R2_SECRET_NAME,
      secretType: 'credential',
      description: metadata.label,
      plaintext,
      metadata,
    });
  }

  if (workspaceId && bucket) {
    await upsertWorkspaceDataBinding(env, {
      id: `wsbind_r2_${String(workspaceId).replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40)}`,
      tenant_id: tenantId,
      user_id: userId,
      workspace_id: workspaceId,
      provider: 'cloudflare_r2',
      external_account_id: cfAccountId,
      byok_r2_bucket: bucket,
      display_name: metadata.label,
      selected_as_default: true,
      health_status: 'active',
      metadata_json: JSON.stringify({ source: 'settings_keys', secret_id: row?.id }),
    });
  }

  return { ok: true, item: row ? toSafeSecretItem(row) : null, secretId: row?.id };
}

export async function rotateUserR2Credentials(env, params) {
  return saveUserR2Credentials(env, { ...params, validateOnCreate: false });
}

export async function revokeUserR2Credentials(env, { userId, secretId }) {
  await revokeUserSecret(env, { userId, secretId });
  return { ok: true, revoked: true };
}

export async function validateUserR2Credentials(env, params) {
  const loaded =
    params.accessKeyId && params.secretAccessKey
      ? params
      : await loadUserR2Credentials(env, params.userId);
  if (!loaded) return { ok: false, error: 'r2_not_configured' };
  return validateR2ByokCredentials({
    cfAccountId: params.cfAccountId || loaded.cfAccountId,
    accessKeyId: params.accessKeyId || loaded.accessKeyId,
    secretAccessKey: params.secretAccessKey || loaded.secretAccessKey,
    bucketName: params.bucketName || loaded.defaultBucket || undefined,
  });
}

export async function getUserR2Summary(env, userId) {
  const row = await findUserR2SecretRow(env, userId);
  if (!row) return null;
  const meta = parseSecretMetadata(row);
  return {
    id: String(row.id),
    configured: true,
    cf_account_id: trim(meta.cloudflare_account_id),
    r2_access_key_id_preview: trim(meta.access_key_preview) || trim(meta.last_four),
    status: Number(row.is_active) === 0 ? 'revoked' : 'active',
    validated_at: meta.validated_at ?? null,
    created_at: row.created_at ?? null,
  };
}
