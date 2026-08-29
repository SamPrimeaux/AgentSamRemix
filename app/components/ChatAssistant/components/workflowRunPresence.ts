import type { AgentMode, AgentPresenceState } from '../../../features/mode-presence/agentModePresenceMap';
import type { WorkflowRunState } from './workflowRunTypes';

export type WorkflowRunPresenceView = {
  state: AgentPresenceState;
  title: string;
  description?: string;
  meta?: string;
  pill: string;
};

export function resolveWorkflowRunPresence(
  runState: WorkflowRunState,
  mode: AgentMode = 'multitask',
): WorkflowRunPresenceView | null {
  const { status, workflowKey, stepsTotal, stepsCompleted, currentNodeKey, errorMessage, runId } =
    runState;
  if (status === 'idle' || !runId) return null;
  if (status === 'completed') return null;

  // Chat tool sessions often have unknown/0 planned steps; a sticky steps_total=1
  // produced "20 / 1 steps · 100%" and looked like a hang. Prefer honest counts.
  const progress =
    status === 'running' && stepsCompleted === 0
      ? currentNodeKey
        ? `Running ${currentNodeKey}…`
        : 'Running…'
      : stepsTotal > 0 && stepsCompleted <= stepsTotal
        ? `${stepsCompleted} / ${stepsTotal} steps`
        : currentNodeKey
          ? `${stepsCompleted} tool call${stepsCompleted === 1 ? '' : 's'} · ${currentNodeKey}`
          : `${stepsCompleted} tool call${stepsCompleted === 1 ? '' : 's'}`;

  if (status === 'awaiting_approval') {
    return {
      state: 'approval_required',
      title: 'Waiting for your approval',
      description: 'This workflow node is paused until you allow or deny.',
      meta: currentNodeKey ? `${workflowKey} · ${currentNodeKey}` : workflowKey ?? undefined,
      pill: 'approval',
    };
  }

  if (status === 'failed' || status === 'error') {
    return {
      state: 'failed',
      title: 'Workflow needs attention',
      description: errorMessage?.slice(0, 160) || workflowKey || undefined,
      meta: progress,
      pill: 'error',
    };
  }

  // Chat tool sessions are sequential — never label them as parallel fanout.
  const fanout = mode === 'multitask';
  return {
    state: fanout ? 'multitask_fanout' : 'task_queue',
    title: fanout ? 'Running parallel workstreams' : 'Working through tools',
    description: workflowKey ?? undefined,
    meta: [progress, currentNodeKey].filter(Boolean).join(' · ') || runId.slice(0, 18),
    pill: fanout ? 'fanout' : 'queue',
  };
}
