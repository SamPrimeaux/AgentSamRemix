/**
 * Detect stale dashboard JS (PWA / runtime cache).
 * Never hard-reloads on phone — surfaces banner via iam-pwa-update-available.
 * Bundled sha comes from Vite `__IAM_BUILD_GIT_SHA__`; remote from /pwa-build-meta.json.
 */

import { notifyPwaUpdateAvailable } from './pwaUpdateEvents';
import { activateWaitingServiceWorker, purgeDashboardJsCaches } from './purgePwaCaches';
import {
  DISMISSED_PWA_UPDATE_ANY_KEY,
  DISMISSED_REMOTE_SHA_KEY,
  SESSION_DASHBOARD_SHA_KEY,
} from '../lib/sessionStorageKeys';

declare const __IAM_BUILD_GIT_SHA__: string;

export { purgeDashboardJsCaches } from './purgePwaCaches';

function normalizeSha(raw: string): string {
  return String(raw || '').trim().slice(0, 12);
}

function shasMatch(a: string, b: string): boolean {
  const x = normalizeSha(a);
  const y = normalizeSha(b);
  if (!x || !y) return true;
  return x === y || x.startsWith(y.slice(0, 7)) || y.startsWith(x.slice(0, 7));
}

function storageGet(key: string): string | null {
  try {
    const fromLocal = localStorage.getItem(key);
    if (fromLocal) return fromLocal;
  } catch {
    /* optional */
  }
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* optional */
  }
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* optional */
  }
}

function storageRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* optional */
  }
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* optional */
  }
}

export function dismissPwaUpdateForRemoteSha(remoteSha?: string | null): void {
  if (typeof window === 'undefined') return;
  storageSet(DISMISSED_PWA_UPDATE_ANY_KEY, '1');
  const sha = normalizeSha(remoteSha || '');
  if (sha) storageSet(DISMISSED_REMOTE_SHA_KEY, sha);
}

export function wasPwaUpdateDismissed(remoteSha?: string | null): boolean {
  try {
    if (storageGet(DISMISSED_PWA_UPDATE_ANY_KEY) !== '1') return false;
    const dismissedSha = normalizeSha(storageGet(DISMISSED_REMOTE_SHA_KEY) || '');
    const next = normalizeSha(remoteSha || '');
    // Same or unknown sha → stay dismissed; newer sha → show again
    if (!dismissedSha || !next || dismissedSha === next) return true;
    return false;
  } catch {
    return false;
  }
}

/** Compare bundled vs deployed sha; notify when stale (banner-only — user chooses reload). */
export async function ensureFreshDashboardBundle(): Promise<void> {
  if (typeof window === 'undefined') return;

  const bundledSha =
    typeof __IAM_BUILD_GIT_SHA__ !== 'undefined' ? normalizeSha(__IAM_BUILD_GIT_SHA__) : '';

  try {
    const res = await fetch('/pwa-build-meta.json', { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) return;
    const meta = (await res.json()) as { git_sha?: string; cache_bust?: string };
    const remoteSha = normalizeSha(meta.git_sha || '');

    if (!remoteSha) return;

    if (shasMatch(bundledSha, remoteSha)) {
      sessionStorage.setItem(SESSION_DASHBOARD_SHA_KEY, remoteSha);
      storageRemove(DISMISSED_REMOTE_SHA_KEY);
      storageRemove(DISMISSED_PWA_UPDATE_ANY_KEY);
      return;
    }

    sessionStorage.setItem(SESSION_DASHBOARD_SHA_KEY, remoteSha);
    await purgeDashboardJsCaches();
    await activateWaitingServiceWorker();
    if (wasPwaUpdateDismissed(remoteSha)) return;
    notifyPwaUpdateAvailable({ reason: 'bundle_stale', remoteSha });
  } catch {
    /* non-fatal */
  }
}
