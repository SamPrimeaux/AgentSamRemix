/** Purge dashboard JS / Workbox caches that cause chunk↔entry export drift. */
export async function purgeDashboardJsCaches(): Promise<void> {
  if (typeof caches === 'undefined') return;
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter(
        (name) =>
          /^iam-dashboard-js-v/.test(name) ||
          /^workbox-precache-/.test(name) ||
          name.startsWith('workbox-precache-v'),
      )
      .map((name) => caches.delete(name)),
  );
}

/** Activate a waiting service worker when a deploy requires fresh assets. */
export async function activateWaitingServiceWorker(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration('/');
    registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
    await registration?.update();
  } catch {
    /* non-fatal */
  }
}
