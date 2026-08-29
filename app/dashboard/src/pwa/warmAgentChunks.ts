/**
 * Warm lazy tab chunks via SW postMessage (IAM_WARM_CHUNKS).
 * URLs come from services manifest tier2_tabs (sessionStorage), with static fallbacks.
 */

import { TIER2_TABS_SESSION_KEY } from '../lib/sessionStorageKeys';

const STATIC_APP_PREFIX = '/static/dashboard/app/';

/** Used only when iam_sw_tier2_tabs is missing (pre-manifest or services down). */
const FALLBACK_TIER2_TABS: Record<string, string[]> = {
  code: [`${STATIC_APP_PREFIX}MonacoEditorView.js`, `${STATIC_APP_PREFIX}vendor-editor.js`],
  excalidraw: [`${STATIC_APP_PREFIX}ExcalidrawView.js`, `${STATIC_APP_PREFIX}vendor-excalidraw.js`],
  moviemode: [`${STATIC_APP_PREFIX}MovieModeStudio.js`, `${STATIC_APP_PREFIX}vendor-remotion.js`],
  glb: [`${STATIC_APP_PREFIX}DesignStudioPage.js`, `${STATIC_APP_PREFIX}vendor-three.js`],
};

function readTier2TabsMap(): Record<string, string[]> {
  try {
    const raw = sessionStorage.getItem(TIER2_TABS_SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, string[]>;
      }
    }
  } catch {
    /* fall through to hardcoded paths */
  }
  return FALLBACK_TIER2_TABS;
}

function postWarmChunks(urls: string[]): void {
  if (!urls.length || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  const payload = { type: 'IAM_WARM_CHUNKS', urls };
  try {
    const controller = navigator.serviceWorker.controller;
    if (controller) {
      controller.postMessage(payload);
      return;
    }
    void navigator.serviceWorker.ready.then((registration) => {
      registration.active?.postMessage(payload);
    });
  } catch {
    /* best-effort chunk warm */
  }
}

/** Request SW precache for chunks associated with a workspace tab. */
export function warmAgentChunksForTab(tab: string): void {
  const key = String(tab || '').trim();
  if (!key) return;

  const map = readTier2TabsMap();
  const urls = map[key];
  if (!urls?.length) return;

  postWarmChunks(urls.filter((url): url is string => typeof url === 'string' && url.length > 0));
}
