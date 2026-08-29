/**
 * Cloudflare API token resolution — OAuth first, then user_secrets BYOK.
 * No user_api_keys.
 */
import {
  finalizeCloudflareAccountForToken,
  maskAccountId,
} from '../../../src/core/workspace-cloudflare-credentials.js';
import { getDefaultWorkspaceDataBinding } from '../../../src/core/workspace-data-bindings.js';
import {
  getIntegrationOAuthRow,
} from '../../identity/oauth/user-token.js';
import { healCloudflareOAuthAccountIfNeeded, looksLikeCfAccountId } from '../../../src/core/cf-token-account.js';
import {
  decryptUserSecretPlaintext,
  getUserSecretScoped,
  listUserSecrets,
  parseSecretMetadata,
} from '../user-secret-store.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @param {any} env
 * @param {string} userId
 */
async function loadCloudflareByokSecret(env, userId) {
  if (!env?.DB || !userId) return null;
  return env.DB.prepare(
    `SELECT id, secret_value_encrypted, metadata_json, service_name
       FROM user_secrets
      WHERE user_id = ?
        AND LOWER(COALESCE(service_name, '')) = 'cloudflare'
        AND COALESCE(is_active, 1) = 1
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1`,
  )
    .bind(userId)
    .first()
    .catch(() => null);
}

/**
 * @param {any} env
 * @param {{ userId: string, tenantId?: string|null, workspaceId?: string|null }} scope
 */
export async function resolveUserCloudflareCredential(env, scope = {}) {
  const userId = trim(scope.userId ?? scope.user_id);
  const workspaceId = trim(scope.workspaceId ?? scope.workspace_id);
  if (!userId) {
    return { ok: false, error: 'missing_user_id', token: null, account_id: null, secret_id: null };
  }

  const binding = workspaceId
    ? await getDefaultWorkspaceDataBinding(env, workspaceId, 'cloudflare')
    : null;
  const bindingId = binding?.id != null ? String(binding.id) : null;
  const workspaceHint = trim(binding?.external_account_id) || null;

  const oauthRow = await getIntegrationOAuthRow(env, userId, 'cloudflare');
  const oauthToken = oauthRow?.access_token ? trim(oauthRow.access_token) : null;
  if (oauthToken) {
    let oauthHint = null;
    const fromId = trim(oauthRow?.account_identifier);
    if (looksLikeCfAccountId(fromId)) oauthHint = fromId;
    if (!oauthHint && oauthRow?.metadata_json) {
      try {
        const meta = JSON.parse(String(oauthRow.metadata_json));
        oauthHint = trim(meta.cloudflare_account_id) || trim(meta.account_id) || null;
      } catch {
        oauthHint = null;
      }
    }
    if (!oauthHint) {
      oauthHint = await healCloudflareOAuthAccountIfNeeded(env, userId, oauthToken, oauthRow);
    }
    const finalized = await finalizeCloudflareAccountForToken(oauthToken, oauthHint || workspaceHint);
    if (finalized.ok) {
      return {
        ok: true,
        token: oauthToken,
        account_id: finalized.account_id,
        account_mask: maskAccountId(finalized.account_id),
        secret_id: null,
        binding_id: bindingId,
        credential_source: 'oauth',
      };
    }
  }

  const row = await loadCloudflareByokSecret(env, userId);
  if (!row) {
    return {
      ok: false,
      error: 'cloudflare_key_missing',
      token: null,
      account_id: null,
      secret_id: null,
      binding_id: bindingId,
    };
  }

  const meta = parseSecretMetadata(row);
  const byokHint = trim(meta.cloudflare_account_id) || workspaceHint || null;
  const plain = await decryptUserSecretPlaintext(env, {
    userId,
    tenantId: trim(scope.tenantId ?? scope.tenant_id),
    secretId: String(row.id),
  });
  const token = typeof plain === 'string' ? plain : null;
  if (!token) {
    return {
      ok: false,
      error: 'cloudflare_token_decrypt_failed',
      token: null,
      account_id: null,
      secret_id: String(row.id),
      binding_id: bindingId,
    };
  }

  const finalized = await finalizeCloudflareAccountForToken(token, byokHint);
  if (!finalized.ok) {
    return {
      ok: false,
      error: finalized.error || 'cloudflare_account_id_missing',
      token: null,
      account_id: null,
      secret_id: String(row.id),
      binding_id: bindingId,
    };
  }

  return {
    ok: true,
    token,
    account_id: finalized.account_id,
    account_mask: maskAccountId(finalized.account_id),
    secret_id: String(row.id),
    binding_id: bindingId,
    credential_source: 'byok',
  };
}

export { listUserSecrets };
