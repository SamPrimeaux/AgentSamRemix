/**
 * Single dashboard status payload — reduces parallel D1 polling.
 */
import { getAuthUser, jsonResponse, fallbackSystemTenantId } from '../core/auth.js';
import { deferredSandboxRuntimeSummary } from './sandbox-api.js';

export async function handleStatusBundle(request, url, env, ctx) {
  if (request.method.toUpperCase() !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const authUser = await getAuthUser(request, env);
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

  const userId = authUser.id;

  const results = await Promise.allSettled([
    env.DB ? env.DB.prepare('SELECT 1 AS ok').first().catch(() => null) : Promise.resolve(null),

    env.DB
      ? env.DB.prepare(`
      SELECT id, title, type, message, created_at
      FROM agent_notifications
      WHERE user_id = ? AND read_at IS NULL
      ORDER BY created_at DESC LIMIT 10
    `).bind(userId).all().then((r) => r.results || []).catch(() => [])
      : Promise.resolve([]),

    (async () => {
      if (!env.DB) return { status: 'unknown' };
      try {
        const tid =
          authUser.tenant_id != null && String(authUser.tenant_id).trim() !== ''
            ? String(authUser.tenant_id).trim()
            : fallbackSystemTenantId(env);
        const ws = await env.DB.prepare(
          'SELECT metadata_json FROM agentsam_workspace WHERE tenant_id = ? LIMIT 1',
        )
          .bind(tid)
          .first();
        const meta = (() => {
          try {
            return JSON.parse(ws?.metadata_json || '{}');
          } catch {
            return {};
          }
        })();
        return { branch: meta.branch || 'main', last_commit: meta.last_commit || null, status: 'ok' };
      } catch {
        return { status: 'unknown' };
      }
    })(),

    env.DB
      ? env.DB.prepare(`
      SELECT id, error_message, path, created_at
      FROM worker_analytics_errors
      ORDER BY created_at DESC LIMIT 5
    `).all().then((r) => r.results || []).catch(() => [])
      : Promise.resolve([]),

    (async () => {
      try {
        const flag = await env.KV?.get('tunnel:status');
        return { active: flag === 'active', status: flag || 'unknown' };
      } catch {
        return { active: false, status: 'unknown' };
      }
    })(),

    env.DB
      ? env.DB.prepare(`
      SELECT id, status, shell, created_at
      FROM terminal_sessions
      WHERE user_id = ? AND status = 'active'
      ORDER BY created_at DESC LIMIT 1
    `).bind(userId).first().catch(() => null)
      : Promise.resolve(null),

    env.DB
      ? env.DB.prepare(`
      SELECT id, status, created_at, cf_worker_version_id
      FROM pipeline_runs
      ORDER BY created_at DESC LIMIT 5
    `).all().then((r) => r.results || []).catch(() => [])
      : Promise.resolve([]),

    Promise.resolve(deferredSandboxRuntimeSummary()),
  ]);

  const [health, notifications, git, problems, tunnel, terminal, deployments, sandbox] = results.map((r) =>
    r.status === 'fulfilled' ? r.value : null,
  );

  return new Response(
    JSON.stringify({
      health: health ? { ok: true } : { ok: false },
      notifications: notifications || [],
      git: git || { status: 'unknown' },
      problems: problems || [],
      tunnel: tunnel || { active: false },
      terminal: terminal || null,
      deployments: deployments || [],
      sandbox: sandbox || { ok: false, label: 'Sandbox check failed' },
      fetched_at: Date.now(),
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, max-age=15',
      },
    },
  );
}
