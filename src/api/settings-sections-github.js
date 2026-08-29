/**
 * Settings section: GitHub (connection status, code-index reindex trigger).
 * - GET  /api/settings/github
 * - POST /api/settings/github/reindex
 * Deconstructed from src/api/settings-sections.js (Sections peel SEC4, no
 * behavior change).
 */
import { jsonResponse } from '../core/auth.js';
import { resolveIntegrationUserId } from '../../backend/identity/oauth/integration-user-id.js';
import { userCanAccessWorkspace } from '../core/workspace-access.js';
import { safeQueryAll, safeFirst, envelope } from './settings-sections-shared.js';

// ─── Section: GitHub ─────────────────────────────────────────────────────────
async function getGithub(env, authUser, workspaceId) {
  const warnings = [];
  const cache = new Map();
  const db = env.DB;
  const userId = (await resolveIntegrationUserId(env, authUser)) || String(authUser?.id || '').trim();
  const wsFilter = workspaceId != null && String(workspaceId).trim() !== '' ? String(workspaceId).trim() : null;

  const connections = await safeQueryAll(
    db,
    'integration_connections',
    `SELECT id, provider, status, account_label, account_identifier, last_verified_at, created_at, updated_at
     FROM integration_connections WHERE user_id = ? AND provider IN ('github','github_app') ORDER BY updated_at DESC LIMIT 20`,
    [userId],
    warnings,
    cache,
  );

  const oauthTokens = await safeQueryAll(
    db,
    'user_oauth_tokens',
    `SELECT provider, account_label, scope, created_at, updated_at, expires_at
     FROM user_oauth_tokens WHERE user_id = ? AND provider IN ('github','github_app') ORDER BY updated_at DESC LIMIT 20`,
    [userId],
    warnings,
    cache,
  );

  const oauthSafe = oauthTokens.map((row) => ({
    provider: row.provider,
    account_label: row.account_label,
    scope: row.scope,
    created_at: row.created_at,
    updated_at: row.updated_at,
    expires_at: row.expires_at,
  }));

  const indexJobSql = wsFilter
    ? `SELECT id, repo_full_name, status, started_at, finished_at, indexed_file_count
       FROM agentsam_code_index_job WHERE user_id = ? AND workspace_id = ?
       ORDER BY COALESCE(finished_at, started_at) DESC LIMIT 10`
    : `SELECT id, repo_full_name, status, started_at, finished_at, indexed_file_count
       FROM agentsam_code_index_job WHERE user_id = ?
       ORDER BY COALESCE(finished_at, started_at) DESC LIMIT 10`;
  const indexJobBinds = wsFilter ? [userId, wsFilter] : [userId];

  const indexJobs = await safeQueryAll(
    db,
    'agentsam_code_index_job',
    indexJobSql,
    indexJobBinds,
    warnings,
    cache,
  );

  const auditLog = await safeQueryAll(
    db,
    'integration_audit_log',
    `SELECT id, provider, action, status, created_at
     FROM integration_audit_log
     WHERE user_id = ? AND provider IN ('github','github_app')
     ORDER BY created_at DESC LIMIT 25`,
    [userId],
    warnings,
    cache,
  );

  const connected = connections.find(
    (c) => String(c.status || '').toLowerCase() === 'connected',
  );
  // OAuth token alone is enough for API repo list + index — do not show NOT CONNECTED
  // when user_oauth_tokens has a live GitHub row (integration_connections can lag).
  const hasOauth = oauthTokens.length > 0;
  const githubLinked = !!connected || hasOauth;
  const provider = {
    provider: 'github',
    status: connected
      ? 'connected'
      : hasOauth
        ? 'connected'
        : connections.length
          ? 'degraded'
          : 'not_connected',
    accountLabel:
      connected?.account_label ||
      oauthTokens[0]?.account_label ||
      connections[0]?.account_label ||
      null,
    resourceLabel: connected?.account_identifier || connections[0]?.account_identifier || null,
    lastCheckedAt:
      connected?.last_verified_at ||
      oauthTokens[0]?.updated_at ||
      connections[0]?.updated_at ||
      null,
    capabilities: ['repo:read', 'codebase:index', 'webhooks:receive'],
    warnings: [],
  };

  return envelope('github', {
    summary: {
      connection_status: provider.status,
      connection_count: connections.length,
      oauth_token_count: oauthTokens.length,
      latest_index_job_status: indexJobs[0]?.status || null,
      latest_index_job_at: indexJobs[0]?.finished_at || indexJobs[0]?.started_at || null,
    },
    rows: connections,
    warnings,
    providers: [provider],
    actions: [
      {
        key: 'connect_github',
        label: githubLinked ? 'Reconnect GitHub' : 'Connect GitHub',
        enabled: true,
      },
      {
        key: 'reindex_codebase',
        label: 'Re-index codebase',
        enabled: githubLinked,
        reasonDisabled: githubLinked
          ? undefined
          : 'Connect GitHub OAuth first, then select a repository below.',
      },
    ],
    extra: {
      oauth_tokens: oauthSafe,
      code_index_jobs: indexJobs,
      audit_log: auditLog,
    },
  });
}

/**
 * POST /api/settings/github/reindex
 * Queue sam.codebaseindex.index.run for any repo the caller selects (repo-agnostic).
 * Body: { repo_full_name, branch?, workspace_id?, mode? }
 */
async function postGithubReindex(request, env, authUser, url, ctx = null) {
  if (!env?.DB) return jsonResponse({ error: 'DB not configured' }, 503);
  const body = await request.json().catch(() => ({}));
  const repoFullName = String(body?.repo_full_name || body?.repo || '').trim();
  if (!repoFullName || !repoFullName.includes('/')) {
    return jsonResponse({ error: 'repo_full_name required (owner/name)' }, 400);
  }
  const branch = String(body?.branch || 'main').trim() || 'main';
  const requestedMode = String(body?.mode || 'full').trim().toLowerCase();
  const mode = requestedMode === 'incremental' ? 'incremental' : 'full';

  let workspaceId =
    body?.workspace_id != null && String(body.workspace_id).trim() !== ''
      ? String(body.workspace_id).trim()
      : url.searchParams.get('workspace_id') != null
        ? String(url.searchParams.get('workspace_id')).trim()
        : '';
  if (!workspaceId) {
    return jsonResponse({ error: 'workspace_id required' }, 400);
  }
  const canAccess = await userCanAccessWorkspace(env, authUser, workspaceId);
  if (!canAccess) return jsonResponse({ error: 'Forbidden' }, 403);

  const userId = (await resolveIntegrationUserId(env, authUser)) || String(authUser?.id || '').trim();
  if (!userId) return jsonResponse({ error: 'auth_required' }, 401);

  // Require a GitHub OAuth/token row for this user — same identity that lists repos.
  const tokenRow = await env.DB.prepare(
    `SELECT provider FROM user_oauth_tokens
      WHERE user_id = ? AND provider IN ('github','github_app')
      LIMIT 1`,
  )
    .bind(userId)
    .first()
    .catch(() => null);
  if (!tokenRow) {
    return jsonResponse(
      { error: 'github_oauth_required', message: 'Connect GitHub OAuth before re-indexing.' },
      400,
    );
  }

  const { queueFullCodeIndexRun } = await import(
    '../../backend/agentsam/codebase/deploy-code-index-queue.js'
  );
  const queued = await queueFullCodeIndexRun(env, {
    workspaceId,
    repoFullName,
    userId: authUser?.id != null ? String(authUser.id) : userId,
    personUuid: authUser?.person_uuid ?? null,
    branch,
    mode,
    triggeredBy:
      mode === 'incremental' ? 'settings_github_incremental_reindex' : 'settings_github_full_reindex',
  });
  if (!queued.ok) {
    const err = queued.error || queued.reason || 'full_reindex_queue_failed';
    return jsonResponse(
      {
        ok: false,
        error: err,
        mode,
        repo_full_name: repoFullName,
        workspace_id: workspaceId,
        pipeline: 'sam.codebaseindex.index.run',
        message: queued.message || null,
      },
      err === 'incremental_requires_activated_baseline' ? 409 : 500,
    );
  }

  if (queued.queue_enqueued !== true) {
  const { pumpFullCodeIndexRun } = await import(
    '../../backend/agentsam/codebase/code-indexer.js'
  );
    const runPromise = pumpFullCodeIndexRun(env, queued.run_id || queued.job_id, {
      maxRounds: 4,
      maxFiles: 8,
      maxSymbols: 24,
      wallBudgetMs: 45_000,
    });
    if (ctx?.waitUntil) {
      ctx.waitUntil(runPromise.catch((error) => console.error('[settings-github-reindex]', error)));
    } else {
      void runPromise.catch((error) => console.error('[settings-github-reindex]', error));
    }
  }

  return jsonResponse(
    {
      ok: true,
      run_id: queued.run_id || queued.job_id,
      job_id: queued.run_id || queued.job_id,
      status: queued.status === 'running' ? 'running' : 'queued',
      stage: 'queued',
      mode: queued.mode || mode,
      pipeline: 'sam.codebaseindex.index.run',
      workspace_id: workspaceId,
      repo_full_name: repoFullName,
      branch,
      base_sha: queued.base_sha || null,
      queue_enqueued: queued.queue_enqueued === true,
      skipped: queued.skipped === true,
      reason: queued.reason || null,
      message:
        (queued.mode || mode) === 'incremental'
          ? queued.queue_enqueued === true
            ? `Incremental compare crawl queued for ${repoFullName}.`
            : `Incremental compare crawl started for ${repoFullName} (queue fallback).`
          : queued.queue_enqueued === true
            ? `Full codebase crawl queued for ${repoFullName}.`
            : `Full codebase crawl started for ${repoFullName} (queue fallback).`,
    },
    202,
  );
}


export { getGithub, postGithubReindex };
