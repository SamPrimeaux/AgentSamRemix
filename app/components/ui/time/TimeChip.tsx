import type { ButtonHTMLAttributes } from 'react';
import { Clock, type ClockProps } from './Clock';

export interface TimeChipProps
  extends Omit<ClockProps, 'className'>,
    Pick<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'disabled' | 'title'> {
  className?: string;
  quiet?: boolean;
}

export function TimeChip({
  className = '',
  quiet = false,
  onClick,
  disabled = false,
  title,
  ...clockProps
}: TimeChipProps) {
  const classes = [quiet ? 'iam-time-chip--quiet' : '', className].filter(Boolean).join(' ');

  if (!onClick) return <Clock {...clockProps} className={classes} />;

  return (
    <button
      type="button"
      className={`iam-time-chip ${classes}`.trim()}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
    >
      <Clock {...clockProps} className="iam-time-chip--quiet" />
    </button>
  );
}
