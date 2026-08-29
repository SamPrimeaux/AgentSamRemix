/**
 * Browser builtin tool dispatch — runBrowserBuiltinTool switch.
 */
import {
  withBrowserPage,
  resolveBrowserToolUrl,
  urlMatchesExpected,
  captureViewportScreenshot,
  extractPageText,
  emitBrowserScrollPatch,
  filterA11ySnapshot,
  readVerifiedPageSample,
} from '../runtime/page-runtime.js';
import {
  resolveBrowserSessionScopeId,
} from '../sessions/scope.js';
import {
  closeAgentLiveBrowserSession,
  requestBrowserHumanInput,
} from '../sessions/live-session.js';

const SCREENSHOT_TOOLS = new Set([
  'browser_screenshot',
  'cdt_take_screenshot',
  'playwright_screenshot',
]);

function htmlToVisibleText(html) {
  return String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);
}

function elementPath(tag, id, className) {
  if (id) return `${tag}#${id}`;
  const firstClass = String(className || '').trim().split(/\s+/).filter(Boolean)[0];
  return firstClass ? `${tag}.${firstClass}` : tag;
}

async function inspectBrowserPoint(page, x, y) {
  if (typeof page.createCDPSession !== 'function') {
    return { ok: false, error: 'browser_inspect_point requires a CDP-capable browser page' };
  }

  const cdp = await page.createCDPSession();
  try {
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable').catch(() => {});
    const metrics = await cdp.send('Page.getLayoutMetrics').catch(() => ({}));
    const viewport = metrics.cssVisualViewport || metrics.layoutViewport || {};
    const pageViewport =
      typeof page.viewportSize === 'function' ? page.viewportSize() : null;
    const width = Math.round(Number(viewport.clientWidth) || Number(pageViewport?.width) || 0);
    const height = Math.round(Number(viewport.clientHeight) || Number(pageViewport?.height) || 0);
    if (!width || !height) {
      return { ok: false, error: 'browser_inspect_point could not resolve page viewport' };
    }
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return {
        ok: false,
        error: `Point (${x}, ${y}) is outside the browser viewport (${width}x${height})`,
        viewport: { width, height },
      };
    }

    const location = await cdp.send('DOM.getNodeForLocation', {
      x: Math.round(x),
      y: Math.round(y),
      includeUserAgentShadowDOM: true,
      ignorePointerEventsNone: true,
    });
    const nodeId = Number(location?.nodeId || 0);
    if (!nodeId) {
      return { ok: true, element: null, x, y, viewport: { width, height } };
    }

    const described = await cdp.send('DOM.describeNode', { nodeId, depth: 0 });
    const node = described?.node || {};
    const attributes = {};
    const rawAttributes = Array.isArray(node.attributes) ? node.attributes : [];
    for (let i = 0; i + 1 < rawAttributes.length; i += 2) {
      attributes[String(rawAttributes[i])] = String(rawAttributes[i + 1]);
    }
    const tag = String(node.localName || node.nodeName || 'element').toLowerCase();
    const id = attributes.id || null;
    const className = attributes.class || null;
    const outer = await cdp.send('DOM.getOuterHTML', { nodeId }).catch(() => ({}));
    const html = String(outer?.outerHTML || '').slice(0, 3000);
    const box = await cdp.send('DOM.getBoxModel', { nodeId }).catch(() => null);
    const quad = Array.isArray(box?.model?.border) ? box.model.border : [];
    const left = quad.length >= 2 ? Math.min(quad[0], quad[2], quad[4], quad[6]) : null;
    const top = quad.length >= 2 ? Math.min(quad[1], quad[3], quad[5], quad[7]) : null;
    const right = quad.length >= 2 ? Math.max(quad[0], quad[2], quad[4], quad[6]) : null;
    const bottom = quad.length >= 2 ? Math.max(quad[1], quad[3], quad[5], quad[7]) : null;
    const boundingBox =
      left != null && top != null && right != null && bottom != null
        ? { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
        : undefined;
    const styleResult = await cdp.send('CSS.getComputedStyleForNode', { nodeId }).catch(() => ({}));
    const styles = {};
    for (const item of styleResult?.computedStyle || []) {
      if (item?.name && item?.value) styles[String(item.name)] = String(item.value);
    }

    return {
      ok: true,
      element: {
        tag,
        id,
        className,
        html,
        text: htmlToVisibleText(html),
        path: elementPath(tag, id, className),
        styles,
        attributes,
        ...(boundingBox ? { boundingBox } : {}),
      },
      x,
      y,
      viewport: { width, height },
    };
  } finally {
    if (typeof cdp.detach === 'function') {
      await cdp.detach().catch(() => {});
    }
  }
}

/**
 * @param {any} env
 * @param {string} toolName
 * @param {Record<string, unknown>} params
 */
export async function runBrowserBuiltinTool(env, toolName, params) {
  const tool = String(toolName || '').trim();
  const withOpts = { toolName: tool, persistSession: params.persist_session !== false };

  if (SCREENSHOT_TOOLS.has(tool)) {
    return withBrowserPage(
      env,
      params,
      async ({ page }) => {
        const fullPage = params.fullPage !== false;
        const out = await captureViewportScreenshot(env, page, { fullPage: Boolean(fullPage) });
        return {
          ok: true,
          url: page.url(),
          screenshot_url: out.screenshot_url,
          result_url: out.screenshot_url,
          job_id: out.job_id,
        };
      },
      withOpts,
    );
  }

  switch (tool) {
    case 'browser_close_session':
    case 'browser_session_close': {
      const scopeId = resolveBrowserSessionScopeId(params);
      if (!scopeId) return { error: 'browser_session_id required (bsess_*)' };
      return closeAgentLiveBrowserSession(env, scopeId);
    }

    case 'browser_request_human_input': {
      const scopeId = resolveBrowserSessionScopeId(params);
      if (!scopeId) return { error: 'browser_session_id required for human-in-the-loop' };
      return requestBrowserHumanInput(env, scopeId, {
        reason: String(params.reason || ''),
        url: resolveBrowserToolUrl(params) || null,
        resumeWhen: params.resumeWhen ?? params.resume_when,
        selector: params.selector,
        timeoutMs: params.timeoutMs ?? params.timeout_ms,
      });
    }

    case 'browser_navigate':
    case 'cdt_navigate_page':
      return withBrowserPage(
        env,
        params,
        async ({ page, url, liveSession }) => {
          const requestedUrl = url;
          const finalUrl = page.url() || url;
          const title = await page.title().catch(() => '');
          const page_text = await extractPageText(page);
          const verified =
            !requestedUrl || urlMatchesExpected(finalUrl, requestedUrl);
          const scopeId = resolveBrowserSessionScopeId(params);
          const agentLive = Boolean(scopeId);
          const base = {
            ok: verified,
            url: finalUrl,
            requested_url: requestedUrl,
            verified,
            url_verified: verified,
            title,
            page_text,
            text: page_text,
            agent_live_session: agentLive,
            ...(liveSession ? { live_session: liveSession } : {}),
            ...(!verified
              ? {
                  error: `Navigation was requested but not verified (expected ${requestedUrl}, got ${finalUrl})`,
                  verification_failed: true,
                }
              : {}),
          };
          if (agentLive) return base;
          const out = await captureViewportScreenshot(env, page, { fullPage: false });
          return {
            ...base,
            screenshot_url: out.screenshot_url,
            result_url: out.screenshot_url,
            job_id: out.job_id,
          };
        },
        withOpts,
      );

    case 'browser_inspect_point': {
      const scopeId = resolveBrowserSessionScopeId(params);
      if (!scopeId) return { error: 'browser_session_id required (bsess_*)' };
      const x = Number(params.x);
      const y = Number(params.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return { error: 'x and y required as finite numbers' };
      }
      const { url: _url, origin: _origin, href: _href, target_url: _targetUrl, page_url: _pageUrl, ...inspectParams } = params;
      return withBrowserPage(
        env,
        inspectParams,
        async ({ page }) => inspectBrowserPoint(page, x, y),
        withOpts,
      );
    }

    case 'browser_scroll':
      return withBrowserPage(
        env,
        params,
        async ({ page }) => {
          const scopeId = resolveBrowserSessionScopeId(params);
          const amount = Math.max(100, Number(params.amount) || 700);
          const dir = String(params.direction || 'both').toLowerCase();
          const scrollDown = dir === 'both' || dir === 'down';
          const scrollUp = dir === 'both' || dir === 'up';
          if (scrollDown) {
            await page.evaluate((y) => window.scrollBy(0, y), amount);
            await emitBrowserScrollPatch(env, scopeId, page, 'browser_scroll', 'down');
          }
          if (scrollUp) {
            await page.waitForTimeout(250).catch(() => {});
            await page.evaluate((y) => window.scrollBy(0, -y), amount);
            await emitBrowserScrollPatch(env, scopeId, page, 'browser_scroll', 'up');
          }
          return {
            ok: true,
            url: page.url(),
            scroll_amount: amount,
            scrolled_down: scrollDown,
            scrolled_up: scrollUp,
            verified: true,
          };
        },
        withOpts,
      );

    case 'browser_verify_current_page':
      return withBrowserPage(
        env,
        params,
        async ({ page, liveSession, browserSession }) => {
          const expectedUrl =
            resolveBrowserToolUrl(params) ||
            String(params.expected_url || params.expectedUrl || '').trim();
          const sid =
            browserSession?.session_id ??
            liveSession?.session_id ??
            null;
          let liveSync = null;
          if (sid) {
            liveSync = await syncLiveViewWithCdpPage(
              env,
              String(sid),
              page,
              browserSession?.target_id ?? liveSession?.target_id ?? null,
            );
          }
          const sample = await readVerifiedPageSample(page);
          const urlVerified = urlMatchesExpected(sample.url, expectedUrl);
          const liveVerified = !sid || liveSync?.live_view_verified === true;
          const requireTitle = params.require_title === true || params.requireTitle === true;
          const requireText =
            params.require_text_sample === true || params.requireTextSample === true;
          const titleOk = !requireTitle || Boolean(sample.title?.trim());
          const textOk = !requireText || sample.page_text.trim().length >= 20;
          const verified = urlVerified && liveVerified && titleOk && textOk;
          const scopeId = resolveBrowserSessionScopeId(params);
          const base = {
            ok: verified,
            verified,
            url_verified: urlVerified,
            live_view_verified: liveVerified,
            url: sample.url,
            expected_url: expectedUrl || null,
            title: sample.title,
            h1: sample.h1,
            page_text_sample: sample.page_text.slice(0, 800),
            page_text: sample.page_text.slice(0, 4000),
            text: sample.page_text.slice(0, 4000),
            session_id:
              browserSession?.session_id ??
              liveSession?.session_id ??
              null,
            target_id:
              browserSession?.target_id ?? liveSession?.target_id ?? null,
            agent_run_id: scopeId,
            agent_live_session: Boolean(scopeId),
            ...(liveSession ? { live_session: liveSession } : {}),
            ...(!verified
              ? {
                  error: !liveVerified
                    ? `Live View was not verified (CDP ${sample.url}, Browser Run target ${liveSync?.target_url || 'unknown'})`
                    : urlVerified
                      ? `Page verification failed for ${expectedUrl || sample.url}`
                      : `Navigation was requested but not verified (expected ${expectedUrl}, got ${sample.url})`,
                  verification_failed: true,
                }
              : {}),
          };
          return base;
        },
        withOpts,
      );

    case 'browser_content':
      return withBrowserPage(
        env,
        params,
        async ({ page, url, liveSession, browserSession }) => {
          const scopeId = resolveBrowserSessionScopeId(params);
          const expectedUrl =
            resolveBrowserToolUrl(params) ||
            String(params.expected_url || params.expectedUrl || '').trim() ||
            url;
          const sid =
            browserSession?.session_id ??
            liveSession?.session_id ??
            null;
          let liveSync = null;
          if (sid) {
            liveSync = await syncLiveViewWithCdpPage(
              env,
              String(sid),
              page,
              browserSession?.target_id ?? liveSession?.target_id ?? null,
            );
          }
          const cdpUrl = page.url() || url;
          const urlOk = !expectedUrl || urlMatchesExpected(cdpUrl, expectedUrl);
          const liveOk = !sid || liveSync?.live_view_verified === true;
          const verified = urlOk && liveOk;
          let html = await page.content();
          const max = Number(params.max_chars) > 0 ? Number(params.max_chars) : 400_000;
          if (html.length > max) {
            html = `${html.slice(0, max)}\n<!-- truncated -->`;
          }
          const page_text = await extractPageText(page);
          return {
            ok: verified,
            verified,
            url_verified: urlOk,
            live_view_verified: liveOk,
            url: cdpUrl,
            expected_url: expectedUrl || null,
            html: verified ? html : html.slice(0, 500),
            page_text: verified ? page_text : page_text.slice(0, 500),
            text: verified ? page_text : page_text.slice(0, 500),
            agent_run_id: scopeId,
            session_id: sid,
            ...(!verified
              ? {
                  error: !liveOk
                    ? `Live View was not verified (CDP ${cdpUrl}, Browser Run target ${liveSync?.target_url || 'unknown'})`
                    : `Page content not verified for ${expectedUrl}`,
                  verification_failed: true,
                }
              : {}),
          };
        },
        withOpts,
      );

    case 'cdt_take_snapshot': {
      const interestingOnly = params.interestingOnly !== false;
      return withBrowserPage(
        env,
        params,
        async ({ page }) => {
          let snapshot = null;
          try {
            snapshot = await page.accessibility.snapshot();
          } catch {
            snapshot = await page.evaluate(() => ({
              role: 'document',
              name: document.title,
              children: [{ role: 'generic', name: document.body?.innerText?.slice(0, 2000) || '' }],
            }));
          }
          return {
            ok: true,
            snapshot: filterA11ySnapshot(snapshot, interestingOnly),
          };
        },
        withOpts,
      );
    }

    case 'cdt_list_console_messages': {
      const limit = Math.min(500, Math.max(1, Number(params.limit) || 100));
      return withBrowserPage(env, params, async ({ consoleMessages }) => ({
        ok: true,
        messages: consoleMessages.slice(-limit),
      }), withOpts);
    }

    case 'cdt_get_console_message': {
      const idx = Number(params.index);
      return withBrowserPage(env, params, async ({ consoleMessages }) => {
        const i = Number.isFinite(idx) ? idx : 0;
        const msg = consoleMessages[i];
        if (!msg) return { ok: false, error: 'console message not found', index: i };
        return { ok: true, message: msg, index: i };
      }, withOpts);
    }

    case 'cdt_list_network_requests': {
      const limit = Math.min(500, Math.max(1, Number(params.limit) || 100));
      return withBrowserPage(env, params, async ({ networkRequests }) => ({
        ok: true,
        requests: networkRequests.slice(-limit),
      }), withOpts);
    }

    case 'cdt_get_network_request': {
      const target = String(params.url || params.request_url || '').trim();
      return withBrowserPage(env, params, async ({ networkRequests }) => {
        const hit = networkRequests.find((r) => String(r.url) === target);
        if (!hit) return { ok: false, error: 'network request not found', url: target };
        return { ok: true, request: hit };
      }, withOpts);
    }

    case 'cdt_list_pages':
      return withBrowserPage(env, params, async ({ page, url }) => ({
        ok: true,
        pages: [{ url: page.url() || url, title: await page.title().catch(() => '') }],
      }), withOpts);

    case 'cdt_wait_for': {
      const selector = params.selector != null ? String(params.selector).trim() : '';
      const text = params.text != null ? String(params.text).trim() : '';
      const timeout = Math.min(120_000, Math.max(1000, Number(params.timeout) || 30_000));
      return withBrowserPage(env, params, async ({ page }) => {
        if (selector) {
          await page.waitForSelector(selector, { timeout });
        } else if (text) {
          await page.getByText(text, { exact: false }).first().waitFor({ timeout });
        } else {
          await page.waitForLoadState('networkidle', { timeout }).catch(() => {});
        }
        return { ok: true, url: page.url() };
      }, withOpts);
    }

    case 'cdt_click': {
      const selector = String(params.selector || '').trim();
      if (!selector) return { error: 'selector required' };
      return withBrowserPage(env, params, async ({ page }) => {
        await page.click(selector, { timeout: 15_000 });
        return { ok: true, url: page.url() };
      }, withOpts);
    }

    case 'cdt_fill': {
      const selector = String(params.selector || '').trim();
      const value = params.value != null ? String(params.value) : '';
      if (!selector) return { error: 'selector required' };
      return withBrowserPage(env, params, async ({ page }) => {
        await page.fill(selector, value, { timeout: 15_000 });
        return { ok: true, url: page.url() };
      }, withOpts);
    }

    case 'cdt_fill_form': {
      const fields = params.fields;
      if (!fields || typeof fields !== 'object') return { error: 'fields object required' };
      return withBrowserPage(env, params, async ({ page }) => {
        for (const [sel, val] of Object.entries(fields)) {
          await page.fill(String(sel), val != null ? String(val) : '', { timeout: 15_000 });
        }
        return { ok: true, url: page.url() };
      }, withOpts);
    }

    case 'cdt_hover': {
      const selector = String(params.selector || '').trim();
      if (!selector) return { error: 'selector required' };
      return withBrowserPage(env, params, async ({ page }) => {
        await page.hover(selector, { timeout: 15_000 });
        return { ok: true, url: page.url() };
      }, withOpts);
    }

    case 'cdt_press_key': {
      const key = String(params.key || params.text || 'Enter').trim();
      return withBrowserPage(env, params, async ({ page }) => {
        await page.keyboard.press(key);
        return { ok: true, url: page.url() };
      }, withOpts);
    }

    case 'browser_evaluate_script':
    case 'cdt_evaluate_script': {
      const script = String(params.script || params.expression || '').trim();
      if (!script) return { error: 'script required' };
      return withBrowserPage(env, params, async ({ page }) => {
        const result = await page.evaluate((s) => {
          // eslint-disable-next-line no-eval
          return (0, eval)(s);
        }, script);
        return { ok: true, result, url: page.url() };
      }, withOpts);
    }

    case 'cdt_upload_file': {
      const selector = String(params.selector || '').trim();
      const fileUrl = String(params.file_url || params.target_file_url || '').trim();
      if (!selector || !fileUrl) return { error: 'selector and file_url required' };
      return withBrowserPage(env, params, async ({ page }) => {
        const res = await fetch(fileUrl);
        if (!res.ok) return { error: `fetch file failed: ${res.status}` };
        const buf = await res.arrayBuffer();
        const name = fileUrl.split('/').pop() || 'upload.bin';
        await page.locator(selector).setInputFiles({
          name,
          mimeType: res.headers.get('content-type') || 'application/octet-stream',
          buffer: new Uint8Array(buf),
        });
        return { ok: true, url: page.url() };
      }, withOpts);
    }

    case 'cdt_resize_page':
    case 'cdt_emulate': {
      const width = Number(params.width) || 1280;
      const height = Number(params.height) || 800;
      return withBrowserPage(env, params, async ({ page }) => {
        await page.setViewportSize({ width, height });
        return { ok: true, width, height, url: page.url() };
      }, withOpts);
    }

    case 'cdt_new_page':
    case 'cdt_select_page':
    case 'cdt_close_page':
      return withBrowserPage(env, params, async ({ page, url, browserSession }) => ({
        ok: true,
        note: 'Single page per run-scoped session; use browser_close_session to end',
        url: page.url() || url,
        browser_session: browserSession,
      }), withOpts);

    case 'cdt_handle_dialog': {
      const accept = params.accept !== false;
      return withBrowserPage(env, params, async ({ page }) => {
        page.once('dialog', async (dialog) => {
          if (accept) await dialog.accept(params.promptText != null ? String(params.promptText) : undefined);
          else await dialog.dismiss();
        });
        return { ok: true, url: page.url(), accept };
      }, withOpts);
    }

    case 'cdt_drag': {
      const from = params.from || params.start;
      const to = params.to || params.end;
      if (!from || !to) return { error: 'from and to required (x,y objects or selectors)' };
      return withBrowserPage(env, params, async ({ page }) => {
        if (typeof from === 'string' && typeof to === 'string') {
          await page.dragAndDrop(from, to, { timeout: 15_000 });
        } else {
          await page.mouse.move(Number(from.x) || 0, Number(from.y) || 0);
          await page.mouse.down();
          await page.mouse.move(Number(to.x) || 0, Number(to.y) || 0);
          await page.mouse.up();
        }
        return { ok: true, url: page.url() };
      }, withOpts);
    }

    case 'a11y_audit_webpage':
      return withBrowserPage(env, params, async ({ page, url }) => {
        const audit = await page.evaluate(() => {
          const issues = [];
          if (!document.title?.trim()) issues.push({ id: 'missing-title', impact: 'moderate' });
          const imgs = [...document.querySelectorAll('img')];
          const missingAlt = imgs.filter((i) => !i.getAttribute('alt')?.trim()).length;
          if (missingAlt) issues.push({ id: 'img-alt', impact: 'serious', count: missingAlt });
          const h1 = document.querySelectorAll('h1').length;
          if (h1 !== 1) issues.push({ id: 'h1-count', impact: 'moderate', count: h1 });
          return { issues, documentTitle: document.title || '' };
        });
        return { ok: true, url: page.url() || url, audit, engine: 'playwright-heuristic' };
      }, withOpts);

    case 'cdt_performance_start_trace':
    case 'cdt_performance_stop_trace':
    case 'cdt_performance_analyze_insight':
      return {
        ok: false,
        error: 'Performance trace tools are not supported on the MYBROWSER worker path',
        hint: 'Use cdt_take_snapshot and cdt_list_network_requests for page diagnostics',
      };

    default:
      if (tool.startsWith('cdt_') || tool.startsWith('browser_')) {
        return {
          error: `Unsupported browser tool: ${tool}`,
          hint: 'Register handler in backend/browser/tools/dispatch.js',
        };
      }
      return { error: `Not a browser tool: ${tool}` };
  }
}


export {
  withBrowserPage,
  resolveBrowserToolUrl,
  urlMatchesExpected,
} from '../runtime/page-runtime.js';

export { resolveBrowserSessionScopeId } from '../sessions/scope.js';

export {
  ensureAgentLiveBrowserSession,
  closeAgentLiveBrowserSession,
  requestBrowserHumanInput,
  liveSessionPayload,
  getAgentLiveBrowserSession,
} from '../sessions/live-session.js';
