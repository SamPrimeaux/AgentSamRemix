/**
 * Code indexer — GitHub token, tree/compare snapshots, file fetch, purged-manifest recover.
 */
import {
  getAdminGithubToken,
  getUserGithubToken,
  resolveGitHubAppInstallationToken,
} from '../../../src/integrations/github.js';
import {
  FULL_INDEX_PIPELINE,
  INCREMENTAL_INDEX_MODE,
  buildCompareDeltaFromGithubFiles,
  classifyRepoTree,
  normalizeCodeIndexMode,
  normalizeFullGitSha,
} from './codebase-full-index.js';
import { loadRepoIgnorePolicy } from '../../../packages/shared/code-index/ignore-policy.js';
import { nowUnix } from './code-indexer-shared.js';

export async function resolveGithubTokenForJob(env, job) {
  let repoFullName =
    (job.repo_full_name != null ? String(job.repo_full_name).trim() : '') ||
    (job.source_path != null ? String(job.source_path).trim() : '') ||
    '';

  // Never default to platform repo for a customer workspace job.
  if (!repoFullName && env?.DB && job.workspace_id) {
    const ws = String(job.workspace_id).trim();
    const aw = await env.DB.prepare(
      `SELECT github_repo FROM agentsam_workspace WHERE id = ? AND status = 'active' LIMIT 1`,
    )
      .bind(ws)
      .first()
      .catch(() => null);
    if (aw?.github_repo) repoFullName = String(aw.github_repo).trim();
    if (!repoFullName) {
      const w = await env.DB.prepare(`SELECT github_repo FROM workspaces WHERE id = ? LIMIT 1`)
        .bind(ws)
        .first()
        .catch(() => null);
      if (w?.github_repo) repoFullName = String(w.github_repo).trim();
    }
  }

  if (!repoFullName) {
    throw new Error('repo_full_name_required');
  }

  // Fail loud — never invent a personal GitHub owner when repoFullName is bare.
  if (!repoFullName.includes('/')) {
    throw new Error('repo_full_name_required');
  }
  const owner = String(repoFullName.split('/')[0] || '').trim();
  if (!owner) {
    throw new Error('repo_full_name_required');
  }

  try {
    const app = await resolveGitHubAppInstallationToken(env, owner);
    if (app?.token) return { token: app.token, repoFullName, mode: 'app' };
  } catch {
    /* fallback */
  }

  const userId = job.user_id != null ? String(job.user_id).trim() : '';
  if (userId) {
    const row = await getUserGithubToken(env, userId);
    if (row?.token) return { token: row.token, repoFullName, mode: 'oauth' };
  }

  const pat = getAdminGithubToken(env);
  if (pat?.token) return { token: pat.token, repoFullName, mode: pat.mode || 'pat' };

  throw new Error('github_token_unavailable');
}

/**
 * 40-char HEAD SHA for refs/heads/<branch>. Fail loud — never a short SHA.
 * @param {string} token
 * @param {string} repoFullName
 * @param {string|null} [branch]
 * @returns {Promise<{ branch: string, sha: string }>}
 */
export async function resolveGithubHeadSha(token, repoFullName, branch = null) {
  const resolvedBranch =
    branch != null && String(branch).trim()
      ? String(branch).trim()
      : await resolveGithubDefaultBranch(token, repoFullName);
  const refRes = await fetch(
    `https://api.github.com/repos/${repoFullName}/git/refs/heads/${encodeURIComponent(resolvedBranch)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'IAM-CodeIndexer',
      },
    },
  );
  if (!refRes.ok) throw new Error(`github_ref_failed:${refRes.status}`);
  const refJson = await refRes.json();
  const sha = normalizeFullGitSha(refJson?.object?.sha);
  if (!sha) throw new Error('github_ref_sha_missing');
  return { branch: resolvedBranch, sha };
}

export async function resolveGithubDefaultBranch(token, repoFullName) {
  const res = await fetch(`https://api.github.com/repos/${repoFullName}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'IAM-CodeIndexer',
    },
  });
  if (!res.ok) throw new Error(`github_repo_meta_failed:${res.status}`);
  const json = await res.json().catch(() => ({}));
  const branch = json?.default_branch != null ? String(json.default_branch).trim() : '';
  if (!branch) throw new Error('github_default_branch_unresolved');
  return branch;
}

export async function loadRepoSnapshot(token, repoFullName, branch = null, classifyOpts = {}) {
  const { branch: resolvedBranch, sha: revisionSha } = await resolveGithubHeadSha(
    token,
    repoFullName,
    branch,
  );

  const treeRes = await fetch(
    `https://api.github.com/repos/${repoFullName}/git/trees/${revisionSha}?recursive=1`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'IAM-CodeIndexer',
      },
    },
  );
  if (!treeRes.ok) throw new Error(`github_tree_failed:${treeRes.status}`);
  const treeJson = await treeRes.json();
  if (treeJson?.truncated) throw new Error('github_tree_truncated_fail_loud');
  const classified = classifyRepoTree(
    Array.isArray(treeJson?.tree) ? treeJson.tree : [],
    classifyOpts,
  );
  return {
    discovery: 'tree',
    revision_sha: revisionSha,
    head_sha: revisionSha,
    base_sha: revisionSha,
    branch: resolvedBranch,
    removed_paths: [],
    changed_count: classified.files.length,
    ...classified,
  };
}

export async function loadRepoCompareSnapshot(token, repoFullName, baseSha, branch = null, classifyOpts = {}) {
  const base = String(baseSha || '')
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(base)) {
    throw new Error('incremental_base_sha_invalid');
  }
  const { branch: resolvedBranch, sha: head } = await resolveGithubHeadSha(
    token,
    repoFullName,
    branch,
  );
  if (head === base) {
    return {
      discovery: 'compare',
      revision_sha: head,
      head_sha: head,
      base_sha: base,
      branch: resolvedBranch,
      files: [],
      removed_paths: [],
      changed_count: 0,
      totals: {
        authorized_blobs: 0,
        structural_and_chunks: 0,
        chunks_only: 0,
        metadata_only: 0,
        ignored: 0,
      },
      languages: {},
      compare_status: 'identical',
    };
  }

  const compareUrl = `https://api.github.com/repos/${repoFullName}/compare/${base}...${head}`;
  const compareRes = await fetch(compareUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'IAM-CodeIndexer',
    },
  });
  if (!compareRes.ok) {
    throw new Error(`github_compare_failed:${compareRes.status}`);
  }
  const compareJson = await compareRes.json().catch(() => null);
  if (!compareJson || typeof compareJson !== 'object') {
    throw new Error('github_compare_invalid_body');
  }
  // GitHub truncates file lists above ~300 entries — never silently treat as complete.
  if (compareJson.truncated === true) {
    throw new Error('github_compare_truncated_fail_loud');
  }
  const delta = buildCompareDeltaFromGithubFiles(
    Array.isArray(compareJson.files) ? compareJson.files : [],
    classifyOpts,
  );
  return {
    discovery: 'compare',
    revision_sha: head,
    head_sha: head,
    base_sha: base,
    branch: resolvedBranch,
    files: delta.files,
    removed_paths: delta.removed_paths,
    changed_count: delta.changed_count,
    totals: delta.totals,
    languages: delta.languages,
    compare_status: compareJson.status != null ? String(compareJson.status) : null,
    compare_total_commits: Number(compareJson.total_commits) || 0,
    compare_ahead_by: Number(compareJson.ahead_by) || 0,
    compare_behind_by: Number(compareJson.behind_by) || 0,
  };
}

export async function listRepoFiles(token, repoFullName, branch = 'main') {
  const snapshot = await loadRepoSnapshot(token, repoFullName, branch);
  return snapshot.files
    .filter((file) => file.classification === 'structural_and_chunks' || file.classification === 'chunks_only')
    .map((file) => file.path);
}

export async function fetchRepoFile(token, repoFullName, path, branch = 'main') {
  const meta = await fetchRepoFileMeta(token, repoFullName, path, branch);
  return meta.content;
}

/**
 * GitHub Contents API — content + blob sha (for single-file smoke / targeted upsert).
 * @returns {Promise<{ content: string, sha: string|null, size: number, path: string }>}
 */
export async function fetchRepoFileMeta(token, repoFullName, path, branch = 'main') {
  const enc = path
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  const qs = branch ? `?ref=${encodeURIComponent(branch)}` : '';
  const res = await fetch(`https://api.github.com/repos/${repoFullName}/contents/${enc}${qs}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'IAM-CodeIndexer',
    },
  });
  if (!res.ok) {
    throw new Error(`github_file_failed:${res.status}:${path}`);
  }
  const data = await res.json();
  let content = '';
  if (typeof data?.content === 'string' && data.encoding === 'base64') {
    const bin = atob(data.content.replace(/\n/g, ''));
    content = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }
  return {
    content,
    sha: data?.sha != null ? String(data.sha) : null,
    size: Number(data?.size) || content.length || 0,
    path: data?.path != null ? String(data.path) : String(path),
  };
}

export async function loadRepoSnapshotAtSha(token, repoFullName, revisionSha, branch = null, classifyOpts = {}) {
  const sha = String(revisionSha || '')
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('recover_revision_sha_invalid');
  const treeRes = await fetch(`https://api.github.com/repos/${repoFullName}/git/trees/${sha}?recursive=1`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'IAM-CodeIndexer',
    },
  });
  if (!treeRes.ok) throw new Error(`github_tree_failed:${treeRes.status}`);
  const treeJson = await treeRes.json();
  if (treeJson?.truncated) throw new Error('github_tree_truncated_fail_loud');
  const classified = classifyRepoTree(
    Array.isArray(treeJson?.tree) ? treeJson.tree : [],
    classifyOpts,
  );
  const resolvedBranch =
    branch != null && String(branch).trim()
      ? String(branch).trim()
      : await resolveGithubDefaultBranch(token, repoFullName).catch(() => null);
  return {
    discovery: 'tree',
    revision_sha: sha,
    head_sha: sha,
    base_sha: sha,
    branch: resolvedBranch,
    removed_paths: [],
    changed_count: classified.files.length,
    ...classified,
  };
}

export async function recoverPurgedFileManifest(env, job, gh, manifest, jobMode) {
  let rev =
    manifest?.revision_sha && /^[a-f0-9]{40}$/i.test(String(manifest.revision_sha))
      ? String(manifest.revision_sha).toLowerCase()
      : null;
  if (!rev && env?.DB) {
    const row = await env.DB.prepare(
      `SELECT revision_sha FROM codebase_ast_nodes
        WHERE index_job_id = ? AND revision_sha IS NOT NULL AND length(revision_sha) = 40
        LIMIT 1`,
    )
      .bind(job.id)
      .first()
      .catch(() => null);
    if (row?.revision_sha) rev = String(row.revision_sha).toLowerCase();
  }
  if (!rev) throw new Error('manifest_purged_revision_unrecoverable');

  const repoPolicy = await loadRepoIgnorePolicy(
    env?.DB,
    job?.repo_full_name != null ? String(job.repo_full_name) : '',
  );
  const snapshot = await loadRepoSnapshotAtSha(gh.token, gh.repoFullName, rev, manifest?.branch || null, {
    repoPolicy,
  });
  const processable = (snapshot.files || []).filter(
    (file) =>
      file.classification === 'structural_and_chunks' || file.classification === 'chunks_only',
  );
  if (!processable.length) throw new Error('manifest_recover_no_indexable_files');

  // Stamp paths already banked on this job so skip-unchanged / status are honest.
  const done = await env.DB.prepare(
    `SELECT DISTINCT file_path, git_blob_sha FROM codebase_ast_nodes WHERE index_job_id = ?`,
  )
    .bind(job.id)
    .all()
    .catch(() => ({ results: [] }));
  const byPath = new Map(
    (done?.results || []).map((r) => [String(r.file_path || ''), r.git_blob_sha || null]),
  );
  for (const f of processable) {
    const path = f?.path != null ? String(f.path) : '';
    if (!path || !byPath.has(path)) continue;
    f.status = 'indexed';
    if (byPath.get(path)) f.git_blob_sha = byPath.get(path);
    delete f.revision_sha;
  }

  return {
    run_id: job.id,
    pipeline: FULL_INDEX_PIPELINE,
    mode: jobMode,
    repo_full_name: gh.repoFullName,
    // Legacy manifest key — same GitHub owner/name, not a local path.
    repo: gh.repoFullName,
    branch: snapshot.branch || manifest?.branch || null,
    revision_sha: rev,
    head_sha: rev,
    base_sha: manifest?.base_sha || null,
    baseline_job_id: manifest?.baseline_job_id || null,
    discovery: snapshot.discovery || 'tree',
    classification_complete: true,
    totals: snapshot.totals,
    languages: snapshot.languages,
    files: processable,
    removed_paths: Array.isArray(manifest?.removed_paths) ? manifest.removed_paths : [],
    changed_count:
      manifest?.changed_count != null ? Number(manifest.changed_count) : processable.length,
    excluded_sample: [],
    recovered_from_purge: true,
    recovered_at: nowUnix(),
  };
}

