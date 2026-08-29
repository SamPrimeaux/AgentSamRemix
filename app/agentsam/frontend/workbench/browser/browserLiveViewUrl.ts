/**
 * Cloudflare Browser Run Live View — tab (page watch) vs devtools (inspector).
 * @see https://developers.cloudflare.com/browser-run/features/live-view/
 */
// guard-dup-allow: SPA workbench copy of backend/browser/cloudflare/browser-run.js (browser-frontend cannot import backend/)
export type BrowserRunLiveViewMode = 'tab' | 'devtools';

export function applyBrowserRunLiveViewMode(
  url: string | null | undefined,
  mode: BrowserRunLiveViewMode = 'tab',
): string {
  const raw = String(url || '').trim();
  if (!raw || !raw.includes('live.browser.run')) return raw;
  const want = mode === 'devtools' ? 'devtools' : 'tab';
  try {
    const u = new URL(raw);
    if (u.pathname.includes('/inspector')) {
      u.pathname = u.pathname.replace(/\/inspector\b/, '/view');
    }
    u.searchParams.set('mode', want);
    return u.toString();
  } catch {
    if (/[?&]mode=/i.test(raw)) {
      return raw.replace(/([?&]mode=)[^&]*/i, `$1${want}`);
    }
    const sep = raw.includes('?') ? '&' : '?';
    return `${raw}${sep}mode=${want}`;
  }
}

export function resolveLiveViewMode(raw: unknown): BrowserRunLiveViewMode {
  return String(raw || 'tab').toLowerCase() === 'devtools' ? 'devtools' : 'tab';
}
