/**
 * Single-file code-index smoke — one meaningful path through parse → embed → PG write.
 * Never activate / orphan-prune (would wipe the product keep-set).
 *
 * Default target: src/core/code-index-write-pipe.js on project inneranimalmedia.
 */
import {
  FILE_SMOKE_SOURCE_TYPE,
  FULL_INDEX_PIPELINE,
  FULL_INDEX_MODE,
  classifyRepoPath,
} from '../../backend/agentsam/codebase/codebase-full-index.js';
import { loadRepoIgnorePolicy } from '../../packages/shared/code-index/ignore-policy.js';
import { resolveCodeIndexWriteConnection } from '../../backend/agentsam/codebase/code-index-write-pipe.js';
import { buildCodeIndexVectorBackendReceipt } from '../../backend/agentsam/codebase/code-index-vector-backend-receipt.js';
import { nowUnix } from '../../backend/agentsam/codebase/code-indexer-shared.js';

/** Locked smoke path for the Hyperdrive write cutover. */
export const CODE_INDEX_FILE_SMOKE_DEFAULT_PATH = 'backend/agentsam/codebase/code-index-write-pipe.js';
export const CODE_INDEX_FILE_SMOKE_DEFAULT_PROJECT = 'inneranimalmedia';

/**
 * @param {any} env
 * @param {{
 *   workspaceId: string,
 *   projectId?: string|null,
 *   repoFullName?: string|null,
 *   userId?: string|null,
 *   path?: string|null,
 *   branch?: string|null,
 *   triggeredBy?: string|null,
 * }} opts
 */
export async function queueCodeIndexFileSmoke(env, opts = {}) {
  if (!env?.DB) return { ok: false, error: 'no_db' };
  const workspaceId = opts.workspaceId != null ? String(opts.workspaceId).trim() : '';
  if (!workspaceId) return { ok: false, error: 'workspace_id_required' };

  const filePath = String(opts.path || CODE_INDEX_FILE_SMOKE_DEFAULT_PATH)
    .trim()
    .replace(/^\/+/, '');
  if (!filePath || filePath.includes('..') || filePath.startsWith('/')) {
    return { ok: false, error: 'smoke_file_path_invalid' };
  }

  const { resolveSupabaseWorkspaceId, ensureSupabaseWorkspaceId } = await import('../../backend/rag/index.js');
  let workspaceUuid = await resolveSupabaseWorkspaceId(env, workspaceId).catch(() => null);
  if (!workspaceUuid) {
    try {
      workspaceUuid = await ensureSupabaseWorkspaceId(env, workspaceId);
    } catch (e) {
      return {
        ok: false,
        error: 'workspace_uuid_unresolved',
        message: String(e?.message || e).slice(0, 240),
      };
    }
  }

  // Reuse queue resolver (now cascades user_id for internal kicks).
    const { queueFullCodeIndexRun } = await import(
      '../../backend/agentsam/codebase/deploy-code-index-queue.js'
    );
  // Import resolve via a thin local duplicate of GH+user steps — call internal by
  // creating the job ourselves so we can set source_type + seeded manifest.
  const resolveMod = await import(
    '../../backend/agentsam/codebase/deploy-code-index-queue.js'
  );
  void resolveMod;
  void queueFullCodeIndexRun;

  const { normalizeGithubRepoFullName, readProjectGithubRepoFromRow } = await import(
    '../../backend/agentsam/codebase/project-github-repo.js'
  );
  let repo = normalizeGithubRepoFullName(opts.repoFullName) || '';
  const projectId = opts.projectId != null ? String(opts.projectId).trim() : '';
  if (!repo && projectId) {
    const projectRow = await env.DB.prepare(
      `SELECT id, metadata_json FROM projects WHERE id = ? LIMIT 1`,
    )
      .bind(projectId)
      .first()
      .catch(() => null);
    repo = readProjectGithubRepoFromRow(projectRow) || '';
  }
  if (!repo) return { ok: false, error: 'repo_full_name_required' };

  // Inline user resolve (same cascade as queue) — import would need export.
  let userId = opts.userId != null ? String(opts.userId).trim() : '';
  if (!userId) {
    const owner = await env.DB.prepare(`SELECT user_id FROM workspaces WHERE id = ? LIMIT 1`)
      .bind(workspaceId)
      .first()
      .catch(() => null);
    if (owner?.user_id) userId = String(owner.user_id).trim();
  }
  if (!userId && projectId) {
    const pws = await env.DB.prepare(`SELECT workspace_id FROM projects WHERE id = ? LIMIT 1`)
      .bind(projectId)
      .first()
      .catch(() => null);
    if (pws?.workspace_id) {
      const owner = await env.DB.prepare(`SELECT user_id FROM workspaces WHERE id = ? LIMIT 1`)
        .bind(String(pws.workspace_id))
        .first()
        .catch(() => null);
      if (owner?.user_id) userId = String(owner.user_id).trim();
    }
  }
  if (!userId) {
    const prior = await env.DB.prepare(
      `SELECT user_id FROM agentsam_code_index_job
        WHERE user_id IS NOT NULL AND TRIM(user_id) != ''
          AND (workspace_id = ? OR (? != '' AND project_id = ?) OR repo_full_name = ?)
        ORDER BY updated_at DESC LIMIT 1`,
    )
      .bind(workspaceId, projectId, projectId, repo)
      .first()
      .catch(() => null);
    if (prior?.user_id) userId = String(prior.user_id).trim();
  }
  if (!userId) return { ok: false, error: 'user_id_required' };

  let headSha = null;
  let resolvedBranch = opts.branch != null ? String(opts.branch).trim() : '';
  let fileMeta;
  try {
    const { resolveGithubTokenForJob, resolveGithubHeadSha, fetchRepoFileMeta } = await import(
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
    fileMeta = await fetchRepoFileMeta(gh.token, repo, filePath, resolvedBranch || headSha);
  } catch (e) {
    return {
      ok: false,
      error: String(e?.message || e).startsWith('github_')
        ? String(e.message)
        : `github_file_smoke_failed:${String(e?.message || e).slice(0, 200)}`,
    };
  }

  if (!fileMeta?.content) {
    return { ok: false, error: 'smoke_file_empty', path: filePath };
  }

  const repoPolicy = await loadRepoIgnorePolicy(env.DB, repo);
  const classified = classifyRepoPath(filePath, fileMeta.size, repoPolicy);
  if (
    classified.classification !== 'structural_and_chunks' &&
    classified.classification !== 'chunks_only'
  ) {
    return {
      ok: false,
      error: 'smoke_file_not_indexable',
      path: filePath,
      classification: classified.classification,
      reason: classified.reason || null,
    };
  }

  const fileEntry = {
    ...classified,
    git_blob_sha: fileMeta.sha,
    size_bytes: fileMeta.size,
  };

  const runId = `cidxsmoke_${crypto.randomUUID().replace(/-/g, '')}`;
  const { allocCodeIndexGenerationId } = await import(
    '../../backend/agentsam/codebase/code-index-generation.js'
  );
  const indexGenerationId = allocCodeIndexGenerationId();
  const nowSec = nowUnix();
  const nowIso = new Date(nowSec * 1000).toISOString();
  const writePipe = resolveCodeIndexWriteConnection(env).write_pipe;

  let vectorBackend;
  try {
    vectorBackend = await buildCodeIndexVectorBackendReceipt(env);
  } catch (e) {
    return {
      ok: false,
      error: 'vector_backend_receipt_failed',
      message: String(e?.message || e).slice(0, 240),
    };
  }

  const summary = {
    pipeline: FULL_INDEX_PIPELINE,
    mode: FULL_INDEX_MODE,
    smoke_file: true,
    run_id: runId,
    index_generation_id: indexGenerationId,
    stage: 'parse_chunks',
    readiness: 'smoke',
    requested_at: nowIso,
    requested_by: userId,
    trigger: opts.triggeredBy || 'internal_file_smoke',
    smoke_path: filePath,
    write_pipe: writePipe,
    stages: {
      queued: { at: nowIso, ok: true },
      crawl: {
        at: nowIso,
        ok: true,
        discovery: 'smoke_file',
        processable_files: 1,
        revision_sha: headSha,
      },
    },
  };

  const manifest = {
    pipeline: FULL_INDEX_PIPELINE,
    mode: FULL_INDEX_MODE,
    smoke_file: true,
    run_id: runId,
    index_generation_id: indexGenerationId,
    repo,
    repo_full_name: repo,
    branch: resolvedBranch || null,
    revision_sha: headSha,
    head_sha: headSha,
    base_sha: headSha,
    classification_complete: true,
    discovery: 'smoke_file',
    files: [fileEntry],
    removed_paths: [],
    changed_count: 1,
  };

  const cols = await env.DB.prepare(`PRAGMA table_info(agentsam_code_index_job)`)
    .all()
    .catch(() => ({ results: [] }));
  const names = new Set((cols.results || []).map((r) => String(r.name).toLowerCase()));

  const values = {
    id: runId,
    user_id: userId,
    workspace_id: workspaceId,
    status: 'idle',
    source_type: FILE_SMOKE_SOURCE_TYPE,
    source_path: filePath,
    repo_full_name: repo,
    file_count: 1,
    indexed_file_count: 0,
    failed_file_count: 0,
    chunk_count: 0,
    symbol_count: 0,
    progress_percent: 1,
    total_size_bytes: fileMeta.size,
    triggered_by: opts.triggeredBy || 'internal_file_smoke',
    started_at: nowSec,
    updated_at: nowSec,
    file_manifest: JSON.stringify(manifest),
    symbol_summary: JSON.stringify(summary),
    languages: JSON.stringify(fileEntry.language ? { [fileEntry.language]: 1 } : {}),
    vector_backend: vectorBackend,
    revision_sha: headSha,
    base_sha: headSha,
    index_generation_id: indexGenerationId,
    is_active: 0,
  };
  if (names.has('project_id') && projectId) values.project_id = projectId;

  const insertCols = Object.keys(values).filter((k) => names.has(k));
  const placeholders = insertCols.map(() => '?').join(', ');
  await env.DB.prepare(
    `INSERT INTO agentsam_code_index_job (${insertCols.join(', ')}) VALUES (${placeholders})`,
  )
    .bind(...insertCols.map((k) => values[k]))
    .run();

  return {
    ok: true,
    smoke_file: true,
    run_id: runId,
    job_id: runId,
    project_id: projectId || null,
    workspace_id: workspaceId,
    workspace_uuid: workspaceUuid,
    repo_full_name: repo,
    path: filePath,
    branch: resolvedBranch || null,
    revision_sha: headSha,
    write_pipe: writePipe,
    classification: fileEntry.classification,
    git_blob_sha: fileMeta.sha,
    source_type: FILE_SMOKE_SOURCE_TYPE,
    status: 'idle',
  };
}
