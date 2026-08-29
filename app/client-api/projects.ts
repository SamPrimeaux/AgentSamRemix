import { removeProjectFromIamProjectsCache } from '../src/iamProjectsCache';

export type ProjectKpis = {
  active_projects: number;
  open_tasks: number;
  blocked: number;
  avg_health: number;
  budget_burn: number;
  budget_allocated: number;
  this_week_hours: number;
};

export type OverviewProject = {
  id: string;
  name: string;
  client: string;
  client_name: string;
  owner: string;
  stage: string;
  description: string;
  status: string;
  status_raw: string;
  priority: string;
  priority_num: number;
  project_type: string;
  progress: number;
  health: number;
  budgetUsed: number;
  budgetTotal: number;
  budget_allocated_workspace: number;
  dueDate: string;
  lastDeploy: string;
  activeTasks: number;
  blockedTasks: number;
  completedTasks: number;
  totalTasks: number;
  openIssueCount: number;
  tags: string[];
  workspace_id: string | null;
  tenant_id: string | null;
  cover_image_url?: string | null;
  chat_project_id?: string | null;
  is_pinned?: boolean;
  owner_user_id?: string | null;
  updated_at?: string | null;
  github_repo?: string | null;
  progress_source?: 'tasks' | 'code_index' | string | null;
  code_index?: {
    run_id?: string;
    status?: string;
    progress_percent?: number;
    github_repo?: string | null;
    indexed_file_count?: number;
    file_count?: number;
    stage?: string | null;
    skipped_unchanged?: number;
    label?: string | null;
    updated_at?: number | string | null;
  } | null;
};

export type OverviewMilestone = {
  id: string;
  projectId: string;
  title: string;
  date: string;
  status: string;
};

export type WorkloadSlice = { name: string; value: number };
export type StatusCount = { status: string; count: number };
export type VelocityDay = { day: string; completed: number; added: number; blocked: number };
export type BurnDay = { date: string; planned: number; actual: number };

export type PriorityTask = {
  id: string;
  title: string;
  projectId: string;
  owner: string;
  status: string;
  priority: string;
  due: string;
  estimateHours: number;
};

export type ProjectsOverviewResponse = {
  ok: boolean;
  kpis: ProjectKpis;
  projects: OverviewProject[];
  milestones: OverviewMilestone[];
  workload_mix: WorkloadSlice[];
  status_counts: StatusCount[];
  velocity_week?: VelocityDay[];
  burn_week?: BurnDay[];
  priority_tasks?: PriorityTask[];
  updated_at: string;
  error?: string;
};

export type CreateProjectPayload = {
  name: string;
  description?: string;
  client_name?: string;
  project_type?: string;
  status?: string;
  priority?: number;
  workspace_id: string;
  budget_usd?: number;
  tags?: string[];
  domain?: string;
  worker_id?: string;
  d1_databases?: string;
  r2_buckets?: string;
  target_launch_date?: string;
  accessibility_target?: string;
  performance_budget?: string;
};

function qs(workspaceId?: string | null) {
  if (!workspaceId?.trim()) return "";
  return `?workspace_id=${encodeURIComponent(workspaceId.trim())}`;
}

export type ProjectListRow = {
  id: string;
  name: string;
  description?: string | null;
  client_name?: string | null;
  status?: string | null;
  priority?: number | null;
  priority_num?: number | null;
  priority_label?: string | null;
  is_pinned?: boolean | null;
  project_type?: string | null;
  workspace_id?: string | null;
  tenant_id?: string | null;
  tags_json?: string | null;
  metadata_json?: string | null;
  cover_image_url?: string | null;
  chat_project_id?: string | null;
  launch_date?: string | null;
  estimated_completion_date?: number | null;
  owner_user_id?: string | null;
  updated_at?: string | null;
  progress?: number | null;
  progress_source?: string | null;
  github_repo?: string | null;
  code_index?: OverviewProject['code_index'];
};

function priorityToLabel(n: number) {
  const p = Number(n) || 0;
  if (p >= 80) return "P0";
  if (p >= 60) return "P1";
  if (p >= 40) return "P2";
  return "P3";
}

function mapDbStatusToUi(status: string | null | undefined) {
  const s = String(status || "").toLowerCase();
  if (s === "blocked" || s === "maintenance") return "blocked";
  if (s === "complete" || s === "archived") return "complete";
  if (s === "review" || s === "staging") return "review";
  if (s === "planning" || s === "discovery") return "planning";
  if (s === "development" || s === "active" || s === "production") return "active";
  return "planning";
}

function safeJsonArray(text: unknown, fallback: string[] = []) {
  try {
    const v = JSON.parse(String(text || "null"));
    return Array.isArray(v) ? v.map(String) : fallback;
  } catch {
    return fallback;
  }
}

/** Lightweight list row → grid card shape (no KPI/plan-task fan-out). */
export function mapListRowToOverview(row: ProjectListRow): OverviewProject {
  const tags = safeJsonArray(row.tags_json, []);
  const dueTs = row.estimated_completion_date;
  return {
    id: String(row.id),
    name: String(row.name || "Untitled"),
    client: row.client_name || "",
    client_name: row.client_name || "",
    owner: "",
    stage: row.description ? String(row.description).slice(0, 120) : "",
    description: row.description || "",
    status: mapDbStatusToUi(row.status),
    status_raw: row.status || "",
    priority: row.priority_label || priorityToLabel(Number(row.priority_num ?? row.priority) || 0),
    priority_num: Number(row.priority_num ?? row.priority) || 0,
    project_type: row.project_type || "",
    progress: Number(row.progress) || 0,
    progress_source: row.progress_source || (row.code_index ? "code_index" : null),
    github_repo: row.github_repo || null,
    code_index: row.code_index ?? null,
    health: 0,
    budgetUsed: 0,
    budgetTotal: 1,
    budget_allocated_workspace: 0,
    dueDate: dueTs
      ? new Date(Number(dueTs) * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : row.launch_date || "—",
    lastDeploy: "—",
    activeTasks: 0,
    blockedTasks: 0,
    completedTasks: 0,
    totalTasks: 0,
    openIssueCount: 0,
    tags,
    workspace_id: row.workspace_id || null,
    tenant_id: row.tenant_id || null,
    cover_image_url: row.cover_image_url || null,
    chat_project_id: row.chat_project_id || null,
    owner_user_id: row.owner_user_id ?? null,
    updated_at: row.updated_at ?? null,
    is_pinned: row.is_pinned === true,
  };
}

export type FetchProjectsListOptions = {
  workspaceId?: string | null;
  /** Tenant-wide list (all workspaces) — for cleanup / audit grids. */
  scope?: "tenant" | "workspace";
  includeArchived?: boolean;
};

function projectsListQuery(opts?: FetchProjectsListOptions) {
  const params = new URLSearchParams();
  if (opts?.workspaceId?.trim()) params.set("workspace_id", opts.workspaceId.trim());
  if (opts?.scope === "tenant") params.set("scope", "tenant");
  if (opts?.includeArchived) params.set("include_archived", "1");
  const q = params.toString();
  return q ? `?${q}` : "";
}

export async function fetchProjectsList(
  workspaceIdOrOpts?: string | null | FetchProjectsListOptions,
): Promise<{ ok: boolean; projects: OverviewProject[]; error?: string }> {
  const opts: FetchProjectsListOptions =
    workspaceIdOrOpts != null && typeof workspaceIdOrOpts === "object"
      ? workspaceIdOrOpts
      : { workspaceId: workspaceIdOrOpts ?? null };
  const controller = new AbortController();
  const timeoutMs = 25_000;
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(`/api/projects${projectsListQuery(opts)}`, {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    });
    const j = (await r.json()) as { ok?: boolean; success?: boolean; projects?: ProjectListRow[]; error?: string };
    if (!r.ok) return { ok: false, projects: [], error: j.error || `HTTP ${r.status}` };
    const rows = Array.isArray(j.projects) ? j.projects : [];
    return { ok: true, projects: rows.map(mapListRowToOverview) };
  } catch (e) {
    const msg =
      e instanceof DOMException && e.name === "AbortError"
        ? "Projects request timed out"
        : e instanceof Error
          ? e.message
          : "Failed to load projects";
    return { ok: false, projects: [], error: msg };
  } finally {
    window.clearTimeout(timer);
  }
}

export async function fetchProjectsOverview(workspaceId?: string | null): Promise<ProjectsOverviewResponse> {
  const r = await fetch(`/api/projects/overview${qs(workspaceId)}`, { credentials: "same-origin" });
  const j = (await r.json()) as ProjectsOverviewResponse;
  if (!r.ok) return { ...j, ok: false, error: j.error || `HTTP ${r.status}` };
  return j;
}

export async function createProject(payload: CreateProjectPayload): Promise<{ ok: boolean; project?: unknown; error?: string }> {
  const r = await fetch("/api/projects", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = (await r.json()) as { ok: boolean; project?: unknown; error?: string };
  if (!r.ok) return { ok: false, error: j.error || `HTTP ${r.status}` };
  return j;
}

export async function updateProject(
  id: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; project?: unknown; error?: string }> {
  const r = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = (await r.json()) as { ok: boolean; project?: unknown; error?: string };
  if (!r.ok) return { ok: false, error: j.error || `HTTP ${r.status}` };
  return j;
}

export async function setProjectPinned(
  id: string,
  pinned: boolean,
): Promise<{ ok: boolean; project?: unknown; error?: string }> {
  return updateProject(id, { is_pinned: pinned });
}

export async function deleteProject(
  id: string,
  opts?: { workspaceId?: string },
): Promise<{ ok: boolean; error?: string; deleted?: boolean }> {
  const r = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "same-origin",
    cache: "no-store",
  });
  const j = (await r.json()) as { ok: boolean; error?: string; deleted?: boolean };
  if (!r.ok) return { ok: false, error: j.error || `HTTP ${r.status}` };
  if (j.ok && opts?.workspaceId) {
    removeProjectFromIamProjectsCache(opts.workspaceId, id);
  }
  return j;
}

export type ProjectCollaborator = {
  id: string;
  project_id: string;
  email: string;
  role: string;
  user_id?: string | null;
  invited_by?: string | null;
  workspace_id?: string | null;
  created_at?: number;
  updated_at?: number;
};

export type ProjectMemoryPayload = {
  ok: boolean;
  memory?: string;
  instructions?: string;
  updated_at?: number | null;
  runtime_contract_sync?: {
    ok: boolean;
    rule_key?: string | null;
    unchanged?: boolean;
    content_hash?: string | null;
    body_chars?: number | null;
    error?: string | null;
    hint?: string | null;
  };
  error?: string;
};

export type ProjectContextAuditRow = {
  id: string;
  name: string;
  status?: string | null;
  project_type?: string | null;
  workspace_id?: string | null;
  client_id?: string | null;
  rule_key?: string | null;
  rule_synced?: boolean;
  rule_body_chars?: number;
  memory_chars?: number;
  instructions_chars?: number;
  bindings?: {
    workspace_slug?: string | null;
    worker_name?: string | null;
    r2_bucket?: string | null;
    r2_prefix?: string | null;
    d1_database_id?: string | null;
    github_repo?: string | null;
    deploy_url?: string | null;
  } | null;
};

export async function fetchProjectMemory(projectId: string): Promise<ProjectMemoryPayload> {
  const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/memory`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  const j = (await r.json()) as ProjectMemoryPayload;
  if (!r.ok) return { ok: false, error: j.error || `HTTP ${r.status}` };
  return j;
}

export async function updateProjectMemory(
  projectId: string,
  payload: { memory?: string; instructions?: string },
): Promise<ProjectMemoryPayload> {
  const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/memory`, {
    method: "PATCH",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = (await r.json()) as ProjectMemoryPayload;
  if (!r.ok) return { ok: false, error: j.error || `HTTP ${r.status}` };
  return j;
}

export async function fetchProjectContextAudit(opts?: {
  scope?: 'tenant' | 'all';
  includeArchived?: boolean;
}): Promise<{ ok: boolean; projects: ProjectContextAuditRow[]; error?: string }> {
  const params = new URLSearchParams();
  params.set('scope', opts?.scope || 'tenant');
  if (opts?.includeArchived) params.set('include_archived', '1');
  const r = await fetch(`/api/projects/context-audit?${params}`, {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const j = (await r.json()) as { ok?: boolean; projects?: ProjectContextAuditRow[]; error?: string };
  if (!r.ok) return { ok: false, projects: [], error: j.error || `HTTP ${r.status}` };
  return { ok: true, projects: Array.isArray(j.projects) ? j.projects : [] };
}

export async function fetchProjectCollaborators(projectId: string): Promise<{
  ok: boolean;
  collaborators: ProjectCollaborator[];
  error?: string;
}> {
  const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/collaborators`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  const j = (await r.json()) as { ok?: boolean; collaborators?: ProjectCollaborator[]; error?: string };
  if (!r.ok) return { ok: false, collaborators: [], error: j.error || `HTTP ${r.status}` };
  return { ok: true, collaborators: Array.isArray(j.collaborators) ? j.collaborators : [] };
}

export async function inviteProjectCollaborator(
  projectId: string,
  payload: { email: string; role?: "editor" | "viewer" },
): Promise<{ ok: boolean; error?: string; collaborator?: ProjectCollaborator | null }> {
  const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/collaborators`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = (await r.json()) as { ok?: boolean; error?: string; collaborator?: ProjectCollaborator | null };
  if (!r.ok) return { ok: false, error: j.error || `HTTP ${r.status}` };
  return { ok: true, collaborator: j.collaborator ?? null };
}

export async function removeProjectCollaborator(
  projectId: string,
  collaboratorId: string,
): Promise<{ ok: boolean; error?: string }> {
  const r = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/collaborators/${encodeURIComponent(collaboratorId)}`,
    { method: "DELETE", credentials: "same-origin", cache: "no-store" },
  );
  const j = (await r.json()) as { ok?: boolean; error?: string };
  if (!r.ok) return { ok: false, error: j.error || `HTTP ${r.status}` };
  return { ok: true };
}

export async function shareProject(
  projectId: string,
  payload: { email?: string; emails?: string[]; message?: string; role?: "editor" | "viewer" },
): Promise<{
  ok: boolean;
  share_url?: string;
  collaborators?: ProjectCollaborator[];
  email_errors?: Array<{ email: string; error: string }>;
  error?: string;
}> {
  const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/share`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = (await r.json()) as {
    ok?: boolean;
    share_url?: string;
    collaborators?: ProjectCollaborator[];
    email_errors?: Array<{ email: string; error: string }>;
    error?: string;
  };
  if (!r.ok) return { ok: false, error: j.error || `HTTP ${r.status}` };
  return {
    ok: true,
    share_url: j.share_url,
    collaborators: j.collaborators,
    email_errors: j.email_errors,
  };
}
