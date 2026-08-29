/**
 * GET /api/commands — tenant + platform agentsam_commands for Cmd+K palette.
 */
import { getAuthUser } from '../identity/index.js';
import { fetchAuthUserTenantId } from '../identity/users/tenant.js';
import { httpJsonResponse as jsonResponse } from './responses.js';
import { commandPaletteDto } from '../agentsam/catalog/command-row.js';

/**
 * @param {Request} request
 * @param {URL} url
 * @param {import('@cloudflare/workers-types').Env} env
 */
export async function handleCommandsHttp(request, url, env) {
  const method = (request.method || 'GET').toUpperCase();
  if (method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405);

  const authUser = await getAuthUser(request, env);
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (!env.DB) return jsonResponse({ commands: [], source: 'none' });

  const q = (url.searchParams.get('q') || '').trim();
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit') || '80', 10) || 80), 120);
  const category = (url.searchParams.get('category') || '').trim().toLowerCase();

  let tenantId =
    authUser.tenant_id != null && String(authUser.tenant_id).trim() !== ''
      ? String(authUser.tenant_id).trim()
      : null;
  if (!tenantId) tenantId = await fetchAuthUserTenantId(env, authUser.id);
  if (!tenantId && authUser.email) tenantId = await fetchAuthUserTenantId(env, authUser.email);

  const binds = [];
  const clauses = [
    `COALESCE(is_active, 1) = 1`,
    `(workspace_id = 'platform' OR surface IN ('palette', 'both'))`,
  ];
  if (tenantId) {
    clauses.push(`(workspace_id = 'platform' OR tenant_id = ?)`);
    binds.push(tenantId);
  } else {
    clauses.push(`workspace_id = 'platform'`);
  }
  if (category) {
    clauses.push(`LOWER(COALESCE(category, 'misc')) = ?`);
    binds.push(category);
  }
  if (q.length >= 1) {
    const like = `%${q.toLowerCase()}%`;
    clauses.push(
      `(LOWER(display_name) LIKE ? OR LOWER(COALESCE(shell_line,'')) LIKE ? OR LOWER(COALESCE(slug,'')) LIKE ? OR LOWER(COALESCE(description,'')) LIKE ?)`,
    );
    binds.push(like, like, like, like);
  }

  const sql = `
    SELECT id, slug, display_name, description, category,
           shell_line, handler_kind, handler_ref, risk_level, requires_confirmation,
           sort_order, workspace_id, tenant_id, surface
    FROM agentsam_commands
    WHERE ${clauses.join(' AND ')}
    ORDER BY
      CASE workspace_id WHEN 'platform' THEN 0 ELSE 1 END,
      COALESCE(sort_order, 50) ASC,
      display_name ASC
    LIMIT ${limit}
  `;

  try {
    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    return jsonResponse({
      commands: (results || []).map((row) => commandPaletteDto(row)),
      count: (results || []).length,
      source: 'agentsam_commands',
    });
  } catch (e) {
    return jsonResponse({ commands: [], error: e?.message ?? String(e), source: 'error' }, 500);
  }
}
