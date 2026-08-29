/**
 * Plan explore / questions / created / confirmation / execute / task_* / plan_complete SSE.
 */
import type { ExecutionPlanTask } from '../../types';
import {
  mapTaskCompleteStatus,
  planStatusFromSummary,
} from './sseHelpersMedia';
import type { SseSession, SseDispatchResult } from './sseTypes';

export function handlePlanFromSse(s: SseSession, data: unknown, evType: string | undefined): SseDispatchResult {
if (data && typeof data === 'object' && (data as { type?: string }).type === 'plan_thinking') {
  const d = data as { type: string; message?: string };
  s.ctx.onThinkingEvent?.({ type: 'plan_thinking', text: String(d.message || 'Creating plan…') });
  return 'continue';
}
if (
  data &&
  typeof data === 'object' &&
  ((data as { type?: string }).type === 'plan_explore_start' ||
    (data as { type?: string }).type === 'plan_explore_progress' ||
    (data as { type?: string }).type === 'plan_explore_step')
) {
  const d = data as {
    type: string;
    message?: string;
    synthesis?: string;
    files_searched?: number;
    searches?: number;
    label?: string;
  };
  const label =
    d.type === 'plan_explore_step'
      ? String(d.label || '').trim() || 'Exploring…'
      : String(d.synthesis || d.message || '').trim() ||
        (d.files_searched != null
          ? `Explored ${d.files_searched} files…`
          : 'Exploring codebase and context…');
  s.ctx.onThinkingEvent?.({ type: 'plan_thinking', text: label });
  return 'continue';
}
if (data && typeof data === 'object' && (data as { type?: string }).type === 'plan_questions_batch') {
  const d = data as {
    type: string;
    batch_id?: string;
    phase?: string;
    plan_id?: string;
    explore_summary?: { synthesis?: string; files_searched?: number; searches?: number };
    questions?: Array<{
      id: string;
      question: string;
      choices?: Array<{ key: string; label: string }>;
      multi_select?: boolean;
    }>;
    allow_skip?: boolean;
  };
  const batchId = typeof d.batch_id === 'string' ? d.batch_id.trim() : '';
  if (batchId) {
    const phase =
      d.phase === 'roadblock' || d.phase === 'mid_plan' ? d.phase : 'pre_plan';
    const batch = {
      batch_id: batchId,
      phase,
      plan_id: typeof d.plan_id === 'string' ? d.plan_id.trim() : null,
      explore_summary: d.explore_summary,
      questions: (d.questions || []).map((q) => ({
        id: String(q.id || ''),
        question: String(q.question || ''),
        choices: Array.isArray(q.choices)
          ? q.choices.map((c) => ({ key: String(c.key), label: String(c.label) }))
          : [],
        multi_select: Boolean(q.multi_select),
      })),
      allow_skip: d.allow_skip !== false,
    };
    s.ctx.setMessages((prev) => {
      const next = [...prev];
      next.push({
        role: 'assistant',
        content: '',
        planQuestionsBatch: batch,
      });
      return next;
    });
    s.ctx.onThinkingEvent?.({ type: 'plan_thinking', text: 'Waiting for your answers…', plan_id: batchId });
  }
  return 'continue';
}
if (data && typeof data === 'object' && (data as { type?: string }).type === 'plan_created') {
  const d = data as {
    type: string;
    plan_title?: string;
    plan_id?: string;
    approval_id?: string;
    auto_execute?: boolean;
    workflow_run_id?: string;
    task_count?: number;
    visual_map?: { artifact_id: string; r2_key?: string; public_url: string } | null;
    plan_markdown?: { artifact_id: string; r2_key?: string; public_url: string } | null;
    tasks?: Array<{
      id: string;
      title: string;
      order_index: number;
      handler_type?: string | null;
      handler_key?: string | null;
      capability_type?: string | null;
      execution_step_id?: string | null;
      command_run_id?: string | null;
      approval_id?: string | null;
      workflow_run_id?: string | null;
      files_involved?: string[];
    }>;
  };
  const pid = typeof d.plan_id === 'string' ? d.plan_id.trim() : '';
  const planTasks: ExecutionPlanTask[] = (d.tasks || []).map((t) => ({
    id: String(t.id || ''),
    title: String(t.title || '').slice(0, 200),
    order_index: Number(t.order_index ?? 0),
    status: 'todo',
    parent_task_id:
      (t as { parent_task_id?: string | null }).parent_task_id ?? null,
    handler_type: t.handler_type ?? null,
    trace: {
      execution_step_id: t.execution_step_id ?? null,
      command_run_id: t.command_run_id ?? null,
      workflow_run_id: t.workflow_run_id ?? d.workflow_run_id ?? null,
      capability_type: t.capability_type ?? null,
      handler_key: t.handler_key ?? null,
      files_involved: Array.isArray(t.files_involved) ? t.files_involved : undefined,
    },
  }));
  s.executionPlan = {
    plan_id: pid,
    plan_title: String(d.plan_title || 'Plan'),
    status: d.auto_execute === false ? 'ready' : 'running',
    tasks: planTasks,
    workflow_run_id: d.workflow_run_id ?? null,
  };
  s.ctx.onThinkingEvent?.({
    type: 'plan_created',
    plan_id: pid,
    text: d.auto_execute === false ? 'Plan ready — Save to workspace, then Build.' : `Running task 1 of ${planTasks.length || Number(d.task_count || 0) || '?' }…`,
  });
  const vm = d.visual_map;
  const pm = d.plan_markdown;
  const vmOk =
    pid &&
    vm &&
    typeof vm === 'object' &&
    typeof vm.artifact_id === 'string' &&
    vm.artifact_id.trim() &&
    typeof vm.public_url === 'string' &&
    vm.public_url.trim();
  const pmOk =
    pid &&
    pm &&
    typeof pm === 'object' &&
    typeof pm.artifact_id === 'string' &&
    pm.artifact_id.trim() &&
    typeof pm.public_url === 'string' &&
    pm.public_url.trim();
  let chip:
    | {
        plan_id: string;
        plan_title?: string;
        visual_map?: { artifact_id: string; r2_key?: string; public_url: string };
        plan_markdown?: { artifact_id: string; r2_key?: string; public_url: string };
      }
    | undefined;
  if (vmOk || pmOk) {
    const visual_map = vmOk
      ? {
          artifact_id: String(vm.artifact_id).trim(),
          r2_key: typeof vm.r2_key === 'string' ? vm.r2_key : undefined,
          public_url: String(vm.public_url).trim(),
        }
      : undefined;
    const plan_markdown = pmOk
      ? {
          artifact_id: String(pm.artifact_id).trim(),
          r2_key: typeof pm.r2_key === 'string' ? pm.r2_key : undefined,
          public_url: String(pm.public_url).trim(),
        }
      : undefined;
    chip = {
      plan_id: pid,
      plan_title: d.plan_title,
      ...(visual_map ? { visual_map } : {}),
      ...(plan_markdown ? { plan_markdown } : {}),
    };
  }
  const summaryText =
    typeof (d as { summary?: string }).summary === 'string'
      ? String((d as { summary: string }).summary).trim()
      : '';
  s.ctx.setMessages((prev) => {
    const last = [...prev];
    const idx = last.length - 1;
    const content =
      s.assistantContent ||
      summaryText ||
      (d.auto_execute === false ? 'Plan ready — edit in the editor, Save to workspace, then Build.' : '');
    const patch = {
      content,
      executionPlan: s.executionPlan,
      planConfirmation: undefined,
      implementationPlan: pmOk
        ? {
            plan_id: pid,
            plan_title: d.plan_title,
            plan_markdown: chip?.plan_markdown,
          }
        : null,
    };
    if (idx >= 0 && last[idx].role === 'assistant') {
      last[idx] = { ...last[idx], ...patch };
    } else {
      last.push({ role: 'assistant', ...patch });
    }
    return last;
  });
  return 'continue';
}
if (data && typeof data === 'object' && (data as { type?: string }).type === 'plan_confirmation_required') {
  const d = data as {
    type: string;
    approval_id?: string;
    plan_id?: string;
    plan_title?: string;
    summary?: string;
    message?: string;
    tasks?: Array<{ title: string; order_index: number }>;
  };
  s.ctx.onThinkingEvent?.({
    type: 'plan_confirmation_required',
    approval_id: d.approval_id ?? '',
    plan_id: d.plan_id ?? '',
    text: d.summary ?? d.message ?? 'Review the plan and confirm to continue.',
  });
  s.ctx.setMessages((prev) => {
    const next = [...prev];
    const idx = next.length - 1;
    const bubble: (typeof next)[number] = {
      role: 'assistant',
      content: d.message || d.summary || 'Plan ready for review.',
      planConfirmation: {
        plan_id: String(d.plan_id || '').trim(),
        approval_id: String(d.approval_id || '').trim(),
        plan_title: d.plan_title,
        message: d.message || d.summary,
        tasks: d.tasks,
      },
    };
    if (idx >= 0 && next[idx].role === 'assistant' && !next[idx].content.trim()) {
      next[idx] = { ...next[idx], ...bubble };
    } else {
      next.push(bubble);
    }
    return next;
  });
  return 'continue';
}
if (
  data &&
  typeof data === 'object' &&
  [
    'needs_input',
    'agent_question',
    'attached_question',
    'clarification_required',
    'user_question',
  ].includes(String((data as { type?: string }).type || ''))
) {
  const d = data as {
    type: string;
    question?: string;
    text?: string;
    message?: string;
    options?: string[];
    choices?: string[];
    question_id?: string;
  };
  const questionText = String(d.question || d.text || d.message || '').trim();
  const options = Array.isArray(d.options)
    ? d.options.map((o) => String(o).trim()).filter(Boolean)
    : Array.isArray(d.choices)
      ? d.choices.map((o) => String(o).trim()).filter(Boolean)
      : undefined;
  if (questionText) {
    const isAttached = String(d.type || '') === 'attached_question';
    s.ctx.setMessages((prev) => {
      const next = [...prev];
      const idx = next.length - 1;
      const bubble: (typeof next)[number] = {
        role: 'assistant',
        content: isAttached ? '' : questionText,
        agentQuestion: {
          question: questionText,
          options: options?.length ? options : undefined,
          questionId: typeof d.question_id === 'string' ? d.question_id : undefined,
        },
      };
      if (
        !isAttached &&
        idx >= 0 &&
        next[idx].role === 'assistant' &&
        !next[idx].content.trim()
      ) {
        next[idx] = { ...next[idx], ...bubble };
      } else {
        next.push(bubble);
      }
      return next;
    });
  }
  return 'continue';
}
if (data && typeof data === 'object' && (data as { type?: string }).type === 'plan_execute_start') {
  const d = data as { type: string; plan_id?: string };
  const pid = typeof d.plan_id === 'string' ? d.plan_id.trim() : '';
  if (s.executionPlan && pid && s.executionPlan.plan_id === pid) {
    s.executionPlan = { ...s.executionPlan, status: 'running' };
    s.pushExecutionPlan(s.executionPlan);
  }
  s.ctx.onThinkingEvent?.({
    type: 'plan_progress',
    plan_id: pid,
    text: 'Executing plan tasks…',
  });
  return 'continue';
}
if (data && typeof data === 'object' && (data as { type?: string }).type === 'task_start') {
  const d = data as {
    type: string;
    task_id?: string;
    title?: string;
    order_index?: number;
    handler_type?: string;
    total_tasks?: number;
  };
  if (s.executionPlan) {
    const idx = Number(d.order_index ?? 0);
    const total = Number(d.total_tasks ?? s.executionPlan.tasks.length) || s.executionPlan.tasks.length;
    s.executionPlan = {
      ...s.executionPlan,
      status: 'running',
      tasks: s.executionPlan.tasks.map((t) =>
        t.id === d.task_id || t.order_index === idx
          ? { ...t, status: 'running' as const }
          : t,
      ),
    };
    s.pushExecutionPlan(s.executionPlan);
    s.ctx.onThinkingEvent?.({
      type: 'plan_progress',
      text: d.title || `Running task ${idx + 1} of ${total}…`,
    });
  }
  return 'continue';
}
if (data && typeof data === 'object' && (data as { type?: string }).type === 'task_complete') {
  const d = data as {
    type: string;
    task_id?: string;
    title?: string;
    status?: string;
    output?: string;
    error?: string;
    order_index?: number;
  };
  const taskStatus = mapTaskCompleteStatus(d.status);
  const detail = String(d.output || d.error || '').slice(0, 1200);
  if (s.executionPlan) {
    const idx = Number(d.order_index ?? 0);
    s.executionPlan = {
      ...s.executionPlan,
      tasks: s.executionPlan.tasks.map((t) =>
        t.id === d.task_id || t.order_index === idx
          ? { ...t, status: taskStatus, detail: detail || t.detail }
          : t,
      ),
    };
    s.pushExecutionPlan(s.executionPlan);
  }
  return 'continue';
}
if (data && typeof data === 'object' && (data as { type?: string }).type === 'plan_task_resume_complete') {
  const d = data as {
    type: string;
    plan_id?: string;
    task_id?: string;
    tasks_completed?: number;
    tasks_failed?: number;
    tasks_skipped?: number;
    status?: string;
  };
  if (s.executionPlan) {
    const failed = Number(d.tasks_failed || 0);
    s.executionPlan = {
      ...s.executionPlan,
      status: planStatusFromSummary(d.status, failed),
      tasks_completed: Number(d.tasks_completed || 0),
      tasks_failed: failed,
      tasks_skipped: Number(d.tasks_skipped || 0),
    };
    s.pushExecutionPlan(s.executionPlan);
  }
  s.ctx.onThinkingEvent?.({ type: 'workflow_complete' });
  return 'continue';
}
if (data && typeof data === 'object' && (data as { type?: string }).type === 'plan_complete') {
  const d = data as {
    type: string;
    plan_id?: string;
    tasks_completed?: number;
    tasks_failed?: number;
    tasks_skipped?: number;
    status?: string;
  };
  if (s.executionPlan) {
    const failed = Number(d.tasks_failed || 0);
    s.executionPlan = {
      ...s.executionPlan,
      status: planStatusFromSummary(d.status, failed),
      tasks_completed: Number(d.tasks_completed || 0),
      tasks_failed: failed,
      tasks_skipped: Number(d.tasks_skipped || 0),
    };
    s.pushExecutionPlan(s.executionPlan);
  }
  s.ctx.onThinkingEvent?.({ type: 'workflow_complete' });
  return 'continue';
}
  return 'fallthrough';
}
