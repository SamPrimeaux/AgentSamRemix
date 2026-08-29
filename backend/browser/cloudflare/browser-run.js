/**
 * Cloudflare Browser Run — HTTP CDP session management (live.browser.run Live View).
 * @see https://developers.cloudflare.com/browser-run/cdp/session-management/
 */

const DEFAULT_KEEP_ALIVE_MS = 600_000;

/**
 * Cloudflare Live View supports `mode=tab` (page watch) vs `mode=devtools` (inspector).
 * @see https://developers.cloudflare.com/browser-run/features/live-view/
 * @param {string|null|undefined} url
 * @param {'tab'|'devtools'} [mode]
 */
export function applyBrowserRunLiveViewMode(url, mode = 'tab') {
  const raw = String(url || '').trim();
  if (!raw || !raw.includes('live.browser.run')) return raw || null;
  const want = mode === 'devtools' ? 'devtools' : 'tab';
  try {
    const u = new URL(raw);
    if (u.pathname.includes('/inspector')) {
      u.pathname = u.pathname.replace(/\/inspector\b/, '/view');
    }
    u.searchParams.set('mode', want);
    return u.toString();
  } catch {
    if (raw.includes('mode=')) {
      return raw.replace(/([?&]mode=)[^&]*/i, `$1${want}`);
    }
    const sep = raw.includes('?') ? '&' : '?';
    return `${raw}${sep}mode=${want}`;
  }
}

/**
 * Pick the primary page target from Browser Run /json/list or create response.
 * @param {unknown} targets
 */
export function pickBrowserRunPageTarget(targets) {
  const list = Array.isArray(targets) ? targets : targets != null ? [targets] : [];
  const page =
    list.find((t) => t && typeof t === 'object' && String(t.type || '').toLowerCase() === 'page') ||
    list.find((t) => t && typeof t === 'object' && t.devtoolsFrontendUrl) ||
    list[0];
  if (!page || typeof page !== 'object') return null;
  return page;
}

/**
 * @param {Record<string, unknown>} target
 */
export function extractBrowserRunTargetFields(target) {
  const devtoolsFrontendUrl = String(
    target.devtoolsFrontendUrl || target.devtools_frontend_url || '',
  ).trim();
  const webSocketDebuggerUrl = String(
    target.webSocketDebuggerUrl || target.web_socket_debugger_url || '',
  ).trim();
  return {
    devtoolsFrontendUrl: devtoolsFrontendUrl || null,
    webSocketDebuggerUrl: webSocketDebuggerUrl || null,
    targetId: target.id != null ? String(target.id) : null,
    url: target.url != null ? String(target.url) : null,
    title: target.title != null ? String(target.title) : null,
  };
}

/**
 * @param {any} env
 */
function resolveBrowserRunApiCredentials(env) {
  const accountId = String(env?.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const apiToken = String(env?.CLOUDFLARE_API_TOKEN || '').trim();
  if (!accountId || !apiToken) {
    return { ok: false, error: 'Cloudflare Browser Run API credentials not configured' };
  }
  return { ok: true, accountId, apiToken };
}

/**
 * @param {any} env
 * @param {string} path — e.g. `/devtools/browser`
 * @param {{ method?: string, query?: Record<string, string> }} [opts]
 */
async function browserRunApiFetch(env, path, opts = {}) {
  const creds = resolveBrowserRunApiCredentials(env);
  if (!creds.ok) return creds;

  const method = String(opts.method || 'GET').toUpperCase();
  const qs =
    opts.query && Object.keys(opts.query).length
      ? `?${new URLSearchParams(opts.query).toString()}`
      : '';
  const url = `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/browser-rendering${path}${qs}`;

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${creds.apiToken}`,
      Accept: 'application/json',
    },
  }).catch((e) => ({ ok: false, status: 0, _err: e }));

  if (!res?.ok) {
    const status = res?.status ?? 0;
    let detail = res?._err?.message ?? res?.statusText ?? 'Browser Run API request failed';
    try {
      const text = await res.text?.();
      if (text) {
        const json = JSON.parse(text);
        detail = json?.errors?.[0]?.message || json?.error || detail;
      }
    } catch {
      /* ignore parse */
    }
    return { ok: false, error: detail, status };
  }

  let json = null;
  try {
    json = await res.json();
  } catch {
    return { ok: false, error: 'Browser Run API returned non-JSON response' };
  }

  const payload = json?.result != null ? json.result : json;
  return { ok: true, data: payload, raw: json };
}

/**
 * @param {any} env
 * @param {{ keepAliveMs?: number, targets?: boolean }} [opts]
 */
export async function createBrowserRunSession(env, opts = {}) {
  const keepAliveMs = Math.min(
    600_000,
    Math.max(60_000, Number(opts.keepAliveMs ?? DEFAULT_KEEP_ALIVE_MS) || DEFAULT_KEEP_ALIVE_MS),
  );
  const query = { keep_alive: String(keepAliveMs) };
  if (opts.targets !== false) {
    query.targets = 'true';
  }
  const out = await browserRunApiFetch(env, '/devtools/browser', {
    method: 'POST',
    query,
  });
  if (!out.ok) return out;
  const sessionId = String(out.data?.sessionId || out.data?.session_id || '').trim();
  if (!sessionId) {
    return { ok: false, error: 'Browser Run session create did not return sessionId' };
  }
  const targets = out.data?.targets ?? out.data?.target ?? null;
  const target = pickBrowserRunPageTarget(targets);
  const fields = target ? extractBrowserRunTargetFields(target) : {};
  return {
    ok: true,
    sessionId,
    keepAliveMs,
    targets: Array.isArray(targets) ? targets : target ? [target] : [],
    ...fields,
  };
}

/**
 * @param {any} env
 * @param {string} sessionId
 */
export async function listBrowserRunTargets(env, sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return { ok: false, error: 'sessionId required' };
  const out = await browserRunApiFetch(
    env,
    `/devtools/browser/${encodeURIComponent(sid)}/json/list`,
    { method: 'GET' },
  );
  if (!out.ok) return out;
  const targets = Array.isArray(out.data) ? out.data : [];
  return { ok: true, sessionId: sid, targets };
}

/**
 * Refresh devtoolsFrontendUrl from current page target (valid ~5 min from issue).
 * @param {any} env
 * @param {{ sessionId: string, targetId?: string|null }} opts
 */
export async function refreshBrowserRunLiveView(env, opts) {
  const sessionId = String(opts?.sessionId || '').trim();
  if (!sessionId) return { ok: false, error: 'sessionId required' };

  const listed = await listBrowserRunTargets(env, sessionId);
  if (!listed.ok) return listed;

  const wantId = opts?.targetId != null ? String(opts.targetId).trim() : '';
  let target = wantId
    ? listed.targets.find((t) => t && String(t.id) === wantId)
    : null;
  if (!target) target = pickBrowserRunPageTarget(listed.targets);
  if (!target) return { ok: false, error: 'No page target in Browser Run session' };

  const fields = extractBrowserRunTargetFields(target);
  if (!fields.devtoolsFrontendUrl) {
    return { ok: false, error: 'Target list did not return devtoolsFrontendUrl' };
  }
  return { ok: true, sessionId, ...fields };
}

/**
 * @param {any} env
 * @param {{ sessionId: string, url: string }} opts
 */
export async function navigateBrowserRunTab(env, opts) {
  const sessionId = String(opts?.sessionId || '').trim();
  const url = String(opts?.url || '').trim();
  if (!sessionId) return { ok: false, error: 'sessionId required' };
  if (!url) return { ok: false, error: 'url required' };

  const out = await browserRunApiFetch(env, `/devtools/browser/${encodeURIComponent(sessionId)}/json/new`, {
    method: 'PUT',
    query: { url },
  });
  if (!out.ok) return out;

  const target = out.data && typeof out.data === 'object' ? out.data : {};
  const fields = extractBrowserRunTargetFields(target);
  if (!fields.devtoolsFrontendUrl) {
    return { ok: false, error: 'Browser Run navigate did not return devtoolsFrontendUrl' };
  }

  return {
    ok: true,
    sessionId,
    ...fields,
    url: fields.url || url,
  };
}

/**
 * @param {any} env
 * @param {{ sessionId: string }} opts
 */
export async function deleteBrowserRunSession(env, opts) {
  const sessionId = String(opts?.sessionId || '').trim();
  if (!sessionId) return { ok: false, error: 'sessionId required' };

  const out = await browserRunApiFetch(env, `/devtools/browser/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
  if (!out.ok) return out;
  return { ok: true, sessionId, status: out.data?.status ?? 'closing' };
}

/**
 * Open (or reuse) a Browser Run session, navigate to url, return embeddable Live View URL.
 * @param {any} env
 * @param {{ url: string, sessionId?: string|null, keepAliveMs?: number }} opts
 */
export async function openBrowserRunLiveView(env, opts) {
  const url = String(opts?.url || '').trim();
  if (!url) return { ok: false, error: 'url required' };

  let sessionId = opts?.sessionId != null ? String(opts.sessionId).trim() : '';
  if (!sessionId) {
    const created = await createBrowserRunSession(env, { keepAliveMs: opts?.keepAliveMs });
    if (!created.ok) return created;
    sessionId = created.sessionId;
  }

  let navigated = await navigateBrowserRunTab(env, { sessionId, url });
  if (!navigated.ok && opts?.sessionId) {
    const created = await createBrowserRunSession(env, { keepAliveMs: opts?.keepAliveMs });
    if (!created.ok) return created;
    sessionId = created.sessionId;
    navigated = await navigateBrowserRunTab(env, { sessionId, url });
  }
  if (!navigated.ok) return navigated;

  return {
    ok: true,
    session_id: sessionId,
    devtools_frontend_url: applyBrowserRunLiveViewMode(navigated.devtoolsFrontendUrl, 'tab'),
    web_socket_debugger_url: navigated.webSocketDebuggerUrl,
    url: navigated.url,
    title: navigated.title,
    target_id: navigated.targetId,
  };
}
