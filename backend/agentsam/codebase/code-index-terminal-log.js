/**
 * Durable terminal receipts for sam.codebaseindex.index.run.
 * Writes agentsam_error_log (debug/triage) + agentsam_gate_runs (ok + rounds_json).
 * Call on completed / failed / cancelled — never rely on last_error alone.
 */

import { writeAgentsamErrorLog } from '../../telemetry/error-log.js';

export const CODE_INDEX_GATE_KEY = 'sam.codebaseindex.index.run';
export const CODE_INDEX_ERROR_SOURCE = 'codebase_full_index';

/**
 * @param {any} env
 * @param {string|null|undefined} workspaceId
 * @returns {Promise<string|null>}
 */
async function resolveTenantIdForWorkspace(env, workspaceId) {
  const wid = workspaceId != null ? String(workspaceId).trim() : '';
  if (!env?.DB || !wid) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT COALESCE(tenant_id, owner_tenant_id, default_tenant_id) AS tid
         FROM agentsam_workspace WHERE id = ? LIMIT 1`,
    )
      .bind(wid)
      .first();
    const tid = row?.tid != null ? String(row.tid).trim() : '';
    return tid || null;
  } catch {
    return null;
  }
}

/**
 * @param {any} env
 * @param {{
 *   outcome: 'completed' | 'failed' | 'cancelled',
 *   jobId: string,
 *   workspaceId: string,
 *   tenantId?: string|null,
 *   repo?: string|null,
 *   revisionSha?: string|null,
 *   stage?: string|null,
 *   error?: string|null,
 *   verify?: Record<string, unknown>|null,
 *   context?: Record<string, unknown>|null,
 *   stack?: string|null,
 * }} input
 * @returns {Promise<{ ok: boolean, error_log_id?: string|null, gate_run_id?: string|null, error?: string }>}
 */
export async function recordCodeIndexTerminalOutcome(env, input) {
  if (!env?.DB) return { ok: false, error: 'no_db' };
  const outcome = String(input?.outcome || '').trim();
  if (!['completed', 'failed', 'cancelled'].includes(outcome)) {
    return { ok: false, error: 'invalid_outcome' };
  }
  const jobId = input?.jobId != null ? String(input.jobId).trim() : '';
  const workspaceId = input?.workspaceId != null ? String(input.workspaceId).trim() : '';
  if (!jobId || !workspaceId) return { ok: false, error: 'job_id_and_workspace_required' };

  const tenantId =
    (input?.tenantId != null ? String(input.tenantId).trim() : '') ||
    (await resolveTenantIdForWorkspace(env, workspaceId)) ||
    'unknown';

  const repoFullName =
    input?.repoFullName != null
      ? String(input.repoFullName).trim()
      : input?.repo != null
        ? String(input.repo).trim()
        : null;
  const revisionSha = input?.revisionSha != null ? String(input.revisionSha).trim() : null;
  const stage = input?.stage != null ? String(input.stage).trim() : null;
  const errorMsg = input?.error != null ? String(input.error).trim() : '';
  const stackTrace = input?.stack != null ? String(input.stack).slice(0, 12000) : null;

  const context = {
    pipeline: CODE_INDEX_GATE_KEY,
    outcome,
    run_id: jobId,
    workspace_id: workspaceId,
    repo_full_name: repoFullName || null,
    // Legacy context key — GitHub owner/name only, not a local path.
    repo: repoFullName || null,
    revision_sha: revisionSha || null,
    stage: stage || null,
    error: errorMsg || null,
    verify: input?.verify && typeof input.verify === 'object' ? input.verify : null,
    ...(input?.context && typeof input.context === 'object' ? input.context : {}),
    at: new Date().toISOString(),
  };

  const errorType =
    outcome === 'completed'
      ? 'code_index_completed'
      : outcome === 'cancelled'
        ? 'code_index_cancelled'
        : stage === 'verify_failed' || /symbol_count_mismatch|verify/i.test(errorMsg)
          ? 'code_index_verify_failed'
          : 'code_index_failed';

  const errorMessage =
    outcome === 'completed'
      ? `code index completed run_id=${jobId}${repo ? ` repo=${repo}` : ''}`
      : outcome === 'cancelled'
        ? `code index cancelled run_id=${jobId}${errorMsg ? `: ${errorMsg}` : ''}`
        : `code index failed run_id=${jobId}: ${errorMsg || 'unknown_failure'}`;

  let errorLogId = null;
  const written = await writeAgentsamErrorLog(env, {
    workspaceId,
    tenantId,
    sessionId: jobId,
    errorCode: outcome,
    errorType,
    errorMessage: errorMessage.slice(0, 8000),
    source: CODE_INDEX_ERROR_SOURCE,
    sourceId: jobId,
    contextJson: JSON.stringify(context),
    stackTrace,
    resolved: outcome === 'completed' ? 1 : 0,
  });
  if (written.ok) errorLogId = written.id || null;

  let gateRunId = null;
  try {
    gateRunId = `gr_cidx_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    await env.DB.prepare(
      `INSERT INTO agentsam_gate_runs (
         id, gate_key, ticket_id, git_sha, ok, rounds_json, receipt_path, created_at
       ) VALUES (?, ?, NULL, ?, ?, ?, ?, unixepoch())`,
    )
      .bind(
        gateRunId,
        CODE_INDEX_GATE_KEY,
        revisionSha && /^[a-f0-9]{40}$/i.test(revisionSha) ? revisionSha : null,
        outcome === 'completed' ? 1 : 0,
        JSON.stringify({
          ...context,
          error_log_id: errorLogId,
        }).slice(0, 100000),
        `d1:agentsam_code_index_job:${jobId}`,
      )
      .run();
  } catch (e) {
    console.warn('[code-index-terminal-log] gate_runs', e?.message ?? e);
    gateRunId = null;
  }

  return {
    ok: Boolean(errorLogId || gateRunId),
    error_log_id: errorLogId,
    gate_run_id: gateRunId,
  };
}
