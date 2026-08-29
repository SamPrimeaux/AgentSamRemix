import { jsonResponse, fetchAuthUserTenantId } from '../../core/auth.js';
import { handleAnalyticsLayout } from './layout.js';
import { handleAnalyticsSourceHealth } from './source-health.js';
import { handleAnalyticsOverview } from './overview.js';
import { handleAnalyticsInsights } from './insights.js';
import { handleAnalyticsRag } from './rag.js';
import { handleAnalyticsCodebase } from './codebase.js';
import { handleAnalyticsCosts } from './costs.js';
import {
  handleAgentAnalyticsGraph,
  handleAgentAnalyticsDependencies,
  handleAgentAnalyticsRuns,
} from './agent.js';
import {
  handleDatabasesSummary,
  handleDatabasesQueries,
  handleDatabasesTables,
  handleDatabasesTimeseries,
  handleDatabasesEvents,
  handleDatabasesOverview,
} from './databases.js';
import {
  handleAnalyticsAdvisors,
  handleAnalyticsAdvisorsGuardrails,
  handleAnalyticsErrorLogD1,
  handleAnalyticsMcpTools,
  handleAnalyticsModelsDrift,
  handleAnalyticsModelsEvals,
  handleAnalyticsModelsLeaderboard,
  handleAnalyticsModelsPromptCache,
  handleAnalyticsModelsRoutingArms,
  handleAnalyticsModelsRoutingDecisions,
  handleAnalyticsWorkersDashboardVersions,
  handleAnalyticsWorkersR2,
  handleAnalyticsWorkersSummary,
} from './boards.js';
import { handleLearningOverview, handleLearningExperiences } from './learning.js';

function trimId(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

/**
 * /api/analytics/* router.
 *
 * Rules:
 * - Do not create new tables/columns here.
 * - Use cms_* config tables for layout, never for metric values.
 */
export async function handleAnalyticsApi(request, url, env, ctx, authUser, identity) {
  void ctx;
  const pathLower = String(url?.pathname || '').toLowerCase();

  // Tenant/workspace: identity (session actor) → auth_users row → DB lookup by user id/email.
  // Note: getAuthUser exposes active_workspace_id / active_tenant_id (not legacy workspace_id).
  let tenantId =
    trimId(identity?.tenantId) ||
    trimId(authUser?.active_tenant_id) ||
    trimId(authUser?.tenant_id) ||
    trimId(env?.TENANT_ID) ||
    null;

  let workspaceId =
    trimId(identity?.workspaceId) ||
    trimId(authUser?.active_workspace_id) ||
    trimId(authUser?.workspace_id) ||
    null;

  const uid =
    authUser && (authUser.id || authUser.user_id || authUser.auth_id)
      ? String(authUser.id || authUser.user_id || authUser.auth_id).trim()
      : null;
  if (!tenantId && uid) {
    tenantId = (await fetchAuthUserTenantId(env, uid).catch(() => null)) || null;
  }
  if (!tenantId && authUser?.email) {
    tenantId = (await fetchAuthUserTenantId(env, String(authUser.email)).catch(() => null)) || null;
  }

  if (pathLower === '/api/analytics/layout' && request.method === 'GET') {
    return handleAnalyticsLayout(request, url, env, { tenantId, workspaceId });
  }

  if (pathLower === '/api/analytics/source-health' && request.method === 'GET') {
    return handleAnalyticsSourceHealth(request, url, env, { tenantId, workspaceId });
  }

  if (pathLower === '/api/analytics/overview' && request.method === 'GET') {
    return handleAnalyticsOverview(request, url, env, { tenantId, workspaceId });
  }

  if (pathLower === '/api/analytics/insights' && request.method === 'GET') {
    return handleAnalyticsInsights(request, url, env, { tenantId, workspaceId });
  }

  if (pathLower === '/api/analytics/rag' && request.method === 'GET') {
    return handleAnalyticsRag(request, url, env, { tenantId, workspaceId });
  }

  if (pathLower === '/api/analytics/codebase' && request.method === 'GET') {
    return handleAnalyticsCodebase(request, url, env, { tenantId, workspaceId });
  }

  if (pathLower === '/api/analytics/costs' && request.method === 'GET') {
    return handleAnalyticsCosts(request, url, env, { tenantId, workspaceId });
  }

  if (pathLower === '/api/analytics/agent/graph' && request.method === 'GET') {
    return handleAgentAnalyticsGraph(request, url, env, { tenantId, workspaceId });
  }

  if (pathLower === '/api/analytics/agent/dependencies' && request.method === 'GET') {
    return handleAgentAnalyticsDependencies(request, url, env, { tenantId, workspaceId });
  }

  if (pathLower === '/api/analytics/agent/runs' && request.method === 'GET') {
    return handleAgentAnalyticsRuns(request, url, env, { tenantId, workspaceId, userId: uid });
  }

  if (pathLower === '/api/analytics/models/leaderboard' && request.method === 'GET') {
    return handleAnalyticsModelsLeaderboard(request, url, env, { tenantId, workspaceId });
  }

  if (pathLower === '/api/analytics/models/routing-arms' && request.method === 'GET') {
    return handleAnalyticsModelsRoutingArms(request, url, env, { tenantId, workspaceId });
  }

  if (pathLower === '/api/analytics/models/routing-decisions' && request.method === 'GET') {
    return handleAnalyticsModelsRoutingDecisions(request, url, env, { tenantId, workspaceId });
  }

  if (pathLower === '/api/analytics/models/evals' && request.method === 'GET') {
    return handleAnalyticsModelsEvals(request, url, env, { tenantId, workspaceId });
  }

  if (pathLower === '/api/analytics/models/drift' && request.method === 'GET') {
    return handleAnalyticsModelsDrift(request, url, env);
  }

  if (pathLower === '/api/analytics/models/prompt-cache' && request.method === 'GET') {
    return handleAnalyticsModelsPromptCache(request, url, env, { tenantId, workspaceId });
  }

  if (pathLower === '/api/analytics/workers/r2' && request.method === 'GET') {
    return handleAnalyticsWorkersR2(request, url, env);
  }

  if (pathLower === '/api/analytics/workers/dashboard-versions' && request.method === 'GET') {
    return handleAnalyticsWorkersDashboardVersions(request, url, env);
  }

  if (pathLower === '/api/analytics/workers/summary' && request.method === 'GET') {
    return handleAnalyticsWorkersSummary(request, url, env, { tenantId, workspaceId });
  }

  if (pathLower === '/api/analytics/mcp/tools' && request.method === 'GET') {
    return handleAnalyticsMcpTools(request, url, env, { tenantId, workspaceId });
  }

  if (pathLower === '/api/analytics/advisors' && request.method === 'GET') {
    return handleAnalyticsAdvisors(request, url, env, { tenantId, workspaceId });
  }

  if (pathLower === '/api/analytics/errors/d1-log' && request.method === 'GET') {
    return handleAnalyticsErrorLogD1(request, url, env, { tenantId, workspaceId });
  }

  if (pathLower === '/api/analytics/advisors/guardrails' && request.method === 'GET') {
    return handleAnalyticsAdvisorsGuardrails(request, url, env, { tenantId, workspaceId });
  }

  if (pathLower === '/api/analytics/databases/overview' && request.method === 'GET') {
    return handleDatabasesOverview(request, url, env, { tenantId, workspaceId });
  }

  if (pathLower === '/api/analytics/databases/summary' && request.method === 'GET') {
    return handleDatabasesSummary(request, url, env, { tenantId, workspaceId });
  }

  if (pathLower === '/api/analytics/databases/timeseries' && request.method === 'GET') {
    return handleDatabasesTimeseries(request, url, env, { tenantId, workspaceId });
  }

  if (pathLower === '/api/analytics/databases/tables' && request.method === 'GET') {
    return handleDatabasesTables(request, url, env, { tenantId, workspaceId });
  }

  if (pathLower === '/api/analytics/databases/queries' && request.method === 'GET') {
    return handleDatabasesQueries(request, url, env, { tenantId, workspaceId });
  }

  if (pathLower === '/api/analytics/databases/events' && request.method === 'GET') {
    return handleDatabasesEvents(request, url, env, { tenantId, workspaceId });
  }

  if (pathLower === '/api/analytics/learning/overview' && request.method === 'GET') {
    return handleLearningOverview(request, url, env, { tenantId, workspaceId });
  }

  if (pathLower === '/api/analytics/learning/experiences' && request.method === 'GET') {
    return handleLearningExperiences(request, url, env, { tenantId, workspaceId });
  }

  // Stub endpoints for now — return standard AnalyticsResponse shape.
  const range =
    (url.searchParams.get('range') || '7d').toLowerCase() === '24h'
      ? '24h'
      : (url.searchParams.get('range') || '7d').toLowerCase() === '30d'
        ? '30d'
        : (url.searchParams.get('range') || '7d').toLowerCase() === 'all'
          ? 'all'
          : '7d';

  return jsonResponse(
    {
      ok: true,
      backend: 'mixed',
      range,
      generated_at: Date.now(),
      summary: {},
      series: [],
      breakdowns: [],
      rows: [],
      warnings: [
        {
          code: 'ANALYTICS_ENDPOINT_NOT_IMPLEMENTED',
          message: `No handler for ${url.pathname} yet. This endpoint is staged for wiring.`,
          backend: 'mixed',
          severity: 'info',
        },
      ],
    },
    200,
  );
}

