import React, { useMemo } from 'react';
import { CalendarPlus, ChevronLeft, ChevronRight, Clock, MapPin, Users, Video } from 'lucide-react';
import {
  CalEvent,
  fmtDayTitle,
  fmtTime,
  meetRoomId,
  parseAttendees,
  parseEventDate,
  sameDay,
} from './ops-desk-types';

const HOURS = Array.from({ length: 16 }, (_, i) => i + 6);

interface OpsDeskDayViewProps {
  day: Date;
  events: CalEvent[];
  loading: boolean;
  onBack: () => void;
  onPrevDay: () => void;
  onNextDay: () => void;
  onOpenEvent: (ev: CalEvent) => void;
  onAddEvent: (start: Date) => void;
  onScheduleMeeting: (start: Date) => void;
}

export function OpsDeskDayView({
  day,
  events,
  loading,
  onBack,
  onPrevDay,
  onNextDay,
  onOpenEvent,
  onAddEvent,
  onScheduleMeeting,
}: OpsDeskDayViewProps) {
  const now = new Date();
  const isToday = sameDay(day, now);

  const stats = useMemo(() => {
    let meetings = 0;
    for (const ev of events) {
      if (meetRoomId(ev) || ev.event_type === 'meeting') meetings += 1;
    }
    return { total: events.length, meetings };
  }, [events]);

  const eventsByHour = useMemo(() => {
    const map = new Map<number, CalEvent[]>();
    for (const ev of events) {
      const h = parseEventDate(ev.start_datetime).getHours();
      const list = map.get(h) ?? [];
      list.push(ev);
      map.set(h, list);
    }
    return map;
  }, [events]);

  const defaultStart = () => {
    const d = new Date(day);
    d.setHours(9, 0, 0, 0);
    return d;
  };

  return (
    <div className="ops-desk-day">
      <div className="ops-desk-day-toolbar">
        <button type="button" className="ops-desk-btn ops-desk-back-btn" onClick={onBack}>
          <ChevronLeft size={14} />
          Calendar
        </button>
        <div className="ops-desk-day-nav">
          <button type="button" className="ops-desk-btn" aria-label="Previous day" onClick={onPrevDay}>
            <ChevronLeft size={14} />
          </button>
          <div className="ops-desk-day-title-wrap">
            <h2 className="ops-desk-day-title">{fmtDayTitle(day)}</h2>
            {isToday ? <span className="ops-desk-day-today-pill">Today</span> : null}
          </div>
          <button type="button" className="ops-desk-btn" aria-label="Next day" onClick={onNextDay}>
            <ChevronRight size={14} />
          </button>
        </div>
        <div className="ops-desk-day-actions">
          <button type="button" className="ops-desk-btn" onClick={() => onAddEvent(defaultStart())}>
            <CalendarPlus size={14} />
            Add event
          </button>
          <button type="button" className="ops-desk-btn ops-desk-btn-primary" onClick={() => onScheduleMeeting(defaultStart())}>
            <Video size={14} />
            Schedule meeting
          </button>
        </div>
      </div>

      <div className="ops-desk-day-stats">
        <span>{stats.total} event{stats.total === 1 ? '' : 's'}</span>
        <span className="ops-desk-day-stat-dot" aria-hidden="true" />
        <span>{stats.meetings} meeting{stats.meetings === 1 ? '' : 's'}</span>
      </div>

      {loading ? (
        <div className="ops-desk-day-loading">
          <div className="w-8 h-8 border-2 border-[var(--solar-cyan)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="ops-desk-day-layout">
          <section className="ops-desk-day-timeline" aria-label="Hourly timeline">
            {HOURS.map((h) => {
              const slotStart = new Date(day);
              slotStart.setHours(h, 0, 0, 0);
              const hourEvs = eventsByHour.get(h) ?? [];
              const label = h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`;
              return (
                <div
                  key={h}
                  className="ops-desk-day-hour-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => onAddEvent(slotStart)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onAddEvent(slotStart); }}
                >
                  <div className="ops-desk-day-hour-label">{label}</div>
                  <div className="ops-desk-day-hour-track">
                    {hourEvs.length === 0 ? (
                      <span className="ops-desk-day-hour-empty">Click to add</span>
                    ) : (
                      hourEvs.map((ev) => (
                        <button
                          key={ev.id}
                          type="button"
                          className={`ops-desk-day-hour-event ${meetRoomId(ev) ? 'meeting' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenEvent(ev);
                          }}
                        >
                          {ev.title}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </section>

          <section className="ops-desk-day-agenda" aria-label="Day agenda">
            <h3 className="ops-desk-day-agenda-head">Agenda</h3>
            {events.length === 0 ? (
              <div className="ops-desk-day-empty">
                <p>Nothing scheduled for this day.</p>
                <button type="button" className="ops-desk-btn ops-desk-btn-primary" onClick={() => onScheduleMeeting(defaultStart())}>
                  Schedule your first meeting
                </button>
              </div>
            ) : (
              <div className="ops-desk-day-cards">
                {events.map((ev) => {
                  const start = parseEventDate(ev.start_datetime);
                  const end = parseEventDate(ev.end_datetime);
                  const room = meetRoomId(ev);
                  const attendees = parseAttendees(ev.attendees);
                  const isMeeting = Boolean(room) || ev.event_type === 'meeting';
                  return (
                    <article
                      key={ev.id}
                      className={`ops-desk-day-card ${isMeeting ? 'meeting' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpenEvent(ev)}
                      onKeyDown={(e) => { if (e.key === 'Enter') onOpenEvent(ev); }}
                    >
                      <div className="ops-desk-day-card-time">
                        <Clock size={13} />
                        {fmtTime(start)} – {fmtTime(end)}
                      </div>
                      <h4>{ev.title}</h4>
                      {ev.status ? <span className={`ops-desk-badge ${ev.status}`}>{ev.status}</span> : null}
                      {ev.description ? <p className="ops-desk-day-card-desc">{ev.description}</p> : null}
                      <div className="ops-desk-day-card-meta">
                        {isMeeting ? (
                          <span><Video size={12} /> Video call</span>
                        ) : null}
                        {ev.location ? (
                          <span><MapPin size={12} /> {ev.location}</span>
                        ) : null}
                        {attendees.length > 0 ? (
                          <span><Users size={12} /> {attendees.length} invite{attendees.length === 1 ? '' : 's'}</span>
                        ) : null}
                      </div>
                      <div className="ops-desk-day-card-foot">
                        <span className="ops-desk-day-card-link">View details →</span>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
