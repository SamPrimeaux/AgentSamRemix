/**
 * Session-root filesystem transport for fs_* ops.
 *
 *   client_fs     — Files rail Local (browser FSA handle)
 *   workspace_pty — internal lane id when FSA is off; execution rides the same
 *                   terminal/ExecOS fabric as agentsam_terminal_local|remote|sandbox
 *                   (not a separate product tool). Prefer saying "terminal_exec"
 *                   in session roots / logs.
 *
 * Catalog decides which op (read/write/edit/list). Session roots decide where bytes live.
 * Never decide transport by tool-name regex in the tool loop.
 *
 * files_source is the UI preferred Files-rail tab — not an exclusive capability lock.
 * Per-call blocks stay on github-bound Monaco buffers
 * (wrong_tool_for_github_bound_buffer), not blanket files_source=github.
 */

/** @type {Record<string, string>} */
export const GITHUB_FILES_SOURCE_FS_HINTS = Object.freeze({
  fs_list_dir: 'agentsam_github_tree',
  fs_read_file: 'agentsam_github_read',
  fs_read_multiple: 'agentsam_github_read_many',
  fs_search_files: 'agentsam_github_search',
  fs_edit_file: 'agentsam_github_patch',
  fs_write_file: 'agentsam_github_write',
});

/**
 * @param {Record<string, unknown>|null|undefined} runContext
 * @returns {string}
 */
export function resolveFilesSource(runContext) {
  const ctx = runContext && typeof runContext === 'object' ? runContext : {};
  return String(
    ctx.files_source ||
      ctx.filesSource ||
      ctx.runtimeProfile?._files_source ||
      '',
  )
    .trim()
    .toLowerCase();
}

/**
 * @param {Record<string, unknown>|null|undefined} runContext
 * @returns {boolean}
 */
export function isGithubFilesSource(runContext) {
  return resolveFilesSource(runContext) === 'github';
}

/**
 * @deprecated Blanket github-rail fs ban retired — always false.
 * Per-call legality is github-bound buffer / path args, not files_source alone.
 * @param {unknown} [_toolName]
 * @returns {boolean}
 */
export function isIllegalFsToolForGithubFilesSource(_toolName) {
  return false;
}

/**
 * @deprecated No-op — files_source=github is not a hard capability partition.
 * Callers may keep the import; github-bound Monaco buffers still block via
 * active-file-envelope (wrong_tool_for_github_bound_buffer).
 * @param {unknown} [_toolName]
 * @param {Record<string, unknown>|null|undefined} [_runContext]
 * @returns {null}
 */
export function denyFsToolOnGithubFilesSource(_toolName, _runContext) {
  return null;
}

/**
 * @param {Record<string, unknown>|null|undefined} runContext
 * @returns {boolean}
 */
export function isClientFsSession(runContext) {
  const ctx = runContext && typeof runContext === 'object' ? runContext : {};
  // Live FSA handle only — files_source=local without fsa_root must use terminal_exec.
  return (
    ctx.fsa_root === true ||
    ctx._fsa_root === true ||
    ctx.runtimeProfile?._fsa_root === true
  );
}

/**
 * @param {Record<string, unknown>|null|undefined} runContext
 * @returns {'client_fs'|'workspace_pty'}
 */
export function resolveFsTransport(runContext) {
  return isClientFsSession(runContext) ? 'client_fs' : 'workspace_pty';
}

/**
 * Fields the tool loop must pass on every catalog dispatch so fs_* can use client_fs.
 * @param {Record<string, unknown>|null|undefined} mcpCtx
 * @param {{ emit: Function, toolCallId: string, sessionId: string }} bridge
 */
export function clientFsBridgeFields(mcpCtx, bridge) {
  const ctx = mcpCtx && typeof mcpCtx === 'object' ? mcpCtx : {};
  const fsa_root =
    ctx.fsa_root === true ||
    ctx.runtimeProfile?._fsa_root === true;
  const files_source = String(
    ctx.files_source || ctx.filesSource || ctx.runtimeProfile?._files_source || '',
  )
    .trim()
    .toLowerCase();
  const files_source_path = String(
    ctx.files_source_path ||
      ctx.filesSourcePath ||
      ctx.runtimeProfile?._files_source_path ||
      '',
  ).trim();
  const files_r2_bucket = String(
    ctx.files_r2_bucket ||
      ctx.r2_bucket ||
      ctx.runtimeProfile?._files_r2_bucket ||
      '',
  ).trim();
  const files_r2_prefix = String(
    ctx.files_r2_prefix ||
      ctx.r2_prefix ||
      ctx.runtimeProfile?._files_r2_prefix ||
      '',
  ).trim();
  // Parse r2://bucket/prefix from source_path when structured fields absent.
  let r2_bucket = files_r2_bucket;
  let r2_prefix = files_r2_prefix;
  if (!r2_bucket && /^r2:\/\//i.test(files_source_path)) {
    const m = files_source_path.match(/^r2:\/\/([^/]+)\/?(.*)$/i);
    if (m) {
      r2_bucket = m[1];
      r2_prefix = r2_prefix || m[2] || '';
    }
  }
  return {
    fsa_root,
    files_source: files_source || (fsa_root ? 'local' : ''),
    files_source_path: files_source_path || null,
    r2_bucket: r2_bucket || null,
    r2_prefix: r2_prefix || null,
    files_r2_bucket: r2_bucket || null,
    files_r2_prefix: r2_prefix || null,
    emit: typeof bridge.emit === 'function' ? bridge.emit : null,
    toolCallId: String(bridge.toolCallId || '').trim() || null,
    sessionId: String(bridge.sessionId || '').trim() || null,
    conversationId: String(bridge.sessionId || '').trim() || null,
    signal: ctx.signal ?? ctx.abortSignal ?? bridge.signal ?? null,
    abortSignal: ctx.abortSignal ?? ctx.signal ?? bridge.signal ?? null,
  };
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} runContext
 * @param {{
 *   callId: string,
 *   operation: 'read'|'write'|'list'|'search',
 *   path: string,
 *   content?: string|null,
 *   query?: string|null,
 *   create_dirs?: boolean,
 *   timeoutMs?: number,
 *   toolName?: string,
 * }} op
 */
export async function runClientFsOp(env, runContext, op) {
  const operation = String(op.operation || 'read').toLowerCase();
  if (
    operation !== 'read' &&
    operation !== 'write' &&
    operation !== 'list' &&
    operation !== 'search'
  ) {
    return {
      ok: false,
      error: 'fsa_unsupported_operation',
      lane: 'client_fs',
      operation,
      hint: 'client_fs supports read|write|list|search; edit is Worker find/replace over read+write',
    };
  }

  const emit = typeof runContext?.emit === 'function' ? runContext.emit : null;
  const sessionId = String(
    runContext?.sessionId || runContext?.conversationId || runContext?.conversation_id || '',
  ).trim();
  const callId = String(op.callId || '').trim();
  const path = String(op.path || '').trim();

  if (!emit || !sessionId || !callId) {
    return {
      ok: false,
      error: 'fsa_transport_unavailable',
      lane: 'client_fs',
      operation,
      path,
      hint: 'Local Files is connected but the SSE/DO bridge was not passed into the fs executor — not falling back to PTY.',
    };
  }

  emit('client_fs_request', {
    call_id: callId,
    tool_name: op.toolName != null ? String(op.toolName) : undefined,
    path,
    operation,
    content: op.content != null ? String(op.content) : null,
    query: op.query != null ? String(op.query) : null,
    // Prefer omit-false so browser default (create parents) stays on for agent writes.
    create_dirs: op.create_dirs === false ? false : true,
    conversation_id: sessionId,
  });

  const { getAgentSessionStub, doWaitForFsaFulfill } = await import('../sessions/session-context.js');
  const stub = getAgentSessionStub(env, sessionId);
  if (!stub) {
    return {
      ok: false,
      error: 'fsa_no_session_do',
      lane: 'client_fs',
      operation,
      path,
    };
  }

  const timeoutMs = Math.min(Math.max(Number(op.timeoutMs) || 90000, 5000), 120000);
  const signal = runContext?.abortSignal || runContext?.signal || null;
  let fulfill;
  try {
    fulfill = await doWaitForFsaFulfill(stub, callId, { timeoutMs, signal });
  } catch (e) {
    return {
      ok: false,
      error: String(e?.message || e || 'fsa_fulfill_failed'),
      lane: 'client_fs',
      operation,
      path,
    };
  }

  return normalizeClientFsFulfill(fulfill, { operation, path });
}

/**
 * @param {unknown} fulfill
 * @param {{ operation: string, path: string }} meta
 */
export function normalizeClientFsFulfill(fulfill, meta) {
  const body = fulfill && typeof fulfill === 'object' ? fulfill : {};
  const operation = String(meta.operation || body.operation || 'read');
  const path = String(meta.path || body.path || '');
  const ok = body.ok !== false && !body.error;
  if (!ok) {
    return {
      ok: false,
      success: false,
      error: String(body.error || 'client_fs_failed'),
      lane: 'client_fs',
      operation,
      path,
      root_name: body.root_name != null ? String(body.root_name) : undefined,
      hint: body.hint != null ? String(body.hint) : undefined,
      body,
    };
  }

  if (operation === 'list') {
    return {
      ok: true,
      success: true,
      lane: 'client_fs',
      operation: 'list',
      path,
      root_name: body.root_name != null ? String(body.root_name) : undefined,
      entries: Array.isArray(body.entries) ? body.entries : [],
      body,
    };
  }

  if (operation === 'search') {
    const hits = Array.isArray(body.hits) ? body.hits : Array.isArray(body.matches) ? body.matches : [];
    return {
      ok: true,
      success: true,
      lane: 'client_fs',
      operation: 'search',
      path,
      root_name: body.root_name != null ? String(body.root_name) : undefined,
      hits,
      matches: hits,
      count: hits.length,
      body,
    };
  }

  if (operation === 'write') {
    return {
      ok: true,
      success: true,
      lane: 'client_fs',
      operation: 'write',
      path,
      root_name: body.root_name != null ? String(body.root_name) : undefined,
      bytes_written:
        body.bytes != null
          ? Number(body.bytes)
          : body.content != null
            ? String(body.content).length
            : undefined,
      body,
    };
  }

  return {
    ok: true,
    success: true,
    lane: 'client_fs',
    operation: 'read',
    path,
    root_name: body.root_name != null ? String(body.root_name) : undefined,
    content: body.content != null ? String(body.content) : '',
    truncated: body.truncated === true,
    size: body.size != null ? Number(body.size) : undefined,
    body,
  };
}

/**
 * Base call id from runContext + optional suffix for multi-park ops (edit read/write).
 * @param {Record<string, unknown>} runContext
 * @param {string} [suffix]
 */
export function clientFsCallId(runContext, suffix = '') {
  const base = String(runContext?.toolCallId || runContext?.tool_call_id || '').trim();
  if (!base) return '';
  const s = String(suffix || '').trim();
  // Unique park key — parallel tool calls + edit read/write must not collide on DO fsa_fulfill.
  const uniq = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return s ? `${base}:${s}:${uniq}` : `${base}:${uniq}`;
}
