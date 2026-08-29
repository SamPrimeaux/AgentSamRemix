import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Clock, Lightbulb, Loader2, NotebookPen, Pencil, Trash2, Users } from 'lucide-react';
import {
  createCalendarEvent,
  createTodo,
  createUserContact,
  createUserNote,
  deleteCalendarEvent,
  deleteTodo,
  deleteUserContact,
  deleteUserNote,
  fetchDayEvents,
  fetchPeople,
  fetchTodos,
  fetchUserNotes,
  fmtTime,
  formatTodoDue,
  isEditableCalendarEvent,
  parseEventDate,
  patchTodo,
  patchUserContact,
  patchUserNote,
  toDatetimeLocalValue,
  toSqlDatetime,
  updateCalendarEvent,
  type AgentTodo,
  type CalEvent,
  type CalendarPerson,
  type UserNote,
} from '../../../pages/launch-desk/ops-desk-types';
import type { CollaborateRailPanel } from '../../lib/collaborate/collaborateRailNav';

function isOpenTodo(todo: AgentTodo) {
  const s = String(todo.status || '').toLowerCase();
  return s !== 'done' && s !== 'completed' && s !== 'cancelled';
}

type PanelAction = { type: 'new-note' | 'new-contact'; at: number } | null;

type Props = {
  panel: CollaborateRailPanel;
  panelAction?: PanelAction;
  onPanelActionHandled?: () => void;
};

function defaultMeetingWindow() {
  const start = new Date();
  start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
  return { start: fmt(start), end: fmt(end) };
}

function contactInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

export function CollaborateRailPanels({ panel, panelAction, onPanelActionHandled }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [todos, setTodos] = useState<AgentTodo[]>([]);
  const [notes, setNotes] = useState<UserNote[]>([]);
  const [people, setPeople] = useState<CalendarPerson[]>([]);
  const [peopleQ, setPeopleQ] = useState('');
  const [draft, setDraft] = useState('');
  const [meetingTitle, setMeetingTitle] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [saving, setSaving] = useState(false);
  const [showContactForm, setShowContactForm] = useState(false);
  const [contactDraft, setContactDraft] = useState({
    display_name: '',
    username: '',
    email: '',
    phone: '',
    avatar_url: '',
    description: '',
  });
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [composingNote, setComposingNote] = useState(false);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteBody, setNoteBody] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (panel === 'calendar') {
        const rows = await fetchDayEvents(new Date());
        setEvents(rows);
      } else if (panel === 'keep') {
        const rows = await fetchTodos({ category: 'Keep' });
        setTodos(rows);
      } else if (panel === 'notes') {
        const rows = await fetchUserNotes();
        setNotes(rows);
      } else if (panel === 'contacts') {
        const rows = await fetchPeople(peopleQ);
        setPeople(rows);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [panel, peopleQ]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (panel !== 'contacts') return;
    const t = window.setTimeout(() => void reload(), 220);
    return () => window.clearTimeout(t);
  }, [peopleQ, panel, reload]);

  useEffect(() => {
    if (!panelAction) return;
    if (panelAction.type === 'new-note' && panel === 'notes') {
      setComposingNote(true);
      setNoteTitle('');
      setNoteBody('');
      setEditingId(null);
      onPanelActionHandled?.();
    }
    if (panelAction.type === 'new-contact' && panel === 'contacts') {
      setShowContactForm(true);
      setEditingContactId(null);
      setContactDraft({
        display_name: '',
        username: '',
        email: '',
        phone: '',
        avatar_url: '',
        description: '',
      });
      onPanelActionHandled?.();
    }
  }, [panel, panelAction, onPanelActionHandled]);

  const openTodos = useMemo(() => todos.filter(isOpenTodo), [todos]);

  const saveDraft = async (category: string) => {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      await createTodo({ title: text, category, notes: text });
      setDraft('');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const saveUserNote = async () => {
    const body = noteBody.trim();
    if (!body || saving) return;
    setSaving(true);
    try {
      if (editingId) {
        await patchUserNote(editingId, {
          title: noteTitle.trim() || body.split('\n')[0].slice(0, 120),
          body,
        });
        setEditingId(null);
      } else {
        await createUserNote({
          title: noteTitle.trim() || undefined,
          body,
        });
      }
      setComposingNote(false);
      setNoteTitle('');
      setNoteBody('');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save note');
    } finally {
      setSaving(false);
    }
  };

  const startEditNote = (note: UserNote) => {
    setEditingId(note.id);
    setNoteTitle(note.title || '');
    setNoteBody(note.body || '');
    setComposingNote(true);
  };

  const removeUserNote = async (note: UserNote) => {
    if (!window.confirm('Delete this note?')) return;
    setSaving(true);
    try {
      await deleteUserNote(note.id);
      if (editingId === note.id) {
        setEditingId(null);
        setComposingNote(false);
      }
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete');
    } finally {
      setSaving(false);
    }
  };

  const completeTodo = async (todo: AgentTodo) => {
    setSaving(true);
    try {
      await patchTodo(todo.id, { status: 'done' });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update');
    } finally {
      setSaving(false);
    }
  };

  const removeTodo = async (todo: AgentTodo) => {
    if (!window.confirm('Delete this item?')) return;
    setSaving(true);
    try {
      await deleteTodo(todo.id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (todo: AgentTodo) => {
    setEditingId(todo.id);
    setEditTitle(todo.title || '');
    setEditNotes(todo.notes || todo.description || '');
  };

  const saveEdit = async () => {
    if (!editingId || saving) return;
    setSaving(true);
    try {
      await patchTodo(editingId, {
        title: editTitle.trim(),
        notes: editNotes.trim(),
      });
      setEditingId(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const createMeeting = async () => {
    const title = meetingTitle.trim();
    if (!title || saving) return;
    setSaving(true);
    try {
      const { start, end } = defaultMeetingWindow();
      await createCalendarEvent({
        title,
        start_datetime: start,
        end_datetime: end,
        event_type: 'meeting',
      });
      setMeetingTitle('');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create meeting');
    } finally {
      setSaving(false);
    }
  };

  const startEditEvent = (ev: CalEvent) => {
    const start = parseEventDate(ev.start_datetime);
    const end = parseEventDate(ev.end_datetime);
    setEditingId(String(ev.id));
    setEditTitle(ev.title || '');
    setEditNotes(ev.description || '');
    setEditStart(Number.isNaN(start.getTime()) ? '' : toDatetimeLocalValue(start));
    setEditEnd(Number.isNaN(end.getTime()) ? '' : toDatetimeLocalValue(end));
  };

  const saveEventEdit = async () => {
    if (!editingId || saving) return;
    setSaving(true);
    try {
      await updateCalendarEvent(editingId, {
        title: editTitle.trim(),
        description: editNotes.trim() || null,
        start_datetime: editStart ? toSqlDatetime(editStart) : undefined,
        end_datetime: editEnd ? toSqlDatetime(editEnd) : undefined,
      });
      setEditingId(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update event');
    } finally {
      setSaving(false);
    }
  };

  const removeEvent = async (ev: CalEvent) => {
    if (!window.confirm('Delete this calendar event?')) return;
    setSaving(true);
    try {
      await deleteCalendarEvent(String(ev.id));
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete event');
    } finally {
      setSaving(false);
    }
  };

  const saveContact = async () => {
    const name = contactDraft.display_name.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      const payload = {
        display_name: name,
        username: contactDraft.username.trim() || undefined,
        email: contactDraft.email.trim() || undefined,
        phone: contactDraft.phone.trim() || undefined,
        avatar_url: contactDraft.avatar_url.trim() || undefined,
        description: contactDraft.description.trim() || undefined,
      };
      if (editingContactId) {
        await patchUserContact(editingContactId, payload);
      } else {
        await createUserContact(payload);
      }
      setShowContactForm(false);
      setEditingContactId(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save contact');
    } finally {
      setSaving(false);
    }
  };

  const startEditContact = (person: CalendarPerson) => {
    if (!person.id) return;
    setEditingContactId(person.id);
    setShowContactForm(true);
    setContactDraft({
      display_name: person.display_name || '',
      username: person.username || '',
      email: person.email || '',
      phone: person.phone || '',
      avatar_url: person.avatar_url || '',
      description: person.description || '',
    });
  };

  const removeContact = async (person: CalendarPerson) => {
    if (!person.id || !window.confirm('Delete this contact?')) return;
    setSaving(true);
    try {
      await deleteUserContact(person.id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete contact');
    } finally {
      setSaving(false);
    }
  };

  if (loading && panel === 'calendar' && events.length === 0 && !meetingTitle) {
    return (
      <div className="lib-rail-panel-body lib-rail-panel-loading">
        <Loader2 size={22} className="lib-rail-spin" strokeWidth={1.75} />
        <span>Loading calendar…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="lib-rail-panel-body">
        <p className="lib-rail-panel-error">{error}</p>
        <button type="button" className="lib-rail-open-btn" onClick={() => void reload()}>
          Retry
        </button>
      </div>
    );
  }

  if (panel === 'calendar') {
    const now = new Date();
    return (
      <div className="lib-rail-panel-body lib-rail-panel-body--calendar">
        <div className="lib-rail-cal-head">
          <strong>{now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</strong>
        </div>
        <label className="lib-rail-note-input">
          <Clock size={16} strokeWidth={1.75} />
          <input
            type="text"
            placeholder="New meeting title…"
            value={meetingTitle}
            onChange={(e) => setMeetingTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createMeeting();
            }}
          />
        </label>
        <button
          type="button"
          className="lib-rail-open-btn primary"
          disabled={!meetingTitle.trim() || saving}
          onClick={() => void createMeeting()}
        >
          Schedule 30 min
        </button>
        {events.length === 0 ? (
          <div className="lib-rail-empty compact">
            <Clock size={32} strokeWidth={1.5} className="lib-rail-empty-icon lib-rail-empty-icon--notes" />
            <p>No events today</p>
            <span className="lib-rail-panel-hint">Tasks and birthdays are hidden here — real calendar events only.</span>
          </div>
        ) : (
          <ul className="lib-rail-event-list">
            {events.map((ev) => {
              const start = parseEventDate(ev.start_datetime);
              const editable = isEditableCalendarEvent(ev);
              if (editingId === String(ev.id)) {
                return (
                  <li key={ev.id} className="lib-rail-event-edit">
                    <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="Title" />
                    <textarea value={editNotes} rows={2} onChange={(e) => setEditNotes(e.target.value)} placeholder="Description" />
                    <input type="datetime-local" value={editStart} onChange={(e) => setEditStart(e.target.value)} />
                    <input type="datetime-local" value={editEnd} onChange={(e) => setEditEnd(e.target.value)} />
                    <div className="lib-rail-note-actions">
                      <button type="button" className="lib-rail-icon-btn" onClick={() => void saveEventEdit()} aria-label="Save">
                        <Check size={14} />
                      </button>
                      <button type="button" className="lib-rail-icon-btn" onClick={() => setEditingId(null)} aria-label="Cancel">
                        ×
                      </button>
                    </div>
                  </li>
                );
              }
              return (
                <li key={ev.id} className="lib-rail-event-row">
                  <div>
                    <strong>{ev.title || 'Untitled'}</strong>
                    <span>{Number.isNaN(start.getTime()) ? '—' : fmtTime(start)}</span>
                    {ev.description ? <span className="lib-rail-note-meta">{ev.description}</span> : null}
                  </div>
                  {editable ? (
                    <div className="lib-rail-note-actions">
                      <button type="button" className="lib-rail-icon-btn" aria-label="Edit" onClick={() => startEditEvent(ev)}>
                        <Pencil size={14} />
                      </button>
                      <button type="button" className="lib-rail-icon-btn danger" aria-label="Delete" onClick={() => void removeEvent(ev)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  if (panel === 'keep') {
    return (
      <div className="lib-rail-panel-body">
        <label className="lib-rail-note-input">
          <Lightbulb size={16} strokeWidth={1.75} />
          <input
            type="text"
            placeholder="Take a note…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveDraft('Keep');
            }}
          />
        </label>
        {openTodos.length === 0 ? (
          <div className="lib-rail-empty compact">
            <Lightbulb size={36} strokeWidth={1.5} className="lib-rail-empty-icon lib-rail-empty-icon--keep" />
            <p>No keep notes yet</p>
          </div>
        ) : (
          <ul className="lib-rail-note-list">
            {openTodos.map((todo) => (
              <li key={todo.id} className="lib-rail-note-row">
                {editingId === todo.id ? (
                  <div className="lib-rail-note-edit">
                    <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                    <textarea value={editNotes} rows={2} onChange={(e) => setEditNotes(e.target.value)} />
                    <div className="lib-rail-note-actions">
                      <button type="button" className="lib-rail-icon-btn" onClick={() => void saveEdit()} aria-label="Save">
                        <Check size={14} />
                      </button>
                      <button type="button" className="lib-rail-icon-btn" onClick={() => setEditingId(null)} aria-label="Cancel">
                        ×
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button type="button" className="lib-rail-note-card" onClick={() => void completeTodo(todo)}>
                      <strong>{todo.title}</strong>
                      {todo.notes && todo.notes !== todo.title ? <span>{todo.notes}</span> : null}
                    </button>
                    <div className="lib-rail-note-actions">
                      <button type="button" className="lib-rail-icon-btn" aria-label="Edit" onClick={() => startEdit(todo)}>
                        <Pencil size={14} />
                      </button>
                      <button type="button" className="lib-rail-icon-btn danger" aria-label="Delete" onClick={() => void removeTodo(todo)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (panel === 'notes') {
    return (
      <div className="lib-rail-panel-body">
        <div className="lib-rail-panel-subhead">
          <NotebookPen size={16} strokeWidth={1.75} />
          <span>Personal notepad</span>
        </div>
        {composingNote ? (
          <div className="lib-rail-note-edit lib-rail-note-compose">
            <input value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} placeholder="Title (optional)" />
            <textarea
              value={noteBody}
              rows={5}
              onChange={(e) => setNoteBody(e.target.value)}
              placeholder="Write your note…"
              autoFocus
            />
            <div className="lib-rail-note-actions">
              <button type="button" className="lib-rail-open-btn primary" disabled={!noteBody.trim() || saving} onClick={() => void saveUserNote()}>
                Save
              </button>
              <button
                type="button"
                className="lib-rail-open-btn"
                onClick={() => {
                  setComposingNote(false);
                  setEditingId(null);
                  setNoteTitle('');
                  setNoteBody('');
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <label className="lib-rail-note-input">
            <NotebookPen size={16} strokeWidth={1.75} />
            <input
              type="text"
              placeholder="Quick add…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && draft.trim()) {
                  setNoteBody(draft.trim());
                  setComposingNote(true);
                  setDraft('');
                }
              }}
            />
          </label>
        )}
        {notes.length === 0 && !composingNote ? (
          <div className="lib-rail-empty compact">
            <NotebookPen size={36} strokeWidth={1.5} className="lib-rail-empty-icon lib-rail-empty-icon--notes" />
            <p>No notes yet</p>
            <span className="lib-rail-panel-hint">Tap + for a clean notepad entry — saved to your account in D1.</span>
          </div>
        ) : (
          <ul className="lib-rail-note-list">
            {notes.map((note) => (
              <li key={note.id} className="lib-rail-note-row">
                <div className="lib-rail-note-card static">
                  <strong>{note.title || 'Untitled'}</strong>
                  {note.body ? <span>{note.body}</span> : null}
                </div>
                <div className="lib-rail-note-actions">
                  <button type="button" className="lib-rail-icon-btn" aria-label="Edit" onClick={() => startEditNote(note)}>
                    <Pencil size={14} />
                  </button>
                  <button type="button" className="lib-rail-icon-btn danger" aria-label="Delete" onClick={() => void removeUserNote(note)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="lib-rail-panel-body">
      <label className="lib-rail-note-input">
        <Users size={16} strokeWidth={1.75} />
        <input
          type="search"
          placeholder="Search contacts…"
          value={peopleQ}
          onChange={(e) => setPeopleQ(e.target.value)}
        />
      </label>
      {showContactForm ? (
        <div className="lib-rail-contact-form">
          <input
            value={contactDraft.display_name}
            onChange={(e) => setContactDraft((d) => ({ ...d, display_name: e.target.value }))}
            placeholder="Full name *"
          />
          <input
            value={contactDraft.username}
            onChange={(e) => setContactDraft((d) => ({ ...d, username: e.target.value }))}
            placeholder="Username"
          />
          <input
            value={contactDraft.email}
            onChange={(e) => setContactDraft((d) => ({ ...d, email: e.target.value }))}
            placeholder="Email"
            type="email"
          />
          <input
            value={contactDraft.phone}
            onChange={(e) => setContactDraft((d) => ({ ...d, phone: e.target.value }))}
            placeholder="Phone"
          />
          <input
            value={contactDraft.avatar_url}
            onChange={(e) => setContactDraft((d) => ({ ...d, avatar_url: e.target.value }))}
            placeholder="Profile photo URL"
          />
          <textarea
            value={contactDraft.description}
            rows={2}
            onChange={(e) => setContactDraft((d) => ({ ...d, description: e.target.value }))}
            placeholder="Description / notes"
          />
          <div className="lib-rail-note-actions">
            <button type="button" className="lib-rail-open-btn primary" disabled={!contactDraft.display_name.trim() || saving} onClick={() => void saveContact()}>
              {editingContactId ? 'Update' : 'Save'}
            </button>
            <button type="button" className="lib-rail-open-btn" onClick={() => setShowContactForm(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {people.length === 0 && !showContactForm ? (
        <div className="lib-rail-empty compact">
          <Users size={36} strokeWidth={1.5} className="lib-rail-empty-icon lib-rail-empty-icon--contacts" />
          <p>No contacts yet</p>
          <span className="lib-rail-panel-hint">Add people with name, email, phone, and photo — yours only.</span>
        </div>
      ) : (
        <ul className="lib-rail-people-list">
          {people.map((p) => (
            <li key={p.id || p.email || p.display_name} className="lib-rail-contact-row">
              {p.avatar_url ? (
                <img src={p.avatar_url} alt="" className="lib-rail-contact-avatar" />
              ) : (
                <span className="lib-rail-contact-avatar lib-rail-contact-avatar--fallback" aria-hidden>
                  {contactInitials(p.display_name || p.email || '?')}
                </span>
              )}
              <div className="lib-rail-contact-copy">
                <strong>{p.display_name || p.username || 'Unnamed'}</strong>
                {p.username ? <span>@{p.username}</span> : null}
                {p.email ? <span>{p.email}</span> : null}
                {p.phone ? <span>{p.phone}</span> : null}
                {p.description ? <span className="lib-rail-note-meta">{p.description}</span> : null}
              </div>
              <div className="lib-rail-note-actions">
                <button type="button" className="lib-rail-icon-btn" aria-label="Edit" onClick={() => startEditContact(p)}>
                  <Pencil size={14} />
                </button>
                <button type="button" className="lib-rail-icon-btn danger" aria-label="Delete" onClick={() => void removeContact(p)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
