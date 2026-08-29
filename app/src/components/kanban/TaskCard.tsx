import React, { forwardRef } from "react";
import { CalendarDays, MoreHorizontal, TimerReset, UserRound } from "lucide-react";
import type { BoardTask, TaskStatus } from "./types";
import { cx, priorityClass, sourceClass } from "./types";

type Props = {
  task: BoardTask;
  onMove: (taskId: string, status: TaskStatus) => void;
  selected: boolean;
  highlighted?: boolean;
  onSelect: () => void;
  columnOptions: Array<{ id: TaskStatus; title: string }>;
};

const TaskCard = forwardRef<HTMLButtonElement, Props>(function TaskCard(
  { task, onMove, selected, highlighted, onSelect, columnOptions },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onSelect}
      className={cx(
        "group w-full rounded-2xl border bg-white/[0.035] p-3 text-left transition duration-150 hover:-translate-y-0.5 hover:bg-white/[0.06]",
        selected || highlighted
          ? "border-cyan-300/35 shadow-[0_0_0_1px_rgba(34,211,238,0.16)] ring-2 ring-cyan-400/40"
          : "border-white/10",
        highlighted ? "animate-pulse" : "",
        task.blocked_reason ? "ring-1 ring-rose-400/20" : "",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cx("rounded-full border px-2 py-0.5 text-[10px] font-semibold", priorityClass[task.priority])}>
              {task.priority}
            </span>
            <span className={cx("rounded-full px-2 py-0.5 text-[10px] font-medium", sourceClass[task.source])}>
              {task.source.replace("_", " ")}
            </span>
            {task.approval_required ? (
              <span className="rounded-full border border-amber-300/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium text-amber-200">
                approval
              </span>
            ) : null}
          </div>
          <h3 className="mt-2 line-clamp-2 text-sm font-semibold leading-5 text-slate-100">{task.title}</h3>
        </div>
        <MoreHorizontal className="mt-1 h-4 w-4 shrink-0 text-slate-500 group-hover:text-slate-300" />
      </div>

      {task.description ? (
        <p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-400">{task.description}</p>
      ) : null}

      {task.blocked_reason ? (
        <div className="mt-3 rounded-xl border border-rose-400/20 bg-rose-400/10 p-2 text-xs leading-5 text-rose-100">
          <span className="font-semibold">Blocked:</span> {task.blocked_reason}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {task.tags.slice(0, 4).map((tag) => (
          <span key={tag} className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-slate-400">
            {tag}
          </span>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-slate-400">
            <UserRound className="h-3 w-3" />
            <span className="truncate">{task.assignee_name || "Unassigned"}</span>
          </div>
        </div>
        <div className="flex items-center justify-end gap-1 text-slate-400">
          <CalendarDays className="h-3 w-3" />
          <span>{task.due_date || "No due date"}</span>
        </div>
        <div className="flex items-center gap-1">
          <TimerReset className="h-3 w-3" />
          <span>
            {task.tracked_hours ?? 0}h / {task.estimate_hours ?? 0}h
          </span>
        </div>
        <div className="truncate text-right">{task.project_name || "No project"}</div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <select
          value={task.status}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onMove(task.id, event.target.value as TaskStatus)}
          className="h-8 flex-1 rounded-xl border border-white/10 bg-slate-950/80 px-2 text-xs text-slate-300 outline-none focus:border-cyan-300/40"
        >
          {columnOptions.map((column) => (
            <option key={column.id} value={column.id}>
              Move to {column.title}
            </option>
          ))}
          <option value="blocked">Move to Blocked</option>
        </select>
      </div>
    </button>
  );
});

export default TaskCard;
