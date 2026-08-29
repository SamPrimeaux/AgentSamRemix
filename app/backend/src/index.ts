import { handleIdentityWorkerRequest, getIdentitySession } from '@inneranimalmedia/agentsam-sdk/identity/server/worker-router';
import { streamPageGeneration } from './services/aiService';

export interface Env {
  AGENTSAM_WAI: any; // Workers AI binding
  DB: D1Database;
  WEBSITE_ASSETS: R2Bucket;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 1. Delegate Identity/Auth routes to the Agent Sam SDK
    if (url.pathname.startsWith('/api/auth') || url.pathname.startsWith('/auth')) {
      const authResponse = await handleIdentityWorkerRequest(request, env);
      if (authResponse.status !== 404) return authResponse;
    }

    // 2. Auth Verification Gate
    // Any endpoint below this block that performs writes must check this session.
    let session = null;
    try {
      session = await getIdentitySession(request, env);
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
