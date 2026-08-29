import { routeAgentRequest } from 'agents';
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
import { executeOnDefaultVm, getHostExecStatus } from '../agentsam/runtime/host-exec';
import type { Env } from './env';

export { AgentSam } from '../agentsam/runtime/AgentSam';
export { CodemodeRuntime } from '@cloudflare/codemode';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

    // Machine-to-machine compatibility. The bridge secret stays server-side;
    // the actual process boundary is the private ExecOS VPC service.
    if (url.pathname === '/api/terminal/vm' && request.method === 'POST') {
      if (!verifyBridgeKey(request, env)) return bridgeUnauthorized();
      const body = await request.json().catch(() => null) as { command?: string; cwd?: string } | null;
      const result = await executeOnDefaultVm(env, body?.command || '', { cwd: body?.cwd });
      return json(result, result.ok ? 200 : 502);
    }

    if (url.pathname === '/api/terminal/local' && request.method === 'POST') {
      if (!verifyBridgeKey(request, env)) return bridgeUnauthorized();
      return json({ error: 'not_implemented', lane: 'local', use: 'execos_vm' }, 501);
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

    // Direct terminal UI endpoint. This never accepts a bridge key from the browser.
    if (url.pathname === '/api/exec/status' && request.method === 'GET') {
      if (!authenticated) return json({ error: 'session_required' }, 401);
      return json(await getHostExecStatus(env));
    }

    if (url.pathname === '/api/exec/host' && request.method === 'POST') {
      if (!authenticated) return json({ error: 'session_required' }, 401);
      const body = await request.json().catch(() => null) as { command?: string; cwd?: string } | null;
      const result = await executeOnDefaultVm(env, body?.command || '', {
        cwd: body?.cwd,
        userId: requestIdentity.user.id,
        tenantId: requestIdentity.tenant.id || undefined,
      });
      return json(result, result.ok ? 200 : 502);
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

    // Retire demo endpoints rather than returning fabricated success data.
    if (url.pathname === '/api/vision/analyze') return json({ error: 'not_implemented' }, 501);
    if (url.pathname === '/api/mission/execute') return json({ error: 'use_agent_chat' }, 410);

    if (url.pathname === '/api/health') {
      const host = await getHostExecStatus(env);
      return json({
        status: 'ok',
        runtime: 'cloudflare-worker',
        agent: 'Think',
        codeMode: true,
        browserRun: Boolean(env.BROWSER),
        execos: host.ok,
      });
    }

    // Worker-first routes that are not API/agent requests still fall through to the SPA.
    if (request.method === 'GET' && env.APP_ASSETS) return env.APP_ASSETS.fetch(request);
    return json({ error: 'not_found' }, 404);
  },
} satisfies ExportedHandler<Env>;
