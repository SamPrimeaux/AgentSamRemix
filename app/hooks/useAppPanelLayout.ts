/** App shell panel resize + width prefs (Wave 2 E2). */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AGENT_PANEL_MIN_W,
  AGENT_PANEL_MAX_W,
  MAIN_MIN_W_FOR_AGENT_RESIZE,
  LS_ACTIVITY_PANEL_W,
  LS_EDITOR_PREVIEW_SPLIT_PCT,
  EDITOR_PREVIEW_SPLIT_MIN,
  EDITOR_PREVIEW_SPLIT_MAX,
  LS_MOBILE_ACTIVITY_PANEL_VH,
  MOBILE_ACTIVITY_PANEL_MIN_VH,
  MOBILE_ACTIVITY_PANEL_MAX_VH,
  readMobileActivityPanelVh,
  readActivityPanelW,
  readEditorPreviewSplitPct,
  getNextPanelWidth,
  activityRailWidthPx,
  getAgentPanelViewportMaxPx,
} from '../lib/appShellLayout';

export type AgentPanelPosition = 'right' | 'left' | 'off';

export function useAppPanelLayout(opts: {
  activeActivity: 'files' | 'mcps' | 'git' | 'debug' | 'actions' | 'drive' | null;
  sidebarRailExpanded: boolean;
  agentPosition: AgentPanelPosition;
}) {
  const { activeActivity, sidebarRailExpanded, agentPosition } = opts;

  const [sidebarW, setSidebarW] = useState(readActivityPanelW);
  const [mobileActivityPanelVh, setMobileActivityPanelVh] = useState(readMobileActivityPanelVh);
  const mobileActivityPanelVhRef = useRef(mobileActivityPanelVh);
  const [agentW, setAgentW] = useState(360);
  const editorPreviewSplitRef = useRef<HTMLDivElement>(null);
  const [editorPreviewEditorPct, setEditorPreviewEditorPct] = useState(readEditorPreviewSplitPct);
  const [terminalDrawerH, setTerminalDrawerH] = useState(288);

  useEffect(() => {
    try {
      localStorage.setItem(LS_EDITOR_PREVIEW_SPLIT_PCT, String(editorPreviewEditorPct));
    } catch {
      /* ignore */
    }
  }, [editorPreviewEditorPct]);

  const shellLayoutRef = useRef({
    sidebarW: 260,
    sidebarRailExpanded: true,
    activityOpen: false,
  });
  useEffect(() => {
    shellLayoutRef.current = {
      sidebarW,
      sidebarRailExpanded,
      activityOpen: !!activeActivity,
    };
  }, [sidebarW, sidebarRailExpanded, activeActivity]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_ACTIVITY_PANEL_W, String(sidebarW));
    } catch {
      /* ignore */
    }
  }, [sidebarW]);

  const clampAgentWidthToViewport = useCallback((w: number) => {
    const vw =
      typeof window !== 'undefined' && Number.isFinite(window.innerWidth) ? window.innerWidth : 1440;
    const ctx = shellLayoutRef.current;
    const maxV = getAgentPanelViewportMaxPx({
      viewportInnerWidth: vw,
      activityRailWidth: activityRailWidthPx(ctx.sidebarRailExpanded),
      activityPanelOpen: ctx.activityOpen,
      activityPanelWidth: ctx.sidebarW,
      mainMinWidth: MAIN_MIN_W_FOR_AGENT_RESIZE,
    });
    const maxClamp = Math.min(AGENT_PANEL_MAX_W, maxV);
    const hi = Math.max(AGENT_PANEL_MIN_W, maxClamp);
    return Math.max(AGENT_PANEL_MIN_W, Math.min(hi, Math.round(w)));
  }, []);

  useEffect(() => {
    const clamp = () => setAgentW((prev) => clampAgentWidthToViewport(prev));
    clamp();
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, [activeActivity, sidebarW, sidebarRailExpanded, agentPosition, clampAgentWidthToViewport]);

  const beginPanelResize = useCallback(
    (panel: 'sidebar' | 'agent', e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const el = e.currentTarget;
      const pointerId = e.pointerId;
      try {
        el.setPointerCapture(pointerId);
      } catch {
        /* already captured or unsupported */
      }
      document.body.classList.add('is-resizing');

      const startX = e.clientX;
      const startW = panel === 'sidebar' ? sidebarW : agentW;
      const agentSideAtStart = agentPosition;

      let finished = false;
      const endDrag = () => {
        if (finished) return;
        finished = true;
        document.body.classList.remove('is-resizing');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
        try {
          el.releasePointerCapture(pointerId);
        } catch {
          /* already released */
        }
      };

      const onMove = (pe: PointerEvent) => {
        if (pe.pointerId !== pointerId) return;
        const delta = pe.clientX - startX;
        const ctx = shellLayoutRef.current;

        if (panel === 'sidebar') {
          // Chat left → Files docks right (handle on Files' left edge). Else Files docks left.
          const filesDock: 'left' | 'right' =
            agentSideAtStart === 'left' ? 'right' : 'left';
          const next = getNextPanelWidth({
            startWidth: startW,
            deltaX: delta,
            dock: filesDock,
            min: 180,
            max: 480,
          });
          setSidebarW(next);
          return;
        }

        if (agentSideAtStart === 'off') return;

        const vw =
          typeof window !== 'undefined' && Number.isFinite(window.innerWidth) ? window.innerWidth : 1440;
        const maxV = getAgentPanelViewportMaxPx({
          viewportInnerWidth: vw,
          activityRailWidth: activityRailWidthPx(ctx.sidebarRailExpanded),
          activityPanelOpen: ctx.activityOpen,
          activityPanelWidth: ctx.sidebarW,
          mainMinWidth: MAIN_MIN_W_FOR_AGENT_RESIZE,
        });
        const maxClamp = Math.min(AGENT_PANEL_MAX_W, maxV);
        const hi = Math.max(AGENT_PANEL_MIN_W, maxClamp);
        const agentDock: 'left' | 'right' =
          agentSideAtStart === 'right' ? 'right' : 'left';
        const next = getNextPanelWidth({
          startWidth: startW,
          deltaX: delta,
          dock: agentDock,
          min: AGENT_PANEL_MIN_W,
          max: hi,
        });
        setAgentW(next);
      };

      const onEnd = (pe: PointerEvent) => {
        if (pe.pointerId !== pointerId) return;
        endDrag();
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onEnd);
      window.addEventListener('pointercancel', onEnd);
    },
    [sidebarW, agentW, agentPosition],
  );

  const beginEditorPreviewResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    const pointerId = e.pointerId;
    try {
      el.setPointerCapture(pointerId);
    } catch {
      /* ignore */
    }
    document.body.classList.add('is-resizing');

    const startX = e.clientX;
    const startPct = editorPreviewEditorPct;
    const container = editorPreviewSplitRef.current;

    let finished = false;
    const endDrag = () => {
      if (finished) return;
      finished = true;
      document.body.classList.remove('is-resizing');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      try {
        el.releasePointerCapture(pointerId);
      } catch {
        /* ignore */
      }
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new CustomEvent('iam:monaco-layout'));
    };

    const onMove = (pe: PointerEvent) => {
      if (pe.pointerId !== pointerId) return;
      const width = container?.getBoundingClientRect().width ?? 0;
      if (width <= 0) return;
      const deltaPct = ((pe.clientX - startX) / width) * 100;
      const next = Math.max(
        EDITOR_PREVIEW_SPLIT_MIN,
        Math.min(EDITOR_PREVIEW_SPLIT_MAX, startPct + deltaPct),
      );
      setEditorPreviewEditorPct(next);
      window.dispatchEvent(new CustomEvent('iam:monaco-layout'));
    };

    const onEnd = (pe: PointerEvent) => {
      if (pe.pointerId !== pointerId) return;
      endDrag();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  }, [editorPreviewEditorPct]);

  useEffect(() => {
    mobileActivityPanelVhRef.current = mobileActivityPanelVh;
  }, [mobileActivityPanelVh]);

  useEffect(() => {
    const onExpandSheet = (e: Event) => {
      const detail = (e as CustomEvent<{ vh?: number }>).detail;
      const target = Number(detail?.vh);
      const next = Number.isFinite(target)
        ? Math.min(MOBILE_ACTIVITY_PANEL_MAX_VH, Math.max(MOBILE_ACTIVITY_PANEL_MIN_VH, target))
        : MOBILE_ACTIVITY_PANEL_MAX_VH;
      setMobileActivityPanelVh(next);
      try {
        sessionStorage.setItem(LS_MOBILE_ACTIVITY_PANEL_VH, String(next));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('iam-mobile-activity-sheet-expand', onExpandSheet as EventListener);
    return () => window.removeEventListener('iam-mobile-activity-sheet-expand', onExpandSheet as EventListener);
  }, []);

  const beginMobileActivitySheetResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    const pointerId = e.pointerId;
    const startY = e.clientY;
    const startVh = mobileActivityPanelVhRef.current;
    try {
      el.setPointerCapture(pointerId);
    } catch {
      /* ignore */
    }
    document.body.classList.add('is-resizing');

    const onMove = (pe: PointerEvent) => {
      if (pe.pointerId !== pointerId) return;
      const vh = window.innerHeight || 800;
      const deltaVh = ((startY - pe.clientY) / vh) * 100;
      const next = Math.min(
        MOBILE_ACTIVITY_PANEL_MAX_VH,
        Math.max(MOBILE_ACTIVITY_PANEL_MIN_VH, startVh + deltaVh),
      );
      setMobileActivityPanelVh(Math.round(next * 10) / 10);
    };

    const endDrag = () => {
      document.body.classList.remove('is-resizing');
      try {
        sessionStorage.setItem(
          LS_MOBILE_ACTIVITY_PANEL_VH,
          String(mobileActivityPanelVhRef.current),
        );
      } catch {
        /* ignore */
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    const onUp = (pe: PointerEvent) => {
      if (pe.pointerId !== pointerId) return;
      endDrag();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, []);

  const terminalResizeRef = useRef<{ startY: number; startH: number } | null>(null);
  const clampTerminalH = useCallback((h: number) => {
    const min = 160;
    // Keep at least 160px for the content above the drawer.
    const max = Math.max(min, window.innerHeight - 10 /* topbar */ - 32 /* tabs */ - 84 /* status/mobile */ - 160);
    return Math.max(min, Math.min(max, Math.round(h)));
  }, []);

  const beginTerminalResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture?.(e.pointerId);
    handle.dataset.dragging = 'true';
    document.body.classList.add('is-terminal-resizing');
    terminalResizeRef.current = { startY: e.clientY, startH: terminalDrawerH };

    const onMove = (pe: PointerEvent) => {
      const s = terminalResizeRef.current;
      if (!s) return;
      const next = clampTerminalH(s.startH + (s.startY - pe.clientY));
      setTerminalDrawerH(next);
      window.dispatchEvent(new Event('resize'));
    };
    const onUp = () => {
      terminalResizeRef.current = null;
      handle.dataset.dragging = 'false';
      document.body.classList.remove('is-terminal-resizing');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [terminalDrawerH, clampTerminalH]);

  return {
    sidebarW,
    setSidebarW,
    mobileActivityPanelVh,
    setMobileActivityPanelVh,
    agentW,
    setAgentW,
    editorPreviewSplitRef,
    editorPreviewEditorPct,
    setEditorPreviewEditorPct,
    terminalDrawerH,
    setTerminalDrawerH,
    beginPanelResize,
    beginEditorPreviewResize,
    beginMobileActivitySheetResize,
    beginTerminalResize,
    clampTerminalH,
  };
}
