/**
 * POST/GET /api/browser/run/:action — Browser Run Quick Actions (stateless CF REST).
 */
import { httpJsonResponse as jsonResponse } from '../responses.js';
import { getAuthUser } from '../../identity/index.js';
import { BROWSER_RUN_QUICKACTIONS } from '../../browser/quick-actions/actions.js';

const ACTION_TO_TOOL = {
  markdown: 'browser_run_markdown',
  content: 'browser_run_content',
  screenshot: 'browser_run_screenshot',
  links: 'browser_run_links',
  crawl: 'browser_run_crawl',
  json: 'browser_run_json',
  pdf: 'browser_run_pdf',
  scrape: 'browser_run_scrape',
  snapshot: 'browser_run_snapshot',
};

/**
 * @param {any} env
 * @param {Record<string, unknown>} payload
 */
function scheduleToolCallLog(env, payload) {
  if (!env?.DB) return;
  const tenantId =
    payload.tenantId != null && String(payload.tenantId).trim() !== ''
      ? String(payload.tenantId).trim()
      : '';
  const toolKey =
    payload.toolKey != null && String(payload.toolKey).trim() !== ''
      ? String(payload.toolKey).trim()
      : '';
  if (!tenantId || !toolKey) {
    console.warn('[browser_run tool_call_log] tenant_id_or_tool_key_required');
    return;
  }
  const p = (async () => {
    try {
      await env.DB.prepare(
        `INSERT INTO agentsam_tool_call_log
          (tenant_id, workspace_id, user_id, conversation_id, tool_key,
           status, duration_ms, error_message, tool_category, created_at_unix)
         VALUES (?,?,?,?,?,?,?,?,?,unixepoch())`,
      )
        .bind(
          tenantId,
          payload.workspaceId ?? null,
          payload.userId ?? null,
          payload.sessionId ?? null,
          toolKey,
          payload.status,
          payload.durationMs ?? null,
          payload.errorMessage ?? null,
          'browser_run',
        )
        .run();
    } catch (e) {
      console.warn('[browser_run tool_call_log]', e?.message ?? e);
    }
  })();
  void p;
}

/**
 * @param {Request} request
 * @param {URL} url
 * @param {any} env
 */
export async function handleBrowserRunQuickActionsRoute(request, url, env) {
  const pathNorm = url.pathname.replace(/\/+$/, '');
  const match = pathNorm.match(/^\/api\/browser\/run\/([^/]+)$/i);
  if (!match) return jsonResponse({ error: 'Browser Run quick action not found' }, 404);

  const action = String(match[1] || '').trim().toLowerCase();
  const fn = BROWSER_RUN_QUICKACTIONS[action];
  if (typeof fn !== 'function') {
    return jsonResponse({ error: `Unknown browser run action: ${action}` }, 404);
  }

  const authUser = await getAuthUser(request, env);
  if (!authUser?.id) return jsonResponse({ error: 'Unauthorized' }, 401);

  const method = request.method.toUpperCase();
  if (method !== 'POST' && method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let params = {};
  if (method === 'POST') {
    try {
      params = await request.json();
    } catch {
      params = {};
    }
  } else {
    for (const [k, v] of url.searchParams.entries()) {
      if (k === 'url') params.url = v;
      else if (k === 'full_page') params.full_page = v === 'true' || v === '1';
      else if (k === 'wait_for_network') params.wait_for_network = v === 'true' || v === '1';
      else if (k === 'prompt') params.prompt = v;
      else params[k] = v;
    }
  }

  const toolKey = ACTION_TO_TOOL[action] || `browser_run_${action}`;
  const t0 = Date.now();
  const result = await fn(env, params);
  const durationMs = Date.now() - t0;

  const workspaceId =
    params.workspace_id != null
      ? String(params.workspace_id).trim()
      : request.headers.get('x-iam-workspace-id') || null;

  scheduleToolCallLog(env, {
    tenantId: authUser.tenant_id ?? authUser.tenantId ?? null,
    workspaceId,
    userId: String(authUser.id),
    sessionId: params.session_id != null ? String(params.session_id) : null,
    toolName: toolKey,
    toolKey,
    status: result.ok ? 'success' : 'error',
    durationMs,
    errorMessage: result.ok ? null : String(result.error || 'unknown').slice(0, 1000),
    inputSummary: JSON.stringify({ url: params.url ?? null, action }).slice(0, 500),
    outputSummary: result.ok
      ? JSON.stringify({ ok: true, keys: Object.keys(result.data || result).slice(0, 12) }).slice(0, 500)
      : null,
  });

  if (!result.ok) {
    return jsonResponse({ ok: false, error: result.error, action, tool_key: toolKey }, 502);
  }

  return jsonResponse({
    ok: true,
    action,
    tool_key: toolKey,
    duration_ms: durationMs,
    ...result.data,
    ...(result.markdown != null ? { markdown: result.markdown } : {}),
    ...(result.html != null ? { html: result.html } : {}),
    ...(result.image_base64 != null ? { image_base64: result.image_base64 } : {}),
    ...(result.links != null ? { links: result.links } : {}),
    ...(result.job_id != null ? { job_id: result.job_id, status: result.status, records: result.records } : {}),
    ...(result.pdf_base64 != null ? { pdf_base64: result.pdf_base64 } : {}),
    ...(result.result != null ? { result: result.result } : {}),
    ...(result.screenshot != null ? { screenshot: result.screenshot } : {}),
    ...(result.markdown != null ? { markdown: result.markdown } : {}),
    ...(result.content != null && action === 'snapshot' ? { content: result.content } : {}),
    ...(result.accessibility_tree != null ? { accessibility_tree: result.accessibility_tree } : {}),
    ...(result.data && action === 'json' ? { data: result.data } : {}),
  });
}
