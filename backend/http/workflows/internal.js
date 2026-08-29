/**
 * Internal workflow endpoints — service-binding only (iam-workflows → platform).
 */

import { verifyBridgeKey } from '../../auth/bridge-key-auth.js';
import {
  executeDurableWorkflowNode,
  finalizeDurableWorkflowRun,
} from '../../workflows/index.js';

export async function handleInternalWorkflowRequest(request, env, url) {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  if (!verifyBridgeKey(request, env)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (path === '/api/internal/workflow/execute-node' && method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'invalid json' }, { status: 400 });
    }
    const result = await executeDurableWorkflowNode(env, body);
    const status = result.ok ? 200 : result.error === 'run_not_found' ? 404 : 500;
    return Response.json(result, { status });
  }

  if (path === '/api/internal/workflow/finalize-run' && method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'invalid json' }, { status: 400 });
    }
    const result = await finalizeDurableWorkflowRun(env, body);
    return Response.json(result, { status: result.ok ? 200 : 500 });
  }

  return null;
}
