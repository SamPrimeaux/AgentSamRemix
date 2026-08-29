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
import { getAiKeyStatus, setAiKey, clearAiKey } from './lib/aiKeyStore';
import { resolveAiKey } from './lib/aiKeyStore';
import { streamGeminiPage } from './lib/geminiProxy';

export interface Env {
  AGENTSAM_WAI: any; // Workers AI binding
  DB: D1Database;
  WEBSITE_ASSETS: R2Bucket;
  APP_ASSETS: Fetcher; // Vite/static frontend assets
  IAM_VPC: Fetcher; // Service binding for VPC
  AGENTSAM_BRIDGE_KEY?: string;

  // Human OAuth login applications.
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;

  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;

  IAM_CLIENT_ID?: string;
  IAM_CLIENT_SECRET?: string;
  IAM_OAUTH_ISSUER?: string; // machine-to-machine only — see auth/bridge-key.ts

  // Runtime-swappable AI provider keys — see lib/aiKeyStore.ts
  SECRETS_ENCRYPTION_KEY?: string;
  GEMINI_API_KEY?: string;
  GOOGLE_AI_API_KEY?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Portable identity-kernel readiness.
    // Login/session transport remains single-owned by the SDK below.
    if (
      url.pathname === '/api/identity/health' &&
      request.method === 'GET'
    ) {
      return new Response(JSON.stringify({
        ok: true,
        owner: 'app/backend/identity',
        loginProviders: LOGIN_IDP_PROVIDERS,
        tokenProviders: OAUTH_TOKEN_PROVIDERS,
        tableRoles: IDENTITY_TABLE_ROLES,
        forbiddenJwtAuthzClaims: JWT_FORBIDDEN_AUTHZ_CLAIMS,
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      });
    }

    // Legacy route: keep old links working while /agent/workbench is canonical.
    if (url.pathname === '/workbench') {
      return Response.redirect(
        new URL('/agent/workbench', request.url).toString(),
        308,
      );
    }

    // Identity is resolved once per request.
    const identityAdapter = createCloudflareD1Adapter(env.DB);
    const identity = createIdentityService({
      adapter: identityAdapter,
    });

    // AgentSam SDK expects ASSETS.fetch() to mean static frontend assets.
    // AgentSamRemix reserves env.ASSETS for the inneranimalmedia R2 bucket,
    // so adapt the name only at the SDK boundary.
    const identityEnv = {
      ...env,
      ASSETS: env.APP_ASSETS,
    };

    // Public Agent Sam landing page.
    // /agent/workbench is the canonical React Agent Sam application.
    if (
      url.pathname === '/' &&
      request.method === 'GET' &&
      env.APP_ASSETS
    ) {
      const homeUrl = new URL('/agentsam-home.html', request.url);
      return env.APP_ASSETS.fetch(
        new Request(homeUrl.toString(), request),
      );
    }

    // 0. Machine-to-machine routes — bridge key only, never user session.
    // Real PTY/VM wiring is not implemented yet. This gate is real; the
    // execution behind it is deliberately not — see comments below.
    if (url.pathname === '/api/terminal/local' && request.method === 'POST') {
      if (!verifyBridgeKey(request, env)) return bridgeUnauthorized();
      // TODO: connect to a localpty daemon session over WebSocket, same
      // shape as inneranimalmedia's agentsam_terminal_local lane. Not
      // wired yet — do not fake a successful exec here.
      return new Response(JSON.stringify({ error: 'not_implemented', lane: 'local' }), {
        status: 501,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/api/terminal/vm' && request.method === 'POST') {
      if (!verifyBridgeKey(request, env)) return bridgeUnauthorized();
      // TODO: connect to a GCP VM terminal replica, same shape as
      // inneranimalmedia's remote lane. Not wired yet.
      return new Response(JSON.stringify({ error: 'not_implemented', lane: 'vm' }), {
        status: 501,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 1. Delegate Identity/Auth routes to the Agent Sam SDK
    if (
      url.pathname.startsWith('/api/auth') ||
      url.pathname.startsWith('/api/oauth') ||
      url.pathname.startsWith('/auth')
    ) {
      const authResponse = await handleIdentityWorkerRequest(
        request,
        identityEnv,
        { identity },
      );
      if (authResponse.status !== 404) return authResponse;
    }

    // 2. Auth Verification Gate
    // Any endpoint below this block that performs writes must check this session.
    let session = null;
    try {
      session = await identity.sessionFromRequest(request);
    } catch (e) {
      console.warn("No valid session found:", e);
    }
    const isAuthenticated = !!session?.user;
    const requestIdentity = identityContextFromSdkSession(session);

    if (
      url.pathname === '/api/identity/me' &&
      request.method === 'GET'
    ) {
      if (!requestIdentity.authenticated) {
        return new Response(JSON.stringify({
          ok: false,
          error: 'session_required',
        }), {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          },
        });
      }

      return new Response(JSON.stringify({
        ok: true,
        identity: requestIdentity,
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'private, no-store',
        },
      });
    }

    // 3. API Routes
    if (url.pathname === '/api/vision/analyze' && request.method === 'POST') {
      if (!isAuthenticated) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
      }

      // Vision Analysis logic using env.AGENTSAM_WAI goes here
      return new Response(JSON.stringify({
        id: `vis_${Date.now()}`,
        classification: 'UI_MOCKUP',
        confidence: 0.94,
        title: 'Mobile UI Spec',
        summary: 'Agent Sam vision parser analyzed image via Workers AI.',
        ocrText: 'Placeholder OCR',
        detectedEntities: [],
        suggestedActions: [],
        suggestedMissionPrompt: 'Placeholder mission',
        codeSnippetProposal: '',
        analyzedAt: Date.now(),
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // AI provider key management — runtime-swappable, no redeploy needed.
    // GET returns status only (never the raw key). PUT/DELETE require auth.
    if (url.pathname === '/api/settings/ai-keys/gemini') {
      if (!isAuthenticated) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
      }
      const userId = requestIdentity.user.id;
      const tenantId = requestIdentity.tenant.id || 'system';

      if (request.method === 'GET') {
        const status = await getAiKeyStatus(env, userId);
        return new Response(JSON.stringify(status), { headers: { 'Content-Type': 'application/json' } });
      }

      if (request.method === 'PUT') {
        const body = await request.json().catch(() => null) as { value?: string } | null;
        const value = body?.value?.trim();
        if (!value) {
          return new Response(JSON.stringify({ error: 'value_required' }), { status: 400 });
        }
        try {
          await setAiKey(env, userId, tenantId, value);
        } catch (e: any) {
          return new Response(JSON.stringify({ error: e?.message || 'set_failed' }), { status: 500 });
        }
        const status = await getAiKeyStatus(env, userId);
        return new Response(JSON.stringify(status), { headers: { 'Content-Type': 'application/json' } });
      }

      if (request.method === 'DELETE') {
        await clearAiKey(env, userId);
        const status = await getAiKeyStatus(env, userId);
        return new Response(JSON.stringify(status), { headers: { 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405 });
    }

    // Server-side Gemini proxy — the API key never leaves the Worker.
    // Resolves the caller's stored key override if set, else env.GEMINI_API_KEY.
    if (url.pathname === '/api/gemini/generate' && request.method === 'POST') {
      if (!isAuthenticated) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
      }
      const apiKey = await resolveAiKey(env, requestIdentity.user.id);
      if (!apiKey) {
        return new Response(JSON.stringify({ error: 'no_gemini_key_configured' }), { status: 503 });
      }
      const body = await request.json().catch(() => null) as any;
      if (!body?.prompt) {
        return new Response(JSON.stringify({ error: 'prompt_required' }), { status: 400 });
      }
      return streamGeminiPage(apiKey, body, request.signal);
    }

    if (url.pathname === '/api/mission/execute' && request.method === 'POST') {
      if (!isAuthenticated) {
        // Return 501 Not Implemented as requested for blocked write paths
        return new Response(JSON.stringify({ error: 'Not Implemented - Auth Required' }), {
          status: 501,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      // Write logic would go here
      return new Response(JSON.stringify({ status: 'queued' }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        runtime: 'cloudflare-worker',
        authConfigured: true
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // 4. Fallback to Frontend Static Assets (handled via Cloudflare Pages or Asset binding in production)
    return new Response('Not Found', { status: 404 });
  }
};
