/**
 * Tenant onboarding/branding settings routes.
 */
import { jsonResponse } from '../agentsam/shared.js';
import { parseSettingsJsonSafe, resolveAuthTenantId } from './route-helpers.js';

/** @returns {Promise<Response|null>} */
export async function handleSettingsTenantRoutes(request, env, ctx, authContext) {
  void ctx;
  const { authUser, pathLower, method } = authContext || {};
  if (!authUser || !pathLower?.startsWith('/api/tenant')) return null;

  if (pathLower === '/api/tenant/onboarding' && method === 'GET') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const tenantId = await resolveAuthTenantId(env, authUser);
    if (!tenantId) return jsonResponse({ error: 'Tenant required' }, 403);
    try {
      const row = await env.DB.prepare(
        `SELECT * FROM tenant_activation_status WHERE tenant_id = ? LIMIT 1`,
      ).bind(tenantId).first();
      if (!row) {
        return jsonResponse({ onboarding_completed: 0, activation_progress: 0, activation_checks: {}, activation_checks_json: '{}' });
      }
      const checks = parseSettingsJsonSafe(row.activation_checks_json, {});
      return jsonResponse({ ...row, activation_checks: checks, activation_checks_json: typeof row.activation_checks_json === 'string' ? row.activation_checks_json : JSON.stringify(checks) });
    } catch (e) {
      return jsonResponse({ error: e?.message ?? String(e) }, 500);
    }
  }

  if (pathLower === '/api/tenant/onboarding' && method === 'PATCH') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const tenantId = await resolveAuthTenantId(env, authUser);
    if (!tenantId) return jsonResponse({ error: 'Tenant required' }, 403);
    const body = await request.json().catch(() => ({}));
    const checkKey = typeof body.check_key === 'string' ? body.check_key.trim() : '';
    if (!checkKey) return jsonResponse({ error: 'check_key required' }, 400);
    const completed = body.completed === true || body.completed === 1 || body.completed === '1';
    try {
      const existing = await env.DB.prepare(`SELECT * FROM tenant_activation_status WHERE tenant_id = ? LIMIT 1`).bind(tenantId).first();
      let checks = parseSettingsJsonSafe(existing?.activation_checks_json, {});
      checks[checkKey] = !!completed;
      const keys = Object.keys(checks);
      const total = keys.length;
      const done = keys.filter((k) => checks[k] === true).length;
      const activation_progress = total === 0 ? 0 : Math.round((done / total) * 100);
      const onboarding_completed = total > 0 && done === total ? 1 : 0;
      const checksJson = JSON.stringify(checks);
      await env.DB.prepare(
        `INSERT INTO tenant_activation_status (tenant_id, onboarding_completed, activation_checks_json, activation_progress) VALUES (?, ?, ?, ?)
         ON CONFLICT(tenant_id) DO UPDATE SET onboarding_completed = excluded.onboarding_completed, activation_checks_json = excluded.activation_checks_json, activation_progress = excluded.activation_progress`,
      ).bind(tenantId, onboarding_completed, checksJson, activation_progress).run();
      const row = await env.DB.prepare(`SELECT * FROM tenant_activation_status WHERE tenant_id = ? LIMIT 1`).bind(tenantId).first();
      return jsonResponse({ ...row, activation_checks: checks });
    } catch (e) {
      return jsonResponse({ error: e?.message ?? String(e) }, 500);
    }
  }

  if (pathLower === '/api/tenant/branding' && method === 'GET') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const tenantId = await resolveAuthTenantId(env, authUser);
    if (!tenantId) return jsonResponse({ error: 'Tenant required' }, 403);
    try {
      const row = await env.DB.prepare(`SELECT * FROM tenant_branding WHERE tenant_id = ? LIMIT 1`).bind(tenantId).first();
      if (!row) return jsonResponse({ branding: null });
      return jsonResponse(row);
    } catch (e) {
      return jsonResponse({ error: e?.message ?? String(e) }, 500);
    }
  }

  return null;
}
