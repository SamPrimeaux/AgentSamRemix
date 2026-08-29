/** MCP catalog row executor. */
/**
 * Execute agentsam_tools rows by handler_type + handler_config only.
 * No hardcoded tool_key / tool_name branches.
 *
 * Credential resolution: backend/credentials/resolver.js (resolveCredential).
 */

import { parseInput, safeJsonString, summarizeOutput, writeTelemetryError, insertToolCallLog, bindingBucket, wrapWorkspaceShellCommand } from '../../backend/services/tools/shared.js';
import { parseHandlerConfig } from '../../backend/credentials/resolver.js';
import { resolveMcpServerForTool } from './mcp-servers.js';
import { resolveOutboundBridgeKey } from '../../backend/auth/bridge-key-auth.js';

function trimMcpValue(v) {
  if (v == null) return '';
  return String(v).trim();
}

function resolveMcpRemoteToolName(mcpRow, config) {
  const remote = trimMcpValue(config?.remote_tool || config?.operation);
  if (remote) return remote;
  const toolName = trimMcpValue(mcpRow.tool_name || mcpRow.tool_key);
  if (/^agentsam_(gh_|gmail_mcp_)/i.test(toolName)) return '';
  return toolName;
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} mcpRow
 * @param {Record<string, unknown>} params
 * @param {Record<string, unknown>} runContext
 */
export async function executeMcpCatalogRow(env, mcpRow, params, runContext) {
  const config = parseHandlerConfig(mcpRow.handler_config);
  const toolKey = trimMcpValue(mcpRow.tool_key || mcpRow.tool_name);
  let mcpCallName = resolveMcpRemoteToolName(mcpRow, config) || toolKey;
  const tenantId = trimMcpValue(runContext.tenantId ?? runContext.tenant_id);
  const userId = trimMcpValue(runContext.userId ?? runContext.user_id);
  const workspaceId = trimMcpValue(runContext.workspaceId ?? runContext.workspace_id);

  // Prefer ownership-law catalog for D1 list — never Bindings MCP tools/call (406 without session/Accept).
  {
    const { resolveCfMcpRemoteToolName, listCallerVisibleD1Databases } = await import('./cf-mcp-proxy.js');
    const remote = resolveCfMcpRemoteToolName(config, params) || mcpCallName;
    if (remote === 'd1_databases_list' || toolKey === 'agentsam_cf_d1_list') {
      try {
        const listed = await listCallerVisibleD1Databases(
          env,
          userId,
          runContext?.authUser ?? runContext?.user ?? null,
        );
        if (!listed.cloudflare_connected && !listed.operator) {
          return {
            ok: false,
            error: 'cloudflare_not_connected',
            failed_tool: toolKey,
            reauth_required: true,
            body: { user_message: 'Connect Cloudflare in Integrations.' },
          };
        }
        const { formatD1ListToolBody } = await import('./d1-list-workspace-annotate.js');
        return {
          ok: true,
          body: await formatD1ListToolBody(env, workspaceId, listed),
        };
      } catch (e) {
        return {
          ok: false,
          error: e?.message ?? 'd1_databases_list_failed',
          failed_tool: toolKey,
          body: {
            user_message:
              'Could not list D1 databases for the connected Cloudflare account. Check token scopes (Account D1 Read) and retry.',
          },
        };
      }
    }
  }

  const toolForResolve = {
    ...mcpRow,
    server_key: mcpRow.server_key || config.server_key,
    mcp_service_url: mcpRow.mcp_service_url || config.mcp_service_url,
    handler_config: mcpRow.handler_config,
  };
  const { url, serverRow } = await resolveMcpServerForTool(env, {
    tenantId,
    workspaceId,
  }, toolForResolve);

  if (url) {
    const headers = { 'Content-Type': 'application/json' };
    const authType = String(serverRow?.auth_type || '').toLowerCase();
    const authSource = String(config.auth_source || '').toLowerCase();
    const provider = String(config.provider || '').toLowerCase();
    const needsGithubUserToken =
      authType === 'user_oauth_github' ||
      authSource === 'user_oauth_github' ||
      (authSource === 'user_oauth_tokens' && provider === 'github');
    const needsGmailUserToken =
      authType === 'user_oauth_gmail' ||
      authSource === 'user_oauth_gmail' ||
      (authSource === 'user_oauth_tokens' &&
        (provider === 'google_gmail' || provider === 'gmail')) ||
      String(url || '').includes('gmailmcp.googleapis.com');
    const serverKey = trimMcpValue(serverRow?.server_key || toolForResolve.server_key || config.server_key);
    const needsCloudflareUserToken =
      authType === 'user_oauth_cloudflare' ||
      (authSource === 'user_oauth_tokens' && provider === 'cloudflare') ||
      serverKey === 'cloudflare-bindings' ||
      String(url || '').includes('bindings.mcp.cloudflare.com');

    if (needsGithubUserToken) {
      if (!userId || !String(userId).startsWith('au_')) {
        return {
          ok: false,
          error: 'auth_user_id_required',
          failed_tool: toolKey,
          body: {
            user_message:
              'This GitHub tool requires an authenticated auth_users.id (au_*) session.',
          },
        };
      }
      const { getUserGithubToken } = await import('../integrations/github.js');
      const account = trimMcpValue(
        params.account_identifier ?? params.account ?? params.provider_account_id,
      );
      const gh = await getUserGithubToken(env, userId, account);
      const accessToken = gh?.token ? String(gh.token).trim() : '';
      if (!accessToken) {
        return {
          ok: false,
          error: 'github_not_connected',
          failed_tool: toolKey,
          reauth_required: true,
          body: { user_message: 'Connect GitHub in Integrations before using GitHub MCP tools.' },
        };
      }
      headers.Authorization = `Bearer ${accessToken}`;
    } else if (needsGmailUserToken) {
      if (!userId) {
        return {
          ok: false,
          error: 'user_oauth_required',
          failed_tool: toolKey,
          body: {
            user_message: 'This Gmail tool requires an authenticated user session.',
            connect_url: '/api/integrations/gmail/connect?return_to=/dashboard/settings/integrations',
          },
        };
      }
      const { getGmailTokenRowForUser } = await import('./gmail-user-tokens.js');
      const { resolveOAuthAccessToken } = await import('../api/oauth.js');
      const account = trimMcpValue(
        params.account_identifier ?? params.account ?? params.provider_account_id,
      );
      const authUser = {
        id: userId,
        email: trimMcpValue(runContext?.userEmail ?? runContext?.email),
      };
      const gmailRow = await getGmailTokenRowForUser(env, authUser, account || null);
      let accessToken = gmailRow ? await resolveOAuthAccessToken(env, gmailRow) : '';
      accessToken = accessToken ? String(accessToken).trim() : '';
      if (!accessToken && gmailRow) {
        const { getIntegrationOAuthRow } = await import('../../backend/identity/oauth/user-token.js');
        const refreshed = await getIntegrationOAuthRow(env, userId, 'google_gmail', account);
        accessToken = refreshed?.access_token ? String(refreshed.access_token).trim() : '';
      }
      if (!accessToken) {
        return {
          ok: false,
          error: 'gmail_not_connected',
          failed_tool: toolKey,
          reauth_required: true,
          body: {
            user_message: 'Connect Gmail in Integrations before using Gmail MCP tools.',
            connect_url: '/api/integrations/gmail/connect?return_to=/dashboard/settings/integrations',
          },
        };
      }
      headers.Authorization = `Bearer ${accessToken}`;
      headers.Accept = 'application/json, text/event-stream';
    } else if (needsCloudflareUserToken) {
      const {
        prepareCfMcpCloudflareCall,
        resolveCfMcpRemoteToolName,
      } = await import('./cf-mcp-proxy.js');
      mcpCallName = resolveCfMcpRemoteToolName(config, params) || mcpCallName;
      const prepared = await prepareCfMcpCloudflareCall(
        env,
        {
          userId,
          workspaceId,
          tenantId,
          authUser: runContext?.authUser ?? runContext?.user ?? null,
        },
        mcpCallName,
        params,
        config,
      );
      if (!prepared.ok || !prepared.token) {
        return {
          ok: false,
          error: prepared.error || 'cloudflare_not_connected',
          failed_tool: toolKey,
          reauth_required: prepared.reauth_required === true,
          body: { user_message: prepared.user_message || 'Connect Cloudflare in Integrations.' },
        };
      }
      // Streamable HTTP Bindings MCP requires this Accept (same as Gmail MCP). Missing it → HTTP 406.
      headers.Accept = 'application/json, text/event-stream';
      headers['MCP-Protocol-Version'] = '2025-03-26';
      headers.Authorization = `Bearer ${prepared.token}`;
      params = prepared.params;

      // List D1 via ownership-law catalog (filters platform D1 for non-operators).
      if (mcpCallName === 'd1_databases_list') {
        try {
          const { listCallerVisibleD1Databases } = await import('./cf-mcp-proxy.js');
          const listed = await listCallerVisibleD1Databases(
            env,
            userId,
            runContext?.authUser ?? runContext?.user ?? null,
          );
          const { formatD1ListToolBody } = await import('./d1-list-workspace-annotate.js');
          return {
            ok: true,
            body: await formatD1ListToolBody(env, workspaceId, listed),
          };
        } catch (e) {
          return {
            ok: false,
            error: e?.message ?? 'd1_databases_list_failed',
            failed_tool: toolKey,
            body: {
              user_message:
                'Could not list D1 databases for the connected Cloudflare account. Check token scopes (Account D1 Read) and retry.',
            },
          };
        }
      }
    } else {
      const mcpToken = env?.MCP_AUTH_TOKEN != null ? String(env.MCP_AUTH_TOKEN).trim() : '';
      const bridgeKey = resolveOutboundBridgeKey(env);
      if (mcpToken) {
        headers.Authorization = `Bearer ${mcpToken}`;
      } else if (bridgeKey) {
        headers.Authorization = `Bearer ${bridgeKey}`;
        headers['X-Internal-Secret'] = bridgeKey;
        headers['X-IAM-Service-Key'] = bridgeKey;
      }
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: mcpCallName, arguments: params },
      }),
    }).catch((e) => ({ ok: false, status: 0, _err: e }));

    if (!res?.ok) {
      const status = res?.status ?? 0;
      if (status === 401 && needsGithubUserToken) {
        return {
          ok: false,
          error: 'github_reauth_required',
          failed_tool: toolKey,
          reauth_required: true,
          body: { user_message: 'GitHub token expired or was revoked. Reconnect GitHub in Integrations.' },
        };
      }
      if (status === 401 && needsGmailUserToken) {
        return {
          ok: false,
          error: 'gmail_reauth_required',
          failed_tool: toolKey,
          reauth_required: true,
          body: {
            user_message: 'Gmail token expired or was revoked. Reconnect Gmail in Integrations.',
            connect_url: '/api/integrations/gmail/connect?return_to=/dashboard/settings/integrations',
          },
        };
      }
      if (status === 401 && needsCloudflareUserToken) {
        return {
          ok: false,
          error: 'cloudflare_reauth_required',
          failed_tool: toolKey,
          reauth_required: true,
          body: {
            user_message:
              'Cloudflare OAuth token expired or was revoked. Reconnect Cloudflare Developer Platform in Integrations.',
          },
        };
      }
      if (
        status === 401 &&
        /memory/i.test(toolKey) &&
        tenantId &&
        userId &&
        workspaceId
      ) {
        const { recordMcpMemoryAuthFailure } = await import('../../backend/http/agentsam/routes/private-memory.js');
        const attemptedKey = String(
          params?.key ?? params?.memory_key ?? params?.memoryKey ?? 'unknown',
        );
        const fail = await recordMcpMemoryAuthFailure(env, {
          tenantId,
          workspaceId,
          userId,
          toolName: toolKey,
          attemptedKey,
          ctx: runContext,
        });
        return {
          ok: false,
          error: fail.error ?? 'reauth_required',
          failed_tool: fail.failed_tool ?? toolKey,
          attempted_key: fail.attempted_key,
          manual_fallback: fail.manual_fallback,
          reauth_required: true,
          body: fail,
        };
      }
      return {
        ok: false,
        error: `mcp HTTP ${status}: ${res?._err?.message ?? mcpCallName}`,
        failed_tool: toolKey,
        reauth_required: status === 401,
      };
    }
    if (needsCloudflareUserToken) {
      const { normalizeCfMcpToolResultBody, parseCfBindingsMcpResponseText } = await import(
        './cf-mcp-proxy.js'
      );
      // Bindings MCP always responds with SSE; res.json() silently yields {}.
      const rawText = typeof res.text === 'function' ? await res.text().catch(() => '') : '';
      const body = parseCfBindingsMcpResponseText(rawText);
      const normalized = normalizeCfMcpToolResultBody(body);
      if (
        normalized &&
        typeof normalized === 'object' &&
        /** @type {any} */ (normalized).ok === false &&
        /** @type {any} */ (normalized).error
      ) {
        return {
          ok: false,
          error: String(/** @type {any} */ (normalized).error || 'cf_mcp_error'),
          failed_tool: toolKey,
          body: normalized,
        };
      }
      return { ok: true, body: normalized };
    }
    const body = await res.json().catch(() => ({}));
    return { ok: true, body };
  }

  return {
    ok: false,
    error: `mcp tool ${toolKey}: no mcp_service_url or server row`,
  };
}

