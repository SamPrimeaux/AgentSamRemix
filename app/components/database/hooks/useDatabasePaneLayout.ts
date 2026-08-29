import { useCallback, useRef, useState } from 'react';

const LS_RESULTS_H = 'iam.database.resultsPaneHeight';
const DEFAULT_RESULTS_PANE_H = 220;
export const DATABASE_MIN_RESULTS_PANE_H = 160;
export const DATABASE_MIN_SQL_EDITOR_H = 120;

function readStoredResultsHeight(): number {
  try {
    const n = Number(localStorage.getItem(LS_RESULTS_H));
    if (Number.isFinite(n) && n >= DATABASE_MIN_RESULTS_PANE_H) return Math.round(n);
  } catch {
    // Ignore storage failures.
  }
  return DEFAULT_RESULTS_PANE_H;
}

export function useDatabasePaneLayout() {
  const [resultsPaneHeight, setResultsPaneHeight] = useState(readStoredResultsHeight);
  const [splitterDragging, setSplitterDragging] = useState(false);
  const sqlStackRef = useRef<HTMLDivElement | null>(null);
  const resultsPaneHeightRef = useRef(resultsPaneHeight);
  resultsPaneHeightRef.current = resultsPaneHeight;

  const beginResultsPaneResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches) return;
    e.preventDefault();
    const el = e.currentTarget;
    const pointerId = e.pointerId;
    try {
      el.setPointerCapture(pointerId);
    } catch {
      // Ignore capture failures.
    }
    setSplitterDragging(true);
    document.body.classList.add('is-resizing-row');
    const startY = e.clientY;
    const startH = resultsPaneHeightRef.current;
    const stackH = sqlStackRef.current?.getBoundingClientRect().height ?? 600;
    const maxResults = Math.max(DATABASE_MIN_RESULTS_PANE_H, stackH - DATABASE_MIN_SQL_EDITOR_H - 8);

    let finished = false;
    const endDrag = () => {
      if (finished) return;
      finished = true;
      setSplitterDragging(false);
      document.body.classList.remove('is-resizing-row');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      try {
        el.releasePointerCapture(pointerId);
      } catch {
        // Ignore release failures.
      }
      try {
        localStorage.setItem(LS_RESULTS_H, String(resultsPaneHeightRef.current));
      } catch {
        // Ignore storage failures.
      }
    };

    const onMove = (pe: PointerEvent) => {
      if (pe.pointerId !== pointerId) return;
      const delta = startY - pe.clientY;
      const next = Math.max(DATABASE_MIN_RESULTS_PANE_H, Math.min(maxResults, startH + delta));
      setResultsPaneHeight(next);
    };
    const onEnd = (pe: PointerEvent) => {
      if (pe.pointerId !== pointerId) return;
      endDrag();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  }, []);

  const resetResultsPaneHeight = useCallback(() => {
    setResultsPaneHeight(DEFAULT_RESULTS_PANE_H);
  }, []);

  return {
    resultsPaneHeight,
    splitterDragging,
    sqlStackRef,
    beginResultsPaneResize,
    resetResultsPaneHeight,
  };
}
