/** OpenAI apply_patch filesystem execution. Provider capability injection remains provider-owned. */
import { applyDiff } from '@openai/agents';
import { executeFsReadFile } from './read.js';
import { executeFsWriteFile } from './write.js';
import { escapeShellSingleQuoted } from './rg.js';

export function normalizeApplyPatchPath(raw) {
  const s = raw != null ? String(raw).trim() : '';
  if (!s) return { ok: false, error: 'path_required' };
  if (s.startsWith('/') || s.startsWith('~') || s.includes('\\')) {
    return { ok: false, error: 'absolute_or_host_path_denied' };
  }
  if (s.includes('\0') || /\.\./.test(s)) {
    return { ok: false, error: 'path_traversal_denied' };
  }
  const rel = s.replace(/^\.?\//, '');
  if (!rel || rel.split('/').some((seg) => seg === '..' || seg === '' || seg === '.')) {
    return { ok: false, error: 'unsafe_or_invalid_path' };
  }
  if (!/^[a-zA-Z0-9_./-]+$/.test(rel)) {
    return { ok: false, error: 'path_chars_denied' };
  }
  return { ok: true, path: rel };
}

/**
 * @param {Record<string, unknown>|null|undefined} writePolicy
 */
export function assertApplyPatchWritePolicy(writePolicy) {
  if (writePolicy && writePolicy.can_edit_files === false) {
    return { ok: false, error: 'write_policy_denied: can_edit_files=false' };
  }
  return { ok: true };
}

/**
 * @param {string} relPath
 * @param {string} [repoDir]
 */
export function buildPtyDeleteFileCommand(relPath, repoDir = '.') {
  const norm = normalizeApplyPatchPath(relPath);
  if (!norm.ok) return null;
  const dir = String(repoDir || '.').trim() || '.';
  if (dir !== '.' && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,120}$/.test(dir)) return null;
  const body = `rm -f -- ${escapeShellSingleQuoted(norm.path)}`;
  if (dir === '.') return body;
  return `cd ${escapeShellSingleQuoted(dir)} && ${body}`;
}

/**
 * @param {unknown} operation
 * @param {string} currentContent
 */
export function materializeApplyPatchContent(operation, currentContent) {
  const op = operation && typeof operation === 'object' ? operation : {};
  const type = String(op.type || '').trim();
  const diff = op.diff != null ? String(op.diff).replace(/\r\n/g, '\n') : '';
  const current = String(currentContent ?? '').replace(/\r\n/g, '\n');
  if (type === 'create_file') {
    return { ok: true, content: applyDiff('', diff, 'create'), mode: 'create' };
  }
  if (type === 'update_file') {
    return { ok: true, content: applyDiff(current, diff, 'default'), mode: 'update' };
  }
  if (type === 'delete_file') {
    return { ok: true, content: null, mode: 'delete' };
  }
  return { ok: false, error: `unsupported_operation:${type || 'missing'}` };
}

/**
 * Apply one apply_patch_call operation via fs_* / PTY workspace lanes.
 * @param {any} env
 * @param {{ call_id?: string, id?: string, operation?: Record<string, unknown> }} call
 * @param {Record<string, unknown>} runContext
 * @param {{ writePolicy?: Record<string, unknown>|null }} [opts]
 */
export async function executeApplyPatchCall(env, call, runContext = {}, opts = {}) {
  const callId = String(call?.call_id || call?.id || '').trim();
  const op = call?.operation && typeof call.operation === 'object' ? call.operation : {};
  const policy = assertApplyPatchWritePolicy(opts.writePolicy);
  if (!policy.ok) {
    return {
      type: 'apply_patch_call_output',
      call_id: callId,
      status: 'failed',
      output: policy.error,
    };
  }

  const pathNorm = normalizeApplyPatchPath(op.path);
  if (!pathNorm.ok) {
    return {
      type: 'apply_patch_call_output',
      call_id: callId,
      status: 'failed',
      output: `Error: ${pathNorm.error} for path '${String(op.path || '').slice(0, 200)}'`,
    };
  }
  const path = pathNorm.path;
  const opType = String(op.type || '').trim();

  try {
    if (opType === 'delete_file') {
      const del = await deleteWorkspaceFileViaPty(env, path, runContext);
      if (del.error) {
        return {
          type: 'apply_patch_call_output',
          call_id: callId,
          status: 'failed',
          output: `Error: Could not delete '${path}' — ${del.error}`,
        };
      }
      return {
        type: 'apply_patch_call_output',
        call_id: callId,
        status: 'completed',
        output: `Deleted ${path}`,
      };
    }

    let current = '';
    if (opType === 'update_file') {
      const read = await executeFsReadFile(env, { path }, runContext);
      if (read?.error || read?.success === false) {
        return {
          type: 'apply_patch_call_output',
          call_id: callId,
          status: 'failed',
          output: `Error: File not found at path '${path}'${read?.error ? ` — ${read.error}` : ''}`,
        };
      }
      current = read?.content != null ? String(read.content) : '';
    }

    let materialized;
    try {
      materialized = materializeApplyPatchContent(op, current);
    } catch (e) {
      return {
        type: 'apply_patch_call_output',
        call_id: callId,
        status: 'failed',
        output: `Error: Invalid patch for '${path}' — ${String(e?.message || e).slice(0, 400)}`,
      };
    }
    if (!materialized.ok) {
      return {
        type: 'apply_patch_call_output',
        call_id: callId,
        status: 'failed',
        output: `Error: ${materialized.error}`,
      };
    }

    const write = await executeFsWriteFile(
      env,
      { path, content: materialized.content },
      runContext,
    );
    if (write?.error || write?.success === false) {
      return {
        type: 'apply_patch_call_output',
        call_id: callId,
        status: 'failed',
        output: `Error: Could not apply patch to '${path}' — ${write?.error || 'write_failed'}`,
      };
    }
    const verb = opType === 'create_file' ? 'Created' : 'Updated';
    return {
      type: 'apply_patch_call_output',
      call_id: callId,
      status: 'completed',
      output: `${verb} ${path}${write?.bytes_written != null ? ` (${write.bytes_written} bytes)` : ''}`,
    };
  } catch (e) {
    return {
      type: 'apply_patch_call_output',
      call_id: callId,
      status: 'failed',
      output: `Error: apply_patch harness exception — ${String(e?.message || e).slice(0, 400)}`,
    };
  }
}

/**
 * @param {any} env
 * @param {Array<Record<string, unknown>>} calls
 * @param {Record<string, unknown>} runContext
 * @param {{ writePolicy?: Record<string, unknown>|null }} [opts]
 */
export async function executeApplyPatchCalls(env, calls, runContext = {}, opts = {}) {
  const out = [];
  for (const call of calls || []) {
    out.push(await executeApplyPatchCall(env, call, runContext, opts));
  }
  return out;
}

async function deleteWorkspaceFileViaPty(env, relPath, runContext) {
  const userId = String(runContext.userId ?? runContext.user_id ?? '').trim();
  const workspaceId = String(runContext.workspaceId ?? runContext.workspace_id ?? '').trim();
  const tenantId = String(runContext.tenantId ?? runContext.tenant_id ?? '').trim();
  if (!userId || !workspaceId || !tenantId) {
    return { error: 'user_id, tenant_id and workspace_id required' };
  }

  const command = buildPtyDeleteFileCommand(relPath, '.');
  if (!command) return { error: 'unsafe_or_invalid_path' };

  try {
    const { executeAgentSessionTerminalCommand } = await import('../terminal/exec.js');
    const res = await executeAgentSessionTerminalCommand(
      env,
      command,
      { ...runContext, userId, workspaceId, tenantId },
      { toolName: 'openai_apply_patch_delete', timeoutMs: Number(runContext.toolBudgetMs) || 90000 },
    );
    const exitCode = Number(res?.exitCode ?? res?.exit_code ?? 1);
    if (!res?.ok || exitCode !== 0) {
      return {
        error: `pty_delete_failed exit=${exitCode}`,
        output: String(res?.output || res?.error || '').slice(0, 400),
      };
    }
    return { success: true, path: relPath, connection_id: res?.targetId || null };
  } catch (e) {
    return { error: String(e?.message || e).slice(0, 500) };
  }
}
