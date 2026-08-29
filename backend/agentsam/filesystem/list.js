/**
 * fs_list_dir — list the active Files plane (Local FSA / host PTY / R2).
 * One catalog tool_key. No workspace_list_files / list_dir / list_files aliases.
 *
 * Fail closed: R2 without explicit bucket → error + candidates (never org default).
 * Absolute host paths → caller user_hosted_tunnel (multi-checkout without workspace bounce).
 * Local FSA connected → client_fs only (no silent PTY fallthrough).
 */
import { escapeShellSingleQuoted } from './rg.js';
import { FS_SEARCH_PTY_REPO_DIR } from './rg.js';

/**
 * @param {string} relPath
 * @param {boolean} recursive
 * @param {string} [repoDir]
 */
export function buildPtyListDirCommand(relPath, recursive = false, repoDir = FS_SEARCH_PTY_REPO_DIR) {
  const raw = String(relPath || '.').trim() || '.';
  if (/\.\./.test(raw)) return null;
  if (raw.startsWith('/')) return null; // absolute → buildPtyListDirAbsoluteCommand
  const p = raw === '.' ? '.' : raw.replace(/^\.?\//, '');
  if (p !== '.' && !/^[a-zA-Z0-9_./-]+$/.test(p)) return null;
  const dir = String(repoDir || FS_SEARCH_PTY_REPO_DIR || '.').trim() || '.';
  if (dir !== '.' && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,120}$/.test(dir)) return null;
  const escapedPath = escapeShellSingleQuoted(p);
  const body = recursive
    ? `find ${escapedPath} -mindepth 1 -maxdepth 4 -print 2>/dev/null | head -n 500`
    : `ls -la ${escapedPath} 2>/dev/null | head -n 200`;
  if (dir === '.') return body;
  return `cd ${escapeShellSingleQuoted(dir)} && ${body}`;
}

/**
 * Absolute host path list on the caller's device (same safety posture as fs_read absolute).
 * @param {string} absPath
 * @param {boolean} recursive
 */
export function buildPtyListDirAbsoluteCommand(absPath, recursive = false) {
  const p = String(absPath || '').trim();
  if (!p || /\.\./.test(p) || !p.startsWith('/')) return null;
  if (!/^\/[a-zA-Z0-9_./-]+$/.test(p)) return null;
  const escapedPath = escapeShellSingleQuoted(p);
  return recursive
    ? `find ${escapedPath} -mindepth 1 -maxdepth 4 -print 2>/dev/null | head -n 500`
    : `ls -la ${escapedPath} 2>/dev/null | head -n 200`;
}

/**
 * Parse ls -la / find lines into structured entries.
 * @param {string} output
 * @param {boolean} recursive
 * @returns {{ name: string, type: string, size?: number|null, raw?: string }[]}
 */
export function parseListDirOutput(output, recursive = false) {
  const lines = String(output || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  /** @type {{ name: string, type: string, size?: number|null, raw?: string }[]} */
  const entries = [];
  for (const line of lines) {
    if (/^total\s+\d+/i.test(line)) continue;
    if (recursive && (line.startsWith('/') || !line.includes(' '))) {
      const name = line.replace(/\/$/, '');
      const base = name.split('/').pop() || name;
      entries.push({
        name: base,
        type: line.endsWith('/') ? 'dir' : 'file',
        path: name,
        size: null,
        raw: line,
      });
      continue;
    }
    // classic ls -la: permissions links owner group size month day time/year name
    const m = line.match(
      /^([dlcbps-])([rwxstST-]{9})\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\d+\s+[\d:]+\s+(.+)$/,
    );
    if (m) {
      const kind = m[1];
      const size = Number(m[3]);
      let name = m[4];
      if (name.includes(' -> ')) name = name.split(' -> ')[0];
      entries.push({
        name,
        type: kind === 'd' ? 'dir' : kind === 'l' ? 'symlink' : 'file',
        size: Number.isFinite(size) ? size : null,
        raw: line,
      });
      continue;
    }
    entries.push({ name: line, type: 'unknown', size: null, raw: line });
  }
  return entries;
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} params
 * @param {Record<string, unknown>} runContext
 */
export async function executeFsListDir(env, params, runContext = {}) {
  const { resolveFilesSource, resolveFsTransport, runClientFsOp, clientFsCallId } = await import('./transport.js');
  const filesSource = resolveFilesSource(runContext);
  if (filesSource === 'github') {
    return { success: false, error: 'wrong_tool_for_github_list', lane: 'github_tools', tool: 'fs_list_dir', hint: 'Use agentsam_github_tree with an explicit repo for GitHub contents.' };
  }
  if (filesSource === 'r2') {
    return { success: false, error: 'wrong_tool_for_r2_list', lane: 'r2_tools', tool: 'fs_list_dir', hint: 'Use the R2/storage catalog tools for object storage. fs_list_dir lists only the selected filesystem working tree.' };
  }

  const pathArg = String(params.path ?? params.directory ?? '.').trim() || '.';
  const recursive = params.recursive === true || params.recursive === 1 || params.recursive === '1';
  const isAbsolute = pathArg.startsWith('/');
  if (resolveFsTransport(runContext) === 'client_fs') {
    if (isAbsolute) return { error: 'absolute_path_not_supported_on_client_fs', lane: 'client_fs', tool: 'fs_list_dir', path: pathArg };
    const callId = clientFsCallId(runContext, 'list');
    const out = await runClientFsOp(env, runContext, {
      callId,
      operation: 'list',
      path: pathArg === '.' ? '' : pathArg,
      timeoutMs: runContext.toolBudgetMs,
      toolName: 'fs_list_dir',
    });
    if (out?.ok === false || out?.error) return { error: String(out.error || 'client_fs_list_failed'), lane: 'client_fs', tool: 'fs_list_dir', path: pathArg, root_name: out.root_name, hint: out.hint };
    return { success: true, lane: 'client_fs', tool: 'fs_list_dir', path: pathArg, root_name: out.root_name, entries: out.entries || [], recursive };
  }

  const userId = String(runContext.userId ?? runContext.user_id ?? params.user_id ?? '').trim();
  const workspaceId = String(runContext.workspaceId ?? runContext.workspace_id ?? params.workspace_id ?? '').trim();
  const tenantId = String(runContext.tenantId ?? runContext.tenant_id ?? params.tenant_id ?? '').trim();
  if (!userId || !workspaceId || !tenantId) return { error: 'user_id, tenant_id and workspace_id required', lane: 'workspace_pty_list', tool: 'fs_list_dir' };

  const command = isAbsolute ? buildPtyListDirAbsoluteCommand(pathArg, recursive) : buildPtyListDirCommand(pathArg, recursive, '.');
  if (!command) return { error: 'unsafe_or_invalid_path', lane: 'workspace_pty_list', tool: 'fs_list_dir', path: pathArg };

  const { executeAgentSessionTerminalCommand } = await import('../terminal/exec.js');
  const res = await executeAgentSessionTerminalCommand(env, command, {
    ...runContext,
    userId,
    workspaceId,
    tenantId,
  }, {
    toolName: 'fs_list_dir',
    timeoutMs: Number(runContext.toolBudgetMs) || 90000,
  });
  const output = String(res?.output || '');
  const exitCode = Number(res?.exitCode ?? res?.exit_code ?? 1);
  const entries = parseListDirOutput(output, recursive);
  return {
    success: (res?.ok && exitCode === 0) || entries.length > 0,
    ...(res?.ok || entries.length ? {} : { error: String(res?.error || 'pty_list_failed') }),
    lane: 'workspace_pty_list',
    tool: 'fs_list_dir',
    path: pathArg,
    recursive,
    entries,
    raw: output.slice(0, 16000),
    exit_code: exitCode,
    connection_id: res?.targetId || null,
  };
}
