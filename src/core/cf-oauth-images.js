/**
 * CF Images upload credentials — user Cloudflare OAuth REST API first, platform token fallback.
 * SSOT for OAuth refresh: `resolveCloudflareOAuthToken` in user-oauth-token.js (single refresh path).
 * Do not re-implement dash.cloudflare.com/oauth2/token refresh here.
 */
import { resolveCloudflareOAuthToken } from '../../backend/identity/oauth/user-token.js';
import { getAgentsamWorkspace } from '../../backend/identity/workspace/agentsam-workspace.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * Access token for Cloudflare API (Images / accounts). Refreshes via canonical resolver only.
 * @returns {Promise<string|null>}
 */
export async function getCfOAuthAccessToken(env, userId) {
  const uid = trim(userId);
  if (!uid) return null;
  const resolved = await resolveCloudflareOAuthToken(env, uid, { nearExpirySeconds: 300 });
  if (!resolved?.ok || !resolved.accessToken) return null;
  return String(resolved.accessToken);
}

/**
 * @deprecated Prefer resolveCloudflareOAuthToken from user-oauth-token.js.
 * Kept as a thin alias so older imports do not double-refresh.
 */
export async function refreshCloudflareOAuthToken(env, userId, _row) {
  void _row;
  const resolved = await resolveCloudflareOAuthToken(env, trim(userId), { nearExpirySeconds: 0 });
  return resolved?.ok ? resolved.accessToken : null;
}

async function cfApiGet(token, path) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    throw new Error(data?.errors?.[0]?.message || `cloudflare_${res.status}`);
  }
  return data.result;
}

async function listCfAccounts(token) {
  const data = await cfApiGet(token, '/accounts?per_page=50');
  const accounts = Array.isArray(data) ? data : [];
  return accounts.map((a) => ({ id: trim(a?.id), name: trim(a?.name) || trim(a?.id) })).filter((a) => a.id);
}

export async function fetchCfImagesAccountHash(accountId, token) {
  const result = await cfApiGet(token, `/accounts/${encodeURIComponent(accountId)}`);
  return trim(result?.images_account_hash) || trim(result?.settings?.images_account_hash) || null;
}

async function cacheWorkspaceImagesHash(env, workspaceId, accountHash) {
  const hash = trim(accountHash);
  const wsId = trim(workspaceId);
  if (!env?.DB || !wsId || !hash) return;
  await env.DB.prepare(
    `UPDATE agentsam_workspace
        SET cloudflare_images_account_hash = ?,
            metadata_json = json_set(COALESCE(metadata_json, '{}'), '$.cloudflare_images_account_hash', ?),
            updated_at = unixepoch()
      WHERE id = ? OR workspace_ref_id = ?`,
  )
    .bind(hash, hash, wsId, wsId)
    .run()
    .catch(() => null);
}

function parseWorkspaceMetaJson(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object') return raw;
  try {
    const o = JSON.parse(String(raw));
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

function resolveWorkspaceImagesHash(wsRow, env) {
  const meta = parseWorkspaceMetaJson(wsRow?.metadata_json);
  return (
    trim(wsRow?.cloudflare_images_account_hash) ||
    trim(meta.cloudflare_images_account_hash) ||
    trim(env?.CLOUDFLARE_IMAGES_ACCOUNT_HASH) ||
    null
  );
}

function platformImagesCreds(env) {
  const accountId = trim(env?.CLOUDFLARE_ACCOUNT_ID);
  const token = trim(env.CLOUDFLARE_IMAGES_TOKEN || env.CLOUDFLARE_IMAGES_API_TOKEN || env.CLOUDFLARE_API_TOKEN);
  const accountHash = trim(env.CLOUDFLARE_IMAGES_ACCOUNT_HASH);
  if (!accountId || !token) return null;
  return { accountId, token, accountHash, iam_hosted: true, source: 'platform' };
}

export async function resolveCfImagesUploadContext(env, ctx = {}) {
  const userId = trim(ctx.userId ?? ctx.user_id);
  const workspaceId = trim(ctx.workspaceId ?? ctx.workspace_id);
  const explicitAccountId = trim(ctx.cf_account_id ?? ctx.cloudflare_account_id);

  const wsRow = workspaceId ? await getAgentsamWorkspace(env, workspaceId) : null;
  let workspaceAccountId = explicitAccountId || trim(wsRow?.cloudflare_account_id);

  const oauthResolved = userId
    ? await resolveCloudflareOAuthToken(env, userId, { nearExpirySeconds: 300 })
    : null;
  const oauthToken = oauthResolved?.ok ? oauthResolved.accessToken : null;

  if (oauthToken) {
    if (!workspaceAccountId && oauthResolved.accountId) {
      workspaceAccountId = trim(oauthResolved.accountId);
    }
    if (!workspaceAccountId) {
      const accounts = await listCfAccounts(oauthToken).catch(() => []);
      if (accounts.length === 1) workspaceAccountId = accounts[0].id;
      else if (accounts.length > 1) {
        return { ok: false, error: 'cloudflare_account_selection_required', accounts, iam_hosted: false };
      }
    }

    if (workspaceAccountId) {
      let accountHash = resolveWorkspaceImagesHash(wsRow, env);
      if (!accountHash) {
        try {
          accountHash = await fetchCfImagesAccountHash(workspaceAccountId, oauthToken);
          if (accountHash && workspaceId) await cacheWorkspaceImagesHash(env, workspaceId, accountHash);
        } catch {
          accountHash = trim(env?.CLOUDFLARE_IMAGES_ACCOUNT_HASH) || null;
        }
      }
      return {
        ok: true,
        iam_hosted: false,
        accountId: workspaceAccountId,
        token: oauthToken,
        accountHash: accountHash || null,
        source: 'oauth',
        refreshed: !!oauthResolved?.refreshed,
        expiresAt: oauthResolved?.expiresAt ?? null,
      };
    }
  }

  const platform = platformImagesCreds(env);
  if (platform) return { ok: true, ...platform };
  return {
    ok: false,
    error: oauthResolved && !oauthResolved.ok ? oauthResolved.code || 'cloudflare_oauth_unavailable' : 'cloudflare_images_not_configured',
    iam_hosted: false,
  };
}
