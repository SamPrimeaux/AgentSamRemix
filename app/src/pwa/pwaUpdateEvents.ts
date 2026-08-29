import { activateWaitingServiceWorker, purgeDashboardJsCaches } from './purgePwaCaches';

export const PWA_UPDATE_EVENT = 'iam-pwa-update-available';

export type PwaUpdateDetail = {
  reason?: 'deploy' | 'service_worker' | 'bundle_stale' | 'cache_bust';
  remoteSha?: string;
};

export function notifyPwaUpdateAvailable(detail?: PwaUpdateDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PWA_UPDATE_EVENT, { detail: detail ?? {} }));
}

/** User-confirmed reload — purge JS caches, activate waiting SW, hard refresh. */
export async function applyPwaUpdateAndReload(): Promise<void> {
  if (typeof window === 'undefined') return;

  await purgeDashboardJsCaches();
  await activateWaitingServiceWorker();

  try {
    await new Promise<void>((resolve) => {
      const timeout = window.setTimeout(resolve, 2500);
      navigator.serviceWorker?.addEventListener(
        'controllerchange',
        () => {
          window.clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
    });
  } catch {
    /* reload anyway */
  }

  window.location.reload();
}
