import React from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar,
  ChevronLeft,
  Clock,
  Copy,
  MapPin,
  Trash2,
  Users,
  Video,
} from 'lucide-react';
import {
  CalEvent,
  fmtDateTime,
  fmtDayTitle,
  meetRoomId,
  parseAttendees,
  parseEventDate,
} from './ops-desk-types';

interface OpsDeskEventViewProps {
  event: CalEvent;
  onBack: () => void;
  onComplete: (id: string) => void;
  onDelete: (id: string) => void;
}

export function OpsDeskEventView({ event, onBack, onComplete, onDelete }: OpsDeskEventViewProps) {
  const start = parseEventDate(event.start_datetime);
  const end = parseEventDate(event.end_datetime);
  const room = meetRoomId(event);
  const attendees = parseAttendees(event.attendees);
  const isMeeting = Boolean(room) || event.event_type === 'meeting';
  const joinUrl = room ? `/dashboard/meet?room=${encodeURIComponent(room)}` : null;

  const copyJoinLink = () => {
    if (!joinUrl || typeof window === 'undefined') return;
    const full = `${window.location.origin}${joinUrl}`;
    void navigator.clipboard?.writeText(full);
  };

  return (
    <div className="ops-desk-event-page">
      <div className="ops-desk-event-toolbar">
        <button type="button" className="ops-desk-btn ops-desk-back-btn" onClick={onBack}>
          <ChevronLeft size={14} />
          Back to day
        </button>
      </div>

      <div className="ops-desk-event-layout">
        <header className="ops-desk-event-hero">
          <div className="ops-desk-event-hero-top">
            {event.status ? <span className={`ops-desk-badge ${event.status}`}>{event.status}</span> : null}
            {isMeeting ? <span className="ops-desk-event-type-pill">Meeting</span> : <span className="ops-desk-event-type-pill muted">Event</span>}
          </div>
          <h2>{event.title}</h2>
          <p className="ops-desk-event-date-line">
            <Calendar size={14} />
            {fmtDayTitle(start)}
          </p>
        </header>

        <div className="ops-desk-event-grid">
          <section className="ops-desk-event-panel">
            <h3>Schedule</h3>
            <div className="ops-desk-event-fact">
              <Clock size={15} />
              <div>
                <strong>{fmtDateTime(start)}</strong>
                <span>to {fmtDateTime(end)}</span>
              </div>
            </div>
            {event.location ? (
              <div className="ops-desk-event-fact">
                <MapPin size={15} />
                <div>
                  <strong>Location</strong>
                  <span>{event.location}</span>
                </div>
              </div>
            ) : null}
            {attendees.length > 0 ? (
              <div className="ops-desk-event-fact">
                <Users size={15} />
                <div>
                  <strong>Invited ({attendees.length})</strong>
                  <ul className="ops-desk-event-attendees">
                    {attendees.map((email) => (
                      <li key={email}>{email}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
          </section>

          <section className="ops-desk-event-panel">
            <h3>Details</h3>
            {event.description ? (
              <p className="ops-desk-event-description">{event.description}</p>
            ) : (
              <p className="ops-desk-event-muted">No description added.</p>
            )}
            {room ? (
              <div className="ops-desk-event-meet-block">
                <Video size={18} />
                <div>
                  <strong>RealtimeKit room</strong>
                  <code className="ops-desk-event-room-id">{room}</code>
                </div>
              </div>
            ) : null}
          </section>
        </div>

        <footer className="ops-desk-event-actions">
          {joinUrl ? (
            <>
              <Link to={joinUrl} className="ops-desk-btn ops-desk-btn-primary ops-desk-event-join">
                <Video size={14} />
                Join meeting
              </Link>
              <button type="button" className="ops-desk-btn" onClick={copyJoinLink}>
                <Copy size={14} />
                Copy join link
              </button>
            </>
          ) : null}
          <button type="button" className="ops-desk-btn" onClick={() => onComplete(event.id)}>
            Mark completed
          </button>
          <button type="button" className="ops-desk-btn ops-desk-btn-danger" onClick={() => onDelete(event.id)}>
            <Trash2 size={14} />
            Delete
          </button>
        </footer>
      </div>
    </div>
  );
}
