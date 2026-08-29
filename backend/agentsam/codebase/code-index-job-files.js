/**
 * Per-file inventory for agentsam_code_index_job (replaces fat file_manifest.files[]).
 * Table: agentsam_code_index_job_file
 */

const FILE_D1_KEYS = [
  'path',
  'classification',
  'size_bytes',
  'language',
  'extension',
  'git_blob_sha',
  'file_hash',
  'sha',
  'status',
  'parser_id',
  'structural_quality',
  'error',
  'chunks_written',
  'symbols_written',
  'chunks_relinked',
  'symbols_relinked',
  'vectorize_soft_fails',
  'chat_rag_lane',
  'file_ordinal',
];

const UPSERT_SQL = `INSERT INTO agentsam_code_index_job_file (
  id, index_job_id, workspace_id, repo_full_name, path,
  classification, language, extension, size_bytes,
  git_blob_sha, file_hash, status, parser_id, structural_quality, error,
  chunks_written, symbols_written, chunks_relinked, symbols_relinked,
  vectorize_soft_fails, chat_rag_lane, index_generation_id, file_ordinal, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
ON CONFLICT(index_job_id, path) DO UPDATE SET
  classification = COALESCE(excluded.classification, classification),
  language = COALESCE(excluded.language, language),
  extension = COALESCE(excluded.extension, extension),
  size_bytes = COALESCE(excluded.size_bytes, size_bytes),
  git_blob_sha = COALESCE(excluded.git_blob_sha, git_blob_sha),
  file_hash = COALESCE(excluded.file_hash, file_hash),
  file_ordinal = COALESCE(excluded.file_ordinal, file_ordinal),
  -- Terminal rows are never demoted by inventory re-stamp.
  status = CASE
    WHEN status IN ('indexed', 'failed', 'skipped_unchanged') THEN status
    WHEN excluded.status IS NOT NULL AND excluded.status != '' THEN excluded.status
    ELSE COALESCE(status, 'pending')
  END,
  parser_id = CASE WHEN excluded.status IS NOT NULL AND excluded.status NOT IN ('pending', '') THEN excluded.parser_id ELSE parser_id END,
  structural_quality = CASE WHEN excluded.status IS NOT NULL AND excluded.status NOT IN ('pending', '') THEN excluded.structural_quality ELSE structural_quality END,
  error = CASE WHEN excluded.status IS NOT NULL AND excluded.status NOT IN ('pending', '') THEN excluded.error ELSE error END,
  chunks_written = CASE WHEN excluded.status IS NOT NULL AND excluded.status NOT IN ('pending', '') THEN excluded.chunks_written ELSE chunks_written END,
  symbols_written = CASE WHEN excluded.status IS NOT NULL AND excluded.status NOT IN ('pending', '') THEN excluded.symbols_written ELSE symbols_written END,
  chunks_relinked = CASE WHEN excluded.status IS NOT NULL AND excluded.status NOT IN ('pending', '') THEN excluded.chunks_relinked ELSE chunks_relinked END,
  symbols_relinked = CASE WHEN excluded.status IS NOT NULL AND excluded.status NOT IN ('pending', '') THEN excluded.symbols_relinked ELSE symbols_relinked END,
  vectorize_soft_fails = CASE WHEN excluded.status IS NOT NULL AND excluded.status NOT IN ('pending', '') THEN excluded.vectorize_soft_fails ELSE vectorize_soft_fails END,
  chat_rag_lane = CASE WHEN excluded.status IS NOT NULL AND excluded.status NOT IN ('pending', '') THEN excluded.chat_rag_lane ELSE chat_rag_lane END,
  index_generation_id = COALESCE(excluded.index_generation_id, index_generation_id),
  updated_at = CASE
    WHEN status IN ('indexed', 'failed', 'skipped_unchanged') THEN unixepoch()
    WHEN excluded.status IS NOT NULL AND excluded.status NOT IN ('pending', '') THEN unixepoch()
    WHEN COALESCE(excluded.git_blob_sha, '') != COALESCE(git_blob_sha, '') THEN unixepoch()
    WHEN COALESCE(excluded.file_hash, '') != COALESCE(file_hash, '') THEN unixepoch()
    WHEN COALESCE(excluded.classification, '') != COALESCE(classification, '') THEN unixepoch()
    ELSE updated_at
  END`;

const RECEIPT_UPDATE_SQL = `UPDATE agentsam_code_index_job_file SET
  status = ?,
  parser_id = COALESCE(?, parser_id),
  structural_quality = COALESCE(?, structural_quality),
  error = ?,
  chunks_written = ?,
  symbols_written = ?,
  chunks_relinked = ?,
  symbols_relinked = ?,
  vectorize_soft_fails = ?,
  chat_rag_lane = COALESCE(?, chat_rag_lane),
  git_blob_sha = COALESCE(?, git_blob_sha),
  file_hash = COALESCE(?, file_hash),
  index_generation_id = COALESCE(?, index_generation_id),
  updated_at = unixepoch()
 WHERE index_job_id = ? AND path = ?`;

function slimFileEntry(file) {
  if (!file || typeof file !== 'object') return file;
  const out = {};
  for (const k of FILE_D1_KEYS) {
    if (file[k] != null && file[k] !== '') out[k] = file[k];
  }
  if (file.path != null) out.path = String(file.path);
  if (out.error != null) out.error = String(out.error).slice(0, 300);
  return out;
}

async function fileRowId(jobId, path) {
  const raw = `${String(jobId || '').trim()}\0${String(path || '').trim()}`;
  const bytes = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('');
  return `cif_${hex.slice(0, 40)}`;
}

/**
 * @param {any} env
 * @param {{
 *   jobId: string,
 *   workspaceId: string,
 *   repo_full_name?: string,
 *   repoFullName?: string,
 *   repo?: string,
 *   indexGenerationId?: string,
 *   files: object[],
 *   inventoryStamp?: boolean,
 * }} opts
 *   `repo_full_name` = GitHub owner/name (preferred). `repoFullName` / `repo` are legacy aliases only.
 */
export async function upsertCodeIndexJobFiles(env, opts) {
  const jobId = String(opts.jobId || '').trim();
  const workspaceId = String(opts.workspaceId || '').trim();
  const repo = String(opts.repo_full_name || opts.repoFullName || opts.repo || '').trim();
  const indexGenerationId =
    opts.indexGenerationId != null && String(opts.indexGenerationId).trim()
      ? String(opts.indexGenerationId).trim()
      : null;
  const files = Array.isArray(opts.files) ? opts.files : [];
  if (!env?.DB || !jobId || !workspaceId || !repo || !files.length) {
    return { ok: true, written: 0, skipped: true };
  }
  const stmts = [];
  for (let i = 0; i < files.length; i += 1) {
    const raw = files[i];
    const f = slimFileEntry(raw);
    if (!f?.path) continue;
    const path = String(f.path);
    const id = await fileRowId(jobId, path);
    const gen =
      f.index_generation_id != null && String(f.index_generation_id).trim()
        ? String(f.index_generation_id).trim()
        : indexGenerationId;
    const ordinal =
      f.file_ordinal != null && Number.isFinite(Number(f.file_ordinal))
        ? Number(f.file_ordinal)
        : raw.file_ordinal != null && Number.isFinite(Number(raw.file_ordinal))
          ? Number(raw.file_ordinal)
          : i;
    const status =
      f.status != null && String(f.status).trim()
        ? String(f.status)
        : opts.inventoryStamp === true
          ? 'pending'
          : null;
    const isReceipt =
      status === 'indexed' ||
      status === 'failed' ||
      status === 'skipped_unchanged' ||
      status === 'processing';
    if (isReceipt) {
      stmts.push(
        env.DB.prepare(RECEIPT_UPDATE_SQL).bind(
          status,
          f.parser_id != null ? String(f.parser_id) : null,
          f.structural_quality != null ? String(f.structural_quality) : null,
          f.error != null ? String(f.error).slice(0, 300) : null,
          Number(f.chunks_written) || 0,
          Number(f.symbols_written) || 0,
          Number(f.chunks_relinked) || 0,
          Number(f.symbols_relinked) || 0,
          Number(f.vectorize_soft_fails) || 0,
          f.chat_rag_lane != null ? String(f.chat_rag_lane) : null,
          f.git_blob_sha != null ? String(f.git_blob_sha) : f.sha != null ? String(f.sha) : null,
          f.file_hash != null ? String(f.file_hash) : null,
          gen,
          jobId,
          path,
        ),
      );
      continue;
    }
    stmts.push(
      env.DB.prepare(UPSERT_SQL).bind(
        id,
        jobId,
        workspaceId,
        repo,
        path,
        f.classification != null ? String(f.classification) : null,
        f.language != null ? String(f.language) : null,
        f.extension != null ? String(f.extension) : null,
        f.size_bytes != null ? Number(f.size_bytes) || 0 : null,
        f.git_blob_sha != null ? String(f.git_blob_sha) : f.sha != null ? String(f.sha) : null,
        f.file_hash != null ? String(f.file_hash) : null,
        status,
        f.parser_id != null ? String(f.parser_id) : null,
        f.structural_quality != null ? String(f.structural_quality) : null,
        f.error != null ? String(f.error).slice(0, 300) : null,
        Number(f.chunks_written) || 0,
        Number(f.symbols_written) || 0,
        Number(f.chunks_relinked) || 0,
        Number(f.symbols_relinked) || 0,
        Number(f.vectorize_soft_fails) || 0,
        f.chat_rag_lane != null ? String(f.chat_rag_lane) : null,
        gen,
        ordinal,
      ),
    );
  }
  if (!stmts.length) return { ok: true, written: 0 };
  const CHUNK = 40;
  let written = 0;
  for (let i = 0; i < stmts.length; i += CHUNK) {
    const slice = stmts.slice(i, i + CHUNK);
    await env.DB.batch(slice);
    written += slice.length;
  }
  return { ok: true, written };
}

const FILE_ROW_SELECT = `path, classification, language, extension, size_bytes,
            git_blob_sha, file_hash, status, parser_id, structural_quality, error,
            chunks_written, symbols_written, chunks_relinked, symbols_relinked,
            vectorize_soft_fails, chat_rag_lane, file_ordinal`;

function rowToFileEntry(r) {
  return {
    path: r.path,
    classification: r.classification,
    language: r.language,
    extension: r.extension,
    size_bytes: r.size_bytes,
    git_blob_sha: r.git_blob_sha,
    file_hash: r.file_hash,
    status: r.status,
    parser_id: r.parser_id,
    structural_quality: r.structural_quality,
    error: r.error,
    chunks_written: r.chunks_written,
    symbols_written: r.symbols_written,
    chunks_relinked: r.chunks_relinked,
    symbols_relinked: r.symbols_relinked,
    vectorize_soft_fails: r.vectorize_soft_fails,
    chat_rag_lane: r.chat_rag_lane,
    file_ordinal: r.file_ordinal,
  };
}

/** Rollups from per-file state — job header counters derive from here, not numeric offset. */
export async function rollupCodeIndexJobFileProgress(env, jobId) {
  const id = String(jobId || '').trim();
  if (!env?.DB || !id) {
    return { total: 0, indexed: 0, failed: 0, skipped: 0, pending: 0, processing: 0, processed: 0 };
  }
  const row = await env.DB.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'indexed' THEN 1 ELSE 0 END) AS indexed,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN status = 'skipped_unchanged' THEN 1 ELSE 0 END) AS skipped,
       SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing,
       SUM(CASE WHEN status IS NULL OR status = 'pending' THEN 1 ELSE 0 END) AS pending
     FROM agentsam_code_index_job_file
    WHERE index_job_id = ?`,
  )
    .bind(id)
    .first()
    .catch(() => null);
  const total = Number(row?.total) || 0;
  const indexed = Number(row?.indexed) || 0;
  const failed = Number(row?.failed) || 0;
  const skipped = Number(row?.skipped) || 0;
  const processing = Number(row?.processing) || 0;
  const pending = Number(row?.pending) || 0;
  return {
    total,
    indexed,
    failed,
    skipped,
    pending,
    processing,
    processed: indexed + failed + skipped,
  };
}

/**
 * Claim the next N pending files for a queue batch — no full-manifest hydrate.
 * @param {any} env
 * @param {string} jobId
 * @param {number} [limit]
 * @returns {Promise<object[]>}
 */
export async function claimNextCodeIndexJobFileBatch(env, jobId, limit = 6) {
  const id = String(jobId || '').trim();
  const lim = Math.max(1, Math.min(Number(limit) || 6, 40));
  if (!env?.DB || !id) return [];

  // Stale processing leases return to pending (consumer died mid-batch).
  await env.DB.prepare(
    `UPDATE agentsam_code_index_job_file
        SET status = 'pending', updated_at = unixepoch()
      WHERE index_job_id = ?
        AND status = 'processing'
        AND updated_at < unixepoch() - 600`,
  )
    .bind(id)
    .run()
    .catch(() => null);

  const rows = await env.DB.prepare(
    `SELECT id, ${FILE_ROW_SELECT}
       FROM agentsam_code_index_job_file
      WHERE index_job_id = ?
        AND (status IS NULL OR status = 'pending')
      ORDER BY COALESCE(file_ordinal, rowid) ASC
      LIMIT ?`,
  )
    .bind(id, lim)
    .all()
    .catch(() => ({ results: [] }));

  const picked = rows?.results || [];
  if (!picked.length) return [];

  for (let i = 0; i < picked.length; i += 40) {
    const chunk = picked.slice(i, i + 40).map((r) => String(r.id || '')).filter(Boolean);
    if (!chunk.length) continue;
    const ph = chunk.map(() => '?').join(',');
    await env.DB.prepare(
      `UPDATE agentsam_code_index_job_file
          SET status = 'processing', updated_at = unixepoch()
        WHERE id IN (${ph})`,
    )
      .bind(...chunk)
      .run()
      .catch(() => null);
  }

  return picked.map(rowToFileEntry);
}

/**
 * Full manifest hydrate — diagnostics / verify / legacy recover only. Not for parse batch hops.
 * @param {any} env
 * @param {string} jobId
 * @returns {Promise<object[]>}
 */
export async function loadCodeIndexJobFiles(env, jobId) {
  const id = String(jobId || '').trim();
  if (!env?.DB || !id) return [];
  const rows = await env.DB.prepare(
    `SELECT ${FILE_ROW_SELECT}
       FROM agentsam_code_index_job_file
      WHERE index_job_id = ?
      ORDER BY COALESCE(file_ordinal, rowid) ASC`,
  )
    .bind(id)
    .all()
    .catch(() => ({ results: [] }));
  return (rows?.results || []).map(rowToFileEntry);
}

/**
 * After full-index activate prune (sibling AST nodes already wiped for keepJobId):
 * 1) Delete job_file inventory for all terminal sibling jobs (cancelled/failed/completed)
 *    — this is the ~2k-rows-per-run bloat; inventory is only needed while a job is live.
 * 2) Delete cancelled/failed job rows with zero AST refs.
 * Completed job headers stay (findActivatedCodeIndexBaseline reads revision_sha history).
 *
 * @param {any} env
 * @param {{
 *   workspaceId: string,
 *   repoFullName: string,
 *   keepJobId: string,
 * }} opts
 * @returns {Promise<{ ok: boolean, purged_jobs: number, purged_files: number, job_ids: string[], stripped_file_job_ids: string[] }>}
 */
export async function purgeOrphanedCodeIndexJobs(env, opts = {}) {
  const db = env?.DB;
  const workspaceId = String(opts.workspaceId || '').trim();
  const repo = String(opts.repoFullName || '').trim();
  const keepJobId = String(opts.keepJobId || '').trim();
  if (!db) {
    return {
      ok: false,
      purged_jobs: 0,
      purged_files: 0,
      job_ids: [],
      stripped_file_job_ids: [],
      error: 'd1_unavailable',
    };
  }
  if (!workspaceId || !repo || !keepJobId) {
    return {
      ok: false,
      purged_jobs: 0,
      purged_files: 0,
      job_ids: [],
      stripped_file_job_ids: [],
      error: 'purge_scope_required',
    };
  }

  // Terminal siblings — strip file inventory even when job header is retained (completed).
  const fileSiblingRows = await db
    .prepare(
      `SELECT id FROM agentsam_code_index_job
        WHERE workspace_id = ?
          AND repo_full_name = ?
          AND id <> ?
          AND status IN ('cancelled', 'failed', 'failed_partial', 'completed')`,
    )
    .bind(workspaceId, repo, keepJobId)
    .all()
    .catch(() => ({ results: [] }));

  const fileJobIds = (fileSiblingRows?.results || [])
    .map((r) => String(r.id || '').trim())
    .filter(Boolean);

  let purgedFiles = 0;
  for (let i = 0; i < fileJobIds.length; i += 20) {
    const chunk = fileJobIds.slice(i, i + 20);
    const ph = chunk.map(() => '?').join(',');
    const fileDel = await db
      .prepare(`DELETE FROM agentsam_code_index_job_file WHERE index_job_id IN (${ph})`)
      .bind(...chunk)
      .run()
      .catch(() => null);
    purgedFiles += Number(fileDel?.meta?.changes ?? fileDel?.changes ?? 0) || 0;
  }

  // Drop dead cancelled/failed job rows (no AST left after activate wipe).
  const orphanRows = await db
    .prepare(
      `SELECT id FROM agentsam_code_index_job
        WHERE workspace_id = ?
          AND repo_full_name = ?
          AND id <> ?
          AND status IN ('cancelled', 'failed', 'failed_partial')
          AND NOT EXISTS (
            SELECT 1 FROM codebase_ast_nodes n
             WHERE n.index_job_id = agentsam_code_index_job.id
             LIMIT 1
          )`,
    )
    .bind(workspaceId, repo, keepJobId)
    .all()
    .catch(() => ({ results: [] }));

  const jobIds = (orphanRows?.results || [])
    .map((r) => String(r.id || '').trim())
    .filter(Boolean);

  for (let i = 0; i < jobIds.length; i += 20) {
    const chunk = jobIds.slice(i, i + 20);
    const ph = chunk.map(() => '?').join(',');
    await db
      .prepare(`DELETE FROM agentsam_code_index_job WHERE id IN (${ph})`)
      .bind(...chunk)
      .run()
      .catch(() => null);
  }

  return {
    ok: true,
    purged_jobs: jobIds.length,
    purged_files: purgedFiles,
    job_ids: jobIds,
    stripped_file_job_ids: fileJobIds,
  };
}
