import { useCallback, useEffect, useRef, useState } from 'react';

export function useVerticalResize(opts: {
  initial: number;
  min: number;
  max: number;
  /** Drag up increases height when true (bottom panel). */
  invert?: boolean;
}) {
  const [height, setHeight] = useState(opts.initial);
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(opts.initial);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      draggingRef.current = true;
      startYRef.current = e.clientY;
      startHeightRef.current = height;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [height],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const delta = e.clientY - startYRef.current;
      const signed = opts.invert ? -delta : delta;
      const next = Math.min(opts.max, Math.max(opts.min, startHeightRef.current + signed));
      setHeight(next);
    };
    const onUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [opts.invert, opts.max, opts.min]);

  return { height, setHeight, onPointerDown };
}
