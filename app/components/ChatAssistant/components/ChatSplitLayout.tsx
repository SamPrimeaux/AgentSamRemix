import React, { useCallback, useRef } from 'react';

type Props = {
  ratio: number;
  onRatioChange: (ratio: number) => void;
  left: React.ReactNode;
  right: React.ReactNode;
  className?: string;
};

/** Desktop parent | child dual-pane with drag resize. */
export function ChatSplitLayout({ ratio, onRatioChange, left, right, className = '' }: Props) {
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width < 80) return;
      const next = Math.min(0.75, Math.max(0.25, (e.clientX - rect.left) / rect.width));
      onRatioChange(next);
    },
    [onRatioChange],
  );

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  const leftPct = Math.round(ratio * 1000) / 10;

  return (
    <div
      ref={containerRef}
      className={`flex flex-1 min-h-0 min-w-0 overflow-hidden ${className}`}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="flex flex-col min-h-0 min-w-0 overflow-hidden" style={{ width: `${leftPct}%` }}>
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat panes"
        className="w-1.5 shrink-0 cursor-col-resize bg-[var(--dashboard-border)] hover:bg-[var(--solar-cyan)]/50 transition-colors"
        onPointerDown={onPointerDown}
      />
      <div className="flex flex-col min-h-0 min-w-0 overflow-hidden flex-1">{right}</div>
    </div>
  );
}
