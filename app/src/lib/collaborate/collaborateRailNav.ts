export type CollaborateRailPanel = 'calendar' | 'keep' | 'notes' | 'contacts';

export type CollaborateCalendarRightPanel = 'insights' | 'calendar-setup' | 'active-tasks';

export type CollaborateMainSeg = 'calendar' | 'tasks';

export type CollaborateCalView = 'week' | 'month' | 'day';

/** Deep-link into the live /dashboard/collaborate surface (or related routes). */
export function collaborateDeepLink(panel: CollaborateRailPanel): string {
  switch (panel) {
    case 'calendar':
      return '/dashboard/collaborate';
    case 'keep':
      return '/dashboard/collaborate?seg=tickets&list=Keep';
    case 'notes':
      return '/dashboard/collaborate?seg=tickets';
    case 'contacts':
      return '/dashboard/collaborate?panel=people';
    default:
      return '/dashboard/collaborate';
  }
}

/** `seg=tickets` is canonical; `seg=tasks` kept as alias. */
export function isCollaborateTicketsSeg(seg: string | null | undefined): boolean {
  return seg === 'tickets' || seg === 'tasks';
}

export function parseCollaborateSearchParams(params: URLSearchParams): {
  mainSeg: CollaborateMainSeg;
  tasksList: string | null;
  focusPeople: boolean;
  projectId: string | null;
  clientId: string | null;
  clientWork: boolean;
  calView: CollaborateCalView;
  taskId: string | null;
} {
  const seg = params.get('seg');
  const mainSeg = isCollaborateTicketsSeg(seg) ? 'tasks' : 'calendar';
  const tasksList = params.get('list')?.trim() || null;
  const focusPeople = params.get('panel') === 'people';
  const projectId = params.get('project')?.trim() || null;
  const clientId = params.get('client')?.trim() || null;
  const clientWork = params.get('client_work') === '1';
  const viewParam = params.get('view');
  const calView: CollaborateCalView =
    viewParam === 'month' ? 'month' : viewParam === 'day' ? 'day' : 'week';
  const taskId = params.get('task')?.trim() || null;
  return { mainSeg, tasksList, focusPeople, projectId, clientId, clientWork, calView, taskId };
}

/** Merge collaborate URL params (omit null/empty to delete keys). */
export function patchCollaborateSearchParams(
  current: URLSearchParams,
  patch: {
    seg?: CollaborateMainSeg | null;
    view?: CollaborateCalView | null;
    project?: string | null;
    client?: string | null;
    client_work?: string | null;
    list?: string | null;
    panel?: string | null;
    task?: string | null;
  },
): URLSearchParams {
  const next = new URLSearchParams(current);
  const apply = (key: string, val: string | null | undefined) => {
    if (val == null || val === '') next.delete(key);
    else next.set(key, val);
  };
  if ('seg' in patch) {
    // Canonical public URL uses tickets; calendar clears seg.
    apply('seg', patch.seg === 'tasks' ? 'tickets' : null);
  }
  if ('view' in patch) {
    const v = patch.view;
    apply('view', v === 'month' ? 'month' : v === 'day' ? 'day' : v === 'week' ? null : null);
  }
  if ('task' in patch) apply('task', patch.task ?? null);
  if ('project' in patch) apply('project', patch.project ?? null);
  if ('client' in patch) apply('client', patch.client ?? null);
  if ('client_work' in patch) apply('client_work', patch.client_work ?? null);
  if ('list' in patch) apply('list', patch.list ?? null);
  if ('panel' in patch) apply('panel', patch.panel ?? null);
  return next;
}
