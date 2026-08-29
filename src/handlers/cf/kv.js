/**
 * agentsam_kv_manage — Cloudflare Workers KV via account API (BYOK or platform token).
 * Operations: list (namespaces or keys), get, put, delete.
 */
import { cfApi } from '../../core/customer-cloudflare-dispatch.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @param {{ value?: string|null, account_id?: string|null, values?: Record<string, string> }|null|undefined} credentials
 * @param {any} env
 */
function resolveCfTokenAndAccount(credentials, env) {
  const token =
    trim(credentials?.value) ||
    trim(credentials?.values?.CLOUDFLARE_API_TOKEN) ||
    '';
  const accountId =
    trim(credentials?.account_id) ||
    trim(credentials?.values?.CLOUDFLARE_ACCOUNT_ID) ||
    trim(env?.CLOUDFLARE_ACCOUNT_ID) ||
    '';
  return { token, accountId };
}

/**
 * @param {string} token
 * @param {string} accountId
 * @param {string} namespaceId
 * @param {string} key
 */
async function kvGetValue(token, accountId, namespaceId, key) {
  const encKey = encodeURIComponent(key);
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces/${encodeURIComponent(namespaceId)}/values/${encKey}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    },
  );
  if (res.status === 404) return { ok: true, value: null, not_found: true };
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.errors?.[0]?.message || `kv_get_${res.status}`);
  }
  const text = await res.text();
  return { ok: true, value: text, not_found: false };
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} input
 * @param {{ workspaceId?: string|null, tenantId?: string|null, userId?: string|null }} scope
 * @param {{ value?: string|null, account_id?: string|null, auth_source?: string }|null|undefined} credentials
 */
export async function handleCfKvManage(env, input, scope = {}, credentials = null) {
  const { token, accountId } = resolveCfTokenAndAccount(credentials, env);
  if (!token) {
    return {
      ok: false,
      error: 'cloudflare_not_connected',
      user_message:
        'Connect Cloudflare in Settings → Integrations (OAuth) or Keys (account-wide BYOK).',
    };
  }
  if (!accountId) {
    return {
      ok: false,
      error: 'cloudflare_account_id_required',
      user_message: 'Cloudflare account id is required (BYOK metadata or CLOUDFLARE_ACCOUNT_ID).',
    };
  }

  const op = trim(input?.operation || input?.op || 'list').toLowerCase();
  const namespaceId = trim(input?.namespace_id || input?.namespaceId || input?.namespace);
  const key = trim(input?.key || input?.object_key || input?.path);
  const prefix = trim(input?.prefix);
  const limit = Math.min(Math.max(Number(input?.limit) || 1000, 1), 1000);

  try {
    // Key-level ops are always Cloudflare REST (internal). Never Bindings MCP.
    if (op === 'list_namespaces' || (op === 'list' && !namespaceId)) {
      const namespaces = await cfApi(token, `/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces`);
      return {
        ok: true,
        operation: 'list_namespaces',
        account_id_mask: accountId.slice(-4),
        auth_source: credentials?.auth_source || null,
        dispatch: 'internal_rest',
        namespaces: Array.isArray(namespaces) ? namespaces : [],
      };
    }

    if (!namespaceId) {
      return {
        ok: false,
        error: 'namespace_id_required',
        user_message: 'namespace_id is required for list keys, get, put, and delete.',
      };
    }

    if (op === 'list' || op === 'list_keys') {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (prefix) qs.set('prefix', prefix);
      const keys = await cfApi(
        token,
        `/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces/${encodeURIComponent(namespaceId)}/keys?${qs}`,
      );
      return {
        ok: true,
        operation: 'list_keys',
        namespace_id: namespaceId,
        prefix: prefix || null,
        keys: Array.isArray(keys) ? keys : [],
      };
    }

    if (op === 'get') {
      if (!key) {
        return { ok: false, error: 'key_required', user_message: 'key is required for get.' };
      }
      const got = await kvGetValue(token, accountId, namespaceId, key);
      return {
        ok: true,
        operation: 'get',
        namespace_id: namespaceId,
        key,
        value: got.value,
        not_found: !!got.not_found,
      };
    }

    if (op === 'put' || op === 'write') {
      if (!key) {
        return { ok: false, error: 'key_required', user_message: 'key is required for put.' };
      }
      const value =
        input?.value != null
          ? String(input.value)
          : input?.content != null
            ? String(input.content)
            : '';
      const encKey = encodeURIComponent(key);
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces/${encodeURIComponent(namespaceId)}/values/${encKey}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'text/plain',
          },
          body: value,
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) {
        const msg = data?.errors?.[0]?.message || `kv_put_${res.status}`;
        return { ok: false, error: String(msg) };
      }
      return { ok: true, operation: 'put', namespace_id: namespaceId, key };
    }

    if (op === 'delete') {
      if (!key) {
        return { ok: false, error: 'key_required', user_message: 'key is required for delete.' };
      }
      const encKey = encodeURIComponent(key);
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces/${encodeURIComponent(namespaceId)}/values/${encKey}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) {
        const msg = data?.errors?.[0]?.message || `kv_delete_${res.status}`;
        return { ok: false, error: String(msg) };
      }
      return { ok: true, operation: 'delete', namespace_id: namespaceId, key };
    }

    return {
      ok: false,
      error: 'unsupported_kv_operation',
      user_message: `Unsupported operation "${op}". Use list, get, put, or delete.`,
    };
  } catch (e) {
    return {
      ok: false,
      error: e?.message ?? String(e),
      user_message:
        String(e?.message || e).includes('Authentication') ||
        String(e?.message || e).includes('auth')
          ? 'Cloudflare API rejected the token. Superadmin uses platform CLOUDFLARE_API_TOKEN; customers use workspace BYOK.'
          : String(e?.message || e),
    };
  }
}
