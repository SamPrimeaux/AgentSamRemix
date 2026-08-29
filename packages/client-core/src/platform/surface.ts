import type { ClientSurface } from '../../../platform-contracts/src/index';

export function detectClientSurface(): ClientSurface {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'desktop_web';
  const narrow = window.matchMedia('(max-width: 767px)').matches;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

  // Legacy surface values remain canonical on web so existing Agent Sam routing is not broken.
  if (narrow) return ios ? 'mobile_ios' : 'mobile_web';
  if (standalone) return 'desktop_pwa';
  return 'desktop_web';
}

export function isMobileClientSurface(surface: string | null | undefined): boolean {
  const value = String(surface || '').trim().toLowerCase();
  return value.startsWith('mobile') || value === 'web_mobile' || value === 'pwa_ios' ||
    value === 'native_ios' || value === 'native_android';
}
