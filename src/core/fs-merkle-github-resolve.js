/**
 * Resolve a GitHub ref to a full commit SHA (fail-loud on ambiguity).
 */

const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

/**
 * @param {{ fetchImpl?: typeof fetch, token: string, repository: string, reference: string }} input
 * @returns {Promise<string>}
 */
export async function resolveGitCommitShaForRef({
  fetchImpl = fetch,
  token,
  repository,
  reference,
}) {
  const repo = String(repository || '').trim();
  const ref = String(reference || '').trim() || 'HEAD';
  if (!token) throw new Error('github_merkle_token_required');
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new Error('github_merkle_invalid_repository');

  if (FULL_SHA.test(ref)) return ref.toLowerCase();

  const [owner, name] = repo.split('/');
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'inneranimalmedia-agent/1.0',
  };

  let commitRef = ref;
  if (ref === 'HEAD') {
    const repoRes = await fetchImpl(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
      { headers },
    );
    if (!repoRes.ok) throw new Error(`github_merkle_commit_resolve_failed:${repoRes.status}`);
    const repoPayload = await repoRes.json();
    commitRef = repoPayload?.default_branch != null ? String(repoPayload.default_branch).trim() : '';
    if (!commitRef) throw new Error(`github_default_branch_unresolved:${repo}`);
  }

  const commitRes = await fetchImpl(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(commitRef)}`,
    { headers },
  );
  if (!commitRes.ok) throw new Error(`github_merkle_commit_resolve_failed:${commitRes.status}`);
  const commitPayload = await commitRes.json();
  const commitSha = String(commitPayload?.sha || '').toLowerCase();
  if (!FULL_SHA.test(commitSha)) throw new Error('github_merkle_invalid_commit_sha');
  return commitSha;
}
