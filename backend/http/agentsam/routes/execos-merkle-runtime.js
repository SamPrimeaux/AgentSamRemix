/**
 * ExecOS local filesystem walk / stat / hash_many / git_status (Slice 3).
 * Containment under approved workspace_root — never arbitrary absolute paths from the model.
 */

import { runExecOsCommand } from '../../../../src/core/execos-fabric.js';
import {
  loadWorkspaceRootFromSettings,
  loadWorkspaceSettingsJson,
} from '../../../agentsam/terminal/pty-workspace-paths.js';
import {
  gcpRemoteExecCwd,
  isForeignDesktopAbsolutePath,
} from '../../../agentsam/terminal/host-workspace-paths.js';
import { buildFsMerkleSnapshot } from '../../../../src/core/fs-merkle-snapshot.js';
import { persistFsMerkleSnapshot } from '../../../../src/core/fs-merkle-persist.js';

const DEFAULT_LIMITS = Object.freeze({
  max_files: 20_000,
  max_total_bytes: 512 * 1024 * 1024,
  max_single_file_bytes: 32 * 1024 * 1024,
  max_depth: 32,
  timeout_ms: 90_000,
  hop_timeout_ms: 12_000,
});

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/** Model often passes root_id = workspace_id — that is not a filesystem path. */
function looksLikeWorkspaceId(v) {
  const s = trim(v);
  return /^ws_[a-z0-9_]+$/i.test(s);
}

/**
 * Resolve and validate root → absolute workspace root + ExecOS target.
 * Never use Mac /Users paths as cwd on target=gcp (that produced execos_fs_invalid_json).
 *
 * @param {any} env
 * @param {{
 *   workspaceId: string,
 *   rootId?: string|null,
 *   root_id?: string|null,
 *   target?: string|null,
 * }} input
 * @returns {Promise<{ root: string, target: string, root_source: string }>}
 */
export async function resolveApprovedFsRoot(env, input = {}) {
  const wid = trim(input.workspaceId);
  if (!wid) throw new Error('fs_root_workspace_required');

  const settings = await loadWorkspaceSettingsJson(env, wid);
  const fromSettings = trim(
    (settings && typeof settings.workspace_root === 'string' && settings.workspace_root) ||
      (await loadWorkspaceRootFromSettings(env, wid)),
  );

  const rawRootHint = trim(input.rootId) || trim(input.root_id);
  // Prefer real absolute path; ignore ws_* / non-absolute model mistakes.
  let root = '';
  let root_source = 'none';
  if (rawRootHint && rawRootHint.startsWith('/') && !looksLikeWorkspaceId(rawRootHint)) {
    root = rawRootHint;
    root_source = 'root_id';
  } else if (fromSettings) {
    root = fromSettings;
    root_source = 'workspace_settings.workspace_root';
  }
  if (!root) throw new Error('fs_root_unresolved');
  if (root.includes('\0') || root.includes('..')) throw new Error('fs_root_traversal_rejected');
  if (!root.startsWith('/')) throw new Error('fs_root_absolute_required');

  const requestedTarget = trim(input.target).toLowerCase();
  let target = requestedTarget || '';
  if (!target) {
    // Desk Mac path → local ExecOS / localpty. GCP path → gcp.
    target = isForeignDesktopAbsolutePath(root) ? 'local' : 'gcp';
  }

  if (target === 'gcp' && isForeignDesktopAbsolutePath(root)) {
    const { resolveIdentityScopedGcpCwd } = await import('../../../../src/core/identity-scoped-gcp-cwd.js');
    const scoped = await resolveIdentityScopedGcpCwd({
      userId: input.userId,
      tenantId: input.tenantId,
      workspaceId: wid,
      settings,
      env,
    });
    if (!scoped.ok) {
      throw new Error(scoped.error || 'fs_root_gcp_path_unresolved');
    }
    root = scoped.cwd;
    root_source = `${root_source}->${scoped.source}`;
  }

  return { root, target, root_source };
}

/**
 * Ensure relative path stays under root (no .. segments).
 */
export function normalizeContainedRelPath(relPath) {
  const raw = trim(relPath).replace(/^\/+/, '');
  if (!raw) return '';
  if (raw.includes('\0') || raw.includes('\\')) throw new Error('fs_path_invalid');
  const parts = raw.split('/');
  if (parts.some((p) => !p || p === '.' || p === '..')) throw new Error('fs_path_traversal_rejected');
  return parts.join('/');
}

async function execJson(env, { root, script, timeout_ms, hop_timeout_ms, target }) {
  const cmd = `node --input-type=module -e ${shellQuote(script)}`;
  const res = await runExecOsCommand(env, {
    command: cmd,
    cwd: root,
    target: target || 'local',
    timeout_ms: timeout_ms || DEFAULT_LIMITS.timeout_ms,
    hop_timeout_ms: hop_timeout_ms || DEFAULT_LIMITS.hop_timeout_ms,
  });
  if (!res.ok && !String(res.stdout || '').trim()) {
    return {
      ok: false,
      error: res.stderr || res.error || 'execos_fs_failed',
      exit_code: res.exit_code,
      resolution: res.resolution,
      cwd: root,
      target: res.target || target,
    };
  }
  const text = String(res.stdout || '').trim();
  const line = text.split('\n').filter(Boolean).at(-1) || '';
  try {
    return {
      ok: true,
      body: JSON.parse(line),
      resolution: res.resolution,
      exit_code: res.exit_code,
      cwd: root,
      target: res.target || target,
    };
  } catch {
    return {
      ok: false,
      error: 'execos_fs_invalid_json',
      detail: text.slice(0, 400),
      stderr: String(res.stderr || '').slice(0, 400),
      resolution: res.resolution,
      exit_code: res.exit_code,
      cwd: root,
      target: res.target || target,
    };
  }
}

/** Walk entries under root with limits. Prefer git ls-files when .git present. */
export async function filesystemWalk(env, input = {}) {
  const { root, target, root_source } = await resolveApprovedFsRoot(env, input);
  const rel = normalizeContainedRelPath(input.path || '');
  const maxFiles = Number(input.max_files) || DEFAULT_LIMITS.max_files;
  const maxDepth = Number(input.max_depth) || DEFAULT_LIMITS.max_depth;
  const cursor = trim(input.cursor);
  const followSymlinks = input.follow_symlinks === true;

  const script = `
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root = process.cwd();
const rel = ${JSON.stringify(rel)};
const maxFiles = ${maxFiles};
const maxDepth = ${maxDepth};
const cursor = ${JSON.stringify(cursor)};
const follow = ${followSymlinks ? 'true' : 'false'};
const start = rel ? path.resolve(root, rel) : root;
if (!start.startsWith(root + path.sep) && start !== root) {
  console.log(JSON.stringify({ error: 'containment_failed' }));
  process.exit(0);
}
function isGitRepo(dir) {
  try { return fs.existsSync(path.join(dir, '.git')); } catch { return false; }
}
const entries = [];
let truncated = false;
if (isGitRepo(root) && !rel) {
  let out = '';
  try {
    out = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
  } catch (e) {
    console.log(JSON.stringify({ error: 'git_ls_files_failed', detail: String(e?.message || e).slice(0, 200) }));
    process.exit(0);
  }
  const files = out.split('\\0').filter(Boolean).sort();
  let started = !cursor;
  for (const f of files) {
    if (!started) { if (f === cursor) started = true; continue; }
    if (entries.length >= maxFiles) { truncated = true; break; }
    const depth = f.split('/').length;
    if (depth > maxDepth) continue;
    entries.push({ path: f, kind: 'file' });
  }
  console.log(JSON.stringify({
    entries,
    truncated,
    cursor: truncated ? entries.at(-1)?.path || null : null,
    mode: 'git_ls_files',
    root,
  }));
  process.exit(0);
}
function walk(dir, prefix, depth) {
  if (truncated || entries.length >= maxFiles) return;
  if (depth > maxDepth) return;
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  names.sort();
  for (const name of names) {
    if (name === '.git' || name === 'node_modules') continue;
    const abs = path.join(dir, name);
    let st;
    try { st = follow ? fs.statSync(abs) : fs.lstatSync(abs); } catch { continue; }
    if (st.isSymbolicLink() && !follow) continue;
    const p = prefix ? prefix + '/' + name : name;
    if (st.isDirectory()) {
      entries.push({ path: p, kind: 'directory' });
      walk(abs, p, depth + 1);
    } else if (st.isFile()) {
      if (entries.length >= maxFiles) { truncated = true; return; }
      entries.push({ path: p, kind: 'file', size: st.size });
    }
  }
}
walk(start, rel, 0);
console.log(JSON.stringify({ entries, truncated, cursor: null, mode: 'walk', root }));
`;

  const walked = await execJson(env, {
    root,
    script,
    timeout_ms: input.timeout_ms,
    hop_timeout_ms: input.hop_timeout_ms,
    target,
  });
  if (!walked.ok) return { ...walked, root_source };
  return { ...walked, root_source, root, target };
}

export async function filesystemStatMany(env, input = {}) {
  const { root, target, root_source } = await resolveApprovedFsRoot(env, input);
  const paths = Array.isArray(input.paths) ? input.paths.map(normalizeContainedRelPath) : [];
  if (!paths.length) return { ok: false, error: 'paths_required' };
  if (paths.length > 500) return { ok: false, error: 'paths_limit_exceeded' };

  const script = `
import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const paths = ${JSON.stringify(paths)};
const follow = ${input.follow_symlinks === true ? 'true' : 'false'};
const out = [];
for (const rel of paths) {
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    out.push({ path: rel, error: 'containment_failed' });
    continue;
  }
  try {
    const st = follow ? fs.statSync(abs) : fs.lstatSync(abs);
    out.push({
      path: rel,
      kind: st.isDirectory() ? 'directory' : st.isFile() ? 'file' : 'other',
      size: st.size,
      mtime_ms: st.mtimeMs,
      mode: st.mode,
      is_symlink: st.isSymbolicLink?.() === true,
    });
  } catch (e) {
    out.push({ path: rel, error: 'stat_failed', detail: String(e?.message || e).slice(0, 120) });
  }
}
console.log(JSON.stringify({ entries: out }));
`;
  const out = await execJson(env, {
    root,
    script,
    timeout_ms: input.timeout_ms,
    hop_timeout_ms: input.hop_timeout_ms,
    target,
  });
  if (!out.ok) return { ...out, root_source };
  return { ...out, root_source, root, target };
}

/**
 * Hash many paths. content_mode: raw_bytes | git_blob (→ git_blob_sha1 via git hash-object).
 */
export async function filesystemHashMany(env, input = {}) {
  const { root, target, root_source } = await resolveApprovedFsRoot(env, input);
  const paths = Array.isArray(input.paths) ? input.paths.map(normalizeContainedRelPath) : [];
  if (!paths.length) return { ok: false, error: 'paths_required' };
  if (paths.length > 500) return { ok: false, error: 'paths_limit_exceeded' };
  const contentMode = trim(input.content_mode) || 'git_blob';
  const maxSingle = Number(input.max_single_file_bytes) || DEFAULT_LIMITS.max_single_file_bytes;

  const script = `
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = process.cwd();
const paths = ${JSON.stringify(paths)};
const contentMode = ${JSON.stringify(contentMode)};
const maxSingle = ${maxSingle};
const out = [];
let domain = contentMode === 'git_blob' ? 'git_blob_sha1' : 'raw_sha256';
for (const rel of paths) {
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    out.push({ path: rel, error: 'containment_failed' });
    continue;
  }
  try {
    const st = fs.statSync(abs);
    if (!st.isFile()) { out.push({ path: rel, error: 'not_a_file' }); continue; }
    if (st.size > maxSingle) { out.push({ path: rel, error: 'file_too_large', size: st.size }); continue; }
    if (contentMode === 'git_blob') {
      const sha = execFileSync('git', ['hash-object', abs], { cwd: root }).toString('utf8').trim().toLowerCase();
      out.push({ path: rel, hash: sha, domain: 'git_blob_sha1', size: st.size });
    } else {
      const buf = fs.readFileSync(abs);
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      out.push({ path: rel, hash, domain: 'raw_sha256', size: st.size });
    }
  } catch (e) {
    out.push({ path: rel, error: 'hash_failed', detail: String(e?.message || e).slice(0, 120) });
  }
}
console.log(JSON.stringify({ entries: out, leaf_hash_domain: domain, content_mode: contentMode }));
`;
  const hashed = await execJson(env, {
    root,
    script,
    timeout_ms: input.timeout_ms,
    hop_timeout_ms: input.hop_timeout_ms,
    target,
  });
  if (!hashed.ok) return { ...hashed, root_source };
  return { ...hashed, root_source, root, target };
}

/** Structured git status for Changes when source=local. */
export async function filesystemGitStatus(env, input = {}) {
  const { root, target, root_source } = await resolveApprovedFsRoot(env, input);
  const script = `
import { execFileSync } from 'node:child_process';
const root = process.cwd();
let porcelain = '';
let branch = null;
let commit = null;
try {
  porcelain = execFileSync('git', ['status', '--porcelain=v1', '-uall'], { cwd: root, maxBuffer: 16 * 1024 * 1024 }).toString('utf8');
  branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root }).toString('utf8').trim();
  commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString('utf8').trim().toLowerCase();
} catch (e) {
  console.log(JSON.stringify({ error: 'git_status_failed', detail: String(e?.message || e).slice(0, 200) }));
  process.exit(0);
}
const staged = [];
const unstaged = [];
const untracked = [];
for (const line of porcelain.split('\\n')) {
  if (!line) continue;
  const xy = line.slice(0, 2);
  const pathPart = line.slice(3);
  const path = pathPart.includes(' -> ') ? pathPart.split(' -> ').at(-1) : pathPart;
  if (xy === '??') { untracked.push({ path, state: 'untracked' }); continue; }
  const x = xy[0];
  const y = xy[1];
  if (x && x !== ' ' && x !== '?') staged.push({ path, state: x === 'A' ? 'added' : x === 'D' ? 'deleted' : x === 'R' ? 'renamed' : 'modified', code: x });
  if (y && y !== ' ' && y !== '?') unstaged.push({ path, state: y === 'D' ? 'deleted' : 'modified', code: y });
}
console.log(JSON.stringify({
  ok: true,
  root,
  branch,
  resolved_commit_sha: commit,
  staged,
  unstaged,
  untracked,
  source: 'execos_git_status',
}));
`;
  const status = await execJson(env, {
    root,
    script,
    timeout_ms: input.timeout_ms,
    hop_timeout_ms: input.hop_timeout_ms,
    target,
  });
  if (!status.ok) return { ...status, root_source };
  return { ...status, root_source, root, target };
}

/**
 * Build Merkle snapshot from ExecOS git checkout (git_blob_sha1 leaves).
 */
export async function merkleBuildExecOsGit(env, input = {}) {
  const resolved = await resolveApprovedFsRoot(env, input);
  const walk = await filesystemWalk(env, {
    ...input,
    rootId: resolved.root,
    target: resolved.target,
  });
  if (!walk.ok) return walk;
  const files = (walk.body?.entries || []).filter((e) => e.kind === 'file').map((e) => e.path);
  if (!files.length) return { ok: false, error: 'no_files' };

  const hashes = await filesystemHashMany(env, {
    ...input,
    rootId: resolved.root,
    target: resolved.target,
    paths: files,
    content_mode: 'git_blob',
  });
  if (!hashes.ok) return hashes;
  const entries = [];
  for (const row of hashes.body?.entries || []) {
    if (row.error || !row.hash) continue;
    entries.push({ kind: 'file', path: row.path, trustedGitBlobSha: row.hash });
  }
  if (!entries.length) return { ok: false, error: 'hash_empty' };

  let commitSha = null;
  const gitStatus = await filesystemGitStatus(env, {
    ...input,
    rootId: resolved.root,
    target: resolved.target,
  });
  if (gitStatus.ok) commitSha = gitStatus.body?.resolved_commit_sha || null;

  const snapshot = await buildFsMerkleSnapshot({
    reference: commitSha || 'HEAD',
    entries,
    leafHashDomain: 'git_blob_sha1',
  });

  if (input.persist === false) {
    return {
      ok: true,
      root_hash: snapshot.rootHash,
      leaf_hash_domain: 'git_blob_sha1',
      resolved_commit_sha: commitSha,
      entry_count: entries.length,
      root: resolved.root,
      target: resolved.target,
      root_source: resolved.root_source,
      snapshot,
    };
  }

  const saved = await persistFsMerkleSnapshot(env, {
    workspaceId: trim(input.workspaceId),
    source: 'execos',
    snapshot,
    resolvedCommitSha: commitSha,
    repository: input.repository || null,
  });
  return {
    ok: true,
    snapshot_id: saved.snapshot_id,
    root_hash: saved.root_hash,
    leaf_hash_domain: 'git_blob_sha1',
    resolved_commit_sha: commitSha,
    entry_count: entries.length,
    root: resolved.root,
    target: resolved.target,
    root_source: resolved.root_source,
  };
}
