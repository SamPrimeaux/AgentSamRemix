/**
 * Resolve Cloudflare API token + account id for PTY / sandbox exec.
 * OAuth / BYOK via resolveWorkspaceCloudflareCredentials — no Wrangler secret bypass.
 */
import { getDefaultWorkspaceDataBinding } from './workspace-data-bindings.js';
import { resolveWorkspaceCloudflareCredentials } from './workspace-cloudflare-credentials.js';
import { loadWorkspaceSettingsJson } from '../../backend/agentsam/terminal/pty-workspace-paths.js';
import { getIntegrationOAuthRow } from '../../backend/identity/oauth/user-token.js';
import { looksLikeCfAccountId, healCloudflareOAuthAccountIfNeeded } from './cf-token-account.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

async function loadAuthUserRow(env, userId) {
  if (!env?.DB || !userId) return null;
  try {
    return await env.DB.prepare(
      `SELECT id, role, tenant_id FROM auth_users WHERE id = ? LIMIT 1`,
    )
      .bind(trim(userId))
      .first();
  } catch {
    return null;
  }
}

async function resolveWorkspaceAccountId(env, workspaceId) {
  const ws = trim(workspaceId);
  if (!ws) return null;
  const binding = await getDefaultWorkspaceDataBinding(env, ws, 'cloudflare');
  if (binding?.external_account_id) {
    return trim(binding.external_account_id) || null;
  }
  const settings = await loadWorkspaceSettingsJson(env, ws);
  return (
    trim(settings?.cf_account_id) ||
    trim(settings?.cloudflare_account_id) ||
    null
  );
}

/**
 * @param {Record<string, unknown>} env
 * @param {{ userId: string, tenantId?: string | null, workspaceId?: string | null }} scope
 */
export async function resolvePtySessionCloudflareEnv(env, scope) {
  const userId = trim(scope?.userId);
  let tenantId = trim(scope?.tenantId);
  const workspaceId = trim(scope?.workspaceId);

  if (!env?.DB || !userId) {
    return {
      ok: false,
      error: 'missing_scope',
      cloudflare_api_token: null,
      cloudflare_account_id: null,
    };
  }

  const authUser = await loadAuthUserRow(env, userId);
  if (!tenantId && authUser?.tenant_id) {
    tenantId = trim(authUser.tenant_id);
  }

  let accountId = await resolveWorkspaceAccountId(env, workspaceId);

  // Account-wide OAuth / BYOK (synced operator keys live in user_secrets).
  const byok = await resolveWorkspaceCloudflareCredentials(env, userId, tenantId, workspaceId);
  if (byok.ok && byok.token) {
    return {
      ok: true,
      error: null,
      cloudflare_api_token: trim(byok.token),
      cloudflare_account_id: accountId || trim(byok.account_id) || null,
      credential_source: byok.credential_source || 'byok',
    };
  }

  // Cloudflare OAuth row fallback.
  const oauthRow = await getIntegrationOAuthRow(env, userId, 'cloudflare');
  let token = oauthRow?.access_token ? trim(oauthRow.access_token) : null;
  if (token) {
    let oauthAccountId = null;
    const fromId = trim(oauthRow?.account_identifier);
    if (looksLikeCfAccountId(fromId)) oauthAccountId = fromId;
    if (!oauthAccountId && oauthRow?.metadata_json) {
      try {
        const meta = JSON.parse(String(oauthRow.metadata_json));
        oauthAccountId =
          trim(meta?.cloudflare_account_id) || trim(meta?.account_id) || null;
      } catch {
        oauthAccountId = null;
      }
    }
    if (!oauthAccountId) {
      oauthAccountId = await healCloudflareOAuthAccountIfNeeded(env, userId, token, oauthRow);
    }
    return {
      ok: true,
      error: null,
      cloudflare_api_token: token,
      cloudflare_account_id: accountId || oauthAccountId || null,
      credential_source: 'oauth_fallback',
    };
  }

  return {
    ok: false,
    error: 'cloudflare_credentials_missing',
    cloudflare_api_token: null,
    cloudflare_account_id: accountId,
  };
}
