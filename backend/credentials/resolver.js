/**
 * Credential resolver — reads auth_source from agentsam_tools handler config.
 *
 * Platform credentials are operator/internal-only. User credentials are
 * resolved from the authenticated user's D1 rows and never from a fallback
 * platform secret.
 */
import { validateMcpToken } from '../identity/tokens/mcp-bearer.js';

export class CredentialNotConfiguredError extends Error {
  constructor(provider) {
    super(`[resolveCredential] credential not configured for provider=${provider}`);
    this.name = 'CredentialNotConfiguredError';
    this.provider = provider;
  }
}

const AUTH_SOURCE_ALIASES = {
  platform: 'platform',
  platform_scoped: 'platform_scoped',
  oauth: 'oauth',
  user_oauth_tokens: 'oauth',
  api_key: 'api_key',
  user_api_keys: 'api_key',
  secret: 'secret',
  user_secrets: 'secret',
  mcp: 'mcp',
  workspace: 'workspace',
};
const AUTH_SOURCES = new Set(Object.keys(AUTH_SOURCE_ALIASES));

export function normalizeAuthSource(raw) {
  const value = String(raw || '').trim();
  return AUTH_SOURCE_ALIASES[value] || value;
}

export function parseHandlerConfig(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return { ...raw };
  if (typeof raw !== 'string') return {};
  const value = raw.trim();
  if (!value || value === '{}') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function requireScopeIds(workspaceId, tenantId) {
  const ws = trim(workspaceId);
  const tid = trim(tenantId);
  if (!ws || !tid) {
    throw new Error('[resolveCredential] platform_scoped requires workspace_id and tenant_id');
  }
  return { workspaceId: ws, tenantId: tid };
}

function pickEnvKey(config) {
  for (const key of ['env_key', 'secret_key', 'auth_secret']) {
    if (trim(config[key])) return trim(config[key]);
  }
  return null;
}

function assertPlatformCredentialAllowed(opts) {
  const isOperator = opts.isOperatorCall === true || opts.is_operator_call === true;
  const isInternal = opts.isInternalAgent === true || opts.is_internal_agent === true;
  if (!isOperator && !isInternal) {
    throw new Error('platform auth_source not permitted for user tool calls');
  }
}

function isPlatformInternalWorkerTool(config, binding) {
  if (config?.platform_bindingless === true || config?.platform_bindingless === 1) return true;
  if (String(binding || '').toLowerCase() === 'internal') return true;
  if (trim(config?.mcp_server)) return true;
  const operation = String(config?.operation || '').toLowerCase();
  if (['read', 'list', 'grep', 'search'].includes(operation) && !pickEnvKey(config)) return true;
  if (
    config?.dispatcher === 'fs_search_files' ||
    config?.execution_lane === 'fs_search' ||
    config?.execution_lane === 'workspace_grep'
  ) return true;
  return operation === 'memory.manage' || operation === 'memory_manage' || operation.startsWith('memory_');
}

export function sanitizeToolCredentialError(detail) {
  const raw = detail && typeof detail === 'object' && 'message' in detail
    ? String(detail.message || '')
    : String(detail ?? '');
  if (/\[resolveCredential\]/i.test(raw) || /credential not configured/i.test(raw)) {
    return 'A required credential is missing or misconfigured for this tool. Reconnect the integration or ask an operator to check platform credentials.';
  }
  return raw || 'unknown_error';
}

function readPlatformEnv(env, config) {
  const envKey = pickEnvKey(config);
  const binding = trim(config?.binding) || null;
  if (!envKey && isPlatformInternalWorkerTool(config, binding)) {
    return { auth_source: 'platform', env_key: null, binding: binding || 'internal', value: null };
  }
  if (envKey) {
    const value = env?.[envKey];
    if (!trim(value)) throw new Error(`[resolveCredential] platform env missing: ${envKey}`);
    return { auth_source: 'platform', env_key: envKey, binding, value: String(value) };
  }
  if (binding) {
    const bound = env?.[binding];
    return { auth_source: 'platform', env_key: null, binding, value: bound ?? null };
  }
  if (config?.platform_bindingless === true || config?.platform_bindingless === 1) {
    return { auth_source: 'platform', env_key: null, binding: null, value: null };
  }
  throw new Error('[resolveCredential] platform requires env_key, secret_key, auth_secret, or binding');
}

export function getPlatformCredential(provider, env, config = {}) {
  const name = trim(provider).toLowerCase();
  if (name === 'cloudflare') {
    const token = trim(env?.CLOUDFLARE_API_TOKEN);
    if (!token) throw new Error('[resolveCredential] platform cloudflare: CLOUDFLARE_API_TOKEN missing');
    const accountId = trim(env?.CLOUDFLARE_ACCOUNT_ID) || null;
    return {
      auth_source: 'platform',
      provider: 'cloudflare',
      value: token,
      account_id: accountId,
      values: { CLOUDFLARE_API_TOKEN: token, ...(accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : {}) },
    };
  }
  if (name === 'supabase') {
    const url = trim(env?.SUPABASE_URL);
    const serviceKey = trim(env?.SUPABASE_SERVICE_ROLE_KEY);
    if (!url || !serviceKey) {
      throw new Error('[resolveCredential] platform supabase: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing');
    }
    return {
      auth_source: 'platform',
      provider: 'supabase',
      value: serviceKey,
      values: { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceKey },
    };
  }
  return readPlatformEnv(env, { ...config, auth_source: 'platform' });
}

async function decryptSecret(env, encryptedB64) {
  const material = String(env?.VAULT_MASTER_KEY || env?.VAULT_KEY || '').trim();
  if (!material) throw new Error('Vault key material not configured');
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(material),
    'HKDF',
    false,
    ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(16),
      info: new TextEncoder().encode('iam-vault-v1'),
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const combined = Uint8Array.from(atob(String(encryptedB64 || '')), (char) => char.charCodeAt(0));
  if (combined.length < 13) throw new Error('invalid encrypted payload');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: combined.slice(0, 12) },
    key,
    combined.slice(12),
  );
  return new TextDecoder().decode(plaintext);
}

async function getIntegrationOAuthRow(env, userId, provider, accountIdentifier = '') {
  if (!env?.DB || !userId || !provider) return null;
  const account = trim(accountIdentifier);
  const row = await env.DB.prepare(
    `SELECT *
       FROM user_oauth_tokens
      WHERE user_id = ?
        AND LOWER(provider) IN (?, ?, ?)
        AND COALESCE(is_active, 1) = 1
        AND (? = '' OR COALESCE(account_identifier, '') = ?)
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1`,
  ).bind(
    trim(userId),
    trim(provider).toLowerCase(),
    trim(provider).toLowerCase() === 'google' ? 'google_drive' : trim(provider).toLowerCase(),
    trim(provider).toLowerCase() === 'gdrive' ? 'google' : trim(provider).toLowerCase(),
    account,
    account,
  ).first().catch(() => null);
  if (!row) return null;
  let accessToken = row.access_token || null;
  let refreshToken = row.refresh_token || null;
  if (row.access_token_encrypted) accessToken = await decryptSecret(env, row.access_token_encrypted).catch(() => accessToken);
  if (row.refresh_token_encrypted) refreshToken = await decryptSecret(env, row.refresh_token_encrypted).catch(() => refreshToken);
  return { ...row, access_token: accessToken, refresh_token: refreshToken };
}

async function resolveMcpCredential(env, uid, tid, ws, opts) {
  const bridgeKey = trim(env?.AGENTSAM_BRIDGE_KEY);
  if (!bridgeKey) throw new Error('[resolveCredential] mcp auth requires AGENTSAM_BRIDGE_KEY Worker binding');
  if (!ws) throw new Error('[resolveCredential] mcp requires workspace_id in context');
  const bearer = opts.mcpBearer ?? opts.mcp_bearer ?? null;
  if (trim(bearer)) {
    const ctx = await validateMcpToken(env, trim(bearer));
    if (!ctx?.userId || ctx.userId !== uid) throw new Error('[resolveCredential] mcp bearer invalid for user');
    if (ctx.tenantId && tid && String(ctx.tenantId) !== tid) throw new Error('[resolveCredential] mcp bearer tenant mismatch');
    if (ctx.workspaceId && String(ctx.workspaceId) !== ws) throw new Error('[resolveCredential] mcp bearer workspace mismatch');
    return {
      auth_source: 'mcp',
      token_id: ctx.tokenId ?? null,
      allowed_tools: ctx.allowedTools ?? null,
      token_type: ctx.tokenType ?? 'user',
      user_id: uid,
      tenant_id: tid,
      workspace_id: ws,
      value: null,
    };
  }
  const row = await env.DB.prepare(
    `SELECT id, allowed_tools, rate_limit_per_hour, expires_at
       FROM mcp_workspace_tokens
      WHERE user_id = ? AND tenant_id = ? AND workspace_id = ?
        AND COALESCE(is_active, 1) = 1
      ORDER BY updated_at DESC LIMIT 1`,
  ).bind(uid, tid, ws).first();
  if (!row?.id) throw new Error('[resolveCredential] no active mcp_workspace_tokens row for user/workspace');
  if (row.expires_at && Number(row.expires_at) < Math.floor(Date.now() / 1000)) {
    throw new Error('[resolveCredential] mcp workspace token expired');
  }
  return {
    auth_source: 'mcp',
    token_id: String(row.id),
    allowed_tools: row.allowed_tools ? JSON.parse(String(row.allowed_tools)) : null,
    rate_limit_per_hour: row.rate_limit_per_hour ?? null,
    user_id: uid,
    tenant_id: tid,
    workspace_id: ws,
    value: null,
  };
}

/**
 * Resolve a catalog handler credential under its explicit auth_source lane.
 */
export async function resolveCredential(env, workspaceId, tenantId, handlerConfig, opts = {}) {
  const config = parseHandlerConfig(handlerConfig);
  const authSourceRaw = trim(config.auth_source);
  const authSource = normalizeAuthSource(authSourceRaw);
  if (!AUTH_SOURCES.has(authSourceRaw) && !Object.values(AUTH_SOURCE_ALIASES).includes(authSource)) {
    throw new Error(`[resolveCredential] invalid auth_source="${authSourceRaw}" — expected one of platform, oauth, api_key, secret, mcp (or legacy user_* aliases)`);
  }

  if (authSource === 'platform' || authSource === 'platform_scoped') {
    assertPlatformCredentialAllowed(opts);
    const resolved = getPlatformCredential(
      trim(config.provider || config.credential_provider),
      env,
      config,
    );
    if (authSource === 'platform_scoped') {
      const scope = requireScopeIds(workspaceId, tenantId);
      return { ...resolved, auth_source: authSource, workspace_id: scope.workspaceId, tenant_id: scope.tenantId };
    }
    return resolved;
  }

  const uid = trim(opts.userId ?? opts.user_id);
  if (!uid) throw new Error(`[resolveCredential] ${authSource} requires user_id in context`);
  const tid = trim(tenantId);
  if (!tid) throw new Error(`[resolveCredential] ${authSource} requires tenant_id`);
  const ws = trim(workspaceId);

  if (authSource === 'oauth') {
    const provider = trim(config.provider || config.oauth_provider);
    if (!provider) throw new Error('[resolveCredential] oauth requires provider in handler_config');
    const account = trim(config.account_identifier || opts.account_identifier);
    const row = await getIntegrationOAuthRow(env, uid, provider, account);
    if (!row?.access_token) throw new Error(`[resolveCredential] no OAuth token for provider=${provider}`);
    if (trim(row.tenant_id) && trim(row.tenant_id) !== tid) throw new Error('[resolveCredential] OAuth token tenant mismatch');
    if (ws && trim(row.workspace_id) && trim(row.workspace_id) !== ws) throw new Error('[resolveCredential] OAuth token workspace mismatch');
    return {
      auth_source: 'oauth',
      provider,
      account_identifier: account,
      value: String(row.access_token),
      refresh_token: row.refresh_token ? String(row.refresh_token) : null,
      user_id: uid,
      tenant_id: tid,
      workspace_id: ws || null,
    };
  }

  if (authSource === 'api_key') {
    const provider = trim(config.provider).toLowerCase();
    if (!provider) throw new Error('[resolveCredential] api_key requires provider in handler_config');
    const lookups = provider === 'google' || provider === 'google_ai'
      ? ['google', 'google_ai']
      : provider === 'google_ai_studio' || provider === 'gemini'
        ? ['google', 'google_ai', 'gemini']
        : [provider];
    let row = null;
    for (const lookup of lookups) {
      row = await env.DB.prepare(
        `SELECT id, secret_value_encrypted, metadata_json, service_name, workspace_id
           FROM user_secrets
          WHERE user_id = ? AND COALESCE(is_active, 1) = 1
            AND (tenant_id IS NULL OR tenant_id = '' OR tenant_id = ?)
            AND (LOWER(COALESCE(service_name, '')) = LOWER(?)
              OR LOWER(COALESCE(json_extract(metadata_json, '$.provider'), '')) = LOWER(?))
          ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
      ).bind(uid, tid, lookup, lookup).first().catch(() => null);
      if (row) break;
    }
    if (!row?.secret_value_encrypted) throw new CredentialNotConfiguredError(provider);
    const value = await decryptSecret(env, row.secret_value_encrypted);
    if (!value) throw new Error(`[resolveCredential] decrypt failed for user_secrets provider=${provider}`);
    let keyPreview = null;
    try {
      const meta = JSON.parse(String(row.metadata_json || '{}'));
      if (meta.last_four) keyPreview = `••••${meta.last_four}`;
    } catch {}
    return {
      auth_source: 'api_key',
      provider,
      value: String(value),
      key_preview: keyPreview,
      user_id: uid,
      tenant_id: tid,
      workspace_id: ws || row.workspace_id || null,
    };
  }

  if (authSource === 'secret') {
    const secretName = trim(config.secret_name || config.secret_key);
    if (!secretName) throw new Error('[resolveCredential] secret requires secret_name in handler_config');
    const binds = [uid, secretName];
    let sql = `SELECT id, secret_value_encrypted, workspace_id, vault_secret_id
                 FROM user_secrets
                WHERE user_id = ? AND secret_name = ? AND COALESCE(is_active, 1) = 1`;
    if (tid) {
      sql += ` AND (tenant_id IS NULL OR tenant_id = ? OR tenant_id = '')`;
      binds.push(tid);
    }
    const projectLabel = trim(config.project_label);
    if (projectLabel) {
      sql += ' AND project_label = ?';
      binds.push(projectLabel);
    }
    sql += ` AND (workspace_id IS NULL OR workspace_id = '' OR workspace_id = ?)
             ORDER BY CASE WHEN workspace_id = ? THEN 0 ELSE 1 END, updated_at DESC LIMIT 1`;
    binds.push(ws, ws);
    const row = await env.DB.prepare(sql).bind(...binds).first();
    if (!row?.secret_value_encrypted && !row?.vault_secret_id) {
      throw new Error(`[resolveCredential] no user_secrets row for secret_name=${secretName}`);
    }
    let value = row.secret_value_encrypted
      ? await decryptSecret(env, row.secret_value_encrypted)
      : null;
    if (!value && row.vault_secret_id) {
      const linked = await env.DB.prepare(
        'SELECT secret_value_encrypted FROM user_secrets WHERE id = ? AND user_id = ? LIMIT 1',
      ).bind(String(row.vault_secret_id), uid).first();
      if (linked?.secret_value_encrypted) value = await decryptSecret(env, linked.secret_value_encrypted);
    }
    if (!value) throw new Error(`[resolveCredential] decrypt failed for secret_name=${secretName}`);
    return {
      auth_source: 'secret',
      secret_name: secretName,
      project_label: projectLabel || null,
      value: String(value),
      user_id: uid,
      tenant_id: tid,
      workspace_id: ws || row.workspace_id || null,
    };
  }

  if (authSource === 'mcp') return resolveMcpCredential(env, uid, tid, ws, opts);
  if (authSource === 'workspace') {
    const channel = trim(config.channel).toLowerCase();
    if (channel === 'imessage' || channel === 'imessage_mac') {
      return { auth_source: 'workspace', provider: null, value: null, user_id: uid, tenant_id: tid, workspace_id: ws || null };
    }
    const provider = trim(config.provider || config.credential_provider || config.integration).toLowerCase();
    if (provider) {
      return resolveCredential(env, workspaceId, tenantId, { ...config, auth_source: 'api_key', provider }, opts);
    }
    return { auth_source: 'workspace', provider: null, value: null, user_id: uid, tenant_id: tid, workspace_id: ws || null };
  }
  throw new Error(`[resolveCredential] unhandled auth_source=${authSource}`);
}
