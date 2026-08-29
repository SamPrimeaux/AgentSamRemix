import type { KanbanColumn, KanbanTask } from "../../../client-api/kanban";
import type { BoardTask, ColumnDef, TaskStatus } from "./types";
import { columnNameToStatus, kanbanPriorityToP } from "./types";

function assigneeDisplay(assigneeId: string | null | undefined): string | undefined {
  const raw = assigneeId?.trim();
  if (!raw) return undefined;
  // Never hardcode au_* → person names (identity law). Prefer email local-part; else show id.
  if (raw.includes('@')) {
    const local = raw.split('@')[0] || raw;
    return local
      .replace(/[._-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  }
  return raw;
}

export function parseColumnStatus(column: KanbanColumn): TaskStatus {
  try {
    const cfg = column.config_json ? JSON.parse(String(column.config_json)) : {};
    if (cfg?.status && typeof cfg.status === "string") {
      return columnNameToStatus(cfg.status);
    }
  } catch {
    /* ignore */
  }
  return columnNameToStatus(column.name);
}

export function buildColumnDefs(apiColumns: KanbanColumn[]): ColumnDef[] {
  const hints: Record<TaskStatus, string> = {
    backlog: "Captured work",
    todo: "Ready to start",
    in_progress: "Actively moving",
    testing: "Validate before merge",
    awaiting_approval: "Needs owner gate",
    complete: "Closed this cycle",
    blocked: "Requires action",
  };

  const ordered = [...apiColumns].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const defs: ColumnDef[] = [];
  for (const col of ordered) {
    const status = parseColumnStatus(col);
    if (status === "blocked") continue;
    if (defs.some((d) => d.id === status)) continue;
    defs.push({ id: status, title: col.name, hint: hints[status] || "Column" });
  }
  return defs.length ? defs : [];
}

export function mapKanbanTaskToBoardTask(
  task: KanbanTask,
  columnById: Map<string, KanbanColumn>,
): BoardTask {
  const col = task.column_id ? columnById.get(task.column_id) : null;
  const status = col ? parseColumnStatus(col) : "todo";
  const tags = task.tags
    ? String(task.tags)
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  let dueLabel: string | undefined;
  if (task.due_date) {
    dueLabel = new Date(task.due_date * 1000).toLocaleDateString();
  }

  return {
    id: task.id,
    title: task.title,
    description: task.description || "",
    status,
    priority: kanbanPriorityToP(task.priority),
    tags,
    source: "kanban",
    assignee_name: assigneeDisplay(task.assignee_id),
    project_name: task.client_name || undefined,
    column_id: task.column_id,
    due_date: dueLabel,
    agentsam_todo_id: task.todo_id || undefined,
    created_at: task.created_at ? new Date(task.created_at * 1000).toISOString() : new Date().toISOString(),
    updated_at: task.updated_at ? new Date(task.updated_at * 1000).toISOString() : new Date().toISOString(),
  };
}

export function statusToColumnId(status: TaskStatus, apiColumns: KanbanColumn[]): string | null {
  for (const col of apiColumns) {
    if (parseColumnStatus(col) === status) return col.id;
  }
  return null;
}
