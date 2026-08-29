import type { LibraryItem } from './types';

const SITE_NAME = 'Inner Animal Media';

let platformScriptPromise: Promise<void> | null = null;
let apiScriptPromise: Promise<void> | null = null;
let shareModulePromise: Promise<void> | null = null;

function loadScript(src: string, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.getElementById(id)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

export function loadGooglePlatformScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.gapi?.savetodrive) return Promise.resolve();
  if (!platformScriptPromise) {
    window.___gcfg = { ...(window.___gcfg || {}), lang: 'en-US', parsetags: 'explicit' };
    platformScriptPromise = loadScript('https://apis.google.com/js/platform.js', 'google-platform-js');
  }
  return platformScriptPromise;
}

export function loadGoogleApiScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (!apiScriptPromise) {
    apiScriptPromise = loadScript('https://apis.google.com/js/api.js', 'google-api-js');
  }
  return apiScriptPromise;
}

export async function loadGoogleDriveShareModule(): Promise<void> {
  await loadGoogleApiScript();
  if (shareModulePromise) return shareModulePromise;
  shareModulePromise = new Promise((resolve, reject) => {
    if (!window.gapi?.load) {
      reject(new Error('Google API not available'));
      return;
    }
    window.gapi.load('drive-share', {
      callback: () => resolve(),
      onerror: () => reject(new Error('Failed to load drive-share module')),
    });
  });
  return shareModulePromise;
}

export function absolutizeLibraryUrl(url: string): string {
  const raw = url.trim();
  if (!raw) return '';
  if (raw.startsWith('https://') || raw.startsWith('http://')) return raw;
  if (raw.startsWith('//')) return `${window.location.protocol}${raw}`;
  if (raw.startsWith('/')) return `${window.location.origin}${raw}`;
  return `${window.location.origin}/${raw.replace(/^\//, '')}`;
}

/** Same-origin download URL suitable for Google's Save to Drive widget. */
export function resolveLibrarySaveToDriveSrc(item: LibraryItem): string | null {
  if (item.kind !== 'file' || item.source === 'local') return null;

  if (item.source === 'drive') {
    return absolutizeLibraryUrl(
      `/api/integrations/gdrive/raw?fileId=${encodeURIComponent(item.nativeId)}`,
    );
  }

  if (item.source === 'r2') {
    const bucket = item.metadata?.bucket;
    const key = item.metadata?.key;
    if (bucket && key) {
      return absolutizeLibraryUrl(
        `/api/r2/buckets/${encodeURIComponent(String(bucket))}/object/${encodeURIComponent(String(key))}`,
      );
    }
  }

  if (item.rawUrl) {
    const abs = absolutizeLibraryUrl(item.rawUrl);
    if (abs.startsWith(window.location.origin)) return abs;
    if (item.rawUrl.startsWith('https://')) return item.rawUrl;
  }

  return null;
}

export function saveToDriveSiteName() {
  return SITE_NAME;
}

export async function fetchDriveAccessToken(): Promise<{ access_token?: string; error?: string }> {
  const res = await fetch('/api/integrations/gdrive/access-token', { credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { error: typeof data.error === 'string' ? data.error : 'Drive not connected' };
  }
  return { access_token: typeof data.access_token === 'string' ? data.access_token : undefined };
}

export async function openDriveShareDialog(fileId: string): Promise<void> {
  await loadGoogleDriveShareModule();
  const token = await fetchDriveAccessToken();
  if (!token.access_token) {
    throw new Error(token.error || 'Connect Google Drive to share files');
  }
  const ShareClient = window.gapi?.drive?.share?.ShareClient;
  if (!ShareClient) throw new Error('Google Drive share module unavailable');
  const client = new ShareClient();
  client.setOAuthToken(token.access_token);
  client.setItemIds([fileId]);
  client.showSettingsDialog();
}

declare global {
  interface Window {
    ___gcfg?: { lang?: string; parsetags?: string };
    gapi?: {
      load?: (
        name: string,
        options: { callback?: () => void; onerror?: () => void },
      ) => void;
      savetodrive?: {
        render: (
          container: string | HTMLElement,
          params: { src: string; filename: string; sitename: string },
        ) => void;
      };
      drive?: {
        share?: {
          ShareClient: new () => {
            setOAuthToken: (token: string) => void;
            setItemIds: (ids: string[]) => void;
            showSettingsDialog: () => void;
          };
        };
      };
    };
  }
}
