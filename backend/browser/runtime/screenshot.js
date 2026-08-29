/**
 * Playwright screenshot job execution (no HTTP Response).
 */
import { handlePlaywrightQueueJob } from './screenshot-queue-job.js';


/**
 * Shared screenshot job runner (POST /api/browser/jobs/screenshot and agent builtin tools).
 * @param {any} env
 * @param {{ url: string, userId: string, workspaceId?: string|null, agentRunId?: string|null, source?: string }} opts
 * @returns {Promise<Record<string, unknown>>}
 */
export async function runPlaywrightScreenshotJob(env, opts) {
  if (!env.MYBROWSER) {
    return {
      error: 'MYBROWSER binding not configured',
      hint: 'Enable Browser Rendering on the Worker',
    };
  }
  if (!env.DB) return { error: 'DB not configured' };

  const targetUrl = String(opts?.url || '').trim();
  const userId = String(opts?.userId || '').trim();
  if (!targetUrl) return { error: 'url required' };
  if (!userId) return { error: 'user_id required' };

  const workspaceId =
    opts.workspaceId != null && String(opts.workspaceId).trim()
      ? String(opts.workspaceId).trim()
      : null;
  const source = opts.source != null ? String(opts.source).trim() : 'agent_tool';
  const agentRunId =
    opts.agentRunId != null && String(opts.agentRunId).trim()
      ? String(opts.agentRunId).trim()
      : null;

  const jobId = crypto.randomUUID();

  try {
    await env.DB.prepare(
      `INSERT INTO playwright_jobs (id, job_type, url, status, metadata, user_id, workspace_id, created_at)
             VALUES (?, 'screenshot', ?, 'pending', ?, ?, ?, datetime('now'))`,
    )
      .bind(
        jobId,
        targetUrl,
        JSON.stringify({
          source,
          ...(agentRunId ? { agent_run_id: agentRunId } : {}),
        }),
        userId,
        workspaceId,
      )
      .run();
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.includes('user_id') || msg.includes('workspace_id')) {
      return {
        error: 'playwright_jobs schema missing user_id',
        detail: msg,
        hint: 'Apply migrations/281_playwright_jobs_user_workspace.sql to D1 (remote)',
      };
    }
    return { error: 'Failed to create browser job', detail: msg };
  }

  await handlePlaywrightQueueJob(env, { jobId, job_type: 'screenshot', url: targetUrl });

  let row = null;
  try {
    row = await env.DB.prepare(
      `SELECT id, url, status, result_url, error, created_at, completed_at FROM playwright_jobs WHERE id = ? LIMIT 1`,
    )
      .bind(jobId)
      .first();
  } catch {
    row = null;
  }

  const st = row?.status ? String(row.status) : 'unknown';
  const resultUrl = row?.result_url != null ? String(row.result_url) : '';
  if (st === 'completed' && resultUrl) {
    return {
      id: jobId,
      status: 'completed',
      result_url: resultUrl,
      screenshot_url: resultUrl,
      url: targetUrl,
    };
  }
  if (st === 'failed') {
    return {
      id: jobId,
      status: 'error',
      error: row?.error != null ? String(row.error) : 'screenshot failed',
    };
  }
  return { id: jobId, status: 'pending', result_url: null, screenshot_url: null, url: targetUrl };
}
