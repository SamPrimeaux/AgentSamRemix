/**
 * workflow_start / workflow_step SSE (terminal complete/error/approval in useApprovalFromSse).
 */
import {
  patchTraceRowCadJob,
  resolveCadJobIdFromSse,
} from '../../../../lib/cadToolTrace';
import { sseSpineRunId } from './sseHelpers';
import type { SseSession, SseDispatchResult } from './sseTypes';

export function handleWorkflowFromSse(s: SseSession, data: unknown, evType: string | undefined): SseDispatchResult {
if (data && typeof data === 'object' && (data as { type?: string }).type === 'workflow_start') {
  const w = data as {
    type: string;
    run_id?: string;
    agent_run_id?: string;
    steps_total?: number | null;
    workflow_key?: string;
    ledger_kind?: string;
  };
  const isChatToolSession = w.ledger_kind === 'chat_tool_session';
  if (typeof w.workflow_key === 'string' && w.workflow_key.trim() && !isChatToolSession) {
    s.ctx.onThinkingEvent?.({ type: 'plan_progress', text: 'Running workflow…' });
  }
  const spineRunId = sseSpineRunId(w);
  s.ctx.setWorkflowLedger((prev) => ({
    ...prev,
    runId: spineRunId || prev.runId,
    // Chat tool sessions: unknown plan length → null (not sticky 1 → "20 / 1 steps").
    stepsTotal:
      w.steps_total != null
        ? Number(w.steps_total)
        : isChatToolSession
          ? null
          : prev.stepsTotal,
    stepsCompleted: isChatToolSession ? 0 : prev.stepsCompleted,
    lastError: null,
    status: 'running' as const,
  }));
  return 'continue';
}
if (data && typeof data === 'object' && (data as { type?: string }).type === 'workflow_step') {
  const w = data as {
    type: string;
    run_id?: string;
    agent_run_id?: string;
    node_key?: string;
    current_node_key?: string;
    steps_completed?: number;
    steps_total?: number;
    cost_usd?: number;
    input_tokens?: number;
    output_tokens?: number;
    ok?: boolean;
  };
  const spineRunId = sseSpineRunId(w);
  const nk =
    (typeof w.current_node_key === 'string' && w.current_node_key) ||
    (typeof w.node_key === 'string' && w.node_key) ||
    '';
  if (nk) {
    s.ctx.onThinkingEvent?.({
      type: 'workflow_step',
      tool_name: nk,
      ok: w.ok !== false,
      output_preview:
        typeof (w as { output_preview?: string }).output_preview === 'string'
          ? (w as { output_preview: string }).output_preview
          : undefined,
    });
  }
  const wfPreview =
    typeof (w as { output_preview?: string }).output_preview === 'string'
      ? (w as { output_preview: string }).output_preview
      : null;
  const wfJobId = resolveCadJobIdFromSse(nk, {
    job_id: (w as { job_id?: string }).job_id,
    cad_job_id: (w as { cad_job_id?: string }).cad_job_id,
    output_preview: wfPreview,
  });
  if (wfJobId && nk) {
    s.ctx.setToolTraceRows?.((prev) =>
      prev.map((r) => {
        if (r.id !== s.activeToolTraceId && r.toolName !== nk) return r;
        return patchTraceRowCadJob(r, nk, {
          jobId: wfJobId,
          outputPreview: wfPreview,
        });
      }),
    );
  }
  s.ctx.setWorkflowLedger((prev) => ({
    ...prev,
    runId: spineRunId || prev.runId,
    currentNodeKey:
      (typeof w.current_node_key === 'string' && w.current_node_key) ||
      (typeof w.node_key === 'string' && w.node_key) ||
      prev.currentNodeKey,
    stepsCompleted: w.steps_completed != null ? Number(w.steps_completed) : prev.stepsCompleted,
    // Explicit null clears a bad sticky denominator; omit keeps previous for real workflows.
    stepsTotal:
      w.steps_total === null
        ? null
        : w.steps_total != null
          ? Number(w.steps_total)
          : prev.stepsTotal,
    runCost: w.cost_usd != null ? Number(w.cost_usd) : prev.runCost,
    runTokensIn: w.input_tokens != null ? Number(w.input_tokens) : prev.runTokensIn,
    runTokensOut: w.output_tokens != null ? Number(w.output_tokens) : prev.runTokensOut,
  }));
  return 'continue';
}
  return 'fallthrough';
}
