import { getAgentByName, routeAgentRequest } from 'agents';
import { identityContextFromSdkSession } from '../identity/request-context.js';
import {
  LOGIN_IDP_PROVIDERS,
  OAUTH_TOKEN_PROVIDERS,
  JWT_FORBIDDEN_AUTHZ_CLAIMS,
  IDENTITY_TABLE_ROLES,
} from '../identity/index.js';
import {
  handleIdentityWorkerRequest,
  createCloudflareD1Adapter,
  createIdentityService,
} from '@inneranimalmedia/agentsam-sdk/identity/server/worker-router';
import { verifyBridgeKey, bridgeUnauthorized } from './auth/bridge-key';
import { getAiKeyStatus, setAiKey, clearAiKey, resolveAiKey } from './lib/aiKeyStore';
import { streamGeminiPage } from './lib/geminiProxy';
import {
  destroyTerminalEnvironment,
  executeTerminalLane,
  rememberExecLane,
  terminalRuntimeStatus,
} from '../agentsam/terminal/runtime';
import { probeExecOS } from '../agentsam/terminal/execos';
import { isExecLane, resolveUserRuntimeScope, type ExecLane } from '../agentsam/terminal/registry';
import { handleRetrievalHttpRequest } from '../http/retrieval/routes.js';
import type { Env } from './env';

export { AgentSam } from '../agentsam/runtime/AgentSam';
export { CodemodeRuntime } from '@cloudflare/codemode';
export { Sandbox } from '@cloudflare/sandbox';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function trim(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function agentNameForUser(userId: string): string {
  return `user-${String(userId || 'default').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80)}`;
}

async function authenticatedRuntimeScope(env: Env, requestIdentity: any) {
  const userId = trim(requestIdentity?.user?.id);
  if (!userId) return null;
  const workspaceId = trim(requestIdentity?.workspace?.id || requestIdentity?.workspace?.storedActiveId);
  const tenantId = trim(requestIdentity?.tenant?.id) || null;
  if (workspaceId) return { userId, workspaceId, tenantId };
  return resolveUserRuntimeScope(env, userId);
}

async function machineRuntimeScope(env: Env, request: Request, body: any) {
  const userId = trim(request.headers.get('X-User-Id') || body?.userId || body?.user_id);
  if (!userId) return null;
  const explicitWorkspaceId = trim(request.headers.get('X-Workspace-Id') || body?.workspaceId || body?.workspace_id);
  const explicitTenantId = trim(request.headers.get('X-Tenant-Id') || body?.tenantId || body?.tenant_id);
  if (explicitWorkspaceId) {
    return { userId, workspaceId: explicitWorkspaceId, tenantId: explicitTenantId || null };
  }
  const resolved = await resolveUserRuntimeScope(env, userId);
  if (!resolved) return null;
  return { ...resolved, tenantId: explicitTenantId || resolved.tenantId };
}

function laneForLegacyMachinePath(pathname: string): ExecLane | null {
  if (pathname === '/api/terminal/local') return 'local';
  if (pathname === '/api/terminal/vm') return 'remote';
  if (pathname === '/api/terminal/sandbox') return 'sandbox';
  if (pathname === '/api/terminal/environment') return 'environment';
  return null;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const identityAdapter = createCloudflareD1Adapter(env.DB);
    const identity = createIdentityService({ adapter: identityAdapter });
    const identityEnv = { ...env, ASSETS: env.APP_ASSETS };

    if (url.pathname === '/' && request.method === 'GET') {
      const homeUrl = new URL('/agentsam-home.html', request.url);
      return env.APP_ASSETS.fetch(new Request(homeUrl.toString(), request));
    }

    if (url.pathname === '/workbench' || url.pathname === '/agent/workbench') {
      return Response.redirect(new URL('/dashboard/agent', request.url).toString(), 308);
    }

    if (url.pathname === '/api/identity/health' && request.method === 'GET') {
      return json({
        ok: true,
        owner: 'app/backend/identity',
        loginProviders: LOGIN_IDP_PROVIDERS,
        tokenProviders: OAUTH_TOKEN_PROVIDERS,
        tableRoles: IDENTITY_TABLE_ROLES,
        forbiddenJwtAuthzClaims: JWT_FORBIDDEN_AUTHZ_CLAIMS,
      });
    }

    // Machine-to-machine compatibility routes. A bridge key proves machine
    // authority only; user/workspace scope must be explicit or resolvable from
    // the supplied X-User-Id. No implicit operator identity and no lane hop.
    const machineLane = laneForLegacyMachinePath(url.pathname);
    if (machineLane && request.method === 'POST') {
      if (!verifyBridgeKey(request, env)) return bridgeUnauthorized();
      const body = await request.json().catch(() => null) as any;
      const scope = await machineRuntimeScope(env, request, body);
      if (!scope) return json({ error: 'execution_identity_required' }, 400);
      const result = await executeTerminalLane(env, {
        ...scope,
        lane: machineLane,
        command: body?.command || '',
        cwd: body?.cwd,
        connectionId: body?.connectionId || body?.connection_id,
      });
      return json(result, result.ok ? 200 : 502);
    }

    if (url.pathname.startsWith('/api/auth') || url.pathname.startsWith('/api/oauth') || url.pathname.startsWith('/auth')) {
      const authResponse = await handleIdentityWorkerRequest(request, identityEnv, { identity });
      if (authResponse.status !== 404) return authResponse;
    }

    let session: any = null;
    try {
      session = await identity.sessionFromRequest(request);
    } catch (error) {
      console.warn('[auth] session resolution failed', error);
    }
    const authenticated = Boolean(session?.user);
    const requestIdentity = identityContextFromSdkSession(session);

    if (url.pathname === '/api/identity/me' && request.method === 'GET') {
      return authenticated ? json({ ok: true, identity: requestIdentity }) : json({ ok: false, error: 'session_required' }, 401);
    }

    // Durable Agent routes are always behind the same human IAM session gate.
    if (url.pathname.startsWith('/agents/')) {
      if (!authenticated) return json({ error: 'session_required' }, 401);
      const response = await routeAgentRequest(request, env);
      return response || json({ error: 'agent_route_not_found' }, 404);
    }

    if (url.pathname === '/api/agent/retrieval/query') {
      if (!authenticated) return json({ error: 'session_required' }, 401);
      const scope = await authenticatedRuntimeScope(env, requestIdentity);
      if (!scope) return json({ error: 'workspace_scope_required' }, 409);
      const response = await handleRetrievalHttpRequest(request, env, scope);
      return response || json({ error: 'retrieval_route_not_found' }, 404);
    }

    if (url.pathname === '/api/exec/status' && request.method === 'GET') {
      if (!authenticated) return json({ error: 'session_required' }, 401);
      const scope = await authenticatedRuntimeScope(env, requestIdentity);
      if (!scope) return json({ error: 'workspace_scope_required' }, 409);
      return json(await terminalRuntimeStatus(env, scope));
    }

    if (url.pathname === '/api/exec/preference' && request.method === 'PUT') {
      if (!authenticated) return json({ error: 'session_required' }, 401);
      const scope = await authenticatedRuntimeScope(env, requestIdentity);
      if (!scope) return json({ error: 'workspace_scope_required' }, 409);
      const body = await request.json().catch(() => null) as { lane?: string } | null;
      if (!isExecLane(body?.lane)) return json({ error: 'exec_lane_invalid' }, 400);
      await rememberExecLane(env, scope.userId, scope.workspaceId, body.lane);
      return json({ ok: true, lane: body.lane });
    }

    if (url.pathname === '/api/exec/run' && request.method === 'POST') {
      if (!authenticated) return json({ error: 'session_required' }, 401);
      const scope = await authenticatedRuntimeScope(env, requestIdentity);
      if (!scope) return json({ error: 'workspace_scope_required' }, 409);
      const body = await request.json().catch(() => null) as any;
      if (!isExecLane(body?.lane)) return json({ error: 'exec_lane_required' }, 400);
      const result = await executeTerminalLane(env, {
        ...scope,
        lane: body.lane,
        command: body?.command || '',
        cwd: body?.cwd,
        connectionId: body?.connectionId || body?.connection_id,
      });
      return json(result, result.ok ? 200 : 502);
    }

    if (url.pathname === '/api/exec/environment' && request.method === 'DELETE') {
      if (!authenticated) return json({ error: 'session_required' }, 401);
      const scope = await authenticatedRuntimeScope(env, requestIdentity);
      if (!scope) return json({ error: 'workspace_scope_required' }, 409);
      const result = await destroyTerminalEnvironment(env, scope);
      return json(result, result.ok ? 200 : 502);
    }

    // Temporary compatibility alias from the first Remix sprint. It is now an
    // explicit remote lane, not a separate execution authority.
    if (url.pathname === '/api/exec/host' && request.method === 'POST') {
      if (!authenticated) return json({ error: 'session_required' }, 401);
      const scope = await authenticatedRuntimeScope(env, requestIdentity);
      if (!scope) return json({ error: 'workspace_scope_required' }, 409);
      const body = await request.json().catch(() => null) as any;
      const result = await executeTerminalLane(env, {
        ...scope,
        lane: 'remote',
        command: body?.command || '',
        cwd: body?.cwd,
      });
      return json(result, result.ok ? 200 : 502);
    }

    // Live Browser Run state comes from the same Think Agent that owns Code
    // Mode. BrowserConnector persists the shared session id in this DO, so a
    // second browser-session DO would duplicate authority.
    if (url.pathname === '/api/browser/live-view' && request.method === 'GET') {
      if (!authenticated) return json({ error: 'session_required' }, 401);
      const userId = trim(requestIdentity?.user?.id);
      if (!userId) return json({ error: 'user_scope_required' }, 409);
      const agent = await getAgentByName(env.AgentSam as any, agentNameForUser(userId)) as any;
      return json(await agent.getBrowserLiveView());
    }

    if (url.pathname === '/api/browser/live-view' && request.method === 'DELETE') {
      if (!authenticated) return json({ error: 'session_required' }, 401);
      const userId = trim(requestIdentity?.user?.id);
      if (!userId) return json({ error: 'user_scope_required' }, 409);
      const agent = await getAgentByName(env.AgentSam as any, agentNameForUser(userId)) as any;
      return json(await agent.closeBrowserLiveView());
    }

    if (url.pathname === '/api/settings/ai-keys/gemini') {
      if (!authenticated) return json({ error: 'Unauthorized' }, 401);
      const userId = requestIdentity.user.id;
      const tenantId = requestIdentity.tenant.id || 'system';
      if (request.method === 'GET') return json(await getAiKeyStatus(env, userId));
      if (request.method === 'PUT') {
        const body = await request.json().catch(() => null) as { value?: string } | null;
        const value = body?.value?.trim();
        if (!value) return json({ error: 'value_required' }, 400);
        try { await setAiKey(env, userId, tenantId, value); }
        catch (error: any) { return json({ error: error?.message || 'set_failed' }, 500); }
        return json(await getAiKeyStatus(env, userId));
      }
      if (request.method === 'DELETE') {
        await clearAiKey(env, userId);
        return json(await getAiKeyStatus(env, userId));
      }
      return json({ error: 'method_not_allowed' }, 405);
    }

    if (url.pathname === '/api/gemini/generate' && request.method === 'POST') {
      if (!authenticated) return json({ error: 'Unauthorized' }, 401);
      const apiKey = await resolveAiKey(env, requestIdentity.user.id);
      if (!apiKey) return json({ error: 'no_gemini_key_configured' }, 503);
      const body = await request.json().catch(() => null) as any;
      if (!body?.prompt) return json({ error: 'prompt_required' }, 400);
      return streamGeminiPage(apiKey, body, request.signal);
    }

    if (url.pathname === '/api/vision/analyze') return json({ error: 'not_implemented' }, 501);
    if (url.pathname === '/api/mission/execute') return json({ error: 'use_agent_chat' }, 410);

    if (url.pathname === '/api/health') {
      const execos = await probeExecOS(env);
      return json({
        status: 'ok',
        runtime: 'cloudflare-worker',
        agent: 'Think',
        codeMode: true,
        browserRun: Boolean(env.MYBROWSER),
        browserSessionAuthority: 'AgentSam',
        execos: execos.ok,
        vpc: Boolean(env.PTY_SERVICE),
        sandbox: Boolean(env.MY_CONTAINER),
        environment: Boolean(execos.ok && execos.environmentConfigured),
        sessionCache: Boolean(env.SESSION_CACHE),
      });
    }

    if (request.method === 'GET' && env.APP_ASSETS) return env.APP_ASSETS.fetch(request);
    return json({ error: 'not_found' }, 404);
  },
} satisfies ExportedHandler<Env>;
