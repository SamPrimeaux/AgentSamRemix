/** iOS Safari in browser tab (not standalone PWA, not Chrome/Firefox iOS). */

export { PWA_INSTALL_COACH_DISMISS_KEY } from '../lib/sessionStorageKeys';
import { PWA_INSTALL_COACH_DISMISS_KEY } from '../lib/sessionStorageKeys';

export function isIosSafariBrowserTab(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;

  const ua = navigator.userAgent || '';
  const isIos =
    /iPhone|iPad|iPod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!isIos) return false;

  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return false;

  // WebKit in-app browsers on iOS (Chrome, Firefox, Edge, Opera).
  if (/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/i.test(ua)) return false;

  return true;
}

export function isInstallCoachDismissed(): boolean {
  try {
    return localStorage.getItem(PWA_INSTALL_COACH_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissInstallCoach(): void {
  try {
    localStorage.setItem(PWA_INSTALL_COACH_DISMISS_KEY, '1');
  } catch {
    /* ignore quota */
  }
}
