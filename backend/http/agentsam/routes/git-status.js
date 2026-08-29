/**
 * API Service: Git Status & Source Control
 * Provides git metadata to the dashboard UI.
 */
import { httpJsonResponse as jsonResponse } from '../../responses.js';
import { verifyBridgeKey } from '../../../auth/bridge-key-auth.js';
import { getAuthUser } from '../../../identity/index.js';
import { resolveIamWorkspaceRoot } from '../../../agentsam/terminal/workspace-root.js';
import { runTerminalCommand } from '../../../agentsam/terminal/runtime.js';
import {
  resolveTerminalWorkspaceId,
  WORKSPACE_CONTEXT_MISSING,
  WORKSPACE_ROOT_CONTEXT_MISSING,
} from '../../../identity/bootstrap.js';

/**
 * GET /api/internal/git-status
 * Requires AGENTSAM_BRIDGE_KEY (automation) or authenticated user (workspace-scoped).
 * Returns current branch, staged, and unstaged changes for the resolved workspace root.
 */
export async function handleGitStatusRequest(request, env, ctx) {
  const url = new URL(request.url);
  const internalOk = verifyBridgeKey(request, env);

  let root;
  /** @type {Record<string, unknown>} */
  let executionCtx = {};
  try {
    if (internalOk) {
      const workspaceId = String(url.searchParams.get('workspace_id') || '').trim();
      if (!workspaceId) {
        return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING, code: WORKSPACE_CONTEXT_MISSING }, 400);
      }
      root = await resolveIamWorkspaceRoot(env, { workspaceId });
      executionCtx = { workspace_id: workspaceId };
    } else {
      const authUser = await getAuthUser(request, env);
      if (!authUser) return jsonResponse({ error: 'Unauthorized', code: 'Unauthorized' }, 401);

      const tw = await resolveTerminalWorkspaceId(env, request, authUser, url.searchParams.get('workspace_id'));
      if (tw.error === 'Forbidden') {
        return jsonResponse({ error: 'Forbidden', code: 'Forbidden' }, 403);
      }
      if (tw.error || !tw.workspaceId) {
        return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING, code: WORKSPACE_CONTEXT_MISSING }, 400);
      }
      root = await resolveIamWorkspaceRoot(env, { workspaceId: tw.workspaceId });
      executionCtx = { workspace_id: tw.workspaceId };
    }
  } catch (e) {
    const msg = e?.message || String(e);
    if (msg === WORKSPACE_CONTEXT_MISSING) {
      return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING, code: WORKSPACE_CONTEXT_MISSING }, 400);
    }
    if (msg === WORKSPACE_ROOT_CONTEXT_MISSING) {
      return jsonResponse({ error: WORKSPACE_ROOT_CONTEXT_MISSING, code: WORKSPACE_ROOT_CONTEXT_MISSING }, 400);
    }
    throw e;
  }

  // 1. Get Branch
  const branchCmd = await runTerminalCommand(
    env,
    request,
    `git -C "${root}" branch --show-current`,
    'git_status',
    executionCtx,
  );
  const branch = branchCmd.output.trim() || 'unknown';

  // 2. Get Porcelain Status
  const statusCmd = await runTerminalCommand(
    env,
    request,
    `git -C "${root}" status --porcelain`,
    'git_status',
    executionCtx,
  );
  const lines = statusCmd.output.split('\n').filter((l) => l.trim());

  const staged = [];
  const unstaged = [];

  for (const line of lines) {
    const x = line[0];
    const y = line[1];
    const path = line.slice(3).trim();

    const item = { path, status: line.slice(0, 2).trim() };

    if (x !== ' ' && x !== '?') {
      staged.push(item);
    }
    if (y !== ' ' || x === '?') {
      unstaged.push(item);
    }
  }

  // 3. Get Recent Log
  const logCmd = await runTerminalCommand(
    env,
    request,
    `git -C "${root}" log -n 5 --pretty=format:"%h|%an|%ar|%s"`,
    'git_status',
    executionCtx,
  );
  const commits = logCmd.output
    .split('\n')
    .filter((l) => l.trim())
    .map((c) => {
      const [hash, author, date, msg] = c.split('|');
      return { hash, author, date, msg };
    });

  return jsonResponse({
    branch,
    staged,
    unstaged,
    commits,
    root,
  });
}
