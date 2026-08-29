/** @license SPDX-License-Identifier: Apache-2.0 */
import {
  useState, useEffect, useCallback, useRef,
  type Dispatch, type MutableRefObject, type RefObject, type SetStateAction, type MouseEvent,
} from 'react';
import {
  PICKER_CLEANUP_SCRIPT,
  PICKER_SCRIPT,
  NAVIGATION_SYNC_SCRIPT,
  pickAtPointExpression,
  type PickerHighlightRect,
} from './elementPickerScripts.ts';
import { invokeBrowserTool } from './browserApi.ts';
import {
  normalize,
  type BrowserRegistryPickers,
  type PaneMode,
  type InspectedElement,
} from './types.ts';

export type UseElementPickerOptions = {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  currentUrlRef: MutableRefObject<string>;
  iframeUrl: string;
  zoom: number;
  mode: PaneMode;
  currentUrl: string;
  setMode: Dispatch<SetStateAction<PaneMode>>;
  setCurrentUrl: Dispatch<SetStateAction<string>>;
  setInputVal: Dispatch<SetStateAction<string>>;
  onUrlCommitted?: (url: string) => void;
  addressDisplay?: string | null;
  loadRegistryPickersIfNeeded: () => Promise<BrowserRegistryPickers>;
  registryPickersRef: MutableRefObject<BrowserRegistryPickers>;
  setToastMsg: Dispatch<SetStateAction<string | null>>;
  applyElementSelection: (el: InspectedElement, opts?: { metaKey?: boolean; altKey?: boolean }) => void;
};

export function useElementPicker(opts: UseElementPickerOptions) {
  const {
    iframeRef,
    currentUrlRef,
    iframeUrl,
    zoom,
    mode,
    currentUrl,
    setCurrentUrl,
    setInputVal,
    onUrlCommitted,
    addressDisplay,
    loadRegistryPickersIfNeeded,
    registryPickersRef,
    setToastMsg,
    applyElementSelection,
  } = opts;

  const [pickerCrossOrigin, setPickerCrossOrigin] = useState(false);
  const [pickerHighlight, setPickerHighlight] = useState<PickerHighlightRect | null>(null);

  const pickerHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pickerPickSeqRef = useRef(0);

  const commitNavigationFromIframe = useCallback(
    (href: string, title?: string | null) => {
      const raw = href?.trim();
      if (!raw || /^about:/i.test(raw)) return;
      const n = normalize(raw);
      if (!n || n === currentUrlRef.current) return;
      currentUrlRef.current = n;
      setCurrentUrl(n);
      setInputVal(addressDisplay?.trim() && /^(blob:|data:)/i.test(n) ? addressDisplay : n);
      onUrlCommitted?.(n);
      let routePath = '';
      try {
        routePath = new URL(n).pathname;
      } catch {
        routePath = '';
      }
      window.dispatchEvent(
        new CustomEvent('iam-browser-surface-context', {
          detail: {
            url: n,
            title: title?.trim() || null,
            route_path: routePath,
            viewport: { width: window.innerWidth, height: window.innerHeight },
            source: 'iframe_navigation',
          },
        }),
      );
    },
    [addressDisplay, currentUrlRef, onUrlCommitted, setCurrentUrl, setInputVal],
  );

  const tryInjectScriptInIframe = useCallback((scriptBody: string): boolean => {
    try {
      const doc = iframeRef.current?.contentDocument;
      if (!doc?.documentElement) return false;
      const script = doc.createElement('script');
      script.textContent = scriptBody;
      doc.documentElement.appendChild(script);
      script.remove();
      return true;
    } catch {
      return false;
    }
  }, [iframeRef]);

  const tryInjectPickerInIframe = useCallback((): boolean => {
    return tryInjectScriptInIframe(PICKER_SCRIPT);
  }, [tryInjectScriptInIframe]);

  const injectNavigationBridge = useCallback(() => {
    const src = iframeRef.current?.src || iframeUrl || '';
    if (src.includes('live.browser.run')) return;
    tryInjectScriptInIframe(NAVIGATION_SYNC_SCRIPT);
    try {
      const href = iframeRef.current?.contentWindow?.location?.href;
      if (href) commitNavigationFromIframe(href, iframeRef.current?.contentDocument?.title ?? null);
    } catch {
      /* cross-origin */
    }
  }, [iframeRef, iframeUrl, tryInjectScriptInIframe, commitNavigationFromIframe]);

  const syncUrlFromIframe = useCallback(() => {
    try {
      const href = iframeRef.current?.contentWindow?.location?.href;
      if (!href) return;
      commitNavigationFromIframe(href, iframeRef.current?.contentDocument?.title ?? null);
    } catch {
      /* cross-origin — parent cannot read iframe location */
    }
  }, [iframeRef, commitNavigationFromIframe]);

  const tryTeardownPickerInIframe = useCallback(() => {
    try {
      const doc = iframeRef.current?.contentDocument;
      if (!doc?.documentElement) return;
      const script = doc.createElement('script');
      script.textContent = PICKER_CLEANUP_SCRIPT;
      doc.documentElement.appendChild(script);
      script.remove();
    } catch {
      /* cross-origin */
    }
  }, [iframeRef]);

  const syncPickerViewport = useCallback(async (urlNow: string) => {
    const iframe = iframeRef.current;
    const w = Math.max(320, Math.round(iframe?.clientWidth || 1280));
    const h = Math.max(240, Math.round(iframe?.clientHeight || 800));
    try {
      await invokeBrowserTool('cdt_resize_page', {
        url: urlNow,
        width: w,
        height: h,
        workspace_id:
          typeof window !== 'undefined'
            ? (window as unknown as { __IAM_WORKSPACE_ID__?: string }).__IAM_WORKSPACE_ID__
            : undefined,
      });
    } catch {
      /* non-fatal */
    }
  }, [iframeRef]);

  const pickElementAtPoint = useCallback(
    async (clientX: number, clientY: number): Promise<InspectedElement | null> => {
      const urlNow = currentUrlRef.current?.trim();
      if (!urlNow) return null;
      const pickers = await loadRegistryPickersIfNeeded();
      const evalTool = pickers.evaluate || 'cdt_evaluate_script';
      const iframe = iframeRef.current;
      if (!iframe) return null;
      const rect = iframe.getBoundingClientRect();
      const z = zoom !== 100 ? zoom / 100 : 1;
      const x = (clientX - rect.left) / z;
      const y = (clientY - rect.top) / z;
      if (x < 0 || y < 0 || x > rect.width / z || y > rect.height / z) return null;

      const seq = ++pickerPickSeqRef.current;
      const data = await invokeBrowserTool(evalTool, {
        url: urlNow,
        expression: pickAtPointExpression(x, y),
        workspace_id:
          typeof window !== 'undefined'
            ? (window as unknown as { __IAM_WORKSPACE_ID__?: string }).__IAM_WORKSPACE_ID__
            : undefined,
      });
      if (seq !== pickerPickSeqRef.current) return null;
      if (data.error) {
        setToastMsg(`CDP pick failed: ${String(data.error).slice(0, 120)}`);
        window.setTimeout(() => setToastMsg(null), 4000);
        return null;
      }

      let raw: unknown = data.result ?? data;
      if (typeof raw === 'string') {
        try {
          raw = JSON.parse(raw) as unknown;
        } catch {
          setToastMsg('CDP pick returned unreadable data');
          window.setTimeout(() => setToastMsg(null), 3000);
          return null;
        }
      }
      const parsed =
        raw && typeof raw === 'object'
          ? (raw as { element?: InspectedElement })
          : null;
      const el = parsed?.element;
      if (!el || typeof el.tag !== 'string') {
        setToastMsg('No element at that point (CDP session may not match the iframe)');
        window.setTimeout(() => setToastMsg(null), 4000);
        return null;
      }
      return el;
    },
    [currentUrlRef, iframeRef, loadRegistryPickersIfNeeded, setToastMsg, zoom],
  );

  const injectPickerScript = useCallback(async () => {
    setPickerHighlight(null);
    const urlNow = currentUrlRef.current?.trim();
    if (!urlNow) return;

    if (tryInjectPickerInIframe()) {
      setPickerCrossOrigin(false);
      return;
    }

    const pickers = await loadRegistryPickersIfNeeded();
    const evalTool = pickers.evaluate;
    if (!evalTool) {
      setToastMsg('Picker needs cdt_evaluate_script in agentsam_tools for this workspace.');
      return;
    }

    setPickerCrossOrigin(true);
    await syncPickerViewport(urlNow);
  }, [currentUrlRef, loadRegistryPickersIfNeeded, syncPickerViewport, tryInjectPickerInIframe, setToastMsg]);

  const teardownPickerScript = useCallback(() => {
    if (pickerHoverTimerRef.current) {
      clearTimeout(pickerHoverTimerRef.current);
      pickerHoverTimerRef.current = null;
    }
    pickerPickSeqRef.current += 1;
    setPickerCrossOrigin(false);
    setPickerHighlight(null);
    tryTeardownPickerInIframe();
    const urlNow = currentUrlRef.current?.trim();
    const evalTool = registryPickersRef.current.evaluate;
    if (!evalTool || !urlNow) return;
    void invokeBrowserTool(evalTool, {
      url: urlNow,
      expression: `(${PICKER_CLEANUP_SCRIPT})()`,
    }).catch(() => { /* non-fatal */ });
  }, [currentUrlRef, registryPickersRef, tryTeardownPickerInIframe]);

  const onPickerOverlayMove = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!pickerCrossOrigin) return;
      if (pickerHoverTimerRef.current) clearTimeout(pickerHoverTimerRef.current);
      pickerHoverTimerRef.current = setTimeout(() => {
        pickerHoverTimerRef.current = null;
        void (async () => {
          const el = await pickElementAtPoint(e.clientX, e.clientY);
          if (!el?.boundingBox) {
            setPickerHighlight(null);
            return;
          }
          const bb = el.boundingBox;
          setPickerHighlight({
            top: bb.top,
            left: bb.left,
            width: bb.width,
            height: bb.height,
          });
        })();
      }, 48);
    },
    [pickerCrossOrigin, pickElementAtPoint],
  );

  const onPickerOverlayClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!pickerCrossOrigin) return;
      e.preventDefault();
      e.stopPropagation();
      void (async () => {
        const el = await pickElementAtPoint(e.clientX, e.clientY);
        if (!el) {
          setToastMsg('Could not inspect element — check origin trust and MYBROWSER.');
          return;
        }
        applyElementSelection(el);
      })();
    },
    [pickerCrossOrigin, pickElementAtPoint, applyElementSelection, setToastMsg],
  );

  useEffect(() => {
    const h = (e: MessageEvent) => {
      if (e.data?.type === 'iam-navigation' && typeof e.data?.url === 'string') {
        const title = typeof e.data?.title === 'string' ? e.data.title : null;
        commitNavigationFromIframe(e.data.url, title);
      }
      if (e.data?.type === 'iam-element-selected' && e.data.element && typeof e.data.element === 'object') {
        applyElementSelection(e.data.element as InspectedElement);
      }
    };
    window.addEventListener('message', h);
    return () => window.removeEventListener('message', h);
  }, [applyElementSelection, commitNavigationFromIframe]);

  useEffect(() => {
    if (mode === 'picker') {
      void injectPickerScript();
      return () => teardownPickerScript();
    }
    teardownPickerScript();
  }, [mode, currentUrl, injectPickerScript, teardownPickerScript]);

  useEffect(() => {
    if (mode === 'picker') void loadRegistryPickersIfNeeded();
  }, [mode, loadRegistryPickersIfNeeded]);

  return {
    pickerCrossOrigin,
    setPickerCrossOrigin,
    pickerHighlight,
    setPickerHighlight,
    commitNavigationFromIframe,
    injectNavigationBridge,
    syncUrlFromIframe,
    injectPickerScript,
    teardownPickerScript,
    onPickerOverlayMove,
    onPickerOverlayClick,
  };
}
