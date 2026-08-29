/**
 * Browser page runtime — withBrowserPage, acquire/connect, verification helpers.
 * Tool switch lives in ../tools/dispatch.js.
 */
import { putAgentBrowserScreenshotToR2 } from '../capture/storage.js';
import {
  resolveBrowserSessionScopeId,
  browserToolRequiresSession,
} from '../sessions/scope.js';
import {
  ensureAgentLiveBrowserSession,
  liveSessionPayload,
  getAgentLiveBrowserSession,
} from '../sessions/live-session.js';
import { browserLiveDoRequired, patchAgentLiveBrowserSessionViaDo, assertBrowserLiveDoAvailable } from '../sessions/client.js';
import {
  listBrowserRunTargets,
  pickBrowserRunPageTarget,
  refreshBrowserRunLiveView,
} from '../cloudflare/browser-run.js';
const GOTO_WAIT = 'domcontentloaded';
const GOTO_TIMEOUT_MS = 45_000;

/** Tools that must not reuse an existing page URL (always load target). */
const FORCE_GOTO_TOOLS = new Set(['browser_navigate', 'cdt_navigate_page']);

/**
 * @param {Record<string, unknown>} params
 */
export function resolveBrowserToolUrl(params) {
  const raw =
    params.url ??
    params.origin ??
    params.href ??
    params.target_url ??
    params.page_url;
  const u = raw != null ? String(raw).trim() : '';
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return `https:${u}`;
  return `https://${u.replace(/^\/+/, '')}`;
}

function normalizeUrlCompare(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    return x.href.replace(/\/$/, '');
  } catch {
    return String(u || '').trim().replace(/\/$/, '');
  }
}

/** @param {string} actual @param {string} expected */
export function urlMatchesExpected(actual, expected) {
  const a = String(actual || '').trim();
  const e = String(expected || '').trim();
  if (!e) return true;
  if (!a) return false;
  if (normalizeUrlCompare(a) === normalizeUrlCompare(e)) return true;
  try {
    const au = new URL(a);
    const eu = new URL(e);
    if (au.origin === eu.origin) {
      const ap = au.pathname.replace(/\/$/, '') || '/';
      const ep = eu.pathname.replace(/\/$/, '') || '/';
      if (ap === ep) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * @param {import('@cloudflare/playwright').Page} page
 * @param {number} [maxChars]
 */
export async function readVerifiedPageSample(page, maxChars = 2000) {
  const title = await page.title().catch(() => '');
  const page_text = await extractPageText(page, maxChars);
  const h1 = await page
    .evaluate(() => document.querySelector('h1')?.innerText?.trim() || '')
    .catch(() => '');
  return { title, page_text, h1, url: page.url() || '' };
}

/**
 * Prove Browser Run Live View target URL matches CDP page.url() (not just Playwright state).
 * @param {any} env
 * @param {string} sessionId
 * @param {import('@cloudflare/playwright').Page} page
 * @param {string|null|undefined} storedTargetId
 */
async function syncLiveViewWithCdpPage(env, sessionId, page, storedTargetId = null) {
  const cdpUrl = page.url() || '';
  const listed = await listBrowserRunTargets(env, sessionId);
  if (!listed.ok) {
    return {
      ok: false,
      verified: false,
      live_view_verified: false,
      url: cdpUrl,
      error: listed.error || 'Could not list Browser Run targets',
    };
  }
  const targets = listed.targets || [];
  const wantId = storedTargetId != null ? String(storedTargetId).trim() : '';
  let target = wantId ? targets.find((t) => t && String(t.id) === wantId) : null;
  if (target && cdpUrl && !urlMatchesExpected(String(target.url || ''), cdpUrl)) {
    target =
      targets.find(
        (t) =>
          t &&
          String(t.type || '').toLowerCase() === 'page' &&
          urlMatchesExpected(String(t.url || ''), cdpUrl),
      ) || pickBrowserRunPageTarget(targets);
  }
  if (!target) target = pickBrowserRunPageTarget(targets);
  const targetUrl = target?.url != null ? String(target.url) : '';
  const liveViewVerified = !cdpUrl || !targetUrl || urlMatchesExpected(targetUrl, cdpUrl);
  const refreshed = await refreshBrowserRunLiveView(env, {
    sessionId,
    targetId: target?.id != null ? String(target.id) : null,
  });
  if (!refreshed.ok) {
    return {
      ok: false,
      verified: false,
      live_view_verified: false,
      url: cdpUrl,
      target_url: targetUrl || null,
      error: refreshed.error || 'Live View refresh failed',
    };
  }
  const refreshedUrl = refreshed.url != null ? String(refreshed.url) : targetUrl;
  const fullyVerified =
    liveViewVerified &&
    (!cdpUrl || !refreshedUrl || urlMatchesExpected(refreshedUrl, cdpUrl));
  return {
    ok: fullyVerified,
    verified: fullyVerified,
    live_view_verified: fullyVerified,
    url: cdpUrl,
    target_url: refreshedUrl || targetUrl || null,
    title: refreshed.title ?? null,
    target_id: refreshed.targetId ?? (target?.id != null ? String(target.id) : null),
    live_view_url: refreshed.devtoolsFrontendUrl ?? null,
    devtools_frontend_url: refreshed.devtoolsFrontendUrl ?? null,
  };
}

/**
 * Verify page URL + Live View target, then commit to AgentBrowserLive DO.
 * @param {any} env
 * @param {string} scopeId
 * @param {import('@cloudflare/playwright').Page} page
 * @param {string} toolName
 * @param {string|null} requestedUrl
 */
async function commitAgentLiveBrowserPageState(env, scopeId, page, toolName, requestedUrl = null) {
  if (!scopeId || !browserLiveDoRequired(env)) return null;
  const stored = await getAgentLiveBrowserSession(env, scopeId);
  const sid = stored?.sessionId ?? null;
  const url = page.url() || '';
  const title = await page.title().catch(() => '');
  let urlVerified = requestedUrl ? urlMatchesExpected(url, requestedUrl) : true;
  let liveSync = null;
  if (sid) {
    liveSync = await syncLiveViewWithCdpPage(env, sid, page, stored?.targetId ?? null);
    if (!liveSync.live_view_verified) urlVerified = false;
  }
  if (!urlVerified) {
    const errMsg =
      liveSync?.live_view_verified === false
        ? `Live View was not verified (CDP ${url}, Browser Run target ${liveSync?.target_url || 'unknown'})`
        : requestedUrl
          ? `Navigation was requested but not verified (expected ${requestedUrl}, got ${url})`
          : 'Page verification failed';
    await patchAgentLiveBrowserSessionViaDo(env, scopeId, {
      tool_name: toolName,
      action_phase: 'done',
      url,
      title,
      requested_url: requestedUrl,
      verified: false,
      url_verified: false,
      ok: false,
    }).catch(() => null);
    return {
      url,
      title,
      verified: false,
      url_verified: false,
      live_view_verified: liveSync?.live_view_verified === true,
      browser_url_committed: null,
      error: errMsg,
      verification_failed: true,
      smoke_debug: {
        agent_run_id: scopeId,
        session_id: sid,
        final_url: url,
        requested_url: requestedUrl,
        url_verified: false,
        live_view_verified: liveSync?.live_view_verified === true,
        browser_run_target_url: liveSync?.target_url ?? null,
        same_session_reused: true,
        live_view_mode: stored?.liveViewMode ?? 'tab',
        screenshots_taken: 0,
      },
    };
  }
  const patchOut = await patchAgentLiveBrowserSessionViaDo(env, scopeId, {
    tool_name: toolName,
    action_phase: 'done',
    url,
    title,
    requested_url: requestedUrl,
    verified: true,
    url_verified: true,
    ok: true,
    target_id: liveSync?.target_id ?? stored?.targetId ?? null,
    devtools_frontend_url: liveSync?.live_view_url ?? null,
  }).catch(() => null);
  const live = patchOut?.live_session ?? stored;
  return {
    url,
    title,
    verified: true,
    url_verified: true,
    live_view_verified: true,
    session_id: live?.session_id ?? sid ?? null,
    target_id: live?.target_id ?? liveSync?.target_id ?? stored?.targetId ?? null,
    live_session: live,
    browser_url_committed: patchOut?.browser_url_committed ?? {
      url,
      title,
      verified: true,
      session_id: live?.session_id ?? sid ?? null,
      agent_run_id: scopeId,
      live_view_url: live?.devtools_frontend_url ?? liveSync?.live_view_url ?? null,
    },
    smoke_debug: {
      agent_run_id: scopeId,
      session_id: live?.session_id ?? sid ?? null,
      target_id: live?.target_id ?? liveSync?.target_id ?? stored?.targetId ?? null,
      final_url: url,
      requested_url: requestedUrl,
      same_session_reused: true,
      live_view_mode: live?.live_view_mode ?? 'tab',
      url_verified: true,
      live_view_verified: true,
      browser_run_target_url: liveSync?.target_url ?? null,
      screenshots_taken: 0,
    },
  };
}

/** @param {any} env @param {string} scopeId @param {import('@cloudflare/playwright').Page} page @param {string} toolName @param {string} direction */
export async function emitBrowserScrollPatch(env, scopeId, page, toolName, direction) {
  if (!scopeId || !browserLiveDoRequired(env)) return;
  await patchAgentLiveBrowserSessionViaDo(env, scopeId, {
    tool_name: toolName,
    action_phase: 'done',
    scroll_direction: direction,
    url: page.url() || null,
    verified: true,
    ok: true,
  }).catch(() => {});
}

/**
 * @param {unknown} tree
 * @param {boolean} interestingOnly
 */
export function filterA11ySnapshot(tree, interestingOnly) {
  if (!interestingOnly || !tree || typeof tree !== 'object') return tree;
  /** @param {any} node */
  function walk(node) {
    if (!node || typeof node !== 'object') return null;
    const children = Array.isArray(node.children)
      ? node.children.map(walk).filter(Boolean)
      : [];
    const name = node.name != null ? String(node.name).trim() : '';
    const role = node.role != null ? String(node.role).trim() : '';
    const hasInterest = Boolean(name || role === 'link' || role === 'button' || role === 'textbox');
    if (!hasInterest && children.length === 0) return null;
    return { ...node, children };
  }
  return walk(tree);
}

/**
 * @param {import('@cloudflare/playwright').Page} page
 * @param {string} url
 */
async function gotoPage(page, url) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(url, { waitUntil: GOTO_WAIT, timeout: GOTO_TIMEOUT_MS });
}

/**
 * @param {import('@cloudflare/playwright').Page} page
 * @param {string} [targetUrl]
 * @param {{ force?: boolean }} [opts]
 */
async function ensurePageUrl(page, targetUrl, opts = {}) {
  if (!targetUrl) return;
  const current = page.url() || '';
  const force = opts.force === true;
  if (
    !force &&
    current &&
    current !== 'about:blank' &&
    normalizeUrlCompare(current) === normalizeUrlCompare(targetUrl)
  ) {
    return;
  }
  await gotoPage(page, targetUrl);
}

/**
 * @param {import('@cloudflare/playwright').Page} page
 * @param {number} [maxChars]
 */
export async function extractPageText(page, maxChars = 120_000) {
  const text = await page.evaluate(() => {
    const body = document.body;
    if (!body) return '';
    return (body.innerText || body.textContent || '').trim();
  });
  const max = Math.max(1000, maxChars);
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated]`;
}

/**
 * @param {any} env
 * @param {import('@cloudflare/playwright').Page} page
 * @param {{ fullPage?: boolean }} [opts]
 */
function normalizeBrowserCaptureResult(out) {
  if (!out || typeof out !== 'object') return out;
  const screenshot_url =
    out.screenshot_url ||
    out.data_url ||
    (out.image_base64
      ? `data:${out.content_type || 'image/png'};base64,${out.image_base64}`
      : null);
  if (!screenshot_url) return out;
  return {
    ...out,
    screenshot_url,
    result_url: out.result_url || screenshot_url,
  };
}

export async function captureViewportScreenshot(env, page, opts = {}) {
  const buf = await page.screenshot({
    type: 'png',
    fullPage: Boolean(opts.fullPage),
  });
  const out = await putAgentBrowserScreenshotToR2(env, buf, 'image/png');
  return normalizeBrowserCaptureResult(out);
}

/**
 * @param {import('@cloudflare/playwright').Browser} browser
 */
async function getActivePage(browser) {
  const contexts = browser.contexts?.() ?? [];
  for (const ctx of contexts) {
    const pages = ctx.pages?.() ?? [];
    if (pages.length) return pages[0];
  }
  return browser.newPage();
}

/**
 * @param {import('@cloudflare/playwright').Page} page
 */
function attachPageTelemetry(page, consoleMessages, networkRequests, networkByUrl) {
  page.on('console', (msg) => {
    try {
      consoleMessages.push({ type: String(msg.type()), text: String(msg.text()) });
    } catch {
      /* non-fatal */
    }
  });

  page.on('request', (req) => {
    try {
      const entry = {
        url: req.url(),
        method: req.method(),
        resourceType: req.resourceType(),
      };
      networkByUrl.set(req.url(), entry);
      networkRequests.push(entry);
    } catch {
      /* non-fatal */
    }
  });

  page.on('response', async (res) => {
    try {
      const req = res.request();
      const key = req.url();
      const entry = networkByUrl.get(key) || {
        url: key,
        method: req.method(),
        resourceType: req.resourceType(),
      };
      entry.status = res.status();
      entry.response = {
        status: res.status(),
        statusText: res.statusText(),
        headers: await res.allHeaders().catch(() => ({})),
      };
      networkByUrl.set(key, entry);
    } catch {
      /* non-fatal */
    }
  });
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} params
 * @param {(ctx: {
 *   page: import('@cloudflare/playwright').Page,
 *   url: string,
 *   consoleMessages: Array<{ type: string, text: string }>,
 *   networkRequests: Array<Record<string, unknown>>,
 *   browserSession?: Record<string, unknown>|null,
 * }) => Promise<unknown>} fn
 * @param {{ toolName?: string, persistSession?: boolean }} [opts]
 */
export async function withBrowserPage(env, params, fn, opts = {}) {
  if (!env.MYBROWSER) {
    return {
      error: 'MYBROWSER binding not configured',
      hint: 'Enable Browser Rendering on the Worker (wrangler [browser] binding)',
    };
  }

  const targetUrl = resolveBrowserToolUrl(params);
  const toolName = String(opts.toolName || '').trim();
  const scopeId = resolveBrowserSessionScopeId(params);

  if (toolName && browserToolRequiresSession(toolName) && !scopeId) {
    return {
      error: 'browser_session_id required (bsess_*)',
      ok: false,
      hint: 'Mint a lease via POST /api/browser/sessions and pass browser_session_id on stateful browser tools',
    };
  }

  if (scopeId && !browserLiveDoRequired(env)) {
    const gate = assertBrowserLiveDoAvailable(env);
    return { error: gate.error || 'BROWSER_SESSION required for stateful browser tools', ok: false, status: gate.status || 503 };
  }
  const useLiveDo = Boolean(scopeId && browserLiveDoRequired(env));

  if (toolName && browserToolRequiresSession(toolName) && !useLiveDo) {
    return {
      error: 'BROWSER_SESSION binding required for stateful browser tools',
      ok: false,
      status: 503,
    };
  }

  let liveSessionMeta = null;
  if (scopeId && useLiveDo) {
    const ensured = await ensureAgentLiveBrowserSession(env, scopeId, {
      url: targetUrl || null,
      defer_http_navigate: Boolean(targetUrl),
      userId: params.user_id ?? params.session?.user_id ?? null,
      workspaceId: params.workspace_id ?? params.session?.workspace_id ?? null,
      tool_name: toolName || undefined,
    });
    if (ensured.error && !ensured.ok) {
      return { error: ensured.error, ok: false, status: ensured.status };
    }
    liveSessionMeta = ensured.live_session ?? null;
    if (toolName) {
      await patchAgentLiveBrowserSessionViaDo(env, scopeId, {
        tool_name: toolName,
        action_phase: 'start',
        url: liveSessionMeta?.url ?? targetUrl ?? null,
      }).catch(() => {});
    }
  }

  const consoleMessages = [];
  const networkRequests = [];
  const networkByUrl = new Map();

  const pw = await import('@cloudflare/playwright');

  let browser = null;
  let sessionId = null;
  let sessionReused = false;

  try {
    const connectId = liveSessionMeta?.session_id != null ? String(liveSessionMeta.session_id) : '';
    if (!connectId || typeof pw.connect !== 'function') {
      return {
        error: 'Agent live browser session could not connect to Browser Run',
        ok: false,
        live_session: liveSessionMeta,
      };
    }
    try {
      browser = await pw.connect(env.MYBROWSER, connectId);
      sessionId = connectId;
      sessionReused = true;
    } catch (e) {
      console.warn('[browser/page-runtime] connect to live session failed', String(e?.message || e));
      return {
        error: 'Agent live browser session could not connect to Browser Run',
        ok: false,
        live_session: liveSessionMeta,
        detail: String(e?.message || e),
      };
    }

    const page = await getActivePage(browser);
    attachPageTelemetry(page, consoleMessages, networkRequests, networkByUrl);

    const forceGoto =
      FORCE_GOTO_TOOLS.has(toolName) || params.force_goto === true || params.forceGoto === true;
    if (targetUrl) {
      await ensurePageUrl(page, targetUrl, { force: forceGoto });
    }

    const effectiveUrl = page.url() || targetUrl || '';
    const storedLive = scopeId ? await getAgentLiveBrowserSession(env, scopeId) : null;
    const browserSession =
      scopeId && sessionId
        ? {
            scope_id: scopeId,
            session_id: sessionId,
            target_id: storedLive?.targetId ?? liveSessionMeta?.target_id ?? null,
            web_socket_debugger_url:
              storedLive?.webSocketDebuggerUrl ?? liveSessionMeta?.web_socket_debugger_url ?? null,
            devtools_frontend_url:
              storedLive?.devtoolsFrontendUrl ?? liveSessionMeta?.devtools_frontend_url ?? null,
            reused: sessionReused,
          }
        : null;

    let result = await fn({
      page,
      url: effectiveUrl,
      consoleMessages,
      networkRequests,
      browserSession,
      liveSession: storedLive ? liveSessionPayload(storedLive) : liveSessionMeta,
    });

    if (useLiveDo && scopeId && toolName) {
      if (toolName === 'browser_scroll') {
        /* scroll patches emitted inside browser_scroll handler */
      } else if (toolName === 'browser_verify_current_page' || toolName === 'browser_content') {
        const expected =
          result?.expected_url || result?.requested_url || targetUrl || null;
        if (result?.verified === true && result?.live_view_verified !== false) {
          const commit = await commitAgentLiveBrowserPageState(
            env,
            scopeId,
            page,
            toolName,
            expected,
          );
          if (commit) {
            result = { ...result, ...commit };
          }
        } else if (result && result.verified === false) {
          await patchAgentLiveBrowserSessionViaDo(env, scopeId, {
            tool_name: toolName,
            action_phase: 'done',
            url: page.url(),
            requested_url: expected,
            verified: false,
            url_verified: false,
            ok: false,
          }).catch(() => null);
        }
      } else {
        const requested = targetUrl || result?.requested_url || result?.expected_url || null;
        const commit = await commitAgentLiveBrowserPageState(
          env,
          scopeId,
          page,
          toolName,
          requested,
        );
        if (commit) {
          const mergedOk =
            result &&
            typeof result === 'object' &&
            result.ok !== false &&
            commit.verified !== false;
          result =
            result && typeof result === 'object'
              ? {
                  ...result,
                  ...commit,
                  ok: mergedOk,
                  ...(commit.verified === false ? { verification_failed: true } : {}),
                }
              : { ok: commit.verified !== false, ...commit };
        }
      }
    }

    if (result && typeof result === 'object') {
      const out = { ...result };
      if (browserSession) out.browser_session = browserSession;
      if (storedLive || liveSessionMeta) {
        out.live_session = storedLive ? liveSessionPayload(storedLive) : liveSessionMeta;
      }
      return out;
    }
    return result;
  } catch (e) {
    const msg = e?.message != null ? String(e.message) : String(e);
    return { error: msg, ok: false };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* disconnect (reuse) or close (ephemeral) */
      }
    }
  }
}
