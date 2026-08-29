/**
 * Tool: Web (CDT / Playwright / Search)
 * Browser automation runs in-worker via MYBROWSER (backend/browser/tools/dispatch.js).
 */

import { assertFetchDomainAllowed } from '../../../src/core/auth.js';
import { assertBrowserTrustedOrigin } from '../../../src/core/agentsam-ops-ledger.js';
import { executeTavilyOpenWebSearch } from '../../../src/core/tavily-open-web-search.js';
import { runPlaywrightScreenshotJob } from '../../browser/runtime/screenshot.js';
import { runBrowserBuiltinTool } from '../../browser/tools/dispatch.js';

const SCREENSHOT_JOB_TOOLS = new Set(['playwright_screenshot', 'browser_screenshot']);

/**
 * MYBROWSER in-worker path (no /api/mcp/invoke — avoids MCP_AUTH_TOKEN 401).
 */
function mergeBrowserRunContext(params, runContext = {}) {
  const browserCtx =
    runContext.browserContext && typeof runContext.browserContext === 'object'
      ? runContext.browserContext
      : runContext.browser_context && typeof runContext.browser_context === 'object'
        ? runContext.browser_context
        : null;
  const browserSessionId =
    params.browser_session_id ??
    params.browserSessionId ??
    runContext.browser_session_id ??
    runContext.browserSessionId ??
    browserCtx?.browser_session_id ??
    browserCtx?.browserSessionId ??
    null;
  return {
    ...params,
    user_id: params.user_id ?? params.session?.user_id ?? runContext.userId ?? runContext.user_id,
    workspace_id:
      params.workspace_id ??
      params.session?.workspace_id ??
      params.session?.workspaceId ??
      runContext.workspaceId ??
      runContext.workspace_id,
    agent_run_id:
      params.agent_run_id ??
      params.agentRunId ??
      params.session?.agent_run_id ??
      runContext.agentRunId ??
      runContext.agent_run_id,
    workflow_run_id:
      params.workflow_run_id ??
      params.workflowRunId ??
      runContext.workflowRunId ??
      runContext.workflow_run_id,
    ...(browserSessionId != null && String(browserSessionId).trim()
      ? { browser_session_id: String(browserSessionId).trim() }
      : {}),
  };
}

async function invokeBrowserOp(env, toolName, params, runContext = {}) {
    const merged = mergeBrowserRunContext(params, runContext);
    const targetOriginInput =
        merged.url ?? merged.origin ?? merged.href ?? merged.target_url ?? merged.page_url;
    const uid = merged.user_id ?? merged.session?.user_id;
    const ws =
        merged.workspace_id ?? merged.session?.workspace_id ?? merged.session?.workspaceId;
    if (targetOriginInput && uid) {
        try {
            await assertBrowserTrustedOrigin(env, {
                userId: uid,
                workspaceId: ws,
                origin: targetOriginInput,
            });
        } catch (e) {
            let origin = targetOriginInput;
            try {
                const raw = String(targetOriginInput);
                origin = new URL(raw.startsWith('http') ? raw : `https://${raw}`).origin;
            } catch {
                /* keep raw */
            }
            return {
                error: e?.message != null ? String(e.message) : String(e),
                blocked: true,
                code: 'browser_origin_not_trusted',
                origin,
            };
        }
    }

    const tool = String(toolName || '').trim();

    // Job-tracked screenshots (playwright_jobs row) for dashboard polling parity.
    if (SCREENSHOT_JOB_TOOLS.has(tool)) {
        const url = String(targetOriginInput || '').trim();
        if (!url) return { error: 'url required for screenshot' };
        if (!uid) return { error: 'user_id required for screenshot' };
        const agentRunId =
            merged.agent_run_id ??
            merged.agentRunId ??
            merged.session?.agent_run_id ??
            null;
        return runPlaywrightScreenshotJob(env, {
            url,
            userId: String(uid),
            workspaceId: ws != null ? String(ws) : null,
            agentRunId: agentRunId != null ? String(agentRunId) : null,
            source: `agent_tool:${tool}`,
        });
    }

    return runBrowserBuiltinTool(env, tool, merged);
}

export const handlers = {
    // ── Search & Audit ───────────────────────────────────────────────────
    async search_web(params, env, runContext = {}) {
        const merged = {
            ...params,
            user_id: params.user_id ?? params.session?.user_id ?? runContext.userId ?? runContext.user_id,
            workspace_id:
                params.workspace_id ??
                params.session?.workspace_id ??
                params.session?.workspaceId ??
                runContext.workspaceId ??
                runContext.workspace_id,
            tenant_id: params.tenant_id ?? params.session?.tenant_id ?? runContext.tenantId ?? runContext.tenant_id,
            agent_run_id:
                params.agent_run_id ??
                params.agentRunId ??
                runContext.agentRunId ??
                runContext.agent_run_id,
        };
        const ctx = {
            ...runContext,
            workspaceId: merged.workspace_id,
            workspace_id: merged.workspace_id,
            tenantId: merged.tenant_id,
            tenant_id: merged.tenant_id,
            userId: merged.user_id,
            user_id: merged.user_id,
            agentRunId: merged.agent_run_id,
            agent_run_id: merged.agent_run_id,
            openWebBudget: runContext.openWebBudget ?? params.openWebBudget,
        };
        return executeTavilyOpenWebSearch(env, merged, ctx);
    },

    /**
     * Fetch a known public URL and return text (not MYBROWSER — no render/DOM).
     */
    async web_fetch(params, env) {
        const rawUrl = String(params.url ?? params.href ?? params.target_url ?? '').trim();
        if (!rawUrl) return { error: 'url required', lane: 'web_fetch' };
        let url = rawUrl;
        if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
        const uid = params.user_id ?? params.session?.user_id;
        const ws =
            params.workspace_id ?? params.session?.workspace_id ?? params.session?.workspaceId;
        const gate = await assertFetchDomainAllowed(env, uid, ws, url);
        if (!gate.ok) return { error: gate.error, lane: 'web_fetch', blocked: true };
        try {
            const res = await fetch(url, {
                method: 'GET',
                headers: {
                    Accept: 'text/html,application/json,text/plain,*/*',
                    'User-Agent': 'IAM-AgentSam/1.0 (+https://inneranimalmedia.com)',
                },
                redirect: 'follow',
            });
            const contentType = res.headers.get('content-type') || '';
            const maxBytes = 120_000;
            if (!/text\/|application\/json|application\/xml|application\/javascript/i.test(contentType)) {
                return {
                    error: 'non_text_content',
                    lane: 'web_fetch',
                    url,
                    status: res.status,
                    content_type: contentType,
                };
            }
            const text = (await res.text()).slice(0, maxBytes);
            return {
                lane: 'web_fetch',
                url: res.url || url,
                status: res.status,
                content_type: contentType,
                text_length: text.length,
                text,
            };
        } catch (e) {
            return { error: String(e?.message || e), lane: 'web_fetch', url };
        }
    },

    async a11y_audit(params, env, runContext) {
        return await invokeBrowserOp(env, 'a11y_audit_webpage', params, runContext);
    },

    // ── CDT Core ─────────────────────────────────────────────────────────
    async cdt_navigate_page(params, env, runContext) { return await invokeBrowserOp(env, 'cdt_navigate_page', params, runContext); },
    async cdt_take_screenshot(params, env, runContext) { return await invokeBrowserOp(env, 'cdt_take_screenshot', params, runContext); },
    async cdt_click(params, env, runContext) { return await invokeBrowserOp(env, 'cdt_click', params, runContext); },
    async cdt_fill(params, env, runContext) { return await invokeBrowserOp(env, 'cdt_fill', params, runContext); },
    async cdt_fill_form(params, env, runContext) { return await invokeBrowserOp(env, 'cdt_fill_form', params, runContext); },
    async cdt_evaluate_script(params, env, runContext) {
        return await invokeBrowserOp(env, 'cdt_evaluate_script', params, runContext);
    },
    async cdt_list_pages(params, env, runContext) { return await invokeBrowserOp(env, 'cdt_list_pages', params, runContext); },
    async cdt_wait_for(params, env, runContext) { return await invokeBrowserOp(env, 'cdt_wait_for', params, runContext); },
    async cdt_take_snapshot(params, env, runContext) { return await invokeBrowserOp(env, 'cdt_take_snapshot', params, runContext); },
    async cdt_hover(params, env, runContext) { return await invokeBrowserOp(env, 'cdt_hover', params, runContext); },
    async cdt_drag(params, env, runContext) { return await invokeBrowserOp(env, 'cdt_drag', params, runContext); },
    async cdt_press_key(params, env, runContext) { return await invokeBrowserOp(env, 'cdt_press_key', params, runContext); },
    async cdt_upload_file(params, env, runContext) { return await invokeBrowserOp(env, 'cdt_upload_file', params, runContext); },

    // ── CDT Performance ──────────────────────────────────────────────────
    async cdt_performance_start_trace(params, env, runContext) {
        return await invokeBrowserOp(env, 'cdt_performance_start_trace', params, runContext);
    },
    async cdt_performance_stop_trace(params, env, runContext) {
        return await invokeBrowserOp(env, 'cdt_performance_stop_trace', params, runContext);
    },
    async cdt_performance_analyze_insight(params, env, runContext) {
        return await invokeBrowserOp(env, 'cdt_performance_analyze_insight', params, runContext);
    },

    // ── Playwright & Legacy ──────────────────────────────────────────────
    async playwright_screenshot(params, env, runContext) { return await invokeBrowserOp(env, 'playwright_screenshot', params, runContext); },
    /**
     * Catalog key agentsam_playwright — operation router over existing MYBROWSER ops.
     * operation: screenshot | navigate | scrape | capture (default screenshot).
     */
    async agentsam_playwright(params, env, runContext) {
        const op = String(params?.operation ?? params?.op ?? params?.action ?? 'screenshot')
            .trim()
            .toLowerCase();
        if (op === 'screenshot') {
            return await invokeBrowserOp(env, 'playwright_screenshot', params, runContext);
        }
        if (op === 'capture') {
            return await invokeBrowserOp(env, 'browser_screenshot', params, runContext);
        }
        if (op === 'navigate') {
            return await invokeBrowserOp(env, 'browser_navigate', params, runContext);
        }
        if (op === 'scrape' || op === 'content' || op === 'dom') {
            return await invokeBrowserOp(env, 'browser_content', params, runContext);
        }
        return {
            error: `unsupported operation=${op}; use screenshot|navigate|scrape|capture`,
            lane: 'agentsam_playwright',
        };
    },
    async browser_navigate(params, env, runContext) { return await invokeBrowserOp(env, 'browser_navigate', params, runContext); },
    async browser_scroll(params, env, runContext) { return await invokeBrowserOp(env, 'browser_scroll', params, runContext); },
    async browser_verify_current_page(params, env, runContext) {
        return await invokeBrowserOp(env, 'browser_verify_current_page', params, runContext);
    },
    async browser_screenshot(params, env, runContext) { return await invokeBrowserOp(env, 'browser_screenshot', params, runContext); },
    async browser_content(params, env, runContext) { return await invokeBrowserOp(env, 'browser_content', params, runContext); },
    async browser_close_session(params, env, runContext) { return await invokeBrowserOp(env, 'browser_close_session', params, runContext); },
    async browser_session_close(params, env, runContext) { return await invokeBrowserOp(env, 'browser_session_close', params, runContext); },
    async browser_request_human_input(params, env, runContext) {
        return await invokeBrowserOp(env, 'browser_request_human_input', params, runContext);
    },
};
