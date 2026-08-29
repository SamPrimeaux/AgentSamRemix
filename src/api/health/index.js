/**
 * Health dashboard API (/api/health/*) — modular handlers; keep /api/health (no slash) on handleHealthCheck.
 */
import { jsonResponse } from '../../core/responses.js';
import { getAuthUser } from '../../../backend/identity/index.js';
import { computeHealthScore } from './scoring.js';
import {
  fetchAgentHealthSupabase,
  fetchWorkerHealth,
  fetchMcpHealthRows,
  fetchModelsHealth,
  fetchDeploymentsHealth,
} from './queries.js';
import { buildAdvisors } from './advisors.js';
import { runMcpProbes } from './mcpChecks.js';
import { fetchAgentsamD1Telemetry } from './d1Telemetry.js';
import { handlePublicHyperdriveHealth } from './hyperdrive-health.js';

export function handleHealthCheck(request, env) {
  return jsonResponse({
    status: 'ok',
    worker: 'inneranimalmedia',
    version: env.CF_VERSION_METADATA?.id ?? 'v2.0-modular',
    bindings: {
      db: !!env.DB,
      r2: !!env.ASSETS,
      browser: !!env.MYBROWSER,
      queue: !!env.MY_QUEUE,
      ai: !!env.AI,
      hyperdrive: !!env.HYPERDRIVE,
    },
    timestamp: Date.now(),
  });
}

/**
 * @param {Request} request
 * @param {URL} url
 * @param {any} env
 * @param {any} ctx
 */
export async function handleHealthApi(request, url, env, _ctx) {
  const pathLower = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
  const method = request.method.toUpperCase();

  if (pathLower === '/api/health/hyperdrive' && method === 'GET') {
    return await handlePublicHyperdriveHealth(env, url);
  }

  const authUser = await getAuthUser(request, env);
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    if (pathLower === '/api/health/summary' && method === 'GET') {
      const [agent, workers, mcp, models, dep] = await Promise.all([
        fetchAgentHealthSupabase(env),
        fetchWorkerHealth(env),
        fetchMcpHealthRows(env),
        fetchModelsHealth(env),
        fetchDeploymentsHealth(env),
      ]);

      const supabaseHealthy = !!agent._supabase_ok;
      const noSecurityCritical = !agent.error_events?.some((e) => String(e?.severity || '').toLowerCase() === 'critical');
      const noRecentErrors = (agent.error_events?.length || 0) < 15;

      const within24h = (iso) => {
        if (!iso) return false;
        const t = Date.parse(String(iso));
        if (Number.isNaN(t)) return false;
        return Date.now() - t < 86400000;
      };
      const failedRecent = (dep.deployments || []).some((d) => {
        const st = String(d?.status || '').toLowerCase();
        const fail = st === 'failed' || st === 'failure' || st === 'error';
        const ts = d?.created_at || d?.timestamp;
        return fail && within24h(ts);
      });
      const noFailedDeploys24h = !failedRecent;

      const mcpChecksPassing =
        !(mcp.tools || []).length ||
        (mcp.tools || []).every((t) => {
          const s = String(t.status || '').toLowerCase();
          return s === 'ok' || s === 'unknown' || s === 'skipped';
        });
      const req = workers.rollup_24h?.requests || 0;
      const err = workers.rollup_24h?.errors || 0;
      const workerErrorRateOk = req === 0 ? true : err / req < 0.05;

      const score = computeHealthScore({
        supabaseHealthy,
        noSecurityCritical,
        noRecentErrors,
        noFailedDeploys24h,
        mcpChecksPassing,
        workerErrorRateOk,
      });

      return jsonResponse({
        score,
        flags: {
          supabaseHealthy,
          noSecurityCritical,
          noRecentErrors,
          noFailedDeploys24h,
          mcpChecksPassing,
          workerErrorRateOk,
        },
        generated_at: Date.now(),
      });
    }

    if (pathLower === '/api/health/agent' && method === 'GET') {
      const a = await fetchAgentHealthSupabase(env);
      const { _supabase_ok, ...rest } = a;
      return jsonResponse(rest);
    }

    if (pathLower === '/api/health/workers' && method === 'GET') {
      return jsonResponse(await fetchWorkerHealth(env));
    }

    if (pathLower === '/api/health/mcp' && method === 'GET') {
      const m = await fetchMcpHealthRows(env);
      return jsonResponse({ tools: m.tools });
    }

    if (pathLower === '/api/health/mcp/check' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      return jsonResponse(await runMcpProbes(env, request, body));
    }

    if (pathLower === '/api/health/models' && method === 'GET') {
      return jsonResponse(await fetchModelsHealth(env));
    }

    if (pathLower === '/api/health/advisors' && method === 'GET') {
      const [agent, workers, mcp] = await Promise.all([
        fetchAgentHealthSupabase(env),
        fetchWorkerHealth(env),
        fetchMcpHealthRows(env),
      ]);
      const deploy_failures_recent = !!(await fetchDeploymentsHealth(env)).last_failure_at;
      const { security, performance } = buildAdvisors({
        error_events: agent.error_events,
        worker_errors: workers.supabase_worker?.worker_errors || [],
        mcp_tools: mcp.tools,
        deploy_failures_recent,
      });
      return jsonResponse({ security, performance });
    }

    if (pathLower === '/api/health/deployments' && method === 'GET') {
      return jsonResponse(await fetchDeploymentsHealth(env));
    }

    if (pathLower === '/api/health/agentsam-d1' && method === 'GET') {
      const tenantId = authUser?.tenant_id != null ? String(authUser.tenant_id) : null;
      const userId = authUser?.id != null ? String(authUser.id) : null;
      return jsonResponse(await fetchAgentsamD1Telemetry(env, { tenantId, userId, superadmin: false }));
    }

    return jsonResponse({ error: 'Health route not found' }, 404);
  } catch (e) {
    return jsonResponse({ error: String(e?.message || e) }, 500);
  }
}
