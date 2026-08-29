import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PHONE_MQ } from '../../lib/breakpoints';
import { LS_PAGE_HEIGHT } from './shellTypes';

export const MIN_HEIGHT = 140;
const MAX_HEIGHT_RATIO = 0.82;
/** Phone keeps enough room above for Agent composer + a few chat lines. */
const PHONE_MAX_HEIGHT_RATIO = 0.5;
const DEFAULT_HEIGHT = 320;
const DEFAULT_HEIGHT_PHONE = 220;

export function phoneViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(PHONE_MQ).matches;
}

export function terminalMaxHeightPx(): number {
  const viewportH = window.visualViewport?.height || window.innerHeight;
  const ratio = phoneViewport() ? PHONE_MAX_HEIGHT_RATIO : MAX_HEIGHT_RATIO;
  const floorReserve = phoneViewport() ? 168 : 0;
  return Math.max(MIN_HEIGHT, Math.min(viewportH * ratio, viewportH - floorReserve));
}

export function useTerminalPanelHeight(layout: 'page' | 'drawer') {
  const isDrawer = layout === 'drawer';
  const [height, setHeight] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_HEIGHT;
    const maxH = terminalMaxHeightPx();
    try {
      const raw = localStorage.getItem(LS_PAGE_HEIGHT);
      const n = raw ? Number.parseInt(raw, 10) : NaN;
      if (Number.isFinite(n) && n >= MIN_HEIGHT) {
        return Math.min(n, maxH);
      }
    } catch {
      /* ignore */
    }
    return Math.min(phoneViewport() ? DEFAULT_HEIGHT_PHONE : DEFAULT_HEIGHT, maxH);
  });
  const [isCollapsed, setIsCollapsed] = useState(false);
  /**
   * Phone keyboard lift — DOM-only (no React state).
   * setState + transform re-render blurs xterm's helper textarea on iOS and
   * auto-dismisses the keyboard.
   */
  const shellRootRef = useRef<HTMLDivElement | null>(null);
  const kbLiftPxRef = useRef(0);

  const publishTerminalPanelH = useCallback(
    (liftPx = kbLiftPxRef.current) => {
      const root = shellRootRef.current;
      const base =
        layout === 'page'
          ? isCollapsed
            ? 36
            : height
          : Math.round(root?.getBoundingClientRect().height || 0);
      const px = !isCollapsed ? base + Math.max(0, liftPx) : base;
      document.documentElement.style.setProperty('--terminal-panel-h', `${Math.max(0, px)}px`);
      window.dispatchEvent(new Event('iam-terminal-panel-h'));
    },
    [layout, height, isCollapsed],
  );

  const applyKbLiftDom = useCallback(
    (inset: number) => {
      const root = shellRootRef.current;
      const next = Math.max(0, Math.round(inset));
      if (next === kbLiftPxRef.current && root?.style.transform) {
        // Still republish panel-h in case chat inset drifted.
        publishTerminalPanelH(next);
        return;
      }
      kbLiftPxRef.current = next;
      if (root) {
        if (next > 0) {
          root.style.transform = `translateY(-${next}px)`;
          root.dataset.kbLift = '1';
          root.style.transition = 'none';
        } else {
          root.style.transform = '';
          delete root.dataset.kbLift;
          if (!isDrawer) root.style.transition = 'height 0.2s ease-out';
        }
      }
      publishTerminalPanelH(next);
    },
    [isDrawer, publishTerminalPanelH],
  );

  useEffect(() => {
    let ro: ResizeObserver | null = null;
    let raf = 0;
    const publish = () => {
      publishTerminalPanelH();
      const root = shellRootRef.current;
      if (layout !== 'page' && root && !ro) {
        ro = new ResizeObserver(publish);
        ro.observe(root);
      }
    };
    publish();
    if (layout !== 'page' && !shellRootRef.current) {
      raf = window.requestAnimationFrame(publish);
    }
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      ro?.disconnect();
      document.documentElement.style.setProperty('--terminal-panel-h', '0px');
      window.dispatchEvent(new Event('iam-terminal-panel-h'));
    };
  }, [layout, publishTerminalPanelH]);

  useEffect(() => {
    if (isCollapsed || typeof window === 'undefined') {
      applyKbLiftDom(0);
      return;
    }
    const root = shellRootRef.current;
    if (!root) return;
    const timers: number[] = [];
    const syncKbLift = () => {
      if (!phoneViewport()) {
        applyKbLiftDom(0);
        return;
      }
      const helper = root.querySelector('.xterm-helper-textarea');
      const focused = !!(helper && document.activeElement === helper);
      const vv = window.visualViewport;
      if (!focused || !vv) {
        applyKbLiftDom(0);
        return;
      }
      const inset = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
      applyKbLiftDom(inset);
    };
    const onFocusIn = () => {
      syncKbLift();
      timers.push(window.setTimeout(syncKbLift, 120), window.setTimeout(syncKbLift, 320));
    };
    const onFocusOut = (ev: FocusEvent) => {
      // Ignore focus moves that stay inside the terminal shell (iOS helper churn).
      const next = ev.relatedTarget as Node | null;
      if (next && root.contains(next)) return;
      for (const id of timers.splice(0)) window.clearTimeout(id);
      // Delay clear so iOS keyboard animation does not immediately drop lift.
      timers.push(window.setTimeout(syncKbLift, 180));
    };
    const vv = window.visualViewport;
    vv?.addEventListener('resize', syncKbLift);
    vv?.addEventListener('scroll', syncKbLift);
    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('focusout', onFocusOut);
    syncKbLift();
    return () => {
      vv?.removeEventListener('resize', syncKbLift);
      vv?.removeEventListener('scroll', syncKbLift);
      root.removeEventListener('focusin', onFocusIn);
      root.removeEventListener('focusout', onFocusOut);
      for (const id of timers.splice(0)) window.clearTimeout(id);
      applyKbLiftDom(0);
    };
  }, [isCollapsed, height, isDrawer, applyKbLiftDom]);

  useEffect(() => {
    if (isDrawer) setIsCollapsed(false);
  }, [isDrawer]);

  const handleDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture?.(e.pointerId);
    handle.dataset.dragging = 'true';
    document.body.classList.add('is-terminal-resizing');
    const startY = e.clientY;
    const startH = height;
    const maxH = terminalMaxHeightPx();
    let latestH = startH;
    const onMove = (me: PointerEvent) => {
      latestH = Math.max(MIN_HEIGHT, Math.min(startH + (startY - me.clientY), maxH));
      setHeight(latestH);
    };
    const onUp = (up: PointerEvent) => {
      handle.dataset.dragging = 'false';
      document.body.classList.remove('is-terminal-resizing');
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      if (handle.hasPointerCapture?.(up.pointerId)) handle.releasePointerCapture(up.pointerId);
      try {
        localStorage.setItem(LS_PAGE_HEIGHT, String(latestH));
      } catch {
        /* ignore */
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  };

  return {
    height,
    setHeight,
    isCollapsed,
    setIsCollapsed,
    shellRootRef,
    handleDragStart,
    isDrawer,
  };
}
