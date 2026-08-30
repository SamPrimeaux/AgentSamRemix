import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// SDK candidate: https://github.com/SamPrimeaux/agentsam-sdk/issues/10
// Target after publish: @inneranimalmedia/agentsam-sdk/src/lib/git-context.js

function runGit(cwd, args, { required = true } = {}) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    if (!required) return '';
    const detail = error?.stderr ? String(error.stderr).trim() : error?.message || String(error);
    throw new Error(`git_context_failed:${args.join(' ')}${detail ? `:${detail}` : ''}`);
  }
}

/**
 * Normalize common Git remotes to host + owner/repository identity.
 * The remote is a resource locator, never authentication proof.
 *
 * @param {string} remoteUrl
 */
export function normalizeGitRemote(remoteUrl) {
  const raw = String(remoteUrl || '').trim();
  if (!raw) {
    return { remoteUrl: '', remoteHost: null, repoFullName: null, owner: null, repo: null };
  }

  let host = null;
  let pathname = '';

  const scpLike = raw.match(/^(?:[^@\s]+@)?([^:\s]+):(.+)$/);
  if (scpLike && !raw.includes('://')) {
    host = scpLike[1];
    pathname = scpLike[2];
  } else {
    try {
      const parsed = new URL(raw);
      host = parsed.hostname || null;
      pathname = parsed.pathname || '';
    } catch {
      pathname = raw;
    }
  }

  const cleanedPath = pathname
    .replace(/^\/+/, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  const parts = cleanedPath.split('/').filter(Boolean);
  const repo = parts.at(-1) || null;
  const owner = parts.length >= 2 ? parts.at(-2) : null;
  const repoFullName = owner && repo ? `${owner}/${repo}` : null;

  return {
    remoteUrl: raw,
    remoteHost: host,
    repoFullName,
    owner,
    repo,
  };
}

/**
 * Resolve the Git repository containing cwd.
 * No user, tenant, or workspace identity is inferred here.
 *
 * @param {{ cwd?: string, remote?: string }} [options]
 */
export function resolveGitContext(options = {}) {
  const cwd = resolve(options.cwd || process.cwd());
  const remote = String(options.remote || 'origin').trim() || 'origin';
  const root = runGit(cwd, ['rev-parse', '--show-toplevel']);
  const remoteUrl = runGit(root, ['remote', 'get-url', remote], { required: false });
  const revisionSha = runGit(root, ['rev-parse', 'HEAD']);
  const branch = runGit(root, ['branch', '--show-current'], { required: false }) || null;
  const status = runGit(root, ['status', '--porcelain=v1'], { required: false });
  const remoteIdentity = normalizeGitRemote(remoteUrl);

  return {
    root,
    remote,
    ...remoteIdentity,
    revisionSha,
    branch,
    detached: !branch,
    dirty: Boolean(status),
  };
}
