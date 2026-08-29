/**
 * Pure ripgrep JSON helpers (unit-testable without PTY/auth imports).
 */

export const FS_SEARCH_MAX_MATCHES = 50;
export const FS_SEARCH_MAX_OUTPUT_BYTES = 64_000;
export const FS_SEARCH_MAX_QUERY_LEN = 400;
/**
 * Relative dir for `cd` before rg/head. PTY control-plane already sets cwd to
 * workspace_root / vm_workspace_root — use "." (never a hardcoded repo basename).
 */
export const FS_SEARCH_PTY_REPO_DIR = '.';

/**
 * @param {string} value
 */
export function escapeShellSingleQuoted(value) {
  return `'${String(value || '').replace(/'/g, `'\"'\"'`)}'`;
}

/**
 * Strip single-quoted segments so shell-meta checks ignore literals inside
 * `'…'` (e.g. rg -e 'foo|bar' alternation is not a shell pipe).
 * @param {string} cmd
 */
function stripSingleQuotedSegments(cmd) {
  const s = String(cmd || '');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "'") {
      out += s[i];
      continue;
    }
    out += "''";
    i++;
    while (i < s.length && s[i] !== "'") i++;
  }
  return out;
}

/**
 * @param {string} cmd
 */
export function isSafeRgSearchCommand(cmd) {
  const c = String(cmd || '').trim();
  if (!c || c.length > 12_000) return false;
  // Shell metacharacters only matter outside quotes — buildRgSearchCommand
  // always single-quotes -e / path, so `|` in a pattern must be allowed.
  const unquoted = stripSingleQuotedSegments(c);
  if (/[\r\n;|`$<>]/.test(unquoted)) return false;
  if (/(?<![&])&(?![&])/.test(unquoted)) return false;
  // PTY cwd is already the repo — allow cd '.' / cd . or bare rg.
  if (!/^(?:cd (?:'\.'|\.) && )?rg --json\b/.test(c)) return false;
  return true;
}

/**
 * @param {string} query
 * @param {string} [pathArg]
 * @param {{ maxCount?: number }} [opts]
 */
export function buildRgSearchCommand(query, pathArg = '.', opts = {}) {
  const q = String(query || '').trim().slice(0, FS_SEARCH_MAX_QUERY_LEN);
  if (!q) return null;
  const maxCount = Math.min(50, Math.max(1, Number(opts.maxCount) || FS_SEARCH_MAX_MATCHES));
  const sub = String(pathArg || '.').trim() || '.';
  if (sub.includes('..') || /^[\/~]/.test(sub)) return null;
  const dir = String(FS_SEARCH_PTY_REPO_DIR || '.').trim() || '.';
  if (dir !== '.' && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,120}$/.test(dir)) return null;
  const rg =
    `rg --json --max-count ${maxCount} --max-columns 200 --glob '!.git/*' -e ${escapeShellSingleQuoted(q)} ${escapeShellSingleQuoted(sub)}`;
  if (dir === '.') return rg;
  return `cd ${escapeShellSingleQuoted(dir)} && ${rg}`;
}

/**
 * @param {string} stdout
 */
export function parseRgJsonMatches(stdout) {
  const matches = [];
  let bytes = 0;
  for (const line of String(stdout || '').split('\n')) {
    if (!line.trim() || bytes > FS_SEARCH_MAX_OUTPUT_BYTES) break;
    bytes += line.length;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row?.type !== 'match' || !row.data?.path?.text) continue;
    const path = row.data.path.text;
    const lineNo = row.data.line_number;
    const text = (row.data.lines?.text || '').trim();
    matches.push({
      path,
      line: lineNo,
      text: text.slice(0, 500),
    });
    if (matches.length >= FS_SEARCH_MAX_MATCHES) break;
  }
  return matches;
}
