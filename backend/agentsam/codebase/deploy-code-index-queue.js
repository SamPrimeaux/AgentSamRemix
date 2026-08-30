import {
  FULL_INDEX_PIPELINE,
  FULL_SOURCE_TYPE,
  INCREMENTAL_INDEX_MODE,
  INCREMENTAL_REQUIRES_ACTIVATED_BASELINE,
  PRODUCT_SOURCE_TYPE_SQL_IN,
  extractActivatedRevisionSha,
  normalizeCodeIndexMode,
  normalizeFullGitSha,
  resolveQueueBaseSha,
  sourceTypeForMode,
} from './codebase-full-index.js';
import { buildCodeIndexVectorBackendReceipt } from './code-index-vector-backend-receipt.js';
import { normalizeGithubRepoFullName } from './project-github-repo.js';
import { isCodeIndexRunningStale, MINUTE_STALE_RECLAIM_SECONDS } from './code-indexer-shared.js';

const FULL_PIPELINE = FULL_INDEX_PIPELINE;
/** Cloudflare Queue message type — must match dispatcher + inventory. */
export const FULL_INDEX_QUEUE_TYPE = 'codebase_full_index_batch';

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Remap terminal/failed summary stages so Continue can finish verify+activate
 * without re-crawling. Uses stage receipts — never force parse when embed was mid-flight.
 * @param {string|null|undefined} stage
 * @param {Record<string, any>|null|undefined} [stages]
 */
export function normalizeResumeFullIndexStage(stage, stages = null) {
  const s = stage != null ? String(stage).trim() : '';
  if (s === 'verify_failed') return 'verify';
  // Stop/fail wrote stage=cancelled|failed — pick the furthest incomplete receipt.
  if (s === 'cancelled' || s === 'failed') {
    const st = stages && typeof stages === 'object' ? stages : null;
    if (st?.embed_symbols?.complete === true) return 'verify';
    if (st?.parse_chunks?.complete === true) return 'embed_symbols';
    if (st?.embed_symbols && Number(st.embed_symbols.processed) > 0) return 'embed_symbols';
    return 'parse_chunks';
  }
  return s || 'parse_chunks';
}

/**
 * Last activated full/incremental snapshot for workspace+repo (I4 baseline).
 * SSOT — Restart/Update crawl + push mode-pick must use this only (do not reimplement).
 * @param {any} env
 * @param {string} workspaceId
 * @param {string} repo
 * @returns {Promise<{ job_id: string, revision_sha: string, base_sha: string|null }|null>}
 */
export async function findActivatedCodeIndexBaseline(env, workspaceId, repo) {
  if (!env?.DB) return null;
  const ws = workspaceId != null ? String(workspaceId).trim() : '';
  const repoName =
    normalizeGithubRepoFullName(repo) || (repo != null ? String(repo).trim() : '');
  if (!ws || !repoName) return null;
  const rows = await env.DB.prepare(
    `SELECT id, revision_sha, base_sha, symbol_summary, file_manifest
       FROM agentsam_code_index_job
      WHERE workspace_id = ?
        AND repo_full_name = ?
        AND source_type IN ${PRODUCT_SOURCE_TYPE_SQL_IN}
        AND status = 'completed'
      ORDER BY COALESCE(completed_at, finished_at, updated_at) DESC
      LIMIT 25`,
  )
    .bind(ws, repoName)
    .all()
    .catch(() => ({ results: [] }));
  for (const row of rows?.results || []) {
    const revisionSha = extractActivatedRevisionSha(row.symbol_summary, row.file_manifest, row);
    if (revisionSha) {
      return {
        job_id: String(row.id),
        revision_sha: revisionSha,
        base_sha: normalizeFullGitSha(row.base_sha),
      };
    }
  }
  return null;
}

/** Delay before re-delivering a skip that would otherwise ack-and-drop the chain. */
export const FULL_INDEX_SKIP_REQUEUE_DELAY_SECONDS = 60;

/**
 * Isolate death leaves status=running; a fast retry returns job_not_idle and
 * used to ack the queue message — chain dead until a human Continue.
 * Requeue those skips instead of treating them as success.
 * @param {{ reason?: unknown, skipped?: unknown, resume?: unknown }|null|undefined} out
 */
export function fullIndexQueueSkipShouldRequeue(out) {
  if (!out || out.resume === true) return false;
  const reason = String(out.reason || '');
  return reason === 'job_not_idle' || reason === 'single_flight_blocked';
}

/**
 * Preflight / throw-equivalent failures fail the job. A parse batch that
 * already checkpointed idle + resume must keep going even when some files missed.
 * @param {{ ok?: unknown, resume?: unknown, cancelled?: unknown, complete?: unknown }|null|undefined} out
 */
export function fullIndexQueueBatchIsHardFail(out) {
  if (!out) return false;
  if (out.cancelled === true || out.complete === true) return false;
  if (out.resume === true) return false;
  return out.ok === false;
}

/**
 * Enqueue the next full-index batch on MY_QUEUE (near-real-time continuation).
 * @param {any} env
 * @param {{ runId: string, workspaceId?: string|null, delaySeconds?: number }} opts
 */
export async function enqueueFullCodeIndexBatch(env, opts = {}) {
  const runId = opts.runId != null ? String(opts.runId).trim() : '';
  if (!runId) return { ok: false, error: 'run_id_required' };
  if (!env?.MY_QUEUE || typeof env.MY_QUEUE.send !== 'function') {
    return { ok: false, error: 'my_queue_unavailable' };
  }
  const workspaceId = opts.workspaceId != null ? String(opts.workspaceId).trim() : '';
  const delayRaw = Number(opts.delaySeconds);
  const delaySeconds =
    Number.isFinite(delayRaw) && delayRaw > 0 ? Math.min(86400, Math.floor(delayRaw)) : 0;
  const body = {
    type: FULL_INDEX_QUEUE_TYPE,
    run_id: runId,
    workspace_id: workspaceId || null,
    enqueued_at: nowUnix(),
  };
  if (delaySeconds > 0) {
    await env.MY_QUEUE.send(body, { delaySeconds });
  } else {
    await env.MY_QUEUE.send(body);
  }
  return { ok: true, queued: true, run_id: runId, type: FULL_INDEX_QUEUE_TYPE, delay_seconds: delaySeconds };
}

/**
 * Resolve repo + owning user_id for code-index job creation.
 * Exported for file-smoke (same cascade as product queue).
 *
 * @param {any} env
 * @param {{ repoFullName?: string|null, projectId?: string|null, userId?: string|null }} opts
 * @param {string} workspaceId
 */
export async function resolveRepoAndUserForCodeIndex(env, opts, workspaceId) {
  const { normalizeGithubRepoFullName, readProjectGithubRepoFromRow } = await import(
    './project-github-repo.js'
  );

  let repo = normalizeGithubRepoFullName(opts.repoFullName) || '';
  const projectId = opts.projectId != null ? String(opts.projectId).trim() : '';

  if (!repo) {
    if (projectId) {
      const projectRow = await env.DB.prepare(
        `SELECT id, metadata_json FROM projects WHERE id = ? LIMIT 1`,
      )
        .bind(projectId)
        .first()
        .catch(() => null);
      repo = readProjectGithubRepoFromRow(projectRow) || '';
    }
  }

  if (!repo) throw new Error('repo_full_name_required');

  let userId = opts.userId != null ? String(opts.userId).trim() : '';

  /** @param {string} wid */
  async function userIdFromWorkspace(wid) {
    const id = wid != null ? String(wid).trim() : '';
    if (!id) return '';
    const owner = await env.DB.prepare(`SELECT user_id FROM workspaces WHERE id = ? LIMIT 1`)
      .bind(id)
      .first()
      .catch(() => null);
    return owner?.user_id != null ? String(owner.user_id).trim() : '';
  }

  if (!userId) userId = await userIdFromWorkspace(workspaceId);

  if (!userId && projectId) {
    const projectWs = await env.DB.prepare(`SELECT workspace_id FROM projects WHERE id = ? LIMIT 1`)
      .bind(projectId)
      .first()
      .catch(() => null);
    if (projectWs?.workspace_id) {
      userId = await userIdFromWorkspace(String(projectWs.workspace_id));
    }
  }

  if (!userId) {
    const prior = await env.DB.prepare(
      `SELECT user_id FROM agentsam_code_index_job
        WHERE user_id IS NOT NULL AND TRIM(user_id) != ''
          AND (
            workspace_id = ?
            OR (? != '' AND project_id = ?)
            OR repo_full_name = ?
          )
        ORDER BY updated_at DESC
        LIMIT 1`,
    )
      .bind(workspaceId, projectId, projectId, repo)
      .first()
      .catch(() => null);
    if (prior?.user_id) userId = String(prior.user_id).trim();
  }

  if (!userId) throw new Error('user_id_required');
  return { repo, userId };
}

async function loadJobColumns(env) {
  const cols = await env.DB.prepare(`PRAGMA table_info(agentsam_code_index_job)`)
    .all()
    .catch(() => ({ results: [] }));
  return new Set((cols.results || []).map((row) => String(row.name).toLowerCase()));
}

/**
 * Single-flight law: at most one idle/running product code-index job per workspace+repo
 * (codebase_full | incremental_refresh). Cancels matching active rows (exceptRunId for Continue).
 * @param {any} env
 * @param {{ workspaceId: string, repoFullName?: string|null, reason?: string, exceptRunId?: string|null }} opts
 */
export async function cancelActiveFullCodeIndexRuns(env, opts = {}) {
  const workspaceId = opts.workspaceId != null ? String(opts.workspaceId).trim() : '';
  if (!workspaceId || !env?.DB) return { ok: false, cancelled_ids: [], changes: 0 };
  const repo = opts.repoFullName != null ? String(opts.repoFullName).trim() : '';
  const exceptRunId = opts.exceptRunId != null ? String(opts.exceptRunId).trim() : '';
  const reason = String(opts.reason || 'cancelled_single_flight').slice(0, 500);

  const selectSql = repo
    ? `SELECT id FROM agentsam_code_index_job
        WHERE workspace_id = ? AND source_type IN ${PRODUCT_SOURCE_TYPE_SQL_IN} AND repo_full_name = ?
          AND status IN ('idle','running')
          ${exceptRunId ? 'AND id != ?' : ''}`
    : `SELECT id FROM agentsam_code_index_job
        WHERE workspace_id = ? AND source_type IN ${PRODUCT_SOURCE_TYPE_SQL_IN}
          AND status IN ('idle','running')
          ${exceptRunId ? 'AND id != ?' : ''}`;
  const selectBinds = repo
    ? exceptRunId
      ? [workspaceId, repo, exceptRunId]
      : [workspaceId, repo]
    : exceptRunId
      ? [workspaceId, exceptRunId]
      : [workspaceId];
  const listed = await env.DB.prepare(selectSql)
    .bind(...selectBinds)
    .all()
    .catch(() => ({ results: [] }));
  const ids = (listed?.results || []).map((r) => String(r.id)).filter(Boolean);
  if (!ids.length) return { ok: true, cancelled_ids: [], changes: 0 };

  const updSql = repo
    ? `UPDATE agentsam_code_index_job
          SET status = 'cancelled',
              last_error = ?,
              finished_at = unixepoch(),
              updated_at = unixepoch()
        WHERE workspace_id = ? AND source_type IN ${PRODUCT_SOURCE_TYPE_SQL_IN} AND repo_full_name = ?
          AND status IN ('idle','running')
          ${exceptRunId ? 'AND id != ?' : ''}`
    : `UPDATE agentsam_code_index_job
          SET status = 'cancelled',
              last_error = ?,
              finished_at = unixepoch(),
              updated_at = unixepoch()
        WHERE workspace_id = ? AND source_type IN ${PRODUCT_SOURCE_TYPE_SQL_IN}
          AND status IN ('idle','running')
          ${exceptRunId ? 'AND id != ?' : ''}`;
  const updBinds = repo
    ? exceptRunId
      ? [reason, workspaceId, repo, exceptRunId]
      : [reason, workspaceId, repo]
    : exceptRunId
      ? [reason, workspaceId, exceptRunId]
      : [reason, workspaceId];
  const upd = await env.DB.prepare(updSql)
    .bind(...updBinds)
    .run()
    .catch(() => null);
  const changes = Number(upd?.meta?.changes ?? upd?.changes ?? 0);

  // Sticky cancel_requested so in-flight batches exit even if status raced.
  for (const id of ids) {
    try {
      const row = await env.DB.prepare(
        `SELECT symbol_summary FROM agentsam_code_index_job WHERE id = ? LIMIT 1`,
      )
        .bind(id)
        .first();
      let prior = {};
      try {
        prior = row?.symbol_summary != null ? JSON.parse(String(row.symbol_summary)) : {};
      } catch {
        prior = {};
      }
      await env.DB.prepare(
        `UPDATE agentsam_code_index_job
            SET symbol_summary = ?, updated_at = unixepoch()
          WHERE id = ?`,
      )
        .bind(
          JSON.stringify({
            ...prior,
            cancel_requested: true,
            cancelled_at: new Date().toISOString(),
            cancel_reason: reason,
            stage: prior.stage === 'active' ? prior.stage : 'cancelled',
          }),
          id,
        )
        .run();
    } catch {
      /* best-effort */
    }
  }

  return { ok: true, cancelled_ids: ids, changes };
}

/** @deprecated alias — use cancelActiveFullCodeIndexRuns */
export async function cancelSiblingFullCodeIndexRuns(env, opts = {}) {
  return cancelActiveFullCodeIndexRuns(env, opts);
}

/**
 * Queue one durable, versioned full-codebase index run.
 * Each run receives its own row/id; migration 1052 removes the legacy
 * UNIQUE(user_id, workspace_id) constraint that previously erased run history.
 */
export async function queueFullCodeIndexRun(env, opts = {}) {
  if (!env?.DB) return { ok: false, skipped: true, reason: 'no_db' };
  const workspaceId = opts.workspaceId != null ? String(opts.workspaceId).trim() : '';
  if (!workspaceId) return { ok: false, skipped: true, reason: 'no_workspace' };
  const mode = normalizeCodeIndexMode(opts.mode);

  try {
    const { ensureSupabaseWorkspaceId, resolveSupabaseWorkspaceId } = await import(
      '../../rag/index.js'
    );
    let workspaceUuid = await resolveSupabaseWorkspaceId(env, workspaceId).catch(() => null);
    if (!workspaceUuid) {
      try {
        workspaceUuid = await ensureSupabaseWorkspaceId(env, workspaceId);
      } catch (e) {
        const msg = String(e?.message || e || 'workspace_uuid_unresolved');
        return {
          ok: false,
          error: msg.startsWith('workspace_') ? msg : 'workspace_uuid_unresolved',
          workspace_id: workspaceId,
          mode,
          message: msg,
        };
      }
    }
    if (!workspaceUuid) {
      return {
        ok: false,
        error: 'workspace_uuid_unresolved',
        workspace_id: workspaceId,
        mode,
        message:
          'Execution workspace has no Supabase UUID mapping — heal projects.workspace_id before indexing.',
      };
    }

    const { repo, userId } = await resolveRepoAndUserForCodeIndex(env, opts, workspaceId);

    let headSha = null;
    let resolvedBranch = opts.branch != null ? String(opts.branch).trim() : '';
    try {
      const { resolveGithubTokenForJob, resolveGithubHeadSha } = await import(
        './code-indexer-github.js'
      );
      const gh = await resolveGithubTokenForJob(env, {
        repo_full_name: repo,
        user_id: userId,
        workspace_id: workspaceId,
      });
      const head = await resolveGithubHeadSha(gh.token, repo, resolvedBranch || null);
      headSha = head.sha;
      if (!resolvedBranch) resolvedBranch = head.branch;
    } catch (e) {
      const msg = String(e?.message || e || 'github_ref_sha_missing');
      return {
        ok: false,
        error: msg.startsWith('github_') ? msg : 'github_ref_sha_missing',
        mode,
        repo_full_name: repo,
        message: msg,
      };
    }

    /** @type {{ job_id: string, revision_sha: string }|null} */
    let baseline = null;
    if (mode === INCREMENTAL_INDEX_MODE) {
      baseline = await findActivatedCodeIndexBaseline(env, workspaceId, repo);
      if (!baseline?.revision_sha) {
        // I4 LOCKED: no silent full-tree fallback inside incremental.
        return {
          ok: false,
          error: INCREMENTAL_REQUIRES_ACTIVATED_BASELINE,
          mode: INCREMENTAL_INDEX_MODE,
          pipeline: FULL_PIPELINE,
          workspace_id: workspaceId,
          repo_full_name: repo,
          message:
            'mode=incremental requires an activated codebase snapshot. Enqueue mode=full (Build) first.',
        };
      }
    }

    const pinned = resolveQueueBaseSha({
      mode,
      activatedBaselineSha: baseline?.revision_sha,
      headSha,
    });
    if (!pinned.ok || !pinned.base_sha) {
      return {
        ok: false,
        error: pinned.error || 'github_ref_sha_missing',
        mode,
        pipeline: FULL_PIPELINE,
        workspace_id: workspaceId,
        repo_full_name: repo,
      };
    }
    const queueBaseSha = pinned.base_sha;

    const active = await env.DB.prepare(
      `SELECT id, status, symbol_summary
         FROM agentsam_code_index_job
        WHERE workspace_id = ?
          AND repo_full_name = ?
          AND source_type IN ${PRODUCT_SOURCE_TYPE_SQL_IN}
          AND status IN ('idle', 'running')
        ORDER BY rowid DESC LIMIT 1`,
    )
      .bind(workspaceId, repo)
      .first()
      .catch(() => null);
    if (active?.id) {
      // Restart (force): kill every idle/running sibling first — dual runners
      // DELETE nodes by file_path and race each other (burns embed budget).
      if (opts.force === true) {
        await cancelSiblingFullCodeIndexRuns(env, {
          workspaceId,
          repoFullName: repo,
          reason: 'cancelled_by_force_restart',
        });
        // fall through — create a brand-new run below
      } else {
        let cancelRequested = false;
        try {
          const prior =
            active.symbol_summary != null ? JSON.parse(String(active.symbol_summary)) : null;
          cancelRequested = prior?.cancel_requested === true;
        } catch {
          /* ignore */
        }
        if (cancelRequested) {
          await env.DB.prepare(
            `UPDATE agentsam_code_index_job
                SET status = 'cancelled', updated_at = unixepoch()
              WHERE id = ? AND status IN ('idle','running')`,
          )
            .bind(String(active.id))
            .run()
            .catch(() => null);
          return {
            ok: true,
            skipped: true,
            cancelled: true,
            reason: 'cancel_requested',
            run_id: String(active.id),
            job_id: String(active.id),
            status: 'cancelled',
            mode,
            pipeline: FULL_PIPELINE,
            message: 'Index is stopped. Call reindex/resume to continue the same run.',
          };
        }
        // Heal accidental dual-active: keep the newest, cancel the rest.
        await cancelActiveFullCodeIndexRuns(env, {
          workspaceId,
          repoFullName: repo,
          reason: 'cancelled_single_flight_heal',
          exceptRunId: String(active.id),
        });
        const enq = await enqueueFullCodeIndexBatch(env, {
          runId: String(active.id),
          workspaceId,
        });
        let activeMode = mode;
        try {
          const prior =
            active.symbol_summary != null ? JSON.parse(String(active.symbol_summary)) : null;
          if (prior?.mode) activeMode = normalizeCodeIndexMode(prior.mode);
        } catch {
          /* ignore */
        }
        return {
          ok: true,
          skipped: true,
          reason: 'already_queued_or_running',
          run_id: String(active.id),
          job_id: String(active.id),
          status: String(active.status || 'idle'),
          mode: activeMode,
          pipeline: FULL_PIPELINE,
          queue_enqueued: enq.ok === true,
          queue_error: enq.ok ? null : enq.error || null,
        };
      }
    }

    // Do NOT auto-resume cancelled/failed runs from full Build — that is Continue only.
    // Incremental Update starts a new compare run against the activated baseline and must
    // not be blocked by a stopped full-crawl checkpoint.
    // force=true cancels siblings above then starts a new run; without force, full stays stopped.
    if (opts.force !== true && mode !== INCREMENTAL_INDEX_MODE) {
      const stopped = await env.DB.prepare(
        `SELECT id, status, file_count, revision_sha FROM agentsam_code_index_job
          WHERE workspace_id = ?
            AND repo_full_name = ?
            AND source_type = ?
            AND status IN ('cancelled', 'failed')
          ORDER BY rowid DESC LIMIT 1`,
      )
        .bind(workspaceId, repo, FULL_SOURCE_TYPE)
        .first()
        .catch(() => null);
      const stoppedHasCheckpoint =
        stopped?.id &&
        String(stopped.status) === 'cancelled' &&
        ((Number(stopped.file_count) || 0) > 0 || Boolean(normalizeFullGitSha(stopped.revision_sha)));
      if (stoppedHasCheckpoint) {
        return {
          ok: false,
          error: 'index_stopped_use_resume',
          run_id: String(stopped.id),
          status: 'cancelled',
          mode,
          pipeline: FULL_PIPELINE,
          message:
            'This index is stopped with a checkpoint. Use Continue (reindex/resume) — not Build — to avoid a new full crawl. Or use Update for an incremental sync.',
        };
      }
    }

    const runId = `cidxrun_${crypto.randomUUID().replace(/-/g, '')}`;
    const { allocCodeIndexGenerationId } = await import('./code-index-generation.js');
    const indexGenerationId = allocCodeIndexGenerationId();
    const nowSec = nowUnix();
    const nowIso = new Date(nowSec * 1000).toISOString();
    const summary = {
      pipeline: FULL_PIPELINE,
      mode,
      run_id: runId,
      index_generation_id: indexGenerationId,
      stage: 'queued',
      readiness: 'building',
      // Honest until activate rollup from agentsam_code_index_job_file receipts.
      structural_quality: 'pending',
      requested_at: nowIso,
      requested_by: userId,
      trigger: opts.triggeredBy || 'project_reindex',
      base_sha: queueBaseSha,
      head_sha: pinned.head_sha || queueBaseSha,
      ...(baseline
        ? {
            baseline_job_id: baseline.job_id,
          }
        : {}),
      stages: { queued: { at: nowIso, ok: true } },
    };
    const manifest = {
      pipeline: FULL_PIPELINE,
      mode,
      run_id: runId,
      index_generation_id: indexGenerationId,
      repo,
      branch: resolvedBranch || null,
      revision_sha: null,
      head_sha: pinned.head_sha || queueBaseSha,
      base_sha: queueBaseSha,
      classification_complete: false,
      discovery: mode === INCREMENTAL_INDEX_MODE ? 'compare' : 'tree',
      ...(baseline ? { baseline_job_id: baseline.job_id } : {}),
      files: [],
      removed_paths: [],
    };
    const names = await loadJobColumns(env);
    const required = ['id', 'user_id', 'workspace_id', 'status', 'source_type', 'repo_full_name'];
    if (required.some((column) => !names.has(column))) {
      return { ok: false, error: 'agentsam_code_index_job_schema_unsupported', mode };
    }

    const values = {
      id: runId,
      user_id: userId,
      workspace_id: workspaceId,
      status: 'idle',
      source_type: sourceTypeForMode(mode),
      source_path: null,
      vector_backend: await buildCodeIndexVectorBackendReceipt(env),
      file_manifest: JSON.stringify(manifest),
      symbol_summary: JSON.stringify(summary),
      dependency_summary: JSON.stringify({
        run_id: runId,
        index_generation_id: indexGenerationId,
        relationship_quality: 'pending',
        mode,
      }),
      languages: '{}',
      file_count: 0,
      indexed_file_count: 0,
      failed_file_count: 0,
      total_size_bytes: 0,
      chunk_count: 0,
      symbol_count: 0,
      progress_percent: 0,
      // Tip filled at crawl; base pinned at queue (HEAD for full, activated SHA for incremental).
      revision_sha: null,
      base_sha: queueBaseSha,
      triggered_by: opts.triggeredBy || 'project_reindex',
      repo_full_name: repo,
      index_generation_id: indexGenerationId,
      is_active: 0,
      activated_at: null,
      project_id:
        opts.projectId != null && String(opts.projectId).trim()
          ? String(opts.projectId).trim()
          : null,
      person_uuid:
        opts.personUuid != null && String(opts.personUuid).trim()
          ? String(opts.personUuid).trim()
          : null,
      started_at: null,
      completed_at: null,
      finished_at: null,
      last_sync_at: null,
      last_error: null,
      updated_at: nowSec,
    };
    const columns = Object.keys(values).filter((column) => names.has(column));
    await env.DB.prepare(
      `INSERT INTO agentsam_code_index_job (${columns.join(', ')})
       VALUES (${columns.map(() => '?').join(', ')})`,
    )
      .bind(...columns.map((column) => values[column]))
      .run();

    const enq = await enqueueFullCodeIndexBatch(env, { runId, workspaceId });
    if (!enq.ok) {
      console.warn('[full-code-index-queue] MY_QUEUE.send failed', enq.error);
    }

    return {
      ok: true,
      queued: true,
      run_id: runId,
      job_id: runId,
      index_generation_id: indexGenerationId,
      workspace_id: workspaceId,
      repo_full_name: repo,
      branch: resolvedBranch || 'main',
      status: 'queued',
      mode,
      pipeline: FULL_PIPELINE,
      base_sha: queueBaseSha,
      ...(baseline ? { baseline_job_id: baseline.job_id } : {}),
      queue_enqueued: enq.ok === true,
      queue_error: enq.ok ? null : enq.error || null,
    };
  } catch (error) {
    console.warn('[full-code-index-queue]', error?.message ?? error);
    return { ok: false, error: String(error?.message || error), mode };
  }
}

export async function cancelFullCodeIndexRun(env, opts = {}) {
  if (!env?.DB) return { ok: false, error: 'no_db' };
  const workspaceId = opts.workspaceId != null ? String(opts.workspaceId).trim() : '';
  const requestedRunId = opts.runId != null ? String(opts.runId).trim() : '';
  let repo = opts.repoFullName != null ? String(opts.repoFullName).trim() : '';
  if (!workspaceId) return { ok: false, error: 'workspace_id_required' };
  const reason = String(opts.reason || 'cancelled_by_operator').slice(0, 500);

  // Resolve repo from the targeted run (or latest active) so Stop kills every sibling.
  if (!repo && requestedRunId) {
    const targeted = await env.DB.prepare(
      `SELECT repo_full_name FROM agentsam_code_index_job
        WHERE id = ? AND workspace_id = ? AND source_type IN ${PRODUCT_SOURCE_TYPE_SQL_IN} LIMIT 1`,
    )
      .bind(requestedRunId, workspaceId)
      .first()
      .catch(() => null);
    if (targeted?.repo_full_name) repo = String(targeted.repo_full_name).trim();
  }
  if (!repo) {
    const latest = await env.DB.prepare(
      `SELECT repo_full_name FROM agentsam_code_index_job
        WHERE workspace_id = ? AND source_type IN ${PRODUCT_SOURCE_TYPE_SQL_IN} AND status IN ('idle','running')
        ORDER BY rowid DESC LIMIT 1`,
    )
      .bind(workspaceId)
      .first()
      .catch(() => null);
    if (latest?.repo_full_name) repo = String(latest.repo_full_name).trim();
  }
  if (!repo) return { ok: true, skipped: true, reason: 'no_active_full_run' };

  const siblings = await cancelSiblingFullCodeIndexRuns(env, {
    workspaceId,
    repoFullName: repo,
    reason,
  });
  const primaryId =
    requestedRunId ||
    (siblings.cancelled_ids.length ? siblings.cancelled_ids[0] : null);

  if (siblings.changes > 0 && primaryId) {
    try {
      const { recordCodeIndexTerminalOutcome } = await import('./code-index-terminal-log.js');
      await recordCodeIndexTerminalOutcome(env, {
        outcome: 'cancelled',
        jobId: String(primaryId),
        workspaceId,
        repo,
        revisionSha: null,
        stage: 'cancelled',
        error: reason,
        context: {
          cancelled_via: 'cancelFullCodeIndexRun',
          cancelled_ids: siblings.cancelled_ids,
          single_flight: true,
        },
      });
    } catch (e) {
      console.warn('[full-code-index-queue] cancel terminal_log', e?.message ?? e);
    }
  }

  return {
    ok: true,
    cancelled: siblings.changes > 0,
    run_id: primaryId,
    cancelled_ids: siblings.cancelled_ids,
    previous_status: siblings.changes > 0 ? 'idle_or_running' : null,
  };
}

/**
 * Continue the same run_id from durable offsets (Stop/Resume law).
 * Does NOT create a new cidxrun_*.
 */
export async function resumeFullCodeIndexRun(env, opts = {}) {
  if (!env?.DB) return { ok: false, error: 'no_db' };
  const workspaceId = opts.workspaceId != null ? String(opts.workspaceId).trim() : '';
  const runId = opts.runId != null ? String(opts.runId).trim() : '';
  if (!workspaceId) return { ok: false, error: 'workspace_id_required' };
  if (!runId) return { ok: false, error: 'run_id_required' };

  const row = await env.DB.prepare(
    `SELECT id, status, symbol_summary, file_manifest, repo_full_name, indexed_file_count, file_count, updated_at, started_at
       FROM agentsam_code_index_job
      WHERE id = ? AND workspace_id = ? AND source_type IN ${PRODUCT_SOURCE_TYPE_SQL_IN}
      LIMIT 1`,
  )
    .bind(runId, workspaceId)
    .first()
    .catch(() => null);
  if (!row?.id) return { ok: false, error: 'run_not_found' };

  const status = String(row.status || '');
  if (status === 'completed') {
    return { ok: false, error: 'run_already_completed', run_id: runId, status };
  }

  const repoName = row.repo_full_name != null ? String(row.repo_full_name).trim() : '';
  const anchorTs = Math.max(Number(row.started_at) || 0, Number(row.updated_at) || 0);
  // Continue on an old checkpoint must NOT single-flight-kill a newer Build/Restart.
  if (repoName) {
    const newer = await env.DB.prepare(
      `SELECT id, status, started_at, updated_at
         FROM agentsam_code_index_job
        WHERE workspace_id = ?
          AND repo_full_name = ?
          AND source_type IN ${PRODUCT_SOURCE_TYPE_SQL_IN}
          AND status IN ('idle', 'running')
          AND id != ?
          AND COALESCE(started_at, updated_at, 0) >= ?
        ORDER BY COALESCE(started_at, updated_at, 0) DESC, rowid DESC
        LIMIT 1`,
    )
      .bind(workspaceId, repoName, runId, anchorTs)
      .first()
      .catch(() => null);
    if (newer?.id) {
      const enq = await enqueueFullCodeIndexBatch(env, {
        runId: String(newer.id),
        workspaceId,
      });
      return {
        ok: false,
        error: 'newer_run_in_progress',
        run_id: String(newer.id),
        status: String(newer.status || ''),
        queue_enqueued: enq.ok === true,
        message:
          'A newer index run is already active for this repo. Open that run (or wait) — Continue will not cancel it.',
      };
    }
  }

  // Continue must not revive a stopped run while a different job is still burning spend.
  const siblings = await cancelActiveFullCodeIndexRuns(env, {
    workspaceId,
    repoFullName: repoName || null,
    reason: 'cancelled_by_continue_single_flight',
    exceptRunId: runId,
  });

  if (status === 'running' && !isCodeIndexRunningStale(row.updated_at)) {
    const enq = await enqueueFullCodeIndexBatch(env, { runId, workspaceId });
    return {
      ok: true,
      resumed: true,
      already_running: true,
      run_id: runId,
      status: 'running',
      queue_enqueued: enq.ok === true,
      cancelled_siblings: siblings.cancelled_ids || [],
    };
  }
  if (!['cancelled', 'idle', 'failed', 'running'].includes(status)) {
    return { ok: false, error: `run_not_resumable:${status}`, run_id: runId, status };
  }

  let summary = {};
  try {
    summary = row.symbol_summary != null ? JSON.parse(String(row.symbol_summary)) : {};
  } catch {
    summary = {};
  }
  const stage = String(summary.stage || '');
  if (stage === 'active') {
    return { ok: false, error: 'run_already_active', run_id: runId };
  }

  const callsBf = summary?.stages?.calls_backfill;
  const callsInProgress =
    callsBf &&
    callsBf.ok !== true &&
    (Number(callsBf.total_shards) > 0 ||
      callsBf.queued === true ||
      Number(callsBf.shard_index) >= 0);
  // Near-complete call-graph jobs must resume Level 2 — never fall back to parse_chunks.
  let resumeStage = callsInProgress
    ? 'calls_backfill'
    : normalizeResumeFullIndexStage(stage, summary.stages);
  // If embed already completed, jump straight to verify (no re-embed spend).
  // Covers stage left as 'failed' after unknown_full_index_stage:verify_failed.
  // Do NOT steal a mid-flight calls_backfill checkpoint.
  const embedDone = summary?.stages?.embed_symbols?.complete === true;
  const nextStage =
    !callsInProgress &&
    embedDone &&
    (resumeStage === 'embed_symbols' ||
      resumeStage === 'parse_chunks' ||
      stage === 'failed' ||
      stage === 'verify_failed')
      ? 'verify'
      : resumeStage;

  const nowSec = nowUnix();
  const healedOffset = Math.max(
    Number(summary.symbol_offset) || 0,
    Number(summary.stages?.embed_symbols?.processed) || 0,
    Number(row.symbol_count) || 0,
  );
  const nextSummary = {
    ...summary,
    stage: nextStage,
    symbol_offset: healedOffset,
    cancel_requested: false,
    resumed_at: new Date(nowSec * 1000).toISOString(),
    resume_from_status: status,
    stages: {
      ...(summary.stages && typeof summary.stages === 'object' ? summary.stages : {}),
      resume: {
        at: new Date(nowSec * 1000).toISOString(),
        ok: true,
        from_status: status,
        from_stage: stage || null,
        to_stage: nextStage,
        symbol_offset: healedOffset,
        indexed_file_count: Number(row.indexed_file_count) || 0,
        cancelled_siblings: siblings.cancelled_ids || [],
      },
    },
  };

  const names = await loadJobColumns(env);
  const sets = ['status = ?', 'last_error = NULL', 'triggered_by = ?', 'symbol_summary = ?', 'updated_at = unixepoch()'];
  const binds = ['idle', 'resume', JSON.stringify(nextSummary)];
  if (names.has('finished_at')) {
    sets.push('finished_at = NULL');
  }
  if (names.has('completed_at')) {
    sets.push('completed_at = NULL');
  }
  const staleSec = Math.max(60, Number(MINUTE_STALE_RECLAIM_SECONDS) || 120);
  const upd = await env.DB.prepare(
    `UPDATE agentsam_code_index_job
        SET ${sets.join(', ')}
      WHERE id = ?
        AND (
          status IN ('cancelled', 'idle', 'failed')
          OR (status = 'running' AND updated_at < unixepoch() - ${staleSec})
        )`,
  )
    .bind(...binds, runId)
    .run();
  const changed = Number(upd?.meta?.changes ?? upd?.changes ?? 0) > 0;
  if (!changed) {
    return { ok: false, error: 'resume_race_lost', run_id: runId };
  }

  const enq = await enqueueFullCodeIndexBatch(env, { runId, workspaceId });
  return {
    ok: true,
    resumed: true,
    run_id: runId,
    job_id: runId,
    status: 'queued',
    stage: stage || 'parse_chunks',
    mode: summary.mode || 'full',
    symbol_offset: Number(summary.symbol_offset) || 0,
    indexed_file_count: Number(row.indexed_file_count) || 0,
    file_count: Number(row.file_count) || 0,
    repo_full_name: row.repo_full_name || null,
    queue_enqueued: enq.ok === true,
    queue_error: enq.ok ? null : enq.error || null,
    previous_status: status,
    cancelled_siblings: siblings.cancelled_ids || [],
  };
}

/**
 * Legacy deploy-triggered chunk queue. Kept for existing automation only; the
 * Projects product surface uses queueFullCodeIndexRun exclusively.
 */
export async function queueCodeIndexJobAfterDeploy(env, opts = {}) {
  if (!env?.DB) return { ok: false, skipped: true, reason: 'no_db' };
  const workspaceId = opts.workspaceId != null ? String(opts.workspaceId).trim() : '';
  if (!workspaceId) return { ok: false, skipped: true, reason: 'no_workspace' };
  try {
    const { repo, userId } = await resolveRepoAndUserForCodeIndex(env, opts, workspaceId);
    const running = await env.DB.prepare(
      `SELECT id FROM agentsam_code_index_job
        WHERE status = 'running' AND workspace_id = ?
          AND COALESCE(source_type, '') NOT IN ('ast_rag','ast_symbol_reembed','codebase_full')
        ORDER BY rowid DESC LIMIT 1`,
    )
      .bind(workspaceId)
      .first()
      .catch(() => null);
    if (running?.id) return { ok: true, skipped: true, reason: 'already_running', job_id: running.id };

    const id = `cij_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const names = await loadJobColumns(env);
    const values = {
      id,
      user_id: userId,
      workspace_id: workspaceId,
      status: 'idle',
      triggered_by: opts.triggeredBy || 'deploy',
      repo_full_name: repo,
      source_type: 'chunks',
      vector_backend: await buildCodeIndexVectorBackendReceipt(env),
      indexed_file_count: 0,
      progress_percent: 0,
      chunk_count: 0,
      updated_at: nowUnix(),
    };
    const columns = Object.keys(values).filter((column) => names.has(column));
    await env.DB.prepare(
      `INSERT INTO agentsam_code_index_job (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    )
      .bind(...columns.map((column) => values[column]))
      .run();
    return { ok: true, job_id: id, workspace_id: workspaceId, repo_full_name: repo };
  } catch (error) {
    console.warn('[deploy-code-index-queue]', error?.message ?? error);
    return { ok: false, error: String(error?.message || error) };
  }
}
