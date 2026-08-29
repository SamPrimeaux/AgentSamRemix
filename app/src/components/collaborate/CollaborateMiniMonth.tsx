import type { CalEvent } from '../../../pages/launch-desk/ops-desk-types';
import { addDays, parseEventDate, sameDay, startOfWeek } from '../../../pages/launch-desk/ops-desk-types';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

type Props = {
  anchor: Date;
  events?: CalEvent[];
  onSelectDay: (day: Date) => void;
  onShiftMonth?: (delta: number) => void;
  className?: string;
};

function buildMiniMonth(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = startOfWeek(first);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i += 1) cells.push(addDays(start, i));
  return cells;
}

/** Compact 6-week month grid — used in header dropdown. */
export function CollaborateMiniMonth({
  anchor,
  events = [],
  onSelectDay,
  onShiftMonth,
  className,
}: Props) {
  const cells = buildMiniMonth(anchor);
  const title = anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div className={['colab-mini-month', className].filter(Boolean).join(' ')}>
      {onShiftMonth ? (
        <div className="colab-mini-month-head">
          <button
            type="button"
            className="colab-cal-circle-btn"
            aria-label="Previous month"
            onClick={() => onShiftMonth(-1)}
          >
            ‹
          </button>
          <span className="colab-mini-month-title">{title}</span>
          <button
            type="button"
            className="colab-cal-circle-btn"
            aria-label="Next month"
            onClick={() => onShiftMonth(1)}
          >
            ›
          </button>
        </div>
      ) : null}
      <div className="colab-mini-month-grid" role="grid" aria-label={title}>
        {WEEKDAY_LABELS.map((d, i) => (
          <span key={`wd-${i}`} className="colab-mini-month-dow" role="columnheader">
            {d}
          </span>
        ))}
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === anchor.getMonth();
          const active = sameDay(d, anchor);
          const hasEvent = events.some((ev) => sameDay(parseEventDate(ev.start_datetime), d));
          return (
            <button
              key={`d-${anchor.getFullYear()}-${anchor.getMonth()}-${i}`}
              type="button"
              role="gridcell"
              className={[
                'colab-mini-month-day',
                inMonth ? '' : 'is-outside',
                active ? 'is-active' : '',
                hasEvent ? 'has-event' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSelectDay(new Date(d.getFullYear(), d.getMonth(), d.getDate()))}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
