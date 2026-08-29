import { useEffect, useRef, useState } from 'react';
import { Calendar, ClipboardList, Loader2, NotebookPen, Plus } from 'lucide-react';
import { createKanbanTask } from '../../../client-api/kanban';
import { createCalendarEvent, createTodo } from '../../../pages/launch-desk/ops-desk-types';

type QuickKind = 'task' | 'note' | 'meeting' | 'plan';

type Props = {
  projectId: string;
  projectName: string;
  workspaceId?: string | null;
  onCreated?: (kind: QuickKind) => void;
};

const ITEMS: { kind: QuickKind; label: string; hint: string; icon: typeof NotebookPen }[] = [
  { kind: 'task', label: 'Task', hint: 'Add to project kanban', icon: ClipboardList },
  { kind: 'note', label: 'Note', hint: 'Quick project note', icon: NotebookPen },
  { kind: 'meeting', label: 'Meeting', hint: '30-minute calendar block', icon: Calendar },
  { kind: 'plan', label: 'Plan', hint: 'Planning item for this project', icon: ClipboardList },
];

function defaultMeetingWindow() {
  const start = new Date();
  start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
  return { start: fmt(start), end: fmt(end) };
}

export function ProjectQuickCreateMenu({ projectId, projectName, workspaceId, onCreated }: Props) {
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
      if (active === 'task') {
        const res = await createKanbanTask({
          title: text,
          workspaceId,
          projectId,
          description: notes.trim() || undefined,
        });
        if (!res.ok) throw new Error(res.error || 'Could not create task');
      } else if (active === 'note') {
        await createTodo({
          title: text,
          category: 'Notes',
          notes: notes.trim() || text,
          project_id: projectId,
        });
      } else if (active === 'plan') {
        await createTodo({
          title: text,
          category: 'Plans',
          description: notes.trim() || undefined,
          project_id: projectId,
        });
      } else if (active === 'meeting') {
        const { start, end } = defaultMeetingWindow();
        await createCalendarEvent({
          title: text,
          description: notes.trim() || `Meeting for ${projectName}`,
          start_datetime: start,
          end_datetime: end,
          event_type: 'meeting',
        });
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
    <div className="lib-proj-quick-create" ref={rootRef}>
      <button
        type="button"
        className="lib-proj-composer-plus"
        aria-label="Create task, note, meeting, or plan"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          if (open) resetForm();
        }}
      >
        <Plus size={15} />
      </button>
      {open ? (
        <div className="lib-proj-quick-create-popover" role="dialog" aria-label="Quick create for project">
          {!active ? (
            <ul className="lib-proj-quick-create-list">
              {ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.kind}>
                    <button type="button" onClick={() => setActive(item.kind)}>
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
            <div className="lib-proj-quick-create-form">
              <p className="lib-proj-quick-create-kicker">{ITEMS.find((i) => i.kind === active)?.label}</p>
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
              {error ? <p className="lib-proj-quick-create-error">{error}</p> : null}
              <div className="lib-proj-quick-create-actions">
                <button type="button" className="lib-proj-btn ghost sm" onClick={resetForm}>
                  Back
                </button>
                <button
                  type="button"
                  className="lib-proj-btn primary sm"
                  disabled={saving || !title.trim()}
                  onClick={() => void submit()}
                >
                  {saving ? (
                    <>
                      <Loader2 size={14} className="animate-spin inline mr-1" />
                      Saving…
                    </>
                  ) : (
                    'Create'
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default ProjectQuickCreateMenu;
