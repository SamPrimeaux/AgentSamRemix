/**
 * POST /api/internal/browser/capture-context — bridge-key smoke / automation.
 * Exercises executeBrowserCaptureContext on the live Worker (MYBROWSER + D1).
 */
import { verifyBridgeKey } from '../../auth/bridge-key-auth.js';
import { executeBrowserCaptureContext } from '../../browser/capture/context.js';

export async function handleBrowserCaptureContextInternal(request, url, env) {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path.toLowerCase() !== '/api/internal/browser/capture-context') return null;
  if (request.method.toUpperCase() !== 'POST') {
    return Response.json({ error: 'method_not_allowed', allowed: 'POST' }, { status: 405 });
  }
  if (!verifyBridgeKey(request, env)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }

  const input = body.input ?? body;
  const runContext = body.runContext && typeof body.runContext === 'object' ? body.runContext : {};
  const meta = runContext.runMeta && typeof runContext.runMeta === 'object' ? runContext.runMeta : {};

  const userId = String(
    meta.userId ?? runContext.userId ?? input.user_id ?? body.user_id ?? '',
  ).trim();
  const workspaceId = String(
    meta.workspaceId ?? runContext.workspaceId ?? input.workspace_id ?? body.workspace_id ?? '',
  ).trim();
  const tenantId = String(
    meta.tenantId ?? runContext.tenantId ?? input.tenant_id ?? body.tenant_id ?? '',
  ).trim();

  const browserSessionIdRaw =
    body.browser_session_id ??
    body.browserSessionId ??
    runContext.browser_session_id ??
    runContext.browserSessionId ??
    input.browser_session_id ??
    input.browserSessionId ??
    input.browserContext?.browser_session_id ??
    input.browserContext?.browserSessionId ??
    null;
  const browserSessionId =
    browserSessionIdRaw != null && String(browserSessionIdRaw).trim().startsWith('bsess_')
      ? String(browserSessionIdRaw).trim()
      : null;

  const enrichedContext = {
    ...runContext,
    userId,
    workspaceId,
    tenantId,
    ...(browserSessionId ? { browser_session_id: browserSessionId } : {}),
    runMeta: {
      ...meta,
      userId,
      workspaceId,
      tenantId,
    },
  };

  const out = await executeBrowserCaptureContext(env, input, enrichedContext);
  return Response.json(out, { status: out?.ok === false ? 400 : 200 });
}
