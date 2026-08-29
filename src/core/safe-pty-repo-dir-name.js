/**
 * Relative folder name to `cd` into from PTY `workspaceRoot`.
 * When workspace_root already IS the repo root, return "." — never re-cd into the
 * basename (that yields …/inneranimalmedia/inneranimalmedia and breaks Mac PTY).
 *
 * Also treats Mac vs Linux twins as the same root:
 *   /Users/…/inneranimalmedia  vs  /home/…/inneranimalmedia
 * (terminal_sessions.cwd is often the GCP path while workspace_settings.workspace_root is Mac).
 * @param {string|null|undefined} repoRoot
 * @param {string|null|undefined} workspaceRoot
 */
export function safePtyRepoDirName(repoRoot, workspaceRoot) {
  const root = String(repoRoot || '').trim().replace(/\/+$/, '');
  const ws = String(workspaceRoot || '').trim().replace(/\/+$/, '');
  if (!root) return '.';
  if (ws && root === ws) return '.';

  const rootTail = root.split(/[/\\]/).filter(Boolean).pop() || '';
  const wsTail = ws.split(/[/\\]/).filter(Boolean).pop() || '';

  // Bare basename that already matches the workspace folder name (injected repo_dir).
  if (ws && !root.includes('/') && !root.includes('\\') && root === wsTail) return '.';

  // Cross-host same-repo (Mac workspace_root vs Linux terminal/vm cwd).
  if (
    ws &&
    rootTail &&
    rootTail === wsTail &&
    root.startsWith('/') &&
    ws.startsWith('/') &&
    !root.startsWith(`${ws}/`) &&
    !ws.startsWith(`${root}/`)
  ) {
    return '.';
  }

  if (ws && root.startsWith(`${ws}/`)) {
    const rel = root.slice(ws.length + 1);
    const first = rel.split(/[/\\]/).filter(Boolean)[0];
    if (first && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,120}$/.test(first)) return first;
  }
  let name = rootTail || '.';
  if (name === '.' || name === '..') return '.';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,120}$/.test(name)) return '.';
  return name;
}
