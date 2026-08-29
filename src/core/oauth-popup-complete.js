/**
 * OAuth popup completion — postMessage to opener + window.close().
 * Used by integration and login connect flows from app/dashboard/agent hub.
 */

/** @param {string} provider */
export function normalizeOAuthPopupProvider(provider) {
  const p = String(provider || '')
    .trim()
    .toLowerCase();
  if (p === 'google' || p === 'google_drive') return 'google_drive';
  if (p === 'cloudflare' || p === 'cloudflare_oauth') return 'cloudflare';
  if (p === 'github') return 'github';
  return p || 'unknown';
}

/**
 * Popup completion HTML only when start explicitly set popup=1.
 * Do NOT infer popup from return_to=/dashboard/agent — top-level reconnect
 * (e.g. Files GitHub Connect) must 302 back to the app, not stuck "Closing…" tabs.
 * @param {Record<string, unknown>|null|undefined} stored
 * @param {string} [_absReturn]
 */
export function integrationOAuthShouldPopup(stored, _absReturn) {
  return !!(stored && stored.popup === true);
}

/**
 * Preserve an OAuth return URL's existing query and hash while adding outcome params.
 * @param {string} returnUrl
 * @param {Record<string, string>} params
 */
export function appendOAuthReturnParams(returnUrl, params) {
  const target = new URL(String(returnUrl));
  for (const [key, value] of Object.entries(params || {})) {
    target.searchParams.set(key, String(value));
  }
  return target.toString();
}

/**
 * @param {string} provider
 * @param {{ error?: string|null, returnTo?: string|null }} [opts]
 */
export function oauthPopupCompleteHtml(provider, opts = {}) {
  const normalized = normalizeOAuthPopupProvider(provider);
  const ok = !opts.error;
  const payload = {
    type: 'iam_oauth_done',
    provider: normalized,
    ok,
    error: opts.error ? String(opts.error) : null,
  };
  const legacyType = ok ? 'oauth_success' : 'oauth_error';
  const legacyProvider = normalized === 'google_drive' ? 'google' : normalized;
  const payloadJson = JSON.stringify(payload);
  const legacyOkJson = JSON.stringify({ type: legacyType, provider: legacyProvider, ok, error: payload.error });
  // Same-origin relative or absolute return — used when window.close is blocked (tab, not popup).
  let fallbackHref = '/dashboard/agent';
  try {
    const raw = opts.returnTo != null ? String(opts.returnTo).trim() : '';
    if (raw) {
      if (raw.startsWith('/') && !raw.startsWith('//')) {
        fallbackHref = raw;
      } else {
        const u = new URL(raw);
        if (u.origin === 'https://inneranimalmedia.com' || u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
          fallbackHref = `${u.pathname}${u.search}${u.hash}` || '/dashboard/agent';
        }
      }
    }
  } catch {
    /* keep default */
  }
  const fallbackJson = JSON.stringify(fallbackHref);
  const statusLine = ok
    ? 'Connected. Returning to the app…'
    : 'Could not connect. Returning to the app…';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${ok ? 'Connected' : 'Connection failed'}</title></head><body><script>(function(){var p=${payloadJson};var legacy=${legacyOkJson};var fb=${fallbackJson};try{if(window.opener){window.opener.postMessage(p,window.location.origin);if(legacy.type==='oauth_success'){window.opener.postMessage(legacy,window.location.origin);}}}catch(e){}var closed=false;try{window.close();closed=true;}catch(e){}setTimeout(function(){if(!window.closed){try{window.location.replace(fb);}catch(e2){window.location.href=fb;}}},280);})();</script><p style="font-family:system-ui,sans-serif;padding:1.5rem;text-align:center;color:#444">${statusLine}</p><p style="font-family:system-ui,sans-serif;padding:0 1.5rem;text-align:center"><a href="${fallbackHref.replace(/"/g, '&quot;')}">Continue</a></p></body></html>`;
}
