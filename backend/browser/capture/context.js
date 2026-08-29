/**
 * DB-driven browser.capture_context — resolves tools from agentsam_tools,
 * merges dashboard browserContext (selected element, route, viewport), and returns structured capture.
 */
import { assertBrowserTrustedOrigin } from '../policy/trust.js';
import { runBrowserBuiltinTool } from '../tools/dispatch.js';
import { isBrowserSessionId, resolveBrowserSessionScopeId } from '../sessions/scope.js';
import { BROWSER_RUN_QUICKACTIONS } from '../quick-actions/actions.js';
import { loadAvailableToolsForCapability, isTrustedBrowserReadTool } from './tool-registry.js';

function flattenInput(input) {
  if (input == null) return {};
  if (typeof input === 'object' && !Array.isArray(input)) return { ...input };
  return { value: input };
}

function pickTool(registryRows, candidates) {
  const set = new Set(registryRows.map((r) => String(r.tool_name)));
  for (const c of candidates) {
    if (set.has(c)) return c;
  }
  return null;
}

function toolResultOk(res) {
  if (!res || typeof res !== 'object') return false;
  if (res.blocked) return false;
  if (res.error && String(res.error).trim()) return false;
  if (res.ok === false) return false;
  return true;
}

function extractUrl(flat) {
  const bc =
    (flat.browserContext && typeof flat.browserContext === 'object' ? flat.browserContext : null) ||
    (flat.browser_context && typeof flat.browser_context === 'object' ? flat.browser_context : null);
  const fromCtx = bc?.url != null ? String(bc.url).trim() : '';
  if (fromCtx) return fromCtx;
  const ws =
    flat.workspaceContext && typeof flat.workspaceContext === 'object'
      ? flat.workspaceContext
      : flat.workspace_context && typeof flat.workspace_context === 'object'
        ? flat.workspace_context
        : null;
  const fromWs =
    ws?.browserUrl != null
      ? String(ws.browserUrl).trim()
      : ws?.browser_url != null
        ? String(ws.browser_url).trim()
        : '';
  if (fromWs) return fromWs;
  const fromFlat = flat.url != null ? String(flat.url).trim() : '';
  if (fromFlat) return fromFlat;
  const m = String(flat.message || flat.prompt || '').match(/https?:\/\/[^\s)>'"<]+/i);
  return m ? m[0].replace(/[.,;]+$/, '') : '';
}

/**
 * Resolve leased browser session (bsess_*) from runContext + flat input.
 * Mirrors chat-turn browserContextPayload threading.
 * @param {Record<string, unknown>} flat
 * @param {Record<string, unknown>|null|undefined} runContext
 * @returns {string|null}
 */
function resolveCaptureBrowserSessionId(flat, runContext) {
  const rc = runContext && typeof runContext === 'object' ? runContext : {};
  const browserContext =
    (flat.browserContext && typeof flat.browserContext === 'object' ? flat.browserContext : null) ||
    (flat.browser_context && typeof flat.browser_context === 'object' ? flat.browser_context : null) ||
    (rc.browserContext && typeof rc.browserContext === 'object' ? rc.browserContext : null) ||
    (rc.browser_context && typeof rc.browser_context === 'object' ? rc.browser_context : null);

  const merged = {
    browser_session_id:
      rc.browser_session_id ??
      flat.browser_session_id ??
      browserContext?.browser_session_id ??
      null,
    browserSessionId:
      rc.browserSessionId ??
      flat.browserSessionId ??
      browserContext?.browserSessionId ??
      null,
  };

  const direct =
    merged.browser_session_id != null
      ? String(merged.browser_session_id).trim()
      : merged.browserSessionId != null
        ? String(merged.browserSessionId).trim()
        : '';
  if (isBrowserSessionId(direct)) return direct;

  return resolveBrowserSessionScopeId({
    ...flat,
    ...rc,
    ...(browserContext && typeof browserContext === 'object' ? browserContext : {}),
  });
}

/**
 * @param {any} env
 * @param {string} toolName
 * @param {Record<string, unknown>} params
 */
async function dispatchBrowserBuiltinTool(env, toolName, params) {
  const out = await runBrowserBuiltinTool(env, toolName, params);
  if (out && typeof out === 'object' && out.error && String(out.error).trim()) {
    return { error: String(out.error) };
  }
  if (out && typeof out === 'object' && out.ok === false) {
    return { error: String(out.error || 'browser_tool_failed') };
  }
  return out;
}

/**
 * URL-only fallback for callers without a live browser lease.
 * Browser Run is intentionally separate from the leased MYBROWSER/CDP lane.
 * @param {any} env
 * @param {string} url
 * @param {Record<string, unknown>} capture
 * @param {Record<string, string>} toolsUsed
 */
async function executeStatelessCapture(env, url, capture, toolsUsed) {
  const snapshot = BROWSER_RUN_QUICKACTIONS.snapshot;
  if (typeof snapshot !== 'function') {
    return { ok: false, error: 'browser.capture_context: stateless browser_run_snapshot unavailable' };
  }

  const result = await snapshot(env, {
    url,
    formats: ['content', 'screenshot'],
    full_page: true,
  });
  toolsUsed.snapshot = 'browser_run_snapshot';

  if (!toolResultOk(result)) {
    return {
      ok: false,
      error: String(result?.error || 'stateless_snapshot_failed'),
      output: capture,
      tools_used: toolsUsed,
    };
  }

  capture.capture_mode = 'stateless_browser_run';
  capture.content = {
    ok: true,
    url,
    content: result.content,
    html: result.html,
    text: result.content || result.markdown || '',
  };
  capture.dom_snapshot = {
    ok: true,
    content: result.content,
    html: result.html,
    markdown: result.markdown,
  };
  capture.screenshot = {
    ok: true,
    url,
    image_base64: result.screenshot,
  };

  return null;
}

/**
 * @param {any} env
 * @param {unknown} input
 * @param {Record<string, unknown>} runContext
 */
export async function executeBrowserCaptureContext(env, input, runContext) {
  const flat = flattenInput(input);
  const meta = runContext?.runMeta || {};
  const tenantId = String(meta.tenantId ?? runContext?.tenantId ?? flat.tenant_id ?? '').trim();
  const workspaceId = String(meta.workspaceId ?? runContext?.workspaceId ?? flat.workspace_id ?? '').trim();
  const userId = String(meta.userId ?? runContext?.userId ?? flat.user_id ?? '').trim();
  const url = extractUrl(flat);
  const browserSessionId = resolveCaptureBrowserSessionId(flat, runContext);

  if (!url) {
    return { ok: false, error: 'browser.capture_context: no url in browserContext or input' };
  }

  try {
    await assertBrowserTrustedOrigin(env, { userId, workspaceId, origin: url });
  } catch (e) {
    return { ok: false, error: e?.message != null ? String(e.message) : String(e) };
  }

  const registry = await loadAvailableToolsForCapability(env, tenantId, workspaceId, userId);
  const baseParams = {
    user_id: userId,
    workspace_id: workspaceId,
    session: { user_id: userId, workspace_id: workspaceId, workspaceId },
    ...(browserSessionId ? { browser_session_id: browserSessionId } : {}),
    // A leased capture observes the current page; URL is metadata only and
    // must not be passed to withBrowserPage, where it would trigger navigation.
    ...(browserSessionId ? {} : { url }),
  };

  const toolsUsed = {};
  const capture = {
    url,
    ...(browserSessionId
      ? { browser_session_id: browserSessionId, capture_mode: 'leased_observe' }
      : { browser_session_id: null }),
    route_path: flat.route_path ?? flat.browserContext?.route_path ?? null,
    viewport: flat.browserContext?.viewport ?? flat.viewport ?? null,
    selected_element:
      flat.selected_element ??
      flat.browserContext?.selected_element ??
      flat.browserContext?.selectedElement ??
      null,
    captured_at: new Date().toISOString(),
  };

  if (!browserSessionId) {
    const statelessResult = await executeStatelessCapture(env, url, capture, toolsUsed);
    if (statelessResult) return statelessResult;
    return {
      ok: true,
      output: {
        capture,
        tools_used: toolsUsed,
        registry_tool_count: registry.length,
      },
    };
  }

  // Leased capture is observe-only. Do not navigate the user's live tab.
  const contentName = pickTool(registry, ['browser_content']);
  if (contentName) {
    const contentRes = await dispatchBrowserBuiltinTool(env, contentName, baseParams);
    toolsUsed.content = contentName;
    capture.content = contentRes;
    if (typeof contentRes?.url === 'string' && contentRes.url.trim()) {
      capture.url = contentRes.url.trim();
    }
  }

  const consoleName = pickTool(registry, ['cdt_list_console_messages']);
  if (consoleName) {
    const consoleRes = await dispatchBrowserBuiltinTool(env, consoleName, { ...baseParams, limit: 100 });
    toolsUsed.console = consoleName;
    capture.console = consoleRes;
  }

  const networkName = pickTool(registry, ['cdt_list_network_requests']);
  if (networkName) {
    const networkRes = await dispatchBrowserBuiltinTool(env, networkName, { ...baseParams, limit: 100 });
    toolsUsed.network = networkName;
    capture.network = networkRes;
  }

  const snapshotName = pickTool(registry, ['cdt_take_snapshot']);
  if (snapshotName && !capture.selected_element) {
    const snapRes = await dispatchBrowserBuiltinTool(env, snapshotName, {
      ...baseParams,
      interestingOnly: true,
    });
    toolsUsed.snapshot = snapshotName;
    capture.dom_snapshot = snapRes;
  }

  const shotName = pickTool(registry, ['playwright_screenshot', 'browser_screenshot', 'cdt_take_screenshot']);
  if (shotName && isTrustedBrowserReadTool(shotName)) {
    const shotRes = await dispatchBrowserBuiltinTool(env, shotName, baseParams);
    toolsUsed.screenshot = shotName;
    capture.screenshot = shotRes;
    if (typeof shotRes?.url === 'string' && shotRes.url.trim()) {
      capture.url = shotRes.url.trim();
    }
  }

  return {
    ok: true,
    output: {
      capture,
      tools_used: toolsUsed,
      registry_tool_count: registry.length,
    },
  };
}
