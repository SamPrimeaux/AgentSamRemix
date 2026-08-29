/**
 * API: MCP Calls
 * GET /api/mcp/tool-calls
 */
import { jsonResponse, resolveAgentsamUserKey, resolveTenantIdForWorker } from '../core/auth.js';

export async function handleMcpToolCallsApi(request, url, env, ctx, authUser) {
  void ctx;
  const pathLower = url.pathname.replace(/\/$/, '').toLowerCase();
  const method = (request.method || 'GET').toUpperCase();

  if (pathLower !== '/api/mcp/tool-calls' || method !== 'GET') {
    return null;
  }

  if (!env?.DB) return jsonResponse({ error: 'DB not configured' }, 503);
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
  await resolveAgentsamUserKey(env, authUser).catch(() => null);

  const daysRaw = parseInt(url.searchParams.get('days') || '7', 10) || 7;
  const days = Math.min(90, Math.max(1, daysRaw));
  const limitRaw = parseInt(url.searchParams.get('limit') || '100', 10) || 100;
  const limit = Math.min(500, Math.max(1, limitRaw));

  const tenantId = resolveTenantIdForWorker(authUser, env) || 'iam';

  try {
    const { results } = await env.DB.prepare(
      `SELECT tc.id, tc.tenant_id, tc.user_id, tc.tool_name, tc.tool_key,
        CASE
          WHEN COALESCE(tc.denial_code, '') != '' THEN 'blocked'
          WHEN tc.success = 1 THEN 'success'
          ELSE 'error'
        END AS status,
        tc.duration_ms, tc.error_message, tc.resource_ref, tc.created_at,
        mrt.display_name as tool_display_name
      FROM agentsam_mcp_tool_execution tc
      LEFT JOIN agentsam_tools mrt ON mrt.tool_name = tc.tool_name OR mrt.tool_key = tc.tool_key
      WHERE tc.tenant_id = ?
        AND tc.created_at >= datetime('now', '-' || ? || ' days')
      ORDER BY tc.created_at DESC LIMIT ?`
    ).bind(tenantId, days, limit).all();
    const calls = results || [];
    return jsonResponse({ calls, count: calls.length });
  } catch (e) {
    return jsonResponse({ error: 'Query failed', detail: e?.message ?? String(e) }, 500);
  }
}

