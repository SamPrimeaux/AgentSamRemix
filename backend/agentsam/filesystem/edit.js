/**
 * fs_edit_file — find/replace on live PTY bytes (Cursor strReplace semantics).
 * Success body includes before/after so tryBroadcastMonacoPatchFromToolOutput lights DiffEditor.
 */
import { executeFsReadFile } from './read.js';
import {
  executeFsWriteFile,
  shouldPreferGithubFsWrite,
} from './write.js';

/** Cap before/after payloads returned to the tool loop / Monaco broadcast. */
export const FS_EDIT_DIFF_BODY_MAX_CHARS = 200_000;

/** Count non-overlapping occurrences of find in haystack (literal). */
export function countOccurrences(haystack, find) {
  const h = String(haystack ?? '');
  const f = String(find ?? '');
  if (!f) return 0;
  let n = 0;
  let i = 0;
  while (true) {
    const j = h.indexOf(f, i);
    if (j < 0) break;
    n += 1;
    i = j + f.length;
  }
  return n;
}

export function applyFindReplace(content, find, replace, replaceAll) {
  const c = String(content ?? '');
  const f = String(find ?? '');
  const r = String(replace ?? '');
  if (replaceAll) return c.split(f).join(r);
  const i = c.indexOf(f);
  if (i < 0) return c;
  return c.slice(0, i) + r + c.slice(i + f.length);
}

/** Line-level counts via common prefix/suffix trim (good enough for tool receipt). */
export function countLineDelta(before, after) {
  const a = String(before ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  const b = String(after ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length && a[i] === b[j]) {
    i++;
    j++;
  }
  let ai = a.length - 1;
  let bj = b.length - 1;
  while (ai >= i && bj >= j && a[ai] === b[bj]) {
    ai--;
    bj--;
  }
  return {
    lines_removed: Math.max(0, ai - i + 1),
    lines_added: Math.max(0, bj - j + 1),
  };
}

/** Short unified diff; cap ~8k chars. Pure string — no shell. */
export function unifiedDiff(before, after, path = 'file', maxChars = 8000) {
  const a = String(before ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  const b = String(after ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length && a[i] === b[j]) {
    i++;
    j++;
  }
  let ai = a.length - 1;
  let bj = b.length - 1;
  while (ai >= i && bj >= j && a[ai] === b[bj]) {
    ai--;
    bj--;
  }
  const oldStart = i + 1;
  const newStart = j + 1;
  const oldLines = a.slice(i, ai + 1);
  const newLines = b.slice(j, bj + 1);
  const hunk = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${oldStart},${oldLines.length} +${newStart},${newLines.length} @@`,
    ...oldLines.map((l) => `-${l}`),
    ...newLines.map((l) => `+${l}`),
  ].join('\n');
  return hunk.length > maxChars ? hunk.slice(0, maxChars) + '\n…(diff truncated)' : hunk;
}

function capBody(text) {
  const s = String(text ?? '');
  if (s.length <= FS_EDIT_DIFF_BODY_MAX_CHARS) return s;
  return s.slice(0, FS_EDIT_DIFF_BODY_MAX_CHARS) + '\n…(truncated)';
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} params
 * @param {Record<string, unknown>} runContext
 */
export async function executeFsEditFile(env, params, runContext = {}) {
  const { denyFsToolOnGithubFilesSource } = await import('./transport.js');
  const githubDeny = denyFsToolOnGithubFilesSource('fs_edit_file', runContext);
  if (githubDeny) return githubDeny;

  const relPath = String(params.path ?? params.file_path ?? params.file ?? '').trim();
  const find =
    params.find != null
      ? String(params.find)
      : params.old_str != null
        ? String(params.old_str)
        : params.old_string != null
          ? String(params.old_string)
          : params.old_text != null
            ? String(params.old_text)
            : params.oldText != null
              ? String(params.oldText)
              : null;
  const replace =
    params.replace != null
      ? String(params.replace)
      : params.new_str != null
        ? String(params.new_str)
        : params.new_string != null
          ? String(params.new_string)
          : params.new_text != null
            ? String(params.new_text)
            : params.newText != null
              ? String(params.newText)
              : null;
  const replaceAll = params.replace_all === true || params.replaceAll === true;

  if (!relPath) {
    return { error: 'path required', lane: 'workspace_edit', tool: 'fs_edit_file' };
  }
  if (find == null || find === '') {
    return {
      error: 'find required',
      lane: 'workspace_edit',
      tool: 'fs_edit_file',
      hint: 'fs_edit_file needs an exact find string; use fs_write_file for full-file rewrites',
    };
  }
  if (replace == null) {
    return {
      error: 'replace required',
      lane: 'workspace_edit',
      tool: 'fs_edit_file',
      hint: 'Pass replace (may be empty string to delete the matched text)',
    };
  }
  if (shouldPreferGithubFsWrite(params, runContext) && !relPath.startsWith('/')) {
    const envelope =
      runContext.activeFileEnvelope ??
      runContext.active_file_envelope ??
      runContext.resolvedContext?.active_file_envelope ??
      null;
    const repo = String(
      params.github_repo ||
        params.githubRepo ||
        params.repo ||
        envelope?.github_repo ||
        runContext.selectedGithubRepoContext ||
        runContext.githubRepoContext ||
        '',
    ).trim();
    const path = String(params.github_path || params.githubPath || envelope?.github_path || relPath)
      .trim()
      .replace(/^\.?\//, '');
    return {
      error: 'wrong_tool_for_github_edit',
      message:
        'This GitHub-bound file must be edited with agentsam_github_patch, not fs_edit_file. Pass repo, path, branch, find, and replace explicitly; fs_* only edits local files.',
      lane: 'github_tools',
      tool: 'fs_edit_file',
      path: path || relPath,
      repo: repo || null,
      hint: 'Use agentsam_github_patch for an exact remote edit.',
    };
  }

  const userId = String(
    runContext.userId ?? runContext.user_id ?? params.user_id ?? params.session?.user_id ?? '',
  ).trim();
  const workspaceId = String(
    runContext.workspaceId ?? runContext.workspace_id ?? params.workspace_id ?? '',
  ).trim();
  const tenantId = String(
    runContext.tenantId ?? runContext.tenant_id ?? params.tenant_id ?? '',
  ).trim();

  if (!userId || !workspaceId) {
    return { error: 'user_id and workspace_id required', lane: 'workspace_edit', tool: 'fs_edit_file' };
  }

  const { resolveFsTransport } = await import('./transport.js');
  const transport = resolveFsTransport(runContext);
  const readOut = await executeFsReadFile(
    env,
    { path: relPath, _client_fs_call_suffix: 'edit-r' },
    runContext,
  );
  if (readOut?.error || readOut?.success === false) {
    return {
      error: String(readOut?.error || 'fs_read_failed'),
      lane: readOut?.lane || 'workspace_edit',
      tool: 'fs_edit_file',
      path: relPath,
      root_name: readOut?.root_name,
      body: readOut,
    };
  }
  const before = readOut?.content != null ? String(readOut.content) : '';
  const occurrences = countOccurrences(before, find);
  if (occurrences === 0) {
    return {
      error: 'string_not_found',
      lane: transport === 'client_fs' ? 'client_fs' : 'workspace_edit',
      tool: 'fs_edit_file',
      path: relPath,
      find: find.slice(0, 200),
      hint: 'Live file does not contain the exact find string — re-read and retry with a unique match',
    };
  }
  if (!replaceAll && occurrences > 1) {
    return {
      error: 'ambiguous_match',
      lane: transport === 'client_fs' ? 'client_fs' : 'workspace_edit',
      tool: 'fs_edit_file',
      path: relPath,
      occurrences,
      hint: `find matched ${occurrences} times; set replace_all=true or use a more specific find string`,
    };
  }

  const after = applyFindReplace(before, find, replace, replaceAll);
  if (after === before) {
    return {
      error: 'no_change',
      lane: transport === 'client_fs' ? 'client_fs' : 'workspace_edit',
      tool: 'fs_edit_file',
      path: relPath,
    };
  }

  const writeOut = await executeFsWriteFile(
    env,
    {
      path: relPath,
      content: after,
      create_dirs: true,
      _client_fs_call_suffix: 'edit-w',
    },
    { ...runContext, skipWorkspaceRootAssert: true },
  );
  if (writeOut?.error) {
    return {
      error: String(writeOut.error),
      lane: writeOut.lane || 'workspace_edit',
      tool: 'fs_edit_file',
      path: relPath,
      root_name: writeOut?.root_name,
      body: writeOut,
    };
  }

  // Fail loud if Local write claimed success but disk still has the old bytes.
  if (transport === 'client_fs') {
    const verifyOut = await executeFsReadFile(
      env,
      { path: relPath, _client_fs_call_suffix: 'edit-v' },
      runContext,
    );
    if (verifyOut?.error || verifyOut?.success === false) {
      return {
        error: 'edit_verify_read_failed',
        lane: 'client_fs',
        tool: 'fs_edit_file',
        path: relPath,
        root_name: verifyOut?.root_name ?? writeOut?.root_name,
        hint: String(verifyOut?.error || 'Could not re-read after edit write'),
        body: verifyOut,
      };
    }
    const verified = verifyOut?.content != null ? String(verifyOut.content) : '';
    if (verified !== after) {
      return {
        error: 'edit_verify_mismatch',
        lane: 'client_fs',
        tool: 'fs_edit_file',
        path: relPath,
        root_name: verifyOut?.root_name ?? writeOut?.root_name,
        hint:
          'Local write did not persist expected after-text. Reconnect Local to the intended folder and retry.',
        expected_len: after.length,
        verified_len: verified.length,
      };
    }
  }

  const { lines_added, lines_removed } = countLineDelta(before, after);
  const diff = unifiedDiff(before, after, relPath);
  return {
    success: true,
    lane: writeOut?.lane || (transport === 'client_fs' ? 'client_fs' : 'workspace_pty_write'),
    tool: 'fs_edit_file',
    path: relPath,
    root_name: writeOut?.root_name ?? readOut?.root_name,
    occurrences: replaceAll ? occurrences : 1,
    replace_all: replaceAll,
    lines_added,
    lines_removed,
    diff,
    before: capBody(before),
    after: capBody(after),
    bytes_written: writeOut?.bytes_written,
    connection_id: writeOut?.connection_id,
  };
}
