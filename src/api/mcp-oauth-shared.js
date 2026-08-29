import { jsonResponse } from '../core/responses.js';
import { isTenantId } from '../core/platform-identity-constants.js';
import { platformTenantIdFromEnv } from '../../backend/identity/users/tenant.js';
import { resolveIamSystemActorTenantId } from '../../backend/identity/system-actor.js';

export const MCP_CANONICAL_CLIENT_ID = 'iam_mcp_inneranimalmedia';
export const IAM_OAUTH_ISSUER = 'https://inneranimalmedia.com';
export const IAM_MCP_RESOURCE_URL = 'https://mcp.inneranimalmedia.com/mcp';
/** Tenant for unauthenticated Claude/ChatGPT DCR rows — resolved from Worker env. */

/**
 * Unauthenticated DCR (ChatGPT / Claude / Cursor) still needs oauth_clients.tenant_id.
 * TENANT_ID is intentionally not in public wrangler.toml; if the Worker secret is
 * missing, look up D1 instead of 503 `dcr_not_configured`.
 *
 * @param {Record<string, unknown>|null|undefined} env
 * @returns {Promise<string>}
 */
export async function resolveUnauthenticatedDcrTenantId(env) {
  const fromEnv = platformTenantIdFromEnv(env);
  if (fromEnv) return fromEnv;

  try {
    const fromActor = await resolveIamSystemActorTenantId(env);
    if (fromActor) return fromActor;
  } catch {
    // IAM service identity unavailable in partial env.
  }

  const db = env?.DB;
  if (!db) return '';

  const workspaceIds = ['WORKSPACE_ID', 'IAM_D1_WORKSPACE_ID', 'PLATFORM_WORKSPACE_ID']
    .map((key) => String(env?.[key] || '').trim())
    .filter(Boolean);

  for (const workspaceId of workspaceIds) {
    const fromRow = await lookupWorkspaceTenantId(db, workspaceId);
    if (fromRow) return fromRow;
  }

  return (await lookupKindedWorkspaceTenantId(db)) || '';
}

/** @param {{ prepare: Function }} db @param {string} workspaceId */
async function lookupWorkspaceTenantId(db, workspaceId) {
  const queries = [
    'SELECT tenant_id FROM agentsam_workspace WHERE id = ? LIMIT 1',
    'SELECT tenant_id FROM workspaces WHERE id = ? LIMIT 1',
  ];
  for (const sql of queries) {
    try {
      const row = await db.prepare(sql).bind(workspaceId).first();
      const tid = String(row?.tenant_id || '').trim();
      if (isTenantId(tid)) return tid;
    } catch {
      // Table may be absent in tests / partial DBs.
    }
  }
  return '';
}

/** Prefer MCP-server workspace, then platform workspace — never an arbitrary client tenant. */
async function lookupKindedWorkspaceTenantId(db) {
  try {
    const row = await db
      .prepare(
        `SELECT tenant_id FROM agentsam_workspace
         WHERE json_extract(COALESCE(metadata_json, '{}'), '$.workspace_kind') IN ('mcp_server', 'platform')
           AND tenant_id IS NOT NULL AND trim(tenant_id) != ''
         ORDER BY CASE json_extract(COALESCE(metadata_json, '{}'), '$.workspace_kind')
           WHEN 'mcp_server' THEN 0
           WHEN 'platform' THEN 1
           ELSE 2 END
         LIMIT 1`,
      )
      .first();
    const tid = String(row?.tenant_id || '').trim();
    if (isTenantId(tid)) return tid;
  } catch {
    return '';
  }
  return '';
}

/** Normalize resource/audience URL for comparison (RFC 8707). */
export function normalizeMcpOAuthResourceUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    u.hash = '';
    u.search = '';
    let path = u.pathname || '/';
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    u.pathname = path || '/';
    return u.href;
  } catch {
    return s.replace(/\/$/, '');
  }
}

/** Read `resource` or legacy `audience` from URLSearchParams or token body object. */
export function resolveMcpOAuthResourceParam(source) {
  if (!source) return '';
  if (typeof source.get === 'function') {
    return String(source.get('resource') || source.get('audience') || '').trim();
  }
  return String(source.resource || source.audience || '').trim();
}

/**
 * Validate resource indicator against canonical MCP resource URL.
 * @returns {{ ok: true, resource: string } | { ok: false, error: string }}
 */
export function assertMcpOAuthResourceMatches(raw) {
  const normalized = normalizeMcpOAuthResourceUrl(raw);
  const expected = normalizeMcpOAuthResourceUrl(IAM_MCP_RESOURCE_URL);
  if (!normalized) {
    return { ok: false, error: 'missing_resource' };
  }
  if (normalized !== expected) {
    return { ok: false, error: 'invalid_resource' };
  }
  return { ok: true, resource: expected };
}

export function parseMcpOAuthAuthorizationMetadata(metadataJson) {
  try {
    const j = JSON.parse(String(metadataJson || '{}'));
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}
export const MCP_OAUTH_CODE_TTL_SECONDS = 10 * 60;
/** OAuth access tokens — 24h legacy default (prefer MCP_OAUTH_ACCESS_WITH_REFRESH_TTL_SECONDS). */
export const MCP_OAUTH_TOKEN_TTL_SECONDS = 60 * 60 * 24;
/** Short-lived access when refresh_token is issued (RFC 6749 refresh flow). */
export const MCP_OAUTH_ACCESS_WITH_REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Refresh grant lifetime — 90 days from issuance. */
export const MCP_OAUTH_REFRESH_TOKEN_TTL_SECONDS = 90 * 86400;
/** Cursor native OAuth — 30d; Cursor re-auths via mcp.json on startup. */
export const MCP_OAUTH_CURSOR_TOKEN_TTL_SECONDS = 30 * 86400;
/** Cursor IDE OAuth callbacks — desktop switched between deeplink and localhost; keep all registered. */
export const MCP_OAUTH_CURSOR_REDIRECT_URI = 'cursor://anysphere.cursor-deeplink/mcp/auth_callback';
export const MCP_OAUTH_CURSOR_REDIRECT_URI_MCP_PATH = 'cursor://anysphere.cursor-mcp/oauth/callback';
/** Cursor desktop IDE callback listener (2026+). */
export const MCP_OAUTH_CURSOR_REDIRECT_URI_LOCALHOST = 'http://localhost:8787/callback';
/** Cursor Cloud Agents / cursor.com web MCP OAuth (docs: MCP static redirect). */
export const MCP_OAUTH_CURSOR_REDIRECT_URI_AGENTS =
  'https://www.cursor.com/agents/mcp/oauth/callback';
export const MCP_OAUTH_CURSOR_REDIRECT_URI_AGENTS_APEX =
  'https://cursor.com/agents/mcp/oauth/callback';

export function resolveMcpOAuthTokenTtlSeconds(env, externalClientKey = null) {
  const key = String(externalClientKey || '').trim().toLowerCase();
  if (key === 'cursor') return MCP_OAUTH_CURSOR_TOKEN_TTL_SECONDS;
  const n = parseInt(String(env?.MCP_OAUTH_TOKEN_TTL_SECONDS ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : MCP_OAUTH_TOKEN_TTL_SECONDS;
}

/** Access TTL for OAuth rows that include refresh_token (Cursor keeps long-lived access). */
export function resolveMcpOAuthAccessTtlSeconds(env, externalClientKey = null) {
  const key = String(externalClientKey || '').trim().toLowerCase();
  if (key === 'cursor') return MCP_OAUTH_CURSOR_TOKEN_TTL_SECONDS;
  const n = parseInt(String(env?.MCP_OAUTH_ACCESS_TTL_SECONDS ?? ''), 10);
  if (Number.isFinite(n) && n > 0) return n;
  return MCP_OAUTH_ACCESS_WITH_REFRESH_TTL_SECONDS;
}
export const MCP_OAUTH_AUTHZ_TTL_SECONDS = 10 * 60;

/** RFC 8414 — IAM as authorization server for MCP (inneranimalmedia.com). */
export function iamMcpOAuthAuthorizationServerMetadata() {
  return {
    issuer: IAM_OAUTH_ISSUER,
    authorization_endpoint: `${IAM_OAUTH_ISSUER}/api/oauth/authorize`,
    token_endpoint: `${IAM_OAUTH_ISSUER}/api/oauth/token`,
    registration_endpoint: `${IAM_OAUTH_ISSUER}/api/oauth/register`,
    userinfo_endpoint: `${IAM_OAUTH_ISSUER}/api/oauth/userinfo`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: [
      'openid',
      'iam:profile',
      'iam:workspaces',
      'iam:agent',
      'mcp:tools',
      'mcp:userinfo',
    ],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    subject_types_supported: ['public'],
    jwks_uri: `${IAM_OAUTH_ISSUER}/.well-known/jwks.json`,
    id_token_signing_alg_values_supported: ['RS256'],
  };
}

/** OpenID Connect Discovery 1.0 */
export function iamMcpOpenIdConfiguration() {
  const base = iamMcpOAuthAuthorizationServerMetadata();
  return {
    ...base,
    scopes_supported: base.scopes_supported,
    claims_supported: ['sub', 'iss', 'aud', 'azp', 'exp', 'iat', 'email', 'name', 'resource'],
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    jwks_uri: base.jwks_uri,
    id_token_signing_alg_values_supported: ['RS256'],
  };
}

// Pure crypto/PKCE primitives live in the shared OAuth contract.
// re-exported here so every existing importer of this file keeps working unchanged.
export {
  mcpOAuthNow,
  mcpOAuthBase64Url,
  mcpOAuthSha256Hex,
  mcpOAuthPkceS256,
  mcpOAuthRandomToken,
} from '../../shared/oauth-crypto.js';

export function mcpOAuthJsonError(error, status = 400, extra = {}) {
  return jsonResponse({ error, ...extra }, status);
}

export function mcpOAuthParseJsonArray(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function mcpOAuthParseScopeList(raw) {
  return String(raw || '')
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export async function mcpOAuthLoadClient(env, clientId) {
  if (!env.DB) return null;
  return env.DB.prepare(
    `SELECT client_id, client_secret_hash, display_name, name, logo_url, homepage_url, redirect_uris,
            allowed_scopes, requires_pkce, is_active, token_endpoint_auth_method
       FROM oauth_clients
      WHERE client_id = ? AND is_active = 1
      LIMIT 1`,
  )
    .bind(clientId)
    .first();
}

export function mcpOAuthRedirectAllowed(client, redirectHref) {
  const allowed = mcpOAuthParseJsonArray(client?.redirect_uris);
  const norm = String(redirectHref || '').replace(/\/$/, '');
  return allowed.some((u) => String(u).replace(/\/$/, '') === norm);
}

export function mcpOAuthScopeAllowed(client, scopeStr) {
  const requested = mcpOAuthParseScopeList(scopeStr);
  const allowed = mcpOAuthParseJsonArray(client?.allowed_scopes);
  if (!requested.length) return allowed.length > 0;
  return requested.every((s) => allowed.includes(s));
}

export function mcpOAuthNormalizeScope(raw, client) {
  const allowed = mcpOAuthParseJsonArray(client?.allowed_scopes);
  const scopes = mcpOAuthParseScopeList(raw);
  const picked = scopes.length ? scopes : allowed.slice(0, 3);
  if (!picked.includes('mcp:userinfo') && allowed.includes('mcp:userinfo')) {
    picked.push('mcp:userinfo');
  }
  return Array.from(new Set(picked.filter((s) => allowed.includes(s)))).join(' ');
}

/** Canonical redirect URIs for iam_mcp_inneranimalmedia (migration 401 + 1006). */
export const MCP_OAUTH_REGISTERED_REDIRECT_URIS = [
  'https://mcp.inneranimalmedia.com/auth/callback',
  MCP_OAUTH_CURSOR_REDIRECT_URI,
  MCP_OAUTH_CURSOR_REDIRECT_URI_MCP_PATH,
  MCP_OAUTH_CURSOR_REDIRECT_URI_LOCALHOST,
  MCP_OAUTH_CURSOR_REDIRECT_URI_AGENTS,
  MCP_OAUTH_CURSOR_REDIRECT_URI_AGENTS_APEX,
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
  'https://chatgpt.com/connector_platform_oauth_redirect',
  'https://chat.openai.com/connector_platform_oauth_redirect',
  'https://chatgpt.com/connector/oauth/Fp4-o8x6PZh_',
];

/**
 * Infer external MCP host (Cursor, Claude, ChatGPT) from OAuth redirect_uri.
 * Used by MCP consent UI for app-appropriate copy and accents.
 */
export function resolveMcpConnectingApp(redirectUri) {
  const fallback = {
    key: 'default',
    label: 'your MCP client',
    badge: 'MCP',
    tagline: 'This allows your MCP client to use approved Inner Animal Media MCP tools.',
    return_hint: 'Return to your MCP client to continue.',
    accent: '#0969da',
  };

  const raw = String(redirectUri || '').trim();
  if (!raw) return fallback;

  let host = '';
  let path = '';
  try {
    const u = new URL(raw);
    host = u.hostname.toLowerCase();
    path = u.pathname.toLowerCase();
  } catch {
    return fallback;
  }

  if (host === 'claude.ai' || host === 'claude.com') {
    return {
      key: 'claude',
      label: 'Claude.ai',
      badge: 'C',
      tagline: 'This allows Claude.ai to use approved Inner Animal Media MCP tools.',
      return_hint: 'Return to Claude.ai to finish connecting.',
      accent: '#d97757',
    };
  }

  if (
    host === 'chatgpt.com' ||
    host === 'chat.openai.com' ||
    path.includes('connector_platform_oauth') ||
    path.startsWith('/connector/oauth/')
  ) {
    return {
      key: 'chatgpt',
      label: 'ChatGPT',
      badge: 'GPT',
      tagline: 'This allows ChatGPT to use approved Inner Animal Media MCP tools.',
      return_hint: 'Return to ChatGPT to finish connecting.',
      accent: '#10a37f',
    };
  }

  if (
    raw.toLowerCase().startsWith('cursor://') ||
    (host === 'mcp.inneranimalmedia.com' && path.includes('/auth/callback')) ||
    ((host === 'localhost' || host === '127.0.0.1' || host === '[::1]') && path === '/callback') ||
    ((host === 'www.cursor.com' || host === 'cursor.com') &&
      path.replace(/\/$/, '') === '/agents/mcp/oauth/callback')
  ) {
    return {
      key: 'cursor',
      label: 'Cursor',
      badge: '↗',
      tagline: 'This allows Cursor to use approved Inner Animal Media MCP tools.',
      return_hint: 'Return to Cursor — your connection will resume automatically.',
      accent: '#1a1a2e',
    };
  }

  return fallback;
}

/** RFC 8252 loopback redirect (mcp-remote, native MCP clients). */
export function mcpOAuthIsLoopbackRedirect(u) {
  if (String(u?.protocol || '').toLowerCase() !== 'http:') return false;
  const host = String(u.hostname || '').toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
}

/** cursor:// OAuth callbacks (Cursor IDE / mcp-remote). */
export function mcpOAuthIsCursorNativeRedirect(u) {
  const scheme = String(u?.protocol || '').toLowerCase();
  if (scheme !== 'cursor:') return false;
  const path = String(u.pathname || '').toLowerCase();
  return (
    path.includes('auth_callback') ||
    path.includes('/oauth/') ||
    hrefMatchesCanonicalCursorRedirect(u.href)
  );
}

function hrefMatchesCanonicalCursorRedirect(href) {
  return String(href || '').replace(/\/$/, '') === MCP_OAUTH_CURSOR_REDIRECT_URI.replace(/\/$/, '');
}

/** ChatGPT / Claude hosted connector callbacks (unauthenticated DCR). */
export function mcpOAuthIsHostedConnectorRedirect(u) {
  const host = String(u?.hostname || '').toLowerCase();
  const path = String(u?.pathname || '').toLowerCase();
  return (
    ((host === 'chatgpt.com' || host === 'chat.openai.com') &&
      (path.startsWith('/connector/oauth/') || path === '/connector_platform_oauth_redirect')) ||
    (host === 'claude.ai' && path.includes('/api/mcp/auth_callback')) ||
    (host === 'claude.com' && path.includes('/api/mcp/auth_callback'))
  );
}

/** Cursor Cloud Agents / cursor.com web MCP OAuth callback (path-exact). */
export function mcpOAuthIsCursorAgentsRedirect(u) {
  const scheme = String(u?.protocol || '').toLowerCase();
  if (scheme !== 'https:') return false;
  const host = String(u?.hostname || '').toLowerCase();
  if (host !== 'www.cursor.com' && host !== 'cursor.com') return false;
  const path = String(u?.pathname || '').replace(/\/$/, '').toLowerCase();
  return path === '/agents/mcp/oauth/callback';
}

/** Redirect URIs allowed for unauthenticated POST /api/oauth/register (DCR). */
export function mcpOAuthIsPublicDcrRedirect(href) {
  try {
    const u = new URL(String(href || ''));
    return (
      mcpOAuthIsLoopbackRedirect(u) ||
      mcpOAuthIsCursorNativeRedirect(u) ||
      mcpOAuthIsCursorAgentsRedirect(u) ||
      mcpOAuthIsHostedConnectorRedirect(u)
    );
  } catch {
    return false;
  }
}

export function mcpOAuthValidateRedirectUri(raw, client, env) {
  let u;
  try {
    u = new URL(String(raw || ''));
  } catch {
    return { ok: false, error: 'invalid_redirect_uri', url: null };
  }

  const href = u.href;
  if (client && mcpOAuthRedirectAllowed(client, href)) {
    return { ok: true, error: null, url: u };
  }

  if (
    mcpOAuthIsLoopbackRedirect(u) ||
    mcpOAuthIsCursorNativeRedirect(u) ||
    mcpOAuthIsCursorAgentsRedirect(u)
  ) {
    return { ok: true, error: null, url: u };
  }

  const scheme = String(u.protocol || '').toLowerCase();
  if (scheme !== 'https:') {
    return { ok: false, error: 'redirect_uri_must_be_https', url: null };
  }

  const host = u.hostname.toLowerCase();
  const configured = String(env.MCP_OAUTH_ALLOWED_REDIRECT_HOSTS || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

  const allowedHosts = configured.length
    ? configured
    : [
        'mcp.inneranimalmedia.com',
        'inneranimalmedia.com',
        'www.inneranimalmedia.com',
        'claude.ai',
        'claude.com',
        'chatgpt.com',
        'chat.openai.com',
      ];

  const ok =
    allowedHosts.includes(host) ||
    host.endsWith('.inneranimalmedia.com') ||
    host.endsWith('.cloudflareaccess.com');
  if (!ok) return { ok: false, error: 'redirect_uri_not_allowed', url: null };

  return { ok: true, error: null, url: u };
}

/** @deprecated Use mcpOAuthValidateRedirectUri */
export function mcpOAuthAllowedRedirectUri(raw, env) {
  return mcpOAuthValidateRedirectUri(raw, null, env);
}

export function mcpOAuthSafePathWithSearch(url) {
  return `${url.pathname}${url.search || ''}`;
}

/**
 * Curated tool keys for external OAuth MCP clients (Claude, ChatGPT).
 * Source: agentsam_mcp_oauth_tool_allowlist (migration 403).
 */
export async function loadMcpOAuthExternalToolKeys(env, clientId = MCP_CANONICAL_CLIENT_ID) {
  if (!env?.DB) return null;
  try {
    const { results } = await env.DB.prepare(
      `SELECT tool_key
         FROM agentsam_mcp_oauth_tool_allowlist
        WHERE client_id = ?
          AND COALESCE(is_active, 1) = 1
        ORDER BY sort_order ASC, tool_key ASC`,
    )
      .bind(String(clientId || MCP_CANONICAL_CLIENT_ID))
      .all();
    const keys = (results || [])
      .map((r) => String(r.tool_key || '').trim())
      .filter(Boolean);
    if (keys.length) return keys;
    const canonical = String(clientId || MCP_CANONICAL_CLIENT_ID).trim();
    if (canonical && canonical !== MCP_CANONICAL_CLIENT_ID) {
      return loadMcpOAuthExternalToolKeys(env, MCP_CANONICAL_CLIENT_ID);
    }
    return null;
  } catch (_) {
    return null;
  }
}

/** JSON array for mcp_workspace_tokens.allowed_tools at OAuth token issue. */
export async function loadMcpOAuthExternalAllowedToolsJson(env, clientId = MCP_CANONICAL_CLIENT_ID) {
  const keys = await loadMcpOAuthExternalToolKeys(env, clientId);
  return keys?.length ? JSON.stringify(keys) : null;
}

/**
 * DCR OAuth clients (iam_dcr_*) often have zero allowlist rows — use canonical catalog.
 */
export async function resolveMcpOAuthCatalogClientId(env, clientId) {
  const cid = String(clientId || MCP_CANONICAL_CLIENT_ID).trim() || MCP_CANONICAL_CLIENT_ID;
  if (!env?.DB) return MCP_CANONICAL_CLIENT_ID;
  if (cid === MCP_CANONICAL_CLIENT_ID) return cid;
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS c
         FROM agentsam_mcp_oauth_tool_allowlist
        WHERE client_id = ?
          AND COALESCE(is_active, 1) = 1`,
    )
      .bind(cid)
      .first();
    if (Number(row?.c) > 0) return cid;
  } catch (_) {}
  return MCP_CANONICAL_CLIENT_ID;
}

/** Allowlist rows with access_class for OAuth token entitlements + MCP runtime guards. */
export async function loadMcpOAuthAllowlistRows(env, clientId = MCP_CANONICAL_CLIENT_ID) {
  if (!env?.DB) return [];
  const catalogClientId = await resolveMcpOAuthCatalogClientId(env, clientId);
  try {
    const { results } = await env.DB.prepare(
      `SELECT tool_key, access_class
         FROM agentsam_mcp_oauth_tool_allowlist
        WHERE client_id = ?
          AND COALESCE(is_active, 1) = 1
        ORDER BY sort_order ASC, tool_key ASC`,
    )
      .bind(catalogClientId)
      .all();
    return (results || []).map((r) => ({
      tool_key: String(r.tool_key || '').trim(),
      access_class: String(r.access_class || 'read').toLowerCase() === 'write' ? 'write' : 'read',
    })).filter((r) => r.tool_key);
  } catch (_) {
    return [];
  }
}

/**
 * Derive narrow token entitlements from granted OAuth scopes + client allowlist.
 * Avoids broad mcp.* / agent.* defaults on OAuth-issued rows.
 */
export async function buildMcpOAuthTokenEntitlements(env, clientId, grantedScopeStr, allowedToolKeys = null) {
  const scopes = mcpOAuthParseScopeList(grantedScopeStr);
  const scopeSet = new Set(scopes);
  const catalogClientId = await resolveMcpOAuthCatalogClientId(env, clientId);
  let rows = await loadMcpOAuthAllowlistRows(env, catalogClientId);
  if (Array.isArray(allowedToolKeys) && allowedToolKeys.length) {
    const allow = new Set(allowedToolKeys.map((k) => String(k || '').trim()).filter(Boolean));
    rows = rows.filter((r) => allow.has(r.tool_key));
  }

  const hasMcpTools = scopeSet.has('mcp:tools');
  const hasAgent = scopeSet.has('iam:agent');
  // oauth_tool_access must list write tools for connector discovery; tools/call still gates iam:agent.
  const oauthToolAccessRows = rows;

  const capabilityKeys = [];
  if (scopeSet.has('iam:profile')) capabilityKeys.push('iam.profile.read');
  if (scopeSet.has('mcp:userinfo')) capabilityKeys.push('mcp.userinfo.read');
  if (hasMcpTools) capabilityKeys.push('mcp.tools.invoke.read');
  if (hasAgent && hasMcpTools) capabilityKeys.push('mcp.tools.invoke.write');

  const lanes = new Set();
  const riskLevels = new Set(['low']);
  let includesWrite = false;

  for (const row of rows) {
    if (!hasMcpTools) continue;
    if (row.access_class === 'write') {
      if (!hasAgent) continue;
      includesWrite = true;
      riskLevels.add('medium');
      riskLevels.add('high');
      lanes.add('operate');
    } else {
      lanes.add('general');
      lanes.add('inspect');
      riskLevels.add('medium');
    }
  }

  if (!lanes.size) {
    lanes.add('general');
    lanes.add('inspect');
  }

  if (!includesWrite) {
    riskLevels.delete('high');
  }

  return {
    capabilityKeys: capabilityKeys.length ? capabilityKeys : ['mcp.oauth.connected'],
    lanes: Array.from(lanes),
    riskLevels: Array.from(riskLevels),
    oauthToolAccess: Object.fromEntries(
      oauthToolAccessRows.map((r) => [r.tool_key, r.access_class]),
    ),
    oauthClientId: catalogClientId,
  };
}

/**
 * When token allowlist includes write-class tools, grant iam:agent so tools/call can execute them.
 */
export function augmentMcpOAuthScopeForWriteTools(scopeStr, allowlistRows, tokenToolKeys) {
  const scopeList = mcpOAuthParseScopeList(scopeStr);
  if (scopeList.includes('iam:agent')) return scopeStr;
  const keys = new Set((tokenToolKeys || []).map((k) => String(k || '').trim()).filter(Boolean));
  const writeOnToken = (allowlistRows || []).some(
    (r) => r.access_class === 'write' && keys.has(r.tool_key),
  );
  if (!writeOnToken) return scopeStr;
  return [...scopeList, 'iam:agent'].join(' ');
}

/** Map tool_key → access_class JSON for mcp_workspace_tokens.allowed_domains_json reuse. */
export function oauthToolAccessDomainsPayload(entitlements, policyMeta = {}, externalClientKey = null) {
  const payload = {
    oauth_client_id: entitlements.oauthClientId,
    oauth_tool_access: entitlements.oauthToolAccess,
    require_allowlist_for_mcp: Number(policyMeta.require_allowlist_for_mcp || 0) === 1 ? 1 : 0,
    tool_risk_level_max: String(policyMeta.tool_risk_level_max || 'high'),
    // Tool plane is the user. workspace_id on the token is audit/home only — not a tool target.
    tool_plane: 'user',
  };
  const ext = externalClientKey != null ? String(externalClientKey).trim() : '';
  if (ext) payload.external_client_key = ext;
  return JSON.stringify(payload);
}

/**
 * Intersect OAuth client allowlist with user agentsam_mcp_allowlist when policy requires it.
 */
export async function intersectOAuthToolsWithUserPolicy(env, scope, clientId) {
  const { filterOAuthToolKeysForUser } = await import('../core/mcp-oauth-user-policy.js');
  const oauthKeys = (await loadMcpOAuthExternalToolKeys(env, clientId)) || [];
  const { keys, policy, requireAllowlist } = await filterOAuthToolKeysForUser(env, scope, oauthKeys);
  return { keys, policy, requireAllowlist, oauthKeys };
}

function normalizeMcpPermissionGroup(raw, accessClass) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (s) return s;
  return String(accessClass || '').toLowerCase() === 'write' ? 'write' : 'general';
}

function mcpPermissionGroupIcon(groupKey, accessClass) {
  const g = normalizeMcpPermissionGroup(groupKey, accessClass);
  if (g === 'discover' || g === 'search' || g === 'research') return 'search';
  if (g === 'observe' || g === 'inspect') return 'eye';
  if (g === 'develop' || g === 'code' || g === 'github') return 'code';
  if (g === 'database' || g === 'd1') return 'database';
  if (g === 'storage' || g === 'r2') return 'archive';
  if (g === 'operate' || g === 'workflow' || g === 'agent') return 'wrench';
  if (g === 'write') return 'pencil';
  return String(accessClass || '').toLowerCase() === 'write' ? 'pencil' : 'shield';
}

function buildMcpConsentServices(clientName, tools) {
  /** @type {Map<string, { group: string, icon: string, items: string[] }>} */
  const groups = new Map();
  for (const tool of tools || []) {
    const group = normalizeMcpPermissionGroup(tool.permission_group || tool.tool_category, tool.access_class);
    if (!groups.has(group)) {
      groups.set(group, {
        group,
        icon: mcpPermissionGroupIcon(group, tool.access_class),
        items: [],
      });
    }
    const entry = groups.get(group);
    const item = String(tool.label || tool.tool_key || '').trim();
    if (item && !entry.items.includes(item)) entry.items.push(item);
  }
  return {
    name: String(clientName || 'MCP client'),
    permissions: Array.from(groups.values()).sort((a, b) => a.group.localeCompare(b.group)),
  };
}

/**
 * Tools shown on MCP OAuth consent (same intersection as token issue).
 * Server-side only; the consent frontend does not receive workspace identifiers.
 * @param {any} env
 * @param {{ userId: string, workspaceId: string, tenantId?: string, clientId: string, grantedScopes: string[] }} input
 */
export async function loadMcpOAuthConsentToolManifest(env, input) {
  const clientId = String(input?.clientId || MCP_CANONICAL_CLIENT_ID);
  const scopeSet = new Set((input?.grantedScopes || []).map((s) => String(s).trim()).filter(Boolean));
  const empty = {
    tools: [],
    summary: { total: 0, read: 0, write: 0 },
    services: { name: String(input?.clientDisplayName || clientId), permissions: [] },
    require_allowlist_for_mcp: false,
  };
  if (!scopeSet.has('mcp:tools')) return empty;

  const { keys, requireAllowlist } = await intersectOAuthToolsWithUserPolicy(env, {
    userId: input.userId,
    workspaceId: input.workspaceId,
    tenantId: input.tenantId,
    clientId,
  }, clientId);

  const allow = new Set(keys);
  let rows = (await loadMcpOAuthAllowlistRows(env, clientId)).filter((r) => allow.has(r.tool_key));
  if (!scopeSet.has('iam:agent')) {
    rows = rows.filter((r) => r.access_class !== 'write');
  }

  if (!rows.length) {
    return {
      tools: [],
      summary: { total: 0, read: 0, write: 0 },
      services: { name: String(input?.clientDisplayName || clientId), permissions: [] },
      require_allowlist_for_mcp: requireAllowlist,
    };
  }

  const meta = new Map();
  if (env?.DB) {
    const placeholders = rows.map(() => '?').join(',');
    try {
      const { results } = await env.DB.prepare(
        `SELECT tool_key,
                COALESCE(NULLIF(trim(display_name), ''), tool_key) AS label,
                COALESCE(NULLIF(trim(tool_category), ''), 'general') AS tool_category,
                COALESCE(risk_level, 'low') AS risk_level,
                COALESCE(requires_approval, 0) AS requires_approval,
                COALESCE(NULLIF(trim(tool_category), ''), 'general') AS permission_group
           FROM agentsam_tools
          WHERE tool_key IN (${placeholders})
            AND COALESCE(is_active, 1) = 1
            AND COALESCE(oauth_visible, 0) = 1`,
      )
        .bind(...rows.map((r) => r.tool_key))
        .all();
      for (const r of results || []) {
        const k = String(r.tool_key || '').trim();
        if (!k) continue;
        meta.set(k, r);
      }
    } catch (_) {}
  }

  const tools = rows.map((r) => {
    const m = meta.get(r.tool_key);
    return {
      tool_key: r.tool_key,
      label: String(m?.label || r.tool_key),
      access_class: r.access_class,
      tool_category: String(m?.permission_group || m?.tool_category || 'general'),
      permission_group: normalizeMcpPermissionGroup(m?.permission_group || m?.tool_category, r.access_class),
      risk_level: String(m?.risk_level || 'low'),
      requires_approval: Number(m?.requires_approval) === 1,
    };
  });

  const read = tools.filter((t) => t.access_class === 'read').length;
  const write = tools.filter((t) => t.access_class === 'write').length;
  const services = buildMcpConsentServices(input?.clientDisplayName || clientId, tools);

  let tool_groups = [];
  try {
    const { groupMcpToolsForPreferences, buildSafeDefaultMcpGroupPreferences } = await import(
      '../../backend/agentsam/tools/mcp-preferences.js'
    );
    tool_groups = groupMcpToolsForPreferences(tools);
    const safe_defaults = buildSafeDefaultMcpGroupPreferences(tool_groups, {
      hasAgentScope: scopeSet.has('iam:agent'),
    });
    return {
      tools,
      tool_groups,
      safe_default_preferences: safe_defaults,
      summary: { total: tools.length, read, write },
      services,
      require_allowlist_for_mcp: requireAllowlist,
    };
  } catch (_) {}

  return {
    tools,
    tool_groups,
    safe_default_preferences: {},
    summary: { total: tools.length, read, write },
    services,
    require_allowlist_for_mcp: requireAllowlist,
  };
}

/** Workspace github_repo + repo_path for MCP token rows (per-user isolation). */
export async function loadWorkspaceMcpTokenBindings(env, workspaceId) {
  if (!env?.DB || !workspaceId) return { github_repo: null, repo_path: null, tenant_id: null };
  try {
    const row = await env.DB.prepare(
      `SELECT tenant_id, github_repo, settings_json
         FROM workspaces
        WHERE id = ?
        LIMIT 1`,
    )
      .bind(String(workspaceId))
      .first();
    if (!row) return { github_repo: null, repo_path: null, tenant_id: null };
    let repoPath = null;
    try {
      const settings = row.settings_json ? JSON.parse(row.settings_json) : {};
      repoPath = settings?.repo_path || settings?.local_repo_path || null;
    } catch (_) {}
    let gh = String(row.github_repo || '').trim();
    gh = gh.replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
    return {
      tenant_id: row.tenant_id || null,
      github_repo: gh || null,
      repo_path: repoPath,
    };
  } catch (_) {
    return { github_repo: null, repo_path: null, tenant_id: null };
  }
}
