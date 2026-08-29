/**
 * API Service: Deployment Tracking
 * Handles deployment logs, recent deployment history, and internal CI/CD synchronization.
 * Deconstructed from legacy worker.js.
 */
import { getAuthUser, jsonResponse } from '../core/auth.js'; import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js';
import { resolveCronTenantId } from '../../backend/jobs/cron-tenant.js';

/**
 * Mirror deployment outcome to the CI/CD pipeline runs table for historical audit.
 */
export function appendCidiPipelineRunFromDeploy(env, {
  deploymentId,
  environment,
  gitHash,
  versionId,
  description
}) {
  if (!env?.DB) return;
  const now = new Date().toISOString();
  env.DB.prepare(
    `INSERT INTO cicd_pipeline_runs (run_id, env, status, branch, commit_hash, notes, triggered_at, completed_at)
     VALUES (?, ?, 'passed', 'main', ?, ?, ?, ?)`
  ).bind(deploymentId, environment || 'production', gitHash || 'unknown', description || 'Automated deploy', now, now).run().catch(() => { });
}

/**
 * Triggers post-deploy health checks (runs in background via ctx.waitUntil).
 */
export async function runPostDeployQualityChecks(env, deploymentId) {
  if (!env?.DB) return;
  try {
    // Audit log for quality check trigger
    await env.DB.prepare(
      `INSERT INTO cicd_events (source, event_type, git_commit_sha, raw_payload_json)
       VALUES ('worker_post_deploy', 'health_check_triggered', ?, ?)`
    ).bind(deploymentId, JSON.stringify({ triggered_at: new Date().toISOString(), status: 'pending' })).run();
  } catch (e) {
    console.warn('[runPostDeployQualityChecks] Fail', e?.message);
  }
}

import { handleGitStatusRequest } from '../../backend/http/agentsam/routes/git-status.js';

/**
 * Main dispatcher for Deployment-related API routes (/api/deployments/*, /api/internal/*).
 */
export async function handleDeploymentsApi(request, url, env, ctx) {
    const pathLower = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
    const method = request.method.toUpperCase();

    if (pathLower === '/api/internal/git-status' && method === 'GET') {
      const internalOk = verifyBridgeKey(request, env);
      if (!internalOk) {
        const authUser = await getAuthUser(request, env);
        if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
      }
      return handleGitStatusRequest(request, env, ctx);
    }

    // ── /api/deployments/recent ──
    if (pathLower === '/api/deployments/recent' && method === 'GET') {
        const authUser = await getAuthUser(request, env);
        if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
        if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);

        const { results } = await env.DB.prepare(
            `SELECT id, timestamp, version, git_hash, description, status, deployed_by, environment, worker_name, notes
             FROM deployments ORDER BY timestamp DESC LIMIT 50`
        ).all();
        return jsonResponse({ deployments: results || [] });
    }

    // ── /api/internal/record-deploy ── (System/Automation Gate)
    if (pathLower === '/api/internal/record-deploy' && method === 'POST') {
        const secretOk = verifyBridgeKey(request, env);
        if (!secretOk) return jsonResponse({ error: 'Unauthorized system access' }, 401);

        let body = {};
        try { body = await request.json(); } catch (_) { }

        const triggeredBy = (body.triggered_by || 'api_record_deploy');
        const notes = (body.deployment_notes || body.notes || '');
        const gitHash = (body.git_hash || body.gitHash || '').trim();
        const versionId = (body.version_id || body.version || '').trim();
        const deployId = 'rec-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);

        // DORA / spend attribution — explicit scope; env fallback only for legacy internal ingest.
        let tenantId = String(body.tenant_id || body.tenantId || '').trim();
        if (!tenantId) {
          tenantId = (await resolveCronTenantId(env)) || '';
          if (!tenantId) {
            return jsonResponse({ error: 'tenant_id_required' }, 400);
          }
        }
        const workspaceId = (body.workspace_id || body.workspaceId || null);
        const projectId = String(body.project_id || body.projectId || '').trim();
        const workerName = String(body.worker_name || body.workerName || '').trim();
        if (!projectId) return jsonResponse({ error: 'project_id_required' }, 400);
        if (!workerName) return jsonResponse({ error: 'worker_name_required' }, 400);

        if (!env.DB) return jsonResponse({ error: 'DB unavailable' }, 503);

        try {
            await env.DB.prepare(
                `INSERT INTO deployments (id, timestamp, version, git_hash, description, status, deployed_by, environment, deploy_time_seconds, worker_name, triggered_by, notes, tenant_id, workspace_id, project_id)
                 VALUES (?, datetime('now'), ?, ?, 'Internal record-deploy (API)', 'success', ?, 'production', 0, ?, ?, ?, ?, ?, ?)`
            ).bind(deployId, versionId || deployId, gitHash || null, triggeredBy, workerName, triggeredBy, notes, tenantId, workspaceId, projectId).run();

            appendCidiPipelineRunFromDeploy(env, {
                deploymentId: deployId,
                environment: 'production',
                gitHash: gitHash || 'unknown',
                versionId: versionId || deployId,
                description: notes || 'deploy via script',
            });

            ctx.waitUntil(runPostDeployQualityChecks(env, deployId));
            ctx.waitUntil(
              import('../../backend/agentsam/codebase/deploy-code-index-queue.js').then(({ queueCodeIndexJobAfterDeploy }) =>
                queueCodeIndexJobAfterDeploy(env, {
                  workspaceId: body.workspace_id || body.workspaceId || null,
                  triggeredBy: 'deploy',
                }),
              ),
            );

            return jsonResponse({ ok: true, deployment_id: deployId });
        } catch (e) {
            return jsonResponse({ error: e.message }, 500);
        }
    }

    return jsonResponse({ error: 'Deployment route not found' }, 404);
}
