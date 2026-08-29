/* Agent chunk precache — imported by Workbox-generated /sw.js */
const SERVICES_MANIFEST_URL = 'https://services.inneranimalmedia.com/sw/manifest.json';
const JS_CACHE_NAME = 'iam-dashboard-js-v2';
const LEGACY_JS_CACHE_NAMES = ['iam-dashboard-js-v1', 'iam-dashboard-js-v2', 'iam-dashboard-js-v3'];

/**
 * Optional control-plane manifest (services.inneranimalmedia.com).
 * @returns {Promise<{ tier1?: string[] } | null>}
 */
async function fetchServicesManifest() {
  try {
    const res = await fetch(SERVICES_MANIFEST_URL, { cache: 'no-store', mode: 'cors' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * @param {string[]} urls
 */
async function precacheUrls(urls) {
  if (!urls?.length) return;

  const cache = await caches.open(JS_CACHE_NAME);
  await Promise.all(
    urls.map(async (url) => {
      if (!url || typeof url !== 'string') return;
      try {
        const existing = await cache.match(url);
        if (existing) return;
        const res = await fetch(url, { mode: 'cors', credentials: 'same-origin' });
        if (res.ok) await cache.put(url, res);
      } catch {
        /* silent — chunk warm is best-effort */
      }
    }),
  );
}

async function warmTier1FromManifest() {
  const manifest = await fetchServicesManifest();
  if (!manifest?.tier1?.length) return;
  await precacheUrls(manifest.tier1);
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      if (typeof caches !== 'undefined') {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter(
              (name) =>
                LEGACY_JS_CACHE_NAMES.includes(name) ||
                /^workbox-precache-/.test(name) ||
                name.startsWith('workbox-precache-v'),
            )
            .map((name) => caches.delete(name)),
        );
      }
      await warmTier1FromManifest();
    })(),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'IAM_WARM_CHUNKS') {
    const urls = Array.isArray(data.urls) ? data.urls : [];
    event.waitUntil(precacheUrls(urls));
    return;
  }

  if (data.type === 'IAM_TIER1_WARM') {
    event.waitUntil(warmTier1FromManifest());
    return;
  }

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
