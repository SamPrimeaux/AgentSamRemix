/**
 * D1-driven external MCP client registry + per-user client allowlist.
 * Tables: agentsam_mcp_oauth_external_client_registry,
 *         agentsam_mcp_oauth_user_client_allowlist
 *
 * Law: user_client_allowlist is NOT optional. Consent grants a row keyed by
 * (user_id, client_key); runtime (tools/call) requires an active grant.
 * Workspace membership is a separate token/consent concern — never part of
 * the host-grant primary key. Revoke (is_active=0) always blocks.
 */

import { mcpOAuthIsCursorAgentsRedirect } from '../api/mcp-oauth-shared.js';

/** Platform catalog client — registry rows hang off this id; DCR clients still resolve by redirect host. */
const MCP_CANONICAL_CLIENT_ID = 'iam_mcp_inneranimalmedia';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function parseJsonArray(raw) {
  if (!raw) return [];
  try {
    const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

/**
 * Resolve registry client_key from OAuth redirect_uri (DB patterns first, code fallback).
 * Registry rows are keyed to the platform catalog client; DCR clients still resolve via host/scheme.
 */
export async function resolveExternalClientKeyFromRedirect(env, redirectUri, _oauthClientId = MCP_CANONICAL_CLIENT_ID) {
  const raw = trim(redirectUri);
  if (!raw) return null;

  if (raw.toLowerCase().startsWith('cursor://')) return 'cursor';

  let host = '';
  let path = '';
  try {
    const u = new URL(raw);
    host = u.hostname.toLowerCase();
    path = u.pathname.toLowerCase();
  } catch {
    return null;
  }

  // Cursor desktop callback listener (DCR)
  if ((host === 'localhost' || host === '127.0.0.1' || host === '[::1]') && path === '/callback') {
    return 'cursor';
  }

  try {
    if (mcpOAuthIsCursorAgentsRedirect(new URL(raw))) return 'cursor';
  } catch {
    // Invalid URL already returned null above.
  }

  if (env?.DB) {
    try {
      const { results } = await env.DB.prepare(
        `SELECT client_key, redirect_host_patterns
           FROM agentsam_mcp_oauth_external_client_registry
          WHERE oauth_client_id = ?
            AND COALESCE(is_active, 1) = 1
          ORDER BY sort_order ASC`,
      )
        .bind(MCP_CANONICAL_CLIENT_ID)
        .all();

      for (const row of results || []) {
        const patterns = parseJsonArray(row.redirect_host_patterns).map((h) =>
          trim(h).toLowerCase(),
        );
        if (!patterns.length) continue;
        const hostMatch = patterns.some((p) => host === p || host.endsWith(`.${p}`));
        if (!hostMatch) continue;
        const key = trim(row.client_key);
        if (key === 'cursor' && raw.toLowerCase().startsWith('cursor://')) {
          return key;
        }
        if (key === 'cursor' && (host === 'localhost' || host === '127.0.0.1')) {
          return key;
        }
        if (key === 'cursor' && host === 'mcp.inneranimalmedia.com' && !path.includes('/auth/callback')) {
          continue;
        }
        if (key === 'cursor' && (host === 'cursor.com' || host === 'www.cursor.com')) {
          if (path.replace(/\/$/, '') !== '/agents/mcp/oauth/callback') continue;
          return key;
        }
        if (key === 'chatgpt' && !(path.includes('connector') || path.includes('oauth'))) {
          if (host !== 'chatgpt.com' && host !== 'chat.openai.com') continue;
        }
        return key;
      }
    } catch (_) {}
  }

  if (host === 'claude.ai' || host === 'claude.com') return 'claude';
  if (
    host === 'chatgpt.com' ||
    host === 'chat.openai.com' ||
    path.includes('connector_platform_oauth') ||
    path.startsWith('/connector/oauth/')
  ) {
    return 'chatgpt';
  }
  if (host === 'mcp.inneranimalmedia.com' && path.includes('/auth/callback')) return 'cursor';
  if (raw.toLowerCase().startsWith('cursor://')) return 'cursor';
  try {
    if (mcpOAuthIsCursorAgentsRedirect(new URL(raw))) return 'cursor';
  } catch {
    return null;
  }
  return null;
}

/**
 * Gate external MCP hosts (cursor / claude / chatgpt / …).
 *
 * @param {any} env
 * @param {{
 *   userId: string,
 *   workspaceId?: string,
 *   externalClientKey: string|null,
 *   oauthClientId?: string,
 *   requireGrant?: boolean
 * }} input
 *   requireGrant=true → runtime (tools/call): active allowlist row required
 *   requireGrant=false → authorize/consent: registry + not-revoked; consent then writes the grant
 *   workspaceId is ignored for grant identity (kept on callers for token/membership).
 */
export async function assertUserMayUseExternalClient(env, input) {
  const userId = trim(input?.userId);
  const clientKey = trim(input?.externalClientKey);
  const requireGrant = input?.requireGrant === true;

  if (!clientKey) {
    return {
      ok: false,
      code: 'unknown_external_client',
      message: 'redirect_uri does not match a registered external MCP client',
    };
  }
  if (!userId) {
    return { ok: false, code: 'missing_scope', message: 'user_id and client_key required for host grant' };
  }
  if (!env?.DB) {
    return { ok: false, code: 'missing_scope', message: 'user_id and client_key required for host grant' };
  }

  try {
    const reg = await env.DB.prepare(
      `SELECT client_key FROM agentsam_mcp_oauth_external_client_registry
        WHERE client_key = ?
          AND COALESCE(is_active, 1) = 1
        LIMIT 1`,
    )
      .bind(clientKey)
      .first();
    if (!reg) {
      return {
        ok: false,
        code: 'external_client_inactive',
        message: `External client "${clientKey}" is not active in agentsam_mcp_oauth_external_client_registry`,
      };
    }

    const { results: userRows } = await env.DB.prepare(
      `SELECT client_key, is_active FROM agentsam_mcp_oauth_user_client_allowlist
        WHERE user_id = ? AND client_key = ?`,
    )
      .bind(userId, clientKey)
      .all();

    const rows = userRows || [];
    const revoked = rows.some((r) => Number(r.is_active) === 0);
    if (revoked) {
      return {
        ok: false,
        code: 'external_client_not_allowed',
        message: `External MCP client "${clientKey}" was revoked for this user.`,
      };
    }

    const hasGrant = rows.some((r) => Number(r.is_active) !== 0);

    if (requireGrant && !hasGrant) {
      return {
        ok: false,
        code: 'external_client_not_allowed',
        message: `No active agentsam_mcp_oauth_user_client_allowlist grant for "${clientKey}". Complete MCP OAuth consent first.`,
      };
    }

    return {
      ok: true,
      enforced: true,
      has_grant: hasGrant,
      client_key: clientKey,
    };
  } catch (e) {
    return { ok: false, code: 'allowlist_lookup_failed', message: String(e?.message || e) };
  }
}

/** List active registry clients (admin / settings). */
export async function listExternalClientRegistry(env, oauthClientId = MCP_CANONICAL_CLIENT_ID) {
  if (!env?.DB) return [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT client_key, display_name, oauth_client_id, redirect_host_patterns, sort_order, notes
         FROM agentsam_mcp_oauth_external_client_registry
        WHERE oauth_client_id = ? AND COALESCE(is_active, 1) = 1
        ORDER BY sort_order ASC`,
    )
      .bind(trim(oauthClientId) || MCP_CANONICAL_CLIENT_ID)
      .all();
    return results || [];
  } catch {
    return [];
  }
}

/**
 * Record external client allowlist on successful OAuth consent (user+host, not migration-seeded).
 * workspaceId is last-consent audit only — not grant identity.
 */
export async function recordExternalClientAllowlistOnConsent(env, input) {
  const userId = trim(input?.userId);
  const workspaceId = trim(input?.workspaceId) || null;
  const clientKey = trim(input?.externalClientKey);
  const tenantId = trim(input?.tenantId) || null;
  if (!env?.DB || !userId || !clientKey) return { ok: false, code: 'missing_scope' };

  try {
    await env.DB.prepare(
      `INSERT INTO agentsam_mcp_oauth_user_client_allowlist
         (user_id, client_key, workspace_id, tenant_id, is_active, notes, updated_at)
       VALUES (?, ?, ?, ?, 1, 'Granted via MCP OAuth consent', unixepoch())
       ON CONFLICT(user_id, client_key) DO UPDATE SET
         is_active = 1,
         workspace_id = COALESCE(excluded.workspace_id, workspace_id),
         tenant_id = COALESCE(excluded.tenant_id, tenant_id),
         updated_at = unixepoch()`,
    )
      .bind(userId, clientKey, workspaceId, tenantId)
      .run();
    return { ok: true, client_key: clientKey };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/** User host-grant rows (not workspace-scoped). */
export async function listUserExternalClientAllowlist(env, userId, _workspaceId = null) {
  if (!env?.DB || !trim(userId)) return [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT client_key, workspace_id, tenant_id, notes, is_active, created_at, updated_at
         FROM agentsam_mcp_oauth_user_client_allowlist
        WHERE user_id = ?
        ORDER BY client_key ASC`,
    )
      .bind(trim(userId))
      .all();
    return results || [];
  } catch {
    return [];
  }
}
