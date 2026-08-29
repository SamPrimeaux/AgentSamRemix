/** Browser workbench — shared types, constants, and pure helpers (Pass 1 lift). */

export const IAM_LOGO =
  'https://imagedelivery.net/g7wf09fCONpnidkRnR_5vw/11f6af46-0a3c-482a-abe8-83edc5a8a200/avatar';

export const DEFAULT_URL =
  typeof window !== 'undefined'
    ? window.location.origin
    : 'https://inneranimalmedia.com';

/** Resolved from GET /api/agent/browser/registry-tools (agentsam_tools). */
export type BrowserRegistryPickers = {
  navigate: string | null;
  content: string | null;
  console: string | null;
  network: string | null;
  snapshot: string | null;
  screenshot: string | null;
  evaluate: string | null;
  hover: string | null;
};

export const EMPTY_BROWSER_PICKERS: BrowserRegistryPickers = {
  navigate: null,
  content: null,
  console: null,
  network: null,
  snapshot: null,
  screenshot: null,
  evaluate: null,
  hover: null,
};

export function safeClassText(el: { className?: unknown } | null | undefined): string {
  if (!el || el.className == null) return '';
  const c = el.className;
  if (typeof c === 'string') return c;
  if (typeof c === 'object' && c !== null && 'baseVal' in c) {
    const base = (c as { baseVal?: string }).baseVal;
    if (typeof base === 'string') return base;
  }
  return String(c);
}

export function normalize(raw: string): string {
  let s = raw.trim();
  if (!s) return DEFAULT_URL;
  if (/^\/https?:\/\//i.test(s)) s = s.replace(/^\/+/, '');
  const nestedAbs = s.match(/^https?:\/\/[^/]+\/(https?:\/\/.+)$/i);
  if (nestedAbs?.[1]) s = nestedAbs[1];
  if (/^(blob:|data:|about:)/i.test(s)) return s;
  if (!/^https?:\/\//i.test(s)) {
    if (s.includes('.') || s.startsWith('localhost')) return `https://${s}`;
    return `https://${s}`;
  }
  return s;
}

/** URL bar submit: google search for non-URLs, https for bare domains. */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  if (trimmed.includes('.') && !trimmed.includes(' ')) return `https://${trimmed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

export function isVirtual(url: string): boolean {
  return /^(r2:|github:|local:|preview:)/i.test(url);
}

export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

export const SCREENSHOT_TIMEOUT_MSG = 'Screenshot timed out, retry';

export type PlaywrightJobSnapshot = {
  id?: string;
  status?: string;
  result_url?: string;
  screenshot_url?: string;
  data_url?: string;
  error?: string;
};

export function pickScreenshotUrl(
  data: Record<string, unknown> | PlaywrightJobSnapshot | null | undefined,
): string | null {
  if (!data) return null;
  if (typeof data.screenshot_url === 'string' && data.screenshot_url) return data.screenshot_url;
  if (typeof data.result_url === 'string' && data.result_url) return data.result_url;
  if (typeof data.data_url === 'string' && data.data_url) return data.data_url;
  return null;
}

export function pickInvokeScreenshotUrl(data: Record<string, unknown>): string | null {
  const direct = pickScreenshotUrl(data);
  if (direct) return direct;
  if (typeof data.screenshotUrl === 'string' && data.screenshotUrl) return data.screenshotUrl;
  const result = data.result;
  if (result && typeof result === 'object') return pickScreenshotUrl(result as Record<string, unknown>);
  return null;
}

export function sleepMs(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort);
  });
}

export type PaneMode = 'browse' | 'picker' | 'screenshot' | 'area' | 'annotate';
/** `live` = Browser Run CDP embed; `passive` = direct iframe (blob/local/editor only). */
export type ViewSurface = 'live' | 'passive';

/** URLs that must never use Browser Run (editor localhost, blob, virtual schemes). */
export function isPassiveOnlyBrowseUrl(
  raw: string,
  previewSource?: string | null,
): boolean {
  const n = normalize(raw);
  if (isVirtual(n)) return true;
  if (/^(blob:|data:|about:)/i.test(n)) return true;
  if (previewSource === 'editor') return true;
  if (/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/i.test(n)) return true;
  return false;
}
export type TrustScope = 'session' | 'persistent';

export interface TrustRequest {
  url: string;
  resolve: (scope: TrustScope | null) => void;
}

export interface ConsoleMsg {
  type: 'log' | 'error' | 'warn' | 'info';
  text: string;
  time: string;
}

export interface NetworkReq {
  url: string;
  method: string;
  type: string;
  status?: number;
}

export interface InspectedElement {
  tag: string;
  id: string | null;
  className: string | null;
  html: string;
  path: string;
  styles: Record<string, string>;
  boundingBox?: { top: number; left: number; width: number; height: number };
}

export interface AreaSelection {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  active: boolean;
}

export type TrustCheckResult = {
  trusted: boolean;
  trust_scope: string | null;
  skip_approval: boolean;
};

export type BrowserRunSessionResponse = {
  ok?: boolean;
  error?: string;
  session_id?: string;
  devtools_frontend_url?: string;
  url?: string;
  title?: string | null;
};

export type BrowserInvokeResult = Record<string, unknown> & {
  error?: string;
  ok?: boolean;
  url?: string;
  screenshot_url?: string;
  title?: string;
};
