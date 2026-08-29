import React, { useCallback, useRef, useState } from 'react';
import { GripVertical } from 'lucide-react';

type Props = {
  children: React.ReactNode;
  minWidth?: number;
  maxWidth?: number;
  defaultWidth?: number;
  className?: string;
};

/** Horizontal resize handle for inspector / tweaks columns. */
export function ResizableColumn({
  children,
  minWidth = 220,
  maxWidth = 480,
  defaultWidth = 300,
  className = '',
}: Props) {
  const [width, setWidth] = useState(defaultWidth);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startW: width };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [width],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return;
      const delta = e.clientX - dragRef.current.startX;
      const next = Math.min(maxWidth, Math.max(minWidth, dragRef.current.startW + delta));
      setWidth(next);
    },
    [minWidth, maxWidth],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragRef.current = null;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, []);

  return (
    <div className={`flex shrink-0 min-h-0 ${className}`} style={{ width }}>
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">{children}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="w-1.5 shrink-0 cursor-col-resize flex items-center justify-center hover:bg-[var(--bg-hover)]"
        style={{ borderLeft: '1px solid var(--border-subtle)' }}
      >
        <GripVertical size={12} className="text-muted opacity-50" />
      </div>
    </div>
  );
}
