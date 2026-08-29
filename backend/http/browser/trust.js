/**
 * GET/POST/DELETE /api/agentsam/browser/trust — per-user browser origin trust gate (D1).
 */
import { getAuthUser } from '../../identity/index.js';
import { jsonResponse } from '../agentsam/shared.js';
import { lookupBrowserTrustedOrigin } from '../../browser/policy/trust.js';

export async function handleBrowserTrust(request, env) {
  const user = await getAuthUser(request, env);
  if (!user) return new Response('Unauthorized', { status: 401 });

  const userId = String(user.id || user.auth_id || '').trim();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const workspaceId = String(
    request.headers.get('x-iam-workspace-id') ||
      user.active_workspace_id ||
      (typeof env?.WORKSPACE_ID === 'string' ? env.WORKSPACE_ID : '') ||
      '',
  ).trim();
  if (!workspaceId) {
    return jsonResponse(
      { error: 'workspace_id required', detail: 'Send header x-iam-workspace-id or set active workspace' },
      400,
    );
  }

  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (!env.DB) {
    return jsonResponse({ error: 'Database not configured' }, 503);
  }

  if (method === 'GET') {
    const origin = url.searchParams.get('origin');
    if (!origin) return jsonResponse({ trusted: false, trust_scope: null });
    const row = await lookupBrowserTrustedOrigin(env, { userId, workspaceId, origin });
    return jsonResponse({
      trusted: !!row,
      trust_scope: row?.trust_scope ?? null,
      skip_approval: row != null && String(row.trust_scope || '').toLowerCase() === 'persistent',
    });
  }

  if (method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch (_) {
      body = {};
    }
    const originRaw = body.origin != null ? String(body.origin).trim() : '';
    const trust_scope = body.trust_scope != null ? String(body.trust_scope) : (body.scope != null ? String(body.scope) : 'persistent');
    if (!originRaw) return jsonResponse({ error: 'origin required' }, 400);
    let origin = originRaw;
    try {
      origin = new URL(originRaw.startsWith('http') ? originRaw : `https://${originRaw}`).origin;
    } catch {
      /* keep raw */
    }
    await env.DB.prepare(
      `INSERT INTO agentsam_browser_trusted_origin
        (workspace_id, user_id, origin, trust_scope, created_at, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT (workspace_id, user_id, origin) DO UPDATE SET
        trust_scope = excluded.trust_scope,
        updated_at = datetime('now')`,
    )
      .bind(workspaceId, userId, origin, trust_scope)
      .run();
    return jsonResponse({ ok: true, origin, trust_scope });
  }

  if (method === 'DELETE') {
    let body = {};
    try {
      body = await request.json();
    } catch (_) {
      body = {};
    }
    const origin = body.origin != null ? String(body.origin).trim() : '';
    if (!origin) return jsonResponse({ error: 'origin required' }, 400);
    await env.DB.prepare(
      'DELETE FROM agentsam_browser_trusted_origin WHERE workspace_id = ? AND user_id = ? AND origin = ?',
    )
      .bind(workspaceId, userId, origin)
      .run();
    return jsonResponse({ ok: true });
  }

  return new Response('Method not allowed', { status: 405 });
}
