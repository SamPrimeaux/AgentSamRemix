/** GET /api/agent/approval/pending — scoped approval preview. */

import {
  countPendingApprovals,
  findScopedExpiredSpawnJobs,
  findScopedPendingApproval,
} from '../../../agentsam/approvals/lookup.js';
import { jsonResponse, trustedScope } from '../shared.js';

function parseJson(value, fallback = {}) {
  try {
    return JSON.parse(String(value || ''));
  } catch {
    return fallback;
  }
}

function approvalPreview(row) {
  const input = parseJson(row?.input_json);
  let previewCommand = input.command ?? null;
  let previewSql = input.sql ?? null;
  let toolArgs = null;
  const filled = typeof input.filled_template === 'string'
    ? parseJson(input.filled_template, null)
    : input.filled_template && typeof input.filled_template === 'object'
      ? input.filled_template
      : null;
  if (filled && typeof filled === 'object') {
    toolArgs = filled;
    const diff = filled.diff ?? filled.patch ?? filled.unified_diff ?? filled.unifiedDiff ?? filled.diff_text ?? filled.diffText;
    if (diff != null && String(diff).trim()) previewCommand = String(diff).trim();
    if (!previewCommand && !previewSql) {
      const command = filled.command ?? filled.cmd ?? filled.shell_command ?? filled.shell ?? filled.query ?? filled.sql;
      if (command != null && String(command).trim()) previewCommand = String(command).trim();
    }
  }
  let spawnJobId = null;
  if (String(row?.tool_name || '') === 'spawn_lane_extension') {
    const budget = filled && typeof filled === 'object' ? filled : input;
    const total = Number(budget?.total_cost_usd);
    const cap = Number(budget?.cost_cap_usd);
    if (Number.isFinite(total) && Number.isFinite(cap) && cap > 0) {
      previewCommand =
        `Budget: $${total.toFixed(4)} / $${cap.toFixed(4)} (${Math.round((total / cap) * 100)}%)\n` +
        'Approve to extend the job cost cap and resume remaining lanes.\n' +
        'Deny keeps the current cap — remaining lanes resume until the 100% hard-stop.';
    }
    spawnJobId = budget?.spawn_job_id || budget?.spawnJobId || null;
  }
  return {
    ...row,
    queue_count: 1,
    preview_sql: previewSql,
    preview_command: previewCommand,
    tool_args: toolArgs,
    spawn_job_id: spawnJobId,
    decision_expired: false,
  };
}

export async function handlePendingApprovalRoute(request, url, env, ctx, identity) {
  if (request.method.toUpperCase() !== 'GET' || url.pathname.toLowerCase().replace(/\/$/, '') !== '/api/agent/approval/pending') {
    return null;
  }
  const scope = trustedScope(identity);
  if (!scope.authUser) return jsonResponse({ error: 'Unauthorized' }, 401, { 'Cache-Control': 'no-store' });
  const workspaceId = String(url.searchParams.get('workspace_id') || scope.workspaceId || '').trim();
  if (!workspaceId) return jsonResponse({ pending: [] }, 200, { 'Cache-Control': 'no-store' });
  if (!env.DB) return jsonResponse({ approval: null, pending_count: 0 }, 200, { 'Cache-Control': 'no-store' });
  const runId = String(url.searchParams.get('run_id') || '').trim();
  const sessionId = String(url.searchParams.get('session_id') || '').trim();
  const proposalId = String(url.searchParams.get('proposal') || url.searchParams.get('id') || '').trim();
  const routeScope = { ...scope, workspaceId, runId, sessionId: sessionId && !proposalId ? sessionId : '' };
  const pendingCount = await countPendingApprovals(env, routeScope);
  let row = await findScopedPendingApproval(env, { ...routeScope, proposalId });
  if (!row) {
    const jobs = await findScopedExpiredSpawnJobs(env, routeScope);
    for (const job of jobs) {
      const merged = parseJson(job.merged_output);
      if (merged.budget_extension_halted !== true && merged.budget_extension_proposal_expired !== true) continue;
      const sessionKey = String(merged.budget_extension_session_id || '').trim();
      if (sessionId && sessionKey && sessionKey !== sessionId) continue;
      const proposal = String(merged.budget_extension_proposal_id || '').trim();
      if (proposal) {
        const stillPending = await findScopedPendingApproval(env, { ...routeScope, proposalId: proposal });
        if (stillPending) continue;
      }
      const total = Number(job.total_cost_usd) || Number(merged.budget_extension_total_usd) || 0;
      const cap = Number(job.cost_cap_usd) || Number(merged.budget_extension_cap_usd) || 0;
      const pct = cap > 0 ? Math.round((total / cap) * 100) : null;
      const text = cap > 0
        ? `Budget: $${total.toFixed(4)} / $${cap.toFixed(4)}${pct != null ? ` (${pct}%)` : ''}\nBudget decision expired — Extend / Keep cap / Cancel job.`
        : 'Budget decision expired — Extend / Keep cap / Cancel job.';
      return jsonResponse({
        approval: {
          id: `expired_budget:${job.id}`,
          tool_name: 'spawn_lane_extension',
          description: 'Budget decision expired — Extend / Keep cap / Cancel job',
          risk_level: 'low',
          is_mcp_server: 0,
          server_display_name: null,
          queue_count: Math.max(pendingCount, 1),
          preview_sql: null,
          preview_command: text,
          decision_expired: true,
          spawn_job_id: job.id,
        },
        pending_count: Math.max(pendingCount, 1),
      }, 200, { 'Cache-Control': 'no-store' });
    }
    return jsonResponse({ approval: null, pending_count: pendingCount }, 200, { 'Cache-Control': 'no-store' });
  }
  const preview = approvalPreview(row);
  preview.queue_count = pendingCount || 1;
  return jsonResponse({ approval: preview, pending_count: pendingCount }, 200, { 'Cache-Control': 'no-store' });
}
