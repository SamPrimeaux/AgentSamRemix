import type { AgentMode, AgentPresenceState } from './agentModePresenceMap';

export type ResolveAgentPresenceStateInput = {
  mode?: AgentMode;
  isLoading?: boolean;
  approvalBusy?: boolean;
  pendingToolApproval?: boolean;
  workflowRunId?: string | null;
  lastToolName?: string;
  lastToolStatus?: 'running' | 'complete' | 'failed';
  lastSseEvent?: unknown;
  subagentEventType?: string;
  completeFlash?: boolean;
  failedFlash?: boolean;
};

export function resolveAgentPresenceState(i: ResolveAgentPresenceStateInput): AgentPresenceState {
  if (i.pendingToolApproval) return 'approval_required';
  if (i.approvalBusy) return 'waiting_approval';

  if (i.subagentEventType) {
    const t = String(i.subagentEventType || '').trim();
    if (t === 'agentsam_subagent_run_started') return 'subagent_spawn';
    if (t === 'agentsam_subagent_fanout_started') return 'multitask_fanout';
    if (t === 'agentsam_subagent_run_progress') return 'parallel_work';
    if (t === 'agentsam_subagent_run_result') return 'merge_results';
    if (t === 'agentsam_subagent_fanout_result') return 'merge_results';
  }

  if (i.workflowRunId) return 'task_queue';

  if (i.lastToolStatus === 'failed' || i.failedFlash) return 'failed';
  if (i.completeFlash || i.lastToolStatus === 'complete') return 'complete';

  if (i.isLoading) {
    const mode = String(i.mode || '').toLowerCase() as AgentMode;
    if (mode === 'multitask') return 'multitask_fanout';
    if (mode === 'plan') return 'planning';
    return 'thinking';
  }

  return 'idle';
}

