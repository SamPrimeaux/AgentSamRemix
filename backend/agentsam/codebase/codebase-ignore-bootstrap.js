/**
 * Seed agentsam_ignore_pattern for a newly connected GitHub repo by copying
 * patterns from another real repo_full_name (no template table, no JS denylist).
 */
import { normalizeGithubRepoFullName } from './project-github-repo.js';
import { normalizeIgnorePolicyRepo } from '../../../packages/shared/code-index/ignore-policy.js';

/**
 * @param {string} repo
 * @param {string} pattern
 * @param {0|1} isNegation
 */
async function patternRowId(repo, pattern, isNegation) {
  const raw = `${repo}\0${pattern}\0${isNegation}`;
  const bytes = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('');
  return `igp_${hex.slice(0, 28)}`;
}

/**
 * Idempotent: if any rows exist for target repo_full_name, skip.
 * Requires opts.copyFromRepo — a real repo that already has agentsam_ignore_pattern rows.
 *
 * @param {any} env
 * @param {{ repoFullName: string, userId: string, personUuid: string, copyFromRepo: string }} opts
 */
export async function bootstrapIgnorePolicyForRepo(env, opts) {
  const repo =
    normalizeIgnorePolicyRepo(opts?.repoFullName) ||
    normalizeGithubRepoFullName(opts?.repoFullName) ||
    '';
  const copyFrom =
    normalizeIgnorePolicyRepo(opts?.copyFromRepo) ||
    normalizeGithubRepoFullName(opts?.copyFromRepo) ||
    '';
  const userId = opts?.userId != null ? String(opts.userId).trim() : '';
  const personUuid = opts?.personUuid != null ? String(opts.personUuid).trim() : '';
  if (!env?.DB) throw new Error('db_required');
  if (!repo) throw new Error('repo_full_name_required');
  if (!copyFrom) throw new Error('copy_from_repo_required');
  if (!userId) throw new Error('user_id_required');
  if (!personUuid) throw new Error('person_uuid_required');
  if (copyFrom === repo) throw new Error('copy_from_repo_must_differ');

  const existing = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM agentsam_ignore_pattern WHERE repo_full_name = ?`,
  )
    .bind(repo)
    .first();
  const n = Number(existing?.n) || 0;
  if (n > 0) {
    return { ok: true, skipped: true, repo_full_name: repo, existing: n, inserted: 0 };
  }

  const { results: sourceRows } = await env.DB.prepare(
    `SELECT pattern, is_negation, order_index
       FROM agentsam_ignore_pattern
      WHERE repo_full_name = ?
      ORDER BY order_index ASC`,
  )
    .bind(copyFrom)
    .all();

  const rows = sourceRows || [];
  if (!rows.length) {
    throw new Error('ignore_policy_copy_source_empty');
  }

  const stmts = [];
  for (const t of rows) {
    const pattern = t?.pattern != null ? String(t.pattern).trim() : '';
    if (!pattern) continue;
    const isNeg = Number(t.is_negation) === 1 ? 1 : 0;
    const order = Number(t.order_index) || 0;
    const id = await patternRowId(repo, pattern, isNeg);
    stmts.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO agentsam_ignore_pattern
           (id, repo_full_name, user_id, person_uuid, pattern, is_negation, order_index, source,
            created_at_unix, updated_at_unix)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'bootstrap_copy', unixepoch(), unixepoch())`,
      ).bind(id, repo, userId, personUuid, pattern, isNeg, order),
    );
  }

  if (!stmts.length) throw new Error('ignore_policy_copy_source_empty');

  const CHUNK = 40;
  let inserted = 0;
  for (let i = 0; i < stmts.length; i += CHUNK) {
    const slice = stmts.slice(i, i + CHUNK);
    const r = await env.DB.batch(slice);
    for (const row of r || []) {
      inserted += Number(row?.meta?.changes) || 0;
    }
  }

  return {
    ok: true,
    skipped: false,
    repo_full_name: repo,
    copy_from_repo: copyFrom,
    existing: 0,
    inserted,
    source_rows: rows.length,
  };
}
