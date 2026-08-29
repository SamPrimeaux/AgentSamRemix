/**
 * filesystem.write — PTY workspace write (mirrors fs-read-file.js; no /api/fs/* loopback).
 */
import { escapeShellSingleQuoted } from './rg.js';
import { FS_SEARCH_PTY_REPO_DIR } from './rg.js';

export const FS_WRITE_MAX_BYTES = 512_000;

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(String(text ?? ''));
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * @param {string} relPath
 * @param {string} contentBase64
 * @param {string} [repoDir]
 */
export function buildPtyWriteFileCommand(relPath, contentBase64, repoDir = FS_SEARCH_PTY_REPO_DIR) {
  const raw = String(relPath || '').trim();
  if (!raw || /\.\./.test(raw) || /^[~\/]/.test(raw)) return null;
  const p = raw.replace(/^\.?\//, '');
  if (!p || p.split('/').some((seg) => seg === '..' || seg === '.')) return null;
  if (!/^[a-zA-Z0-9_./-]+$/.test(p)) return null;
  const dir = String(repoDir || FS_SEARCH_PTY_REPO_DIR || '.').trim() || '.';
  if (dir !== '.' && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,120}$/.test(dir)) return null;
  const b64 = String(contentBase64 || '').trim();
  if (!b64 || !/^[A-Za-z0-9+/=]+$/.test(b64)) return null;
  const escapedPath = escapeShellSingleQuoted(p);
  const escapedB64 = escapeShellSingleQuoted(b64);
  const body = `echo ${escapedB64} | base64 -d > ${escapedPath}`;
  if (dir === '.') return body;
  return `cd ${escapeShellSingleQuoted(dir)} && ${body}`;
}

/**
 * @param {string} cmd
 * @param {string} [repoDir]
 */
export function isSafePtyWriteFileCommand(cmd, repoDir = FS_SEARCH_PTY_REPO_DIR) {
  const c = String(cmd || '').trim();
  if (!c || c.length > 3200) return false;
  // Required pipe for base64 decode — strip it before metachar checks.
  if (!c.includes(' | base64 -d > ')) return false;
  const withoutRequiredPipe = c.replace(' | base64 -d > ', ' ___B64OUT___ ');
  if (/[\r\n;|`$<>]/.test(withoutRequiredPipe)) return false;
  if (/(?<![&])&(?![&])/.test(withoutRequiredPipe)) return false;
  const dir = String(repoDir || FS_SEARCH_PTY_REPO_DIR || '.').trim() || '.';
  if (dir === '.') {
    return c.startsWith('echo ');
  }
  const prefix = `cd ${escapeShellSingleQuoted(dir)} && echo `;
  return c.startsWith(prefix);
}

/**
 * Fail loud when bound buffer / session root disagrees with resolved PTY repo.
 * @param {{ repoRoot?: string, workspaceRoot?: string }|null|undefined} repo
 * @param {Record<string, unknown>} [runContext]
 * @returns {{ error: string, expected: string, resolved: string, hint: string }|null}
 */
export function assertWorkspaceRootForFsWrite(repo, runContext = {}) {
  if (runContext?.skipWorkspaceRootAssert === true) return null;
  const envelope =
    runContext.activeFileEnvelope ??
    runContext.active_file_envelope ??
    runContext.resolvedContext?.active_file_envelope ??
    null;
  const expected =
    pickNonEmpty(
      runContext.expected_repo_root,
      runContext.expectedRepoRoot,
      envelope?.workspace_root,
      envelope?.repo_root,
      runContext.bound_workspace_root,
      runContext.boundWorkspaceRoot,
    ) || '';
  if (!expected) return null;
  const resolved = pickNonEmpty(repo?.repoRoot, repo?.workspaceRoot) || '';
  if (!resolved) return null;
  const norm = (s) =>
    String(s || '')
      .replace(/\\/g, '/')
      .replace(/\/+$/, '')
      .toLowerCase();
  const e = norm(expected);
  const r = norm(resolved);
  if (!e || !r) return null;
  if (e === r || e.endsWith(`/${r}`) || r.endsWith(`/${e}`)) return null;
  // Basename-only expected/resolved (e.g. "inneranimalmedia") may match the other path's leaf.
  const eLeaf = e.split('/').filter(Boolean).pop() || '';
  const rLeaf = r.split('/').filter(Boolean).pop() || '';
  if (!e.includes('/') && e && e === rLeaf) return null;
  if (!r.includes('/') && r && r === eLeaf) return null;
  return {
    error: 'wrong_workspace_root',
    expected,
    resolved: repo?.repoRoot || repo?.workspaceRoot || resolved,
    hint: 'Bound buffer root and PTY session root disagree — rebind workspace / PTY lane before writing',
  };
}

function pickNonEmpty(...vals) {
  for (const v of vals) {
    const s = v != null ? String(v).trim() : '';
    if (s) return s;
  }
  return '';
}

/**
 * Explicit / open-buffer GitHub write — do not PTY-lock to IAM workspace root.
 * Explorer repo alone is not enough (local buffers still use PTY); active file or
 * prefer_github / github_* params select the GitHub lane.
 * @param {Record<string, unknown>} [params]
 * @param {Record<string, unknown>} [runContext]
 */
export function shouldPreferGithubFsWrite(params = {}, runContext = {}) {
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
    String(params.source || '').toLowerCase() === 'github' ||
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
    if (envelope.github_repo && (envelope.github_path || params.path || params.file_path)) {
      return true;
    }
  }
  const repo = String(params.github_repo || params.githubRepo || params.repo || '').trim();
  return repo.includes('/');
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} params
 * @param {Record<string, unknown>} runContext
 */
export async function executeFsWriteFile(env, params, runContext = {}) {
  const relPath = String(params.path ?? params.file_path ?? params.file ?? '').trim();
  const content = params.content != null ? String(params.content) : params.proposed_content != null ? String(params.proposed_content) : '';
  if (!relPath) return { error: 'path required', lane: 'workspace_write', tool: 'fs_write_file' };
  if (params.content == null && params.proposed_content == null) return { error: 'content required', lane: 'workspace_write', tool: 'fs_write_file' };
  const byteLen = new TextEncoder().encode(content).length;
  if (byteLen > FS_WRITE_MAX_BYTES) return { error: 'content_too_large', max_bytes: FS_WRITE_MAX_BYTES, lane: 'workspace_write' };

  if (shouldPreferGithubFsWrite(params, runContext) && !relPath.startsWith('/')) {
    const envelope = runContext.activeFileEnvelope ?? runContext.active_file_envelope ?? runContext.resolvedContext?.active_file_envelope ?? null;
    const githubRepo = String(params.github_repo || params.githubRepo || params.repo || envelope?.github_repo || '').trim();
    const githubPath = String(params.github_path || params.githubPath || envelope?.github_path || relPath).trim().replace(/^\.?\//, '');
    return {
      error: 'wrong_tool_for_github_write',
      message: 'This GitHub-bound file must be written with agentsam_github_write or agentsam_github_patch, not fs_write_file.',
      lane: 'github_tools',
      tool: 'fs_write_file',
      path: githubPath || relPath,
      repo: githubRepo || null,
      hint: 'Use agentsam_github_write for a full-file write or agentsam_github_patch for an exact edit.',
    };
  }

  const { resolveFsTransport, runClientFsOp, clientFsCallId } = await import('./transport.js');
  if (resolveFsTransport(runContext) === 'client_fs') {
    const createDirs = params.create_dirs !== false && params.createDirs !== false;
    const callId = clientFsCallId(runContext, params._client_fs_call_suffix || 'w');
    const out = await runClientFsOp(env, runContext, {
      callId,
      operation: 'write',
      path: relPath,
      content,
      create_dirs: createDirs,
      toolName: 'fs_write_file',
      timeoutMs: Number(runContext.toolBudgetMs) || 90000,
    });
    if (out.ok === false || out.error) {
      return { error: String(out.error || 'client_fs_write_failed'), lane: 'client_fs', tool: 'fs_write_file', path: relPath, root_name: out.root_name, hint: out.hint };
    }
    return { success: true, lane: 'client_fs', tool: 'fs_write_file', path: relPath, bytes_written: out.bytes_written ?? byteLen, root_name: out.root_name };
  }

  const userId = String(runContext.userId ?? runContext.user_id ?? params.user_id ?? '').trim();
  const workspaceId = String(runContext.workspaceId ?? runContext.workspace_id ?? params.workspace_id ?? '').trim();
  const tenantId = String(runContext.tenantId ?? runContext.tenant_id ?? params.tenant_id ?? '').trim();
  if (!userId || !workspaceId || !tenantId) return { error: 'user_id, tenant_id and workspace_id required', lane: 'workspace_write' };
  if (relPath.startsWith('/')) {
    return { error: 'absolute_path_write_not_supported', lane: 'workspace_write', hint: 'Use a workspace-relative path on the selected filesystem lane.' };
  }

  const contentBase64 = utf8ToBase64(content);
  const command = buildPtyWriteFileCommand(relPath, contentBase64, '.');
  if (!command || !isSafePtyWriteFileCommand(command, '.')) return { error: 'unsafe_or_invalid_path', lane: 'workspace_write', path: relPath };

  const started = Date.now();
  const { executeAgentSessionTerminalCommand } = await import('../terminal/exec.js');
  const res = await executeAgentSessionTerminalCommand(env, command, {
    ...runContext,
    userId,
    workspaceId,
    tenantId,
  }, {
    toolName: 'fs_write_file',
    timeoutMs: Number(runContext.toolBudgetMs) || 90000,
  });
  const output = String(res?.output || '');
  const exitCode = Number(res?.exitCode ?? res?.exit_code ?? 1);
  if (!res?.ok || exitCode !== 0) {
    const missing = /no such file or directory|cannot open|not found/i.test(output);
    return {
      error: missing ? 'file_not_found' : String(res?.error || 'pty_write_failed'),
      lane: 'workspace_pty_write',
      path: relPath,
      exit_code: exitCode,
      output: output.slice(0, 800),
      duration_ms: Math.max(0, Date.now() - started),
      connection_id: res?.targetId || null,
      hint: 'Write applies only to the selected working tree; use agentsam_github_write explicitly for GitHub.',
    };
  }
  return {
    success: true,
    lane: 'workspace_pty_write',
    tool: 'fs_write_file',
    path: relPath,
    bytes_written: byteLen,
    exit_code: exitCode,
    duration_ms: Math.max(0, Date.now() - started),
    connection_id: res?.targetId || null,
  };
}
