import { isPhoneViewport } from '../../lib/breakpoints';

export const SESSION_EXPIRED_EVENT = 'iam-session-expired';

export type SessionExpiredDetail = {
  reason?: string;
  status?: number;
};

let sessionExpired = false;

export function isSessionExpiredFlag(): boolean {
  return sessionExpired;
}

export function emitSessionExpired(detail?: SessionExpiredDetail): void {
  if (typeof window === 'undefined') return;
  sessionExpired = true;
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: detail ?? {} }));
}

export function clearSessionExpiredFlag(): void {
  sessionExpired = false;
}

export function subscribeSessionExpired(onExpired: (detail: SessionExpiredDetail) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handler = (e: Event) => {
    onExpired(((e as CustomEvent<SessionExpiredDetail>).detail ?? {}) as SessionExpiredDetail);
  };
  window.addEventListener(SESSION_EXPIRED_EVENT, handler);
  return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handler);
}

const AUTH_PROBE_PREFIXES = [
  '/api/auth/me',
  '/api/dashboard/bootstrap',
  '/api/settings/workspaces',
];

function pathFromRequest(input: RequestInfo | URL): string {
  try {
    if (typeof input === 'string') return new URL(input, window.location.origin).pathname;
    if (input instanceof URL) return input.pathname;
    return new URL(input.url, window.location.origin).pathname;
  } catch {
    return '';
  }
}

/** Returns true when the response should surface the session-expired gate (mobile dashboard). */
export function shouldGateSessionResponse(status: number, urlPath: string): boolean {
  if (status !== 401) return false;
  if (typeof window === 'undefined') return false;
  if (!window.location.pathname.startsWith('/dashboard')) return false;
  if (!isPhoneViewport()) return false;
  return AUTH_PROBE_PREFIXES.some((p) => urlPath === p || urlPath.startsWith(`${p}/`));
}

export function handleAuthHttpStatus(status: number, urlPath?: string): boolean {
  const path = urlPath ?? (typeof window !== 'undefined' ? window.location.pathname : '');
  if (!shouldGateSessionResponse(status, path)) return false;
  emitSessionExpired({ reason: 'auth_probe', status });
  return true;
}

let fetchGuardInstalled = false;

/** Mobile dashboard: turn /api 401 on auth probes into session-expired gate (no silent blank shell). */
export function installAuthSessionFetchGuard(): void {
  if (typeof window === 'undefined' || fetchGuardInstalled) return;
  fetchGuardInstalled = true;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await nativeFetch(input, init);
    const path = pathFromRequest(input);
    if (shouldGateSessionResponse(res.status, path)) {
      emitSessionExpired({ reason: 'fetch_401', status: 401 });
    }
    return res;
  };
}

export function buildLoginRecoveryUrl(nextPath?: string): string {
  const next =
    nextPath ??
    (typeof window !== 'undefined'
      ? `${window.location.pathname}${window.location.search}${window.location.hash}`
      : '/dashboard/agent');
  return `/auth/login?next=${encodeURIComponent(next)}`;
}
