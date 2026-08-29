/**
 * Approval / block SSE: tool_approval_request, tool_blocked, approval_required, workflow_approval_required.
 */
import type { ToolApprovalPayload } from '../../types';
import { resolveToolApprovalPreview } from '../../toolApprovalCopy';
import { sseSpineRunId } from './sseHelpers';
import type { SseSession, SseDispatchResult } from './sseTypes';

/** tool_approval_request — immediately after provider-leak guards in original order. */
export function handleToolApprovalRequestFromSse(
  s: SseSession,
  data: unknown,
  _evType: string | undefined,
): SseDispatchResult {
  if (data && typeof data === 'object' && (data as { type?: string }).type === 'tool_approval_request') {
    const t = data as { type: string; tool?: ToolApprovalPayload };
    if (t.tool && typeof t.tool.name === 'string') {
      s.ctx.onToolApprovalRequest(t.tool);
      s.ctx.streamFinalizedRef.current = true;
      s.ctx.setIsLoading(false);
    }
    return 'continue';
  }
  return 'fallthrough';
}

/** tool_blocked + approval_required (after thinking / tool_error thinking ping). */
export function handleApprovalFromSse(s: SseSession, data: unknown, evType: string | undefined): SseDispatchResult {
  if (evType === 'tool_blocked') {
    const d = data as { tool_name?: string; node_key?: string };
    s.ctx.onThinkingEvent?.({ type: 'tool_blocked', tool_name: d.tool_name || d.node_key || '' });
    return 'continue';
  }
  if (evType === 'approval_required') {
    const d = data as {
      command_run_id?: string;
      approval_id?: string;
      proposal_id?: string;
      tool_name?: string;
      tool_args?: Record<string, unknown>;
      risk_level?: string;
      message?: string;
      action_summary?: string;
      command_preview?: string;
    };
    const toolName = typeof d.tool_name === 'string' ? d.tool_name.trim() : '';
    const approvalId =
      (typeof d.proposal_id === 'string' && d.proposal_id.trim()) ||
      (typeof d.approval_id === 'string' && d.approval_id.trim()) ||
      '';
    if (toolName && approvalId && !d.command_run_id) {
      const toolPayload: ToolApprovalPayload = {
        name: toolName,
        description: d.action_summary || d.message || undefined,
        parameters: d.tool_args && typeof d.tool_args === 'object' ? d.tool_args : undefined,
        preview: d.command_preview || undefined,
        approval_id: approvalId,
        proposal_id: approvalId,
        risk_level: d.risk_level,
      };
      // Rebuild when server still emits path-only for GitHub (params carry repo@branch).
      toolPayload.preview = resolveToolApprovalPreview(toolPayload);
      s.ctx.onToolApprovalRequest(toolPayload);
      s.ctx.streamFinalizedRef.current = true;
      s.ctx.setIsLoading(false);
    }
    s.ctx.onThinkingEvent?.({
      type: 'approval_required',
      command_run_id: d.command_run_id || d.approval_id || d.proposal_id,
    });
    return 'continue';
  }
  // Plan-terminal approval_required (original mid-plan position; unreachable when evType matches above).
  if (data && typeof data === 'object' && (data as { type?: string }).type === 'approval_required') {
    const d = data as {
      type: string;
      task_id?: string;
      command_run_id?: string;
      approval_id?: string;
      title?: string;
      command_preview?: string;
      risk_level?: string;
      action_summary?: string;
      plan_id?: string;
    };
    const pid = typeof d.plan_id === 'string' ? d.plan_id.trim() : '';
    const taskId = typeof d.task_id === 'string' ? d.task_id.trim() : '';
    const crid = typeof d.command_run_id === 'string' ? d.command_run_id.trim() : '';
    const aid = typeof d.approval_id === 'string' ? d.approval_id.trim() : '';
    if (pid && taskId && aid && crid) {
      s.ctx.onToolApprovalRequest({
        name: 'terminal.plan_task',
        description: d.action_summary || 'Run proposed terminal command for this plan task.',
        preview: d.command_preview || '',
        plan_terminal: {
          plan_id: pid,
          task_id: taskId,
          command_run_id: crid,
          approval_id: aid,
        },
      });
    }
    s.ctx.onThinkingEvent?.({
      type: 'approval_required',
      text: `Waiting for approval: ${String(d.title || 'Terminal')}`,
      command_run_id: crid || aid,
    });
    return 'continue';
  }
  return 'fallthrough';
}

/** workflow_complete / workflow_error / workflow_approval_required (after workflow_start/step). */
export function handleWorkflowTerminalFromSse(
  s: SseSession,
  data: unknown,
  _evType: string | undefined,
): SseDispatchResult {
  if (
    data &&
    typeof data === 'object' &&
    ((data as { type?: string }).type === 'workflow_complete' ||
      (data as { type?: string }).type === 'workflow_error' ||
      (data as { type?: string }).type === 'workflow_approval_required')
  ) {
    const w = data as {
      type: string;
      run_id?: string;
      agent_run_id?: string;
      message?: string;
      status?: string;
    };
    const spineRunId = sseSpineRunId(w);
    s.ctx.setWorkflowLedger((prev) => ({
      ...prev,
      runId: w.type === 'workflow_complete' ? null : spineRunId || prev.runId,
      lastError: w.type === 'workflow_error' ? String(w.message || 'workflow_error') : null,
      status:
        w.type === 'workflow_complete'
          ? ('completed' as const)
          : w.type === 'workflow_error'
            ? ('failed' as const)
            : prev.status,
      stepsCompleted:
        w.type === 'workflow_complete' &&
        typeof (w as { steps_completed?: number }).steps_completed === 'number'
          ? Number((w as { steps_completed: number }).steps_completed)
          : prev.stepsCompleted,
      stepsTotal:
        typeof (w as { steps_total?: number }).steps_total === 'number'
          ? Number((w as { steps_total: number }).steps_total)
          : prev.stepsTotal,
    }));
    if (w.type === 'workflow_complete') {
      s.ctx.onThinkingEvent?.({ type: 'workflow_complete' });
    } else if (w.type === 'workflow_approval_required') {
      s.ctx.onThinkingEvent?.({ type: 'approval_required', text: 'Waiting for approval…' });
    } else {
      s.ctx.onThinkingEvent?.({ type: 'workflow_error' });
    }
    return 'continue';
  }
  return 'fallthrough';
}
