/**
 * Production Worker domain dispatch — single source of truth for /api routes that
 * src/index.js delegates to after auth/session middleware.
 *
 * Keep ordering identical to historical src/index.js behavior; add new API prefixes here
 * so production cannot drift from documentation/tests that reference src/core/router.js.
 */

import { handleAgentRequest } from '../../backend/http/agentsam/index.js';
import { handleCmsApi } from '../api/cms.js';
import { handlePublicCmsApi } from '../api/cms-public.js';
import { handleBrowserTrust } from '../../backend/http/browser/trust.js';
import { handleAgentSamRegistryRequest } from '../api/agentsam.js';
import { handleTimeDispatch } from '../../backend/agentsam/tools/time.js';
import { handleR2Api } from '../api/r2-api.js';
import { handleStorageApi } from '../api/storage.js';
import { handleUserStorageKeysApi } from '../api/user-storage-keys.js';
import { handleUserPersonalApi } from '../api/user-personal.js';
import { handleIntegrationsRequest } from '../api/integrations.js';
import { handleWorkspaceApi } from '../api/workspace.js';
import { handleCicdEvent } from '../api/cicd-event.js';
import { handlePostDeploy } from '../api/post-deploy.js';
import { handleCidiApi } from '../api/cicd.js';
import { handleDeploymentsApi } from '../api/deployments.js';
import { handleFinanceApi } from '../api/finance.js';
import { handleBillingApi } from '../api/billing.js';
import { handleMcpApi } from '../api/mcp.js';
import { handleNotifyDeployComplete } from '../api/notify-deploy.js';
import { handleTriggerWorkersBuild } from '../api/trigger-workers-build.js';
import { handleDrawApi } from '../api/draw.js';
import { handleIllustrationApi } from '../api/illustration.js';
import { handleThemesApi } from '../api/themes.js';
import { handleHubApi } from '../api/hub.js';
import { handleOverviewApi } from '../api/overview.js';
import { handleClientConfig } from '../api/config.js';
import { handleDashboardApi } from '../api/dashboard.js';
import { handleDashboardHomeApi } from '../api/dashboard-home.js';
import { handleMailApi } from '../api/mail.js';
import { handleEmailApi } from '../api/email.js';
import { handleContactApi } from '../api/contact.js';
import { handleLearnApi } from '../api/learn.js';
import { handleOnboardingApi } from '../api/onboarding.js';
import { handleAuthApi } from '../api/auth.js';
import { handleCompanyApi } from '../api/company.js';
import { jsonResponse } from './auth.js';
import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js';
import { handleQualityReportRegisterApi, handleQualityReportSaveApi } from '../public-pages/quality-report-route.js';
import { handleBrowserCapturesApi } from '../../backend/http/browser/captures.js';
import { handleSearchApi } from '../api/search.js';
import { handleIntakeApi } from '../api/intake.js';
import { handleCadApi } from '../api/cad.js';
import { handleDesignStudioApi } from '../api/designstudio/index.js';
import { handleStudioSessionApi } from '../api/studio-session.js';
import { handleStatusBundle } from '../api/status-bundle.js';
import { handleCursorAgentApi } from '../api/cursor-agent.js';
import { handleAcpRequest } from '../../backend/http/acp/handler.js';
import { handleCursorAcpMessage } from '../../backend/http/acp/cursor.js';
import { handleStripeWebhook } from '../api/billing.js';
import { handleCalendarApi } from '../api/calendar.js';
import { handleOpsDeskApi } from '../api/ops-desk.js';
import { handleKanbanApi } from '../api/kanban.js';
import { handleMeetApi } from '../api/meet.js';
import { handleMeetV2Api } from '../api/meet-v2.js';
import { handleHealthApi } from '../api/health/index.js';
import { handleAnalyticsApi } from '../api/analytics/index.js';
import { handleVaultApi } from '../api/vault.js';
import { handleD1DashboardRoutes } from '../api/d1-dashboard.js';
import { handleUnifiedSearchApi } from '../api/unified-search.js';
import { handleWorkflowsApi } from '../../backend/http/workflows/recent-runs.js';
import { handleCommandsApi } from '../api/commands.js';
import { handleImagesApi } from '../api/images.js';
import { handleTicketsApi } from '../api/tickets.js';
import { handleMoviemodeApi } from '../api/moviemode-api.js';


/**
 * @typedef {object} ProductionRouteContext
 * @property {Request} request
 * @property {URL} url
 * @property {object} env
 * @property {ExecutionContext} ctx
 * @property {unknown} authUser
 * @property {import('./auth.js').AuthContext | null} [authCtx]
 * @property {unknown} identity
 * @property {import('./auth.js').ReturnType<typeof import('./auth.js').resolveRequestContext>} [requestContext]
 * @property {string} methodUpper
 * @property {string} pathLower Normalized path (lower case)
 * @property {string} path Normalized path (original casing from pathname collapse)
 */

/**
 * Domain dispatch formerly inlined in src/index.js (section "3. Domain Dispatching").
 * @param {ProductionRouteContext} rc
 * @returns {Promise<Response | null>} Response if matched; null to fall through to static/HTML handling in index.
 */
export async function dispatchProductionDomainRoutes(rc) {
  const {
    request,
    url,
    env,
    ctx,
    authUser,
    authCtx = null,
    identity,
    requestContext = null,
    methodUpper,
    pathLower,
  } = rc;

  const routeAuth = { authCtx, authUser };

  if (methodUpper === 'GET' || methodUpper === 'HEAD') {
    const { shouldProxyToMoviemodeService, proxyToMoviemodeService } = await import(
      './moviemode-service-proxy.js'
    );
    if (shouldProxyToMoviemodeService(pathLower)) {
      const proxied = await proxyToMoviemodeService(request, env);
      if (proxied) return proxied;
    }
  }

  if (pathLower === '/api/quality-reports/register' && methodUpper === 'POST') {
    const ingestBypass = verifyBridgeKey(request, env);
    return handleQualityReportRegisterApi(request, env, authUser, ingestBypass);
  }

  if (pathLower === '/api/quality-reports/save' && methodUpper === 'POST') {
    return handleQualityReportSaveApi(request, env, authUser);
  }

  if (pathLower.startsWith('/api/browser/captures')) {
    return handleBrowserCapturesApi(request, url, env);
  }

  if (pathLower === '/api/internal/browser/capture-context') {
    const { handleBrowserCaptureContextInternal } = await import(
      '../../backend/http/browser/capture-context-internal.js'
    );
    const res = await handleBrowserCaptureContextInternal(request, url, env);
    if (res) return res;
  }

  if (pathLower.startsWith('/api/agentsam/browser/trust')) {
    return handleBrowserTrust(request, env);
  }

  if (pathLower.startsWith('/api/agentsam/browser/embed-policy')) {
    const { handleBrowserEmbedPolicy } = await import('../../backend/http/browser/embed-policy.js');
    return handleBrowserEmbedPolicy(request, env);
  }

  if (pathLower.startsWith('/api/agentsam/time')) {
    return handleTimeDispatch(request, env, ctx, authUser);
  }

  if (pathLower === '/api/agentsam/video-embed' && methodUpper === 'POST') {
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    const { handleVideoEmbedRequest } = await import('../api/moviemode-api.js');
    const workspaceId = String(
      authUser?.active_workspace_id || authUser?.workspace_id || '',
    ).trim();
    if (!workspaceId) return jsonResponse({ error: 'workspace_id required' }, 400);
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    return handleVideoEmbedRequest(request, env, { workspaceId });
  }

  if (pathLower.startsWith('/api/agentsam')) {
    const res = await handleAgentSamRegistryRequest(request, env, ctx, authUser);
    if (res && res.status !== 404) return res;
  }

  if (pathLower.startsWith('/api/public/cms')) {
    return handlePublicCmsApi(request, url, env);
  }

  if (pathLower.startsWith('/api/cms')) {
    return handleCmsApi(request, url, env, ctx);
  }

  if (pathLower.startsWith('/api/search')) {
    return handleSearchApi(request, url, env, ctx);
  }

  if (pathLower === '/api/commands' || pathLower.startsWith('/api/commands/')) {
    return handleCommandsApi(request, url, env);
  }

  if (pathLower.startsWith('/api/unified-search')) {
    return handleUnifiedSearchApi(request, url, env);
  }

  if (pathLower === '/api/workflows') {
    return handleWorkflowsApi(request, url, env);
  }

  if (pathLower === '/api/public/sync') {
    const { handlePublicSyncApi } = await import('../api/public-sync.js');
    return handlePublicSyncApi(request, env);
  }

  if (pathLower.startsWith('/api/calendar')) {
    return handleCalendarApi(request, url, env, ctx);
  }

  if (pathLower.startsWith('/api/ops-desk')) {
    return handleOpsDeskApi(request, url, env);
  }

  if (pathLower.startsWith('/api/kanban')) {
    return handleKanbanApi(request, url, env);
  }

  if (pathLower.startsWith('/api/meet/v2')) {
    return handleMeetV2Api(request, env);
  }

  if (pathLower.startsWith('/api/meet')) {
    return handleMeetApi(request, env, ctx);
  }

  if (pathLower.startsWith('/api/user/storage-keys')) {
    return handleUserStorageKeysApi(request, url, env);
  }

  if (pathLower.startsWith('/api/user/notes') || pathLower.startsWith('/api/user/contacts')) {
    return handleUserPersonalApi(request, url, env);
  }

  if (pathLower.startsWith('/api/storage')) {
    return handleStorageApi(request, url, env);
  }

  if (pathLower.startsWith('/api/r2/')) {
    return handleR2Api(request, url, env);
  }

  if (pathLower.startsWith('/api/cloudconvert/')) {
    const { handleCloudConvertApi } = await import('../api/cloudconvert-api.js');
    return handleCloudConvertApi(request, url, env);
  }

  if (
    pathLower.startsWith('/api/moviemode/') ||
    pathLower.startsWith('/api/media/assets') ||
    pathLower.startsWith('/api/stream/')
  ) {
    return handleMoviemodeApi(request, url, env, ctx);
  }

  if (pathLower === '/api/webhooks/stripe' && methodUpper === 'POST') {
    return handleStripeWebhook(request, env, ctx);
  }

  if (
    pathLower.startsWith('/api/integrations') ||
    pathLower.startsWith('/api/gdrive') ||
    pathLower === '/api/webhooks/resend' ||
    pathLower === '/api/email/inbound'
  ) {
    const res = await handleIntegrationsRequest(request, env, ctx, authUser);
    // Always return the integrations handler response (including 404 JSON from GitHub passthrough
    // or explicit not_found). Skipping 404 caused fallthrough to generic { error: 'Not found' } in index.js.
    if (res) return res;
  }

  if (pathLower.startsWith('/api/vault')) {
    return handleVaultApi(request, new URL(request.url), env, ctx);
  }

  if (pathLower.startsWith('/api/d1')) {
    return handleD1DashboardRoutes(request, url, env);
  }

  if (pathLower.startsWith('/api/data-plane')) {
    const { handleCustomerDataPlaneApi } = await import('../api/customer-data-plane-api.js');
    return handleCustomerDataPlaneApi(request, url, env);
  }

  if (pathLower === '/api/agent/policy' && request.method === 'GET') {
    if (!authUser || !authCtx) return jsonResponse({ error: 'Unauthorized' }, 401);
    const { handleAgentPolicy } = await import('../api/agent-policy.js');
    return handleAgentPolicy(request, env, authCtx);
  }

  if (pathLower === '/api/dashboard/status-bundle' && request.method === 'GET') {
    return handleStatusBundle(request, url, env, ctx);
  }

  if (pathLower.startsWith('/api/sandbox')) {
    const { handleSandboxApi } = await import('../api/sandbox-api.js');
    return handleSandboxApi(request, url, env);
  }

  if (pathLower === '/api/terminal/wrangler-guide' && methodUpper === 'GET') {
    const { handleTerminalWranglerGuide } = await import('../api/terminal-wrangler-guide.js');
    return handleTerminalWranglerGuide(request, url, env);
  }
  if (pathLower.startsWith('/api/dashboard/home')) {
    if (!authUser) return jsonResponse({ error: 'Unauthorized', code: 'SESSION_MISSING' }, 401);
    const homeRes = await handleDashboardHomeApi(request, env, authUser, pathLower, methodUpper);
    if (homeRes) return homeRes;
  }
  if (pathLower.startsWith('/api/agent/intake')) {
    return handleIntakeApi(request, url, env, ctx);
  }
  if (
    pathLower.startsWith('/api/cad/') ||
    pathLower === '/api/cad' ||
    pathLower.startsWith('/api/internal/cad/')
  ) {
    return handleCadApi(request, url, env, ctx);
  }
  if (pathLower.startsWith('/api/studio/') || pathLower === '/api/studio') {
    return handleStudioSessionApi(request, url, env, ctx);
  }
  if (pathLower.startsWith('/api/artifacts')) {
    return handleStudioSessionApi(request, url, env, ctx);
  }
  if (pathLower === '/api/acp' || pathLower.startsWith('/api/acp/')) {
    return handleAcpRequest(request, env, ctx, { identity, chatServices: rc.chatServices });
  }
  if (pathLower === '/api/cursor/acp' && methodUpper === 'POST') {
    // Transitional facade — standards-compliant core is /api/acp
    return handleCursorAcpMessage(request, env, ctx, { identity, chatServices: rc.chatServices });
  }
  if (pathLower.startsWith('/api/cursor/')) {
    return handleCursorAgentApi(request, url, env, ctx);
  }

  if (
    pathLower.startsWith('/api/hyperdrive') ||
    pathLower.startsWith('/api/browser') ||
    pathLower.startsWith('/api/security/')
  ) {
    return handleDashboardApi(request, url, env, ctx);
  }

  if (
    pathLower.startsWith('/api/agent') ||
    pathLower.startsWith('/api/terminal') ||
    pathLower.startsWith('/api/chat') ||
    pathLower.startsWith('/api/playwright')
  ) {
    const postAgentFirst =
      pathLower.startsWith('/api/agent') &&
      methodUpper === 'POST' &&
      pathLower !== '/api/agent/artifacts/purge';
    let postAgentRes = null;
    if (postAgentFirst) {
      postAgentRes = await handleAgentRequest(request, env, ctx, { identity, routeAuth, ingestBypass: verifyBridgeKey(request, env), planServices: rc.planServices, chatServices: rc.chatServices });
      if (postAgentRes.status !== 404) return postAgentRes;
    }
    const dashRes = await handleDashboardApi(request, url, env, ctx);
    if (dashRes.status !== 404) return dashRes;
    if (pathLower.startsWith('/api/agent')) {
      if (postAgentFirst && postAgentRes) return postAgentRes;
      const agentRes = await handleAgentRequest(request, env, ctx, { identity, routeAuth, ingestBypass: verifyBridgeKey(request, env), planServices: rc.planServices, chatServices: rc.chatServices });
      if (agentRes.status !== 404) return agentRes;
    }
  }

  if (pathLower.startsWith('/api/workspaces') || pathLower.startsWith('/api/workspace')) {
    return handleWorkspaceApi(request, url, env, ctx, authUser);
  }

  if (pathLower.startsWith('/api/cicd')) {
    return handleCidiApi(request, url, env, ctx);
  }

  if (pathLower === '/api/internal/cicd-event') {
    return handleCicdEvent(request, env, ctx);
  }

  if (pathLower === '/api/internal/post-deploy' && request.method === 'POST') {
    return handlePostDeploy(request, env, ctx);
  }

  if (pathLower === '/api/internal/trigger-workers-build' && methodUpper === 'POST') {
    return handleTriggerWorkersBuild(request, env, ctx);
  }

  if (pathLower === '/api/internal/summarize-backfill' && methodUpper === 'POST') {
    const { handleSummarizeBackfill } = await import('../api/summarize-backfill.js');
    return handleSummarizeBackfill(request, env);
  }

  if (pathLower === '/api/internal/summarize-session' && methodUpper === 'POST') {
    const { handleSummarizeSession } = await import('../api/summarize-session.js');
    return handleSummarizeSession(request, env, ctx);
  }

  if (pathLower === '/api/internal/agent-run-telemetry' && methodUpper === 'POST') {
    const { handleAgentRunTelemetry } = await import('../api/agent-run-telemetry.js');
    return handleAgentRunTelemetry(request, env, ctx);
  }

  if (pathLower === '/api/internal/health-kv-dirty' && methodUpper === 'GET') {
    const { handleHealthKvDirty } = await import('../api/health-kv-dirty.js');
    return handleHealthKvDirty(request, env);
  }

  if (pathLower === '/api/internal/moviemode-render/health' && methodUpper === 'GET') {
    const { probeMyContainer } = await import('../../backend/agentsam/sandbox/my-container.js');
    const { jsonResponse } = await import('../core/auth.js');
    const out = await probeMyContainer(env);
    return jsonResponse(out, out.ok ? 200 : 503);
  }

  if (pathLower === '/api/internal/my-container/health' && methodUpper === 'GET') {
    const { probeMyContainer } = await import('../../backend/agentsam/sandbox/my-container.js');
    const { jsonResponse } = await import('../core/auth.js');
    const out = await probeMyContainer(env);
    return jsonResponse(out, out.ok ? 200 : 503);
  }

  if (pathLower === '/api/internal/my-container/exec' && methodUpper === 'POST') {
    const { handleMyContainerExec } = await import('../api/my-container-internal.js');
    return handleMyContainerExec(request, env);
  }

  if (pathLower === '/api/internal/my-container/purge-legacy' && methodUpper === 'POST') {
    const { handleMyContainerPurgeLegacy } = await import('../api/my-container-internal.js');
    return handleMyContainerPurgeLegacy(request, env);
  }

  if (pathLower === '/api/internal/my-container/restart-pool' && methodUpper === 'POST') {
    const { handleMyContainerRestartPool } = await import('../api/my-container-internal.js');
    return handleMyContainerRestartPool(request, env);
  }

  if (pathLower === '/api/internal/terminal/sandbox/exec' && methodUpper === 'POST') {
    const { handleTerminalSandboxExec } = await import('../api/terminal-sandbox-internal.js');
    return handleTerminalSandboxExec(request, env);
  }

  if (pathLower === '/api/internal/cad-container/health' && methodUpper === 'GET') {
    if (!verifyBridgeKey(request, env)) {
      return jsonResponse({ error: 'unauthorized' }, 401);
    }
    const { probeIamCadWorkerContainer } = await import('../core/iam-cad-worker-container.js');
    const { resolveCadDispatchTarget } = await import('../core/cad-dispatch.js');
    const out = await probeIamCadWorkerContainer(env);
    return jsonResponse(
      { ...out, dispatch_target: resolveCadDispatchTarget(env) },
      out.ok ? 200 : 503,
    );
  }

  if (pathLower === '/api/internal/exec/context/snapshot') {
    const { handleInternalExecContext } = await import('../api/internal-exec-context.js');
    return handleInternalExecContext(request, env);
  }

  if (pathLower === '/api/internal/agentsam-vectorize/describe' && methodUpper === 'GET') {
    const { handleAgentsamVectorizeDescribe } = await import('../api/agentsam-vectorize-describe.js');
    return handleAgentsamVectorizeDescribe(request, env);
  }

  if (pathLower === '/api/internal/cron-self-test' && methodUpper === 'POST') {
    const { handleCronSelfTest } = await import('../api/cron-self-test.js');
    return handleCronSelfTest(request, env, ctx);
  }

  if (pathLower === '/api/internal/chat-sessions/purge-archived' && methodUpper === 'POST') {
    const { handleChatSessionPurgeArchivedInternal } = await import('../api/chat-session-purge-internal.js');
    return handleChatSessionPurgeArchivedInternal(request, env);
  }

  if (pathLower === '/api/internal/exec-identity-alert' && methodUpper === 'POST') {
    const { handleExecIdentityAlert } = await import('../api/internal-exec-identity-alert.js');
    return handleExecIdentityAlert(request, env, ctx);
  }
  if (pathLower === '/api/internal/error-log' && methodUpper === 'POST') {
    const { handleInternalErrorLog } = await import('../api/internal-error-log.js');
    return handleInternalErrorLog(request, env, ctx);
  }
  if (pathLower === '/api/internal/cwd-resolution-probe' && methodUpper === 'POST') {
    const { handleCwdResolutionProbe } = await import('../api/internal-cwd-resolution-probe.js');
    return handleCwdResolutionProbe(request, env);
  }

  if (pathLower === '/api/internal/code-index/run' && methodUpper === 'POST') {
    const { handleCodeIndexRun } = await import('../api/code-index-run.js');
    return handleCodeIndexRun(request, env, ctx);
  }

  if (pathLower === '/api/internal/google/refresh-token' && methodUpper === 'POST') {
    const { isInternalSecretAuthorized, handleGoogleTokenRefresh } = await import(
      '../api/internal-google-refresh.js'
    );
    if (!isInternalSecretAuthorized(request, env)) {
      return jsonResponse({ error: 'unauthorized' }, 401);
    }
    return handleGoogleTokenRefresh(env, request);
  }

  if (pathLower === '/api/internal/cloudflare/resolve-token' && methodUpper === 'POST') {
    const { handleInternalCloudflareResolveToken } = await import(
      '../api/internal-cloudflare-refresh.js'
    );
    return handleInternalCloudflareResolveToken(request, env);
  }

  if (pathLower === '/api/internal/actor-authority/resolve' && methodUpper === 'POST') {
    const { handleInternalActorAuthorityResolve } = await import('../api/internal-actor-authority.js');
    return handleInternalActorAuthorityResolve(request, env);
  }

  if (pathLower === '/api/internal/delegation-grant/compile' && methodUpper === 'POST') {
    const { handleInternalDelegationGrantCompile } = await import('../api/internal-delegation-grant.js');
    return handleInternalDelegationGrantCompile(request, env);
  }

  if (pathLower.startsWith('/api/internal/workflow/')) {
    const { handleInternalWorkflowRequest } = await import('../../backend/http/workflows/internal.js');
    const wfResp = await handleInternalWorkflowRequest(request, env, url);
    if (wfResp) return wfResp;
  }

  if (pathLower.startsWith('/api/internal/designstudio/') || pathLower.startsWith('/api/designstudio/')) {
    return handleDesignStudioApi(request, url, env, ctx);
  }

  if (pathLower.startsWith('/api/deployments') || pathLower.startsWith('/api/internal/')) {
    return handleDeploymentsApi(request, url, env, ctx);
  }

  if (
    pathLower.startsWith('/api/billing') ||
    pathLower === '/api/webhooks/stripe'
  ) {
    return handleBillingApi(request, url, env, ctx);
  }

  if (
    pathLower.startsWith('/api/finance') ||
    pathLower.startsWith('/api/clients') ||
    pathLower.startsWith('/api/projects')
  ) {
    return handleFinanceApi(request, url, env, ctx);
  }

  if (pathLower === '/api/notify/deploy-complete' && request.method === 'POST') {
    return handleNotifyDeployComplete(request, env, ctx);
  }

  if (pathLower.startsWith('/api/mcp') || pathLower === '/mcp') {
    return handleMcpApi(request, url, env, ctx);
  }

  if (pathLower.startsWith('/api/draw')) {
    return handleDrawApi(request, url, env, ctx);
  }

  if (pathLower.startsWith('/api/illustration')) {
    const illustrationRes = await handleIllustrationApi(request, url, env, ctx);
    if (illustrationRes) return illustrationRes;
  }

  if (pathLower.startsWith('/api/themes') || pathLower === '/api/user/preferences') {
    return handleThemesApi(request, url, env, ctx);
  }

  if (pathLower.startsWith('/api/images')) {
    const res = await handleImagesApi(request, url, env, authUser, identity);
    return res;
  }

  if (pathLower.startsWith('/api/tickets')) {
    return handleTicketsApi(request, url, env, authUser);
  }

  if (pathLower.startsWith('/api/hub')) {
    return handleHubApi(request, url, env, ctx);
  }

  if (pathLower.startsWith('/api/health/')) {
    return handleHealthApi(request, url, env, ctx);
  }

  if (pathLower.startsWith('/api/analytics/')) {
    return handleAnalyticsApi(request, url, env, ctx, authUser, identity);
  }

  if (pathLower === '/api/config/client') {
    return handleClientConfig(request, env);
  }

  if (pathLower.startsWith('/api/overview')) {
    return handleOverviewApi(request, url, env, ctx);
  }

  if (pathLower.startsWith('/api/mail')) {
    return handleMailApi(request, url, env, ctx);
  }

  if (pathLower === '/api/email/send' && methodUpper === 'POST') {
    return handleEmailApi(request, env);
  }

  if (pathLower === '/api/contact' && methodUpper === 'POST') {
    return handleContactApi(request, env);
  }

  if (pathLower === '/api/notifications/email' && methodUpper === 'POST') {
    const { handleAppNotificationEmail } = await import('../api/notifications/email.js');
    return handleAppNotificationEmail(request, env);
  }

  if (pathLower.startsWith('/api/learn')) {
    return handleLearnApi(request, url, env, ctx);
  }

  if (pathLower.startsWith('/api/onboarding')) {
    return handleOnboardingApi(request, url, env);
  }

  if (pathLower.startsWith('/api/sdk')) {
    const { handleSdkApi } = await import('../api/sdk.js');
    return handleSdkApi(request, url, env, ctx);
  }

  if (pathLower.startsWith('/api/games')) {
    const { handleGamesApi } = await import('../api/games.js');
    return handleGamesApi(request, url, env, ctx, authUser);
  }

  if (pathLower === '/api/push/vapid-public-key' && methodUpper === 'GET') {
    const { handlePushVapidPublicKey } = await import('../api/push-subscribe.js');
    return handlePushVapidPublicKey(request, env);
  }

  if (pathLower === '/api/push/subscribe' && methodUpper === 'POST') {
    const { handlePushSubscribe } = await import('../api/push-subscribe.js');
    return handlePushSubscribe(request, env);
  }

  if (pathLower === '/api/push/unsubscribe' && (methodUpper === 'POST' || methodUpper === 'DELETE')) {
    const { handlePushUnsubscribe } = await import('../api/push-subscribe.js');
    return handlePushUnsubscribe(request, env);
  }

  if (pathLower === '/api/push/notify' && methodUpper === 'POST') {
    const { handlePushNotify } = await import('../api/push-subscribe.js');
    return handlePushNotify(request, env);
  }

  if (pathLower === '/api/push/action' && methodUpper === 'POST') {
    const { handlePushAction } = await import('../api/push-subscribe.js');
    return handlePushAction(request, env, ctx);
  }

  if (pathLower === '/api/company') {
    return handleCompanyApi(request, url, env);
  }

  if (pathLower.startsWith('/api/auth') || pathLower === '/api/settings/profile') {
    return handleAuthApi(request, url, env);
  }

  void identity;
  return null;
}

/** Alias for callers expecting `resolveRoute`-style naming (same RouteContext argument). */
export const resolveRoute = dispatchProductionDomainRoutes;
