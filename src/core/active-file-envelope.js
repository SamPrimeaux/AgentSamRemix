/**
 * Active file envelope — UI Monaco/GitHub/R2/Drive fields → agent context + tool defaults.
 */

function pickFirst(...vals) {
  for (const v of vals) {
    const s = v != null ? String(v).trim() : '';
    if (s) return s;
  }
  return '';
}

/** Extensions that must never autoroute to image generation when open in the editor. */
export const CODE_LIKE_ACTIVE_FILE_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.css',
  '.html',
  '.json',
  '.md',
  '.sql',
  '.py',
]);

/**
 * @param {unknown} path
 */
export function activeFilePathLooksLikeCode(path) {
  const p = String(path || '')
    .toLowerCase()
    .split('?')[0]
    .split('#')[0];
  const dot = p.lastIndexOf('.');
  if (dot < 0) return false;
  return CODE_LIKE_ACTIVE_FILE_EXTENSIONS.has(p.slice(dot));
}

/**
 * Hard block: open code/config buffer → no image-generation lane or tools this turn.
 * @param {ReturnType<typeof parseActiveFileEnvelope>|null|undefined} envelope
 */
export function activeFileBlocksImageGeneration(envelope) {
  if (!envelope) return false;
  const path =
    envelope.path || envelope.github_path || envelope.workspace_path || envelope.raw_path || '';
  return activeFilePathLooksLikeCode(path);
}

/**
 * @param {unknown} body
 */
export function parseActiveFileEnvelope(body) {
  const b = body && typeof body === 'object' ? /** @type {Record<string, unknown>} */ (body) : {};
  const source = pickFirst(b.active_file_source, b.activeFileSource).toLowerCase();
  const r2Bucket = pickFirst(b.active_file_r2_bucket, b.r2_bucket);
  const r2Key = pickFirst(b.active_file_r2_key, b.r2_key);
  const githubRepo = pickFirst(b.active_file_github_repo, b.github_repo);
  const githubPath = pickFirst(b.active_file_github_path, b.github_path);
  const githubBranch = pickFirst(b.active_file_github_branch, b.github_branch);
  const githubSha = pickFirst(b.active_file_github_sha, b.github_sha);
  const driveFileId = pickFirst(b.active_file_drive_id, b.drive_file_id);
  const workspacePath = pickFirst(b.active_file_workspace_path, b.workspace_path, b.active_file_path, b.path);
  const rawPath = pickFirst(b.active_file_path, b.path);
  const content = pickFirst(b.active_file_content, b.activeFileContent);

  const has = source || r2Key || githubPath || driveFileId || workspacePath || rawPath;
  if (!has) return null;

  return {
    source: source || 'unknown',
    path: workspacePath || githubPath || r2Key || rawPath,
    content: content || null,
    r2_bucket: r2Bucket || null,
    r2_key: r2Key || null,
    github_repo: githubRepo || null,
    github_path: githubPath || null,
    github_branch: githubBranch || null,
    github_sha: githubSha || null,
    drive_file_id: driveFileId || null,
    workspace_path: workspacePath || null,
    raw_path: rawPath || null,
  };
}

/**
 * @param {unknown} v
 */
function pick(v) {
  const s = v != null ? String(v).trim() : '';
  return s || null;
}

/**
 * @param {ReturnType<typeof parseActiveFileEnvelope>} envelope
 */
/**
 * User message only — strip dashboard-injected blocks before intent heuristics.
 * Ignores on-demand context ("save", "r2_write", "github_file", etc.) and active-file envelope.
 * @param {unknown} message
 */
export function stripUserTextForIntent(message) {
  let raw = String(message || '').split(/\r?\n\r?\n--- On-demand context/i)[0] ?? '';
  const idx = raw.indexOf('[Active file envelope');
  if (idx >= 0) raw = raw.slice(0, idx);
  return raw.trim();
}

/** @deprecated Prefer stripUserTextForIntent — same implementation. */
export function stripActiveFileEnvelopeForIntent(message) {
  return stripUserTextForIntent(message);
}

/**
 * True only when the user explicitly refers to the editor's active buffer.
 * Opening a file alone must not pre-dump it into every prompt.
 * @param {unknown} message
 */
export function messageReferencesActiveFile(message) {
  const text = stripUserTextForIntent(message);
  if (!text) return false;
  return (
    /\b(?:this|that|the|current|active|open|opened|selected)\s+(?:file|document|code|buffer)\b/i.test(text) ||
    /\b(?:file|document|code|buffer)\s+(?:that\s+)?(?:is\s+)?(?:currently\s+)?open\b/i.test(text) ||
    (/\b(?:monaco|editor)\b/i.test(text) &&
      /\b(?:file|buffer|tab|open|opened|active|selected)\b/i.test(text))
  );
}

/**
 * Pull editor buffer text from dashboard on-demand context when FormData omits active_file_content.
 * @param {unknown} message
 */
/**
 * True when the open buffer is bound to a specific GitHub path (not just a selected repo pill).
 * @param {ReturnType<typeof parseActiveFileEnvelope>|null|undefined} envelope
 */
export function activeFileIsGithubBound(envelope) {
  return !!(envelope?.github_repo && envelope?.github_path);
}

/**
 * Local IDE buffer (workspace path) without GitHub/R2 binding.
 * @param {ReturnType<typeof parseActiveFileEnvelope>|null|undefined} envelope
 */
export function activeFileIsLocalWorkspaceBuffer(envelope) {
  if (!envelope?.workspace_path) return false;
  if (activeFileIsGithubBound(envelope)) return false;
  if (envelope.r2_key) return false;
  const src = String(envelope.source || '').toLowerCase();
  return src === 'local' || src === 'buffer' || src === 'unknown';
}

/**
 * Canonical display path for an open editor buffer (GitHub owner/repo/path when bound).
 * @param {ReturnType<typeof parseActiveFileEnvelope>|null|undefined} envelope
 */
export function activeFileDisplayPath(envelope) {
  if (!envelope) return '(none)';
  if (envelope.github_repo && envelope.github_path) {
    return `${envelope.github_repo}/${envelope.github_path}`;
  }
  return envelope.path || envelope.github_path || envelope.workspace_path || envelope.r2_key || '(none)';
}

/**
 * Tool-call defaults from the active editor envelope (GitHub repo/path, R2 bucket/key).
 * When github-bound, envelope path/repo/branch override model guesses (Context Envelope v1).
 * @param {string} toolName
 * @param {Record<string, unknown>} toolInput
 * @param {ReturnType<typeof parseActiveFileEnvelope>|null|undefined} envelope
 */
export function applyActiveFileDefaultsToToolInput(toolName, toolInput, envelope) {
  if (!envelope || !toolInput || typeof toolInput !== 'object') return toolInput;
  const out = { ...toolInput };
  const n = String(toolName || '').toLowerCase();
  const isGithubTool =
    n.startsWith('github_') || n === 'github_file' || n.startsWith('agentsam_github_');
  if (isGithubTool) {
    if (!activeFileIsGithubBound(envelope)) return out;
    if (!out.repo && envelope.github_repo) out.repo = envelope.github_repo;
    if (envelope.github_path) {
      out.path = envelope.github_path;
      delete out.file_path;
    } else if (!out.path && !out.file_path && envelope.github_path) {
      out.path = envelope.github_path;
    }
    // read_many expects `files`, not a single path — seed from envelope when omitted.
    const isBatch =
      n.includes('read_many') || n.includes('batch_read');
    if (isBatch && envelope.github_path) {
      const hasFiles = Array.isArray(out.files) && out.files.length > 0;
      const hasPaths = Array.isArray(out.paths) && out.paths.length > 0;
      if (!hasFiles && !hasPaths) {
        out.files = [envelope.github_path];
      }
    }
    // Never invent main — only fill branch/ref when the envelope actually has one.
    if (envelope.github_branch) {
      if (!out.branch) out.branch = envelope.github_branch;
      if (!out.ref) out.ref = envelope.github_branch;
      if (!out.github_branch) out.github_branch = envelope.github_branch;
    }
  }
  // GitHub-bound buffer → reject local fs_* (use agentsam_github_patch / write / read).
  const isFsTool =
    n === 'fs_write_file' ||
    n === 'fs_read_file' ||
    n === 'fs_edit_file' ||
    n === 'fs_search_files' ||
    n === 'write_file' ||
    n === 'read_file';
  if (isFsTool && activeFileIsGithubBound(envelope)) {
    const repo = envelope.github_repo;
    const path = envelope.github_path;
    let hint;
    if (n.includes('edit')) {
      hint = `Use agentsam_github_patch({ repo:"${repo}", path:"${path}", find:"<exact text>", replace:"<new text>" })`;
    } else if (n.includes('read') || n.includes('search')) {
      hint = `Use agentsam_github_read({ repo:"${repo}", path:"${path}" })`;
    } else {
      hint = `Use agentsam_github_write({ repo:"${repo}", path:"${path}", content:"<full file>" })`;
    }
    return {
      __blocked: true,
      error: 'wrong_tool_for_github_bound_buffer',
      hint,
    };
  }
  if (n.startsWith('r2_') || n.startsWith('agentsam_r2_')) {
    if (!out.bucket && envelope.r2_bucket) out.bucket = envelope.r2_bucket;
    if (!out.key && !out.path && envelope.r2_key) out.key = envelope.r2_key;
  }
  return out;
}

function formatActiveFileToolTargets(envelope) {
  const lines = ['### Tool targets for this buffer'];
  const hasContent = envelope.content != null && String(envelope.content).trim() !== '';
  if (hasContent) {
    lines.push(
      '- The fenced code in this message IS the live Monaco buffer. Answer from it directly — do NOT call github_file to verify unless the user asks to compare with remote.',
    );
  }
  if (activeFileIsGithubBound(envelope)) {
    const branch = envelope.github_branch ? `, ref="${envelope.github_branch}"` : '';
    lines.push(
      `- GitHub read: agentsam_github_read({ repo: "${envelope.github_repo}", path: "${envelope.github_path}"${branch} })`,
      `- GitHub surgical edit: agentsam_github_patch({ repo: "${envelope.github_repo}", path: "${envelope.github_path}", find: "<exact text>", replace: "<new text>"${branch} })`,
      `- GitHub full write: agentsam_github_write({ repo: "${envelope.github_repo}", path: "${envelope.github_path}", content: "<full file>", message: "<commit msg>"${branch} })`,
      `- Do NOT use fs_read_file / fs_write_file / fs_edit_file on this GitHub-bound buffer.`,
    );
  } else if (activeFileIsLocalWorkspaceBuffer(envelope)) {
    lines.push(
      `- Local workspace file: workspace_path="${envelope.workspace_path}". Content is in this message. Persist with fs_write_file / fs_edit_file (client_fs) when Local is connected, or open from GitHub Files and use agentsam_github_write to promote.`,
    );
  }
  if (envelope.r2_key) {
    const b =
      envelope.r2_bucket != null && String(envelope.r2_bucket).trim() !== ''
        ? String(envelope.r2_bucket).trim()
        : '';
    if (b) {
      lines.push(
        `- R2 read: r2_read({ bucket: "${b}", key: "${envelope.r2_key}" })`,
        `- R2 write: r2_write({ bucket: "${b}", key: "${envelope.r2_key}", content: "<full file>" })`,
      );
    } else {
      lines.push(
        `- R2 object key: "${envelope.r2_key}". Use your BYOK bucket from Settings → Storage — do not assume platform bucket names.`,
      );
    }
  }
  if (lines.length === 1) {
    lines.push('- Use fs_read_file / fs_search_files when only a local path is open.');
  }
  return lines.join('\n');
}

export function extractOpenFileContentFromMessage(message) {
  const raw = String(message || '');
  const idx = raw.search(/\r?\n\r?\n--- On-demand context/i);
  if (idx < 0) return null;
  const block = raw.slice(idx);
  const openMatch = block.match(
    /### Open file \(editor\)\n[^\n]+\n\n([\s\S]*?)(?=\n\n### |\r?\n\r?\n---|$)/,
  );
  if (openMatch?.[1]) return openMatch[1].trim();
  const fileMatch = block.match(/### @file\n[^\n]+\n\n([\s\S]*?)(?=\n\n### |\r?\n\r?\n---|$)/);
  if (fileMatch?.[1]) return fileMatch[1].trim();
  return null;
}

export function formatActiveFileForAgent(envelope) {
  if (!envelope) return null;
  const path = activeFileDisplayPath(envelope);
  const meta = [
    `[Active file envelope — locked user/editor selection. Use exact github_path unless the user names another file.]`,
    `source: ${envelope.source}`,
    `path: ${path}`,
  ];
  if (envelope.github_repo && activeFileIsGithubBound(envelope)) meta.push(`github_repo: ${envelope.github_repo}`);
  if (envelope.github_path) meta.push(`github_path: ${envelope.github_path}`);
  if (envelope.github_branch) meta.push(`github_branch: ${envelope.github_branch}`);
  if (envelope.r2_bucket) meta.push(`r2_bucket: ${envelope.r2_bucket}`);
  if (envelope.r2_key) meta.push(`r2_key: ${envelope.r2_key}`);
  if (envelope.workspace_path) meta.push(`workspace_path: ${envelope.workspace_path}`);

  const content = envelope.content != null ? String(envelope.content) : '';
  const parts = [...meta, '', formatActiveFileToolTargets(envelope)];
  if (content.trim()) {
    parts.push('', `Active file: ${path}`, '```', content.slice(0, 48000), '```');
  }
  return parts.join('\n');
}

/**
 * @param {ReturnType<typeof parseActiveFileEnvelope>} envelope
 * @param {Record<string, unknown>} runContext
 */
export function mergeActiveFileIntoRunContext(envelope, runContext = {}) {
  if (!envelope) return runContext;
  return {
    ...runContext,
    activeFile: envelope,
    active_file_envelope: envelope,
  };
}

/**
 * Default fs_search_files path scoped to active file directory when applicable.
 * @param {ReturnType<typeof parseActiveFileEnvelope>} envelope
 */
export function defaultSearchPathFromActiveFile(envelope) {
  // Prefer real workspace paths — never GitHub owner/repo display slugs (rg treats those as missing dirs).
  const local = String(envelope?.workspace_path || '').replace(/\\/g, '/').trim();
  if (local) {
    const idx = local.lastIndexOf('/');
    if (idx > 0) return local.slice(0, idx) || '.';
  }
  const p = String(envelope?.path || envelope?.github_path || '')
    .replace(/\\/g, '/')
    .trim();
  if (!p) return '.';
  if (looksLikeGithubOwnerRepoPath(p)) return '.';
  const idx = p.lastIndexOf('/');
  if (idx <= 0) return '.';
  return p.slice(0, idx) || '.';
}

/** owner/repo or owner/repo/… — not a PTY-relative ./path or absolute path. */
function looksLikeGithubOwnerRepoPath(p) {
  if (!p || p.startsWith('./') || p.startsWith('../') || p.startsWith('/')) return false;
  const parts = p.split('/').filter(Boolean);
  if (parts.length < 2) return false;
  const [owner, repo] = parts;
  return /^[A-Za-z0-9_.-]+$/.test(owner) && /^[A-Za-z0-9_.-]+$/.test(repo);
}
