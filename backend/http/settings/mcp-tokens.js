/**
 * MCP workspace token CRUD.
 * - GET    /api/settings/mcp-tokens
 * - POST   /api/settings/mcp-tokens
 * - DELETE /api/settings/mcp-tokens/:id
 * Deconstructed from src/api/settings.js (Lane D peel D3, no behavior change).
 */
import { jsonResponse } from '../agentsam/shared.js';
import { fetchAuthUserTenantId } from '../../identity/users/tenant.js';
import { generateMcpToken } from '../../identity/tokens/mcp-bearer.js';

async function resolveAuthTenantId(env, authUser) {
  if (authUser.tenant_id != null && String(authUser.tenant_id).trim() !== '') {
    return String(authUser.tenant_id).trim();
  }
  let tid = await fetchAuthUserTenantId(env, authUser.id);
  if (tid) return tid;
  if (authUser.email) {
    tid = await fetchAuthUserTenantId(env, authUser.email);
    if (tid) return tid;
  }
  return null;
}

async function resolveRequestWorkspaceId(env, authUser, url) {
  const fromQuery = url.searchParams.get('workspace_id');
  if (fromQuery != null && String(fromQuery).trim() !== '') return String(fromQuery).trim();
  if (!env?.DB) return '';
  const uid = String(authUser?.id || '').trim();
  try {
    const row = await env.DB.prepare(
      `SELECT default_workspace_id FROM user_settings WHERE user_id = ? LIMIT 1`,
    )
      .bind(uid)
      .first();
    if (row?.default_workspace_id != null && String(row.default_workspace_id).trim() !== '') {
      return String(row.default_workspace_id).trim();
    }
  } catch (_) {
    /* legacy schema */
  }
  try {
    const row = await env.DB.prepare(
      `SELECT active_workspace_id FROM auth_users WHERE id = ? LIMIT 1`,
    )
      .bind(uid)
      .first();
    if (row?.active_workspace_id != null && String(row.active_workspace_id).trim() !== '') {
      return String(row.active_workspace_id).trim();
    }
  } catch (_) {
    /* ignore */
  }
  return '';
}

export async function handleSettingsMcpTokensRoutes(request, env, ctx, authContext) {
  void ctx;
  const { authUser, url, pathLower, method } = authContext || {};
  if (!authUser) return null;

  // ── /api/settings/mcp-tokens (GET list, POST create, DELETE /:id revoke) ───
  const mcpTokensPathMatch = pathLower.match(/^\/api\/settings\/mcp-tokens(?:\/([^/]+))?$/);
  if (mcpTokensPathMatch) {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const workspaceId = await resolveRequestWorkspaceId(env, authUser, url);
    const tenantId = await resolveAuthTenantId(env, authUser);
    if (!workspaceId || !tenantId) {
      return jsonResponse({ error: 'no_workspace', redirect: '/onboarding' }, 403);
    }
    const tokenId = mcpTokensPathMatch[1] ? decodeURIComponent(mcpTokensPathMatch[1]).trim() : '';

    if (!tokenId && method === 'GET') {
      try {
        const { results } = await env.DB.prepare(
          `SELECT id, label, rate_limit_per_hour, is_active, expires_at, created_at, last_used_at, allowed_tools
           FROM mcp_workspace_tokens
           WHERE tenant_id = ? AND workspace_id = ? AND COALESCE(is_active, 1) = 1
           ORDER BY created_at DESC LIMIT 50`,
        )
          .bind(tenantId, workspaceId)
          .all();
        return jsonResponse({ tokens: results || [] });
      } catch (e) {
        return jsonResponse({ error: e?.message ?? String(e) }, 500);
      }
    }

    if (!tokenId && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const label = typeof body?.label === 'string' ? body.label.trim() : '';
      const allowedTools = body?.allowedTools ?? body?.allowed_tools ?? null;
      const expiresInDays = body?.expiresInDays ?? body?.expires_in_days ?? null;
      const rateParsed = Number(body?.rateLimitPerHour ?? body?.rate_limit_per_hour);
      const rateLimitPerHour =
        Number.isFinite(rateParsed) && rateParsed > 0 ? Math.min(10000, Math.floor(rateParsed)) : 1000;
      try {
        const result = await generateMcpToken(env, {
          userId: String(authUser.id || '').trim(),
          workspaceId,
          tenantId,
          label: label || `${authUser.name || authUser.email || 'User'} MCP token`,
          allowedTools: allowedTools || null,
          rateLimitPerHour,
          expiresInDays: expiresInDays || null,
        });
        return jsonResponse({
          ok: true,
          bearer: result.bearer,
          tokenId: result.tokenId,
          warning: 'Save this bearer — it will not be shown again.',
        });
      } catch (e) {
        return jsonResponse({ error: e?.message || String(e) }, 500);
      }
    }

    if (tokenId && method === 'DELETE') {
      try {
        await env.DB.prepare(
          `UPDATE mcp_workspace_tokens SET is_active = 0, revoked_at = unixepoch()
           WHERE id = ? AND tenant_id = ? AND workspace_id = ?`,
        )
          .bind(tokenId, tenantId, workspaceId)
          .run();
        return jsonResponse({ ok: true });
      } catch (e) {
        return jsonResponse({ error: e?.message ?? String(e) }, 500);
      }
    }

    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  return null;
}
