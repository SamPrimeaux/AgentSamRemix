/**
 * Normalize git repo/branch hints from agentsam_workspace.metadata_json (object or string shapes).
 */

function trim(v) {
  if (v == null) return '';
  return String(v).trim();
}

function githubRemoteToFullName(remote) {
  const r = trim(remote);
  if (!r) return '';
  const ssh = r.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/i);
  if (ssh?.[1]) return ssh[1];
  const https = r.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/i);
  if (https?.[1]) return https[1];
  return '';
}

/**
 * @param {unknown} metaRaw parsed metadata_json
 * @returns {{ branch: string|null, repo_full_name: string|null, git_hash: string|null }}
 */
export function gitStatusFromWorkspaceMetadata(metaRaw) {
  const meta = metaRaw && typeof metaRaw === 'object' && !Array.isArray(metaRaw) ? metaRaw : {};

  let repoFullName = trim(meta.repo_full_name);
  if (!repoFullName) {
    const repo = meta.repo;
    if (typeof repo === 'string') {
      repoFullName = githubRemoteToFullName(repo) || trim(repo);
    } else if (repo && typeof repo === 'object') {
      repoFullName =
        githubRemoteToFullName(repo.remote) ||
        trim(repo.full_name) ||
        trim(repo.repo_full_name) ||
        '';
    }
  }
  if (!repoFullName && meta.github && typeof meta.github === 'object') {
    const remotes = meta.github.remotes;
    if (remotes && typeof remotes === 'object') {
      const firstKey = Object.keys(remotes)[0];
      if (firstKey && firstKey.includes('/')) repoFullName = firstKey;
    }
  }
  if (!repoFullName) {
    const label = trim(meta.label);
    if (label.includes('/')) repoFullName = label;
  }

  const repoObj = meta.repo && typeof meta.repo === 'object' ? meta.repo : null;
  const branch =
    trim(meta.branch) ||
    trim(repoObj?.branch) ||
    null;

  const gitHash =
    trim(meta.last_commit) ||
    trim(meta.git_hash) ||
    trim(repoObj?.last_commit) ||
    null;

  return {
    branch: branch || null,
    repo_full_name: repoFullName || null,
    git_hash: gitHash || null,
  };
}
