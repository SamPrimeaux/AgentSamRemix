/**
 * Code-index generation identity (P1) — no separate generations table.
 * Job row carries cidxgen_* + is_active pointer per workspace+repo.
 */
import { CODE_INDEX_CHUNKS_TABLE, CODE_INDEX_SYMBOL_TABLE } from './code-index-vector-backend-receipt.js';

export const CODE_INDEX_GENERATION_PREFIX = 'cidxgen_';
export const CODE_INDEX_LEGACY_GENERATION_PREFIX = 'legacy:';

/** @param {string} [uuidLike] */
export function allocCodeIndexGenerationId(uuidLike) {
  const raw =
    uuidLike != null && String(uuidLike).trim()
      ? String(uuidLike).replace(/-/g, '').toLowerCase()
      : typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, '')
        : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const hex = raw.replace(/[^a-f0-9]/gi, '').slice(0, 32) || Date.now().toString(16);
  return `${CODE_INDEX_GENERATION_PREFIX}${hex}`;
}

/**
 * @param {unknown} raw
 * @returns {string|null}
 */
export function normalizeCodeIndexGenerationId(raw) {
  const g = raw != null ? String(raw).trim() : '';
  if (!g) return null;
  if (g.startsWith(CODE_INDEX_GENERATION_PREFIX) || g.startsWith(CODE_INDEX_LEGACY_GENERATION_PREFIX)) {
    return g;
  }
  return null;
}

/**
 * Resolve generation stamped on a job row (or legacy receipt).
 * New builds must set index_generation_id at create; legacy rows use legacy:<job.id>.
 * @param {{ id?: string, index_generation_id?: string|null }|null|undefined} job
 * @returns {string}
 */
export function resolveJobIndexGenerationId(job) {
  const fromCol = normalizeCodeIndexGenerationId(job?.index_generation_id);
  if (fromCol) return fromCol;
  const jobId = job?.id != null ? String(job.id).trim() : '';
  if (!jobId) throw new Error('index_generation_id_required');
  return `${CODE_INDEX_LEGACY_GENERATION_PREFIX}${jobId}`;
}

/**
 * Resolve LIVE generation for retrieve — call once per request.
 * Prefer `repo_full_name`; `repoFullName` / `repo` are legacy aliases.
 * @param {any} env
 * @param {{ workspaceId: string, repo_full_name?: string, repoFullName?: string, repo?: string }} opts
 * @returns {Promise<{ ok: true, generationId: string, revisionSha: string|null, jobId: string } | { ok: false, error: string }>}
 */
export async function resolveActiveCodeIndexGeneration(env, opts) {
  const workspaceId = String(opts?.workspaceId || '').trim();
  const repoFullName = String(
    opts?.repo_full_name || opts?.repoFullName || opts?.repo || '',
  ).trim();
  if (!workspaceId) return { ok: false, error: 'workspace_id_required' };
  if (!repoFullName) return { ok: false, error: 'repo_full_name_required' };
  if (!env?.DB) return { ok: false, error: 'no_db' };

  const row = await env.DB.prepare(
    `SELECT id, index_generation_id, revision_sha
       FROM agentsam_code_index_job
      WHERE workspace_id = ?
        AND repo_full_name = ?
        AND is_active = 1
      LIMIT 1`,
  )
    .bind(workspaceId, repoFullName)
    .first()
    .catch(() => null);

  const generationId = normalizeCodeIndexGenerationId(row?.index_generation_id);
  if (!row?.id || !generationId) {
    return { ok: false, error: 'active_code_index_generation_missing' };
  }
  const revisionSha =
    row.revision_sha != null && /^[a-f0-9]{40}$/i.test(String(row.revision_sha).trim())
      ? String(row.revision_sha).trim().toLowerCase()
      : null;
  return {
    ok: true,
    generationId,
    revisionSha,
    jobId: String(row.id),
  };
}

/**
 * Atomic ACTIVE pointer flip (last write of a green Build).
 * Prefer `repo_full_name`; `repoFullName` is a legacy alias.
 * @param {any} env
 * @param {{
 *   workspaceId: string,
 *   repo_full_name?: string,
 *   repoFullName?: string,
 *   jobId: string,
 *   generationId: string,
 *   nowUnix?: number,
 * }} opts
 */
export async function activateCodeIndexGeneration(env, opts) {
  const workspaceId = String(opts?.workspaceId || '').trim();
  const repoFullName = String(opts?.repo_full_name || opts?.repoFullName || '').trim();
  const jobId = String(opts?.jobId || '').trim();
  const generationId = normalizeCodeIndexGenerationId(opts?.generationId);
  const now = Number.isFinite(Number(opts?.nowUnix))
    ? Math.floor(Number(opts.nowUnix))
    : Math.floor(Date.now() / 1000);
  if (!workspaceId || !repoFullName || !jobId || !generationId) {
    throw new Error('activate_code_index_generation_args_required');
  }
  if (!env?.DB) throw new Error('no_db');

  const clear = await env.DB.prepare(
    `UPDATE agentsam_code_index_job
        SET is_active = 0
      WHERE workspace_id = ?
        AND repo_full_name = ?
        AND is_active = 1`,
  )
    .bind(workspaceId, repoFullName)
    .run();

  const set = await env.DB.prepare(
    `UPDATE agentsam_code_index_job
        SET is_active = 1,
            activated_at = ?,
            status = 'completed',
            updated_at = ?
      WHERE id = ?
        AND workspace_id = ?
        AND repo_full_name = ?
        AND index_generation_id = ?`,
  )
    .bind(now, now, jobId, workspaceId, repoFullName, generationId)
    .run();

  if (!set?.meta?.changes) {
    throw new Error('activate_code_index_generation_job_mismatch');
  }

  const check = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM agentsam_code_index_job
      WHERE workspace_id = ? AND repo_full_name = ? AND is_active = 1`,
  )
    .bind(workspaceId, repoFullName)
    .first();
  if (Number(check?.c) !== 1) {
    throw new Error(`activate_code_index_generation_invariant:active_count=${check?.c}`);
  }

  return {
    ok: true,
    cleared: Number(clear?.meta?.changes) || 0,
    job_id: jobId,
    index_generation_id: generationId,
    activated_at: now,
  };
}

/**
 * Rollback LIVE pointer to a prior generation (ops / proof).
 * Prefer `repo_full_name`; `repoFullName` is a legacy alias.
 * @param {any} env
 * @param {{
 *   workspaceId: string,
 *   repo_full_name?: string,
 *   repoFullName?: string,
 *   generationId: string,
 *   nowUnix?: number,
 * }} opts
 */
export async function rollbackActiveCodeIndexGeneration(env, opts) {
  const workspaceId = String(opts?.workspaceId || '').trim();
  const repoFullName = String(opts?.repo_full_name || opts?.repoFullName || '').trim();
  const generationId = normalizeCodeIndexGenerationId(opts?.generationId);
  const now = Number.isFinite(Number(opts?.nowUnix))
    ? Math.floor(Number(opts.nowUnix))
    : Math.floor(Date.now() / 1000);
  if (!workspaceId || !repoFullName || !generationId) {
    throw new Error('rollback_code_index_generation_args_required');
  }

  const target = await env.DB.prepare(
    `SELECT id FROM agentsam_code_index_job
      WHERE workspace_id = ? AND repo_full_name = ? AND index_generation_id = ?
      ORDER BY rowid DESC LIMIT 1`,
  )
    .bind(workspaceId, repoFullName, generationId)
    .first();
  if (!target?.id) throw new Error('rollback_target_generation_missing');

  return activateCodeIndexGeneration(env, {
    workspaceId,
    repo_full_name: repoFullName,
    jobId: String(target.id),
    generationId,
    nowUnix: now,
  });
}

export { CODE_INDEX_CHUNKS_TABLE, CODE_INDEX_SYMBOL_TABLE };
