import React, { useEffect, useRef, useState } from 'react';

export type SmoothProgressBarProps = {
  /** 0–100; when null, bar is indeterminate. */
  value: number | null;
  /** Show subtle pulse when value is 0 but work is active. */
  indeterminate?: boolean;
  className?: string;
  height?: number;
  showLabel?: boolean;
};

export function SmoothProgressBar({
  value,
  indeterminate = false,
  className = '',
  height = 3,
  showLabel = true,
}: SmoothProgressBarProps) {
  const [displayPct, setDisplayPct] = useState(0);
  const rafRef = useRef<number | null>(null);
  const target = value == null ? null : Math.max(0, Math.min(100, value));

  useEffect(() => {
    if (target == null) return undefined;
    const start = displayPct;
    const delta = target - start;
    if (Math.abs(delta) < 0.5) {
      setDisplayPct(target);
      return undefined;
    }
    const t0 = performance.now();
    const duration = Math.min(600, Math.max(180, Math.abs(delta) * 8));
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - (1 - t) ** 3;
      setDisplayPct(start + delta * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- animate toward target only
  }, [target]);

  const isIndeterminate = target == null || (indeterminate && (target ?? 0) === 0);
  const pctLabel = target != null ? `${Math.round(displayPct)}%` : '…';

  return (
    <div className={`iam-smooth-progress ${className}`.trim()} role="progressbar" aria-valuenow={target ?? undefined}>
      {showLabel && target != null ? (
        <div className="iam-smooth-progress__head">
          <span className="iam-smooth-progress__pct">{pctLabel}</span>
        </div>
      ) : null}
      <div
        className="iam-smooth-progress__track"
        style={{ height }}
        aria-hidden={!showLabel}
      >
        <div
          className={`iam-smooth-progress__fill${isIndeterminate ? ' iam-smooth-progress__fill--indeterminate' : ''}`}
          style={isIndeterminate ? undefined : { width: `${displayPct}%` }}
        />
      </div>
    </div>
  );
}
