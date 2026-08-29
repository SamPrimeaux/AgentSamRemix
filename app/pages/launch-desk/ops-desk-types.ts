export type CalView = 'week' | 'month' | 'day';
export type QuickEventType = 'event' | 'task' | 'out_of_office' | 'focus' | 'working_location' | 'meeting';

export interface CalEvent {
  id: string;
  title: string;
  description?: string | null;
  location?: string | null;
  start_datetime: string;
  end_datetime: string;
  color?: string | null;
  status?: string | null;
  event_type?: string | null;
  meet_room_id?: string | null;
  room_id?: string | null;
  attendees?: string | null;
  all_day?: number | boolean | null;
  timezone?: string | null;
  recurrence_rule?: string | null;
  calendar_source?: string | null;
  guest_permissions_json?: string | null;
}

export interface BookingPage {
  id: string;
  slug: string;
  title: string;
  duration_min: number;
  description?: string | null;
  location?: string | null;
  is_active?: number;
}

export interface CalendarPerson {
  id?: string;
  display_name?: string | null;
  email?: string | null;
  role?: string | null;
  user_id?: string | null;
  username?: string | null;
  phone?: string | null;
  avatar_url?: string | null;
  description?: string | null;
}

export interface CalendarInsightsPayload {
  window: { from: string; to: string };
  insights: {
    breakdown_minutes: Record<string, number>;
    meeting_minutes: number;
    people: { email: string; minutes: number }[];
    working_minutes_per_day: number;
  };
  weeks: { label: string; minutes: number; active: boolean }[];
  working_hours: {
    timezone: string;
    start_minutes: number;
    end_minutes: number;
    work_days_json: string;
  };
}

export interface AgentTodo {
  id: string;
  title: string;
  description?: string | null;
  status?: string | null;
  priority?: string | null;
  due_date?: string | null;
  tags?: string | null;
  category?: string | null;
  project_id?: string | null;
  project_key?: string | null;
  client_id?: string | null;
  agent_instructions?: string | null;
  notes?: string | null;
  linked_route?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  sort_order?: number | null;
}

export interface ProjectRow {
  id: string;
  name: string;
  status?: string | null;
  client_id?: string | null;
  client_name?: string | null;
  domain?: string | null;
}

export interface ClientProjectRow {
  id: string;
  client_name?: string | null;
  project_name?: string | null;
  project_id?: string | null;
  client_id?: string | null;
  status?: string | null;
  payment_notes?: string | null;
}

export interface TasksInsightsPayload {
  today_minutes: number;
  agent_inferred_minutes?: number;
  scheduled_today_minutes?: number;
  combined_today_minutes?: number;
  usage_rollup?: {
    cost_usd?: number;
    ai_calls?: number;
    tool_calls?: number;
    deployments?: number;
  } | null;
  active_tracking: boolean;
  by_project: { project_id: string; name: string; minutes: number }[];
  by_task: { todo_id: string | null; title: string; minutes: number }[];
  project_id?: string | null;
  project_active_tracking?: boolean;
  project_today_minutes?: number;
  active_entry?: {
    id: string;
    project_id: string;
    start_time?: string;
    duration_seconds?: number;
  } | null;
}

export function parseTodoTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function isTodoStarred(todo: AgentTodo) {
  return parseTodoTags(todo.tags).includes('starred');
}

export function todoListName(todo: AgentTodo) {
  const name = String(todo.category || '').trim();
  return name || 'My Tasks';
}

export function isMyTasksTodo(todo: AgentTodo) {
  const cat = String(todo.category || '').trim();
  return !cat || cat === 'My Tasks';
}

export function fmtMinutes(m: number) {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export function formatTodoDue(raw: string | null | undefined) {
  if (!raw) return null;
  const s = String(raw).trim();
  const d = s.includes('T') ? new Date(s) : new Date(s.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return null;
  const hasTime = s.includes(':') || s.includes('T');
  return d.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(hasTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  });
}

export async function createTodo(payload: {
  title: string;
  description?: string;
  due_date?: string;
  category?: string;
  starred?: boolean;
  notes?: string;
  project_id?: string;
  project_key?: string;
}) {
  return apiJson<{ ok: boolean; todo: AgentTodo }>('/api/agent/todo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function patchTodo(id: string, payload: Record<string, unknown>) {
  return apiJson<{ ok: boolean; todo: AgentTodo }>(`/api/agent/todo/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function deleteTodo(id: string) {
  return apiJson<{ ok: boolean; deleted?: boolean; id?: string }>(`/api/agent/todo/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/** Soft-remove from open lists without destroying the row (status → cancelled). */
export async function cancelTodo(id: string) {
  return patchTodo(id, { status: 'cancelled' });
}

export async function createCalendarEvent(payload: {
  title: string;
  description?: string;
  start_datetime: string;
  end_datetime: string;
  event_type?: string;
  location?: string;
}) {
  return apiJson<{ success?: boolean; id?: string; error?: string }>('/api/calendar/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function updateCalendarEvent(id: string, payload: Record<string, unknown>) {
  return apiJson<{ success?: boolean; error?: string }>(`/api/calendar/events/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function deleteCalendarEvent(id: string) {
  return apiJson<{ success?: boolean; error?: string }>(`/api/calendar/events/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function fmtTime(d: Date) {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function fmtDateTime(d: Date) {
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export function fmtDayTitle(d: Date) {
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export function parseEventDate(raw: string) {
  const s = String(raw || '').trim();
  if (!s) return new Date(NaN);
  if (s.includes('T')) return new Date(s);
  return new Date(s.replace(' ', 'T'));
}

export function meetRoomId(ev: CalEvent) {
  const id = ev.meet_room_id || ev.room_id;
  return id ? String(id) : null;
}

export function isSyntheticEvent(ev: CalEvent) {
  const id = String(ev.id || '');
  const src = String(ev.calendar_source || '').toLowerCase();
  return (
    id.startsWith('task_') ||
    id.startsWith('bday_') ||
    id.startsWith('hol_') ||
    src === 'holidays'
  );
}

/** Google Calendar import — read-only edit in IAM; delete removes local copy + tombstone. */
export function isGoogleSyncedEvent(ev: CalEvent) {
  const id = String(ev.id || '');
  const src = String(ev.calendar_source || '').toLowerCase();
  return src === 'google_calendar' || id.startsWith('gce_');
}

export function isEditableCalendarEvent(ev: CalEvent) {
  return !isSyntheticEvent(ev);
}

export function isAllDay(ev: CalEvent) {
  return ev.all_day === true || ev.all_day === 1;
}

export function parseAttendees(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function parseInviteEmails(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
}

export function toDatetimeLocalValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function toSqlDatetime(isoLocal: string) {
  const d = new Date(isoLocal);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

export function daySqlRange(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { from: `${key} 00:00:00`, to: `${key} 23:59:59` };
}

export async function fetchDayEvents(day: Date): Promise<CalEvent[]> {
  const { from, to } = daySqlRange(day);
  const q = new URLSearchParams({
    from,
    to,
    sources: 'primary,google_calendar',
  });
  const data = await apiJson<{ events?: CalEvent[] }>(`/api/calendar/view/day?${q}`);
  return (data.events ?? [])
    .filter((ev) => !isSyntheticEvent(ev))
    .sort(
      (a, b) => parseEventDate(a.start_datetime).getTime() - parseEventDate(b.start_datetime).getTime(),
    );
}

export function anchorIso(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfWeek(d: Date) {
  const next = new Date(d);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() - next.getDay());
  return next;
}

export function addDays(d: Date, days: number) {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

export async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: string })?.error || res.statusText || 'Request failed';
    throw new Error(msg);
  }
  return data as T;
}

export function sourcesParam(enabled: Record<string, boolean>) {
  const keys = Object.entries(enabled)
    .filter(([, on]) => on)
    .map(([k]) => k);
  return keys.length ? keys.join(',') : 'primary';
}

export async function fetchWeekEvents(anchor: Date, sources: Record<string, boolean>) {
  return fetchCalendarViewEvents(anchor, 'week', sources);
}

export async function fetchMonthEvents(anchor: Date, sources: Record<string, boolean>) {
  return fetchCalendarViewEvents(anchor, 'month', sources);
}

export async function fetchCalendarViewEvents(
  anchor: Date,
  view: 'week' | 'month',
  sources: Record<string, boolean>,
) {
  const q = new URLSearchParams({
    anchor: anchorIso(anchor),
    sources: sourcesParam(sources),
  });
  const data = await apiJson<{ events?: CalEvent[] }>(`/api/calendar/view/${view}?${q}`);
  return data.events ?? [];
}

/** Public booking page URL (not the API POST endpoint). */
export function publicBookingPageUrl(slug: string) {
  const s = String(slug || '').trim();
  return `${window.location.origin}/dashboard/book/${encodeURIComponent(s)}`;
}

export async function fetchInsights(anchor: Date) {
  const q = new URLSearchParams({ anchor: anchorIso(anchor) });
  return apiJson<CalendarInsightsPayload>(`/api/calendar/insights?${q}`);
}

export async function fetchBookingPages() {
  const data = await apiJson<{ pages?: BookingPage[] }>('/api/calendar/booking-pages');
  return data.pages ?? [];
}

export async function createBookingPage(payload: {
  title: string;
  slug?: string;
  duration_min?: number;
  description?: string;
  location?: string;
}) {
  return apiJson<{ success?: boolean; id?: string; slug?: string; error?: string }>(
    '/api/calendar/booking-pages',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
}

export async function updateBookingPage(
  id: string,
  payload: Partial<Pick<BookingPage, 'title' | 'slug' | 'duration_min' | 'description' | 'location'>> & {
    is_active?: boolean;
  },
) {
  return apiJson<{ success?: boolean; page?: BookingPage; error?: string }>(
    `/api/calendar/booking-pages/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
}

export async function deleteBookingPage(id: string) {
  return apiJson<{ success?: boolean; deactivated?: boolean; error?: string }>(
    `/api/calendar/booking-pages/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
}

export type CalendarPreferencesPayload = {
  working_hours: {
    timezone: string;
    start_minutes: number;
    end_minutes: number;
    work_days_json?: string;
  };
};

export async function fetchCalendarPreferences() {
  return apiJson<CalendarPreferencesPayload>('/api/calendar/preferences');
}

export async function saveCalendarPreferences(working_hours: CalendarPreferencesPayload['working_hours']) {
  return apiJson<{ working_hours?: CalendarPreferencesPayload['working_hours'] }>(
    '/api/calendar/preferences',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ working_hours }),
    },
  );
}

export async function fetchPeople(q: string) {
  const data = await apiJson<{ contacts?: CalendarPerson[] }>(
    `/api/user/contacts?q=${encodeURIComponent(q)}`,
  );
  return data.contacts ?? [];
}

export interface UserNote {
  id: string;
  title: string;
  body: string;
  color?: string | null;
  pinned?: boolean;
  created_at?: string;
  updated_at?: string;
}

export async function fetchUserNotes() {
  const data = await apiJson<{ notes?: UserNote[] }>('/api/user/notes');
  return data.notes ?? [];
}

export async function createUserNote(payload: { title?: string; body: string }) {
  return apiJson<{ ok: boolean; note: UserNote }>('/api/user/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function patchUserNote(id: string, payload: Partial<{ title: string; body: string; pinned: boolean }>) {
  return apiJson<{ ok: boolean; note: UserNote }>(`/api/user/notes/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function deleteUserNote(id: string) {
  return apiJson<{ ok: boolean }>(`/api/user/notes/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function createUserContact(payload: {
  display_name: string;
  username?: string;
  email?: string;
  phone?: string;
  avatar_url?: string;
  description?: string;
}) {
  return apiJson<{ ok: boolean; contact: CalendarPerson }>('/api/user/contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function patchUserContact(
  id: string,
  payload: Partial<{
    display_name: string;
    username: string;
    email: string;
    phone: string;
    avatar_url: string;
    description: string;
  }>,
) {
  return apiJson<{ ok: boolean; contact: CalendarPerson }>(`/api/user/contacts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function deleteUserContact(id: string) {
  return apiJson<{ ok: boolean }>(`/api/user/contacts/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function fetchProjects(opts?: { clientId?: string | null; clientWork?: boolean }) {
  const params = new URLSearchParams();
  if (opts?.clientId?.trim()) params.set('client_id', opts.clientId.trim());
  if (opts?.clientWork) params.set('client_work', '1');
  const qs = params.toString();
  const data = await apiJson<{ projects?: ProjectRow[] }>(`/api/projects${qs ? `?${qs}` : ''}`);
  return data.projects ?? [];
}

export async function fetchClientProjects() {
  const data = await apiJson<{ clients?: ClientProjectRow[] }>('/api/projects/clients');
  return data.clients ?? [];
}

export async function fetchTasksInsights(anchor: Date, projectId?: string | null) {
  const q = new URLSearchParams({ anchor: anchorIso(anchor) });
  if (projectId?.trim()) q.set('project_id', projectId.trim());
  return apiJson<TasksInsightsPayload>(`/api/calendar/tasks-insights?${q}`);
}

export type GoogleCalendarStatusPayload = {
  connected: boolean;
  accounts: {
    account: string;
    last_sync_at?: string | null;
    last_sync_count?: number;
    event_count?: number;
    write_scope?: boolean;
    needs_reconnect?: boolean;
  }[];
};

export async function fetchGoogleCalendarStatus() {
  return apiJson<GoogleCalendarStatusPayload>('/api/calendar/google/status');
}

export async function postGoogleCalendarSync() {
  return apiJson<{ ok: boolean; synced?: number; accounts?: number; error?: string }>(
    '/api/calendar/google/sync',
    { method: 'POST' },
  );
}

export async function postProjectTimer(payload: {
  action: 'start' | 'stop';
  project_id: string;
}) {
  return apiJson<{
    ok?: boolean;
    action?: string;
    entry_id?: string;
    entry?: { id: string; duration_seconds?: number };
    error?: string;
  }>('/api/calendar/project-timer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function postActivityStop() {
  return apiJson<{ ok?: boolean; closed?: number }>('/api/calendar/activity/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

export async function postActivityHeartbeat(payload: {
  project_id?: string | null;
  todo_id?: string | null;
  surface?: string;
}) {
  return apiJson<{ ok?: boolean }>('/api/calendar/activity/heartbeat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function postManualTimeEntry(payload: {
  project_id: string;
  todo_id?: string | null;
  minutes: number;
  note?: string | null;
  entry_date?: string | null;
}) {
  return apiJson<{ ok?: boolean; entry_id?: string; minutes?: number }>('/api/calendar/time-entry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function fetchTodos(opts?: {
  projectId?: string | null;
  category?: string | null;
  clientId?: string | null;
  clientWork?: boolean;
  includeLegacy?: boolean;
}) {
  const params = new URLSearchParams();
  if (opts?.projectId?.trim()) params.set('project_id', opts.projectId.trim());
  if (opts?.category?.trim()) params.set('category', opts.category.trim());
  if (opts?.clientId?.trim()) params.set('client_id', opts.clientId.trim());
  if (opts?.clientWork) params.set('client_work', '1');
  if (opts?.includeLegacy) params.set('include_legacy', '1');
  const qs = params.toString();
  const data = await apiJson<{ todos?: AgentTodo[] }>(`/api/agent/todo${qs ? `?${qs}` : ''}`);
  return data.todos ?? [];
}
