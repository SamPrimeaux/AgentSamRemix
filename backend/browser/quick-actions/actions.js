/**
 * Cloudflare Browser Run Quick Actions — stateless REST API (no Puppeteer/CDP/sessions).
 * @see https://developers.cloudflare.com/browser-run/quick-actions/
 */

const CRAWL_POLL_MS = 3_000;
const CRAWL_MAX_ATTEMPTS = 20;

/**
 * @param {any} env
 */
function resolveCredentials(env) {
  const accountId = String(env?.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const apiToken = String(env?.CLOUDFLARE_API_TOKEN || '').trim();
  if (!accountId || !apiToken) {
    return { ok: false, error: 'Cloudflare Browser Run API credentials not configured' };
  }
  return { ok: true, accountId, apiToken };
}

/**
 * @param {any} env
 * @param {string} path
 * @param {{ method?: string, body?: unknown, query?: Record<string, string>, expectJson?: boolean }} [opts]
 */
async function browserRenderingFetch(env, path, opts = {}) {
  const creds = resolveCredentials(env);
  if (!creds.ok) return creds;

  const method = String(opts.method || 'POST').toUpperCase();
  const qs =
    opts.query && Object.keys(opts.query).length
      ? `?${new URLSearchParams(opts.query).toString()}`
      : '';
  const url = `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/browser-rendering${path}${qs}`;

  const headers = {
    Authorization: `Bearer ${creds.apiToken}`,
    Accept: opts.expectJson === false ? '*/*' : 'application/json',
  };
  const init = { method, headers };
  if (opts.body != null && method !== 'GET' && method !== 'HEAD') {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }

  const res = await fetch(url, init).catch((e) => ({ ok: false, status: 0, _err: e }));
  if (!res?.ok) {
    let detail = res?._err?.message ?? res?.statusText ?? 'Browser Run API request failed';
    try {
      const text = await res.text?.();
      if (text) {
        const json = JSON.parse(text);
        detail = json?.errors?.[0]?.message || json?.error || detail;
      }
    } catch {
      /* ignore */
    }
    return { ok: false, error: String(detail), status: res?.status ?? 0 };
  }

  if (opts.expectJson === false) {
    return { ok: true, response: res };
  }

  let json = null;
  try {
    json = await res.json();
  } catch {
    return { ok: false, error: 'Browser Run API returned non-JSON response' };
  }
  if (json?.success === false) {
    const detail = json?.errors?.[0]?.message || 'Browser Run API error';
    return { ok: false, error: String(detail), body: json };
  }
  const result = json?.result != null ? json.result : json;
  return { ok: true, data: result, raw: json };
}

function normalizeUrlInput(params) {
  const raw = params?.url ?? params?.href ?? params?.target_url;
  const u = raw != null ? String(raw).trim() : '';
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return `https:${u}`;
  return `https://${u.replace(/^\/+/, '')}`;
}

function rejectResourceTypesBody(extra = {}) {
  return {
    rejectResourceTypes: ['image', 'media', 'font'],
    ...extra,
  };
}

/**
 * @param {Response} res
 */
async function responseToBase64(res) {
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** @param {any} env @param {Record<string, unknown>} params */
export async function browserRunMarkdown(env, params = {}) {
  try {
    const url = normalizeUrlInput(params);
    if (!url) return { ok: false, error: 'url required' };

    const waitForNetwork = params.wait_for_network === true || params.waitForNetwork === true;
    const body = {
      url,
      ...rejectResourceTypesBody(),
      ...(waitForNetwork ? { gotoOptions: { waitUntil: 'networkidle2' } } : {}),
    };

    const out = await browserRenderingFetch(env, '/markdown', { method: 'POST', body });
    if (!out.ok) return { ok: false, error: out.error };

    const markdown =
      typeof out.data === 'string'
        ? out.data
        : typeof out.data?.markdown === 'string'
          ? out.data.markdown
          : typeof out.data?.result === 'string'
            ? out.data.result
            : '';

    if (!markdown) return { ok: false, error: 'markdown endpoint returned empty result' };
    return { ok: true, data: { markdown }, markdown };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/** @param {any} env @param {Record<string, unknown>} params */
export async function browserRunContent(env, params = {}) {
  try {
    const url = normalizeUrlInput(params);
    if (!url) return { ok: false, error: 'url required' };

    const waitForNetwork = params.wait_for_network === true || params.waitForNetwork === true;
    const body = {
      url,
      ...rejectResourceTypesBody(),
      ...(waitForNetwork ? { gotoOptions: { waitUntil: 'networkidle2' } } : {}),
    };

    const out = await browserRenderingFetch(env, '/content', { method: 'POST', body });
    if (!out.ok) return { ok: false, error: out.error };

    const html =
      typeof out.data === 'string'
        ? out.data
        : typeof out.data?.html === 'string'
          ? out.data.html
          : typeof out.data?.content === 'string'
            ? out.data.content
            : '';

    if (!html) return { ok: false, error: 'content endpoint returned empty result' };
    return { ok: true, data: { html }, html };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/** @param {any} env @param {Record<string, unknown>} params */
export async function browserRunScreenshot(env, params = {}) {
  try {
    const url = normalizeUrlInput(params);
    if (!url) return { ok: false, error: 'url required' };

    const fullPage = params.full_page === true || params.fullPage === true;
    const body = {
      url,
      screenshotOptions: {
        fullPage: Boolean(fullPage),
        type: 'jpeg',
        quality: 80,
      },
    };

    const out = await browserRenderingFetch(env, '/screenshot', {
      method: 'POST',
      body,
      expectJson: false,
    });
    if (!out.ok) return { ok: false, error: out.error };

    const res = out.response;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('json')) {
      const json = await res.json().catch(() => null);
      const b64 =
        typeof json?.result === 'string'
          ? json.result
          : typeof json?.result?.screenshot === 'string'
            ? json.result.screenshot
            : '';
      if (!b64) return { ok: false, error: 'screenshot endpoint returned empty JSON result' };
      return { ok: true, data: { image_base64: b64, content_type: 'image/jpeg' }, image_base64: b64 };
    }

    const image_base64 = await responseToBase64(res);
    if (!image_base64) return { ok: false, error: 'screenshot endpoint returned empty body' };
    return {
      ok: true,
      data: { image_base64, content_type: contentType || 'image/jpeg' },
      image_base64,
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/** @param {any} env @param {Record<string, unknown>} params */
export async function browserRunLinks(env, params = {}) {
  try {
    const url = normalizeUrlInput(params);
    if (!url) return { ok: false, error: 'url required' };

    const visibleOnly =
      params.visible_only !== false &&
      params.visibleOnly !== false &&
      params.visibleLinksOnly !== false;
    const excludeExternal =
      params.exclude_external === true ||
      params.excludeExternal === true ||
      params.excludeExternalLinks === true;

    const body = {
      url,
      visibleLinksOnly: Boolean(visibleOnly),
      excludeExternalLinks: Boolean(excludeExternal),
    };

    const out = await browserRenderingFetch(env, '/links', { method: 'POST', body });
    if (!out.ok) return { ok: false, error: out.error };

    let links = [];
    if (Array.isArray(out.data)) links = out.data;
    else if (Array.isArray(out.data?.links)) links = out.data.links;
    else if (Array.isArray(out.data?.result)) links = out.data.result;

    links = links.map((x) => String(x)).filter(Boolean);
    return { ok: true, data: { links }, links };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/** @param {any} env @param {Record<string, unknown>} params */
export async function browserRunCrawl(env, params = {}) {
  try {
    const url = normalizeUrlInput(params);
    if (!url) return { ok: false, error: 'url required' };

    const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
    const depth = Math.min(10, Math.max(1, Number(params.depth) || 3));
    const render = params.render === true;

    const body = {
      url,
      limit,
      depth,
      formats: ['markdown'],
      render,
      crawlPurposes: ['search', 'ai-input'],
      options: {
        includeSubdomains: params.include_subdomains === true || params.includeSubdomains === true,
        includeExternalLinks:
          params.include_external === true || params.includeExternal === true,
        ...(Array.isArray(params.include_patterns) ? { includePatterns: params.include_patterns } : {}),
        ...(Array.isArray(params.exclude_patterns) ? { excludePatterns: params.exclude_patterns } : {}),
      },
    };

    const started = await browserRenderingFetch(env, '/crawl', { method: 'POST', body });
    if (!started.ok) return { ok: false, error: started.error };

    const job_id = String(
      typeof started.data === 'string'
        ? started.data
        : started.data?.id ?? started.data?.job_id ?? '',
    ).trim();
    if (!job_id) return { ok: false, error: 'crawl job did not return job_id' };

    let terminal = null;
    for (let attempt = 0; attempt < CRAWL_MAX_ATTEMPTS; attempt++) {
      const poll = await browserRenderingFetch(env, `/crawl/${encodeURIComponent(job_id)}`, {
        method: 'GET',
        query: { limit: '1' },
      });
      if (!poll.ok) return { ok: false, error: poll.error, job_id };

      const statusPayload = poll.data && typeof poll.data === 'object' ? poll.data : {};
      const status = String(statusPayload.status || '').trim();
      if (status && status !== 'running') {
        terminal = statusPayload;
        break;
      }
      await new Promise((r) => setTimeout(r, CRAWL_POLL_MS));
    }

    if (!terminal) {
      return { ok: false, error: 'crawl job did not complete within polling window', job_id, status: 'running' };
    }

    const finalStatus = String(terminal.status || '');
    if (finalStatus !== 'completed') {
      return {
        ok: false,
        error: `crawl job ended with status ${finalStatus || 'unknown'}`,
        job_id,
        status: finalStatus,
      };
    }

    const results = await browserRenderingFetch(env, `/crawl/${encodeURIComponent(job_id)}`, {
      method: 'GET',
      query: { limit: '50' },
    });
    if (!results.ok) {
      return { ok: false, error: results.error, job_id, status: finalStatus };
    }

    const payload = results.data && typeof results.data === 'object' ? results.data : {};
    const records = Array.isArray(payload.records) ? payload.records : [];
    const normalized = records.map((row) => ({
      url: row?.url != null ? String(row.url) : '',
      markdown: row?.markdown != null ? String(row.markdown) : '',
      metadata: row?.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    }));

    return {
      ok: true,
      data: { job_id, status: finalStatus, records: normalized },
      job_id,
      status: finalStatus,
      records: normalized,
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/** @param {any} env @param {Record<string, unknown>} params */
export async function browserRunJson(env, params = {}) {
  try {
    const url = normalizeUrlInput(params);
    const prompt = params.prompt != null ? String(params.prompt).trim() : '';
    if (!url) return { ok: false, error: 'url required' };
    if (!prompt) return { ok: false, error: 'prompt required' };

    const schema =
      params.schema && typeof params.schema === 'object'
        ? params.schema
        : params.response_format &&
            typeof params.response_format === 'object' &&
            params.response_format.json_schema
          ? params.response_format.json_schema
          : { type: 'object', properties: {} };

    const body = {
      url,
      prompt,
      response_format: {
        type: 'json_schema',
        json_schema: schema,
      },
    };

    const out = await browserRenderingFetch(env, '/json', { method: 'POST', body });
    if (!out.ok) return { ok: false, error: out.error };

    const data =
      out.data && typeof out.data === 'object' && !Array.isArray(out.data)
        ? out.data
        : typeof out.data === 'string'
          ? (() => {
              try {
                return JSON.parse(out.data);
              } catch {
                return { raw: out.data };
              }
            })()
          : { result: out.data };

    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/** @param {any} env @param {Record<string, unknown>} params */
export async function browserRunPdf(env, params = {}) {
  try {
    const url = normalizeUrlInput(params);
    const html = params.html != null ? String(params.html) : '';
    if (!url && !html.trim()) return { ok: false, error: 'url or html required' };

    /** @type {Record<string, unknown>} */
    const body = url ? { url } : { html: html.trim() };
    if (params.pdf_options && typeof params.pdf_options === 'object') {
      body.pdfOptions = params.pdf_options;
    } else if (params.pdfOptions && typeof params.pdfOptions === 'object') {
      body.pdfOptions = params.pdfOptions;
    }
    const waitForNetwork = params.wait_for_network === true || params.waitForNetwork === true;
    if (waitForNetwork) {
      body.gotoOptions = { waitUntil: 'networkidle2' };
    }

    const out = await browserRenderingFetch(env, '/pdf', {
      method: 'POST',
      body,
      expectJson: false,
    });
    if (!out.ok) return { ok: false, error: out.error };

    const res = out.response;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('json')) {
      const json = await res.json().catch(() => null);
      const b64 =
        typeof json?.result === 'string'
          ? json.result
          : typeof json?.result?.pdf === 'string'
            ? json.result.pdf
            : '';
      if (!b64) return { ok: false, error: 'pdf endpoint returned empty JSON result' };
      return {
        ok: true,
        data: { pdf_base64: b64, content_type: 'application/pdf' },
        pdf_base64: b64,
      };
    }

    const pdf_base64 = await responseToBase64(res);
    if (!pdf_base64) return { ok: false, error: 'pdf endpoint returned empty body' };
    return {
      ok: true,
      data: { pdf_base64, content_type: contentType || 'application/pdf' },
      pdf_base64,
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/** @param {any} env @param {Record<string, unknown>} params */
export async function browserRunScrape(env, params = {}) {
  try {
    const url = normalizeUrlInput(params);
    const rawElements = params.elements;
    const elements = Array.isArray(rawElements)
      ? rawElements
          .map((el) => {
            if (!el || typeof el !== 'object') return null;
            const selector =
              typeof el.selector === 'string'
                ? el.selector.trim()
                : typeof el === 'string'
                  ? el.trim()
                  : '';
            if (!selector) return null;
            return { selector };
          })
          .filter(Boolean)
      : [];
    if (!url) return { ok: false, error: 'url required' };
    if (!elements.length) return { ok: false, error: 'elements required (array of { selector })' };

    const waitForNetwork = params.wait_for_network === true || params.waitForNetwork === true;
    const body = {
      url,
      elements,
      ...(waitForNetwork ? { gotoOptions: { waitUntil: 'networkidle2' } } : {}),
    };

    const out = await browserRenderingFetch(env, '/scrape', { method: 'POST', body });
    if (!out.ok) return { ok: false, error: out.error };

    const result = Array.isArray(out.data)
      ? out.data
      : Array.isArray(out.data?.result)
        ? out.data.result
        : [];
    return { ok: true, data: { result }, result };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/** @param {any} env @param {Record<string, unknown>} params */
export async function browserRunSnapshot(env, params = {}) {
  try {
    const url = normalizeUrlInput(params);
    const html = params.html != null ? String(params.html) : '';
    if (!url && !html.trim()) return { ok: false, error: 'url or html required' };

    const formats = Array.isArray(params.formats)
      ? params.formats.map((f) => String(f)).filter(Boolean)
      : ['content', 'screenshot'];

    /** @type {Record<string, unknown>} */
    const body = url ? { url, formats } : { html: html.trim(), formats };
    const fullPage = params.full_page === true || params.fullPage === true;
    if (fullPage) {
      body.screenshotOptions = { fullPage: true, type: 'jpeg', quality: 80 };
    }
    const waitForNetwork = params.wait_for_network === true || params.waitForNetwork === true;
    if (waitForNetwork) {
      body.gotoOptions = { waitUntil: 'networkidle2' };
    }

    const out = await browserRenderingFetch(env, '/snapshot', { method: 'POST', body });
    if (!out.ok) return { ok: false, error: out.error };

    const payload =
      out.data && typeof out.data === 'object' && !Array.isArray(out.data) ? out.data : {};
    const normalized = {
      content: typeof payload.content === 'string' ? payload.content : undefined,
      html: typeof payload.html === 'string' ? payload.html : undefined,
      markdown: typeof payload.markdown === 'string' ? payload.markdown : undefined,
      screenshot:
        typeof payload.screenshot === 'string'
          ? payload.screenshot
          : typeof payload.image_base64 === 'string'
            ? payload.image_base64
            : undefined,
      accessibility_tree:
        payload.accessibilityTree && typeof payload.accessibilityTree === 'object'
          ? payload.accessibilityTree
          : payload.accessibility_tree && typeof payload.accessibility_tree === 'object'
            ? payload.accessibility_tree
            : undefined,
      meta: out.raw?.meta && typeof out.raw.meta === 'object' ? out.raw.meta : undefined,
    };
    if (
      !normalized.content &&
      !normalized.html &&
      !normalized.markdown &&
      !normalized.screenshot &&
      !normalized.accessibility_tree
    ) {
      return { ok: false, error: 'snapshot endpoint returned empty result' };
    }
    return { ok: true, data: normalized, ...normalized };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export const BROWSER_RUN_QUICKACTIONS = {
  markdown: browserRunMarkdown,
  content: browserRunContent,
  screenshot: browserRunScreenshot,
  links: browserRunLinks,
  crawl: browserRunCrawl,
  json: browserRunJson,
  pdf: browserRunPdf,
  scrape: browserRunScrape,
  snapshot: browserRunSnapshot,
};
