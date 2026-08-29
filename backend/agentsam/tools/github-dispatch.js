// backend/agentsam/tools/github-dispatch.js
/**
 * Agent Sam: GitHub Modular Dispatcher
 * Orchestrates repository operations and agentic code commits.
 * Route: /api/agentsam/github/*
 */
import { jsonResponse } from '../../../src/core/auth.js';
import { handleGitHubApi, githubCommitHandshake } from '../../../src/integrations/github.js';

export async function handleGitHubDispatch(request, env, ctx, authUser) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '') || '/';
  const method = request.method.toUpperCase();

  try {
    // ── Repository listing ────────────────────────────────────────────────────
    if (path.endsWith('/repos') && method === 'GET') {
      return handleGitHubApi(request, env);
    }

    // ── File read/write via Contents API (files ≤1MB) ────────────────────────
    if (path.endsWith('/file')) {
      return handleGitHubApi(request, env);
    }

    // ── Surgical commit via Git Data API ─────────────────────────────────────
    if (path.endsWith('/commit') && method === 'POST') {
      const body = await request.json().catch(() => null);
      if (!body) return jsonResponse({ error: 'Invalid JSON body' }, 400);

      const { repo, branch, path: filePath, content, message, committer } = body;

      const missing = ['repo', 'path', 'content', 'message'].filter((k) => !body[k]);
      if (missing.length) {
        return jsonResponse({ error: `Missing required fields: ${missing.join(', ')}` }, 400);
      }

      const result = await githubCommitHandshake(env, authUser, repo, {
        branch,
        path: filePath,
        content,
        message,
        committer,
      });

      return jsonResponse({
        status: 'committed',
        sha: result.sha,
        url: result.url,
        branch: result.branch,
        auth_mode: result.mode,
        repo,
        path: filePath,
      });
    }

    return jsonResponse({ error: 'GitHub action not found' }, 404);
  } catch (e) {
    console.error('[GitHub Dispatch]', e.message);
    return jsonResponse({ error: 'GitHub dispatcher failed', detail: e.message }, 500);
  }
}
