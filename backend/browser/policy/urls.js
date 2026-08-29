/**
 * Safe HTTP(S) URL extraction for browser_navigate / surface_open.
 * Stops at JSON delimiters so proof blobs cannot extend into `","source":...`.
 */

const BROWSER_URL_RE = /https?:\/\/[^\s"'<>\])},]+/i;

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function extractBrowserNavigateUrl(raw) {
  if (raw == null) return '';
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw;
    for (const k of ['url', 'target_url', 'href', 'page_url', 'navigate_url', 'load_url']) {
      const v = o[k];
      if (typeof v === 'string' && v.trim()) {
        const u = extractBrowserNavigateUrl(v);
        if (u) return u;
      }
    }
    if (o.surface_open_proof && typeof o.surface_open_proof === 'object') {
      const u = extractBrowserNavigateUrl(o.surface_open_proof);
      if (u) return u;
    }
    if (o.input && typeof o.input === 'object') {
      const u = extractBrowserNavigateUrl(o.input);
      if (u) return u;
    }
    for (const k of ['message', 'prompt', 'instruction', 'result']) {
      const v = o[k];
      if (typeof v === 'string' && v.trim()) {
        const u = extractBrowserNavigateUrl(v);
        if (u) return u;
      }
    }
    return '';
  }

  const s = String(raw).trim();
  if (!s) return '';

  if (s.startsWith('{') || s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s);
      const fromJson = extractBrowserNavigateUrl(parsed);
      if (fromJson) return fromJson;
    } catch {
      /* fall through to regex on partial JSON */
    }
  }

  const m = s.match(BROWSER_URL_RE);
  if (!m) return '';
  return m[0].replace(/[.,;)\]]+$/, '').slice(0, 2000);
}

/**
 * @param {Record<string, unknown>} config
 * @param {Record<string, unknown>} paramRoot
 */
export function resolveCatalogToolParams(config, paramRoot) {
  const merged = { ...paramRoot };
  const map = config?.input_map;
  if (!map || typeof map !== 'object') return merged;
  for (const [key, pathOrValue] of Object.entries(map)) {
    if (typeof pathOrValue === 'string' && pathOrValue.startsWith('$.')) {
      const parts = pathOrValue.slice(2).split('.');
      let cur = paramRoot;
      for (const part of parts) {
        cur = cur?.[part];
      }
      if (cur != null && cur !== '') merged[key] = cur;
    } else if (pathOrValue != null) {
      merged[key] = pathOrValue;
    }
  }
  const toolKey = String(config.tool_key || config.tool_code || '').trim();
  if (
    (toolKey === 'browser_navigate' || toolKey === 'cdt_navigate_page') &&
    (!merged.url || String(merged.url).startsWith('$.'))
  ) {
    const u = extractBrowserNavigateUrl(paramRoot);
    if (u) merged.url = u;
  }
  return merged;
}
