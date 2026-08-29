import { useMemo } from 'react';
import { useClock } from './useClock';
import './time.css';

export interface ClockProps {
  timeZone?: string;
  locale?: string;
  showDate?: boolean;
  showSeconds?: boolean;
  className?: string;
  now?: Date;
}

function formatClock(
  date: Date,
  {
    timeZone,
    locale,
    showDate = false,
    showSeconds = false,
  }: Pick<ClockProps, 'timeZone' | 'locale' | 'showDate' | 'showSeconds'>,
) {
  const options: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
    ...(showSeconds ? { second: '2-digit' } : {}),
    ...(showDate
      ? { weekday: 'short', month: 'short', day: 'numeric' }
      : {}),
    ...(timeZone ? { timeZone } : {}),
  };

  try {
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, {
      ...options,
      timeZone: undefined,
    }).format(date);
  }
}

export function Clock({
  timeZone,
  locale,
  showDate = false,
  showSeconds = false,
  className = '',
  now,
}: ClockProps) {
  const currentTime = useClock({ initialTime: now });
  const value = useMemo(
    () => formatClock(currentTime, { timeZone, locale, showDate, showSeconds }),
    [currentTime, locale, showDate, showSeconds, timeZone],
  );

  return (
    <time className={`iam-time-chip ${className}`.trim()} dateTime={currentTime.toISOString()}>
      <span className="iam-time-chip__orb" aria-hidden="true" />
      <span className="iam-time-chip__content">
        <span className="iam-time-chip__value">{value}</span>
        {timeZone ? <span className="iam-time-chip__detail">{timeZone}</span> : null}
      </span>
    </time>
  );
}
