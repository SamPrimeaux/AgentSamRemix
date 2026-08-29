/**
 * Studio session, todos, budget, artifacts.
 */
import { getAuthUser, jsonResponse } from '../core/auth.js'; import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js';

export async function handleStudioSessionApi(request, url, env, ctx) {
  const method = request.method.toUpperCase();
  const path = url.pathname.toLowerCase();

  try {
    if (!env.DB) {
      return jsonResponse({ error: 'Database not configured' }, 503);
    }

    const sessionMatch = url.pathname.match(/^\/api\/studio\/session\/([^/]+)$/i);
    if (sessionMatch && method === 'GET') {
      const authUser = await getAuthUser(request, env);
      if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

      const planId = sessionMatch[1];
      const plan = await env.DB.prepare('SELECT * FROM agentsam_plans WHERE id = ?').bind(planId).first();
      if (!plan) return jsonResponse({ error: 'Not found' }, 404);

      const [{ results: steps }, { results: cadJobs }] = await Promise.all([
        env.DB.prepare('SELECT * FROM agentsam_todo WHERE plan_id = ? ORDER BY sort_order').bind(planId).all(),
        env.DB.prepare('SELECT * FROM agentsam_cad_jobs WHERE session_id = ? ORDER BY created_at DESC LIMIT 10')
          .bind(planId)
          .all(),
      ]);

      return jsonResponse({
        plan,
        steps: steps || [],
        cad_jobs: cadJobs || [],
        budget: {
          cost_usd: plan.cost_usd || 0,
          tokens_used: plan.tokens_used || 0,
          token_budget: plan.token_budget || null,
        },
      });
    }

    const todosMatch = url.pathname.match(/^\/api\/studio\/todos\/([^/]+)$/i);
    if (todosMatch && method === 'GET') {
      const authUser = await getAuthUser(request, env);
      if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

      const planId = todosMatch[1];
      const { results } = await env.DB.prepare(`
        SELECT id, title, execution_status, task_type, requires_approval,
               approved_at, started_at, output_summary, error_trace,
               tokens_used, cost_usd, sort_order
        FROM agentsam_todo WHERE plan_id = ? ORDER BY sort_order
      `).bind(planId).all();

      return jsonResponse({ steps: results || [] });
    }

    const todoUpdateMatch = url.pathname.match(/^\/api\/studio\/todos\/([^/]+)\/update$/i);
    if (todoUpdateMatch && method === 'POST') {
      if (!verifyBridgeKey(request, env)) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      const todoId = todoUpdateMatch[1];
      const body = await request.json().catch(() => ({}));
      const { status, output_summary, error_trace, tokens_used, cost_usd } = body;

      const validStatuses = ['queued', 'running', 'done', 'error', 'skipped'];
      if (!validStatuses.includes(status)) {
        return jsonResponse({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` }, 400);
      }

      const todo = await env.DB.prepare('SELECT plan_id FROM agentsam_todo WHERE id = ?').bind(todoId).first();
      if (!todo) return jsonResponse({ error: 'Todo not found' }, 404);

      await env.DB.prepare(`
        UPDATE agentsam_todo SET
          execution_status = ?,
          output_summary = COALESCE(?, output_summary),
          error_trace = COALESCE(?, error_trace),
          tokens_used = tokens_used + COALESCE(?, 0),
          cost_usd = cost_usd + COALESCE(?, 0),
          started_at = CASE
            WHEN ? = 'running' AND started_at IS NULL THEN datetime('now')
            ELSE started_at
          END,
          updated_at = datetime('now')
        WHERE id = ?
      `).bind(
        status,
        output_summary || null,
        error_trace || null,
        tokens_used || null,
        cost_usd || null,
        status,
        todoId,
      ).run();

      if (['done', 'error'].includes(status) && todo.plan_id) {
        await env.DB.prepare(`
          UPDATE agentsam_plans SET
            tasks_done = (
              SELECT COUNT(*) FROM agentsam_todo
              WHERE plan_id = ? AND execution_status = 'done'
            ),
            tasks_blocked = (
              SELECT COUNT(*) FROM agentsam_todo
              WHERE plan_id = ? AND execution_status = 'error'
            ),
            cost_usd = cost_usd + COALESCE(?, 0),
            tokens_used = tokens_used + COALESCE(?, 0),
            updated_at = unixepoch()
          WHERE id = ?
        `).bind(todo.plan_id, todo.plan_id, cost_usd || null, tokens_used || null, todo.plan_id).run();
      }

      return jsonResponse({ ok: true });
    }

    const budgetMatch = url.pathname.match(/^\/api\/studio\/budget\/([^/]+)$/i);
    if (budgetMatch && method === 'GET') {
      const authUser = await getAuthUser(request, env);
      if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

      const planId = budgetMatch[1];
      const plan = await env.DB.prepare(`
        SELECT cost_usd, tokens_used, token_budget, tasks_total, tasks_done,
               tasks_blocked, default_model
        FROM agentsam_plans WHERE id = ?
      `).bind(planId).first();

      if (!plan) return jsonResponse({ error: 'Not found' }, 404);

      const pct = plan.tasks_total > 0 ? Math.round((plan.tasks_done / plan.tasks_total) * 100) : 0;

      return jsonResponse({
        cost_usd: plan.cost_usd || 0,
        tokens_used: plan.tokens_used || 0,
        token_budget: plan.token_budget || null,
        tasks_total: plan.tasks_total || 0,
        tasks_done: plan.tasks_done || 0,
        tasks_blocked: plan.tasks_blocked || 0,
        model: plan.default_model,
        percent_complete: pct,
      });
    }

    if (path === '/api/artifacts' && method === 'GET') {
      const authUser = await getAuthUser(request, env);
      if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

      const { results } = await env.DB.prepare(`
        SELECT id, name, description, artifact_type, r2_key, public_url, source,
               tags, is_public, file_size_bytes, created_at
        FROM agentsam_artifacts
        WHERE user_id = ?
        ORDER BY created_at DESC LIMIT 100
      `).bind(authUser.id).all();

      return jsonResponse({ artifacts: results || [] });
    }

    const artifactMatch = url.pathname.match(/^\/api\/artifacts\/([^/]+)\/content$/i);
    if (artifactMatch && method === 'GET') {
      const artifactId = artifactMatch[1];
      const artifact = await env.DB.prepare(
        'SELECT r2_key, r2_bucket, artifact_type, is_public, user_id, project_key FROM agentsam_artifacts WHERE id = ?',
      ).bind(artifactId).first();

      if (!artifact) return new Response('Not found', { status: 404 });

      if (!artifact.is_public) {
        const authUser = await getAuthUser(request, env);
        if (!authUser) return new Response('Unauthorized', { status: 401 });
        const callerId = String(authUser.id || '');
        const ownerId = String(artifact.user_id || '');
        let allowed = callerId && ownerId === callerId;
        if (!allowed && artifact.project_key) {
          const pk = String(artifact.project_key).trim();
          const collab = await env.DB.prepare(
            `SELECT 1 AS ok FROM project_collaborators WHERE project_id = ? AND user_id = ? LIMIT 1`,
          )
            .bind(pk, callerId)
            .first()
            .catch(() => null);
          const owner = collab
            ? null
            : await env.DB.prepare(
                `SELECT 1 AS ok FROM projects WHERE id = ? AND owner_user_id = ? LIMIT 1`,
              )
                .bind(pk, callerId)
                .first()
                .catch(() => null);
          allowed = Boolean(collab || owner);
        }
        if (!allowed) return new Response('Unauthorized', { status: 401 });
      }

      const { readWorkspaceArtifact } = await import('../core/artifact-r2-store.js');
      const r2Object = await readWorkspaceArtifact(env, artifact.r2_key, artifact.r2_bucket);
      if (!r2Object) return new Response('Artifact file not found', { status: 404 });

      const contentTypeMap = {
        html: 'text/html;charset=UTF-8',
        css: 'text/css;charset=UTF-8',
        js: 'text/javascript;charset=UTF-8',
        tsx: 'text/plain;charset=UTF-8',
        ts: 'text/plain;charset=UTF-8',
        sql: 'text/plain;charset=UTF-8',
        json: 'application/json',
        excalidraw: 'application/json',
        markdown: 'text/markdown;charset=UTF-8',
        glb: 'model/gltf-binary',
        svg: 'image/svg+xml',
        png: 'image/png',
        jpg: 'image/jpeg',
      };

      const contentType =
        r2Object.httpMetadata?.contentType || contentTypeMap[artifact.artifact_type] || 'application/octet-stream';

      return new Response(r2Object.body, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': artifact.is_public ? 'public, max-age=3600' : 'private, max-age=300',
          'X-Artifact-Id': artifactId,
        },
      });
    }

    return jsonResponse({ error: 'Not found' }, 404);
  } catch (e) {
    console.warn('[handleStudioSessionApi]', e?.message ?? e);
    return jsonResponse({ error: String(e?.message || e) }, 500);
  }
}
