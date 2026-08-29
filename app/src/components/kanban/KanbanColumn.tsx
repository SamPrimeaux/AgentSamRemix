import React from "react";
import { Plus } from "lucide-react";
import TaskCard from "./TaskCard";
import type { BoardTask, ColumnDef, TaskStatus } from "./types";

type Props = {
  column: ColumnDef;
  tasks: BoardTask[];
  selectedTaskId: string | null;
  highlightedTaskId?: string | null;
  onSelectTask: (task: BoardTask) => void;
  onMove: (taskId: string, status: TaskStatus) => void;
  columnOptions: Array<{ id: TaskStatus; title: string }>;
  cardRefs?: React.MutableRefObject<Record<string, HTMLButtonElement | null>>;
  /** Taller columns for /projects fullscreen kanban */
  workspaceLayout?: boolean;
};

export default function KanbanColumn({
  column,
  tasks,
  selectedTaskId,
  highlightedTaskId,
  onSelectTask,
  onMove,
  columnOptions,
  cardRefs,
  workspaceLayout = false,
}: Props) {
  const columnShellClass = workspaceLayout
    ? "flex min-h-[min(560px,calc(100dvh-15rem))] max-h-[calc(100dvh-12rem)] w-[min(320px,85vw)] shrink-0 flex-col rounded-2xl border border-white/10 bg-white/[0.035] sm:w-[300px] md:w-[320px]"
    : "flex max-h-[calc(100vh-320px)] min-h-[560px] w-[320px] shrink-0 flex-col rounded-2xl border border-white/10 bg-white/[0.035]";

  return (
    <div className={columnShellClass}>
      <div className="flex items-start justify-between gap-3 border-b border-white/10 p-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-100">{column.title}</h2>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-300">{tasks.length}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">{column.hint}</p>
        </div>
        <button type="button" className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-slate-400 hover:text-white">
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            ref={(el) => {
              if (cardRefs) cardRefs.current[task.id] = el;
            }}
            task={task}
            selected={selectedTaskId === task.id}
            highlighted={highlightedTaskId === task.id}
            onSelect={() => onSelectTask(task)}
            onMove={onMove}
            columnOptions={columnOptions}
          />
        ))}
        {tasks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-xs text-slate-500">
            No tasks in {column.title}.
          </div>
        ) : null}
      </div>

      <div className="border-t border-white/10 p-3">
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-xs text-slate-300 hover:bg-white/[0.06]"
        >
          <Plus className="h-3.5 w-3.5" />
          Add task
        </button>
      </div>
    </div>
  );
}
