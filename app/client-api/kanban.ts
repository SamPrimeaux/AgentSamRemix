export type KanbanBoard = {
  id: string;
  name: string;
  workspace_id?: string | null;
  project_id?: string | null;
  board_type?: string | null;
};

export type KanbanColumn = {
  id: string;
  board_id: string;
  name: string;
  position: number;
  color?: string | null;
  config_json?: string | null;
};

export type KanbanTask = {
  id: string;
  board_id: string | null;
  column_id: string | null;
  project_id?: string | null;
  title: string;
  description?: string | null;
  category?: string | null;
  priority: string;
  assignee_id?: string | null;
  client_name?: string | null;
  tags?: string | null;
  position: number;
  due_date?: number | null;
  completed_at?: number | null;
  todo_id?: string | null;
};

function qs(params: Record<string, string | null | undefined>) {
  const parts = Object.entries(params)
    .filter(([, v]) => v != null && String(v).trim())
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v).trim())}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

export async function fetchKanbanBoards(workspaceId: string | null): Promise<{ ok: boolean; boards?: KanbanBoard[]; error?: string }> {
  const r = await fetch(`/api/kanban/boards${qs({ workspace_id: workspaceId })}`, { credentials: "same-origin" });
  const j = (await r.json()) as { ok: boolean; boards?: KanbanBoard[]; error?: string };
  if (!r.ok) return { ok: false, error: j.error || `HTTP ${r.status}` };
  return j;
}

export async function fetchKanbanColumns(
  boardId: string,
  workspaceId?: string | null,
): Promise<{ ok: boolean; columns?: KanbanColumn[]; error?: string }> {
  const r = await fetch(
    `/api/kanban/columns${qs({ board_id: boardId, workspace_id: workspaceId })}`,
    { credentials: "same-origin" },
  );
  const j = (await r.json()) as { ok: boolean; columns?: KanbanColumn[]; error?: string };
  if (!r.ok) return { ok: false, error: j.error || `HTTP ${r.status}` };
  return j;
}

export async function fetchKanbanTasks(opts: {
  boardId?: string | null;
  projectId?: string | null;
  workspaceId?: string | null;
}): Promise<{ ok: boolean; tasks?: KanbanTask[]; error?: string }> {
  const r = await fetch(
    `/api/kanban/tasks${qs({
      board_id: opts.boardId,
      project_id: opts.projectId,
      workspace_id: opts.workspaceId,
    })}`,
    { credentials: "same-origin" },
  );
  const j = (await r.json()) as { ok: boolean; tasks?: KanbanTask[]; error?: string };
  if (!r.ok) return { ok: false, error: j.error || `HTTP ${r.status}` };
  return j;
}

export async function createKanbanTask(opts: {
  title: string;
  workspaceId?: string | null;
  projectId?: string | null;
  boardId?: string | null;
  description?: string;
}): Promise<{ ok: boolean; task?: KanbanTask; error?: string }> {
  const r = await fetch(`/api/kanban/tasks${qs({ workspace_id: opts.workspaceId })}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: opts.title,
      project_id: opts.projectId,
      board_id: opts.boardId,
      description: opts.description,
    }),
  });
  const j = (await r.json()) as { ok: boolean; task?: KanbanTask; error?: string };
  if (!r.ok) return { ok: false, error: j.error || `HTTP ${r.status}` };
  return j;
}

export async function patchKanbanTask(
  id: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; task?: KanbanTask; error?: string }> {
  const r = await fetch(`/api/kanban/tasks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = (await r.json()) as { ok: boolean; task?: KanbanTask; error?: string };
  if (!r.ok) return { ok: false, error: j.error || `HTTP ${r.status}` };
  return j;
}

export type TaskActivityEntry = {
  id: string;
  task_id: string;
  tenant_id: string;
  user_id?: string | null;
  action: string;
  changes_json?: string | null;
  created_at: number;
};

export type TaskComment = {
  id: string;
  task_id: string;
  tenant_id: string;
  user_id: string;
  content: string;
  metadata_json?: string | null;
  created_at: number;
  updated_at: number;
};

export type TaskAttachment = {
  id: string;
  task_id: string;
  file_name: string;
  file_key: string;
  file_size?: number | null;
  content_type?: string | null;
  created_at?: string | null;
  url?: string;
};

export async function fetchTaskActivity(taskId: string): Promise<{ ok: boolean; activity?: TaskActivityEntry[]; error?: string }> {
  const r = await fetch(`/api/kanban/tasks/${encodeURIComponent(taskId)}/activity`, { credentials: "same-origin" });
  const j = (await r.json()) as { ok: boolean; activity?: TaskActivityEntry[]; error?: string };
  if (!r.ok) return { ok: false, error: j.error || `HTTP ${r.status}` };
  return j;
}

export async function fetchTaskComments(taskId: string): Promise<{ ok: boolean; comments?: TaskComment[]; error?: string }> {
  const r = await fetch(`/api/kanban/tasks/${encodeURIComponent(taskId)}/comments`, { credentials: "same-origin" });
  const j = (await r.json()) as { ok: boolean; comments?: TaskComment[]; error?: string };
  if (!r.ok) return { ok: false, error: j.error || `HTTP ${r.status}` };
  return j;
}

export async function postTaskComment(taskId: string, content: string): Promise<{ ok: boolean; comment?: TaskComment; error?: string }> {
  const r = await fetch(`/api/kanban/tasks/${encodeURIComponent(taskId)}/comments`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  const j = (await r.json()) as { ok: boolean; comment?: TaskComment; error?: string };
  if (!r.ok) return { ok: false, error: j.error || `HTTP ${r.status}` };
  return j;
}

export async function fetchTaskAttachments(taskId: string): Promise<{ ok: boolean; attachments?: TaskAttachment[]; error?: string }> {
  const r = await fetch(`/api/kanban/tasks/${encodeURIComponent(taskId)}/attachments`, { credentials: "same-origin" });
  const j = (await r.json()) as { ok: boolean; attachments?: TaskAttachment[]; error?: string };
  if (!r.ok) return { ok: false, error: j.error || `HTTP ${r.status}` };
  return j;
}

export async function uploadTaskAttachment(taskId: string, file: File): Promise<{ ok: boolean; attachment?: TaskAttachment; error?: string }> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(`/api/kanban/tasks/${encodeURIComponent(taskId)}/attachments`, {
    method: "POST",
    credentials: "same-origin",
    body: fd,
  });
  const j = (await r.json()) as { ok: boolean; attachment?: TaskAttachment; error?: string };
  if (!r.ok) return { ok: false, error: j.error || `HTTP ${r.status}` };
  return j;
}
