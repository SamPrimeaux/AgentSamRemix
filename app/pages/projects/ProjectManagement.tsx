import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Filter, MoreHorizontal, Plus, Search } from "lucide-react";
import type { OverviewProject, ProjectsOverviewResponse } from "../../client-api/projects";
import { fetchProjectsOverview } from "../../client-api/projects";
import type { KanbanTask } from "../../client-api/kanban";
import { fetchKanbanTasks } from "../../client-api/kanban";
import NewProjectModal from "../../components/projects/NewProjectModal";
import { useWorkspace } from "../../src/context/WorkspaceContext";
import AgendaPanel from "../../src/components/projects/AgendaPanel";
import WorkspaceKanban from "../../src/components/kanban/WorkspaceKanban";

type ProjectStatusUi = "active" | "blocked" | "review" | "complete" | "planning";
type PriorityUi = "P0" | "P1" | "P2" | "P3";

const statusLabels: Record<ProjectStatusUi, string> = {
  active: "Active",
  blocked: "Blocked",
  review: "Review",
  complete: "Complete",
  planning: "Planning",
};

function classNames(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function PriorityPill({ priority }: { priority: PriorityUi }) {
  return (
    <span
      className={classNames(
        "rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wide",
        priority === "P0" && "border-rose-400/35 bg-rose-400/10 text-rose-200",
        priority === "P1" && "border-amber-400/35 bg-amber-400/10 text-amber-200",
        priority === "P2" && "border-cyan-400/35 bg-cyan-400/10 text-cyan-200",
        priority === "P3" && "border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] text-[var(--dashboard-muted)]",
      )}
    >
      {priority}
    </span>
  );
}

function StatusPill({ status }: { status: ProjectStatusUi }) {
  return (
    <span
      className={classNames(
        "rounded-full border px-2.5 py-1 text-[11px] font-medium",
        status === "active" && "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
        status === "review" && "border-sky-400/30 bg-sky-400/10 text-sky-200",
        status === "blocked" && "border-rose-400/30 bg-rose-400/10 text-rose-200",
        status === "complete" && "border-teal-400/30 bg-teal-400/10 text-teal-200",
        status === "planning" && "border-violet-400/30 bg-violet-400/10 text-violet-200",
      )}
    >
      {statusLabels[status]}
    </span>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={classNames(
        "rounded-2xl border border-[var(--dashboard-border)] bg-[var(--dashboard-card)]/90 shadow-[0_18px_70px_rgba(0,0,0,0.18)] backdrop-blur-xl",
        className,
      )}
    >
      {children}
    </section>
  );
}

function taskStatusBadge(status: string | null | undefined, completedAt?: number | null) {
  if (completedAt) return { label: "Done", className: "border-teal-400/30 bg-teal-400/10 text-teal-200" };
  const s = String(status || "open").toLowerCase();
  if (s === "blocked") return { label: "Blocked", className: "border-rose-400/30 bg-rose-400/10 text-rose-200" };
  if (s === "in_progress" || s === "doing") return { label: "In progress", className: "border-cyan-400/30 bg-cyan-400/10 text-cyan-200" };
  return { label: "Open", className: "border-violet-400/30 bg-violet-400/10 text-violet-200" };
}

function ProjectTasksPanel({ projectId }: { projectId: string }) {
  const { workspaceId } = useWorkspace();
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      const res = await fetchKanbanTasks({ projectId, workspaceId });
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error || "Failed to load tasks");
        setTasks([]);
      } else {
        setTasks(res.tasks || []);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, workspaceId]);

  return (
    <div className="mt-3 rounded-xl border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)]/50 p-3">
      {loading ? <div className="text-xs text-[var(--dashboard-muted)]">Loading tasks…</div> : null}
      {error ? <div className="text-xs text-rose-200">{error}</div> : null}
      {!loading && !tasks.length ? (
        <div className="text-xs text-[var(--dashboard-muted)]">No kanban tasks linked to this project.</div>
      ) : null}
      <ul className="space-y-2">
        {tasks.map((task) => {
          const badge = taskStatusBadge(task.priority, task.completed_at);
          return (
            <li key={task.id} className="flex items-center gap-2 rounded-lg border border-[var(--dashboard-border)]/70 px-2 py-2">
              <span className={classNames("rounded-full border px-2 py-0.5 text-[10px] font-medium", badge.className)}>
                {badge.label}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-[var(--dashboard-text)]">{task.title}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ProjectCard({
  project,
  expanded,
  onToggle,
}: {
  project: OverviewProject;
  expanded: boolean;
  onToggle: () => void;
}) {
  const st = project.status as ProjectStatusUi;
  const pr = project.priority as PriorityUi;
  const burn = project.budgetTotal > 0 ? Math.round((project.budgetUsed / project.budgetTotal) * 100) : 0;

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        className={classNames(
          "group w-full rounded-2xl border border-[var(--dashboard-border)] bg-[var(--dashboard-card)]/90 p-4 text-left transition duration-200 hover:-translate-y-0.5 hover:border-cyan-300/25 hover:bg-[var(--dashboard-panel)]/80",
          expanded && "border-cyan-300/30",
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <PriorityPill priority={pr} />
              <StatusPill status={st} />
            </div>
            <h3 className="mt-3 truncate text-base font-semibold text-[var(--dashboard-text)]">{project.name}</h3>
            <p className="mt-1 truncate text-xs text-[var(--dashboard-muted)]">
              {project.client || "—"} · {project.project_type || "project"}
            </p>
          </div>
          <span
            className="rounded-lg border border-[var(--dashboard-border)] p-2 text-[var(--dashboard-muted)]"
            aria-hidden
          >
            <MoreHorizontal className="h-4 w-4" />
          </span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[11px] text-[var(--dashboard-muted)]">
          <div className="rounded-xl border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)]/60 py-2">
            <div className="text-sm font-semibold text-[var(--dashboard-text)]">{project.health}%</div>
            <div>Health</div>
          </div>
          <div className="rounded-xl border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)]/60 py-2">
            <div className="text-sm font-semibold text-[var(--dashboard-text)]">{project.activeTasks}</div>
            <div>Open tasks</div>
          </div>
          <div className="rounded-xl border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)]/60 py-2">
            <div className="text-sm font-semibold text-rose-200">{project.blockedTasks}</div>
            <div>Blocked</div>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <div className="mb-1 flex justify-between text-[11px] text-[var(--dashboard-muted)]">
              <span>Delivery</span>
              <span>{project.progress}%</span>
            </div>
            <div className="h-2 rounded-full bg-[var(--dashboard-panel)]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400"
                style={{ width: `${project.progress}%` }}
              />
            </div>
          </div>
          <div>
            <div className="mb-1 flex justify-between text-[11px] text-[var(--dashboard-muted)]">
              <span>Token Budget</span>
              <span>
                {project.budgetUsed.toLocaleString()} / {project.budgetTotal.toLocaleString()}
              </span>
            </div>
            <div className="h-2 rounded-full bg-[var(--dashboard-panel)]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-400 to-cyan-400"
                style={{ width: `${Math.min(burn, 100)}%` }}
              />
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {(project.tags || []).map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)]/50 px-2 py-1 text-[11px] text-[var(--dashboard-muted)]"
            >
              {tag}
            </span>
          ))}
        </div>
      </button>
      {expanded ? <ProjectTasksPanel projectId={project.id} /> : null}
    </div>
  );
}

export default function ProjectManagement() {
  const { workspaceId, workspaces, loading: workspaceLoading } = useWorkspace();
  const activeWorkspaceLabel = useMemo(() => {
    if (!workspaceId?.trim()) return null;
    const row = workspaces.find((w) => w.id === workspaceId);
    return row?.name?.trim() || workspaceId;
  }, [workspaceId, workspaces]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProjectStatusUi | "all">("all");
  const [overview, setOverview] = useState<ProjectsOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const refreshOverview = useCallback(async (ws: string | null) => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchProjectsOverview(ws);
      if (!data.ok) {
        setLoadError(data.error || "Failed to load projects overview.");
        setOverview(null);
      } else {
        setOverview(data);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      setOverview(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const workspaceIdRef = useRef(workspaceId);
  workspaceIdRef.current = workspaceId;

  useEffect(() => {
    if (workspaceLoading) return;
    void refreshOverview(workspaceId);
  }, [workspaceId, workspaceLoading, refreshOverview]);

  useEffect(() => {
    const onWorkspaceChange = () => {
      void refreshOverview(workspaceIdRef.current);
    };
    window.addEventListener("iam_workspace_id", onWorkspaceChange);
    return () => window.removeEventListener("iam_workspace_id", onWorkspaceChange);
  }, [refreshOverview]);

  const projects = overview?.projects || [];

  const filteredProjects = useMemo(() => {
    return projects.filter((project) => {
      const matchesQuery = [project.name, project.client, project.stage, project.owner, ...(project.tags || [])]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase());
      const matchesStatus = statusFilter === "all" || project.status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [projects, query, statusFilter]);

  function toggleProject(id: string) {
    setExpandedProjectId((current) => (current === id ? null : id));
  }

  return (
    <main className="flex h-full min-h-0 flex-col overflow-y-auto bg-[var(--dashboard-bg)] text-[var(--dashboard-text)]">
      <div className="mx-auto w-full min-w-0 max-w-[1680px] shrink-0 px-6 py-6">
        {loadError ? (
          <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{loadError}</div>
        ) : null}
        {loading && !overview ? (
          <div className="mb-4 text-sm text-[var(--dashboard-muted)]">Loading portfolio…</div>
        ) : null}

        <section className="grid gap-5 xl:grid-cols-12">
            <Card className="xl:col-span-8">
              <div className="flex flex-col gap-3 px-5 pt-5 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-[var(--dashboard-text)]">Portfolio Overview</h2>
                  <p className="mt-1 text-xs text-[var(--dashboard-muted)]">
                    {activeWorkspaceLabel ? (
                      <span>
                        Workspace: <span className="text-[var(--dashboard-text)]">{activeWorkspaceLabel}</span>
                        {overview?.updated_at ? ` · Updated ${new Date(overview.updated_at).toLocaleString()}` : ""}
                      </span>
                    ) : overview?.updated_at ? (
                      `Updated ${new Date(overview.updated_at).toLocaleString()}`
                    ) : (
                      ""
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--dashboard-muted)]" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search projects..."
                      className="h-9 w-64 rounded-xl border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] pl-9 pr-3 text-sm text-[var(--dashboard-text)] outline-none placeholder:text-[var(--dashboard-muted)] focus:border-cyan-300/40"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setStatusFilter(statusFilter === "all" ? "active" : "all")}
                    className="inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)]/60 px-3 text-sm text-[var(--dashboard-muted)] hover:bg-[var(--dashboard-panel)]"
                  >
                    <Filter className="h-4 w-4" />
                    {statusFilter === "all" ? "All Status" : statusLabels[statusFilter]}
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalOpen(true)}
                    className="inline-flex h-9 items-center gap-2 rounded-xl border border-cyan-300/25 bg-cyan-400/10 px-3 text-sm font-medium text-cyan-100 hover:bg-cyan-400/15"
                  >
                    <Plus className="h-4 w-4" />
                    New Project
                  </button>
                </div>
              </div>
              <div className="grid gap-4 p-5 md:grid-cols-2">
                {filteredProjects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    expanded={expandedProjectId === project.id}
                    onToggle={() => toggleProject(project.id)}
                  />
                ))}
                {!filteredProjects.length && !loading ? (
                  <div className="col-span-2 py-8 text-center text-sm text-[var(--dashboard-muted)]">No projects in this workspace filter.</div>
                ) : null}
              </div>
            </Card>

            <div className="xl:col-span-4">
              <AgendaPanel />
            </div>
          </section>
      </div>

      <div className="min-h-0 min-w-0 w-full flex-1 border-t border-[var(--dashboard-border)] pb-24">
        <WorkspaceKanban workspaceId={workspaceId} />
      </div>

      <NewProjectModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        defaultWorkspaceId={workspaceId}
        onCreated={() => void refreshOverview(workspaceId)}
      />
    </main>
  );
}
