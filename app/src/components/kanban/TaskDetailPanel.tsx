import React, { useCallback, useEffect, useState } from "react";
import { MessageSquare, Paperclip, Sparkles, Upload } from "lucide-react";
import type { TaskActivityEntry, TaskAttachment, TaskComment } from "../../../client-api/kanban";
import {
  fetchTaskActivity,
  fetchTaskAttachments,
  fetchTaskComments,
  postTaskComment,
  uploadTaskAttachment,
} from "../../../client-api/kanban";
import type { BoardTask } from "./types";
import { cx, statusLabel, statusTone } from "./types";

function CardShell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={cx(
        "rounded-2xl border border-white/10 bg-slate-950/48 shadow-[0_18px_70px_rgba(0,0,0,0.22)] backdrop-blur-xl",
        className,
      )}
    >
      {children}
    </section>
  );
}

function formatWhen(ts: number | string | null | undefined) {
  if (ts == null) return "";
  const n = typeof ts === "number" ? ts : Number(ts);
  const ms = n > 1e12 ? n : n * 1000;
  return new Date(ms).toLocaleString();
}

function activityLabel(entry: TaskActivityEntry) {
  const action = entry.action || "updated";
  if (action === "status_changed") return "Status changed";
  if (action === "assigned") return "Assignee updated";
  if (action === "commented") return "Comment added";
  if (action === "created") return "Task created";
  return "Task updated";
}

function activityDetail(entry: TaskActivityEntry) {
  if (!entry.changes_json) return null;
  try {
    const parsed = JSON.parse(String(entry.changes_json));
    if (parsed?.field === "title") return `Title → ${parsed.to || ""}`;
    if (parsed?.field === "column_id") return "Moved to another column";
    if (parsed?.field === "assignee_id") return `Assignee → ${parsed.to || "unassigned"}`;
    if (parsed?.field === "attachment") return `Attached ${parsed.file_name || "file"}`;
    if (parsed?.comment_id) return "New comment";
    return JSON.stringify(parsed);
  } catch {
    return String(entry.changes_json);
  }
}

export default function TaskDetailPanel({ task }: { task: BoardTask | null }) {
  const [activity, setActivity] = useState<TaskActivityEntry[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentPosting, setCommentPosting] = useState(false);
  const [uploading, setUploading] = useState(false);

  const loadDetail = useCallback(async (taskId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const [actRes, comRes, attRes] = await Promise.all([
        fetchTaskActivity(taskId),
        fetchTaskComments(taskId),
        fetchTaskAttachments(taskId),
      ]);
      if (!actRes.ok) throw new Error(actRes.error || "Failed to load activity");
      if (!comRes.ok) throw new Error(comRes.error || "Failed to load comments");
      if (!attRes.ok) throw new Error(attRes.error || "Failed to load attachments");
      setActivity(actRes.activity || []);
      setComments(comRes.comments || []);
      setAttachments(attRes.attachments || []);
    } catch (e) {
      setActivity([]);
      setComments([]);
      setAttachments([]);
      setDetailError(e instanceof Error ? e.message : String(e));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!task?.id) {
      setActivity([]);
      setComments([]);
      setAttachments([]);
      setDetailError(null);
      setCommentDraft("");
      return;
    }
    void loadDetail(task.id);
  }, [task?.id, loadDetail]);

  async function submitComment() {
    if (!task?.id || !commentDraft.trim()) return;
    setCommentPosting(true);
    const res = await postTaskComment(task.id, commentDraft.trim());
    setCommentPosting(false);
    if (!res.ok) {
      setDetailError(res.error || "Comment failed");
      return;
    }
    setCommentDraft("");
    if (res.comment) setComments((prev) => [...prev, res.comment!]);
    const actRes = await fetchTaskActivity(task.id);
    if (actRes.ok) setActivity(actRes.activity || []);
  }

  async function onFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!task?.id || !file) return;
    setUploading(true);
    const res = await uploadTaskAttachment(task.id, file);
    setUploading(false);
    if (!res.ok) {
      setDetailError(res.error || "Upload failed");
      return;
    }
    if (res.attachment) setAttachments((prev) => [res.attachment!, ...prev]);
    const actRes = await fetchTaskActivity(task.id);
    if (actRes.ok) setActivity(actRes.activity || []);
  }

  if (!task) {
    return (
      <CardShell className="p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <Sparkles className="h-4 w-4 text-cyan-300" />
          Select a task
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Click any card to inspect owner, activity, comments, attachments, and execution metadata.
        </p>
      </CardShell>
    );
  }

  return (
    <CardShell className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300">Task details</div>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">{task.title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{task.description}</p>
        </div>
        <span className={cx("rounded-full border px-2.5 py-1 text-xs font-medium", statusTone(task.status))}>
          {statusLabel[task.status]}
        </span>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Assignee</div>
          <div className="mt-1 text-sm font-medium text-slate-100">{task.assignee_name || "Unassigned"}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Agent Todo</div>
          <div className="mt-1 truncate text-sm font-medium text-slate-100">{task.agentsam_todo_id || "Not linked"}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Workflow Run</div>
          <div className="mt-1 truncate text-sm font-medium text-slate-100">{task.workflow_run_id || "Not linked"}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Source</div>
          <div className="mt-1 text-sm font-medium text-slate-100">{task.source.replace("_", " ")}</div>
        </div>
      </div>

      {detailError ? <p className="mt-4 text-sm text-rose-200">{detailError}</p> : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <Sparkles className="h-4 w-4 text-cyan-300" />
            Activity
          </div>
          {detailLoading ? (
            <p className="mt-3 text-xs text-slate-500">Loading…</p>
          ) : activity.length === 0 ? (
            <p className="mt-3 text-xs text-slate-500">No activity yet.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {activity.map((entry) => (
                <li key={entry.id} className="border-l border-cyan-400/30 pl-3">
                  <div className="text-xs font-medium text-slate-200">{activityLabel(entry)}</div>
                  {activityDetail(entry) ? (
                    <div className="mt-0.5 text-xs text-slate-400">{activityDetail(entry)}</div>
                  ) : null}
                  <div className="mt-1 text-[10px] text-slate-500">{formatWhen(entry.created_at)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <MessageSquare className="h-4 w-4 text-violet-300" />
            Comments
          </div>
          {detailLoading ? (
            <p className="mt-3 text-xs text-slate-500">Loading…</p>
          ) : (
            <ul className="mt-3 max-h-48 space-y-3 overflow-y-auto">
              {comments.length === 0 ? (
                <li className="text-xs text-slate-500">No comments yet.</li>
              ) : (
                comments.map((c) => (
                  <li key={c.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <p className="text-sm text-slate-200">{c.content}</p>
                    <div className="mt-1 text-[10px] text-slate-500">{formatWhen(c.created_at)}</div>
                  </li>
                ))
              )}
            </ul>
          )}
          <div className="mt-3 flex gap-2">
            <textarea
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
              rows={2}
              placeholder="Add a comment…"
              className="min-h-[2.5rem] flex-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400/40 focus:outline-none"
            />
            <button
              type="button"
              disabled={commentPosting || !commentDraft.trim()}
              onClick={() => void submitComment()}
              className="shrink-0 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm text-slate-200 hover:bg-white/[0.1] disabled:opacity-40"
            >
              {commentPosting ? "…" : "Post"}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Paperclip className="h-4 w-4 text-amber-300" />
              Attachments
            </div>
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/[0.06]">
              <Upload className="h-3.5 w-3.5" />
              {uploading ? "Uploading…" : "Upload"}
              <input type="file" className="hidden" disabled={uploading} onChange={(e) => void onFilePick(e)} />
            </label>
          </div>
          {detailLoading ? (
            <p className="mt-3 text-xs text-slate-500">Loading…</p>
          ) : attachments.length === 0 ? (
            <p className="mt-3 text-xs text-slate-500">No attachments.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {attachments.map((a) => (
                <li key={a.id}>
                  <a
                    href={a.url || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-cyan-200 hover:bg-white/[0.06]"
                  >
                    <span className="truncate">{a.file_name}</span>
                    {a.file_size ? (
                      <span className="shrink-0 text-[10px] text-slate-500">
                        {Math.round(a.file_size / 1024)} KB
                      </span>
                    ) : null}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </CardShell>
  );
}
