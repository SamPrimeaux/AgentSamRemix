/**
 * Match a Local Explorer folder display name to a curated product workspace.
 * Continuity (Mac↔phone) only applies when this resolves — scratch folders stay local.
 */

export type WorkspaceMatchCandidate = {
  id: string;
  name?: string | null;
  slug?: string | null;
  github_repo?: string | null;
  root_path?: string | null;
  pty_path?: string | null;
};

function norm(s: string | null | undefined): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '');
}

/** Last path segment of a unix/mac path or ~/… path. */
export function basenamePath(path: string | null | undefined): string {
  const p = String(path ?? '').trim().replace(/\\/g, '/');
  if (!p) return '';
  const parts = p.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1]! : '';
}

/** owner/repo → repo */
export function githubRepoName(repo: string | null | undefined): string {
  const r = String(repo ?? '').trim().replace(/\.git$/i, '');
  if (!r) return '';
  const parts = r.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1]! : r;
}

/**
 * @returns matched workspace id, or null if no unique curated match
 */
export function matchLocalFolderToWorkspace(
  folderName: string,
  candidates: WorkspaceMatchCandidate[],
): { id: string; reason: string } | null {
  const folder = norm(folderName);
  if (!folder || !Array.isArray(candidates) || candidates.length === 0) return null;

  type Scored = { id: string; score: number; reason: string };
  const scored: Scored[] = [];

  for (const c of candidates) {
    const id = String(c?.id ?? '').trim();
    if (!id || !/^ws_/i.test(id)) continue;

    const rootBase = norm(basenamePath(c.root_path));
    const ptyBase = norm(basenamePath(c.pty_path));
    const ghName = norm(githubRepoName(c.github_repo));
    const slug = norm(c.slug);
    const name = norm(c.name);
    const idTail = norm(id.replace(/^ws_/i, ''));

    if (rootBase && rootBase === folder) {
      scored.push({ id, score: 100, reason: 'root_path_basename' });
      continue;
    }
    if (ptyBase && ptyBase === folder) {
      scored.push({ id, score: 95, reason: 'pty_path_basename' });
      continue;
    }
    if (ghName && ghName === folder) {
      scored.push({ id, score: 80, reason: 'github_repo_name' });
      continue;
    }
    if (slug && slug === folder) {
      scored.push({ id, score: 60, reason: 'slug' });
      continue;
    }
    if (idTail && idTail === folder) {
      scored.push({ id, score: 55, reason: 'workspace_id_tail' });
      continue;
    }
    if (name && name === folder) {
      scored.push({ id, score: 40, reason: 'name' });
    }
  }

  if (scored.length === 0) return null;

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const best = scored[0]!.score;
  const top = scored.filter((s) => s.score === best);
  if (top.length !== 1) return null; // ambiguous (e.g. twin staging) — operator must pick
  return { id: top[0]!.id, reason: top[0]!.reason };
}
