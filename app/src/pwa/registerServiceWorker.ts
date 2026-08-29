/**
 * Register dashboard PWA service worker after session is confirmed (not on /auth/*).
 */

import { ensureFreshDashboardBundle, wasPwaUpdateDismissed } from './ensureFreshDashboardBundle';
import { notifyPwaUpdateAvailable } from './pwaUpdateEvents';
import { activateWaitingServiceWorker, purgeDashboardJsCaches } from './purgePwaCaches';
import { CACHE_BUST_STORAGE_KEY, TIER2_TABS_SESSION_KEY } from '../lib/sessionStorageKeys';

const SW_URL = '/sw.js';
const SERVICES_MANIFEST_URL = 'https://services.inneranimalmedia.com/sw/manifest.json';
const MANIFEST_POLL_INTERVAL_MS = 6 * 60 * 60 * 1000;

const AUTH_PREFIXES = ['/auth/login', '/auth/signup', '/auth/reset', '/auth/forgot'];

type ServicesSwManifest = {
  cache_bust?: string;
  tier2_tabs?: Record<string, string[]>;
};

let manifestPollTimer: ReturnType<typeof setInterval> | null = null;

function onAuthSurface(): boolean {
  const p = window.location.pathname.toLowerCase();
  return AUTH_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

function storeTier2Tabs(manifest: ServicesSwManifest): void {
  if (!manifest.tier2_tabs || typeof manifest.tier2_tabs !== 'object') return;
  try {
    sessionStorage.setItem(TIER2_TABS_SESSION_KEY, JSON.stringify(manifest.tier2_tabs));
  } catch {
    /* optional control-plane cache */
  }
}

function checkCacheBustAndNotify(manifest: ServicesSwManifest): void {
  const next = String(manifest.cache_bust || '').trim();
  if (!next) return;

  try {
    const prev = localStorage.getItem(CACHE_BUST_STORAGE_KEY);
    if (prev && prev !== next) {
      void purgeDashboardJsCaches().then(() => activateWaitingServiceWorker());
      if (!wasPwaUpdateDismissed()) {
        notifyPwaUpdateAvailable({ reason: 'cache_bust' });
      }
    }
    localStorage.setItem(CACHE_BUST_STORAGE_KEY, next);
  } catch {
    /* optional control-plane cache */
  }
}

async function pollServicesManifest(): Promise<void> {
  try {
    const res = await fetch(SERVICES_MANIFEST_URL, { cache: 'no-store', mode: 'cors' });
    if (!res.ok) return;
    const manifest = (await res.json()) as ServicesSwManifest;
    storeTier2Tabs(manifest);
    checkCacheBustAndNotify(manifest);
  } catch {
    /* optional control-plane poll */
  }
}

function startManifestPoll(): void {
  if (manifestPollTimer != null) return;
  manifestPollTimer = setInterval(() => {
    void pollServicesManifest();
  }, MANIFEST_POLL_INTERVAL_MS);
}

function triggerTier1Warm(): void {
  try {
    const controller = navigator.serviceWorker.controller;
    if (controller) {
      controller.postMessage({ type: 'IAM_TIER1_WARM' });
      return;
    }
    void navigator.serviceWorker.ready.then((registration) => {
      registration.active?.postMessage({ type: 'IAM_TIER1_WARM' });
    });
  } catch {
    /* best-effort tier-1 warm */
  }
}

async function purgeBootCachesOnDeployChange(): Promise<void> {
  await purgeDashboardJsCaches();
  await activateWaitingServiceWorker();
}

const SW_UPDATE_INTERVAL_MS = 30 * 60 * 1000;

function attachSwUpdatePoll(registration: ServiceWorkerRegistration): void {
  const tick = () => {
    void registration.update().catch(() => undefined);
  };
  window.setInterval(tick, SW_UPDATE_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick();
  });
}

export async function registerIamServiceWorker(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  if (onAuthSurface()) return;

  try {
    await purgeBootCachesOnDeployChange();
    const registration = await navigator.serviceWorker.register(SW_URL, { scope: '/' });
    void registration.update();

    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          if (wasPwaUpdateDismissed()) return;
          notifyPwaUpdateAvailable({ reason: 'service_worker' });
        }
      });
    });

    attachSwUpdatePoll(registration);

    void ensureFreshDashboardBundle();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void ensureFreshDashboardBundle();
    });

    void pollServicesManifest();
    triggerTier1Warm();
    startManifestPoll();
  } catch (err) {
    console.warn('[pwa] service worker registration failed', err);
  }
}

export async function subscribeIamWebPush(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  if (!('Notification' in window)) return false;

  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }
  if (permission !== 'granted') return false;

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    await syncPushSubscription(existing);
    return true;
  }

  let vapidPublicKey = '';
  try {
    const res = await fetch('/api/push/vapid-public-key', { credentials: 'same-origin' });
    if (res.ok) {
      const data = (await res.json()) as { publicKey?: string };
      vapidPublicKey = String(data.publicKey || '').trim();
    }
  } catch {
    return false;
  }

  if (!vapidPublicKey) return false;

  const sub = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });

  await syncPushSubscription(sub);
  return true;
}

export async function getIamWebPushEnabled(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    return Boolean(await registration.pushManager.getSubscription());
  } catch {
    return false;
  }
}

export async function unsubscribeIamWebPush(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return true;
    const endpoint = subscription.endpoint;
    const response = await fetch('/api/push/unsubscribe', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    });
    if (!response.ok) return false;
    return await subscription.unsubscribe();
  } catch {
    return false;
  }
}

async function syncPushSubscription(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON();
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
      user_agent: navigator.userAgent,
    }),
  });
  if (!res.ok) {
    throw new Error(`push subscribe HTTP ${res.status}`);
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}
