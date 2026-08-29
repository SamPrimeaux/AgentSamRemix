/**
 * fs_read_file spine — dashboard buffer, client FSA, or selected terminal working tree.
 * GitHub-bound inputs are rejected with explicit agentsam_github_read guidance; this
 * module never fetches committed GitHub content itself.
 *
 * Read posture (aligned with agentsam_github_read):
 * - Default page 32KB; soft ceiling 64KB requires force; hard max 512KB.
 * - Prefer line_start/line_end (+ margin) from agentsam_codebase_retrieve.
 * - Paginate with byte_offset / next_byte_offset — not silent full-file dumps.
 */
import { escapeShellSingleQuoted } from './rg.js';
import { FS_SEARCH_PTY_REPO_DIR } from './rg.js';
import {
  FS_READ_DEFAULT_MAX_BYTES,
  FS_READ_HARD_MAX_BYTES,
  FS_READ_SOFT_CEILING_BYTES,
  applyFsReadWindow,
  resolveFsReadWindow,
} from './read-window.js';

export {
  FS_READ_DEFAULT_MAX_BYTES,
  FS_READ_HARD_MAX_BYTES,
  FS_READ_SOFT_CEILING_BYTES,
  applyFsReadWindow,
  resolveFsReadWindow,
} from './read-window.js';

/** @deprecated Prefer FS_READ_DEFAULT_MAX_BYTES; kept as default page size for callers. */
export const FS_READ_MAX_BYTES = FS_READ_DEFAULT_MAX_BYTES;

/**
 * Detect an explicit GitHub-bound read so fs_read_file can reject the wrong tool.
 * @param {Record<string, unknown>} [params]
 * @param {Record<string, unknown>} [runContext]
 */
export function isExplicitGithubFsReadTarget(params = {}, runContext = {}) {
  // Files rail local / fsa_root: never treat prefer_github or a stale github envelope as SSOT.
  const filesSource = String(
    runContext.files_source ||
      runContext.filesSource ||
      runContext.runtimeProfile?._files_source ||
      '',
  )
    .trim()
    .toLowerCase();
  if (
    runContext.fsa_root === true ||
    runContext._fsa_root === true ||
    runContext.runtimeProfile?._fsa_root === true ||
    filesSource === 'local'
  ) {
    return false;
  }
  if (
    params.prefer_github === true ||
    String(params.fs_source || '').trim() === 'github_api_committed' ||
    String(runContext.prefer_github || '').trim() === '1'
  ) {
    return true;
  }
  const envelope =
    runContext.activeFileEnvelope ??
    runContext.active_file_envelope ??
    runContext.resolvedContext?.active_file_envelope ??
    null;
  if (envelope && typeof envelope === 'object') {
    const src = String(envelope.source || '').toLowerCase();
    if (src === 'github') return true;
    if (envelope.github_repo && envelope.github_path) return true;
  }
  return String(params.github_repo || params.githubRepo || params.repo || '')
    .trim()
    .includes('/');
}

/**
 * @param {string} relPath
 * @param {string} [repoDir]
 * @param {{ maxBytes?: number, byteOffset?: number, lineStart?: number|null, lineEnd?: number|null, lineMargin?: number }} [opts]
 */
export function buildPtyReadFileCommand(relPath, repoDir = FS_SEARCH_PTY_REPO_DIR, opts = {}) {
  const raw = String(relPath || '').trim();
  if (!raw || /\.\./.test(raw) || /^[~\/]/.test(raw)) return null;
  const p = raw.replace(/^\.?\//, '');
  if (!p || p.split('/').some((seg) => seg === '..' || seg === '.')) return null;
  if (!/^[a-zA-Z0-9_./-]+$/.test(p)) return null;
  const dir = String(repoDir || FS_SEARCH_PTY_REPO_DIR || '.').trim() || '.';
  // "." = PTY cwd is already the repo (control-plane sets workspace/vm root).
  if (dir !== '.' && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,120}$/.test(dir)) return null;
  const escapedPath = escapeShellSingleQuoted(p);
  const inner = buildPtyReadInnerCommand(escapedPath, opts);
  if (!inner) return null;
  if (dir === '.') return inner;
  const escapedDir = escapeShellSingleQuoted(dir);
  return `cd ${escapedDir} && ${inner}`;
}

/**
 * Read via absolute path on the PTY host (operator Mac layout — not VM clone dir).
 * @param {string} absPath
 * @param {{ maxBytes?: number, byteOffset?: number, lineStart?: number|null, lineEnd?: number|null, lineMargin?: number }} [opts]
 */
export function buildPtyReadAbsoluteCommand(absPath, opts = {}) {
  const p = String(absPath || '').trim();
  if (!p || /\.\./.test(p) || !p.startsWith('/')) return null;
  if (!/^\/[a-zA-Z0-9_./-]+$/.test(p)) return null;
  return buildPtyReadInnerCommand(escapeShellSingleQuoted(p), opts);
}

/**
 * @param {string} escapedPath already shell-single-quoted
 * @param {{ maxBytes?: number, byteOffset?: number, lineStart?: number|null, lineEnd?: number|null, lineMargin?: number }} [opts]
 */
function buildPtyReadInnerCommand(escapedPath, opts = {}) {
  const maxBytes = Math.min(
    FS_READ_HARD_MAX_BYTES,
    Math.max(1, Math.floor(Number(opts.maxBytes) || FS_READ_DEFAULT_MAX_BYTES)),
  );
  const byteOffset = Math.max(0, Math.floor(Number(opts.byteOffset) || 0));
  const lineStart = opts.lineStart != null ? Math.floor(Number(opts.lineStart)) : null;
  const lineEnd = opts.lineEnd != null ? Math.floor(Number(opts.lineEnd)) : null;
  const margin = Math.max(0, Math.floor(Number(opts.lineMargin) || 0));

  if (lineStart != null && lineStart > 0) {
    const start = Math.max(1, lineStart - margin);
    const end =
      lineEnd != null && lineEnd > 0
        ? Math.max(start, lineEnd + margin)
        : start + 400;
    // Line-primary path; worker still applies UTF-8 max_bytes on the result.
    return `sed -n '${start},${end}p' -- ${escapedPath}`;
  }
  if (byteOffset > 0) {
    return `dd if=${escapedPath} bs=1 skip=${byteOffset} count=${maxBytes} 2>/dev/null`;
  }
  return `head -c ${maxBytes} -- ${escapedPath}`;
}

/**
 * @param {string} cmd
 * @param {string} [repoDir]
 */
export function isSafePtyReadFileCommand(cmd, repoDir = FS_SEARCH_PTY_REPO_DIR) {
  const c = String(cmd || '').trim();
  if (!c || c.length > 2400) return false;

  const innerOk = (inner) => {
    if (/^head -c \d+ -- /.test(inner)) {
      return !/[\r\n;|`$<>|&]/.test(inner);
    }
    // dd stderr redirect uses `>` — allow only this exact redirect form.
    if (/^dd if=.+ bs=1 skip=\d+ count=\d+ 2>\/dev\/null$/.test(inner)) {
      return !/[\r\n;|`$<&]/.test(inner.replace(/ 2>\/dev\/null$/, ''));
    }
    if (/^sed -n '\d+,\d+p' -- /.test(inner)) {
      return !/[\r\n;|`$<>|&]/.test(inner);
    }
    return false;
  };

  if (innerOk(c)) return true;
  const dir = String(repoDir || FS_SEARCH_PTY_REPO_DIR || '.').trim() || '.';
  if (dir === '.') return false;
  const prefix = `cd ${escapeShellSingleQuoted(dir)} && `;
  if (!c.startsWith(prefix)) return false;
  return innerOk(c.slice(prefix.length));
}

/**
 * @param {Record<string, unknown>} runContext
 * @param {string} requestedPath
 * @param {{ ok: true } & Record<string, unknown>} window
 */
function readFromActiveFileEnvelope(runContext, requestedPath, window) {
  const envelope =
    runContext.activeFileEnvelope ??
    runContext.active_file_envelope ??
    runContext.resolvedContext?.active_file_envelope ??
    null;
  if (!envelope || typeof envelope !== 'object') return null;
  const content = envelope.content != null ? String(envelope.content) : '';
  if (!content.trim()) return null;
  const req = String(requestedPath || '').trim();
  const candidates = [
    envelope.workspace_path,
    envelope.path,
    envelope.raw_path,
    envelope.github_path,
  ]
    .map((x) => (x != null ? String(x).trim() : ''))
    .filter(Boolean);
  if (!candidates.length) return null;
  const norm = (s) => s.replace(/\\/g, '/').replace(/^\.?\//, '');
  const reqN = norm(req);
  const match = candidates.some((c) => {
    const cn = norm(c);
    return cn === reqN || cn.endsWith(`/${reqN}`) || reqN.endsWith(cn);
  });
  if (!match) return null;
  const sliced = applyFsReadWindow(content, window);
  return {
    success: true,
    lane: 'workspace_buffer',
    tool: 'fs_read_file',
    path: requestedPath,
    content: sliced.content,
    truncated: sliced.truncated,
    next_byte_offset: sliced.next_byte_offset,
    byte_offset: sliced.byte_offset,
    max_bytes: sliced.max_bytes,
    line_start: sliced.line_start,
    line_end: sliced.line_end,
    source: 'active_file_envelope',
    fs_source: 'active_file_buffer',
  };
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} params
 * @param {Record<string, unknown>} runContext
 */
export async function executeFsReadFile(env, params, runContext = {}) {
  const relPath = String(params.path ?? params.file_path ?? params.file ?? '').trim();
  if (!relPath) return { error: 'path required', lane: 'unresolved', tool: 'fs_read_file' };

  const window = resolveFsReadWindow(params);
  if (window.ok === false) {
    return {
      success: false,
      error: window.error,
      lane: 'unresolved',
      tool: 'fs_read_file',
      path: relPath,
      hint: window.hint,
      soft_ceiling: window.soft_ceiling,
      max_bytes: window.max_bytes,
    };
  }

  const { resolveFsTransport, runClientFsOp, clientFsCallId } = await import('./transport.js');
  if (resolveFsTransport(runContext) === 'client_fs') {
    const callId = clientFsCallId(runContext, params._client_fs_call_suffix || 'r');
    const out = await runClientFsOp(env, runContext, {
      callId,
      operation: 'read',
      path: relPath,
      toolName: 'fs_read_file',
      timeoutMs: Number(runContext.toolBudgetMs) || 90000,
    });
    if (out.ok === false || out.error) {
      return {
        error: String(out.error || 'client_fs_read_failed'),
        lane: 'client_fs',
        tool: 'fs_read_file',
        path: relPath,
        root_name: out.root_name,
        hint: out.hint,
      };
    }
    const sliced = applyFsReadWindow(out.content != null ? String(out.content) : '', window);
    return {
      success: true,
      lane: 'client_fs',
      tool: 'fs_read_file',
      path: relPath,
      content: sliced.content,
      truncated: sliced.truncated || out.truncated === true,
      next_byte_offset: sliced.next_byte_offset,
      byte_offset: sliced.byte_offset,
      max_bytes: sliced.max_bytes,
      line_start: sliced.line_start,
      line_end: sliced.line_end,
      size: out.size,
      root_name: out.root_name,
    };
  }

  const bufferHit = readFromActiveFileEnvelope(runContext, relPath, window);
  if (bufferHit) return bufferHit;

  if (isExplicitGithubFsReadTarget(params, runContext) && !relPath.startsWith('/')) {
    const envelope =
      runContext.activeFileEnvelope ??
      runContext.active_file_envelope ??
      runContext.resolvedContext?.active_file_envelope ??
      null;
    const repo = String(
      params.github_repo || params.githubRepo || params.repo || envelope?.github_repo || '',
    ).trim();
    const path = String(params.github_path || params.githubPath || envelope?.github_path || relPath)
      .trim()
      .replace(/^\.?\//, '');
    return {
      success: false,
      error: 'wrong_tool_for_github_read',
      lane: 'github_tools',
      tool: 'fs_read_file',
      path: path || relPath,
      repo: repo || null,
      hint: 'Use agentsam_github_read with an explicit repo and path for committed GitHub content.',
    };
  }

  const userId = String(runContext.userId ?? runContext.user_id ?? params.user_id ?? '').trim();
  const workspaceId = String(runContext.workspaceId ?? runContext.workspace_id ?? params.workspace_id ?? '').trim();
  const tenantId = String(runContext.tenantId ?? runContext.tenant_id ?? params.tenant_id ?? '').trim();
  if (!userId || !workspaceId || !tenantId) {
    return { error: 'user_id, tenant_id and workspace_id required', lane: 'unresolved', tool: 'fs_read_file' };
  }

  const ptyOpts = {
    maxBytes: window.maxBytes,
    byteOffset: window.byteOffset,
    lineStart: window.lineStart,
    lineEnd: window.lineEnd,
    lineMargin: window.lineMargin,
  };
  const isAbsolute = relPath.startsWith('/');
  const command = isAbsolute
    ? buildPtyReadAbsoluteCommand(relPath, ptyOpts)
    : buildPtyReadFileCommand(relPath, '.', ptyOpts);
  if (!command || !isSafePtyReadFileCommand(command, '.')) {
    return { error: 'unsafe_or_invalid_path', lane: 'unresolved', tool: 'fs_read_file', path: relPath };
  }

  const started = Date.now();
  const { executeAgentSessionTerminalCommand } = await import('../terminal/exec.js');
  const res = await executeAgentSessionTerminalCommand(env, command, {
    ...runContext,
    userId,
    workspaceId,
    tenantId,
  }, {
    toolName: 'fs_read_file',
    timeoutMs: Number(runContext.toolBudgetMs) || 90000,
  });
  const output = String(res?.output || '');
  const exitCode = Number(res?.exitCode ?? res?.exit_code ?? 1);
  if (!res?.ok || exitCode !== 0) {
    const missing = /no such file or directory|cannot open|not found/i.test(output) || /not found/i.test(String(res?.error || ''));
    return {
      success: false,
      error: missing ? 'file_not_found' : String(res?.error || 'pty_read_failed'),
      lane: 'workspace_pty',
      tool: 'fs_read_file',
      path: relPath,
      content: output.slice(0, 4000),
      exit_code: exitCode,
      duration_ms: Math.max(0, Date.now() - started),
      connection_id: res?.targetId || null,
      hint: 'Read the selected working tree with fs_read_file, or use agentsam_github_read explicitly for committed GitHub content.',
    };
  }

  const shellDidByteSkip = window.lineStart == null && window.byteOffset > 0;
  const sliced = applyFsReadWindow(output, {
    ...window,
    lineStart: null,
    lineEnd: null,
    lineMargin: 0,
    byteOffset: shellDidByteSkip ? 0 : window.byteOffset,
  });
  const next = sliced.next_byte_offset != null
    ? shellDidByteSkip ? window.byteOffset + sliced.next_byte_offset : sliced.next_byte_offset
    : null;
  return {
    success: true,
    lane: 'workspace_pty',
    tool: 'fs_read_file',
    path: relPath,
    content: sliced.content,
    exit_code: exitCode,
    truncated: sliced.truncated === true || next != null,
    next_byte_offset: next,
    byte_offset: window.byteOffset,
    max_bytes: window.maxBytes,
    line_start: window.lineStart,
    line_end: window.lineEnd,
    duration_ms: Math.max(0, Date.now() - started),
    fs_source: 'local_working_tree',
    connection_id: res?.targetId || null,
  };
}
