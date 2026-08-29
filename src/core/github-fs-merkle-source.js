const FULL_GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

function fail(code, detail = '') {
  throw new Error(detail ? `${code}:${detail}` : code);
}

function normalizeRepository(repository) {
  if (typeof repository !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(repository.trim())) {
    fail('github_merkle_invalid_repository', String(repository));
  }
  return repository.trim();
}

function normalizeReference(reference) {
  if (typeof reference !== 'string' || !reference.trim()) fail('github_merkle_reference_required');
  return reference.trim();
}

function normalizeObjectId(value, label) {
  const objectId = typeof value === 'string' ? value.toLowerCase() : '';
  if (!FULL_GIT_OBJECT_ID.test(objectId)) fail('github_merkle_invalid_object_id', label);
  return objectId;
}

/**
 * Converts a complete GitHub recursive Git Trees response into trusted V1 leaf
 * inputs. Truncated trees and submodules fail loud instead of producing a
 * plausible but incomplete root.
 */
export function githubTreePayloadToMerkleSource({ repository, reference, payload }) {
  const repo = normalizeRepository(repository);
  const ref = normalizeReference(reference);
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.tree)) {
    fail('github_merkle_invalid_tree_payload');
  }
  if (payload.truncated === true) fail('github_merkle_tree_truncated', `${repo}@${ref}`);

  const entries = [];
  for (const item of payload.tree) {
    if (!item || typeof item.path !== 'string' || !item.path) {
      fail('github_merkle_invalid_tree_entry');
    }
    if (item.type === 'tree') continue;
    if (item.type === 'commit') fail('github_merkle_submodule_unsupported', item.path);
    if (item.type !== 'blob') fail('github_merkle_unsupported_tree_entry', `${item.type}:${item.path}`);
    entries.push({
      kind: 'file',
      path: item.path,
      trustedGitBlobSha: normalizeObjectId(item.sha, item.path),
    });
  }

  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return {
    source: 'github',
    repository: repo,
    reference: ref,
    resolvedGitTreeSha: normalizeObjectId(payload.sha, `${repo}@${ref}`),
    entries,
  };
}

/** Fetches one GitHub ref using the Git Trees API and enforces completeness. */
export async function fetchGithubMerkleSource({ fetchImpl = fetch, token, repository, reference }) {
  const repo = normalizeRepository(repository);
  const ref = normalizeReference(reference);
  if (typeof token !== 'string' || !token) fail('github_merkle_token_required');
  const response = await fetchImpl(
    `https://api.github.com/repos/${repo.split('/').map(encodeURIComponent).join('/')}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'inneranimalmedia-agent/1.0',
      },
    },
  );
  if (!response.ok) fail('github_merkle_fetch_failed', String(response.status));
  const payload = await response.json();
  return githubTreePayloadToMerkleSource({ repository: repo, reference: ref, payload });
}
