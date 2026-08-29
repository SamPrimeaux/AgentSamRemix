import { useEffect, useState } from 'react';

export interface UseClockOptions {
  intervalMs?: number;
  initialTime?: Date;
}

export function useClock({
  intervalMs = 1_000,
  initialTime,
}: UseClockOptions = {}): Date {
  const [now, setNow] = useState(() => initialTime ?? new Date());

  useEffect(() => {
    if (intervalMs <= 0) return undefined;

    const tick = () => setNow(new Date());
    tick();
    const timer = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}
