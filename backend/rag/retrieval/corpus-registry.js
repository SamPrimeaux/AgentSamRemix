import { normalizeRepoFullName } from './code-index-scope.js';

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function corpusFromRow(row) {
  return {
    jobId: trim(row?.id),
    repoFullName: trim(row?.repo_full_name),
    workspaceId: trim(row?.workspace_id),
    generationId: trim(row?.index_generation_id),
    revisionSha: trim(row?.revision_sha) || null,
    status: trim(row?.status) || null,
  };
}

/**
 * Resolve a logical repository selector to its active physical index partition.
 * workspaceId is deliberately returned only as an internal retrieval detail.
 */
export async function resolveActiveCorpusForRepo(env, repoFullName) {
  const repo = normalizeRepoFullName(repoFullName);
  if (!repo) return { ok: false, error: 'repo_full_name_required', status: 400 };
  if (!env?.DB) return { ok: false, error: 'corpus_registry_unavailable', status: 503 };

  const result = await env.DB.prepare(
    `SELECT id, workspace_id, repo_full_name, index_generation_id, revision_sha, status
       FROM agentsam_code_index_job
      WHERE repo_full_name = ? AND is_active = 1
      ORDER BY activated_at DESC, updated_at DESC`,
  ).bind(repo).all();
  const corpora = (result?.results || [])
    .map(corpusFromRow)
    .filter((row) => row.workspaceId && row.generationId);

  if (corpora.length === 1) return { ok: true, corpus: corpora[0] };
  if (corpora.length > 1) {
    return {
      ok: false,
      error: 'active_corpus_ambiguous',
      status: 409,
      repoFullName: repo,
      activeGenerations: corpora.map((row) => ({
        generationId: row.generationId,
        revisionSha: row.revisionSha,
      })),
    };
  }

  const latest = await env.DB.prepare(
    `SELECT id, workspace_id, repo_full_name, index_generation_id, revision_sha,
            status, last_error, updated_at
       FROM agentsam_code_index_job
      WHERE repo_full_name = ?
      ORDER BY updated_at DESC
      LIMIT 1`,
  ).bind(repo).first();
  return {
    ok: false,
    error: 'active_code_index_generation_missing',
    status: 409,
    repoFullName: repo,
    latest: latest
      ? {
          ...corpusFromRow(latest),
          lastError: trim(latest.last_error) || null,
          updatedAt: Number(latest.updated_at) || null,
        }
      : null,
  };
}

/** Server-side enumeration for platform evaluation; callers never supply workspaces. */
export async function listActiveCorpora(env) {
  if (!env?.DB) return { ok: false, error: 'corpus_registry_unavailable', status: 503, corpora: [] };
  const result = await env.DB.prepare(
    `SELECT id, workspace_id, repo_full_name, index_generation_id, revision_sha, status
       FROM agentsam_code_index_job
      WHERE is_active = 1
        AND repo_full_name IS NOT NULL
        AND trim(repo_full_name) <> ''
      ORDER BY repo_full_name ASC, activated_at DESC, updated_at DESC
      LIMIT 10000`,
  ).all();
  const seen = new Set();
  const corpora = [];
  for (const row of result?.results || []) {
    const corpus = corpusFromRow(row);
    if (!corpus.repoFullName || !corpus.workspaceId || !corpus.generationId) continue;
    if (seen.has(corpus.repoFullName)) continue;
    seen.add(corpus.repoFullName);
    corpora.push(corpus);
  }
  return corpora.length
    ? { ok: true, corpora }
    : { ok: false, error: 'active_code_indexes_missing', status: 409, corpora: [] };
}
