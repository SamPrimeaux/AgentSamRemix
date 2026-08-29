import { useMemo } from 'react';
import { useClock } from './useClock';

export interface RelativeTimeProps {
  value: Date | string | number;
  locale?: string;
  className?: string;
  live?: boolean;
}

function toDate(value: RelativeTimeProps['value']): Date {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function formatRelativeTime(date: Date, now: Date, locale?: string): string {
  const seconds = (date.getTime() - now.getTime()) / 1_000;
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_629_800],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
    ['second', 1],
  ];
  const [unit, size] = units.find(([, unitSize]) => Math.abs(seconds) >= unitSize) ?? units.at(-1)!;
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
    Math.round(seconds / size),
    unit,
  );
}

export function RelativeTime({
  value,
  locale,
  className = '',
  live = true,
}: RelativeTimeProps) {
  const now = useClock({ intervalMs: live ? 30_000 : 0 });
  const date = useMemo(() => toDate(value), [value]);
  const label = useMemo(
    () => formatRelativeTime(date, now, locale),
    [date, locale, now],
  );

  return (
    <time className={className} dateTime={date.toISOString()}>
      {label}
    </time>
  );
}
