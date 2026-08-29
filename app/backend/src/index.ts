import { handleIdentityWorkerRequest, getIdentitySession } from '@inneranimalmedia/agentsam-sdk/identity/server/worker-router';
import { verifyBridgeKey, bridgeUnauthorized } from './auth/bridge-key';
import {
  probeVmTerminalViaVpc,
  runTerminalCommandViaHttpExec,
} from '../agentsam/terminal/vm-http-exec.js';

export interface Env {
  AGENTSAM_WAI: any;
  DB: any;
  ASSETS: any;
  WEBSITE_ASSETS: any;
  IAM_VPC: { fetch(request: Request): Promise<Response> };
  FRONTEND_ASSETS?: { fetch(request: Request): Promise<Response> };
  AGENTSAM_BRIDGE_KEY?: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = await request.json();
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
    const url = new URL(request.url);

    // 0. Machine-to-machine terminal routes.
    // The Worker authenticates the caller; terminal-daemon remains the execution authority.
    if (url.pathname === '/api/terminal/vm/health' && request.method === 'GET') {
      if (!verifyBridgeKey(request, env)) return bridgeUnauthorized();
      const result = await probeVmTerminalViaVpc(env);
      return json(result, result.ok ? 200 : 502);
    }

    if (url.pathname === '/api/terminal/vm' && request.method === 'POST') {
      if (!verifyBridgeKey(request, env)) return bridgeUnauthorized();

      const body = await readJsonBody(request);
      if (!body) return json({ error: 'invalid_json' }, 400);

      const command = typeof body.command === 'string' ? body.command.trim() : '';
      const cwd = typeof body.cwd === 'string' ? body.cwd.trim() : '';
      const execIdentity = (request.headers.get('X-IAM-Exec-Identity') || '').trim();

      if (!command) return json({ error: 'command_required' }, 400);
      if (!cwd) return json({ error: 'cwd_required' }, 400);
      if (!execIdentity) return json({ error: 'exec_identity_required' }, 400);

      const result = await runTerminalCommandViaHttpExec(env, command, {
        cwd,
        execIdentity,
        execActor: request.headers.get('X-IAM-Exec-Actor') || 'agentsamremix-worker',
        privilegedTargetId: request.headers.get('X-IAM-Privileged-Target'),
        userId: request.headers.get('X-User-Id'),
        workspaceId: request.headers.get('X-Workspace-Id'),
        tenantId: request.headers.get('X-Tenant-Id'),
      });

      if (result.ok) return json(result);
      const status =
        result.error === 'command_required' ||
        result.error === 'cwd_required' ||
        result.error === 'exec_identity_required'
          ? 400
          : 502;
      return json(result, status);
    }

    if (url.pathname === '/api/terminal/local' && request.method === 'POST') {
      if (!verifyBridgeKey(request, env)) return bridgeUnauthorized();
      return json(
        {
          error: 'not_implemented',
          lane: 'local',
          detail: 'Local Mac execution needs its own localpty/tunnel transport; IAM_VPC is the VM lane.',
        },
        501,
      );
    }

    // 1. Delegate Identity/Auth routes to the Agent Sam SDK.
    if (url.pathname.startsWith('/api/auth') || url.pathname.startsWith('/auth')) {
      const authResponse = await handleIdentityWorkerRequest(request, env);
      if (authResponse.status !== 404) return authResponse;
    }

    // 2. Human session gate for application APIs below this point.
    let session = null;
    try {
      session = await getIdentitySession(request, env);
    } catch (error) {
      console.warn('No valid session found:', error);
    }
    const isAuthenticated = !!session?.user;

    // 3. Application API routes.
    if (url.pathname === '/api/vision/analyze' && request.method === 'POST') {
      if (!isAuthenticated) return json({ error: 'Unauthorized' }, 401);

      return json({
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
      });
    }

    if (url.pathname === '/api/mission/execute' && request.method === 'POST') {
      if (!isAuthenticated) {
        return json({ error: 'Not Implemented - Auth Required' }, 501);
      }
      return json({ status: 'queued' });
    }

    if (url.pathname === '/api/health') {
      return json({
        status: 'ok',
        runtime: 'cloudflare-worker',
        authConfigured: true,
        vmVpcBound: !!env.IAM_VPC,
      });
    }

    // API misses must stay JSON 404s instead of falling into SPA navigation handling.
    if (url.pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);

    // 4. Frontend assets. Cloudflare's asset router handles normal SPA navigation first;
    // this binding is available for explicit Worker fallback paths.
    if (env.FRONTEND_ASSETS) return env.FRONTEND_ASSETS.fetch(request);

    return new Response('Not Found', { status: 404 });
  },
};
