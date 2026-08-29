function trim(value) {
  return value == null ? '' : String(value).trim();
}

function validGeneration(value) {
  const generation = trim(value);
  return generation.startsWith('cidxgen_') || generation.startsWith('legacy:');
}

export function normalizeRepoFullName(value) {
  const repo = trim(value);
  if (!repo) return '';
  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repo)) {
    throw new Error('repo_full_name_invalid');
  }
  return repo;
}

/** Resolve only active code-index generations so retrieval never mixes stale builds. */
export async function resolveActiveCodeScopes(env, { workspaceId, repoFullName = '' }) {
  const workspace = trim(workspaceId);
  const repo = normalizeRepoFullName(repoFullName);
  if (!workspace) throw new Error('workspace_id_required');
  if (!env?.DB) return { ok: false, error: 'code_index_db_unavailable', scopes: [] };

  try {
    const sql = repo
      ? `SELECT id, repo_full_name, index_generation_id, revision_sha
           FROM agentsam_code_index_job
          WHERE workspace_id = ? AND repo_full_name = ? AND is_active = 1
          LIMIT 1`
      : `SELECT id, repo_full_name, index_generation_id, revision_sha
           FROM agentsam_code_index_job
          WHERE workspace_id = ? AND is_active = 1
          ORDER BY activated_at DESC, updated_at DESC
          LIMIT 12`;
    const stmt = env.DB.prepare(sql);
    const result = repo ? await stmt.bind(workspace, repo).all() : await stmt.bind(workspace).all();
    const scopes = (result?.results || [])
      .filter((row) => row?.repo_full_name && validGeneration(row?.index_generation_id))
      .map((row) => ({
        jobId: trim(row.id),
        repoFullName: trim(row.repo_full_name),
        generationId: trim(row.index_generation_id),
        revisionSha: /^[a-f0-9]{40}$/i.test(trim(row.revision_sha)) ? trim(row.revision_sha).toLowerCase() : null,
      }));
    if (!scopes.length) {
      return { ok: false, error: repo ? 'active_code_index_generation_missing' : 'active_code_indexes_missing', scopes: [] };
    }
    return { ok: true, scopes };
  } catch (error) {
    return { ok: false, error: `code_index_scope_failed:${String(error?.message || error).slice(0, 160)}`, scopes: [] };
  }
}

export function buildActiveScopeSql(scopes, params) {
  const list = Array.isArray(scopes) ? scopes.slice(0, 12) : [];
  if (!list.length) return '0 = 1';
  return list.map((scope) => {
    params.push(scope.repoFullName, scope.generationId);
    return '(repo_full_name = ? AND index_generation_id = ?)';
  }).join(' OR ');
}
