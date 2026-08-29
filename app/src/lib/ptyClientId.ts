import { LS_PTY_CLIENT_ID } from './sessionStorageKeys';

const TOKEN_RE = /^[a-zA-Z0-9_-]{1,16}$/;

function randomPtyClientId(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return `c${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Per-browser PTY client id — phone and Mac must not share a terminal DO. */
export function getOrCreatePtyClientId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const existing = window.localStorage.getItem(LS_PTY_CLIENT_ID);
    if (existing && TOKEN_RE.test(existing)) return existing;
    const id = randomPtyClientId();
    window.localStorage.setItem(LS_PTY_CLIENT_ID, id);
    return id;
  } catch {
    try {
      const ss = window.sessionStorage.getItem(LS_PTY_CLIENT_ID);
      if (ss && TOKEN_RE.test(ss)) return ss;
      const id = randomPtyClientId();
      window.sessionStorage.setItem(LS_PTY_CLIENT_ID, id);
      return id;
    } catch {
      return randomPtyClientId();
    }
  }
}
