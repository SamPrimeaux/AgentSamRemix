/**
 * MCP OAuth token endpoint — authorization_code + refresh_token grants.
 */
import { jsonResponse } from '../core/responses.js';
import { logAuthEvent } from '../../backend/identity/auth-events.js';
import {
  IAM_MCP_RESOURCE_URL,
  MCP_CANONICAL_CLIENT_ID,
  IAM_OAUTH_ISSUER,
  mcpOAuthNow,
  mcpOAuthSha256Hex,
  mcpOAuthRandomToken,
  mcpOAuthJsonError,
  mcpOAuthParseScopeList,
  parseMcpOAuthAuthorizationMetadata,
  assertMcpOAuthResourceMatches,
  normalizeMcpOAuthResourceUrl,
  mcpOAuthLoadClient,
  mcpOAuthNormalizeScope,
  loadMcpOAuthExternalToolKeys,
  loadWorkspaceMcpTokenBindings,
  buildMcpOAuthTokenEntitlements,
  oauthToolAccessDomainsPayload,
  resolveMcpOAuthAccessTtlSeconds,
  MCP_OAUTH_REFRESH_TOKEN_TTL_SECONDS,
  intersectOAuthToolsWithUserPolicy,
  loadMcpOAuthAllowlistRows,
  augmentMcpOAuthScopeForWriteTools,
} from './mcp-oauth-shared.js';
import { checkMcpOAuthRateLimit } from './mcp-oauth-rate-limit.js';
import {
  signIamOidcIdToken,
  buildIamMcpIdTokenClaims,
} from '../core/mcp-oidc-id-token.js';
import {
  resolveCanonicalWorkspace,
  mcpOAuthReadBody,
  mcpOAuthValidateAuthorizationCode,
  assertMcpOAuthTokenClientAuth,
  logMcpOAuthTokenFailure,
} from './oauth.js';
import { userMayUseWorkspaceCredentials, resolveGrantAuthUserRow } from '../../backend/identity/workspace/grants.js';
import { isIamServiceIdentityLane } from '../../backend/identity/users/index.js';
import { mcpOAuthRecoveryExtras } from '../../backend/identity/recovery.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function mcpOAuthRequestMeta(request) {
  return {
    cf_ray: request.headers.get('cf-ray') || null,
    colo: request.headers.get('cf-ipcountry') || null,
  };
}

function parseExternalClientKeyFromDomains(raw) {
  try {
    const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return String(p?.external_client_key || '').trim() || null;
  } catch {
    return null;
  }
}

function parseOAuthClientIdFromDomains(raw) {
  try {
    const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return String(p?.oauth_client_id || '').trim() || null;
  } catch {
    return null;
  }
}

function scopesFromRow(row) {
  try {
    const arr = JSON.parse(row?.scopes_json || '[]');
    return Array.isArray(arr) ? arr.filter(Boolean).join(' ') : '';
  } catch {
    return '';
  }
}

async function logMcpTokenIssued(env, request, userId, meta = {}) {
  await logAuthEvent(env, {
    request,
    eventType: 'mcp_token_issued',
    userId,
    status: 'ok',
    metadata: { ...mcpOAuthRequestMeta(request), ...meta },
  }).catch(() => {});
}

async function logMcpTokenRefresh(env, request, userId, meta = {}) {
  await logAuthEvent(env, {
    request,
    eventType: 'mcp_token_refresh',
    userId,
    status: 'ok',
    metadata: { ...mcpOAuthRequestMeta(request), ...meta },
  }).catch(() => {});
}

async function insertMcpOAuthTokenRow(env, row) {
  await env.DB.prepare(
    `INSERT INTO mcp_workspace_tokens
       (id, workspace_id, tenant_id, label, token_hash, allowed_tools,
        repo_path, github_repo, rate_limit_per_hour, is_active, created_at, expires_at, user_id,
        token_type, created_by, scopes_json, allowed_capability_keys_json,
        allowed_lanes_json, allowed_risk_levels_json, allowed_domains_json, audience,
        refresh_token_hash, refresh_expires_at, client_id, external_client_key, authorization_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, unixepoch(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      row.id,
      row.workspace_id,
      row.tenant_id,
      row.label,
      row.token_hash,
      row.allowed_tools,
      row.repo_path,
      row.github_repo,
      row.rate_limit_per_hour,
      row.expires_at,
      row.user_id,
      'oauth',
      row.user_id,
      row.scopes_json,
      row.allowed_capability_keys_json,
      row.allowed_lanes_json,
      row.allowed_risk_levels_json,
      row.allowed_domains_json,
      row.audience,
      row.refresh_token_hash,
      row.refresh_expires_at,
      row.client_id,
      row.external_client_key,
      row.authorization_id,
    )
    .run();
}

async function buildAuthorizationCodeTokenContext(env, request, body) {
  if (!body.code) return { error: mcpOAuthJsonError('missing_code', 400) };
  if (!body.code_verifier) return { error: mcpOAuthJsonError('missing_code_verifier', 400) };
  if (!body.redirect_uri) return { error: mcpOAuthJsonError('missing_redirect_uri', 400) };

  const validated = await mcpOAuthValidateAuthorizationCode(env, body);
  if (!validated.ok) {
    await logMcpOAuthTokenFailure(env, request, validated.error, {
      client_id: body.client_id || null,
    });
    return { error: mcpOAuthJsonError(validated.error, 400) };
  }
  const authCodeRow = validated.row;
  const codeHash = validated.codeHash;

  const client = await mcpOAuthLoadClient(env, authCodeRow.client_id);
  if (!client) return { error: mcpOAuthJsonError('invalid_client', 400) };
  const clientAuthErr = await assertMcpOAuthTokenClientAuth(request, body, client, authCodeRow.client_id);
  if (clientAuthErr) {
    await logMcpOAuthTokenFailure(env, request, 'invalid_client', {
      client_id: body.client_id || authCodeRow.client_id,
      token_endpoint_auth_method: client.token_endpoint_auth_method,
    });
    return { error: clientAuthErr };
  }

  const consumed = await env.DB.prepare(
    `UPDATE oauth_authorization_codes SET used = 1 WHERE code = ? AND used = 0`,
  )
    .bind(codeHash)
    .run();
  if (!consumed?.meta?.changes) {
    await logMcpOAuthTokenFailure(env, request, 'invalid_grant_consumed', {
      client_id: body.client_id || authCodeRow.client_id,
    });
    return { error: mcpOAuthJsonError('invalid_grant_consumed', 400) };
  }

  const userId = String(authCodeRow.user_id || '').trim();
  if (!userId) return { error: mcpOAuthJsonError('invalid_user', 400) };

  const authRow = await env.DB.prepare(
    `SELECT id, email, name, tenant_id, person_uuid, role,
            0 AS is_superadmin_removed,
            account_type, COALESCE(iam_owned, 0) AS iam_owned,
            COALESCE(downgrade_protected, 0) AS downgrade_protected,
            default_workspace_id, active_workspace_id
       FROM auth_users
      WHERE id = ?
      LIMIT 1`,
  )
    .bind(userId)
    .first()
    .catch(() => null);

  const tenantId = String(authCodeRow.tenant_id || authRow?.tenant_id || env.TENANT_ID || '');
  let workspaceId = await resolveCanonicalWorkspace(env, userId);
  const operatorAtMint = await userMayUseWorkspaceCredentials(env, authRow, authRow?.active_workspace_id);
  const serviceLane = isIamServiceIdentityLane(authRow);
  if (!workspaceId && !operatorAtMint && !serviceLane) {
    await logMcpOAuthTokenFailure(env, request, 'invalid_workspace', {
      client_id: body.client_id || authCodeRow.client_id,
    });
    return {
      error: mcpOAuthJsonError('invalid_workspace', 400, mcpOAuthRecoveryExtras('invalid_workspace')),
    };
  }
  if (!workspaceId && (operatorAtMint || serviceLane)) {
    workspaceId =
      trim(authRow?.active_workspace_id) ||
      trim(authRow?.default_workspace_id) ||
      workspaceId;
  }
  // Do not pin operators to platformOperatorDefaultWorkspaceId. Token workspace_id
  // is audit/home only; tools target database_id / workspace_id / repo args.

  let boundResource = IAM_MCP_RESOURCE_URL;
  let authorizationId = null;
  try {
    const authz = await env.DB.prepare(
      `SELECT id, metadata_json FROM oauth_authorizations WHERE authorization_code_hash = ? LIMIT 1`,
    )
      .bind(codeHash)
      .first();
    authorizationId = authz?.id || null;
    const meta = parseMcpOAuthAuthorizationMetadata(authz?.metadata_json);
    if (meta.resource) boundResource = String(meta.resource);
    else if (meta.audience) boundResource = String(meta.audience);
  } catch (_) {}

  const tokenResourceRaw = body.resource || boundResource;
  const resourceCheck = assertMcpOAuthResourceMatches(tokenResourceRaw);
  if (!resourceCheck.ok) {
    await logMcpOAuthTokenFailure(env, request, resourceCheck.error, {
      client_id: body.client_id || authCodeRow.client_id,
    });
    return { error: mcpOAuthJsonError(resourceCheck.error, 400) };
  }
  if (
    body.resource &&
    normalizeMcpOAuthResourceUrl(body.resource) !== normalizeMcpOAuthResourceUrl(boundResource)
  ) {
    await logMcpOAuthTokenFailure(env, request, 'resource_mismatch', {
      client_id: body.client_id || authCodeRow.client_id,
    });
    return { error: mcpOAuthJsonError('invalid_resource', 400) };
  }

  const scope = String(authCodeRow.scope || mcpOAuthNormalizeScope('', client));
  let externalClientKey = null;
  try {
    const authz = await env.DB.prepare(
      `SELECT metadata_json FROM oauth_authorizations WHERE authorization_code_hash = ? LIMIT 1`,
    )
      .bind(codeHash)
      .first();
    const meta = parseMcpOAuthAuthorizationMetadata(authz?.metadata_json);
    externalClientKey = meta.external_client_key || null;
  } catch (_) {}
  if (!externalClientKey && authCodeRow.redirect_uri) {
    const { resolveExternalClientKeyFromRedirect } = await import('../core/mcp-oauth-external-clients.js');
    externalClientKey = await resolveExternalClientKeyFromRedirect(
      env,
      authCodeRow.redirect_uri,
      authCodeRow.client_id,
    );
  }

  const wsBindings = await loadWorkspaceMcpTokenBindings(env, workspaceId);
  const actorScope = {
    userId,
    workspaceId,
    tenantId: wsBindings.tenant_id || tenantId,
    personUuid: authRow?.person_uuid || null,
    clientId: authCodeRow.client_id,
  };

  let tokenToolKeys;
  let intersected;
  let domainsPayload;
  let oauthAllowedToolsJson;

  if (operatorAtMint || serviceLane) {
    tokenToolKeys = (await loadMcpOAuthExternalToolKeys(env, authCodeRow.client_id)) || [];
    intersected = { keys: tokenToolKeys, policy: { require_allowlist_for_mcp: 0 }, requireAllowlist: false };
    oauthAllowedToolsJson = null;
  } else {
    intersected = await intersectOAuthToolsWithUserPolicy(env, actorScope, authCodeRow.client_id);
    tokenToolKeys = intersected.keys;
    if (!tokenToolKeys.length) {
      const fallbackKeys = await loadMcpOAuthExternalToolKeys(env, MCP_CANONICAL_CLIENT_ID);
      if (fallbackKeys?.length) tokenToolKeys = fallbackKeys;
    }
    oauthAllowedToolsJson = tokenToolKeys.length ? JSON.stringify(tokenToolKeys) : '[]';
  }

  const allowlistRows = await loadMcpOAuthAllowlistRows(env, authCodeRow.client_id);
  const scopeWithAgent = augmentMcpOAuthScopeForWriteTools(scope, allowlistRows, tokenToolKeys);
  const entitlements = await buildMcpOAuthTokenEntitlements(
    env,
    authCodeRow.client_id,
    scopeWithAgent,
    tokenToolKeys,
  );
  domainsPayload = oauthToolAccessDomainsPayload(
    entitlements,
    operatorAtMint || serviceLane ? { require_allowlist_for_mcp: 0 } : intersected.policy,
    externalClientKey,
  );

  return {
    userId,
    authRow,
    authCodeRow,
    workspaceId,
    tenantId: wsBindings.tenant_id || tenantId,
    wsBindings,
    scope,
    scopeWithAgent,
    resourceCheck,
    externalClientKey,
    authorizationId,
    oauthAllowedToolsJson,
    entitlements,
    domainsPayload,
  };
}

async function issueMcpOAuthTokens(env, request, ctx) {
  const userRow = await env.DB.prepare(
    `SELECT id, role, tenant_id, person_uuid, 0 AS is_superadmin_removed,
            account_type, COALESCE(iam_owned, 0) AS iam_owned,
            COALESCE(downgrade_protected, 0) AS downgrade_protected,
            default_workspace_id, active_workspace_id
       FROM auth_users WHERE id = ? LIMIT 1`,
  )
    .bind(ctx.userId)
    .first()
    .catch(() => null);

  const operator = await userMayUseWorkspaceCredentials(env, userRow, userRow?.active_workspace_id);
  const serviceLane = isIamServiceIdentityLane(userRow);
  let workspaceId = ctx.workspaceId;
  let tenantId = ctx.tenantId;
  let allowedTools = ctx.oauthAllowedToolsJson;
  let domainsPayload = ctx.domainsPayload;

  if (operator) {
    tenantId = String(userRow?.tenant_id || ctx.tenantId || '').trim() || ctx.tenantId;
    allowedTools = null;
    try {
      const parsed = typeof domainsPayload === 'string' ? JSON.parse(domainsPayload) : { ...domainsPayload };
      parsed.require_allowlist_for_mcp = 0;
      parsed.tool_plane = 'user';
      domainsPayload = JSON.stringify(parsed);
    } catch {
      domainsPayload = JSON.stringify({ require_allowlist_for_mcp: 0, tool_plane: 'user' });
    }
  } else if (serviceLane) {
    workspaceId =
      trim(userRow?.active_workspace_id) ||
      trim(userRow?.default_workspace_id) ||
      ctx.workspaceId;
    allowedTools = null;
    try {
      const parsed = typeof domainsPayload === 'string' ? JSON.parse(domainsPayload) : { ...domainsPayload };
      parsed.require_allowlist_for_mcp = 0;
      parsed.tool_plane = 'user';
      domainsPayload = JSON.stringify(parsed);
    } catch {
      domainsPayload = JSON.stringify({ require_allowlist_for_mcp: 0, tool_plane: 'user' });
    }
  }

  const accessToken = mcpOAuthRandomToken('mcp_oauth', 32);
  const refreshToken = mcpOAuthRandomToken('mcp_rfr', 32);
  const tokenHash = await mcpOAuthSha256Hex(accessToken);
  const refreshHash = await mcpOAuthSha256Hex(refreshToken);
  const now = mcpOAuthNow();
  const accessTtl = resolveMcpOAuthAccessTtlSeconds(env, ctx.externalClientKey);
  const expiresAt = now + accessTtl;
  const refreshExpiresAt = now + MCP_OAUTH_REFRESH_TOKEN_TTL_SECONDS;

  await insertMcpOAuthTokenRow(env, {
    id: `tok_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`,
    workspace_id: workspaceId,
    tenant_id: tenantId,
    label: `MCP OAuth ${ctx.authRow?.email || ctx.userId}`,
    token_hash: tokenHash,
    allowed_tools: allowedTools,
    repo_path: null,
    github_repo: null,
    rate_limit_per_hour: 100,
    expires_at: expiresAt,
    user_id: ctx.userId,
    scopes_json: JSON.stringify(ctx.scopeWithAgent.split(/\s+/).filter(Boolean)),
    allowed_capability_keys_json: JSON.stringify(ctx.entitlements.capabilityKeys),
    allowed_lanes_json: JSON.stringify(ctx.entitlements.lanes),
    allowed_risk_levels_json: JSON.stringify(ctx.entitlements.riskLevels),
    allowed_domains_json: domainsPayload,
    audience: ctx.resourceCheck.resource,
    refresh_token_hash: refreshHash,
    refresh_expires_at: refreshExpiresAt,
    client_id: ctx.authCodeRow?.client_id || ctx.clientId || null,
    external_client_key: ctx.externalClientKey || null,
    authorization_id: ctx.authorizationId || null,
  });

  await logMcpTokenIssued(env, request, ctx.userId, {
    client_id: ctx.authCodeRow?.client_id || ctx.clientId || null,
    workspace_id: workspaceId,
  });

  await logAuthEvent(env, {
    request,
    eventType: 'iam_mcp_oauth_token_issued',
    userId: ctx.userId,
    metadata: {
      client_id: ctx.authCodeRow?.client_id || ctx.clientId || null,
      workspace_id: workspaceId,
      ...mcpOAuthRequestMeta(request),
    },
  }).catch(() => {});

  const scopeList = mcpOAuthParseScopeList(ctx.scope);
  const tokenBody = {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: accessTtl,
    scope: ctx.scope,
    resource: ctx.resourceCheck.resource,
  };

  if (scopeList.includes('openid')) {
    try {
      tokenBody.id_token = await signIamOidcIdToken(
        env,
        buildIamMcpIdTokenClaims({
          issuer: IAM_OAUTH_ISSUER,
          userId: ctx.userId,
          email: ctx.authRow?.email || null,
          name: ctx.authRow?.name || null,
          clientId: ctx.authCodeRow?.client_id || ctx.clientId,
          audience: ctx.resourceCheck.resource,
          authTime: now,
        }),
        accessTtl,
      );
    } catch (e) {
      await logMcpOAuthTokenFailure(env, request, 'id_token_sign_failed', {
        client_id: ctx.authCodeRow?.client_id || ctx.clientId,
        detail: String(e?.message || e),
      });
      return { error: mcpOAuthJsonError('server_error', 500) };
    }
  }

  return { tokenBody };
}

export async function handleMcpOAuthAuthorizationCodeGrant(request, env, body) {
  const built = await buildAuthorizationCodeTokenContext(env, request, body);
  if (built.error) return built.error;

  const issued = await issueMcpOAuthTokens(env, request, built);
  if (issued.error) return issued.error;
  return jsonResponse(issued.tokenBody);
}

export async function handleMcpOAuthRefreshTokenGrant(request, env, body) {
  const refreshRaw = String(body.refresh_token || '').trim();
  if (!refreshRaw) {
    await logMcpOAuthTokenFailure(env, request, 'missing_refresh_token', {});
    return mcpOAuthJsonError('invalid_request', 400);
  }

  const refreshHash = await mcpOAuthSha256Hex(refreshRaw);
  const now = mcpOAuthNow();

  const row = await env.DB.prepare(
    `SELECT *
       FROM mcp_workspace_tokens
      WHERE refresh_token_hash = ?
        AND token_type = 'oauth'
        AND COALESCE(is_active, 0) = 1
        AND (revoked_at IS NULL OR revoked_at = 0)
      LIMIT 1`,
  )
    .bind(refreshHash)
    .first();

  if (!row) {
    await logMcpOAuthTokenFailure(env, request, 'invalid_grant', { grant: 'refresh_token' });
    return mcpOAuthJsonError('invalid_grant', 400);
  }

  const refreshExpiresAt = Number(row.refresh_expires_at || 0);
  if (!refreshExpiresAt || refreshExpiresAt <= now) {
    await logMcpOAuthTokenFailure(env, request, 'invalid_grant_expired', {
      grant: 'refresh_token',
      token_id: row.id,
      ...mcpOAuthRecoveryExtras('invalid_grant_expired'),
    });
    return mcpOAuthJsonError('invalid_grant_expired', 400, mcpOAuthRecoveryExtras('invalid_grant_expired'));
  }

  const storedClientId = parseOAuthClientIdFromDomains(row.allowed_domains_json);
  const bodyClientId = String(body.client_id || '').trim();
  if (bodyClientId && storedClientId && bodyClientId !== storedClientId) {
    await logMcpOAuthTokenFailure(env, request, 'invalid_client', { grant: 'refresh_token' });
    return mcpOAuthJsonError('invalid_client', 401);
  }

  if (storedClientId) {
    const client = await mcpOAuthLoadClient(env, storedClientId);
    if (!client) return mcpOAuthJsonError('invalid_client', 400);
    const clientAuthErr = await assertMcpOAuthTokenClientAuth(request, body, client, storedClientId);
    if (clientAuthErr) return clientAuthErr;
  }

  const externalClientKey = parseExternalClientKeyFromDomains(row.allowed_domains_json);
  const accessTtl = resolveMcpOAuthAccessTtlSeconds(env, externalClientKey);
  const newAccess = mcpOAuthRandomToken('mcp_oauth', 32);
  const newRefresh = mcpOAuthRandomToken('mcp_rfr', 32);
  const newAccessHash = await mcpOAuthSha256Hex(newAccess);
  const newRefreshHash = await mcpOAuthSha256Hex(newRefresh);
  const newExpiresAt = now + accessTtl;

  const rotated = await env.DB.prepare(
    `UPDATE mcp_workspace_tokens
        SET token_hash = ?,
            refresh_token_hash = ?,
            expires_at = ?,
            last_used_at = unixepoch()
      WHERE id = ?
        AND refresh_token_hash = ?
        AND COALESCE(is_active, 0) = 1`,
  )
    .bind(newAccessHash, newRefreshHash, newExpiresAt, row.id, refreshHash)
    .run();

  if (!rotated?.meta?.changes) {
    await logMcpOAuthTokenFailure(env, request, 'invalid_grant_consumed', { grant: 'refresh_token' });
    return mcpOAuthJsonError('invalid_grant', 400);
  }

  const scope = scopesFromRow(row) || 'mcp:tools';
  await logMcpTokenRefresh(env, request, row.user_id, {
    token_id: row.id,
    workspace_id: row.workspace_id,
    client_id: storedClientId,
  });

  return jsonResponse({
    access_token: newAccess,
    refresh_token: newRefresh,
    token_type: 'Bearer',
    expires_in: accessTtl,
    scope,
    resource: row.audience || IAM_MCP_RESOURCE_URL,
  });
}

export async function dispatchMcpOAuthTokenRequest(request, env, _ctx) {
  if (!env.DB) return mcpOAuthJsonError('database_not_configured', 503);

  const rl = await checkMcpOAuthRateLimit(env, request, 'token', 90);
  if (!rl.ok) return mcpOAuthJsonError(rl.error, 429, { retry_after: rl.retry_after });

  const body = await mcpOAuthReadBody(request);
  const grantType = String(body.grant_type || 'authorization_code').trim();

  if (grantType === 'refresh_token') {
    return handleMcpOAuthRefreshTokenGrant(request, env, body);
  }
  if (grantType === 'authorization_code') {
    return handleMcpOAuthAuthorizationCodeGrant(request, env, body);
  }
  return mcpOAuthJsonError('unsupported_grant_type', 400);
}
