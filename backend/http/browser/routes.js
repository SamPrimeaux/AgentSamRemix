/**
 * Browser HTTP routes — the browser control plane and its job records.
 * Imports browser domain; must not be imported by backend/browser.
 */
import { httpJsonResponse as jsonResponse } from '../responses.js';
import { getAuthUser } from '../../identity/index.js';
import { assertFetchDomainAllowed } from '../../auth/policy-guards.js';
import { assertBrowserTrustedOrigin } from '../../browser/policy/trust.js';
import {
  runBrowserBuiltinTool,
  resolveBrowserToolUrl,
} from '../../browser/tools/dispatch.js';
import { newBrowserSessionId, resolveBrowserSessionScopeId, isBrowserSessionId } from '../../browser/sessions/scope.js';
import {
  refreshAgentLiveBrowserLiveUrl,
  signalHumanInputResume,
  ensureAgentLiveBrowserSession,
  getAgentLiveBrowserSession,
  closeAgentLiveBrowserSession,
  cancelBrowserHumanInput,
} from '../../browser/sessions/live-session.js';
import {
  assertBrowserSessionAccess,
  getBrowserLiveDoHealth,
  getBrowserLiveEventsViaDo,
  proxyBrowserLiveWebSocket,
  refreshAgentLiveBrowserUrlViaDo,
} from '../../browser/sessions/client.js';
import {
  openBrowserRunLiveView,
  deleteBrowserRunSession as deleteCfBrowserRunSession,
  refreshBrowserRunLiveView,
  applyBrowserRunLiveViewMode,
} from '../../browser/cloudflare/browser-run.js';
import { runPlaywrightScreenshotJob } from '../../browser/runtime/screenshot.js';

/**
 * Browser Run HTTP boundary — existing D1 allowlist tables:
 *   agentsam_browser_trusted_origin (embed/trust modal)
 *   agentsam_fetch_domain_allowlist (hostname fetch gate)
 * Tool execution still intersects agentsam_mcp_allowlist via agent-policy.
 */
async function assertBrowserRunTargetAllowed(env, { userId, workspaceId, url }) {
  await assertBrowserTrustedOrigin(env, { userId, workspaceId, origin: url });
  const fetchGate = await assertFetchDomainAllowed(env, userId, workspaceId, url);
  if (!fetchGate.ok) {
    throw new Error(fetchGate.error || 'Domain not in your fetch allowlist');
  }
}

/** @param {URL} url @param {Record<string, unknown>} [body] */
function browserSessionIdFrom(url, body = {}) {
  const q = url.searchParams.get('browser_session_id')?.trim() || '';
  if (isBrowserSessionId(q)) return q;
  const resolved = resolveBrowserSessionScopeId(body);
  return resolved || '';
}

/**
 * Handle Browser-related API requests (/api/browser/*).
 *
 * IMPORTANT: The MYBROWSER binding (Cloudflare Browser Rendering / @cloudflare/playwright)
 * is ONLY required for /api/browser/invoke (and /api/browser/jobs/* routes).
 * ALL other routes — /api/browser/session, /api/browser/live/*, /api/browser/run/* —
 * use either the Cloudflare Browser Run REST API or the AgentBrowserLiveV1 DO and
 * must NOT be gated on env.MYBROWSER.
 */
export async function handleBrowserRequest(request, url, env) {
    const pathLower = url.pathname.toLowerCase();
    const pathNorm = pathLower.replace(/\/$/, '') || '/';
    const method = request.method.toUpperCase();

    if (pathNorm === '/api/browser/jobs' || pathNorm.startsWith('/api/browser/jobs/')) {
        return handleBrowserJobsApi(request, env, url);
    }

    // ── POST /api/browser/sessions — mint bsess_* lease id (DO auth stamped on ensure) ─
    if (pathNorm === '/api/browser/sessions' && method === 'POST') {
        const authUser = await getAuthUser(request, env);
        if (!authUser?.id) return jsonResponse({ error: 'Unauthorized' }, 401);
        return jsonResponse({ ok: true, browser_session_id: newBrowserSessionId() });
    }

    // ── GET /api/browser/live/ws?browser_session_id= — WebSocket live browser state ─
    if (pathNorm === '/api/browser/live/ws' && request.headers.get('Upgrade') === 'websocket') {
        const authUser = await getAuthUser(request, env);
        if (!authUser?.id) return new Response('Unauthorized', { status: 401 });
        const browserSessionId = browserSessionIdFrom(url);
        if (!browserSessionId) return new Response('browser_session_id required (bsess_*)', { status: 400 });
        const access = await assertBrowserSessionAccess(env, browserSessionId, String(authUser.id));
        if (!access.ok) return new Response(access.error || 'Forbidden', { status: access.status || 403 });
        if (!env.BROWSER_SESSION) {
            return new Response('BROWSER_SESSION Durable Object not configured', { status: 503 });
        }
        return proxyBrowserLiveWebSocket(env, browserSessionId, request);
    }

    // ── GET /api/browser/live/:browserSessionId/live-url — refresh via DO ───────────
    const liveUrlByRunMatch = pathNorm.match(/^\/api\/browser\/live\/([^/]+)\/live-url$/);
    if (liveUrlByRunMatch && method === 'GET') {
        const authUser = await getAuthUser(request, env);
        if (!authUser?.id) return jsonResponse({ error: 'Unauthorized' }, 401);
        const browserSessionId = decodeURIComponent(liveUrlByRunMatch[1]);
        const access = await assertBrowserSessionAccess(env, browserSessionId, String(authUser.id));
        if (!access.ok) return jsonResponse({ error: access.error }, access.status || 403);
        const out = await refreshAgentLiveBrowserUrlViaDo(env, browserSessionId);
        if (!out.ok) return jsonResponse({ error: out.error || 'Failed to refresh live view URL' }, out.status || 502);
        return jsonResponse(out);
    }

    // ── GET /api/browser/live/:agentRunId/events — timeline outbox ───────────
    // No MYBROWSER needed.
    const liveEventsMatch = pathNorm.match(/^\/api\/browser\/live\/([^/]+)\/events$/);
    if (liveEventsMatch && method === 'GET') {
        const authUser = await getAuthUser(request, env);
        if (!authUser?.id) return jsonResponse({ error: 'Unauthorized' }, 401);
        const browserSessionId = decodeURIComponent(liveEventsMatch[1]);
        const access = await assertBrowserSessionAccess(env, browserSessionId, String(authUser.id));
        if (!access.ok) return jsonResponse({ error: access.error }, access.status || 403);
        const limit = url.searchParams.get('limit');
        const out = await getBrowserLiveEventsViaDo(env, browserSessionId, limit ? Number(limit) : 50);
        return jsonResponse(out, out.ok ? 200 : out.status || 502);
    }

    // ── GET /api/browser/live/:agentRunId/health — DO health probe ───────────
    // No MYBROWSER needed.
    const liveHealthMatch = pathNorm.match(/^\/api\/browser\/live\/([^/]+)\/health$/);
    if (liveHealthMatch && method === 'GET') {
        const authUser = await getAuthUser(request, env);
        if (!authUser?.id) return jsonResponse({ error: 'Unauthorized' }, 401);
        const browserSessionId = decodeURIComponent(liveHealthMatch[1]);
        const access = await assertBrowserSessionAccess(env, browserSessionId, String(authUser.id));
        if (!access.ok) return jsonResponse({ error: access.error }, access.status || 403);
        const out = await getBrowserLiveDoHealth(env, browserSessionId);
        return jsonResponse(out, out.status && out.status !== 200 ? out.status : 200);
    }

    // ── GET /api/browser/live/:agentRunId — full live session snapshot ─────────
    // No MYBROWSER needed.
    const liveSessionMatch = pathNorm.match(/^\/api\/browser\/live\/([^/]+)$/);
    if (liveSessionMatch && method === 'GET') {
        const authUser = await getAuthUser(request, env);
        if (!authUser?.id) return jsonResponse({ error: 'Unauthorized' }, 401);
        const browserSessionId = decodeURIComponent(liveSessionMatch[1]);
        const access = await assertBrowserSessionAccess(env, browserSessionId, String(authUser.id));
        if (!access.ok) return jsonResponse({ error: access.error }, access.status || 403);
        const session = await getAgentLiveBrowserSession(env, browserSessionId);
        if (!session) return jsonResponse({ ok: false, error: 'no live session' }, 404);
        return jsonResponse({ ok: true, live_session: session, browser_session_id: browserSessionId });
    }

    // ── GET /api/browser/session/:sessionId/live-url — refresh devtoolsFrontendUrl ─
    // Uses CF Browser Run REST API — no MYBROWSER needed.
    const liveUrlMatch = pathNorm.match(/^\/api\/browser\/session\/([^/]+)\/live-url$/);
    if (liveUrlMatch && method === 'GET') {
        const authUser = await getAuthUser(request, env);
        if (!authUser?.id) return jsonResponse({ error: 'Unauthorized' }, 401);

        const sessionId = decodeURIComponent(liveUrlMatch[1]);
        const scopeId =
            url.searchParams.get('browser_session_id')?.trim() ||
            url.searchParams.get('scope_id')?.trim() ||
            '';
        const targetId = url.searchParams.get('target_id')?.trim() || null;

        if (scopeId && isBrowserSessionId(scopeId)) {
            const access = await assertBrowserSessionAccess(env, scopeId, String(authUser.id));
            if (!access.ok) return jsonResponse({ error: access.error }, access.status || 403);
            const out = await refreshAgentLiveBrowserLiveUrl(env, {
                sessionId,
                scopeId,
                targetId,
            });
            if (!out.ok) {
                return jsonResponse({ error: out.error || 'Failed to refresh live view URL' }, out.status || 502);
            }
            return jsonResponse({
                ok: true,
                session_id: out.session_id ?? sessionId,
                target_id: out.target_id ?? targetId,
                devtools_frontend_url: out.devtools_frontend_url,
                web_socket_debugger_url: out.web_socket_debugger_url,
                url: out.url,
                title: out.title,
                expires_at: out.expires_at,
            });
        }
        const refreshed = await refreshBrowserRunLiveView(env, { sessionId, targetId });
        if (!refreshed.ok) {
            return jsonResponse({ error: refreshed.error || 'Failed to refresh live view URL' }, 502);
        }
        const embedUrl = applyBrowserRunLiveViewMode(refreshed.devtoolsFrontendUrl, 'tab');
        return jsonResponse({
            ok: true,
            session_id: sessionId,
            target_id: refreshed.targetId,
            devtools_frontend_url: embedUrl,
            web_socket_debugger_url: refreshed.webSocketDebuggerUrl,
            url: refreshed.url,
            title: refreshed.title,
            expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        });
    }

    // ── POST /api/browser/session/human-resume — human clicked Continue (HITL) ─
    // Routes to AgentBrowserLiveV1 DO — no MYBROWSER needed.
    if (pathNorm === '/api/browser/session/human-resume' && method === 'POST') {
        const authUser = await getAuthUser(request, env);
        if (!authUser?.id) return jsonResponse({ error: 'Unauthorized' }, 401);
        let body = {};
        try {
            body = await request.json();
        } catch {
            body = {};
        }
        const scopeId = browserSessionIdFrom(url, {
            ...body,
            browser_session_id: body.browser_session_id ?? body.scope_id,
        });
        if (!scopeId) return jsonResponse({ error: 'browser_session_id required (bsess_*)' }, 400);
        const access = await assertBrowserSessionAccess(env, scopeId, String(authUser.id));
        if (!access.ok) return jsonResponse({ error: access.error }, access.status || 403);
        const out = await signalHumanInputResume(env, scopeId);
        if (!out.ok) return jsonResponse(out, 400);
        return jsonResponse(out);
    }

    // ── POST /api/browser/session/human-cancel — user cancelled HITL ───────────
    // Routes to AgentBrowserLiveV1 DO — no MYBROWSER needed.
    if (pathNorm === '/api/browser/session/human-cancel' && method === 'POST') {
        const authUser = await getAuthUser(request, env);
        if (!authUser?.id) return jsonResponse({ error: 'Unauthorized' }, 401);
        let body = {};
        try {
            body = await request.json();
        } catch {
            body = {};
        }
        const scopeId = browserSessionIdFrom(url, {
            ...body,
            browser_session_id: body.browser_session_id ?? body.scope_id,
        });
        if (!scopeId) return jsonResponse({ error: 'browser_session_id required (bsess_*)' }, 400);
        const access = await assertBrowserSessionAccess(env, scopeId, String(authUser.id));
        if (!access.ok) return jsonResponse({ error: access.error }, access.status || 403);
        const out = await cancelBrowserHumanInput(env, scopeId);
        return jsonResponse(out, out.ok ? 200 : out.status || 400);
    }

    // ── POST /api/browser/session/close — end run-scoped MYBROWSER session ─
    // Routes to DO or KV — no MYBROWSER needed.
    if (pathNorm === '/api/browser/session/close' && method === 'POST') {
        const authUser = await getAuthUser(request, env);
        if (!authUser?.id) return jsonResponse({ error: 'Unauthorized' }, 401);
        let body = {};
        try {
            body = await request.json();
        } catch {
            body = {};
        }
        const scopeId = browserSessionIdFrom(url, {
            ...body,
            browser_session_id: body.browser_session_id ?? body.scope_id,
        });
        if (!scopeId) return jsonResponse({ error: 'browser_session_id required (bsess_*)' }, 400);
        const access = await assertBrowserSessionAccess(env, scopeId, String(authUser.id));
        if (!access.ok) return jsonResponse({ error: access.error }, access.status || 403);
        if (env.BROWSER_SESSION) {
            const result = await closeAgentLiveBrowserSession(env, scopeId);
            return jsonResponse(result, result.ok ? 200 : result.status || 400);
        }
        return jsonResponse({ ok: false, error: 'BROWSER_SESSION not configured' }, 503);
    }

    // ── POST /api/browser/session — Browser Run Live View (live.browser.run embed) ─
    // Uses Cloudflare Browser Run REST API + AgentBrowserLiveV1 DO — no MYBROWSER needed.
    if (pathNorm === '/api/browser/session' && method === 'POST') {
        const authUser = await getAuthUser(request, env);
        if (!authUser?.id) return jsonResponse({ error: 'Unauthorized' }, 401);

        let body = {};
        try {
            body = await request.json();
        } catch {
            body = {};
        }

        const targetUrl = resolveBrowserToolUrl(body);
        if (!targetUrl) return jsonResponse({ error: 'url required' }, 400);

        const workspaceId =
            body.workspace_id != null
                ? String(body.workspace_id).trim()
                : request.headers.get('x-iam-workspace-id') || null;

        try {
            await assertBrowserRunTargetAllowed(env, {
                userId: String(authUser.id),
                workspaceId,
                url: targetUrl,
            });
        } catch (e) {
            return jsonResponse({ error: String(e?.message || e), blocked: true }, 403);
        }

        const keepAliveRaw = body.keep_alive_ms ?? body.keep_alive;
        const keepAliveMs =
            keepAliveRaw != null && Number.isFinite(Number(keepAliveRaw))
                ? Number(keepAliveRaw)
                : undefined;
        const browserSessionId = browserSessionIdFrom(url, body);
        const agentRunId =
            body.agent_run_id != null
                ? String(body.agent_run_id).trim() || null
                : body.agentRunId != null
                  ? String(body.agentRunId).trim() || null
                  : null;

        if (browserSessionId) {
            const access = await assertBrowserSessionAccess(env, browserSessionId, String(authUser.id));
            if (!access.ok) return jsonResponse({ error: access.error }, access.status || 403);
            const ensured = await ensureAgentLiveBrowserSession(env, browserSessionId, {
                url: targetUrl,
                keepAliveMs,
                userId: String(authUser.id),
                workspaceId,
                agentRunId,
            });
            if (!ensured.ok) {
                return jsonResponse({ error: ensured.error || 'Browser Run session failed' }, ensured.status || 502);
            }
            return jsonResponse({
                ok: true,
                browser_session_id: browserSessionId,
                agent_run_id: agentRunId,
                session_id: ensured.session_id ?? ensured.live_session?.session_id,
                devtools_frontend_url:
                    ensured.live_session?.devtools_frontend_url ?? ensured.browser_session?.devtools_frontend_url,
                web_socket_debugger_url:
                    ensured.live_session?.web_socket_debugger_url ?? ensured.browser_session?.web_socket_debugger_url,
                url: ensured.live_session?.url ?? targetUrl,
                title: ensured.live_session?.title ?? null,
                target_id: ensured.live_session?.target_id ?? ensured.browser_session?.target_id ?? null,
                live_session: ensured.live_session,
            });
        }

        const reuseSessionId =
            body.session_id != null ? String(body.session_id).trim() : '';

        const out = await openBrowserRunLiveView(env, {
            url: targetUrl,
            sessionId: reuseSessionId || null,
            keepAliveMs,
        });
        if (!out.ok) {
            const status = out.status === 401 || out.status === 403 ? out.status : 502;
            return jsonResponse({ error: out.error || 'Browser Run session failed' }, status);
        }

        return jsonResponse({
            ok: true,
            session_id: out.session_id,
            devtools_frontend_url: out.devtools_frontend_url,
            web_socket_debugger_url: out.web_socket_debugger_url ?? null,
            url: out.url,
            title: out.title ?? null,
            target_id: out.target_id ?? null,
        });
    }

    // ── DELETE /api/browser/session — release Browser Run CDP session ─────────
    // Uses CF Browser Run REST API — no MYBROWSER needed.
    if (pathNorm === '/api/browser/session' && method === 'DELETE') {
        const authUser = await getAuthUser(request, env);
        if (!authUser?.id) return jsonResponse({ error: 'Unauthorized' }, 401);

        let body = {};
        try {
            body = await request.json();
        } catch {
            body = {};
        }
        const sessionId = String(
            body.session_id ?? body.sessionId ?? url.searchParams.get('session_id') ?? '',
        ).trim();
        if (!sessionId) return jsonResponse({ error: 'session_id required' }, 400);

        const out = await deleteCfBrowserRunSession(env, { sessionId });
        if (!out.ok) {
            return jsonResponse({ error: out.error || 'Failed to close Browser Run session' }, 502);
        }
        return jsonResponse({ ok: true, session_id: sessionId, status: out.status ?? 'closing' });
    }

    // ── /api/browser/run/:action (Browser Run Quick Actions) ─────────────────
    // Quick actions may or may not use MYBROWSER; each fn checks internally.
    if (/^\/api\/browser\/run\/[^/]+\/?$/i.test(pathNorm)) {
        const { handleBrowserRunQuickActionsRoute } = await import('./quick-actions.js');
        return handleBrowserRunQuickActionsRoute(request, url, env);
    }

    // ── Routes below this line require MYBROWSER binding ─────────────────────

    if (!env.MYBROWSER) {
        return jsonResponse({
            error: 'MYBROWSER binding not configured',
            hint: 'Add Browser Rendering binding in Cloudflare dashboard and wrangler.production.toml',
            path: url.pathname,
        }, 503);
    }

    // ── POST /api/browser/invoke — session auth; MYBROWSER tools (no MCP hop) ─
    if (pathLower === '/api/browser/invoke' && method === 'POST') {
        const authUser = await getAuthUser(request, env);
        if (!authUser?.id) return jsonResponse({ error: 'Unauthorized' }, 401);

        let body = {};
        try {
            body = await request.json();
        } catch {
            body = {};
        }

        const toolName = String(body.tool_name || body.tool || '').trim();
        const params =
            body.params && typeof body.params === 'object'
                ? { ...body.params }
                : body.arguments && typeof body.arguments === 'object'
                  ? { ...body.arguments }
                  : {};

        if (!toolName) return jsonResponse({ error: 'tool_name required' }, 400);

        const targetUrl =
            params.url ?? params.origin ?? params.href ?? params.target_url ?? params.page_url;
        if (targetUrl) {
            const ws =
                params.workspace_id != null
                    ? String(params.workspace_id).trim()
                    : request.headers.get('x-iam-workspace-id') || null;
            try {
                await assertBrowserRunTargetAllowed(env, {
                    userId: String(authUser.id),
                    workspaceId: ws,
                    url: targetUrl,
                });
            } catch (e) {
                return jsonResponse({ error: String(e?.message || e), blocked: true }, 403);
            }
        }

        params.user_id = params.user_id ?? String(authUser.id);
        const wsHeader = request.headers.get('x-iam-workspace-id');
        if (wsHeader && !params.workspace_id) params.workspace_id = wsHeader;

        const result = await runBrowserBuiltinTool(env, toolName, params);
        if (result?.error && !result?.ok) {
            const status = result.blocked ? 403 : result.hint?.includes('MYBROWSER') ? 503 : 500;
            return jsonResponse(result, status);
        }
        return jsonResponse(result);
    }

    return jsonResponse({ error: 'Browser route not found' }, 404);
}

/**
 * Handle browser job tracking (/api/browser/jobs/*).
 *
 * - GET /api/browser/jobs — list jobs for current user.
 * - GET /api/browser/jobs/:id — single job status (user-scoped).
 * - POST /api/browser/jobs/screenshot — create and run a screenshot job.
 */
export async function handleBrowserJobsApi(request, env, url) {
    const pathname = (url instanceof URL ? url : new URL(request.url)).pathname.toLowerCase();
    const pathNorm = pathname.replace(/\/$/, '') || '/';
    const method = request.method.toUpperCase();
    const authUser = await getAuthUser(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);

    // ── POST /api/browser/jobs/screenshot ──────────────────────────────────
    if (pathNorm === '/api/browser/jobs/screenshot' && method === 'POST') {
        if (!env.MYBROWSER) {
            return jsonResponse(
                { error: 'MYBROWSER binding not configured', hint: 'Enable Browser Rendering on the Worker' },
                503,
            );
        }
        let body = {};
        try {
            body = await request.json();
        } catch {
            body = {};
        }
        const targetUrl = String(body.url || '').trim();
        if (!targetUrl) return jsonResponse({ error: 'url required' }, 400);

        try {
            await assertBrowserRunTargetAllowed(env, {
                userId: String(authUser.id),
                workspaceId:
                    body.workspace_id != null && String(body.workspace_id).trim()
                        ? String(body.workspace_id).trim()
                        : request.headers.get('x-iam-workspace-id') || null,
                url: targetUrl,
            });
        } catch (e) {
            return jsonResponse({ error: String(e?.message || e) }, 403);
        }

        const workspaceId =
            body.workspace_id != null && String(body.workspace_id).trim()
                ? String(body.workspace_id).trim()
                : null;

        const out = await runPlaywrightScreenshotJob(env, {
            url: targetUrl,
            userId: String(authUser.id),
            workspaceId,
            agentRunId: body.agent_run_id ? String(body.agent_run_id) : null,
            source: 'dashboard_browser_tab',
        });
        if (out.error) {
            const status = String(out.hint || '').includes('schema') ? 503 : 500;
            return jsonResponse(out, status);
        }
        if (out.status === 'completed' && out.screenshot_url) {
            return jsonResponse({
                id: out.id,
                status: 'completed',
                result_url: out.result_url,
                screenshot_url: out.screenshot_url,
            });
        }
        if (out.status === 'error') {
            return jsonResponse(
                { id: out.id, status: 'error', error: out.error != null ? String(out.error) : 'screenshot failed' },
                500,
            );
        }
        return jsonResponse({ id: out.id, status: 'pending', result_url: null });
    }

    // ── GET /api/browser/jobs/:id (single job — user-scoped) ────────────────
    const jobIdMatch = pathNorm.match(/^\/api\/browser\/jobs\/([^/]+)$/);
    if (method === 'GET' && jobIdMatch) {
        const jobId = decodeURIComponent(jobIdMatch[1]);
        try {
            const row = await env.DB.prepare(
                `SELECT id, url, status, result_url, created_at, completed_at, error
                 FROM playwright_jobs WHERE id = ? AND user_id = ? LIMIT 1`,
            )
                .bind(jobId, authUser.id)
                .first();
            if (!row) return jsonResponse({ error: 'Job not found' }, 404);
            return jsonResponse(row);
        } catch (e) {
            return jsonResponse({ error: 'Failed to fetch browser job', detail: e.message }, 500);
        }
    }

    // ── GET /api/browser/jobs (job list) ────────────────────────────────────
    if (method === 'GET' && pathNorm === '/api/browser/jobs') {
        try {
            const { results } = await env.DB.prepare(
                "SELECT id, url, status, result_url, created_at, completed_at, error FROM playwright_jobs WHERE user_id = ? ORDER BY datetime(created_at) DESC LIMIT 50",
            )
                .bind(authUser.id)
                .all();

            return jsonResponse({ jobs: results || [] });
        } catch (e) {
            return jsonResponse({ error: 'Failed to fetch browser jobs', detail: e.message }, 500);
        }
    }

    return jsonResponse({ error: 'Browser job route not found' }, 404);
}

