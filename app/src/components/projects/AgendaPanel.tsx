import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Clock3, Video } from "lucide-react";
import {
  type CalEvent,
  fetchDayEvents,
  fmtDayTitle,
  fmtTime,
  meetRoomId,
  parseEventDate,
} from "../../../pages/launch-desk/ops-desk-types";

function todayDate() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function AgendaPanel() {
  const day = useMemo(() => todayDate(), []);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchDayEvents(day);
      setEvents(rows.slice(0, 6));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [day]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    let meetings = 0;
    for (const ev of events) {
      if (meetRoomId(ev) || ev.event_type === "meeting") meetings += 1;
    }
    return { total: events.length, meetings };
  }, [events]);

  return (
    <section className="flex h-[248px] flex-col overflow-hidden rounded-2xl border border-[var(--dashboard-border)] bg-[var(--dashboard-card)]/90">
      <div className="shrink-0 border-b border-[var(--dashboard-border)] px-5 py-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-cyan-300" />
          <h2 className="text-sm font-semibold text-[var(--dashboard-text)]">Agenda</h2>
        </div>
        <p className="mt-0.5 text-xs text-[var(--dashboard-muted)]">{fmtDayTitle(day)}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-5 py-2">
        {error ? <div className="text-sm text-rose-200">{error}</div> : null}
        {loading ? (
          <div className="text-sm text-[var(--dashboard-muted)]">Loading…</div>
        ) : !events.length ? (
          <p className="text-sm text-[var(--dashboard-muted)]">Nothing scheduled today.</p>
        ) : (
          <>
            <p className="mb-2 text-[11px] text-[var(--dashboard-muted)]">
              {stats.total} event{stats.total === 1 ? "" : "s"}
              {stats.meetings > 0 ? ` · ${stats.meetings} meeting${stats.meetings === 1 ? "" : "s"}` : ""}
            </p>
            <ul className="space-y-1.5">
              {events.map((ev) => {
                const start = parseEventDate(ev.start_datetime);
                const isMeet = Boolean(meetRoomId(ev) || ev.event_type === "meeting");
                return (
                  <li key={ev.id}>
                    <div className="flex items-center gap-2 rounded-lg border border-transparent px-1 py-1">
                      <span className="flex w-14 shrink-0 items-center gap-1 text-[11px] tabular-nums text-[var(--dashboard-muted)]">
                        <Clock3 className="h-3 w-3 shrink-0" />
                        {Number.isNaN(start.getTime()) ? "—" : fmtTime(start)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-[var(--dashboard-text)]">{ev.title}</span>
                      {isMeet ? <Video className="h-3.5 w-3.5 shrink-0 text-cyan-300/80" aria-hidden /> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--dashboard-border)] px-5 py-2">
        <Link to="/dashboard/collaborate" className="text-xs font-medium text-cyan-300 hover:text-cyan-200">
          Open Launch Desk →
        </Link>
      </div>
    </section>
  );
}
