/**
 * POST /api/internal/code-index/run — IAM tunnel infrastructure actor or internal secret.
 * Body:
 *   { workspace_id, job_id } — pump oldest/idle job
 *   { start_full: true, project_id } — queue a product full index (MY_QUEUE self-continues)
 *   { smoke_file: true, project_id?, path? } — one-file parse/embed/write (no activate)
 */
import { getAuthUser, fetchAuthUserTenantId } from '../core/auth.js'; import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js';
import { userIsTunnelInfraActor } from '../../backend/identity/workspace/authority.js';
import { runPendingCodeIndexJob } from '../../backend/agentsam/codebase/code-indexer.js';
import {
  CODE_INDEX_FILE_SMOKE_DEFAULT_PATH,
  CODE_INDEX_FILE_SMOKE_DEFAULT_PROJECT,
} from '../core/code-index-file-smoke.js';

/**
 * @param {Request} request
 * @param {any} env
 * @param {ExecutionContext} ctx
 */
export async function handleCodeIndexRun(request, env, ctx) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const internalOk = verifyBridgeKey(request, env);
  let authUser = null;
  if (!internalOk) {
    authUser = await getAuthUser(request, env);
    if (!authUser || !(await userIsTunnelInfraActor(env, authUser))) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
  }

  if (!env?.DB) {
    return jsonResponse({ ok: false, error: 'DB not configured' }, 503);
  }

  const body = await request.json().catch(() => ({}));

  if (body?.smoke_file === true || body?.file_smoke === true) {
    const projectId =
      typeof body.project_id === 'string' && body.project_id.trim()
        ? body.project_id.trim()
        : CODE_INDEX_FILE_SMOKE_DEFAULT_PROJECT;
    const path =
      typeof body.path === 'string' && body.path.trim()
        ? body.path.trim()
        : CODE_INDEX_FILE_SMOKE_DEFAULT_PATH;

    const { resolveProjectExecutionWorkspace } = await import('./projects/code-index.js');
    const actor = authUser || {};
    const resolved = await resolveProjectExecutionWorkspace(env, actor, projectId);
    if (resolved.error) {
      return jsonResponse(
        { ok: false, error: resolved.error, project_id: projectId },
        resolved.status || 500,
      );
    }
    if (!resolved.githubRepo) {
      return jsonResponse(
        {
          ok: false,
          error: 'github_repo_required',
          project_id: projectId,
          message: 'Connect a GitHub repo on this project before indexing.',
        },
        400,
      );
    }

    const { queueCodeIndexFileSmoke } = await import('../core/code-index-file-smoke.js');
    const queued = await queueCodeIndexFileSmoke(env, {
      workspaceId: resolved.executionWorkspaceId,
      repoFullName: resolved.githubRepo,
      projectId,
      userId: authUser?.id ?? null,
      path,
      triggeredBy: 'internal_file_smoke',
    });
    if (!queued?.ok) {
      return jsonResponse({ ok: false, ...queued }, 500);
    }

    const { pumpFullCodeIndexRun } = await import(
      '../../backend/agentsam/codebase/code-indexer.js'
    );
    const pump = pumpFullCodeIndexRun(env, queued.run_id, {
      maxRounds: 8,
      maxFiles: 1,
      maxSymbols: 80,
      wallBudgetMs: 45_000,
      cpuBudgetMs: 40_000,
    });
    if (ctx?.waitUntil) {
      ctx.waitUntil(pump.catch((error) => console.error('[code-index-run smoke_file]', error)));
      const kickoff = await Promise.race([
        pump,
        new Promise((resolve) => setTimeout(() => resolve({ ok: true, mode: 'background' }), 2500)),
      ]);
      return jsonResponse({
        ok: true,
        smoke_file: true,
        project_id: projectId,
        path,
        ...queued,
        pump: kickoff && typeof kickoff === 'object' ? kickoff : { mode: 'background' },
      });
    }
    const result = await pump;
    return jsonResponse({
      ok: true,
      smoke_file: true,
      project_id: projectId,
      path,
      ...queued,
      pump: result,
    });
  }

  if (body?.start_full === true) {
    const projectId =
      typeof body.project_id === 'string' && body.project_id.trim()
        ? body.project_id.trim()
        : '';
    if (!projectId) {
      return jsonResponse({ ok: false, error: 'project_id_required' }, 400);
    }
    const { resolveProjectExecutionWorkspace } = await import('./projects/code-index.js');
    const actor = authUser || {};
    const resolved = await resolveProjectExecutionWorkspace(env, actor, projectId);
    if (resolved.error) {
      return jsonResponse(
        { ok: false, error: resolved.error, project_id: projectId },
        resolved.status || 500,
      );
    }
    if (!resolved.githubRepo) {
      return jsonResponse(
        {
          ok: false,
          error: 'github_repo_required',
          project_id: projectId,
          message: 'Connect a GitHub repo on this project before indexing.',
        },
        400,
      );
    }
    const { queueFullCodeIndexRun } = await import(
      '../../backend/agentsam/codebase/deploy-code-index-queue.js'
    );
    const queued = await queueFullCodeIndexRun(env, {
      workspaceId: resolved.executionWorkspaceId,
      repoFullName: resolved.githubRepo,
      projectId,
      userId: authUser?.id ?? null,
      personUuid: authUser?.person_uuid ?? null,
      mode: 'full',
      force: body.force !== false,
      triggeredBy: 'internal_full_index_kick',
    });
    if (!queued?.ok) {
      return jsonResponse(
        { ok: false, error: queued?.error || 'full_index_queue_failed', ...queued },
        queued?.error === 'index_stopped_use_resume' ? 409 : 500,
      );
    }
    if (queued.run_id && queued.queue_enqueued !== true) {
      const { pumpFullCodeIndexRun } = await import(
        '../../backend/agentsam/codebase/code-indexer.js'
      );
      const firstBatch = pumpFullCodeIndexRun(env, queued.run_id, {
        maxRounds: 4,
        maxFiles: 8,
        maxSymbols: 24,
        wallBudgetMs: 28_000,
      });
      if (ctx?.waitUntil) {
        ctx.waitUntil(firstBatch.catch((error) => console.error('[code-index-run start_full]', error)));
      } else {
        void firstBatch.catch((error) => console.error('[code-index-run start_full]', error));
      }
    }
    return jsonResponse({
      ok: true,
      start_full: true,
      project_id: projectId,
      workspace_id: resolved.executionWorkspaceId,
      repo_full_name: resolved.githubRepo,
      ...queued,
    });
  }

  const workspaceId =
    typeof body?.workspace_id === 'string' && body.workspace_id.trim()
      ? body.workspace_id.trim()
      : null;
  const jobId =
    typeof body?.job_id === 'string' && body.job_id.trim() ? body.job_id.trim() : null;

  const startedAt = Date.now();
  const work = runPendingCodeIndexJob(env, {
    startedAt,
    cpuBudgetMs: 22_000,
    workspaceId,
    jobId,
  });

  if (ctx?.waitUntil) {
    ctx.waitUntil(
      work.catch((e) => {
        console.warn('[code-index-run]', e?.message ?? e);
      }),
    );
    const kickoff = await Promise.race([
      work,
      new Promise((resolve) => setTimeout(() => resolve({ ok: true, mode: 'background' }), 1200)),
    ]);
    return jsonResponse({
      ok: true,
      mode: kickoff?.mode === 'background' ? 'background' : 'inline',
      started_at: startedAt,
      workspace_id: workspaceId,
      job_id: jobId,
      ...(kickoff && typeof kickoff === 'object' ? kickoff : {}),
      hint:
        kickoff?.mode === 'background'
          ? 'Job continues via waitUntil — poll agentsam_code_index_job for status'
          : undefined,
    });
  }

  const result = await work;
  return jsonResponse({
    ok: result.ok !== false,
    mode: 'inline',
    duration_ms: Date.now() - startedAt,
    workspace_id: workspaceId,
    ...result,
  });
}
