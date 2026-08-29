/** Match server parseGithubCloneRef — owner/repo from URL or clone command text. */
const GITHUB_REF_RE =
  /^(?:https?:\/\/(?:www\.)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i;

export function parseGithubCloneRef(input: string): string | null {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const stripped = raw.replace(/^clone:?\s*/i, '').trim();
  const candidate = stripped || raw;
  const m = candidate.match(GITHUB_REF_RE);
  if (!m) return null;
  const owner = String(m[1] || '').trim();
  const repo = String(m[2] || '').trim().replace(/\.git$/i, '');
  if (!owner || !repo) return null;
  return `${owner}/${repo}`;
}

export function isGithubCloneQuery(raw: string): boolean {
  return parseGithubCloneRef(raw) != null;
}
