export type TaskPriority = "P0" | "P1" | "P2" | "P3";
export type TaskStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "testing"
  | "awaiting_approval"
  | "complete"
  | "blocked";

export type TaskSource = "manual" | "agent_sam" | "cursor" | "workflow" | "deploy" | "kanban";

export type BoardTask = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  project_name?: string;
  owner_name?: string;
  workspace_id?: string;
  assignee_name?: string;
  due_date?: string;
  estimate_hours?: number;
  tracked_hours?: number;
  tags: string[];
  source: TaskSource;
  approval_required?: boolean;
  blocked_reason?: string;
  agentsam_todo_id?: string;
  workflow_run_id?: string;
  column_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type ColumnDef = {
  id: TaskStatus;
  title: string;
  hint: string;
};

export const KANBAN_COLUMNS: ColumnDef[] = [
  { id: "backlog", title: "Backlog", hint: "Captured work" },
  { id: "todo", title: "To Do", hint: "Ready to start" },
  { id: "in_progress", title: "In Progress", hint: "Actively moving" },
  { id: "testing", title: "Testing", hint: "Validate before merge" },
  { id: "awaiting_approval", title: "Awaiting Approval", hint: "Needs owner gate" },
  { id: "complete", title: "Complete", hint: "Closed this cycle" },
];

export const statusLabel: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "To Do",
  in_progress: "In Progress",
  testing: "Testing",
  awaiting_approval: "Awaiting Approval",
  complete: "Complete",
  blocked: "Blocked",
};

export const priorityClass: Record<TaskPriority, string> = {
  P0: "border-rose-400/35 bg-rose-400/10 text-rose-200",
  P1: "border-amber-400/35 bg-amber-400/10 text-amber-200",
  P2: "border-cyan-400/35 bg-cyan-400/10 text-cyan-200",
  P3: "border-slate-400/25 bg-slate-400/10 text-slate-300",
};

export const sourceClass: Record<TaskSource, string> = {
  manual: "bg-slate-400/15 text-slate-300",
  agent_sam: "bg-cyan-400/15 text-cyan-200",
  cursor: "bg-violet-400/15 text-violet-200",
  workflow: "bg-emerald-400/15 text-emerald-200",
  deploy: "bg-amber-400/15 text-amber-200",
  kanban: "bg-slate-400/15 text-slate-300",
};

export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function statusTone(status: TaskStatus) {
  if (status === "complete") return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
  if (status === "blocked") return "border-rose-400/30 bg-rose-400/10 text-rose-200";
  if (status === "awaiting_approval") return "border-amber-400/30 bg-amber-400/10 text-amber-200";
  if (status === "testing") return "border-sky-400/30 bg-sky-400/10 text-sky-200";
  if (status === "in_progress") return "border-cyan-400/30 bg-cyan-400/10 text-cyan-200";
  return "border-white/10 bg-white/[0.04] text-slate-300";
}

const COLUMN_NAME_TO_STATUS: Record<string, TaskStatus> = {
  backlog: "backlog",
  "to do": "todo",
  todo: "todo",
  "in progress": "in_progress",
  testing: "testing",
  "awaiting approval": "awaiting_approval",
  complete: "complete",
  blocked: "blocked",
};

export function columnNameToStatus(name: string): TaskStatus {
  const key = String(name || "")
    .trim()
    .toLowerCase();
  return COLUMN_NAME_TO_STATUS[key] ?? "todo";
}

export function kanbanPriorityToP(priority: string | null | undefined): TaskPriority {
  const p = String(priority || "medium").toLowerCase();
  if (p === "urgent" || p === "critical" || p === "p0") return "P0";
  if (p === "high" || p === "p1") return "P1";
  if (p === "low" || p === "p3") return "P3";
  return "P2";
}

export function planPriorityToP(priority: string | null | undefined): TaskPriority {
  const p = String(priority || "P2").toUpperCase();
  if (p === "P0" || p === "P1" || p === "P2" || p === "P3") return p;
  return "P2";
}
