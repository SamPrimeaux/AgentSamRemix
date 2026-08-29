import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  FolderKanban,
  List,
  MoreVertical,
  PlusCircle,
  Star,
} from 'lucide-react';
import type { ClientWorkNavItem } from '../../src/lib/collaborate/clientWorkNav';
import {
  loadUserTaskLists,
  removeUserTaskList,
  renameUserTaskList,
  saveUserTaskList,
  taskListName,
  taskListsFromTags,
  withTaskListTag,
} from '../../src/lib/collaborate/userTaskLists';
import { deleteProject } from '../../client-api/projects';
import {
  createTicket,
  deleteTicket,
  setTicketStarred,
  setTicketStatus,
  updateTicket,
  type PlatformTicket,
} from '../../client-api/tickets';
import { ProjectRow } from './ops-desk-types';
import { CollaborateTaskFocus } from './CollaborateTaskFocus';

export type TasksNavView = 'starred' | 'list' | 'client';

type Props = {
  tickets: PlatformTicket[];
  loading: boolean;
  navView: TasksNavView;
  activeList: string;
  onNavViewChange: (view: TasksNavView) => void;
  onActiveListChange: (list: string) => void;
  onReload: () => Promise<void>;
  onSchedule?: (ticket: PlatformTicket) => void;
  composing?: boolean;
  onComposingChange?: (open: boolean) => void;
  projectId?: string | null;
  clientId?: string | null;
  clients?: ClientWorkNavItem[];
  projects?: ProjectRow[];
  selectedTaskId?: string | null;
  onSelectedTaskChange?: (id: string | null) => void;
  clientListTitle?: string | null;
};

function isOpen(ticket: PlatformTicket) {
  return ticket.status !== 'shipped' && ticket.status !== 'abandoned';
}

function isTicketStarred(ticket: PlatformTicket) {
  return ticket.tags.includes('starred');
}

function formatTicketDue(dueAt: number | null) {
  if (!dueAt) return null;
  const d = new Date(dueAt * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function toDueAt(localValue: string) {
  const milliseconds = new Date(localValue).getTime();
  return Number.isNaN(milliseconds) ? null : Math.floor(milliseconds / 1000);
}

export function CollaborateTasksSidebar({
  tickets,
  navView,
  activeList,
  onNavViewChange,
  onActiveListChange,
  onCreateClick,
  clients = [],
  clientFilterId = null,
  clientWorkFilter = false,
  clientTaskCounts,
  onSelectClient,
  onSelectAllClientWork,
}: Pick<Props, 'tickets' | 'navView' | 'activeList' | 'onNavViewChange' | 'onActiveListChange'> & {
  onReload?: () => Promise<void>;
  onCreateClick?: () => void;
  clients?: ClientWorkNavItem[];
  clientFilterId?: string | null;
  clientWorkFilter?: boolean;
  clientTaskCounts?: Map<string, number>;
  onSelectClient?: (clientId: string) => void;
  onSelectAllClientWork?: () => void;
}) {
  const [newListName, setNewListName] = useState('');
  const [showNewList, setShowNewList] = useState(false);
  const [clientWorkOpen, setClientWorkOpen] = useState(true);
  const [userLists, setUserLists] = useState<string[]>(() => loadUserTaskLists());

  useEffect(() => {
    setUserLists(loadUserTaskLists());
  }, [tickets.length, activeList]);

  useEffect(() => {
    if (clientFilterId || clientWorkFilter) setClientWorkOpen(true);
  }, [clientFilterId, clientWorkFilter]);

  const openTickets = useMemo(() => tickets.filter(isOpen), [tickets]);
  const starredCount = useMemo(() => openTickets.filter(isTicketStarred).length, [openTickets]);

  const lists = useMemo(() => {
    const names = new Set<string>(['My Tasks', ...userLists, ...taskListsFromTags(openTickets)]);
    const counts = new Map<string, number>();
    for (const name of names) counts.set(name, 0);
    for (const t of openTickets) {
      const name = taskListName(t);
      if (!names.has(name)) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => {
      if (a === 'My Tasks') return -1;
      if (b === 'My Tasks') return 1;
      return a.localeCompare(b);
    });
  }, [openTickets, userLists]);

  const submitNewList = () => {
    const name = newListName.trim();
    if (!name || name === 'My Tasks') return;
    saveUserTaskList(name);
    setUserLists(loadUserTaskLists());
    onActiveListChange(name);
    onNavViewChange('list');
    setNewListName('');
    setShowNewList(false);
    onCreateClick?.();
  };

  return (
    <>
      <button
        type="button"
        className="colab-cal-create-btn"
        onClick={() => {
          if (navView === 'starred') onNavViewChange('list');
          onActiveListChange('My Tasks');
          onCreateClick?.();
        }}
      >
        <span className="colab-cal-create-plus">+</span>
        <span>Create</span>
      </button>

      <button
        type="button"
        className={`colab-tasks-nav-item${navView === 'list' && activeList === 'My Tasks' ? ' active' : ''}`}
        onClick={() => {
          onActiveListChange('My Tasks');
          onNavViewChange('list');
        }}
      >
        <span className="colab-tasks-nav-icon" aria-hidden>
          <CheckSquare size={16} strokeWidth={1.75} />
        </span>
        <span>My Tasks</span>
        <span className="colab-tasks-nav-count">{lists.find(([n]) => n === 'My Tasks')?.[1] ?? 0}</span>
      </button>

      <button
        type="button"
        className={`colab-tasks-nav-item${navView === 'starred' ? ' active' : ''}`}
        onClick={() => onNavViewChange('starred')}
      >
        <span className="colab-tasks-nav-icon" aria-hidden>
          <Star size={16} strokeWidth={1.75} />
        </span>
        <span>Starred</span>
        {starredCount > 0 && <span className="colab-tasks-nav-count">{starredCount}</span>}
      </button>

      {onSelectAllClientWork ? (
        <>
          <button
            type="button"
            className={`colab-tasks-lists-head colab-tasks-client-head${
              navView === 'client' ? ' active' : ''
            }`}
            onClick={() => setClientWorkOpen((open) => !open)}
            aria-expanded={clientWorkOpen}
          >
            {clientWorkOpen ? (
              <ChevronDown size={14} strokeWidth={1.75} aria-hidden />
            ) : (
              <ChevronRight size={14} strokeWidth={1.75} aria-hidden />
            )}
            <FolderKanban size={16} strokeWidth={1.75} aria-hidden />
            <span>Client work</span>
          </button>
          {clientWorkOpen ? (
            <div className="colab-tasks-client-subnav">
              <button
                type="button"
                className={`colab-tasks-nav-item colab-tasks-nav-item--sub${
                  navView === 'client' && clientWorkFilter && !clientFilterId ? ' active' : ''
                }`}
                onClick={onSelectAllClientWork}
              >
                <span className="colab-tasks-nav-icon" aria-hidden>
                  <List size={15} strokeWidth={1.75} />
                </span>
                <span>All clients</span>
                <span className="colab-tasks-nav-count">
                  {[...clientTaskCounts?.values() || []].reduce((a, b) => a + b, 0)}
                </span>
              </button>
              {clients.map((client) => {
                const count = clientTaskCounts?.get(client.client_id) || 0;
                const active = navView === 'client' && clientFilterId === client.client_id;
                return (
                  <button
                    key={client.client_id}
                    type="button"
                    className={`colab-tasks-nav-item colab-tasks-nav-item--sub${active ? ' active' : ''}`}
                    onClick={() => onSelectClient?.(client.client_id)}
                  >
                    <span className="colab-tasks-nav-icon" aria-hidden>
                      <FolderKanban size={15} strokeWidth={1.75} />
                    </span>
                    <span>{client.client_name}</span>
                    <span className="colab-tasks-nav-count">{count}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </>
      ) : null}

      {userLists.length > 0 ? (
        <>
          <div className="colab-tasks-lists-head">
            <ChevronDown size={14} strokeWidth={1.75} aria-hidden />
            <span>My lists</span>
          </div>
          {lists
            .filter(([name]) => name !== 'My Tasks')
            .map(([name, count]) => (
              <button
                key={name}
                type="button"
                className={`colab-tasks-nav-item${navView === 'list' && activeList === name ? ' active' : ''}`}
                onClick={() => {
                  onActiveListChange(name);
                  onNavViewChange('list');
                }}
              >
                <span className="colab-tasks-nav-icon" aria-hidden>
                  <List size={16} strokeWidth={1.75} />
                </span>
                <span>{name}</span>
                <span className="colab-tasks-nav-count">{count}</span>
              </button>
            ))}
        </>
      ) : null}

      {showNewList ? (
        <div style={{ padding: '0 16px 12px' }}>
          <input
            className="colab-tasks-inline-due"
            style={{ width: '100%' }}
            placeholder="List name"
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitNewList();
              if (e.key === 'Escape') setShowNewList(false);
            }}
            autoFocus
          />
        </div>
      ) : (
        <button type="button" className="colab-tasks-new-list" onClick={() => setShowNewList(true)}>
          + Create new list
        </button>
      )}
    </>
  );
}

function TaskActionMenu({
  ticket,
  onComplete,
  onEdit,
  onDelete,
  onSchedule,
  onClose,
}: {
  ticket: PlatformTicket;
  onComplete: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSchedule?: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [onClose]);

  return (
    <div ref={ref} className="colab-tasks-action-menu" role="menu">
      <button type="button" role="menuitem" onClick={() => { onEdit(); onClose(); }}>
        Edit task
      </button>
      <button type="button" role="menuitem" onClick={() => { onComplete(); onClose(); }}>
        Mark complete
      </button>
      {onSchedule ? (
        <button type="button" role="menuitem" onClick={() => { onSchedule(); onClose(); }}>
          Schedule on calendar
        </button>
      ) : null}
      <button type="button" role="menuitem" className="danger" onClick={() => { onDelete(); onClose(); }}>
        Delete task
      </button>
    </div>
  );
}

function ListOptionsMenu({
  canRenameList,
  canDeleteList,
  projectId,
  projectName,
  listTitle,
  openCount,
  onRenameList,
  onDeleteList,
  onDeleteOpenTasks,
  onDeleteProject,
  onClose,
}: {
  canRenameList: boolean;
  canDeleteList: boolean;
  projectId: string | null;
  projectName: string | null;
  listTitle: string;
  openCount: number;
  onRenameList: () => void;
  onDeleteList: () => void;
  onDeleteOpenTasks: () => void;
  onDeleteProject: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="colab-tasks-action-menu colab-tasks-list-menu" role="menu">
      {canRenameList ? (
        <button type="button" role="menuitem" onClick={() => { onRenameList(); onClose(); }}>
          Rename list
        </button>
      ) : null}
      {openCount > 0 ? (
        <button type="button" role="menuitem" className="danger" onClick={() => { onDeleteOpenTasks(); onClose(); }}>
          Delete {openCount} open task{openCount === 1 ? '' : 's'} in “{listTitle}”
        </button>
      ) : null}
      {canDeleteList ? (
        <button type="button" role="menuitem" className="danger" onClick={() => { onDeleteList(); onClose(); }}>
          Delete list “{listTitle}”
        </button>
      ) : null}
      {projectId ? (
        <>
          <div className="colab-tasks-menu-divider" />
          <button type="button" role="menuitem" className="danger" onClick={() => { onDeleteProject(); onClose(); }}>
            Delete project{projectName ? ` “${projectName}”` : ''}…
          </button>
        </>
      ) : null}
    </div>
  );
}

export function CollaborateTasksMain({
  tickets,
  loading,
  navView,
  activeList,
  onReload,
  onSchedule,
  composing = false,
  onComposingChange,
  onNavViewChange,
  onActiveListChange,
  projectId = null,
  clientId = null,
  clients = [],
  projects = [],
  selectedTaskId = null,
  onSelectedTaskChange,
  clientListTitle = null,
}: Props) {
  const [draftTitle, setDraftTitle] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [draftDue, setDraftDue] = useState('');
  const [draftProjectId, setDraftProjectId] = useState(projectId || '');
  const [draftClientId, setDraftClientId] = useState(clientId || '');
  const [saving, setSaving] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [dueEditId, setDueEditId] = useState<string | null>(null);
  const [dueDraft, setDueDraft] = useState('');
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [listMenuOpen, setListMenuOpen] = useState(false);

  useEffect(() => {
    setDraftProjectId(projectId || '');
    setDraftClientId(clientId || '');
  }, [projectId, clientId]);

  const openTickets = useMemo(() => tickets.filter(isOpen), [tickets]);

  const filtered = useMemo(() => {
    if (navView === 'client') return openTickets;
    if (navView === 'starred') return openTickets.filter(isTicketStarred);
    if (activeList === 'My Tasks') return openTickets.filter((ticket) => taskListName(ticket) === 'My Tasks');
    return openTickets.filter((ticket) => taskListName(ticket) === activeList);
  }, [openTickets, navView, activeList]);

  const selectedTask = useMemo(
    () => (selectedTaskId ? tickets.find((t) => t.id === selectedTaskId) || null : null),
    [tickets, selectedTaskId],
  );

  const linkedProject = useMemo(
    () => (projectId ? projects.find((p) => p.id === projectId) || null : null),
    [projectId, projects],
  );

  const listTitle =
    navView === 'client'
      ? clientListTitle || 'Client work'
      : navView === 'starred'
        ? 'Starred'
        : activeList;

  const projectLabel = (id: string | null | undefined) => {
    if (!id) return null;
    return projects.find((p) => p.id === id)?.name || id;
  };

  const completeTask = async (ticket: PlatformTicket) => {
    setSaving(true);
    try {
      await setTicketStatus(ticket.id, { status: 'shipped' });
      if (selectedTaskId === ticket.id) onSelectedTaskChange?.(null);
      await onReload();
    } finally {
      setSaving(false);
    }
  };

  const removeTask = async (ticket: PlatformTicket) => {
    if (!window.confirm(`Permanently delete "${ticket.title}"? This cannot be undone.`)) return;
    setSaving(true);
    try {
      await deleteTicket(ticket.id);
      if (selectedTaskId === ticket.id) onSelectedTaskChange?.(null);
      await onReload();
    } finally {
      setSaving(false);
    }
  };

  const canManageCustomList =
    navView === 'list' && activeList !== 'My Tasks' && activeList.trim().length > 0;

  const renameCurrentList = async () => {
    if (!canManageCustomList) return;
    const next = window.prompt('Rename list', activeList)?.trim();
    if (!next || next === activeList || next === 'My Tasks') return;
    setSaving(true);
    setComposeError(null);
    try {
      renameUserTaskList(activeList, next);
      const toRename = openTickets.filter((ticket) => taskListName(ticket) === activeList);
      for (const ticket of toRename) {
        await updateTicket(ticket.id, { tags: withTaskListTag(ticket.tags, next), surface: 'collaborate' });
      }
      onActiveListChange(next);
      await onReload();
    } catch (e) {
      setComposeError(e instanceof Error ? e.message : 'Could not rename list');
    } finally {
      setSaving(false);
    }
  };

  const deleteCurrentList = async () => {
    if (!canManageCustomList) return;
    const count = filtered.length;
    const ok = window.confirm(
      count > 0
        ? `Delete list “${activeList}” and permanently delete its ${count} open task${count === 1 ? '' : 's'}?`
        : `Delete empty list “${activeList}”?`,
    );
    if (!ok) return;
    setSaving(true);
    setComposeError(null);
    try {
      for (const todo of filtered) {
        await deleteTicket(todo.id);
      }
      removeUserTaskList(activeList);
      onActiveListChange('My Tasks');
      onNavViewChange?.('list');
      if (selectedTaskId) onSelectedTaskChange?.(null);
      await onReload();
    } catch (e) {
      setComposeError(e instanceof Error ? e.message : 'Could not delete list');
    } finally {
      setSaving(false);
    }
  };

  const deleteOpenTasksInView = async () => {
    if (filtered.length === 0) return;
    const ok = window.confirm(
      `Permanently delete ${filtered.length} open task${filtered.length === 1 ? '' : 's'} in “${listTitle}”? This cannot be undone.`,
    );
    if (!ok) return;
    setSaving(true);
    setComposeError(null);
    try {
      for (const todo of filtered) {
        await deleteTicket(todo.id);
      }
      if (selectedTaskId) onSelectedTaskChange?.(null);
      await onReload();
    } catch (e) {
      setComposeError(e instanceof Error ? e.message : 'Could not delete tasks');
    } finally {
      setSaving(false);
    }
  };

  const deleteLinkedProject = async () => {
    if (!linkedProject) {
      setComposeError(
        'This view is pinned to a client/account id, not a projects row. Open /dashboard/projects to delete a real project.',
      );
      return;
    }
    const name = linkedProject.name || linkedProject.id;
    const ok = window.confirm(
      `Delete project “${name}” from D1 (projects table)? Linked tasks and dependents will be removed. This cannot be undone.`,
    );
    if (!ok) return;
    const typed = window.prompt(`Type the project name to confirm:\n${name}`);
    if (typed?.trim() !== name) {
      setComposeError('Project delete cancelled — name did not match.');
      return;
    }
    setSaving(true);
    setComposeError(null);
    try {
      const res = await deleteProject(linkedProject.id);
      if (!res.ok) throw new Error(res.error || 'Project delete failed');
      await onReload();
      window.location.assign('/dashboard/collaborate?seg=tickets');
    } catch (e) {
      setComposeError(e instanceof Error ? e.message : 'Could not delete project');
    } finally {
      setSaving(false);
    }
  };

  const toggleStar = async (ticket: PlatformTicket) => {
    setSaving(true);
    setComposeError(null);
    try {
      await setTicketStarred(ticket, !isTicketStarred(ticket));
      await onReload();
    } catch (e) {
      setComposeError(e instanceof Error ? e.message : 'Could not update star');
    } finally {
      setSaving(false);
    }
  };

  const saveNewTask = async () => {
    const title = draftTitle.trim();
    if (!title) return;
    setSaving(true);
    setComposeError(null);
    try {
      const category = navView === 'list' ? activeList : 'My Tasks';
      if (category !== 'My Tasks') saveUserTaskList(category);
      await createTicket({
        title,
        description: draftNotes.trim() || undefined,
        due_at: draftDue ? toDueAt(draftDue) : undefined,
        status: 'active',
        tags: withTaskListTag([], category),
        project: draftProjectId || projectId || null,
        client_id: draftClientId || null,
        surface: 'collaborate',
      });
      setDraftTitle('');
      setDraftNotes('');
      setDraftDue('');
      setDraftProjectId(projectId || '');
      setDraftClientId(clientId || '');
      onComposingChange?.(false);
      await onReload();
    } catch (e) {
      setComposeError(e instanceof Error ? e.message : 'Could not create task');
    } finally {
      setSaving(false);
    }
  };

  const saveSelectedTask = async (payload: {
    title: string;
    description: string | null;
    project: string | null;
    client_id: string | null;
    due_at: number | null;
  }) => {
    if (!selectedTask) return;
    setSaving(true);
    setComposeError(null);
    try {
      await updateTicket(selectedTask.id, {
        title: payload.title,
        description: payload.description,
        due_at: payload.due_at,
        project: payload.project,
        client_id: payload.client_id,
        surface: 'collaborate',
      });
      await onReload();
    } catch (e) {
      setComposeError(e instanceof Error ? e.message : 'Could not save task');
    } finally {
      setSaving(false);
    }
  };

  const saveDueDate = async (ticket: PlatformTicket) => {
    if (!dueDraft) return;
    setSaving(true);
    try {
      await updateTicket(ticket.id, { due_at: toDueAt(dueDraft), surface: 'collaborate' });
      setDueEditId(null);
      setDueDraft('');
      await onReload();
    } finally {
      setSaving(false);
    }
  };

  const openCompose = () => {
    if (navView === 'starred') {
      onNavViewChange?.('list');
      onActiveListChange?.('My Tasks');
    }
    onComposingChange?.(true);
  };

  return (
    <section className="colab-tasks-main">
      <div className="colab-tasks-main-inner">
        <div className="colab-tasks-list-head">
          <h2 className="colab-tasks-list-title">{listTitle}</h2>
          <div className="colab-tasks-list-menu-wrap">
            <button
              type="button"
              className="colab-cal-icon-btn"
              aria-label="List options"
              aria-expanded={listMenuOpen}
              disabled={saving}
              onClick={() => setListMenuOpen((open) => !open)}
            >
              <MoreVertical size={18} strokeWidth={1.75} />
            </button>
            {listMenuOpen ? (
              <ListOptionsMenu
                canRenameList={canManageCustomList}
                canDeleteList={canManageCustomList}
                projectId={linkedProject?.id || null}
                projectName={linkedProject?.name || null}
                listTitle={listTitle}
                openCount={filtered.length}
                onRenameList={() => void renameCurrentList()}
                onDeleteList={() => void deleteCurrentList()}
                onDeleteOpenTasks={() => void deleteOpenTasksInView()}
                onDeleteProject={() => void deleteLinkedProject()}
                onClose={() => setListMenuOpen(false)}
              />
            ) : null}
          </div>
        </div>

        <div className="colab-tasks-section">
          <div className="colab-tasks-section-head">
            <FolderKanban size={16} strokeWidth={1.75} aria-hidden />
            <span>Project</span>
          </div>
          <p className="colab-tasks-section-hint">
            Connect tasks to a real project to track today&apos;s work in Time insights.
          </p>
          {composing ? (
            <>
              <select
                className="colab-tasks-project-select"
                value={draftProjectId}
                onChange={(e) => setDraftProjectId(e.target.value)}
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select
                className="colab-tasks-project-select"
                value={draftClientId}
                onChange={(e) => setDraftClientId(e.target.value)}
                aria-label="Client"
              >
                <option value="">No client</option>
                {clients.map((client) => (
                  <option key={client.client_id} value={client.client_id}>
                    {client.client_name}
                  </option>
                ))}
              </select>
            </>
          ) : projectId ? (
            <div className="colab-tasks-meta-pill">{projectLabel(projectId)}</div>
          ) : (
            <div className="colab-tasks-meta-pill muted">Select a task to assign a project</div>
          )}
        </div>

        <div className="colab-tasks-add-row">
          {composeError ? <p className="colab-tasks-compose-error">{composeError}</p> : null}
          {!composing ? (
            <button type="button" className="colab-tasks-add-btn" onClick={openCompose}>
              <span className="colab-tasks-add-icon" aria-hidden>
                <PlusCircle size={18} strokeWidth={1.75} />
              </span>
              <span>Add a task</span>
            </button>
          ) : (
            <div className="colab-tasks-compose" style={{ gridColumn: '1 / -1', width: '100%' }}>
              <span className="colab-tasks-check" />
              <div>
                <input
                  placeholder="Title"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void saveNewTask();
                    }
                    if (e.key === 'Escape') onComposingChange?.(false);
                  }}
                  autoFocus
                />
                <textarea
                  placeholder="Details — or ask Agent Sam to turn ideas into tasks"
                  value={draftNotes}
                  onChange={(e) => setDraftNotes(e.target.value)}
                />
                <input
                  type="datetime-local"
                  className="colab-tasks-inline-due"
                  value={draftDue}
                  onChange={(e) => setDraftDue(e.target.value)}
                />
                <div className="colab-tasks-compose-actions">
                  <button type="button" className="colab-cal-save-btn" disabled={saving} onClick={() => void saveNewTask()}>
                    Save
                  </button>
                  <button type="button" className="colab-cal-text-btn" onClick={() => onComposingChange?.(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {loading && filtered.length === 0 ? (
          <div className="colab-tasks-empty">Loading tasks…</div>
        ) : filtered.length === 0 ? (
          <div className="colab-tasks-empty">No tasks here yet. Use Create or ask Agent Sam to add one.</div>
        ) : (
          filtered.map((ticket) => {
            const due = formatTicketDue(ticket.due_at);
            const body = ticket.description;
            const proj = projectLabel(ticket.project);
            const selected = selectedTaskId === ticket.id;
            return (
              <div
                key={ticket.id}
                className={`colab-tasks-item${selected ? ' selected' : ''}`}
                onClick={() => onSelectedTaskChange?.(ticket.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectedTaskChange?.(ticket.id);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-label={`Open task: ${ticket.title}`}
              >
                <div className="colab-tasks-check-wrap" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="colab-tasks-check"
                    aria-label="Task actions"
                    disabled={saving}
                    onClick={() => setActionMenuId(actionMenuId === ticket.id ? null : ticket.id)}
                  />
                  {actionMenuId === ticket.id ? (
                    <TaskActionMenu
                      ticket={ticket}
                      onComplete={() => void completeTask(ticket)}
                      onEdit={() => onSelectedTaskChange?.(ticket.id)}
                      onDelete={() => void removeTask(ticket)}
                      onSchedule={onSchedule ? () => void onSchedule(ticket) : undefined}
                      onClose={() => setActionMenuId(null)}
                    />
                  ) : null}
                </div>
                <div>
                  <div className="colab-tasks-item-title">{ticket.title}</div>
                  {body ? <div className="colab-tasks-item-desc">{body}</div> : null}
                  <div className="colab-tasks-item-open-hint">Tap for full details</div>
                  {proj ? <div className="colab-tasks-project-tag">{proj}</div> : null}
                  {dueEditId === ticket.id ? (
                    <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="datetime-local"
                        className="colab-tasks-inline-due"
                        value={dueDraft}
                        onChange={(e) => setDueDraft(e.target.value)}
                      />
                      <button type="button" className="colab-cal-save-btn" disabled={saving} onClick={() => void saveDueDate(ticket)}>
                        Save
                      </button>
                    </div>
                  ) : due ? (
                    <div className="colab-tasks-meta-pill">
                      <Clock size={14} strokeWidth={1.75} aria-hidden />
                      <span>{due}</span>
                      {onSchedule ? (
                        <button
                          type="button"
                          className="colab-cal-text-btn"
                          style={{ padding: 0, marginLeft: 4 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            void onSchedule(ticket);
                          }}
                        >
                          <ExternalLink size={14} strokeWidth={1.75} aria-hidden />
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="colab-cal-text-btn"
                      style={{ marginTop: 8 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDueEditId(ticket.id);
                        setDueDraft('');
                      }}
                    >
                      Add date/time
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  className={`colab-tasks-star${isTicketStarred(ticket) ? ' on' : ''}`}
                  aria-label={isTicketStarred(ticket) ? 'Unstar' : 'Star'}
                  disabled={saving}
                  onClick={(e) => {
                    e.stopPropagation();
                    void toggleStar(ticket);
                  }}
                >
                  <Star size={18} strokeWidth={1.75} fill={isTicketStarred(ticket) ? 'currentColor' : 'none'} />
                </button>
              </div>
            );
          })
        )}

        {selectedTask ? (
          <CollaborateTaskFocus
            task={selectedTask}
            projects={projects}
            clients={clients}
            saving={saving}
            onClose={() => onSelectedTaskChange?.(null)}
            onSave={saveSelectedTask}
            onComplete={() => completeTask(selectedTask)}
            onDelete={() => removeTask(selectedTask)}
            onSchedule={onSchedule ? () => void onSchedule(selectedTask) : undefined}
            onToggleStar={() => toggleStar(selectedTask)}
          />
        ) : null}
      </div>
    </section>
  );
}
