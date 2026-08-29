import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock3,
  Filter,
  GitBranch,
  Layers3,
  ListChecks,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import KanbanBoard from "../../src/components/kanban/KanbanBoard";
import TaskDetailPanel from "../../src/components/kanban/TaskDetailPanel";
import type { BoardTask, TaskPriority, TaskStatus } from "../../src/components/kanban/types";
import { KANBAN_COLUMNS, cx, priorityClass, statusLabel } from "../../src/components/kanban/types";

/** UI seed only: wire to Kanban API + session workspace; never hardcode real tenant/workspace ids here. */
const DEMO_WORKSPACE = "";

const initialTasks: BoardTask[] = [
  {
    id: "task_dashboard_projects",
    title: "Finalize Project Management page install",
    description: "Verify route, shell rendering, R2 upload path, and production bundle visibility for /dashboard/projects.",
    status: "testing",
    priority: "P0",
    project_name: "Agent Sam Dashboard",
    workspace_id: DEMO_WORKSPACE,
    owner_name: "Sam",
    assignee_name: "Agent Sam",
    due_date: "Today",
    estimate_hours: 2,
    tracked_hours: 0.8,
    tags: ["dashboard", "vite", "r2"],
    source: "manual",
    workflow_run_id: "wf_projects_page_v1",
    created_at: "2026-05-10T15:00:00Z",
    updated_at: "2026-05-10T20:00:00Z",
  },
  {
    id: "task_overview_bundle",
    title: "Ship Overview bundle endpoint + modular panels",
    description: "Confirm /api/overview/dashboard-bundle responds and new overview panels are loaded by the live dashboard bundle.",
    status: "in_progress",
    priority: "P0",
    project_name: "Agent Sam Analytics",
    workspace_id: DEMO_WORKSPACE,
    owner_name: "Sam",
    assignee_name: "Cursor",
    due_date: "Today",
    estimate_hours: 4,
    tracked_hours: 2.4,
    tags: ["overview", "analytics", "api"],
    source: "cursor",
    agentsam_todo_id: "todo_overview_modularization",
    workflow_run_id: "wf_overview_bundle",
    created_at: "2026-05-10T14:00:00Z",
    updated_at: "2026-05-10T20:10:00Z",
  },
  {
    id: "task_r2_bundle_path",
    title: "Resolve stale frontend deploy path",
    description: "Identify whether production loads static/dashboard/agent or static/dashboard/app and make deploy scripts update the correct bundle every time.",
    status: "blocked",
    priority: "P0",
    project_name: "Dashboard Infrastructure",
    workspace_id: DEMO_WORKSPACE,
    owner_name: "Sam",
    assignee_name: "Agent Sam",
    due_date: "Today",
    estimate_hours: 3,
    tracked_hours: 1.1,
    tags: ["cloudflare", "r2", "deploy"],
    source: "deploy",
    blocked_reason: "Live browser appears to load stale shell/chunks after successful Worker deploys.",
    created_at: "2026-05-10T13:00:00Z",
    updated_at: "2026-05-10T20:12:00Z",
  },
  {
    id: "task_kanban_api",
    title: "Create Kanban API over existing D1 tables",
    description: "Use kanban_boards, kanban_columns, and kanban_tasks with tenant/workspace authorization. Do not create duplicate schema.",
    status: "backlog",
    priority: "P1",
    project_name: "Agent Sam Task System",
    workspace_id: DEMO_WORKSPACE,
    owner_name: "Sam",
    assignee_name: "Agent Sam",
    due_date: "May 12",
    estimate_hours: 5,
    tracked_hours: 0,
    tags: ["d1", "kanban", "workspace"],
    source: "workflow",
    agentsam_todo_id: "todo_kanban_api_v1",
    created_at: "2026-05-10T12:00:00Z",
    updated_at: "2026-05-10T19:00:00Z",
  },
  {
    id: "task_pintest_v3",
    title: "Register observability pintest v3",
    description: "Add repeatable script and agentsam_scripts row for 8/8 observability table validation.",
    status: "awaiting_approval",
    priority: "P1",
    project_name: "Agent Sam Observability",
    workspace_id: DEMO_WORKSPACE,
    owner_name: "Sam",
    assignee_name: "Cursor",
    due_date: "Tomorrow",
    estimate_hours: 1,
    tracked_hours: 0.4,
    tags: ["pintest", "observability", "scripts"],
    source: "agent_sam",
    approval_required: true,
    agentsam_todo_id: "todo_observability_pintest_v3",
    created_at: "2026-05-10T16:00:00Z",
    updated_at: "2026-05-10T20:09:00Z",
  },
  {
    id: "task_cpas_board_demo",
    title: "Polish CPAS board-demo dashboard",
    description: "Make donation, animal, adoption, and CMS demo panels feel board-ready.",
    status: "todo",
    priority: "P0",
    project_name: "Companions of CPAS",
    workspace_id: DEMO_WORKSPACE,
    owner_name: "Sam",
    assignee_name: "Sam",
    due_date: "Tomorrow",
    estimate_hours: 6,
    tracked_hours: 1.5,
    tags: ["client", "cms", "demo"],
    source: "manual",
    created_at: "2026-05-10T11:00:00Z",
    updated_at: "2026-05-10T18:00:00Z",
  },
  {
    id: "task_reingest_skip",
    title: "Skip unchanged document embeddings",
    description: "Avoid paying for Workers AI embedding calls when content_hash is unchanged.",
    status: "complete",
    priority: "P1",
    project_name: "Knowledge Pipeline",
    workspace_id: DEMO_WORKSPACE,
    owner_name: "Sam",
    assignee_name: "Agent Sam",
    due_date: "Today",
    estimate_hours: 1,
    tracked_hours: 0.7,
    tags: ["performance", "embeddings", "cost"],
    source: "workflow",
    workflow_run_id: "wf_reingest_skip_v1",
    created_at: "2026-05-10T15:30:00Z",
    updated_at: "2026-05-10T20:00:00Z",
  },
];

function CardShell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-2xl border border-white/10 bg-slate-950/48 shadow-[0_18px_70px_rgba(0,0,0,0.22)] backdrop-blur-xl", className)}>
      {children}
    </section>
  );
}

function Kpi({ icon: Icon, label, value, sub, tone }: { icon: React.ElementType; label: string; value: string; sub: string; tone: string }) {
  return (
    <CardShell className="relative overflow-hidden p-4">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</div>
          <div className="mt-3 text-2xl font-semibold tracking-tight text-white">{value}</div>
          <div className="mt-1 text-xs text-slate-500">{sub}</div>
        </div>
        <div className={cx("rounded-xl border p-2", tone)}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </CardShell>
  );
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<BoardTask[]>(initialTasks);
  const [query, setQuery] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTasks[0]?.id ?? null);

  const filteredTasks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter((task) =>
      [
        task.title,
        task.description,
        task.project_name,
        task.assignee_name,
        task.priority,
        task.status,
        task.source,
        task.agentsam_todo_id,
        task.workflow_run_id,
        ...task.tags,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [tasks, query]);

  const selectedTask = useMemo(() => tasks.find((task) => task.id === selectedTaskId) ?? null, [tasks, selectedTaskId]);

  const counts = useMemo(() => {
    const total = tasks.length;
    const blocked = tasks.filter((task) => task.status === "blocked" || task.blocked_reason).length;
    const inProgress = tasks.filter((task) => task.status === "in_progress").length;
    const approval = tasks.filter((task) => task.status === "awaiting_approval" || task.approval_required).length;
    const complete = tasks.filter((task) => task.status === "complete").length;
    const agentLinked = tasks.filter((task) => task.agentsam_todo_id || task.workflow_run_id || task.source === "agent_sam").length;
    return { total, blocked, inProgress, approval, complete, agentLinked };
  }, [tasks]);

  function moveTask(taskId: string, status: TaskStatus) {
    setTasks((current) =>
      current.map((task) => (task.id === taskId ? { ...task, status, updated_at: new Date().toISOString() } : task)),
    );
  }

  function selectTask(task: BoardTask) {
    setSelectedTaskId(task.id);
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden text-slate-100">
      <div className="shrink-0 border-b border-white/10 bg-[var(--dashboard-canvas)]/95 px-4 py-4 backdrop-blur-xl sm:px-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-300">
              <Layers3 className="h-4 w-4" />
              Workspace Kanban
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">Tasks</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-400">
              Workspace task board, approvals, blockers, and Agent Sam execution work.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search tasks, tags, projects..."
                className="h-9 w-72 rounded-xl border border-white/10 bg-slate-950/70 pl-9 pr-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-300/40"
              />
            </div>
            <button className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-slate-300 hover:bg-white/[0.07]">
              <Filter className="h-4 w-4" />
              Filter
            </button>
            <button className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-slate-300 hover:bg-white/[0.07]">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
            <button className="inline-flex h-9 items-center gap-2 rounded-xl border border-cyan-300/25 bg-cyan-400/10 px-3 text-sm font-medium text-cyan-100 hover:bg-cyan-400/15">
              <Plus className="h-4 w-4" />
              New Task
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <Kpi icon={ListChecks} label="Total Tasks" value={String(counts.total)} sub="visible cards" tone="border-cyan-300/20 bg-cyan-400/10 text-cyan-200" />
          <Kpi icon={Workflow} label="In Progress" value={String(counts.inProgress)} sub="actively moving" tone="border-emerald-300/20 bg-emerald-400/10 text-emerald-200" />
          <Kpi icon={AlertTriangle} label="Blocked" value={String(counts.blocked)} sub="needs decision" tone="border-rose-300/20 bg-rose-400/10 text-rose-200" />
          <Kpi icon={ShieldCheck} label="Approvals" value={String(counts.approval)} sub="owner gates" tone="border-amber-300/20 bg-amber-400/10 text-amber-200" />
          <Kpi icon={CheckCircle2} label="Completed" value={String(counts.complete)} sub="this cycle" tone="border-teal-300/20 bg-teal-400/10 text-teal-200" />
          <Kpi icon={Bot} label="Agent Linked" value={String(counts.agentLinked)} sub="todo/workflow refs" tone="border-violet-300/20 bg-violet-400/10 text-violet-200" />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <KanbanBoard
          tasks={filteredTasks}
          columns={KANBAN_COLUMNS}
          selectedTaskId={selectedTaskId}
          onSelectTask={selectTask}
          onMove={moveTask}
        />

        <div className="mt-2 grid gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <TaskDetailPanel task={selectedTask} />
          </div>
          <CardShell className="p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-100">Execution queue</div>
                <p className="mt-1 text-xs text-slate-500">Next high-priority work surfaced from the board.</p>
              </div>
              <ArrowRight className="h-4 w-4 text-cyan-300" />
            </div>
            <div className="mt-4 space-y-3">
              {tasks
                .filter((task) => task.priority === "P0" && task.status !== "complete")
                .slice(0, 4)
                .map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => selectTask(task)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left hover:bg-white/[0.06]"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-100">{task.title}</div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                        <Clock3 className="h-3 w-3" />
                        {task.due_date || "No due date"}
                        <GitBranch className="ml-1 h-3 w-3" />
                        {statusLabel[task.status]}
                      </div>
                    </div>
                    <span className={cx("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold", priorityClass[task.priority as TaskPriority])}>
                      {task.priority}
                    </span>
                  </button>
                ))}
            </div>
          </CardShell>
        </div>
      </div>
    </div>
  );
}
