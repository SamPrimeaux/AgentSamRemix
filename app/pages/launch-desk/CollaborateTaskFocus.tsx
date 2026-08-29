import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, CheckCircle, Clock, FolderKanban, Star, Trash2, X } from 'lucide-react';
import type { PlatformTicket } from '../../client-api/tickets';
import type { ClientWorkNavItem } from '../../src/lib/collaborate/clientWorkNav';
import { taskListName } from '../../src/lib/collaborate/userTaskLists';
import { ProjectRow } from './ops-desk-types';

type Props = {
  task: PlatformTicket;
  projects: ProjectRow[];
  clients: ClientWorkNavItem[];
  saving?: boolean;
  onClose: () => void;
  onSave: (payload: {
    title: string;
    description: string | null;
    project: string | null;
    client_id: string | null;
    due_at: number | null;
  }) => Promise<void>;
  onComplete: () => Promise<void>;
  onDelete: () => Promise<void>;
  onSchedule?: () => void;
  onToggleStar?: () => Promise<void>;
};

function taskBody(ticket: PlatformTicket) {
  return ticket.description?.trim() || '';
}

function fmtMetaDate(raw: number | null | undefined) {
  if (!raw) return null;
  const d = new Date(raw * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function dueDate(ticket: PlatformTicket) {
  return ticket.due_at ? new Date(ticket.due_at * 1000) : null;
}

function formatTicketDue(ticket: PlatformTicket) {
  const due = dueDate(ticket);
  if (!due || Number.isNaN(due.getTime())) return null;
  return due.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function toLocalInput(raw: number | null) {
  if (!raw) return '';
  const d = new Date(raw * 1000);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CollaborateTaskFocus({
  task,
  projects,
  clients,
  saving = false,
  onClose,
  onSave,
  onComplete,
  onDelete,
  onSchedule,
  onToggleStar,
}: Props) {
  const [title, setTitle] = useState(task.title || '');
  const [body, setBody] = useState(taskBody(task));
  const [projectId, setProjectId] = useState(task.project || '');
  const [clientId, setClientId] = useState(task.client_id || '');
  const [dueLocal, setDueLocal] = useState(() => toLocalInput(task.due_at));

  useEffect(() => {
    setTitle(task.title || '');
    setBody(taskBody(task));
    setProjectId(task.project || '');
    setClientId(task.client_id || '');
    setDueLocal(toLocalInput(task.due_at));
  }, [task]);

  const projectName = useMemo(
    () => projects.find((p) => p.id === projectId)?.name || projectId || null,
    [projects, projectId],
  );

  const tags = task.tags;
  const starred = tags.includes('starred');
  const dueLabel = formatTicketDue(task);

  const handleSave = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    await onSave({
      title: trimmedTitle,
      description: body.trim() || null,
      project: projectId.trim() || null,
      client_id: clientId.trim() || null,
      due_at: dueLocal ? Math.floor(new Date(dueLocal).getTime() / 1000) : null,
    });
  };

  return (
    <div className="colab-task-focus" role="dialog" aria-modal="true" aria-labelledby="colab-task-focus-title">
      <div className="colab-task-focus-top">
        <button type="button" className="colab-cal-icon-btn colab-task-focus-close" aria-label="Close task" onClick={onClose}>
          <X size={22} strokeWidth={1.75} />
        </button>
        <div className="colab-task-focus-top-actions">
          {onToggleStar ? (
            <button
              type="button"
              className={`colab-tasks-star${starred ? ' on' : ''}`}
              aria-label={starred ? 'Unstar task' : 'Star task'}
              disabled={saving}
              onClick={() => void onToggleStar()}
            >
              <Star size={20} strokeWidth={1.75} fill={starred ? 'currentColor' : 'none'} />
            </button>
          ) : null}
          <button type="button" className="colab-cal-save-btn" disabled={saving} onClick={() => void handleSave()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="colab-task-focus-scroll">
        <div className="colab-task-focus-inner">
          <input
            id="colab-task-focus-title"
            className="colab-task-focus-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title"
          />

          <div className="colab-task-focus-meta">
            <span className="colab-tasks-meta-pill">{taskListName(task)}</span>
            {task.status ? (
              <span className="colab-tasks-meta-pill muted">{task.status}</span>
            ) : null}
            {task.priority ? (
              <span className="colab-tasks-meta-pill muted">{task.priority}</span>
            ) : null}
            {dueLabel ? (
              <span className="colab-tasks-meta-pill">
                <Clock size={14} strokeWidth={1.75} aria-hidden />
                {dueLabel}
              </span>
            ) : null}
            {projectName ? (
              <span className="colab-tasks-meta-pill">
                <FolderKanban size={14} strokeWidth={1.75} aria-hidden />
                {projectName}
              </span>
            ) : null}
          </div>

          {tags.length > 0 ? (
            <div className="colab-task-focus-tags">
              {tags.map((tag) => (
                <span key={tag} className="colab-tasks-project-tag">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}

          <section className="colab-task-focus-section">
            <label className="colab-task-focus-label" htmlFor="colab-task-focus-body">
              Documentation
            </label>
            <p className="colab-task-focus-hint">
              Full context for you and Agent Sam — acceptance criteria, links, client notes, implementation steps.
            </p>
            <textarea
              id="colab-task-focus-body"
              className="colab-task-focus-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Describe what done looks like, paste URLs, list sub-steps, capture client feedback…"
              rows={14}
            />
          </section>

          <section className="colab-task-focus-section colab-task-focus-fields">
            <label className="colab-task-focus-field">
              <span>Due date & time</span>
              <input type="datetime-local" className="colab-tasks-inline-due" value={dueLocal} onChange={(e) => setDueLocal(e.target.value)} />
            </label>
            <label className="colab-task-focus-field">
              <span>Project</span>
              <select className="colab-tasks-project-select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="colab-task-focus-field">
              <span>Client</span>
              <select className="colab-tasks-project-select" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">No client</option>
                {clients.map((client) => (
                  <option key={client.client_id} value={client.client_id}>
                    {client.client_name}
                  </option>
                ))}
              </select>
            </label>
          </section>

          {(task.created_at || task.updated_at) && (
            <section className="colab-task-focus-section colab-task-focus-audit">
              {task.created_at ? <div>Created {fmtMetaDate(task.created_at)}</div> : null}
              {task.updated_at ? <div>Updated {fmtMetaDate(task.updated_at)}</div> : null}
            </section>
          )}

          <div className="colab-task-focus-actions">
            {onSchedule ? (
              <button type="button" className="colab-cal-outline-btn" disabled={saving} onClick={onSchedule}>
                <Calendar size={16} strokeWidth={1.75} aria-hidden />
                Schedule on calendar
              </button>
            ) : null}
            <button type="button" className="colab-cal-outline-btn" disabled={saving} onClick={() => void onComplete()}>
              <CheckCircle size={16} strokeWidth={1.75} aria-hidden />
              Mark complete
            </button>
            <button type="button" className="colab-cal-outline-btn danger" disabled={saving} onClick={() => void onDelete()}>
              <Trash2 size={16} strokeWidth={1.75} aria-hidden />
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
