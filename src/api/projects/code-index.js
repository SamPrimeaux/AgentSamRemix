/**
 * Projects API — peeled from monolithic projects.js (mechanical).
 */
import { jsonResponse } from '../../core/auth.js';
import { resolveWorkspaceBindings, normalizeWorkspaceBindings, healProjectWorkspaceId } from '../../../backend/identity/workspace/agentsam-workspace.js';
import {
  resolveProjectGithubRepo,
  setProjectGithubRepo,
  readProjectGithubRepoFromRow,
  normalizeGithubRepoFullName,
} from '../../../backend/agentsam/codebase/project-github-repo.js';
import { resolveSupabaseWorkspaceId } from '../../../backend/agentsam/rag/index.js';
import { PRODUCT_SOURCE_TYPE_SQL_IN } from '../../../backend/agentsam/codebase/codebase-full-index.js';
import { parseMetadataObject, assertProjectAccess } from './helpers.js';

export async function resolveProjectExecutionWorkspace(env, authUser, projectId) {
  const row = await env.DB.prepare(`SELECT * FROM projects WHERE id = ?`).bind(projectId).first();
  if (!row) return { error: 'not_found', status: 404 };
  if (
    authUser.tenant_id &&
    row.tenant_id &&
    String(row.tenant_id) !== String(authUser.tenant_id)
  ) {
    return { error: 'forbidden', status: 403 };
  }
  const bindingsRaw = await resolveWorkspaceBindings(env, projectId);
  const bindings = normalizeWorkspaceBindings(bindingsRaw);
  let executionWorkspaceId =
    bindings?.workspaceId ||
    (row.workspace_id != null ? String(row.workspace_id).trim() : null) ||
    null;

  // Archive / orphan project rows (e.g. ws_archive_legacy) have no Supabase UUID —
  // recover via project github_repo → agentsam_workspace before indexing.
  const projectGithubRepo =
    (await resolveProjectGithubRepo(env, row, bindings)) || readProjectGithubRepoFromRow(row);
  if (executionWorkspaceId) {
    const uuid = await resolveSupabaseWorkspaceId(env, executionWorkspaceId).catch(() => null);
    if (!uuid && projectGithubRepo && env?.DB) {
      const byRepo = await env.DB.prepare(
        `SELECT id FROM agentsam_workspace
          WHERE status = 'active' AND github_repo = ?
          ORDER BY updated_at DESC LIMIT 1`,
      )
        .bind(projectGithubRepo)
        .first()
        .catch(() => null);
      if (byRepo?.id) executionWorkspaceId = String(byRepo.id).trim();
    }
  }

  if (!executionWorkspaceId) return { error: 'execution_workspace_required', status: 400, row, bindings };
  const heal = await healProjectWorkspaceId(
    env,
    projectId,
    executionWorkspaceId,
    row.workspace_id,
  );
  if (heal.healed) {
    row.workspace_id = executionWorkspaceId;
  }
  const mergedBindings = {
    ...(bindings || {}),
    githubRepo: projectGithubRepo,
  };
  return {
    row,
    bindings: mergedBindings,
    executionWorkspaceId,
    githubRepo: projectGithubRepo,
  };
}

export function fullRunNeedsQueueKick(run, jobRow = null) {
  if (!run?.run_id) return false;
  if (String(run.mode || '') !== 'full') return false;
  const status = String(run.status || '').toLowerCase();
  if (status === 'cancelled' || status === 'failed') return false;
  const stage = String(run.stage || '').toLowerCase();
  const bf = run.calls_backfill;
  const callsPending =
    bf &&
    bf.ok !== true &&
    (Number(bf.total_shards) > 0 || bf.queued === true || Number(bf.shard_index) >= 0);
  const updatedSec = Number(jobRow?.updated_at);
  const ageSec =
    Number.isFinite(updatedSec) && updatedSec > 1e9
      ? Math.floor(Date.now() / 1000) - updatedSec
      : 999;
  // Level 2 incomplete (including sticky status=completed) — keep pumping until purple.
  if (callsPending || stage === 'calls_backfill') {
    if (status === 'completed') return ageSec >= 20;
    if (status === 'idle') return ageSec >= 15;
    if (status === 'running') return ageSec >= 45;
    return ageSec >= 30;
  }
  if (run.activated === true) return false;
  if (status === 'completed') return false;
  if (
    !['queued', 'crawl', 'parse_chunks', 'embed_symbols', 'verify', 'activate', 'calls_backfill'].includes(
      stage,
    )
  ) {
    return false;
  }
  // Stall recovery only — normal continuation is consumer re-enqueue on MY_QUEUE.
  if (status === 'idle') return ageSec >= 20;
  if (status === 'running') return ageSec >= 45;
  return false;
}

export async function handleProjectCodeIndexStatus(request, env, authUser, projectId, ctx = null) {
  const resolved = await resolveProjectExecutionWorkspace(env, authUser, projectId);
  if (resolved.error) return jsonResponse({ ok: false, error: resolved.error }, resolved.status);
  const githubRepo = resolved.githubRepo || null;
  let preferredRunId = null;
  try {
    preferredRunId = new URL(request.url).searchParams.get('run_id');
  } catch {
    preferredRunId = null;
  }
  try {
    const { getWorkspaceCodeIndexStatus } = await import('../workspace-code-index-status.js');
    const status = await getWorkspaceCodeIndexStatus(env, resolved.executionWorkspaceId, {
      repoFullName: githubRepo,
      preferredRunId,
    });
    // LOCKED: GET status must NOT enqueue/pump full-index work. Polling the rail every
    // 2.5s with idle age≥20s was re-queuing embed pages and burning embed spend
    // while the UI hung on PG COUNTs. Resume only via Continue / Restart / Stop.
    return jsonResponse({
      ...status,
      project_id: String(projectId),
      github_repo: githubRepo,
      github_connected: Boolean(githubRepo),
      queue_kicked: false,
      auto_kick_disabled: true,
    });
  } catch (e) {
    return jsonResponse({ ok: false, error: e?.message ?? String(e) }, 500);
  }
}

export async function handleProjectGithubConnect(request, env, authUser, projectId, ctx = null) {
  const body = await request.json().catch(() => ({}));
  const resolved = await resolveProjectExecutionWorkspace(env, authUser, projectId);
  if (resolved.error) {
    return jsonResponse({ ok: false, error: resolved.error }, resolved.status || 500);
  }

  const clear = body?.clear === true || body?.github_repo === null;
  let githubRepo = null;
  try {
    githubRepo = clear
      ? await setProjectGithubRepo(env, projectId, null)
      : await setProjectGithubRepo(env, projectId, body?.github_repo ?? body?.repo_full_name);
  } catch (e) {
    const msg = e?.message ?? String(e);
    const status = msg === 'not_found' ? 404 : msg === 'invalid_github_repo' ? 400 : 500;
    return jsonResponse({ ok: false, error: msg }, status);
  }

  let index = null;
  const startIndex = body?.start_index !== false && Boolean(githubRepo);
  if (startIndex && githubRepo) {
    const { queueFullCodeIndexRun } = await import(
      '../../../backend/agentsam/codebase/deploy-code-index-queue.js'
    );
    index = await queueFullCodeIndexRun(env, {
      workspaceId: resolved.executionWorkspaceId,
      repoFullName: githubRepo,
      userId: authUser?.id ?? null,
      projectId: projectId != null ? String(projectId) : null,
      personUuid: authUser?.person_uuid ?? null,
      branch: body?.branch ? String(body.branch).trim() || undefined : undefined,
      triggeredBy: 'project_github_connect',
    });
    if (index?.ok && index?.run_id && index.queue_enqueued !== true) {
      const { pumpFullCodeIndexRun } = await import(
        '../../../backend/agentsam/codebase/code-indexer.js'
      );
      const firstBatch = pumpFullCodeIndexRun(env, index.run_id, {
        maxRounds: 4,
        maxFiles: 8,
        maxSymbols: 24,
        wallBudgetMs: 28_000,
      });
      if (ctx?.waitUntil) {
        ctx.waitUntil(firstBatch.catch((error) => console.error('[project-github-connect-index]', error)));
      } else {
        void firstBatch.catch((error) => console.error('[project-github-connect-index]', error));
      }
    }
  }

  if (env?.SESSION_CACHE && authUser?.id) {
    const { writeActiveProjectSessionContext } = await import('../../core/session-context-kv-bridge.js');
    await writeActiveProjectSessionContext(env, String(authUser.id), {
      project_id: String(projectId),
      project_name: String(resolved.row.name || projectId),
      execution_workspace_id: resolved.executionWorkspaceId,
      github_repo: githubRepo,
      activated_at: Date.now(),
    }).catch(() => null);
  }

  return jsonResponse({
    ok: true,
    project_id: String(projectId),
    workspace_id: resolved.executionWorkspaceId,
    github_repo: githubRepo,
    github_connected: Boolean(githubRepo),
    index,
    message: githubRepo
      ? startIndex
        ? `Connected ${githubRepo} — full index queued`
        : `Connected ${githubRepo}`
      : 'GitHub repo disconnected from this project',
  });
}

export async function handleProjectReindex(request, env, authUser, projectId, ctx = null) {
  const body = await request.json().catch(() => ({}));
  const requestedMode = String(body?.mode || 'full').trim().toLowerCase();
  // Mode-picking CTAs (default / Build): full. Explicit Update: incremental (I4 fails loud if no baseline).
  const mode = requestedMode === 'incremental' ? 'incremental' : 'full';
  const resolved = await resolveProjectExecutionWorkspace(env, authUser, projectId);
  if (resolved.error) {
    return jsonResponse({ ok: false, error: resolved.error }, resolved.status || 500);
  }

  const githubRepo = resolved.githubRepo || null;
  if (!githubRepo) {
    return jsonResponse(
      {
        ok: false,
        error: 'github_repo_required',
        message: 'Connect a GitHub repo on this project before indexing.',
      },
      400,
    );
  }

  const force = body?.force === true;
  const { queueFullCodeIndexRun, resumeFullCodeIndexRun } = await import(
    '../../../backend/agentsam/codebase/deploy-code-index-queue.js'
  );
  let queued = await queueFullCodeIndexRun(env, {
    workspaceId: resolved.executionWorkspaceId,
    repoFullName: githubRepo,
    userId: authUser?.id ?? null,
    projectId: projectId != null ? String(projectId) : null,
    personUuid: authUser?.person_uuid ?? null,
    branch: body?.branch || undefined,
    mode,
    force,
    triggeredBy:
      mode === 'incremental'
        ? 'project_dashboard_incremental_reindex'
        : force
          ? 'project_dashboard_full_reindex_force'
          : 'project_dashboard_full_reindex',
  });
  // Build without force while a cancelled checkpoint exists used to return a cryptic
  // index_stopped_use_resume. Auto-resume the same run so the rail "refresh" isn't a dead end.
  if (
    !force &&
    mode === 'full' &&
    queued?.ok === false &&
    String(queued.error || '') === 'index_stopped_use_resume' &&
    queued.run_id
  ) {
    const resumed = await resumeFullCodeIndexRun(env, {
      workspaceId: resolved.executionWorkspaceId,
      runId: String(queued.run_id),
    });
    if (resumed?.ok) {
      queued = {
        ...resumed,
        ok: true,
        resumed_from_stopped: true,
        message:
          resumed.message ||
          'Index was stopped — continued the same checkpoint run (not a new full crawl). Use Restart to wipe and start over.',
      };
    }
  }
  if (!queued.ok) {
    const err = queued.error || queued.reason || 'reindex_queue_failed';
    const status =
      err === 'incremental_requires_activated_baseline' || err === 'index_stopped_use_resume'
        ? 409
        : 500;
    return jsonResponse(
      {
        ok: false,
        error: err,
        mode,
        pipeline: 'sam.codebaseindex.index.run',
        run_id: queued.run_id || null,
        message:
          queued.message ||
          (err === 'index_stopped_use_resume'
            ? 'Index is stopped with a checkpoint — click Continue, or Restart for a new full run.'
            : null),
      },
      status,
    );
  }

  // Primary path: MY_QUEUE (enqueued inside queueFullCodeIndexRun). Fallback pump if binding missing.
  if (queued.queue_enqueued !== true) {
    const { pumpFullCodeIndexRun } = await import(
      '../../../backend/agentsam/codebase/code-indexer.js'
    );
    const runPromise = pumpFullCodeIndexRun(env, queued.run_id || queued.job_id, {
      maxRounds: 4,
      maxFiles: 8,
      maxSymbols: 150,
      wallBudgetMs: 28_000,
    });
    if (ctx?.waitUntil) {
      ctx.waitUntil(runPromise.catch((error) => console.error('[project-reindex]', error)));
    } else {
      void runPromise.catch((error) => console.error('[project-reindex]', error));
    }
  }

  const effectiveMode = queued.mode || mode;
  return jsonResponse(
    {
      ok: true,
      run_id: queued.run_id || queued.job_id,
      job_id: queued.run_id || queued.job_id,
      status: queued.status === 'running' ? 'running' : 'queued',
      stage: 'queued',
      mode: effectiveMode,
      pipeline: 'sam.codebaseindex.index.run',
      workspace_id: resolved.executionWorkspaceId,
      github_repo: githubRepo,
      base_sha: queued.base_sha || null,
      queue_enqueued: queued.queue_enqueued === true,
      message:
        effectiveMode === 'incremental'
          ? queued.queue_enqueued === true
            ? 'Incremental compare crawl queued on MY_QUEUE — only changed paths are processed.'
            : 'Incremental compare crawl queued (queue fallback).'
          : queued.queue_enqueued === true
            ? 'Full codebase crawl queued on MY_QUEUE — batches continue as each finishes.'
            : 'Full codebase crawl queued (queue fallback). Progress comes from live run stages.',
    },
    202,
  );
}

export async function handleProjectReindexCancel(request, env, authUser, projectId) {
  const body = await request.json().catch(() => ({}));
  const resolved = await resolveProjectExecutionWorkspace(env, authUser, projectId);
  if (resolved.error) {
    return jsonResponse({ ok: false, error: resolved.error }, resolved.status || 500);
  }
  const { cancelFullCodeIndexRun } = await import(
    '../../../backend/agentsam/codebase/deploy-code-index-queue.js'
  );
  const cancelled = await cancelFullCodeIndexRun(env, {
    workspaceId: resolved.executionWorkspaceId,
    runId: body?.run_id ?? null,
    repoFullName: resolved.githubRepo || null,
    reason: body?.reason || 'cancelled_from_project_rail',
  });
  return jsonResponse(
    {
      ok: cancelled.ok !== false,
      ...cancelled,
      mode: 'full',
      pipeline: 'sam.codebaseindex.index.run',
      workspace_id: resolved.executionWorkspaceId,
      github_repo: resolved.githubRepo || null,
    },
    cancelled.ok === false ? 500 : 200,
  );
}

export async function handleProjectBackfillCalls(request, env, authUser, projectId, ctx = null) {
  const body = await request.json().catch(() => ({}));
  const resolved = await resolveProjectExecutionWorkspace(env, authUser, projectId);
  if (resolved.error) {
    return jsonResponse({ ok: false, error: resolved.error }, resolved.status || 500);
  }
  let runId = body?.run_id != null ? String(body.run_id).trim() : '';
  if (!runId && env?.DB) {
    const latest = await env.DB.prepare(
      `SELECT id FROM agentsam_code_index_job
        WHERE workspace_id = ? AND source_type IN ${PRODUCT_SOURCE_TYPE_SQL_IN}
          AND status = 'completed'
        ORDER BY COALESCE(indexed_file_count, 0) DESC, rowid DESC
        LIMIT 1`,
    )
      .bind(resolved.executionWorkspaceId)
      .first()
      .catch(() => null);
    runId = latest?.id ? String(latest.id) : '';
  }
  if (!runId) {
    return jsonResponse(
      { ok: false, error: 'run_id_required', message: 'No activated full-index run to backfill calls on.' },
      400,
    );
  }

  // Mark queued in D1 first (UI poll), then do all heavy work in waitUntil.
  // Inline pump was OOM-killing the request on the ~30MB call_graph.json sidecar.
  if (env?.DB) {
    const job = await env.DB.prepare(
      `SELECT id, symbol_summary FROM agentsam_code_index_job WHERE id = ? LIMIT 1`,
    )
      .bind(runId)
      .first()
      .catch(() => null);
    if (!job?.id) {
      return jsonResponse({ ok: false, error: 'run_not_found', run_id: runId }, 404);
    }
    let summary = {};
    try {
      summary = job.symbol_summary != null ? JSON.parse(String(job.symbol_summary)) : {};
    } catch {
      summary = {};
    }
    if (summary.activated !== true && String(summary.stage || '') !== 'active') {
      return jsonResponse(
        { ok: false, error: 'run_not_activated', run_id: runId },
        409,
      );
    }
    summary = {
      ...summary,
      stages: {
        ...(summary.stages && typeof summary.stages === 'object' ? summary.stages : {}),
        calls_backfill: {
          at: new Date().toISOString(),
          ok: false,
          shard_index: 0,
          queued: true,
          calls_written: Number(summary.calls_written) || 0,
          soft_skipped: null,
        },
      },
    };
    await env.DB.prepare(
      `UPDATE agentsam_code_index_job SET symbol_summary = ?, updated_at = unixepoch() WHERE id = ?`,
    )
      .bind(JSON.stringify(summary), runId)
      .run()
      .catch(() => null);
  }

  const { pumpCallsEdgesBackfill } = await import(
    '../../../backend/agentsam/codebase/codebase-calls-edges.js'
  );
  const runPump = async () => {
    // Resume from D1 checkpoint when re-clicked after a stall (shard_index already set).
    let shardIndex =
      body?.shard_index != null ? Number(body.shard_index) : undefined;
    for (let i = 0; i < 60; i += 1) {
      const step = await pumpCallsEdgesBackfill(env, runId, {
        ...(shardIndex != null && !Number.isNaN(shardIndex) ? { shardIndex } : {}),
        wallBudgetMs: 25_000,
        maxShardsPerPump: 2,
      });
      if (!step.ok) {
        console.error('[project-calls-backfill]', step.error || 'failed', runId);
        break;
      }
      if (step.complete) {
        console.log('[project-calls-backfill] complete', runId, step.calls_written);
        break;
      }
      shardIndex = Number(step.next_shard_index) || 0;
      console.log(
        '[project-calls-backfill] progress',
        runId,
        `shard ${shardIndex}/${step.total_shards}`,
        `calls ${step.calls_written}`,
      );
    }
  };

  if (ctx?.waitUntil) {
    ctx.waitUntil(runPump().catch((error) => console.error('[project-calls-backfill]', error)));
  } else {
    // Dev / no waitUntil: best-effort inline (may time out on large repos).
    await runPump().catch((error) => console.error('[project-calls-backfill]', error));
  }

  return jsonResponse(
    {
      ok: true,
      level: 2,
      run_id: runId,
      complete: false,
      queued: true,
      calls_written: 0,
      message:
        'Call graph (Level 2) queued — sharding sidecar then writing edges (no re-crawl / re-embed).',
    },
    202,
  );
}

export async function handleProjectReindexResume(request, env, authUser, projectId, ctx = null) {
  const body = await request.json().catch(() => ({}));
  const resolved = await resolveProjectExecutionWorkspace(env, authUser, projectId);
  if (resolved.error) {
    return jsonResponse({ ok: false, error: resolved.error }, resolved.status || 500);
  }
  let runId = body?.run_id != null ? String(body.run_id).trim() : '';
  if (!runId && env?.DB && resolved.githubRepo) {
    // Prefer the highest-progress checkpoint (not newest stub cancelled by webhook/single-flight).
    const latest = await env.DB.prepare(
      `SELECT id FROM agentsam_code_index_job
        WHERE workspace_id = ? AND repo_full_name = ? AND source_type IN ${PRODUCT_SOURCE_TYPE_SQL_IN}
          AND status IN ('cancelled', 'failed', 'idle')
        ORDER BY COALESCE(indexed_file_count, 0) DESC,
                 COALESCE(progress_percent, 0) DESC,
                 rowid DESC
        LIMIT 1`,
    )
      .bind(resolved.executionWorkspaceId, resolved.githubRepo)
      .first()
      .catch(() => null);
    runId = latest?.id ? String(latest.id) : '';
  }
  if (!runId) {
    return jsonResponse(
      { ok: false, error: 'run_id_required', message: 'No resumable codebase index run found.' },
      400,
    );
  }
  const { resumeFullCodeIndexRun } = await import(
    '../../../backend/agentsam/codebase/deploy-code-index-queue.js'
  );
  const resumed = await resumeFullCodeIndexRun(env, {
    workspaceId: resolved.executionWorkspaceId,
    runId,
  });
  if (!resumed.ok) {
    return jsonResponse(
      {
        ok: false,
        error: resumed.error || 'resume_failed',
        run_id: runId,
        pipeline: 'sam.codebaseindex.index.run',
      },
      409,
    );
  }
  if (resumed.queue_enqueued !== true && resumed.run_id) {
    const { pumpFullCodeIndexRun } = await import(
      '../../../backend/agentsam/codebase/code-indexer.js'
    );
    const runPromise = pumpFullCodeIndexRun(env, resumed.run_id, {
      maxRounds: 4,
      maxFiles: 8,
      maxSymbols: 150,
      wallBudgetMs: 28_000,
    });
    if (ctx?.waitUntil) {
      ctx.waitUntil(runPromise.catch((error) => console.error('[project-reindex-resume]', error)));
    } else {
      void runPromise.catch((error) => console.error('[project-reindex-resume]', error));
    }
  }
  return jsonResponse(
    {
      ok: true,
      ...resumed,
      pipeline: 'sam.codebaseindex.index.run',
      workspace_id: resolved.executionWorkspaceId,
      github_repo: resolved.githubRepo || null,
      message: 'Continuing the same index run from its last checkpoint — not a new full rebuild.',
    },
    202,
  );
}
