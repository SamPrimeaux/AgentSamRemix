/** @license SPDX-License-Identifier: Apache-2.0 */
/** Agent Sam IDE browser pane — product code (peeled from app/dashboard/components/BrowserView.tsx). */
import React, {
  useState, useEffect, useCallback, useRef,
} from 'react';
import {
  Loader2, AlertTriangle, MousePointer2, Globe, CheckCircle,
} from 'lucide-react';
import { BrowserLiveTimeline } from './BrowserLiveTimeline.tsx';
import { useBrowserSession } from './useBrowserSession.ts';
import { useElementPicker } from './useElementPicker.ts';
import { useDesignMode } from './useDesignMode.ts';
import {
  SCREENSHOT_TIMEOUT_MSG,
  normalize,
  normalizeUrl,
  sleepMs,
  type BrowserRegistryPickers,
  EMPTY_BROWSER_PICKERS,
  type PaneMode,
  type TrustScope,
  type TrustRequest,
  isPassiveOnlyBrowseUrl,
  type InspectedElement,
  type AreaSelection,
} from './types.ts';
import {
  fetchBrowserRegistryPickers,
  fetchBrowserJobOnce,
  cancelBrowserHumanInput,
  resumeBrowserHumanInput,
  pickInvokeScreenshotUrl,
  pickScreenshotUrl,
} from './browserApi.ts';
import { PermissionGate } from './TrustGate.tsx';
import { BrowserToolbar } from './BrowserToolbar.tsx';
import {
  BlockedPage,
  BrowserSurfaceDevToolsDock,
} from './BrowserSurface.tsx';
import { DesignModeAnnotateOverlay, DesignModeSelectionChips } from './DesignModeOverlay.tsx';

// ─── Single Pane ──────────────────────────────────────────────────────────────

export type BrowserPreviewPayload = {
  screenshot_url: string;
  title?: string | null;
};

interface PaneProps {
  initialUrl?:         string;
  initialPreview?:     BrowserPreviewPayload | null;
  /** Agent SSE / tool_done — MYBROWSER automation; omit for passive iframe opens. */
  initialAutomation?:  boolean;
  /** Open Browser Run Live View (shared agent session) instead of screenshot overlay. */
  initialAgentLive?:   boolean;
  /** Passive editor preview — never MYBROWSER. */
  previewSource?:      'editor' | 'agent';
  addressDisplay?: string | null;
  label?:          'A' | 'B';
  onClose?:        () => void;
  onSplit?:        (url: string) => void;
  onUrlCommitted?: (url: string) => void;
  isSplit?:        boolean;
  autoFocus?:      boolean;
  agentActive?:    boolean;
  /** Browser lease id (bsess_*) — BROWSER_SESSION DO key */
  browserSessionId?: string | null;
  /** `agentsam_agent_run.id` — per-turn attribution only */
  agentRunId?:     string | null;
}
export const BrowserPane: React.FC<PaneProps> = ({
  initialUrl,
  initialPreview,
  initialAutomation = false,
  initialAgentLive = false,
  previewSource = 'agent',
  addressDisplay,
  label,
  onClose,
  onSplit,
  onUrlCommitted,
  isSplit,
  autoFocus,
  agentActive = false,
  browserSessionId = null,
  agentRunId = null,
}) => {
  const [currentUrl,     setCurrentUrl]     = useState(() => (initialUrl?.trim() ? normalize(initialUrl) : ''));
  const [inputVal,       setInputVal]       = useState(() => (initialUrl?.trim() ? normalize(initialUrl) : ''));
  const [loading,        setLoading]        = useState(false);
  const [iframeBlocked,  setIframeBlocked]  = useState(false);
  const [navigateError,  setNavigateError]  = useState<string | null>(null);
  const [mode,           setMode]           = useState<PaneMode>('browse');
  const [menuOpen,       setMenuOpen]       = useState(false);
  const [copied,         setCopied]         = useState(false);
  const [zoom,           setZoom]           = useState(100);
  const [screenshotUrl,  setScreenshotUrl]  = useState<string | null>(initialPreview?.screenshot_url ?? null);
  const [screenshotErr,  setScreenshotErr]  = useState<string | null>(null);
  const [screenshotLoad, setScreenshotLoad] = useState(false);
  const [inspectedEl,    setInspectedEl]    = useState<InspectedElement | null>(null);
  const [inspectEpoch,   setInspectEpoch]   = useState(0);
  const [trustRequest,   setTrustRequest]   = useState<TrustRequest | null>(null);
  const [sessionTrusted, setSessionTrusted] = useState<Set<string>>(new Set());
  const [area,           setArea]           = useState<AreaSelection | null>(null);
  const [devToolsOpen,   setDevToolsOpen]   = useState(false);
  const [devToolsWidth,  setDevToolsWidth]  = useState(40);
  const [toastMsg,       setToastMsg]       = useState<string | null>(null);
  const [registryPickers, setRegistryPickers] = useState<BrowserRegistryPickers>(EMPTY_BROWSER_PICKERS);
  const inputRef = useRef<HTMLInputElement>(null);
  const registryPickersRef = useRef(registryPickers);
  const registryPickersFetchedRef = useRef(false);
  useEffect(() => {
    registryPickersRef.current = registryPickers;
  }, [registryPickers]);
  const menuRef      = useRef<HTMLDivElement>(null);
  const iframeRef    = useRef<HTMLIFrameElement>(null);
  const areaOverRef  = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const currentUrlRef = useRef(currentUrl);
  useEffect(() => {
    currentUrlRef.current = currentUrl;
  }, [currentUrl]);

  const loadRegistryPickersIfNeeded = useCallback(async (): Promise<BrowserRegistryPickers> => {
    const wid =
      typeof window !== 'undefined'
        ? String((window as unknown as { __IAM_WORKSPACE_ID__?: string }).__IAM_WORKSPACE_ID__ || '').trim()
        : '';
    if (!wid || wid === 'global') return registryPickersRef.current;
    if (!registryPickersFetchedRef.current) {
      registryPickersFetchedRef.current = true;
      const pickers = await fetchBrowserRegistryPickers(wid);
      setRegistryPickers(pickers);
      registryPickersRef.current = pickers;
      return pickers;
    }
    return registryPickersRef.current;
  }, []);

  const requestTrust = useCallback((url: string): Promise<TrustScope | null> =>
    new Promise(resolve => setTrustRequest({ url, resolve })),
  []);

  const {
    viewSurface,
    iframeUrl,
    browserRunEmbedBase,
    browserRunEmbedUrls,
    pageEmbedSrc,
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
    loadAutomationPreview,
    reloadBrowserNavigation,
  } = useBrowserSession({
    previewSource,
    browserSessionId,
    agentRunId,
    agentActive,
    addressDisplay,
    onUrlCommitted,
    initialUrl,
    initialPreview,
    initialAutomation,
    initialAgentLive,
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
  });

  /** Latest BrowserView URL/viewport for ChatAssistant `browserContext` (user visual context, not server automation). */
  useEffect(() => {
    if (typeof window === 'undefined' || !currentUrl?.trim()) return;
    let routePath = '';
    try {
      routePath = new URL(currentUrl).pathname;
    } catch {
      routePath = '';
    }
    window.dispatchEvent(
      new CustomEvent('iam-browser-surface-context', {
        detail: {
          url: currentUrl,
          route_path: routePath,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          source: 'browser_pane',
          ...(browserSessionId?.trim() ? { browser_session_id: browserSessionId.trim() } : {}),
        },
      }),
    );
  }, [currentUrl, browserSessionId]);

  const runScreenshot = useCallback(async (clip?: { x: number; y: number; width: number; height: number }) => {
    await loadRegistryPickersIfNeeded();
    setMode('screenshot');
    setScreenshotLoad(true);
    setScreenshotUrl(null);
    setScreenshotErr(null);
    const ac = new AbortController();
    const to = window.setTimeout(() => ac.abort(), 30000);
    try {
      const shotTool = registryPickersRef.current.screenshot || 'cdt_take_screenshot';
      const body = {
        tool_name: shotTool,
        params: {
          url: currentUrl,
          fullPage: !clip,
          ...(clip ? { clip } : {}),
          ...(browserSessionId?.trim() ? { browser_session_id: browserSessionId.trim() } : {}),
          ...(agentRunId?.trim() ? { agent_run_id: agentRunId.trim() } : {}),
        },
      };
      const res = await fetch('/api/browser/invoke', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body:        JSON.stringify(body),
        signal:      ac.signal,
      });
      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      let url = pickInvokeScreenshotUrl(data);
      const statusStr = String(data.status || '');

      if (!url && res.ok && statusStr === 'pending') {
        const jobId = data.id != null ? String(data.id) : '';
        if (!jobId) {
          setScreenshotErr(SCREENSHOT_TIMEOUT_MSG);
          return;
        }
        await sleepMs(5000, ac.signal);
        const job = await fetchBrowserJobOnce(jobId, ac.signal);
        if (!job) {
          setScreenshotErr(SCREENSHOT_TIMEOUT_MSG);
          return;
        }
        if (job.status === 'error' || job.status === 'failed') {
          throw new Error(String(job.error || 'Screenshot job failed'));
        }
        url = pickScreenshotUrl(job) || undefined;
        if (!url && String(job?.status || '') === 'pending') {
          setScreenshotErr(SCREENSHOT_TIMEOUT_MSG);
          return;
        }
      }

      if (!res.ok || !url) {
        if (ac.signal.aborted) {
          setScreenshotErr(SCREENSHOT_TIMEOUT_MSG);
          return;
        }
        throw new Error(String(data.error || 'No screenshot URL returned'));
      }
      setScreenshotUrl(url);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        setScreenshotErr(SCREENSHOT_TIMEOUT_MSG);
      } else {
        setScreenshotErr(String(e));
      }
    } finally {
      window.clearTimeout(to);
      setScreenshotLoad(false);
    }
  }, [currentUrl, agentRunId, loadRegistryPickersIfNeeded]);

  const applyElementSelectionRef = useRef((
    _el: InspectedElement,
    _opts?: { metaKey?: boolean; altKey?: boolean },
  ) => {});

  const {
    pickerCrossOrigin,
    setPickerCrossOrigin,
    pickerHighlight,
    setPickerHighlight,
    injectNavigationBridge,
    injectPickerScript,
    teardownPickerScript,
    onPickerOverlayMove,
    onPickerOverlayClick,
  } = useElementPicker({
    iframeRef,
    currentUrlRef,
    iframeUrl,
    zoom,
    mode,
    currentUrl,
    setMode,
    setCurrentUrl,
    setInputVal,
    onUrlCommitted,
    addressDisplay,
    loadRegistryPickersIfNeeded,
    registryPickersRef,
    setToastMsg,
    applyElementSelection: (el, opts) => applyElementSelectionRef.current(el, opts),
  });

  const {
    designModeOn,
    designSelections,
    annotateStrokes,
    setAnnotateStrokes,
    annotateFrame,
    annotateDrawingRef,
    annotateCurrentRef,
    publishDesignModeSurface,
    applyElementSelection,
    toggleDesignMode,
    startAnnotateMode,
  } = useDesignMode({
    currentUrlRef,
    mode,
    setMode,
    setInspectedEl,
    setInspectEpoch,
    setDevToolsOpen,
    setToastMsg,
    teardownPickerScript,
    setPickerCrossOrigin,
    setPickerHighlight,
    screenshotUrl,
    runScreenshot,
  });

  applyElementSelectionRef.current = applyElementSelection;

  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = devToolsWidth;
    const containerWidth = containerRef.current?.offsetWidth ?? window.innerWidth;

    function onMove(ev: MouseEvent) {
      const delta = startX - ev.clientX;
      const newWidthPx = (startWidth / 100) * containerWidth + delta;
      const newWidthPct = Math.max(20, Math.min(70, (newWidthPx / containerWidth) * 100));
      setDevToolsWidth(newWidthPct);
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);

  const openDevTools = useCallback(() => {
    void (async () => {
      setMode('browse');
      setPickerCrossOrigin(false);
      setPickerHighlight(null);
      void teardownPickerScript();
      if (devToolsOpen) {
        setDevToolsOpen(false);
        return;
      }
      const u = currentUrlRef.current?.trim();
      if (u && (viewSurface !== 'live' || !browserRunEmbedBase)) {
        const openLive = openBrowserRunLiveViewRef.current;
        if (openLive && !isPassiveOnlyBrowseUrl(u, previewSource)) {
          await openLive(u);
        }
      }
      setDevToolsOpen(true);
    })();
  }, [browserRunEmbedBase, devToolsOpen, previewSource, teardownPickerScript, viewSurface]);

  // ── Close menu on outside click ─────────────────────────────────────────────
  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  useEffect(() => {
    const onExternal = (ev: Event) => {
      const raw = (ev as CustomEvent<unknown>).detail;
      if (!raw || typeof raw !== 'object') return;
      const el = raw as InspectedElement;
      if (typeof el.tag !== 'string') return;
      setInspectedEl(el);
      setInspectEpoch((n) => n + 1);
      setDevToolsOpen(true);
    };
    window.addEventListener('iam-browser-set-inspector', onExternal as EventListener);
    return () => window.removeEventListener('iam-browser-set-inspector', onExternal as EventListener);
  }, []);

  /** Agent chat `tool_done` → same screenshot overlay as the Take Screenshot button. */
  useEffect(() => {
    const onAgentScreenshot = (e: Event) => {
      const url = (e as CustomEvent<{ screenshot_url?: string }>).detail?.screenshot_url;
      if (!url?.trim()) return;
      setMode('screenshot');
      setScreenshotLoad(false);
      setScreenshotErr(null);
      setScreenshotUrl(url.trim());
    };
    window.addEventListener('iam-browser-screenshot', onAgentScreenshot as EventListener);
    return () => window.removeEventListener('iam-browser-screenshot', onAgentScreenshot as EventListener);
  }, []);

  const hardReload = useCallback(() => {
    setMenuOpen(false);
    reloadBrowserNavigation();
  }, [reloadBrowserNavigation]);

  // ── Clear helpers ───────────────────────────────────────────────────────────
  const clearBrowserData = useCallback((what: 'history' | 'cookies' | 'cache') => {
    setMenuOpen(false);
    if (what === 'history') {
      hardReload();
      return;
    }
    if (what === 'cookies') {
      const script =
        'document.cookie.split(";").forEach(c=>{document.cookie=c.replace(/^ +/,"").replace(/=.*/,"=;expires="+new Date(0).toUTCString()+";path=/");});';
      try {
        const doc = iframeRef.current?.contentDocument;
        if (doc) {
          const s = doc.createElement('script');
          s.textContent = script;
          doc.documentElement.appendChild(s);
        } else {
          iframeRef.current?.contentWindow?.postMessage({ type: 'iam-exec', script }, '*');
        }
      } catch { /* ignore */ }
      hardReload();
      return;
    }
    setToastMsg('Reloading to clear cached assets…');
    window.setTimeout(() => setToastMsg(null), 2800);
    try {
      iframeRef.current?.contentWindow?.postMessage({ type: 'iam-exec', script: 'location.reload(true);' }, '*');
    } catch { /* ignore */ }
    try {
      iframeRef.current?.contentWindow?.location.reload();
    } catch { /* ignore */ }
  }, [hardReload]);

  // ── Copy URL ────────────────────────────────────────────────────────────────
  const copyUrl = async () => {
    try { await navigator.clipboard.writeText(currentUrl); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { /* ignore */ }
    setMenuOpen(false);
  };

  // ── Area screenshot drag ────────────────────────────────────────────────────
  const startArea = (e: React.MouseEvent) => {
    if (mode !== 'area') return;
    const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    setArea({ startX: e.clientX - r.left, startY: e.clientY - r.top, endX: e.clientX - r.left, endY: e.clientY - r.top, active: true });
  };
  const moveArea = (e: React.MouseEvent) => {
    if (!area?.active) return;
    const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    setArea(a => a ? { ...a, endX: e.clientX - r.left, endY: e.clientY - r.top } : null);
  };
  const endArea = async () => {
    if (!area?.active) return;
    const x = Math.min(area.startX, area.endX);
    const y = Math.min(area.startY, area.endY);
    const w = Math.abs(area.endX - area.startX);
    const h = Math.abs(area.endY - area.startY);
    setArea(null);
    if (w > 10 && h > 10) await runScreenshot({ x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) });
    else setMode('browse');
  };

  const areaRect = area ? {
    left:   Math.min(area.startX, area.endX),
    top:    Math.min(area.startY, area.endY),
    width:  Math.abs(area.endX - area.startX),
    height: Math.abs(area.endY - area.startY),
  } : null;

  const toggleMode = (m: PaneMode) => {
    setMode(prev => (prev === m ? 'browse' : m));
    if (m === 'area') setArea(null);
  };

  return (
    <div
      className="flex flex-col w-full h-full min-w-0 overflow-hidden transition-all duration-300"
      style={agentActive ? {
        boxShadow: '0 0 0 2px var(--color-primary), 0 0 24px 6px rgba(58,159,232,0.2)',
      } : undefined}
    >

      <BrowserToolbar
        label={label}
        viewSurface={viewSurface}
        liveSessionReady={liveSessionReady}
        liveUrlPending={liveUrlPending}
        liveUrlCommitted={liveUrlCommitted}
        inputVal={inputVal}
        setInputVal={setInputVal}
        agentActive={agentActive}
        designModeOn={designModeOn}
        mode={mode}
        devToolsOpen={devToolsOpen}
        menuOpen={menuOpen}
        copied={copied}
        zoom={zoom}
        inputRef={inputRef}
        menuRef={menuRef}
        onNavigateEnter={() => {
          const n = normalizeUrl(inputVal);
          if (n) void navigate(n, { automation: false, agentLive: true });
        }}
        onHardReload={hardReload}
        onSplit={onSplit}
        isSplit={isSplit}
        currentUrl={currentUrl}
        onClose={onClose}
        toggleDesignMode={toggleDesignMode}
        onPickerToggle={() => {
          if (mode === 'picker') {
            setMode('browse');
            void teardownPickerScript();
            setPickerCrossOrigin(false);
            setPickerHighlight(null);
            return;
          }
          void loadRegistryPickersIfNeeded();
          toggleMode('picker');
        }}
        onAnnotate={() => void startAnnotateMode()}
        onDevTools={openDevTools}
        setMenuOpen={setMenuOpen}
        runScreenshot={() => void runScreenshot()}
        toggleMode={toggleMode}
        copyUrl={copyUrl}
        setZoom={setZoom}
        clearBrowserData={clearBrowserData}
      />

      {/* Loading bar */}
      {loading && (
        <div className="h-[2px] w-full bg-[var(--border-subtle)] shrink-0 relative overflow-hidden">
          <div className="absolute inset-y-0 left-0 bg-[var(--color-primary)] animate-[progress_1.5s_ease-in-out_infinite]" style={{ width: '40%' }} />
        </div>
      )}

      {/* Agent active banner */}
      {agentActive && viewSurface === 'live' && (
        <div className="flex items-center gap-1.5 px-3 py-1 bg-[var(--color-primary)]/10 border-b border-[var(--color-primary)]/20 shrink-0">
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary)] animate-pulse" />
          <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--color-primary)]">
            Agent Live Session — shared Browser Run
          </span>
          {liveWsConnected ? (
            <span className="ml-auto text-[9px] text-muted">live channel connected</span>
          ) : null}
          {(liveSessionTitle || wsLiveSession?.title) ? (
            <span className="ml-2 truncate text-[9px] text-muted max-w-[40%]">
              {liveSessionTitle || wsLiveSession?.title}
            </span>
          ) : null}
        </div>
      )}

      {viewSurface === 'live' && timelineEvents.length > 0 ? (
        <BrowserLiveTimeline events={timelineEvents} />
      ) : null}

      {/* Human-in-the-loop */}
      {humanInputReq && (
        <div className="flex flex-col gap-2 px-3 py-2 bg-amber-500/10 border-b border-amber-500/30 shrink-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold text-amber-200">Agent needs you</p>
              <p className="text-[10px] text-muted mt-0.5">{humanInputReq.reason}</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                className="px-2 py-1 text-[10px] rounded border border-[var(--border-subtle)] hover:bg-[var(--bg-panel)]"
                onClick={() => {
                  const bsid = browserSessionId?.trim();
                  if (bsid) void cancelBrowserHumanInput(bsid, trustWorkspaceId);
                  setHumanInputReq(null);
                  window.dispatchEvent(new CustomEvent('iam-browser-human-input-resumed'));
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-2 py-1 text-[10px] rounded bg-[var(--color-primary)] text-white"
                onClick={() => {
                  const bsid = browserSessionId?.trim();
                  if (bsid) void resumeBrowserHumanInput(bsid, trustWorkspaceId);
                  setHumanInputReq(null);
                  window.dispatchEvent(new CustomEvent('iam-browser-human-input-resumed'));
                }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {agentActive && viewSurface === 'passive' && !humanInputReq && (
        <div className="flex items-center gap-1.5 px-3 py-1 bg-[var(--color-primary)]/10 border-b border-[var(--color-primary)]/20 shrink-0">
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary)] animate-pulse" />
          <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--color-primary)]">
            Agent Sam is controlling this browser
          </span>
        </div>
      )}

      {/* Browser + DevTools */}
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="flex flex-1 flex overflow-hidden min-h-0" ref={containerRef}>
          <div
            className="flex flex-col overflow-hidden min-h-0 min-w-0"
            style={{ width: devToolsOpen ? `${100 - devToolsWidth}%` : '100%' }}
          >
            <div
              className={`flex flex-1 min-h-0 overflow-hidden relative flex-col ${mode === 'area' ? 'cursor-crosshair' : ''}`}
              ref={areaOverRef}
              onMouseDown={mode === 'area' ? startArea : undefined}
              onMouseMove={mode === 'area' ? moveArea : undefined}
              onMouseUp={mode === 'area' ? endArea : undefined}
            >
              <div className="flex flex-1 min-h-0 relative flex-col overflow-hidden">
                {hasLiveView && (
                <iframe
                  ref={iframeRef}
                  key={pageEmbedSrc}
                  src={pageEmbedSrc}
                  title="Browser Run live view"
                  allow="clipboard-read; clipboard-write; fullscreen"
                  {...(isBrowserRunEmbed
                    ? {}
                    : {
                        sandbox:
                          'allow-same-origin allow-scripts allow-popups allow-forms allow-downloads allow-modals',
                      })}
                  style={{ zoom: zoom !== 100 ? zoom / 100 : undefined }}
                  className={`w-full flex-1 min-h-0 border-0 bg-white transition-opacity duration-150 ${
                    (mode === 'browse' || mode === 'picker' || mode === 'area') && !iframeBlocked && !screenshotUrl
                      ? 'opacity-100'
                      : 'opacity-0 pointer-events-none'
                  }`}
                  onLoad={() => {
                    setLoading(false);
                    injectNavigationBridge();
                    if (mode === 'picker') injectPickerScript();
                  }}
                  onError={() => { setLoading(false); setIframeBlocked(true); }}
                />
                )}

                {!hasLiveView && !screenshotUrl && !loading && !navigateError && mode === 'browse' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center bg-[var(--bg-app)]">
                    <Globe size={32} strokeWidth={1.5} className="text-muted" />
                    <p className="text-sm font-medium text-muted">Browser</p>
                    <p className="text-[11px] text-muted max-w-sm leading-relaxed">
                      Enter a URL above, or instruct the Agent to navigate and use the browser
                    </p>
                  </div>
                )}

                {loading && mode === 'browse' && !screenshotUrl && (
                  <div className="absolute top-0 left-0 right-0 bottom-0 z-[6] flex flex-col items-center justify-center gap-3 bg-[var(--bg-app)]/90">
                    <Loader2 size={20} className="animate-spin text-[var(--color-primary)]" />
                    <p className="text-[11px] text-muted">
                      {browserRunSessionRef.current ? 'Starting Browser Run live view…' : 'Loading page…'}
                    </p>
                  </div>
                )}

                {navigateError && mode === 'browse' && !screenshotUrl && (
                  <div className="absolute top-0 left-0 right-0 bottom-0 z-10 flex flex-col min-h-0 bg-[var(--bg-app)] p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle size={14} className="text-red-400 shrink-0" />
                      <span className="text-[11px] font-semibold text-red-400">Browser Run live view failed</span>
                    </div>
                    <pre className="text-[10px] text-red-400/90 font-mono bg-[var(--bg-panel)] rounded p-3 whitespace-pre-wrap flex-1 overflow-auto">{navigateError}</pre>
                    <button
                      type="button"
                      onClick={() => void openBrowserRunLiveView(currentUrl)}
                      className="mt-3 text-[10px] text-[var(--color-primary)] underline self-start"
                    >
                      Retry live view
                    </button>
                  </div>
                )}

                {iframeBlocked && mode === 'browse' && !screenshotUrl && !navigateError && (
                  <div className="absolute top-0 left-0 right-0 bottom-0 z-10 flex flex-col min-h-0 bg-[var(--bg-app)]">
                    <BlockedPage url={currentUrl} onScreenshot={runScreenshot} />
                  </div>
                )}

                {(mode === 'browse' || mode === 'picker' || mode === 'area') && screenshotUrl && (
                  <div
                    className="absolute top-0 left-0 right-0 bottom-0 z-[5] flex flex-col min-h-0 overflow-auto bg-[var(--bg-app)]"
                    style={{ zoom: zoom !== 100 ? zoom / 100 : undefined }}
                  >
                    {loading && (
                      <div className="flex flex-col items-center justify-center flex-1 gap-3 p-8">
                        <Loader2 size={20} className="animate-spin text-[var(--color-primary)]" />
                        <p className="text-[11px] text-muted">Loading automation preview…</p>
                      </div>
                    )}
                    {!loading && navigateError && (
                      <div className="p-4 space-y-3">
                        <div className="flex items-center gap-2">
                          <AlertTriangle size={14} className="text-red-400 shrink-0" />
                          <span className="text-[11px] font-semibold text-red-400">Automation preview failed</span>
                        </div>
                        <pre className="text-[10px] text-red-400/90 font-mono bg-[var(--bg-panel)] rounded p-3 whitespace-pre-wrap">{navigateError}</pre>
                        <button
                          type="button"
                          onClick={() => void loadAutomationPreview(currentUrl)}
                          className="text-[10px] text-[var(--color-primary)] underline"
                        >
                          Retry automation
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setScreenshotUrl(null);
                            setNavigateError(null);
                            void navigate(currentUrl);
                          }}
                          className="ml-3 text-[10px] text-muted underline"
                        >
                          Open live view
                        </button>
                      </div>
                    )}
                    {!loading && !navigateError && (
                      <img
                        src={screenshotUrl}
                        alt={`Automation preview: ${currentUrl}`}
                        className="w-full h-auto block bg-white"
                      />
                    )}
                  </div>
                )}

                {mode === 'area' && (
                  <div className="absolute top-0 left-0 right-0 bottom-0 z-20 bg-black/20">
                    <p className="absolute top-2 left-1/2 -translate-x-1/2 text-[10px] font-mono text-white bg-black/60 px-2 py-1 rounded-md">
                      Drag to select area
                    </p>
                    {areaRect && areaRect.width > 0 && (
                      <div
                        className="absolute border-2 border-[var(--color-primary)] bg-[var(--color-primary)]/10"
                        style={{ left: areaRect.left, top: areaRect.top, width: areaRect.width, height: areaRect.height }}
                      />
                    )}
                  </div>
                )}

                <DesignModeAnnotateOverlay
                  mode={mode}
                  designModeOn={designModeOn}
                  designSelections={designSelections}
                  annotateFrame={annotateFrame}
                  screenshotUrl={screenshotUrl}
                  annotateStrokes={annotateStrokes}
                  annotateDrawingRef={annotateDrawingRef}
                  annotateCurrentRef={annotateCurrentRef}
                  setAnnotateStrokes={setAnnotateStrokes}
                  publishDesignModeSurface={publishDesignModeSurface}
                  setMode={setMode}
                />

                <DesignModeSelectionChips
                  designModeOn={designModeOn}
                  designSelections={designSelections}
                  mode={mode}
                />

                {mode === 'screenshot' && (
                  <div className="absolute top-0 left-0 right-0 bottom-0 z-10 flex flex-col bg-[var(--bg-app)] overflow-auto min-h-0">
                    {screenshotLoad ? (
                      <div className="flex flex-col items-center justify-center flex-1 gap-3">
                        <Loader2 size={18} className="animate-spin text-[var(--color-primary)]" />
                        <p className="text-[11px] text-muted">Capturing via Playwright...</p>
                      </div>
                    ) : screenshotErr ? (
                      <div className="p-4 space-y-2">
                        <div className="flex items-center gap-2">
                          <AlertTriangle size={13} className="text-red-400" />
                          <span className="text-[11px] font-semibold text-red-400">Capture incomplete</span>
                          <button type="button" onClick={() => setMode('browse')} className="ml-auto text-[10px] text-muted hover:text-main underline">Back</button>
                        </div>
                        <pre className="text-[10px] text-red-400 font-mono bg-[var(--bg-panel)] rounded p-3 whitespace-pre-wrap">{screenshotErr}</pre>
                      </div>
                    ) : screenshotUrl ? (
                      <div className="p-4 space-y-3">
                        <div className="flex items-center gap-2">
                          <CheckCircle size={13} className="text-green-400" />
                          <span className="text-[11px] font-semibold text-main">Screenshot captured</span>
                          <button type="button" onClick={() => setMode('browse')} className="ml-auto text-[10px] text-muted hover:text-main underline">Back</button>
                        </div>
                        <img src={screenshotUrl} alt="screenshot" className="w-full rounded-lg border border-[var(--border-subtle)]" />
                      </div>
                    ) : null}
                  </div>
                )}

                {mode === 'picker' && pickerCrossOrigin && (hasLiveView || iframeBlocked) && !screenshotUrl && (
                  <div
                    className="absolute inset-0 z-[25] cursor-crosshair"
                    style={{ zoom: zoom !== 100 ? zoom / 100 : undefined }}
                    onMouseMove={onPickerOverlayMove}
                    onMouseLeave={() => setPickerHighlight(null)}
                    onClick={onPickerOverlayClick}
                    role="presentation"
                    aria-hidden
                  >
                    {pickerHighlight && pickerHighlight.width > 0 && pickerHighlight.height > 0 && (
                      <div
                        className="pointer-events-none absolute border-2 border-[var(--color-primary)] bg-[var(--color-primary)]/10 rounded-sm transition-all duration-75"
                        style={{
                          top: pickerHighlight.top,
                          left: pickerHighlight.left,
                          width: pickerHighlight.width,
                          height: pickerHighlight.height,
                        }}
                      />
                    )}
                  </div>
                )}

                {mode === 'picker' && !inspectedEl && (
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--color-primary)] text-white text-[10px] font-semibold shadow-lg">
                      <MousePointer2 size={10} />
                      Pick mode — Esc to browse
                      {designModeOn ? ' · Design Mode stays armed' : ''}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {devToolsOpen && browserRunEmbedUrls?.devtools ? (
            <BrowserSurfaceDevToolsDock
              devtoolsEmbedUrl={browserRunEmbedUrls.devtools}
              sessionId={browserRunSessionRef.current}
              widthPct={devToolsWidth}
              onClose={() => setDevToolsOpen(false)}
              onResizeStart={startResize}
            />
          ) : devToolsOpen ? (
            <div className="flex flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 text-[11px] text-muted min-w-[280px]">
              <p>Starting live browser session for DevTools…</p>
              <button
                type="button"
                className="mt-2 text-[var(--color-primary)] underline text-left"
                onClick={() => void openBrowserRunLiveView(currentUrl)}
              >
                Retry session
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {toastMsg && (
        <div className="shrink-0 px-3 py-1.5 text-center text-[10px] bg-[var(--bg-panel)] border-t border-[var(--border-subtle)] text-muted">
          {toastMsg}
        </div>
      )}

      {/* Permission Gate */}
      {trustRequest && (
        <PermissionGate
          request={trustRequest}
          onDeny={() => { trustRequest.resolve(null); setTrustRequest(null); }}
          onAllowOnce={() => { trustRequest.resolve('session'); setTrustRequest(null); }}
          onAlwaysAllow={() => { trustRequest.resolve('persistent'); setTrustRequest(null); }}
        />
      )}
    </div>
  );
};
