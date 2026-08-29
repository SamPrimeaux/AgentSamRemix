/** Agent Sam HTTP route-family dispatcher (source-free backend boundary). */

import { handleAgentApprovalRoutes } from './approvals/index.js';
import { handleAgentPlanRoutes } from './plans/index.js';
import { handleSpawnBudgetRoute } from './spawn-budget.js';
import { handleCommandAllowlistRoute } from './command-allowlist.js';
import { agentChatSseHandler } from './chat-turn.js';
import { handleChatSessionsApi } from './chat-sessions.js';
import { handleExecuteApprovedToolApi } from './chat-approved-tool.js';
import { handleFsFulfillApi } from './chat-fsa-fulfill.js';
import { jsonResponse } from './shared.js';
import { handleAgentWorkflowRoutes } from '../workflows/agent-routes.js';
import { handleAgentHomeSceneApi } from './routes/home-scene.js';
import { handleAgentRunControlApi } from './routes/run-control.js';
import { handleAgentCatalogSurfaceApi } from './routes/catalog-surface.js';
import { handleAgentShellCrudApi } from './routes/shell-crud.js';
import { handleAgentGitTerminalApi } from './routes/git-terminal.js';
import { handleAgentMemoryApi } from './routes/memory.js';
import { handleAgentWorkspaceApi } from './routes/workspace.js';
import { handleAgentProblemsApi } from './routes/problems.js';
import { handleAgentNotificationsApi } from './routes/notifications.js';
import { handleAgentOpsApi } from './routes/ops.js';
import { handleAgentAttachmentsApi } from './routes/attachments.js';
import { handleAgentVoiceRoutes } from '../voice/routes.js';
import { notifyUser as notifyUserByEmail } from '../../identity/notify-user.js';

const PUBLIC_ROUTES = new Set([
  'GET /api/agent/health',
  'GET /api/agent/modes',
  'GET /api/agent/commands',
  'GET /api/agent/conversations/search',
]);

function isPublicRoute(path, method) {
  return PUBLIC_ROUTES.has(`${method} ${path}`) ||
    path === '/api/agent/telemetry' ||
    path === '/api/agent/cicd' ||
    path === '/api/agent/mcp' ||
    (path === '/api/agent/memory/sync' && method === 'POST');
}

export async function handleAgentBackendRoutes(
  request,
  url,
  env,
  ctx,
  { identity: identityIn, routeAuth, ingestBypass, planServices, chatServices },
) {
  const identity = {
    ...(identityIn || {}),
    notifyUser: identityIn?.notifyUser || notifyUserByEmail,
  };
  const path = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
  if (path === '/api/agent/scene') {
    const scene = await handleAgentHomeSceneApi(request, env, routeAuth);
    if (scene) return scene;
  }
  const workflow = await handleAgentWorkflowRoutes(request, url, env, ctx, routeAuth, identity);
  if (workflow) return workflow;
  const runControl = await handleAgentRunControlApi(request, url, env, identity);
  if (runControl) return runControl;
  const catalog = await handleAgentCatalogSurfaceApi(
    request,
    url,
    env,
    ctx,
    routeAuth,
    identity,
  );
  if (catalog) return catalog;
  const shell = await handleAgentShellCrudApi(request, url, env, ctx, routeAuth, identity);
  if (shell) return shell;
  const gitTerminal = await handleAgentGitTerminalApi(request, url, env, ctx, routeAuth, identity);
  if (gitTerminal) return gitTerminal;
  const voice = await handleAgentVoiceRoutes(request, url, env, ctx, routeAuth);
  if (voice) return voice;
  const chatFamily =
    path === '/api/agent/chat' ||
    path === '/api/agent/chat/execute-approved-tool' ||
    path === '/api/agent/fs/fulfill' ||
    path === '/api/agent/do-history' ||
    path === '/api/agent/sessions' ||
    path.startsWith('/api/agent/sessions/');
  if (chatFamily) {
    const sessions = await handleChatSessionsApi(request, url, env, ctx, routeAuth, identity);
    if (sessions) return sessions;
    const approved = await handleExecuteApprovedToolApi(
      request,
      url,
      env,
      ctx,
      routeAuth,
      identity,
      chatServices,
    );
    if (approved) return approved;
    const fsa = await handleFsFulfillApi(request, url, env, ctx, routeAuth, identity);
    if (fsa) return fsa;
    if (path === '/api/agent/chat' && request.method.toUpperCase() === 'POST') {
      return agentChatSseHandler(env, request, ctx, {
        ingestBypass,
        identity,
        services: chatServices || {},
        planServices: planServices || null,
      });
    }
  }
  const approval = await handleAgentApprovalRoutes(request, url, env, ctx, identity);
  if (approval) return approval;
  const spawnBudget = await handleSpawnBudgetRoute(request, url, env, ctx, identity);
  if (spawnBudget) return spawnBudget;
  const allowlist = await handleCommandAllowlistRoute(request, url, env, ctx, identity);
  if (allowlist) return allowlist;
  const memory = await handleAgentMemoryApi(request, url, env, ctx, routeAuth, identity);
  if (memory) return memory;
  const workspace = await handleAgentWorkspaceApi(request, url, env, ctx, routeAuth, identity);
  if (workspace) return workspace;
  const problems = await handleAgentProblemsApi(request, url, env, ctx, routeAuth, identity);
  if (problems) return problems;
  const notifications = await handleAgentNotificationsApi(
    request,
    url,
    env,
    ctx,
    routeAuth,
    identity,
  );
  if (notifications) return notifications;
  const ops = await handleAgentOpsApi(request, url, env, ctx, routeAuth, identity);
  if (ops) return ops;
  if (path === '/api/agent/attachments') {
    return handleAgentAttachmentsApi(request, env, identity);
  }
  const isPlanPath = path.startsWith('/api/agent/plan/') || path.startsWith('/api/agent/plan-task/');
  return isPlanPath
    ? handleAgentPlanRoutes(request, url, env, ctx, identity, planServices || {})
    : null;
}

export async function handleAgentRequest(
  request,
  env,
  ctx,
  { identity, routeAuth, ingestBypass, planServices, chatServices },
) {
  const url = new URL(request.url);
  const path = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
  const method = request.method.toUpperCase();
  const ra =
    routeAuth && typeof routeAuth === 'object' && 'authCtx' in routeAuth
      ? routeAuth
      : { authUser: routeAuth, authCtx: null };
  const internalEtoApply =
    path === '/api/agent/routing/apply-eto' && method === 'POST' && Boolean(ingestBypass);
  if (!isPublicRoute(path, method) && !ingestBypass && !internalEtoApply) {
    if (!identity) return jsonResponse({ error: 'unauthenticated' }, 401);
    if (!identity.workspaceId) return jsonResponse({ error: 'no_workspace', redirect: '/onboarding' }, 403);
  }
  return handleAgentBackendRoutes(request, url, env, ctx, {
    identity: { ...(identity || {}), authUser: ra.authUser || null },
    routeAuth: ra,
    ingestBypass,
    planServices: planServices || null,
    chatServices: chatServices || null,
  });
}
