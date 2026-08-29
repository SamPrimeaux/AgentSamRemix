import { AUTH_LOGIN_PATH, AUTH_SIGNUP_PATH } from '../../auth/constants.js';

/**
 * Same-origin relative paths only. Rewrites deprecated `/login` and `/signup`.
 * Rejects scheme-relative `//`, absolute URLs, and paths containing `:`.
 */
export function sanitizeBrowserNextPath(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s.startsWith('/') || s.startsWith('//')) return null;
  if (/^[a-zA-Z][a-zA-Z+\-.]*:/.test(s) || s.includes('://')) return null;

  let pathname = s;
  let search = '';
  const q = s.indexOf('?');
  if (q !== -1) {
    pathname = s.slice(0, q);
    search = s.slice(q);
  }
  const lower = pathname.toLowerCase();
  if (lower === '/login' || lower === '/auth/signin') pathname = AUTH_LOGIN_PATH;
  else if (lower === '/signup' || lower === '/auth/register') pathname = AUTH_SIGNUP_PATH;

  return pathname + search;
}

/** Returns the apex domain for cookie setting (IAM adapter may override per host). */
export function getApexDomain(hostname) {
  if (!hostname) return '';
  const parts = hostname.split('.');
  if (parts.length >= 2) {
    if (hostname.endsWith('inneranimalmedia.com')) return 'inneranimalmedia.com';
    if (hostname.endsWith('.workers.dev') || hostname.endsWith('.pages.dev')) return '';
    return parts.slice(-2).join('.');
  }
  return hostname;
}
