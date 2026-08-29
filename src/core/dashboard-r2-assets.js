/**
 * Resolve dashboard SPA assets from the DASHBOARD R2 bucket (production: inneranimalmedia).
 * Canonical deploy prefix: `static/dashboard/app/*`. Legacy `/static/dashboard/agent/*` URLs
 * resolve to the same keys under `app/` until bookmarks expire.
 */

export const DASHBOARD_STATIC_AGENT_PREFIX = 'static/dashboard/agent/';
export const DASHBOARD_STATIC_APP_PREFIX = 'static/dashboard/app/';

/**
 * Stable deploy paths (no content hash in URL) must not use immutable long TTL.
 * Workers Cache honors s-maxage; browsers honor max-age. New Worker versions
 * start with an empty cache, so a deploy still busts edge copies.
 * @param {string} assetKey
 */
export function dashboardR2CacheControl(assetKey) {
  const key = String(assetKey || '').toLowerCase();
  if (
    key.startsWith(DASHBOARD_STATIC_APP_PREFIX) &&
    (key.endsWith('.js') || key.endsWith('.css'))
  ) {
    return 'public, max-age=0, s-maxage=300, must-revalidate';
  }
  if (key === 'static/dashboard/shell.css') {
    return 'public, max-age=0, s-maxage=300, must-revalidate';
  }
  return 'public, max-age=31536000, immutable';
}

/**
 * @param {{ get: (key: string) => Promise<{ body: ReadableStream | null, httpMetadata?: { contentType?: string } } | null> }} bucket
 * @param {string} assetKey Path after hostname (no leading slash), e.g. static/dashboard/app/learn.js
 */
export async function getDashboardR2Object(bucket, assetKey) {
  if (!bucket || typeof assetKey !== 'string' || !assetKey.length) return null;

  /** @type {string[]} */
  const keys = [];
  const add = (k) => {
    if (k && !keys.includes(k)) keys.push(k);
  };

  if (assetKey.startsWith(DASHBOARD_STATIC_AGENT_PREFIX)) {
    const rest = assetKey.slice(DASHBOARD_STATIC_AGENT_PREFIX.length);
    add(`${DASHBOARD_STATIC_APP_PREFIX}${rest}`);
  } else {
    add(assetKey);
  }

  // Vite public copy lands under app/ after rclone; HTML may still request the short shell path.
  if (assetKey === 'static/dashboard/shell.css') {
    add(`${DASHBOARD_STATIC_APP_PREFIX}static/dashboard/shell.css`);
  }
  if (assetKey === 'prototypes/examples-gallery.html') {
    add(`${DASHBOARD_STATIC_APP_PREFIX}prototypes/examples-gallery.html`);
  }

  for (const key of keys) {
    const obj = await bucket.get(key);
    if (obj) return obj;
  }
  return null;
}

/**
 * HTML shell for authenticated dashboard / onboarding SPA routes.
 * @param {{ get: (key: string) => Promise<{ body: ReadableStream | null } | null> }} bucket
 */
export async function getDashboardSpaHtmlShell(bucket) {
  if (!bucket) return null;

  const shellKeys = [
    'static/dashboard/app.html',
    'static/dashboard/app/index.html',
    // Legacy bookmarks → same shell under canonical prefix
    'static/dashboard/agent/index.html',
    'static/dashboard/agent.html',
    'index.html',
  ];

  for (const key of shellKeys) {
    const obj = await bucket.get(key);
    if (obj) return obj;
  }
  return null;
}
