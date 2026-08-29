import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Layers3, RefreshCw } from "lucide-react";
import type { KanbanColumn as ApiKanbanColumn, KanbanTask } from "../../../client-api/kanban";
import {
  fetchKanbanBoards,
  fetchKanbanColumns,
  fetchKanbanTasks,
  patchKanbanTask,
  createKanbanTask,
} from "../../../client-api/kanban";
import KanbanBoard from "./KanbanBoard";
import TaskDetailPanel from "./TaskDetailPanel";
import { mapKanbanTaskToBoardTask, statusToColumnId } from "./kanban-map";
import type { BoardTask, TaskStatus } from "./types";
import { KANBAN_COLUMNS } from "./types";

type Props = {
  workspaceId: string | null;
  projectId?: string | null;
  /** GCP project detail uses light chrome; legacy tasks page uses dark. */
  variant?: 'light' | 'dark';
};

export default function WorkspaceKanban({ workspaceId, projectId = null, variant = 'dark' }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [apiColumns, setApiColumns] = useState<ApiKanbanColumn[]>([]);
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [boardName, setBoardName] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!workspaceId?.trim()) {
      // Workspace context hasn't resolved yet (or genuinely has none selected).
      // Stay in the loading state rather than declaring "No board" — that
      // message should only ever describe a workspace we've actually queried.
      setApiColumns([]);
      setTasks([]);
      setBoardName(null);
      setError(null);
      setLoading(true);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const boardsRes = await fetchKanbanBoards(workspaceId);
      if (!boardsRes.ok) throw new Error(boardsRes.error || "Failed to load boards");
      const boards = boardsRes.boards || [];
      const board = projectId
        ? boards.find((b) => b.project_id === projectId) || boards[0]
        : boards.find((b) => !b.project_id) || boards[0];
      if (!board) {
        setApiColumns([]);
        setTasks([]);
        setBoardName(null);
        return;
      }
      setBoardName(board.name);
      const [colsRes, tasksRes] = await Promise.all([
        fetchKanbanColumns(board.id, workspaceId),
        projectId
          ? fetchKanbanTasks({ projectId, workspaceId })
          : fetchKanbanTasks({ boardId: board.id, workspaceId }),
      ]);
      if (!colsRes.ok) throw new Error(colsRes.error || "Failed to load columns");
      if (!tasksRes.ok) throw new Error(tasksRes.error || "Failed to load tasks");
      const cols = colsRes.columns || [];
      setApiColumns(cols);
      const columnById = new Map(cols.map((c) => [c.id, c]));
      const mapped = (tasksRes.tasks || [])
        .filter((t: KanbanTask) => !t.completed_at)
        .map((t) => mapKanbanTaskToBoardTask(t, columnById));
      setTasks(mapped);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setApiColumns([]);
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addTask() {
    const title = newTaskTitle.trim();
    if (!title || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await createKanbanTask({
        title,
        workspaceId,
        projectId: projectId || undefined,
      });
      if (!res.ok) throw new Error(res.error || "Failed to create task");
      setNewTaskTitle("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId],
  );

  async function moveTask(taskId: string, status: TaskStatus) {
    const columnId = statusToColumnId(status, apiColumns);
    if (!columnId) return;
    const prev = tasks;
    setTasks((current) =>
      current.map((t) => (t.id === taskId ? { ...t, status, column_id: columnId } : t)),
    );
    const res = await patchKanbanTask(taskId, { column_id: columnId });
    if (!res.ok) {
      setTasks(prev);
      setError(res.error || "Move failed");
    }
  }

  function selectTask(task: BoardTask) {
    setSelectedTaskId(task.id);
  }

  const isLight = variant === 'light';

  return (
    <section
      className={`flex min-w-0 w-full flex-col overflow-hidden ${isLight ? 'text-[var(--text-heading)] bg-[var(--bg-app)]' : 'text-slate-100'}`}
    >
      <div
        className={`shrink-0 border-b px-4 py-4 sm:px-5 ${
          isLight ? 'border-[var(--border-subtle)] bg-[var(--bg-panel)]' : 'border-white/10 bg-[var(--dashboard-canvas)]/95 backdrop-blur-xl'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div
              className={`flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] ${isLight ? 'text-[var(--solar-blue)]' : 'text-cyan-300'}`}
            >
              <Layers3 className="h-4 w-4" />
              {projectId ? 'Project tasks' : 'Workspace Kanban'}
            </div>
            <p className={`mt-1 text-xs ${isLight ? 'text-muted' : 'text-slate-500'}`}>
              {loading ? 'Loading…' : boardName ? boardName : 'No board in this workspace'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addTask();
              }}
              placeholder="New task title…"
              className={`h-9 min-w-[160px] rounded-xl border px-3 text-sm outline-none ${
                isLight
                  ? 'border-[var(--border-subtle)] bg-[var(--bg-app)] text-[var(--text-heading)]'
                  : 'border-white/10 bg-white/[0.04] text-slate-200'
              }`}
            />
            <button
              type="button"
              disabled={creating || !newTaskTitle.trim()}
              onClick={() => void addTask()}
              className={`inline-flex h-9 items-center rounded-xl border px-3 text-sm disabled:opacity-50 ${
                isLight
                  ? 'border-[var(--border-subtle)] bg-[var(--bg-hover)] text-main'
                  : 'border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.07]'
              }`}
            >
              Add task
            </button>
            <button
              type="button"
              onClick={() => void load()}
              className={`inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-sm ${
                isLight
                  ? 'border-[var(--border-subtle)] bg-[var(--bg-hover)] text-main'
                  : 'border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.07]'
              }`}
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className={`shrink-0 px-4 py-2 text-sm sm:px-5 ${isLight ? 'text-[var(--accent-danger)]' : 'text-rose-200'}`}>
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className={`px-4 py-8 text-sm sm:px-5 ${isLight ? 'text-muted' : 'text-slate-500'}`}>Loading kanban…</div>
      ) : !apiColumns.length ? (
        <div className={`px-4 py-8 text-sm sm:px-5 ${isLight ? 'text-muted' : 'text-slate-500'}`}>
          No kanban board configured for this {projectId ? 'project' : 'workspace'}.
        </div>
      ) : (
        <>
          <div className="min-h-0 min-w-0 w-full overflow-x-auto overflow-y-hidden overscroll-x-contain px-3 py-4 sm:px-4">
            <KanbanBoard
              tasks={tasks}
              columns={KANBAN_COLUMNS}
              selectedTaskId={selectedTaskId}
              onSelectTask={selectTask}
              onMove={moveTask}
              workspaceLayout
            />
          </div>
          <div className="shrink-0 border-t border-white/10 px-3 py-4 sm:px-4">
            <TaskDetailPanel task={selectedTask} />
          </div>
        </>
      )}
    </section>
  );
}
