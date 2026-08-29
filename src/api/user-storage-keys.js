/**
 * Per-user storage credential APIs — /api/user/storage-keys/*
 * @deprecated Use POST /api/settings/keys (provider=cloudflare_r2) instead.
 */
import { getAuthUser, fetchAuthUserTenantId } from '../core/auth.js';
import { jsonResponse } from '../core/responses.js';
import { getUserCloudflareR2KeySummary, upsertUserCloudflareR2Keys } from '../core/user-storage-r2-credentials.js';

const DEPRECATION =
  'Deprecated — use POST /api/settings/keys with provider cloudflare_r2. This route will be removed.';

function deprecationHeaders() {
  return {
    Deprecation: 'true',
    Link: '</api/settings/keys>; rel="successor-version"',
    'X-IAM-Deprecation-Notice': DEPRECATION,
  };
}

/**
 * @param {Request} request
 * @param {URL} url
 * @param {*} env
 */
export async function handleUserStorageKeysApi(request, url, env) {
  const pathLower = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
  const method = (request.method || 'GET').toUpperCase();

  const authUser = await getAuthUser(request, env);
  if (!authUser?.id) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  if (pathLower === '/api/user/storage-keys/cloudflare' && method === 'GET') {
    const summary = await getUserCloudflareR2KeySummary(env, authUser.id);
    return jsonResponse(
      {
        ok: true,
        configured: Boolean(summary?.configured),
        item: summary,
        deprecation: DEPRECATION,
      },
      200,
      deprecationHeaders(),
    );
  }

  if (pathLower === '/api/user/storage-keys/cloudflare' && method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const cfAccountId = body.cf_account_id ?? body.cfAccountId;
    const r2AccessKeyId = body.r2_access_key_id ?? body.r2AccessKeyId;
    const r2SecretAccessKey = body.r2_secret_access_key ?? body.r2SecretAccessKey;

    if (!cfAccountId || !r2AccessKeyId || !r2SecretAccessKey) {
      return jsonResponse(
        { error: 'cf_account_id, r2_access_key_id, and r2_secret_access_key are required' },
        400,
      );
    }

    let tenantId = authUser.tenant_id ?? authUser.active_tenant_id ?? null;
    if (tenantId != null) tenantId = String(tenantId).trim() || null;
    if (!tenantId) tenantId = await fetchAuthUserTenantId(env, authUser.id);

    try {
      const stored = await upsertUserCloudflareR2Keys(env, {
        userId: authUser.id,
        tenantId,
        personUuid: authUser.person_uuid ?? null,
        cfAccountId: String(cfAccountId).trim(),
        r2AccessKeyId: String(r2AccessKeyId).trim(),
        r2SecretAccessKey: String(r2SecretAccessKey).trim(),
      });

      return jsonResponse(
        {
          ok: true,
          id: stored.id,
          cf_account_id: stored.cf_account_id,
          r2_access_key_id_preview: stored.r2_access_key_id_preview,
          message: 'Cloudflare R2 credentials stored (encrypted). Plaintext secret cleared.',
          deprecation: DEPRECATION,
        },
        200,
        deprecationHeaders(),
      );
    } catch (e) {
      const msg = String(e?.message || e);
      if (msg.includes('Vault encryption') || msg.includes('VAULT_MASTER_KEY')) {
        return jsonResponse({ error: 'Vault encryption not configured on Worker' }, 503);
      }
      console.error('[user-storage-keys] cloudflare POST', e);
      return jsonResponse({ error: 'Failed to store credentials', detail: msg }, 500);
    }
  }

  return jsonResponse({ error: 'Not found', deprecation: DEPRECATION }, 404, deprecationHeaders());
}
