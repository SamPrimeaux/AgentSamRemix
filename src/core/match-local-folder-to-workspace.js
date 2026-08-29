/**
 * Match Local Explorer folder / path to a curated product workspace (Worker + dashboard).
 * Scratch folders must not match — return null.
 */

function norm(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '');
}

export function basenamePath(path) {
  const p = String(path ?? '')
    .trim()
    .replace(/\\/g, '/');
  if (!p) return '';
  const parts = p.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

export function githubRepoName(repo) {
  const r = String(repo ?? '')
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '');
  if (!r) return '';
  const parts = r.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : r;
}

/**
 * @param {string} folderName
 * @param {Array<{id:string,name?:string|null,slug?:string|null,github_repo?:string|null,root_path?:string|null,pty_path?:string|null}>} candidates
 * @returns {{id:string,reason:string}|null}
 */
export function matchLocalFolderToWorkspace(folderName, candidates) {
  const folder = norm(folderName);
  if (!folder || !Array.isArray(candidates) || candidates.length === 0) return null;

  /** @type {Array<{id:string,score:number,reason:string}>} */
  const scored = [];

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
  const best = scored[0].score;
  const top = scored.filter((s) => s.score === best);
  if (top.length !== 1) return null;
  return { id: top[0].id, reason: top[0].reason };
}
