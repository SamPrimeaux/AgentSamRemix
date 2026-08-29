/**
 * Integration ↔ BYOK spine: API keys land in user_secrets (same path as Keys & Secrets).
 */
import { fetchAuthUserTenantId, fallbackSystemTenantId } from './auth.js';
import { handleKeySecurityAfterOp } from './keys-security.js';
import { validateProviderKey, normalizeApiKeySecret } from './secret-validators.js';
import { resolveIntegrationUserId } from '../../backend/identity/oauth/integration-user-id.js';
import {
  buildProviderKeyMetadata,
  createUserSecret,
  lastFourOfSecret,
  newSecretId,
  providerSecretName,
  revokeUserSecret,
  rotateUserSecretValue,
  updateUserSecretMetadata,
} from '../../backend/credentials/user-secret-store.js';

/** integration_catalog / integration_registry provider_key → BYOK provider slug */
export const INTEGRATION_TO_BYOK_PROVIDER = {
  openai: 'openai',
  anthropic: 'anthropic',
  google_ai: 'google',
  resend: 'resend',
  cursor: 'cursor',
  supabase: 'supabase',
  claude_code: 'anthropic',
};

const API_KEY_INTEGRATION_SLUGS = new Set(Object.keys(INTEGRATION_TO_BYOK_PROVIDER));

export function normalizeIntegrationSlug(slug) {
  return String(slug || '').trim().toLowerCase().replace(/-/g, '_');
}

export function integrationRegistryProviderKey(slug) {
  return normalizeIntegrationSlug(slug);
}

export function integrationSlugToByokProvider(slug) {
  const key = integrationRegistryProviderKey(slug);
  return INTEGRATION_TO_BYOK_PROVIDER[key] || null;
}

export function isApiKeyIntegrationSlug(slug) {
  return API_KEY_INTEGRATION_SLUGS.has(integrationRegistryProviderKey(slug));
}

async function resolveTenantId(env, authUser, userId) {
  let tenantId =
    authUser?.tenant_id != null && String(authUser.tenant_id).trim() !== ''
      ? String(authUser.tenant_id).trim()
      : '';
  if (!tenantId && userId) {
    tenantId = String((await fetchAuthUserTenantId(env, userId)) || '').trim();
  }
  if (!tenantId && env?.TENANT_ID) tenantId = String(env.TENANT_ID).trim();
  if (!tenantId) tenantId = fallbackSystemTenantId(env);
  return tenantId;
}

function legacyOauthProvidersForIntegration(slug) {
  const key = integrationRegistryProviderKey(slug);
  const out = new Set([key]);
  if (key === 'google_ai') out.add('google');
  if (key === 'supabase') out.add('supabase_management');
  return [...out];
}

async function deleteLegacyOauthApiKeyTokens(db, userId, integrationSlug) {
  for (const p of legacyOauthProvidersForIntegration(integrationSlug)) {
    try {
      await db
        .prepare(`DELETE FROM user_oauth_tokens WHERE user_id = ? AND LOWER(provider) = LOWER(?)`)
        .bind(userId, p)
        .run();
    } catch {
      /* ignore */
    }
  }
}

async function findProviderSecret(env, tenantId, userId, provider) {
  if (!env?.DB) return null;
  return env.DB.prepare(
    `SELECT id, metadata_json
       FROM user_secrets
      WHERE user_id = ?
        AND COALESCE(is_active, 1) = 1
        AND (tenant_id IS NULL OR tenant_id = '' OR tenant_id = ?)
        AND (
          LOWER(COALESCE(service_name, '')) = LOWER(?)
          OR LOWER(COALESCE(json_extract(metadata_json, '$.provider'), '')) = LOWER(?)
        )
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1`,
  )
    .bind(userId, tenantId, provider, provider)
    .first()
    .catch(() => null);
}

/**
 * @returns {Promise<boolean>}
 */
export async function hasActiveByokForIntegration(env, tenantId, userId, integrationSlug) {
  if (!env?.DB || !tenantId || !userId) return false;
  const byokProvider = integrationSlugToByokProvider(integrationRegistryProviderKey(integrationSlug));
  if (!byokProvider) return false;
  const row = await findProviderSecret(env, tenantId, userId, byokProvider);
  return !!row?.id;
}

/**
 * Upsert provider API key from Integrations UI (canonical BYOK spine).
 */
export async function upsertIntegrationByokKey(env, authUser, integrationSlug, apiKey, opts = {}) {
  const db = env?.DB;
  if (!db) throw new Error('DB not configured');

  const registryKey = integrationRegistryProviderKey(integrationSlug);
  let byokProvider = integrationSlugToByokProvider(registryKey);
  if (!byokProvider && opts.allowUnknownSlug) {
    byokProvider = registryKey;
  }
  if (!byokProvider) throw new Error('unsupported_provider');

  const userId = await resolveIntegrationUserId(env, authUser);
  if (!userId) throw new Error('User id required');

  const tenantId = await resolveTenantId(env, authUser, userId);
  const normalizedKey = normalizeApiKeySecret(apiKey);
  if (!normalizedKey) throw new Error('api_key required');

  const validate = opts.validate !== false && integrationSlugToByokProvider(registryKey) != null;
  if (validate) {
    const vr = await validateProviderKey(byokProvider, normalizedKey, env, {});
    if (!vr.ok) throw new Error(vr.error || 'Invalid API key — check and retry');
  }

  const last_four = lastFourOfSecret(normalizedKey);
  const effectiveLabel =
    String(opts.label || '').trim() ||
    (registryKey === 'google_ai' ? 'Google AI' : registryKey.replace(/_/g, ' '));

  const existing = await findProviderSecret(env, tenantId, userId, byokProvider);
  const secretId = existing?.id ? String(existing.id) : newSecretId();
  const metadata = buildProviderKeyMetadata({
    provider: byokProvider,
    label: effectiveLabel,
    lastFour: last_four,
    category: 'provider',
    validated: validate,
  });
  metadata.integration_slug = registryKey;
  metadata.source = opts.source || 'integrations';

  if (existing?.id) {
    await rotateUserSecretValue(env, {
      userId,
      tenantId,
      secretId,
      plaintext: normalizedKey,
    });
    await updateUserSecretMetadata(env, {
      userId,
      tenantId,
      secretId,
      patchMeta: metadata,
      description: effectiveLabel,
    });
  } else {
    await createUserSecret(env, {
      userId,
      tenantId,
      secretId,
      serviceName: byokProvider,
      secretName: providerSecretName(secretId, byokProvider),
      secretType: 'api_key',
      description: effectiveLabel,
      plaintext: normalizedKey,
      metadata,
    });
  }

  await handleKeySecurityAfterOp(env, {
    operation: existing?.id ? 'rotate' : 'create',
    secretId,
    tenantId,
    userId,
    workspaceId: null,
    provider: byokProvider,
    plaintextKey: normalizedKey,
    encryptOk: true,
    newLast4: last_four,
    triggeredBy: opts.triggeredBy || 'integrations_connect',
    notes: `${existing?.id ? 'Rotated' : 'Connected'} integration key (${registryKey})`,
  });

  await deleteLegacyOauthApiKeyTokens(db, userId, registryKey);

  const accountDisplay = `••••${last_four}`;
  try {
    await db
      .prepare(
        `UPDATE integration_registry
         SET status = 'connected', account_display = ?, updated_at = datetime('now')
         WHERE tenant_id = ? AND LOWER(provider_key) = LOWER(?)`,
      )
      .bind(accountDisplay, tenantId, registryKey)
      .run();
  } catch {
    /* registry row may be missing until seed */
  }

  return {
    ok: true,
    api_key_id: secretId,
    provider: byokProvider,
    integration_slug: registryKey,
    account_display: accountDisplay,
  };
}

/**
 * Revoke BYOK row for an integration slug and mark registry disconnected.
 */
export async function revokeIntegrationByokKey(env, authUser, integrationSlug) {
  const db = env?.DB;
  if (!db) return { ok: false, error: 'DB not configured' };

  const registryKey = integrationRegistryProviderKey(integrationSlug);
  const byokProvider = integrationSlugToByokProvider(registryKey);
  const userId = await resolveIntegrationUserId(env, authUser);
  if (!userId) return { ok: false, error: 'User id required' };

  const tenantId = await resolveTenantId(env, authUser, userId);

  if (byokProvider) {
    const row = await findProviderSecret(env, tenantId, userId, byokProvider);
    if (row?.id) {
      await revokeUserSecret(env, { userId, secretId: String(row.id) });
    }
  }

  await deleteLegacyOauthApiKeyTokens(db, userId, registryKey);

  try {
    await db
      .prepare(
        `UPDATE integration_registry
         SET status = 'disconnected', account_display = NULL, updated_at = datetime('now')
         WHERE tenant_id = ? AND LOWER(provider_key) = LOWER(?)`,
      )
      .bind(tenantId, registryKey)
      .run();
  } catch {
    /* ignore */
  }

  return { ok: true, integration_slug: registryKey };
}
