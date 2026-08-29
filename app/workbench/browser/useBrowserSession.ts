/** @license SPDX-License-Identifier: Apache-2.0 */
import { useState, useEffect, useCallback, useRef, useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { useAgentLiveBrowserWs } from './useAgentLiveBrowserWs.ts';
import { applyBrowserRunLiveViewMode } from './browserLiveViewUrl.ts';
import { requiresBrowserRunEmbed, resolveEmbedModeRemote } from './embedPolicy.ts';
import {
  normalize,
  isVirtual,
  originOf,
  type BrowserRegistryPickers,
  type PaneMode,
  type ViewSurface,
  type TrustScope,
  type InspectedElement,
  isPassiveOnlyBrowseUrl,
} from './types.ts';
import {
  checkTrust,
  writeTrust,
  createBrowserRunLiveSession,
  refreshBrowserRunLiveUrl,
  fetchAgentLiveSessionSnapshot,
  closeBrowserSessionLease,
  deleteBrowserRunLiveSession,
  invokeBrowserTool,
  pickNavigatePreview,
} from './browserApi.ts';
import { resolveBrowserRunEmbedUrls } from './BrowserSurface.tsx';
import type { BrowserPreviewPayload } from './BrowserPane.tsx';

export type UseBrowserSessionOptions = {
  previewSource: 'editor' | 'agent';
  browserSessionId?: string | null;
  agentRunId?: string | null;
  agentActive?: boolean;
  addressDisplay?: string | null;
  onUrlCommitted?: (url: string) => void;
  initialUrl?: string;
  initialPreview?: BrowserPreviewPayload | null;
  initialAutomation?: boolean;
  initialAgentLive?: boolean;
  currentUrl: string;
  currentUrlRef: MutableRefObject<string>;
  setCurrentUrl: Dispatch<SetStateAction<string>>;
  setInputVal: Dispatch<SetStateAction<string>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setNavigateError: Dispatch<SetStateAction<string | null>>;
  setMode: Dispatch<SetStateAction<PaneMode>>;
  setInspectedEl: Dispatch<SetStateAction<InspectedElement | null>>;
  setIframeBlocked: Dispatch<SetStateAction<boolean>>;
  setScreenshotUrl: Dispatch<SetStateAction<string | null>>;
  setScreenshotErr: Dispatch<SetStateAction<string | null>>;
  sessionTrusted: Set<string>;
  setSessionTrusted: Dispatch<SetStateAction<Set<string>>>;
  requestTrust: (url: string) => Promise<TrustScope | null>;
  registryPickersRef: MutableRefObject<BrowserRegistryPickers>;
  loadRegistryPickersIfNeeded: () => Promise<BrowserRegistryPickers>;
};

export function useBrowserSession(opts: UseBrowserSessionOptions) {
  const {
    previewSource,
    browserSessionId = null,
    agentRunId = null,
    agentActive = false,
    addressDisplay,
    onUrlCommitted,
    initialUrl,
    initialPreview,
    initialAutomation = false,
    initialAgentLive = false,
    currentUrl,
    currentUrlRef,
    setCurrentUrl,
    setInputVal,
    setLoading,
    setNavigateError,
    setMode,
    setInspectedEl,
    setIframeBlocked,
    setScreenshotUrl,
    setScreenshotErr,
    sessionTrusted,
    setSessionTrusted,
    requestTrust,
    registryPickersRef,
    loadRegistryPickersIfNeeded,
  } = opts;

  const trustWorkspaceId = useMemo(() => {
    const wid =
      typeof window !== 'undefined'
        ? String((window as unknown as { __IAM_WORKSPACE_ID__?: string }).__IAM_WORKSPACE_ID__ || '').trim()
        : '';
    return wid && wid !== 'global' ? wid : null;
  }, []);

  const [iframeUrl, setIframeUrl] = useState('');
  const [viewSurface, setViewSurface] = useState<ViewSurface>(() => {
    if (previewSource === 'editor') return 'passive';
    if (initialAgentLive || Boolean(browserSessionId?.trim())) return 'live';
    return 'live';
  });
  const [humanInputReq, setHumanInputReq] = useState<{
    reason: string;
    liveViewUrl?: string | null;
    resumeWhen?: string;
  } | null>(null);
  const [liveSessionTitle, setLiveSessionTitle] = useState<string | null>(null);
  const [liveUrlPending, setLiveUrlPending] = useState<string | null>(null);
  const [liveUrlCommitted, setLiveUrlCommitted] = useState<string | null>(null);
  const [liveSessionReady, setLiveSessionReady] = useState(false);
  const [browserRunEmbedBase, setBrowserRunEmbedBase] = useState<string | null>(null);

  const browserRunSessionRef = useRef<string | null>(null);
  const openBrowserRunLiveViewRef = useRef<((raw: string) => Promise<void>) | null>(null);
  const liveUrlRefreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const commitBrowserRunEmbedBase = useCallback((url: string | null | undefined) => {
    const trimmed = String(url || '').trim();
    if (!trimmed) return;
    const tab = applyBrowserRunLiveViewMode(trimmed, 'tab');
    setBrowserRunEmbedBase(tab);
    setIframeUrl(tab);
  }, []);

  const browserRunEmbedUrls = useMemo(
    () => resolveBrowserRunEmbedUrls(browserRunEmbedBase),
    [browserRunEmbedBase],
  );

  const pageEmbedSrc = viewSurface === 'live'
    ? (browserRunEmbedUrls?.tab || iframeUrl)
    : iframeUrl;

  const hasLiveView = Boolean(pageEmbedSrc?.trim());
  const isBrowserRunEmbed = viewSurface === 'live' || pageEmbedSrc.includes('live.browser.run');

  const {
    connected: liveWsConnected,
    timelineEvents,
    liveSession: wsLiveSession,
  } = useAgentLiveBrowserWs({
    browserSessionId,
    enabled: viewSurface === 'live' && Boolean(browserSessionId?.trim()),
    onSnapshot: (snap) => {
      if (snap?.title) setLiveSessionTitle(String(snap.title));
      if (snap?.url) setCurrentUrl(String(snap.url));
      if (snap?.session_id) browserRunSessionRef.current = String(snap.session_id);
    },
    onLiveViewUrl: (url) => {
      if (url?.trim()) {
        commitBrowserRunEmbedBase(url.trim());
        setLiveSessionReady(true);
      }
    },
    onHumanInputRequired: (detail) => {
      setHumanInputReq({
        reason: detail.reason?.trim() || 'Complete this step in the live browser.',
        liveViewUrl: detail.live_view_url ?? null,
      });
      if (detail.live_view_url?.trim()) commitBrowserRunEmbedBase(detail.live_view_url.trim());
    },
    onHumanInputCleared: () => setHumanInputReq(null),
  });

  const releaseBrowserRunSession = useCallback(async () => {
    const bsid = browserSessionId?.trim();
    const sid = browserRunSessionRef.current;
    if (!bsid && !sid) return;
    browserRunSessionRef.current = null;
    if (bsid) await closeBrowserSessionLease(bsid, trustWorkspaceId);
    else if (sid) await deleteBrowserRunLiveSession(sid, trustWorkspaceId);
  }, [trustWorkspaceId, browserSessionId]);

  useEffect(() => () => {
    void releaseBrowserRunSession();
  }, [releaseBrowserRunSession]);

  const openAgentLiveSession = useCallback(
    async (raw: string, liveViewUrl?: string | null, sessionId?: string | null) => {
      const s = raw.trim();
      if (!s || isVirtual(s)) return;
      const n = normalize(s);
      setViewSurface('live');
      setNavigateError(null);
      setScreenshotUrl(null);
      setScreenshotErr(null);
      setMode('browse');
      setInspectedEl(null);
      setIframeBlocked(false);
      setLoading(true);

      try {
        let embedUrl = liveViewUrl?.trim() || '';
        let sid = sessionId?.trim() || browserRunSessionRef.current;
        const bsid = browserSessionId?.trim();
        if (bsid && !embedUrl) {
          const snap = await fetchAgentLiveSessionSnapshot(bsid, trustWorkspaceId);
          const live = snap.live_session as Record<string, unknown> | undefined;
          embedUrl =
            (typeof live?.devtools_frontend_url === 'string' && live.devtools_frontend_url) ||
            snap.devtools_frontend_url ||
            '';
          sid =
            (typeof live?.session_id === 'string' && live.session_id) ||
            snap.session_id ||
            sid ||
            null;
          if (typeof live?.title === 'string') setLiveSessionTitle(live.title);
        }
        if (!embedUrl && bsid) {
          const data = await createBrowserRunLiveSession(
            n,
            trustWorkspaceId,
            bsid,
            browserSessionId,
      agentRunId,
            sid,
          );
          if (data.error || !data.devtools_frontend_url) {
            setNavigateError(data.error || 'Browser Run session did not return a live view URL');
            return;
          }
          embedUrl = data.devtools_frontend_url;
          sid = data.session_id || sid || null;
        }
        browserRunSessionRef.current = sid || browserRunSessionRef.current;
        commitBrowserRunEmbedBase(embedUrl);
        if (embedUrl) setLiveSessionReady(true);
        if (!agentActive) {
          setCurrentUrl(n);
          setInputVal(addressDisplay?.trim() && /^(blob:|data:)/i.test(n) ? addressDisplay : n);
          onUrlCommitted?.(n);
        } else {
          setLiveUrlPending(n);
        }
      } catch (e) {
        setNavigateError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [
      addressDisplay,
      browserSessionId,
      agentRunId,
      agentActive,
      commitBrowserRunEmbedBase,
      onUrlCommitted,
      setIframeBlocked,
      setInspectedEl,
      setInputVal,
      setLoading,
      setMode,
      setNavigateError,
      setScreenshotErr,
      setScreenshotUrl,
      setCurrentUrl,
      trustWorkspaceId,
    ],
  );

  useEffect(() => {
    if (viewSurface !== 'live') {
      if (liveUrlRefreshTimerRef.current) {
        clearInterval(liveUrlRefreshTimerRef.current);
        liveUrlRefreshTimerRef.current = null;
      }
      return;
    }
    const tick = () => {
      const bsid = browserSessionId?.trim();
      const sid = browserRunSessionRef.current;
      if (!bsid && !sid) return;
      void refreshBrowserRunLiveUrl(sid || '', bsid || null, trustWorkspaceId).then((data) => {
        if (data.devtools_frontend_url) commitBrowserRunEmbedBase(data.devtools_frontend_url);
      });
    };
    liveUrlRefreshTimerRef.current = setInterval(tick, 4 * 60 * 1000);
    return () => {
      if (liveUrlRefreshTimerRef.current) {
        clearInterval(liveUrlRefreshTimerRef.current);
        liveUrlRefreshTimerRef.current = null;
      }
    };
  }, [viewSurface, browserSessionId, trustWorkspaceId, commitBrowserRunEmbedBase]);

  useEffect(() => {
    const onAgentLive = (e: Event) => {
      const d = (e as CustomEvent<{
        url?: string;
        live_view_url?: string;
        session_id?: string;
        browser_session_id?: string;
        agent_run_id?: string;
      }>).detail;
      const lv = d?.live_view_url?.trim();
      const bsid = browserSessionId?.trim() || d?.browser_session_id?.trim();
      if (!lv && !bsid) return;
      void openAgentLiveSession(d?.url?.trim() || 'about:blank', lv || null, d?.session_id);
    };
    const onHumanInput = (e: Event) => {
      const d = (e as CustomEvent<{
        reason?: string;
        live_view_url?: string;
        resume_when?: string;
        url?: string;
      }>).detail;
      setHumanInputReq({
        reason: d?.reason?.trim() || 'Complete this step in the live browser.',
        liveViewUrl: d?.live_view_url ?? null,
        resumeWhen: d?.resume_when,
      });
      if (d?.url?.trim()) void openAgentLiveSession(d.url, d.live_view_url);
      else if (d?.live_view_url?.trim()) commitBrowserRunEmbedBase(d.live_view_url.trim());
    };
    const onHumanResumed = () => setHumanInputReq(null);
    window.addEventListener('iam-browser-agent-live', onAgentLive as EventListener);
    window.addEventListener('iam-browser-human-input-required', onHumanInput as EventListener);
    window.addEventListener('iam-browser-human-input-resumed', onHumanResumed);
    return () => {
      window.removeEventListener('iam-browser-agent-live', onAgentLive as EventListener);
      window.removeEventListener('iam-browser-human-input-required', onHumanInput as EventListener);
      window.removeEventListener('iam-browser-human-input-resumed', onHumanResumed);
    };
  }, [openAgentLiveSession, commitBrowserRunEmbedBase]);

  useEffect(() => {
    const onPending = (e: Event) => {
      const d = (e as CustomEvent<{ url?: string }>).detail;
      if (!d?.url?.trim()) return;
      setLiveUrlPending(normalize(d.url));
    };
    const onCommitted = (e: Event) => {
      const d = (e as CustomEvent<{
        url?: string;
        title?: string;
        verified?: boolean;
        live_view_url?: string;
        session_id?: string;
      }>).detail;
      if (!d?.url?.trim() || d.verified === false) return;
      const n = normalize(d.url);
      setLiveUrlPending(null);
      setLiveUrlCommitted(n);
      setLiveSessionReady(true);
      setCurrentUrl(n);
      setInputVal(n);
      if (d.title) setLiveSessionTitle(String(d.title));
      if (d.session_id) browserRunSessionRef.current = String(d.session_id);
      if (d.live_view_url?.trim()) commitBrowserRunEmbedBase(d.live_view_url.trim());
      onUrlCommitted?.(n);
    };
    window.addEventListener('iam-browser-url-pending', onPending as EventListener);
    window.addEventListener('iam-browser-url-committed', onCommitted as EventListener);
    return () => {
      window.removeEventListener('iam-browser-url-pending', onPending as EventListener);
      window.removeEventListener('iam-browser-url-committed', onCommitted as EventListener);
    };
  }, [onUrlCommitted, commitBrowserRunEmbedBase, setCurrentUrl, setInputVal]);

  useEffect(() => {
    const onTrustRequired = (e: Event) => {
      const d = (e as CustomEvent<{ origin?: string; url?: string }>).detail;
      const raw = d?.url || d?.origin;
      if (!raw || typeof raw !== 'string') return;
      const o = originOf(raw);
      void checkTrust(o, trustWorkspaceId).then((trust) => {
        if (trust.skip_approval || trust.trusted) {
          setSessionTrusted((prev) => new Set([...prev, o]));
          return;
        }
        void requestTrust(raw).then((scope) => {
          if (!scope) return;
          if (scope === 'persistent') void writeTrust(o, 'persistent', trustWorkspaceId);
          setSessionTrusted((prev) => new Set([...prev, o]));
        });
      });
    };
    window.addEventListener('iam-browser-trust-required', onTrustRequired);
    return () => window.removeEventListener('iam-browser-trust-required', onTrustRequired);
  }, [requestTrust, trustWorkspaceId, setSessionTrusted]);

  const openPassiveIframeView = useCallback(
    async (raw: string) => {
      const s = raw.trim();
      if (!s || isVirtual(s)) return;
      const n = normalize(s);
      if (await requiresBrowserRunEmbed(n)) {
        const openLive = openBrowserRunLiveViewRef.current;
        if (openLive) {
          await openLive(n);
          return;
        }
      }
      console.log('[browser] passive_iframe', JSON.stringify({ url: n.slice(0, 240) }));

      setNavigateError(null);
      setScreenshotUrl(null);
      setScreenshotErr(null);
      setMode('browse');
      setViewSurface('passive');
      setInspectedEl(null);
      setIframeBlocked(false);
      setLoading(true);
      setBrowserRunEmbedBase(null);

      await releaseBrowserRunSession();
      setIframeUrl(n);
      setCurrentUrl(n);
      setInputVal(addressDisplay?.trim() && /^(blob:|data:)/i.test(n) ? addressDisplay : n);
      onUrlCommitted?.(n);
      setLoading(false);
    },
    [
      addressDisplay,
      onUrlCommitted,
      releaseBrowserRunSession,
      setIframeBlocked,
      setInspectedEl,
      setInputVal,
      setLoading,
      setMode,
      setNavigateError,
      setScreenshotErr,
      setScreenshotUrl,
      setCurrentUrl,
    ],
  );

  const fallbackFromAutomation = useCallback(
    async (u: string) => {
      if (!isPassiveOnlyBrowseUrl(u, previewSource) && openBrowserRunLiveViewRef.current) {
        await openBrowserRunLiveViewRef.current(u);
        return;
      }
      await openPassiveIframeView(u);
    },
    [openPassiveIframeView, previewSource],
  );

  const loadAutomationPreview = useCallback(
    async (targetUrl: string, preview?: BrowserPreviewPayload | null) => {
      const n = normalize(targetUrl);
      setCurrentUrl(n);
      setInputVal(addressDisplay?.trim() && /^(blob:|data:)/i.test(n) ? addressDisplay : n);
      onUrlCommitted?.(n);
      setMode('browse');
      setNavigateError(null);
      setInspectedEl(null);
      setIframeBlocked(false);

      if (preview?.screenshot_url) {
        setScreenshotUrl(preview.screenshot_url);
        setLoading(false);
        return;
      }

      setLoading(true);
      setScreenshotUrl(null);
      const navTool = registryPickersRef.current.navigate || 'browser_navigate';
      try {
        const data = await invokeBrowserTool(navTool, {
          url: n,
          automation: true,
          ...(browserSessionId?.trim() ? { browser_session_id: browserSessionId.trim() } : {}),
          ...(agentRunId?.trim() ? { agent_run_id: agentRunId.trim() } : {}),
        });
        if (data.error) {
          setNavigateError(String(data.error));
          await fallbackFromAutomation(n);
          return;
        }
        const { screenshot_url } = pickNavigatePreview(data);
        const resolvedUrl =
          typeof data.url === 'string' && data.url.trim() ? data.url.trim() : n;
        setCurrentUrl(resolvedUrl);
        setInputVal(
          addressDisplay?.trim() && /^(blob:|data:)/i.test(resolvedUrl)
            ? addressDisplay
            : resolvedUrl,
        );
        onUrlCommitted?.(resolvedUrl);
        if (screenshot_url) {
          setScreenshotUrl(screenshot_url);
        } else {
          setNavigateError('Automation finished but no screenshot_url was returned');
          await fallbackFromAutomation(resolvedUrl);
        }
      } catch (e) {
        setNavigateError(String(e));
        await fallbackFromAutomation(n);
      } finally {
        setLoading(false);
      }
    },
    [
      addressDisplay,
      browserSessionId,
      agentRunId,
      fallbackFromAutomation,
      onUrlCommitted,
      registryPickersRef,
      setCurrentUrl,
      setIframeBlocked,
      setInspectedEl,
      setInputVal,
      setLoading,
      setMode,
      setNavigateError,
      setScreenshotUrl,
    ],
  );

  const openBrowserRunLiveView = useCallback(
    async (raw: string) => {
      const s = raw.trim();
      if (!s || isVirtual(s)) return;
      const n = normalize(s);
      console.log('[browser] live_view_requested', JSON.stringify({ url: n.slice(0, 240) }));

      setNavigateError(null);
      setScreenshotUrl(null);
      setScreenshotErr(null);
      setMode('browse');
      setViewSurface('live');
      setInspectedEl(null);
      setIframeBlocked(false);
      setLoading(true);

      try {
        const data = await createBrowserRunLiveSession(
          n,
          trustWorkspaceId,
          browserRunSessionRef.current,
          browserSessionId,
      agentRunId,
        );
        if (data.error || !data.devtools_frontend_url) {
          setNavigateError(data.error || 'Browser Run session did not return a live view URL');
          return;
        }
        browserRunSessionRef.current = data.session_id || browserRunSessionRef.current;
        const destUrl = data.url?.trim() || n;
        commitBrowserRunEmbedBase(data.devtools_frontend_url);
        setLiveSessionReady(true);
        setLiveUrlCommitted(destUrl);
        setCurrentUrl(destUrl);
        setInputVal(addressDisplay?.trim() && /^(blob:|data:)/i.test(destUrl) ? addressDisplay : destUrl);
        onUrlCommitted?.(destUrl);
      } catch (e) {
        setNavigateError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [
      addressDisplay,
      browserSessionId,
      agentRunId,
      commitBrowserRunEmbedBase,
      onUrlCommitted,
      setCurrentUrl,
      setIframeBlocked,
      setInspectedEl,
      setInputVal,
      setLoading,
      setMode,
      setNavigateError,
      setScreenshotErr,
      setScreenshotUrl,
      trustWorkspaceId,
    ],
  );
  openBrowserRunLiveViewRef.current = openBrowserRunLiveView;

  const ensureOriginTrust = useCallback(
    async (url: string): Promise<boolean> => {
      const n = normalize(url);
      const origin = originOf(n);
      if (sessionTrusted.has(origin)) return true;
      const trust = await checkTrust(origin, trustWorkspaceId);
      if (trust.skip_approval || trust.trusted) {
        setSessionTrusted((prev) => new Set([...prev, origin]));
        return true;
      }
      const scope = await requestTrust(n);
      if (!scope) return false;
      if (scope === 'persistent') await writeTrust(origin, 'persistent', trustWorkspaceId);
      setSessionTrusted((prev) => new Set([...prev, origin]));
      return true;
    },
    [sessionTrusted, requestTrust, trustWorkspaceId, setSessionTrusted],
  );

  const navigate = useCallback(
    async (
      raw: string,
      navOpts?: { preview?: BrowserPreviewPayload | null; automation?: boolean; agentLive?: boolean },
    ) => {
      const s = raw.trim();
      if (!s || isVirtual(s)) return;
      const n = normalize(s);
      if (!(await ensureOriginTrust(n))) return;
      const embedMode = await resolveEmbedModeRemote(n);
      if (embedMode === 'blocked') {
        setNavigateError(`Embed policy blocks navigation to ${originOf(n)}`);
        return;
      }

      const passiveOnly = isPassiveOnlyBrowseUrl(n, previewSource);

      if (!passiveOnly && (navOpts?.automation === true || Boolean(navOpts?.preview?.screenshot_url))) {
        await loadRegistryPickersIfNeeded();
        await loadAutomationPreview(n, navOpts?.preview ?? null);
        return;
      }

      if (passiveOnly && navOpts?.agentLive !== true) {
        setViewSurface('passive');
        await openPassiveIframeView(raw);
        return;
      }

      await loadRegistryPickersIfNeeded();
      if (browserSessionId?.trim() && navOpts?.agentLive !== false) {
        await openAgentLiveSession(n);
        return;
      }
      await openBrowserRunLiveView(n);
    },
    [
      browserSessionId,
      agentRunId,
      ensureOriginTrust,
      loadAutomationPreview,
      loadRegistryPickersIfNeeded,
      openAgentLiveSession,
      openBrowserRunLiveView,
      openPassiveIframeView,
      previewSource,
      setNavigateError,
    ],
  );

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const lastInitialNavigateRef = useRef('');

  useEffect(() => {
    if (!initialUrl?.trim()) return;
    const n = normalize(initialUrl);
    if (n === currentUrlRef.current) {
      lastInitialNavigateRef.current = n;
      return;
    }
    if (n === lastInitialNavigateRef.current) return;
    void (async () => {
      const passiveOnly = isPassiveOnlyBrowseUrl(n, previewSource);
      void navigateRef.current(n, {
        preview: initialPreview?.screenshot_url ? initialPreview : null,
        automation: passiveOnly
          ? false
          : initialAutomation === true || Boolean(initialPreview?.screenshot_url),
        agentLive: passiveOnly
          ? false
          : initialAgentLive === true || Boolean(browserSessionId?.trim()),
      });
      lastInitialNavigateRef.current = n;
    })();
  }, [initialUrl, initialPreview, initialAutomation, initialAgentLive, previewSource, browserSessionId, currentUrlRef]);

  const reloadBrowserNavigation = useCallback(() => {
    void (async () => {
      if (browserRunSessionRef.current) {
        void openBrowserRunLiveView(currentUrl);
        return;
      }
      const embedMode = await resolveEmbedModeRemote(currentUrl);
      if (embedMode === 'browser_run') {
        void openBrowserRunLiveView(currentUrl);
      } else if (iframeUrl?.trim()) {
        setLoading(true);
        const u = currentUrl;
        setIframeUrl('');
        window.requestAnimationFrame(() => setIframeUrl(u));
      } else {
        void openPassiveIframeView(currentUrl);
      }
    })();
  }, [currentUrl, iframeUrl, openBrowserRunLiveView, openPassiveIframeView, setLoading]);

  return {
    viewSurface,
    iframeUrl,
    browserRunEmbedBase,
    pageEmbedSrc,
    browserRunEmbedUrls,
    humanInputReq,
    setHumanInputReq,
    liveSessionTitle,
    liveUrlPending,
    liveUrlCommitted,
    liveSessionReady,
    browserRunSessionRef,
    openBrowserRunLiveViewRef,
    hasLiveView,
    isBrowserRunEmbed,
    liveWsConnected,
    timelineEvents,
    wsLiveSession,
    trustWorkspaceId,
    navigate,
    openBrowserRunLiveView,
    openPassiveIframeView,
    loadAutomationPreview,
    reloadBrowserNavigation,
  };
}
