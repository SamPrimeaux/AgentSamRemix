import { useEffect, useMemo } from 'react';
import { useClock } from './useClock';

export interface CountdownProps {
  target: Date | string | number;
  className?: string;
  onComplete?: () => void;
}

function resolveTarget(target: CountdownProps['target']): Date {
  const date = target instanceof Date ? target : new Date(target);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function formatCountdown(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function Countdown({ target, className = '', onComplete }: CountdownProps) {
  const now = useClock();
  const end = useMemo(() => resolveTarget(target), [target]);
  const remaining = end.getTime() - now.getTime();
  const complete = remaining <= 0;

  useEffect(() => {
    if (complete) onComplete?.();
  }, [complete, onComplete]);

  return (
    <time className={className} dateTime={end.toISOString()} aria-label={complete ? 'Complete' : undefined}>
      {complete ? 'Complete' : formatCountdown(remaining)}
    </time>
  );
}
