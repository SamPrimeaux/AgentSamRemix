/**
 * GitHub push → sam.codebaseindex helpers (mode pick / enqueue gate).
 *
 * LOCKED (2026-08): push webhooks do NOT enqueue index runs. Start / Continue /
 * Stop are project-rail buttons only — see enqueueCodeIndexFromGithubPush.
 *
 * Baseline lookup SSOT: deploy-code-index-queue.findActivatedCodeIndexBaseline
 * (do not reintroduce a second findActivatedCodeIndexBaseline here).
 */
import { normalizeGithubRepoFullName } from './project-github-repo.js';
import { extractActivatedRevisionSha, normalizeFullGitSha } from './codebase-full-index.js';
import { findActivatedCodeIndexBaseline } from './deploy-code-index-queue.js';

/** When false, push webhooks never queue spend. Flip only with explicit product decision. */
export const GITHUB_PUSH_CODE_INDEX_ENABLED = false;

/**
 * I4 product decision for push / mode-picking callers.
 * @param {{ hasActivatedBaseline: boolean, revisionSha?: string|null }} input
 * @returns {'incremental'|'full'}
 */
export function pickPushReindexMode(input) {
  const sha = input?.revisionSha != null ? String(input.revisionSha).trim() : '';
  if (input?.hasActivatedBaseline && /^[a-f0-9]{40}$/i.test(sha)) {
    return 'incremental';
  }
  return 'full';
}

/**
 * Thin summary parser for tests / diagnostics. Live baseline resolution uses
 * findActivatedCodeIndexBaseline (extractActivatedRevisionSha under the hood).
 * @param {string|null|undefined} symbolSummary
 * @returns {{ activated: boolean, revisionSha: string|null }}
 */
export function parseActivatedBaseline(symbolSummary) {
  try {
    const s = JSON.parse(String(symbolSummary || '{}'));
    const activated = s?.activated === true || String(s?.stage || '') === 'active';
    const sha = normalizeFullGitSha(extractActivatedRevisionSha(s));
    return {
      activated: Boolean(activated),
      revisionSha: sha,
    };
  } catch {
    return { activated: false, revisionSha: null };
  }
}

/**
 * Resolve workspace ids bound to a GitHub repo (agentsam_workspace + projects metadata).
 * @param {any} env
 * @param {string} repoFullName
 * @returns {Promise<string[]>}
 */
export async function resolveWorkspacesForGithubRepo(env, repoFullName) {
  const repo = normalizeGithubRepoFullName(repoFullName);
  if (!env?.DB || !repo) return [];
  const ids = new Set();

  const aw = await env.DB.prepare(
    `SELECT id FROM agentsam_workspace
      WHERE status = 'active'
        AND (
          lower(trim(github_repo)) = lower(?)
          OR lower(replace(replace(replace(trim(github_repo), 'https://github.com/', ''), 'http://github.com/', ''), '.git', '')) = lower(?)
        )
      LIMIT 20`,
  )
    .bind(repo, repo)
    .all()
    .catch(() => ({ results: [] }));
  for (const row of aw?.results || []) {
    if (row?.id) ids.add(String(row.id).trim());
  }

  const ws = await env.DB.prepare(
    `SELECT id FROM workspaces
      WHERE lower(trim(github_repo)) = lower(?)
      LIMIT 20`,
  )
    .bind(repo)
    .all()
    .catch(() => ({ results: [] }));
  for (const row of ws?.results || []) {
    if (row?.id) ids.add(String(row.id).trim());
  }

  const projects = await env.DB.prepare(
    `SELECT workspace_id, metadata_json FROM projects
      WHERE json_extract(metadata_json, '$.github_repo') = ?
         OR json_extract(metadata_json, '$.git_repo') = ?
         OR json_extract(metadata_json, '$.githubRepo') = ?
      LIMIT 40`,
  )
    .bind(repo, repo, repo)
    .all()
    .catch(() => ({ results: [] }));
  for (const row of projects?.results || []) {
    if (row?.workspace_id) ids.add(String(row.workspace_id).trim());
  }

  return [...ids].filter(Boolean);
}

/**
 * @param {any} env
 * @param {{
 *   repoFullName: string,
 *   branch?: string|null,
 *   commitSha?: string|null,
 *   webhookEventId?: string|null,
 *   workspaceId?: string|null,
 * }} opts
 */
export async function enqueueCodeIndexFromGithubPush(env, opts = {}) {
  const repo = normalizeGithubRepoFullName(opts.repoFullName);
  if (!repo) {
    return { ok: false, error: 'repo_full_name_required' };
  }
  const branch =
    opts.branch != null && String(opts.branch).trim() ? String(opts.branch).trim() : null;

  // Buttons-only: never auto-spend on push. Audit stamp still records the skip.
  if (!GITHUB_PUSH_CODE_INDEX_ENABLED) {
    const webhookEventId =
      opts.webhookEventId != null ? String(opts.webhookEventId).trim() : '';
    if (webhookEventId && env?.DB) {
      try {
        const { patchAgentsamWebhookEventMetadata } = await import('./webhook-events-writer.js');
        await patchAgentsamWebhookEventMetadata(env, webhookEventId, {
          code_index_enqueued: 0,
          code_index_skipped: 'buttons_only_no_push_enqueue',
        });
      } catch (e) {
        console.warn('[github-push-code-index] webhook meta skip', e?.message ?? e);
      }
    }
    return {
      ok: true,
      skipped: true,
      reason: 'buttons_only_no_push_enqueue',
      repo_full_name: repo,
      branch,
      results: [],
    };
  }

  const { queueFullCodeIndexRun } = await import('./deploy-code-index-queue.js');
  const workspaceIds = opts.workspaceId
    ? [String(opts.workspaceId).trim()].filter(Boolean)
    : await resolveWorkspacesForGithubRepo(env, repo);
  if (!workspaceIds.length) {
    return { ok: true, skipped: true, reason: 'no_bound_workspace', repo_full_name: repo };
  }

  const results = [];
  for (const workspaceId of workspaceIds) {
    const baseline = await findActivatedCodeIndexBaseline(env, workspaceId, repo);
    const revisionSha = baseline?.revision_sha || null;
    const mode = pickPushReindexMode({
      hasActivatedBaseline: Boolean(revisionSha),
      revisionSha,
    });
    const queued = await queueFullCodeIndexRun(env, {
      workspaceId,
      repoFullName: repo,
      branch: branch || undefined,
      mode,
      triggeredBy: 'github_push_webhook',
    });
    results.push({
      workspace_id: workspaceId,
      mode,
      baseline_job_id: baseline?.job_id || null,
      baseline_revision_sha: revisionSha,
      ...queued,
    });
  }

  // Stamp webhook audit row with first durable run_id when available.
  const webhookEventId =
    opts.webhookEventId != null ? String(opts.webhookEventId).trim() : '';
  const firstRun = results.find((r) => r?.run_id);
  if (webhookEventId && firstRun?.run_id && env?.DB) {
    try {
      const { patchAgentsamWebhookEventMetadata } = await import('./webhook-events-writer.js');
      await patchAgentsamWebhookEventMetadata(env, webhookEventId, {
        code_index_run_id: String(firstRun.run_id),
        code_index_mode: String(firstRun.mode || ''),
        code_index_enqueued: 1,
      });
    } catch (e) {
      console.warn('[github-push-code-index] webhook meta', e?.message ?? e);
    }
  }

  return {
    ok: true,
    repo_full_name: repo,
    branch,
    enqueued: results.filter((r) => r.ok && (r.queued || r.skipped)).length,
    results,
  };
}
