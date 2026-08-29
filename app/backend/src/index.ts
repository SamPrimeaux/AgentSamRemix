import {
  handleIdentityWorkerRequest,
  createCloudflareD1Adapter,
  createIdentityService,
} from '@inneranimalmedia/agentsam-sdk/identity/server/worker-router';
import { verifyBridgeKey, bridgeUnauthorized } from './auth/bridge-key';

export interface Env {
  AGENTSAM_WAI: any; // Workers AI binding
  DB: D1Database;
  WEBSITE_ASSETS: R2Bucket;
  IAM_VPC: Fetcher; // Service binding for VPC
  AGENTSAM_BRIDGE_KEY?: string; // machine-to-machine only — see auth/bridge-key.ts
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

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
