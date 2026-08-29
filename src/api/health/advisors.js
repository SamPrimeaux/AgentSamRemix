/**
 * Lightweight security/perf hints derived from telemetry (no Supabase Management API calls).
 */

/**
 * @param {{
 *   error_events?: any[],
 *   worker_errors?: any[],
 *   mcp_tools?: { status: string }[],
 *   deploy_failures_recent?: boolean,
 * }} ctx
 */
export function buildAdvisors(ctx) {
  const security = [];
  const performance = [];

  const errs = [...(ctx.error_events || []), ...(ctx.worker_errors || [])];
  const crit = errs.filter((e) => {
    const sev = String(e?.severity || e?.level || '').toLowerCase();
    const msg = String(e?.message || e?.error || e?.error_message || '').toLowerCase();
    return sev === 'critical' || msg.includes('unauthorized') || msg.includes('secret') || msg.includes('token');
  });
  if (crit.length) {
    security.push({
      id: 'sec-recent-critical',
      title: 'Critical or auth-related errors in telemetry',
      severity: 'high',
      affected: 'agent pipeline',
      fix_hint: 'Review agentsam_error_events and worker_errors; rotate credentials if leaked.',
    });
  }

  if (ctx.deploy_failures_recent) {
    security.push({
      id: 'sec-deploy-failure',
      title: 'Recent deployment failure',
      severity: 'medium',
      affected: 'deployments',
      fix_hint: 'Inspect CI logs and D1 deployments row; verify secrets and build steps.',
    });
  }

  const slowMcp = (ctx.mcp_tools || []).filter((t) => Number(t.latency_ms) > 3000);
  if (slowMcp.length) {
    performance.push({
      id: 'perf-mcp-latency',
      title: 'MCP probes exceeding 3s',
      severity: 'medium',
      affected: slowMcp.map((t) => t.tool_name || 'tool').join(', '),
      fix_hint: 'Check MCP server cold starts, region placement, and upstream rate limits.',
    });
  }

  if ((ctx.error_events || []).length > 20) {
    performance.push({
      id: 'perf-error-volume',
      title: 'High volume of agent error events',
      severity: 'low',
      affected: 'agentsam_error_events',
      fix_hint: 'Triage top error codes; add retries or narrow tool allowlists.',
    });
  }

  return { security, performance };
}
