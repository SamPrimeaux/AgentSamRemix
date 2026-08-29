import { useEffect, useRef, useState } from 'react';
import { Calendar, ClipboardList, Lightbulb, NotebookPen, Plus } from 'lucide-react';
import { createCalendarEvent, createTodo, createUserNote } from '../../../pages/launch-desk/ops-desk-types';
import type { CollaborateRailPanel } from '../../lib/collaborate/collaborateRailNav';

type QuickKind = 'note' | 'keep' | 'task' | 'meeting' | 'plan';

type Props = {
  onCreated?: (kind: QuickKind) => void;
  onOpenPanel?: (panel: CollaborateRailPanel) => void;
};

const ITEMS: { kind: QuickKind; label: string; hint: string; icon: typeof NotebookPen; panel?: CollaborateRailPanel }[] = [
  { kind: 'note', label: 'Note', hint: 'Quick note in Notes', icon: NotebookPen, panel: 'notes' },
  { kind: 'keep', label: 'Keep', hint: 'Pin a thought to Keep', icon: Lightbulb, panel: 'keep' },
  { kind: 'task', label: 'Task', hint: 'Action item with due date optional', icon: ClipboardList, panel: 'notes' },
  { kind: 'meeting', label: 'Meeting', hint: '30-minute calendar block', icon: Calendar, panel: 'calendar' },
  { kind: 'plan', label: 'Plan', hint: 'Planning item for a project sprint', icon: ClipboardList, panel: 'notes' },
];

function defaultMeetingWindow() {
  const start = new Date();
  start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
  return { start: fmt(start), end: fmt(end) };
}

export function RailQuickCreateMenu({ onCreated, onOpenPanel }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<QuickKind | null>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const resetForm = () => {
    setTitle('');
    setNotes('');
    setDueDate('');
    setError(null);
    setActive(null);
  };

  const submit = async () => {
    const text = title.trim();
    if (!text || !active || saving) return;
    setSaving(true);
    setError(null);
    try {
      if (active === 'note') {
        await createUserNote({ title: text, body: notes.trim() || text });
        onOpenPanel?.('notes');
      } else if (active === 'keep') {
        await createTodo({ title: text, category: 'Keep', notes: notes.trim() || text });
        onOpenPanel?.('keep');
      } else if (active === 'task') {
        await createTodo({
          title: text,
          category: 'My Tasks',
          description: notes.trim() || undefined,
          due_date: dueDate.trim() || undefined,
        });
        onOpenPanel?.('notes');
      } else if (active === 'plan') {
        await createTodo({
          title: text,
          category: 'Plans',
          description: notes.trim() || undefined,
        });
        onOpenPanel?.('notes');
      } else if (active === 'meeting') {
        const { start, end } = defaultMeetingWindow();
        await createCalendarEvent({
          title: text,
          description: notes.trim() || undefined,
          start_datetime: start,
          end_datetime: end,
          event_type: 'meeting',
        });
        onOpenPanel?.('calendar');
      }
      onCreated?.(active);
      resetForm();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rail-quick-create" ref={rootRef}>
      <button
        type="button"
        className="rbtn"
        title="Create note, task, meeting, or plan"
        aria-label="Create"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          if (open) resetForm();
        }}
      >
        <Plus size={20} strokeWidth={1.75} />
      </button>
      {open ? (
        <div className="rail-quick-create-popover" role="dialog" aria-label="Quick create">
          {!active ? (
            <ul className="rail-quick-create-list">
              {ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.kind}>
                    <button
                      type="button"
                      onClick={() => setActive(item.kind)}
                    >
                      <Icon size={18} strokeWidth={1.75} />
                      <span>
                        <strong>{item.label}</strong>
                        <small>{item.hint}</small>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="rail-quick-create-form">
              <p className="rail-quick-create-kicker">{ITEMS.find((i) => i.kind === active)?.label}</p>
              <input
                type="text"
                placeholder="Title"
                value={title}
                autoFocus
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submit();
                  if (e.key === 'Escape') resetForm();
                }}
              />
              <textarea
                placeholder="Details (optional)"
                value={notes}
                rows={2}
                onChange={(e) => setNotes(e.target.value)}
              />
              {active === 'task' ? (
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  aria-label="Due date"
                />
              ) : null}
              {error ? <p className="lib-rail-panel-error">{error}</p> : null}
              <div className="rail-quick-create-actions">
                <button type="button" className="lib-rail-open-btn" onClick={resetForm}>
                  Back
                </button>
                <button type="button" className="lib-rail-open-btn primary" disabled={saving || !title.trim()} onClick={() => void submit()}>
                  {saving ? 'Saving…' : 'Create'}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default RailQuickCreateMenu;
