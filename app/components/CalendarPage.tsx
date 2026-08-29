import React, { useState, useEffect, useCallback, useRef } from 'react';

type CalView = 'day' | 'week' | 'month' | 'year';

interface CalEvent {
  id: string;
  title: string;
  description?: string;
  location?: string;
  start_datetime: string;
  end_datetime: string;
  color?: string;
  status?: string;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function fmtTime(d: Date) { return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
function fmtDateTime(d: Date) { return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }); }

export const CalendarPage: React.FC = () => {
  const [view, setView] = useState<CalView>('month');
  const [date, setDate] = useState(new Date());
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailEvent, setDetailEvent] = useState<CalEvent | null>(null);
  const [newModal, setNewModal] = useState<{ start: string; end: string } | null>(null);
  const viewRef = useRef<HTMLDivElement>(null);

  const fetchEvents = useCallback(() => {
    setLoading(true);
    fetch('/api/calendar/view/' + view, { credentials: 'include' })
      .then(r => r.json())
      .then(data => { setEvents(data?.events ?? []); setLoading(false); })
      .catch(() => { setEvents([]); setLoading(false); });
  }, [view]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const eventsForDay = (d: Date) => events.filter(e => sameDay(new Date(e.start_datetime), d));

  const navigate = (dir: 1 | -1) => {
    setDate(prev => {
      const d = new Date(prev);
      if (view === 'day') d.setDate(d.getDate() + dir);
      else if (view === 'week') d.setDate(d.getDate() + 7 * dir);
      else if (view === 'month') d.setMonth(d.getMonth() + dir);
      else d.setFullYear(d.getFullYear() + dir);
      return d;
    });
  };

  const titleText = () => {
    if (view === 'day') return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    if (view === 'week') {
      const s = new Date(date); s.setDate(date.getDate() - date.getDay());
      const e = new Date(s); e.setDate(s.getDate() + 6);
      return s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' – ' + e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    if (view === 'month') return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    return date.getFullYear().toString();
  };

  const openNew = (start: Date) => {
    const end = new Date(start.getTime() + 3600000);
    setNewModal({ start: start.toISOString().slice(0, 16), end: end.toISOString().slice(0, 16) });
  };

  const submitNew = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fetch('/api/calendar/events', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: fd.get('title'), description: fd.get('description'),
        location: fd.get('location'),
        start_datetime: fd.get('start') ? new Date(fd.get('start') as string).toISOString().slice(0,19).replace('T',' ') : null,
        end_datetime: fd.get('end') ? new Date(fd.get('end') as string).toISOString().slice(0,19).replace('T',' ') : null,
      })
    }).then(r => r.json()).then(d => { if (d?.success) { setNewModal(null); fetchEvents(); } });
  };

  const updateStatus = (id: string, status: string) => {
    fetch('/api/calendar/events/' + id, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    }).then(() => { setDetailEvent(prev => prev ? { ...prev, status } : prev); fetchEvents(); });
  };

  const deleteEvent = (id: string) => {
    if (!confirm('Delete this event?')) return;
    fetch('/api/calendar/events/' + id, { method: 'DELETE', credentials: 'include' })
      .then(() => { setDetailEvent(null); fetchEvents(); });
  };

  const EventChip: React.FC<{ event: CalEvent }> = ({ event }) => {
    const color = event.color || '#3b82f6';
    return (
      <div onClick={e => { e.stopPropagation(); setDetailEvent(event); }}
        className="text-[10px] px-1 py-0.5 mb-0.5 rounded-sm cursor-pointer truncate border-l-2 overflow-hidden"
        style={{ background: color + '22', borderLeftColor: color, color: 'var(--text-main)' }}>
        {event.title}
      </div>
    );
  };

  const MonthView = () => {
    const first = new Date(date.getFullYear(), date.getMonth(), 1);
    const start = new Date(first); start.setDate(first.getDate() - first.getDay());
    const today = new Date();
    const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
    return (
      <div className="flex-1 min-h-0 overflow-hidden rounded-xl border border-[var(--border-subtle)] flex flex-col">
        <div className="grid grid-cols-7 shrink-0">
          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
            <div key={d} className="text-[11px] font-semibold text-muted text-center py-2 border-b border-r border-[var(--border-subtle)] bg-[var(--bg-panel)]">{d}</div>
          ))}
        </div>
        <div className="flex-1 min-h-0 overflow-hidden grid grid-cols-7 grid-rows-6">
          {days.map((day, i) => {
            const isCurrentMonth = day.getMonth() === date.getMonth();
            const isToday = sameDay(day, today);
            const dayEvs = eventsForDay(day);
            return (
              <div key={i} onClick={() => openNew(new Date(day.setHours(9,0,0,0)))}
                className={`border-r border-b border-[var(--border-subtle)] p-1 cursor-pointer min-h-0 overflow-hidden flex flex-col
                  ${isCurrentMonth ? 'bg-[var(--bg-panel)]' : 'bg-[var(--bg-app)]'}
                  hover:bg-[var(--bg-hover)] transition-colors`}>
                <div className={`text-[11px] font-semibold w-5 h-5 flex items-center justify-center rounded-full mb-0.5 shrink-0
                  ${isToday ? 'bg-[var(--solar-cyan)] text-black' : isCurrentMonth ? 'text-main' : 'text-muted'}`}>
                  {day.getDate()}
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                  {dayEvs.slice(0, 3).map(ev => <EventChip key={ev.id} event={ev} />)}
                  {dayEvs.length > 3 && <div className="text-[9px] text-muted">+{dayEvs.length - 3}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const WeekView = () => {
    const start = new Date(date); start.setDate(date.getDate() - date.getDay());
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
    const today = new Date();
    const hours = Array.from({ length: 24 }, (_, i) => i);
    return (
      <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-[var(--border-subtle)]">
        <div className="grid min-w-[600px]" style={{ gridTemplateColumns: '48px repeat(7, 1fr)' }}>
          <div className="h-8 border-b border-r border-[var(--border-subtle)] bg-[var(--bg-panel)]" />
          {days.map((d, i) => (
            <div key={i} className={`h-8 border-b border-r border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[11px] font-semibold text-center pt-1.5
              ${sameDay(d, today) ? 'text-[var(--solar-cyan)]' : 'text-muted'}`}>
              {d.toLocaleDateString('en-US', { weekday: 'short' })} {d.getDate()}
            </div>
          ))}
          {hours.map(h => (
            <React.Fragment key={h}>
              <div className="h-14 border-b border-r border-[var(--border-subtle)] bg-[var(--bg-app)] text-[10px] text-muted text-right pr-1 pt-0.5">
                {h === 0 ? '12A' : h < 12 ? h + 'A' : h === 12 ? '12P' : (h - 12) + 'P'}
              </div>
              {days.map((d, di) => {
                const cellEvs = events.filter(e => { const ed = new Date(e.start_datetime); return sameDay(ed, d) && ed.getHours() === h; });
                return (
                  <div key={di} onClick={() => { const s = new Date(d); s.setHours(h,0,0,0); openNew(s); }}
                    className="h-14 border-b border-r border-[var(--border-subtle)] bg-[var(--bg-panel)] hover:bg-[var(--bg-hover)] cursor-pointer p-0.5 overflow-hidden">
                    {cellEvs.map(ev => <EventChip key={ev.id} event={ev} />)}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    );
  };

  const DayView = () => {
    const blocks = Array.from({ length: 12 }, (_, i) => ({ h1: i * 2, h2: i * 2 + 2 }));
    const dayEvs = eventsForDay(date);
    return (
      <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-[var(--border-subtle)]">
        <div className="grid grid-cols-4 min-h-full">
          {blocks.map(({ h1, h2 }) => {
            const label = (h1 === 0 ? '12' : h1 > 12 ? h1 - 12 : h1) + (h1 < 12 ? 'AM' : 'PM') + '–' + (h2 > 12 ? h2 - 12 : h2) + (h2 <= 12 ? 'AM' : 'PM');
            const blockEvs = dayEvs.filter(e => { const h = new Date(e.start_datetime).getHours(); return h >= h1 && h < h2; });
            return (
              <div key={h1} onClick={() => { const s = new Date(date); s.setHours(h1,0,0,0); openNew(s); }}
                className="border-r border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] hover:bg-[var(--bg-hover)] cursor-pointer min-h-[100px] p-1 flex flex-col">
                <div className="text-[10px] font-semibold text-muted mb-1 shrink-0">{label}</div>
                <div className="flex-1 min-h-0">{blockEvs.map(ev => <EventChip key={ev.id} event={ev} />)}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const YearView = () => {
    return (
      <div className="flex-1 min-h-0 overflow-hidden grid grid-cols-4 grid-rows-3 gap-0 rounded-xl border border-[var(--border-subtle)]">
        {Array.from({ length: 12 }, (_, m) => {
          const mDate = new Date(date.getFullYear(), m, 1);
          const count = events.filter(e => { const ed = new Date(e.start_datetime); return ed.getFullYear() === date.getFullYear() && ed.getMonth() === m; }).length;
          return (
            <div key={m} onClick={() => { setDate(new Date(date.getFullYear(), m, 1)); setView('month'); }}
              className="border-r border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] hover:bg-[var(--bg-hover)] cursor-pointer p-3 flex flex-col min-h-0">
              <div className="text-[13px] font-semibold text-main mb-1">
                {mDate.toLocaleDateString('en-US', { month: 'long' })}
              </div>
              <div className="grid grid-cols-7 gap-px flex-1 min-h-0">
                {['S','M','T','W','T','F','S'].map((l, i) => <span key={i} className="text-[8px] text-muted text-center">{l}</span>)}
                {Array.from({ length: mDate.getDay() }, (_, i) => <span key={'e'+i} />)}
                {Array.from({ length: new Date(date.getFullYear(), m + 1, 0).getDate() }, (_, i) => (
                  <span key={i} className="text-[9px] text-main text-center">{i + 1}</span>
                ))}
              </div>
              <div className="text-[10px] text-muted mt-1 shrink-0">{count} event{count !== 1 ? 's' : ''}</div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full min-h-0 p-3 gap-2">
      {/* Controls */}
      <div className="flex items-center justify-between shrink-0 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button onClick={() => setDate(new Date())} className="px-3 py-1.5 text-[13px] font-medium rounded-md border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-main hover:bg-[var(--bg-hover)] transition-colors">Today</button>
          <button onClick={() => navigate(-1)} className="px-2.5 py-1.5 text-[13px] rounded-md border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-main hover:bg-[var(--bg-hover)] transition-colors">&lt;</button>
          <button onClick={() => navigate(1)} className="px-2.5 py-1.5 text-[13px] rounded-md border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-main hover:bg-[var(--bg-hover)] transition-colors">&gt;</button>
          <span className="text-[15px] font-semibold text-main min-w-[180px]">{titleText()}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md overflow-hidden border border-[var(--border-subtle)]">
            {(['day','week','month','year'] as CalView[]).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 text-[12px] font-medium capitalize border-r border-[var(--border-subtle)] last:border-r-0 transition-colors
                  ${view === v ? 'bg-[var(--solar-cyan)] text-black' : 'bg-[var(--bg-panel)] text-muted hover:text-main hover:bg-[var(--bg-hover)]'}`}>
                {v}
              </button>
            ))}
          </div>
          <button onClick={() => openNew(new Date())}
            className="px-3 py-1.5 text-[13px] font-medium rounded-md bg-[var(--solar-cyan)] text-black hover:opacity-90 transition-opacity">
            + New Event
          </button>
        </div>
      </div>

      {/* Calendar body */}
      <div ref={viewRef} className="flex-1 min-h-0 flex flex-col">
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-[var(--solar-cyan)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {view === 'month' && <MonthView />}
            {view === 'week' && <WeekView />}
            {view === 'day' && <DayView />}
            {view === 'year' && <YearView />}
          </>
        )}
      </div>

      {/* Detail modal */}
      {detailEvent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6" onClick={() => setDetailEvent(null)}>
          <div className="bg-[var(--bg-panel)] rounded-xl max-w-md w-full border border-[var(--border-subtle)] shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between p-5 border-b border-[var(--border-subtle)]">
              <h2 className="text-[18px] font-semibold text-main">{detailEvent.title}</h2>
              <button onClick={() => setDetailEvent(null)} className="text-muted hover:text-main text-lg leading-none">&times;</button>
            </div>
            <div className="p-5 space-y-3">
              {detailEvent.status && (
                <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium
                  ${detailEvent.status === 'completed' ? 'bg-green-500/20 text-green-400' : detailEvent.status === 'missed' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-[var(--solar-cyan)]/20 text-[var(--solar-cyan)]'}`}>
                  {detailEvent.status}
                </span>
              )}
              {detailEvent.description && <p className="text-[13px] text-main">{detailEvent.description}</p>}
              <div className="text-[12px] text-muted">Start: <span className="text-main">{fmtDateTime(new Date(detailEvent.start_datetime))}</span></div>
              <div className="text-[12px] text-muted">End: <span className="text-main">{fmtDateTime(new Date(detailEvent.end_datetime))}</span></div>
              {detailEvent.location && <div className="text-[12px] text-muted">Location: <span className="text-main">{detailEvent.location}</span></div>}
            </div>
            <div className="flex flex-wrap gap-2 p-4 border-t border-[var(--border-subtle)]">
              <button onClick={() => updateStatus(detailEvent.id, 'completed')} className="px-3 py-1.5 text-[12px] font-medium rounded-md bg-green-600 text-white hover:bg-green-500">Mark completed</button>
              <button onClick={() => updateStatus(detailEvent.id, 'missed')} className="px-3 py-1.5 text-[12px] font-medium rounded-md bg-yellow-600 text-white hover:bg-yellow-500">Mark missed</button>
              <button onClick={() => deleteEvent(detailEvent.id)} className="px-3 py-1.5 text-[12px] font-medium rounded-md bg-red-600 text-white hover:bg-red-500">Delete</button>
              <button onClick={() => setDetailEvent(null)} className="px-3 py-1.5 text-[12px] font-medium rounded-md bg-[var(--bg-hover)] text-main">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* New event modal */}
      {newModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6" onClick={() => setNewModal(null)}>
          <div className="bg-[var(--bg-panel)] rounded-xl max-w-md w-full border border-[var(--border-subtle)] shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)]">
              <h2 className="text-[18px] font-semibold text-main">New Event</h2>
              <button onClick={() => setNewModal(null)} className="text-muted hover:text-main text-lg leading-none">&times;</button>
            </div>
            <form onSubmit={submitNew} className="p-5 space-y-3">
              <div><label className="block text-[11px] font-medium text-muted mb-1">Title *</label>
                <input name="title" required placeholder="Event title" className="w-full px-3 py-2 text-[13px] rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] text-main outline-none focus:border-[var(--solar-cyan)]" /></div>
              <div><label className="block text-[11px] font-medium text-muted mb-1">Description</label>
                <textarea name="description" rows={2} className="w-full px-3 py-2 text-[13px] rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] text-main outline-none focus:border-[var(--solar-cyan)] resize-none" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-[11px] font-medium text-muted mb-1">Start *</label>
                  <input name="start" type="datetime-local" required defaultValue={newModal.start} className="w-full px-3 py-2 text-[12px] rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] text-main outline-none focus:border-[var(--solar-cyan)]" /></div>
                <div><label className="block text-[11px] font-medium text-muted mb-1">End *</label>
                  <input name="end" type="datetime-local" required defaultValue={newModal.end} className="w-full px-3 py-2 text-[12px] rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] text-main outline-none focus:border-[var(--solar-cyan)]" /></div>
              </div>
              <div><label className="block text-[11px] font-medium text-muted mb-1">Location</label>
                <input name="location" placeholder="Optional" className="w-full px-3 py-2 text-[13px] rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] text-main outline-none focus:border-[var(--solar-cyan)]" /></div>
              <div className="flex gap-2 pt-1">
                <button type="submit" className="px-4 py-2 text-[13px] font-medium rounded-md bg-[var(--solar-cyan)] text-black hover:opacity-90">Create Event</button>
                <button type="button" onClick={() => setNewModal(null)} className="px-4 py-2 text-[13px] font-medium rounded-md bg-[var(--bg-hover)] text-main">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
