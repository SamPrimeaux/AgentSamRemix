import { useCallback, useRef, useState } from 'react';

const LS_SIDEBAR_W = 'iam.database.sidebarWidth';
const DEFAULT_SIDEBAR_W = 220;
export const DATABASE_SIDEBAR_COLLAPSED_W = 44;
export const DATABASE_SIDEBAR_MIN_EXPANDED_W = 148;
export const DATABASE_SIDEBAR_MAX_W = 420;
const MOBILE_BREAKPOINT_QUERY = '(max-width: 768px)';

function isMobileViewport(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches;
  } catch {
    return false;
  }
}

function clampSidebarWidth(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SIDEBAR_W;
  const w = Math.round(n);
  if (w <= DATABASE_SIDEBAR_COLLAPSED_W + 12) return DATABASE_SIDEBAR_COLLAPSED_W;
  return Math.max(DATABASE_SIDEBAR_MIN_EXPANDED_W, Math.min(DATABASE_SIDEBAR_MAX_W, w));
}

function readStoredSidebarWidth(): number {
  // A desktop-dragged width is meaningless on a phone screen -- a 220px+ rail
  // eats most of a ~390px viewport and leaves no room for the SQL editor and
  // results. Mobile always starts as the collapsed icon rail; the desktop
  // stored preference (LS_SIDEBAR_W) is left untouched for desktop sessions.
  if (isMobileViewport()) return DATABASE_SIDEBAR_COLLAPSED_W;
  try {
    const n = Number(localStorage.getItem(LS_SIDEBAR_W));
    if (Number.isFinite(n)) return clampSidebarWidth(n);
  } catch {
    // Ignore storage failures.
  }
  return DEFAULT_SIDEBAR_W;
}

export function useDatabaseSidebarLayout() {
  const [sidebarWidth, setSidebarWidth] = useState(readStoredSidebarWidth);
  const [sidebarDragging, setSidebarDragging] = useState(false);
  const studioShellRef = useRef<HTMLDivElement | null>(null);
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;
  const lastExpandedSidebarRef = useRef(
    sidebarWidth > DATABASE_SIDEBAR_COLLAPSED_W ? sidebarWidth : DEFAULT_SIDEBAR_W,
  );

  const persistSidebarWidth = useCallback((next: number) => {
    const clamped = clampSidebarWidth(next);
    sidebarWidthRef.current = clamped;
    setSidebarWidth(clamped);
    if (clamped > DATABASE_SIDEBAR_COLLAPSED_W) lastExpandedSidebarRef.current = clamped;
    try {
      localStorage.setItem(LS_SIDEBAR_W, String(clamped));
    } catch {
      // Ignore storage failures.
    }
  }, []);

  const beginSidebarResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches) return;
      e.preventDefault();
      const el = e.currentTarget;
      const pointerId = e.pointerId;
      try {
        el.setPointerCapture(pointerId);
      } catch {
        // Ignore capture failures.
      }
      setSidebarDragging(true);
      document.body.classList.add('is-resizing-col');
      const startX = e.clientX;
      const startW = sidebarWidthRef.current;
      const shellW = studioShellRef.current?.getBoundingClientRect().width ?? 960;
      const maxW = Math.min(
        DATABASE_SIDEBAR_MAX_W,
        Math.max(DATABASE_SIDEBAR_MIN_EXPANDED_W, shellW - 280),
      );

      let finished = false;
      const endDrag = () => {
        if (finished) return;
        finished = true;
        setSidebarDragging(false);
        document.body.classList.remove('is-resizing-col');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
        try {
          el.releasePointerCapture(pointerId);
        } catch {
          // Ignore release failures.
        }
        persistSidebarWidth(sidebarWidthRef.current);
      };

      const onMove = (pe: PointerEvent) => {
        if (pe.pointerId !== pointerId) return;
        const raw = startW + (pe.clientX - startX);
        const next =
          raw < 100
            ? DATABASE_SIDEBAR_COLLAPSED_W
            : Math.max(DATABASE_SIDEBAR_MIN_EXPANDED_W, Math.min(maxW, raw));
        sidebarWidthRef.current = next;
        setSidebarWidth(next);
        if (next > DATABASE_SIDEBAR_COLLAPSED_W) lastExpandedSidebarRef.current = next;
      };
      const onEnd = (pe: PointerEvent) => {
        if (pe.pointerId !== pointerId) return;
        endDrag();
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onEnd);
      window.addEventListener('pointercancel', onEnd);
    },
    [persistSidebarWidth],
  );

  const toggleSidebarCollapsed = useCallback(() => {
    if (sidebarWidthRef.current <= DATABASE_SIDEBAR_COLLAPSED_W) {
      persistSidebarWidth(lastExpandedSidebarRef.current || DEFAULT_SIDEBAR_W);
      return;
    }
    lastExpandedSidebarRef.current = sidebarWidthRef.current;
    persistSidebarWidth(DATABASE_SIDEBAR_COLLAPSED_W);
  }, [persistSidebarWidth]);

  return {
    sidebarWidth,
    sidebarCollapsed: sidebarWidth <= DATABASE_SIDEBAR_COLLAPSED_W,
    sidebarDragging,
    studioShellRef,
    beginSidebarResize,
    toggleSidebarCollapsed,
  };
}
