import type { AgentMode } from '../mode-presence/agentModePresenceMap';
import {
  resolvePresenceIconKey,
  resolvePresenceDescription,
  type AgentPresenceState,
  type ModePresenceIconKey,
} from '../mode-presence/agentModePresenceMap';
import type { AgentRunPhase, AgentRunPresenceState, AgentToolLane, ResolvedAgentPresence } from './types';
import { laneLabel, toolLaneIconMap, toolNameToLane } from './lanes';

export const presenceStateIconMap: Record<AgentRunPresenceState, ModePresenceIconKey> = {
  thinking: 'agent-spark',
  tool_routing: 'tool-router',
  task_queue: 'work-queue',
  subagent_spawn: 'subagent-swarm',
  multitask_fanout: 'fanout-orbit',
  delegate_subtask: 'delegate-chain',
  review_gate: 'review-gate',
  approval_required: 'approval-wait',
  merge_results: 'merge-weave',
  complete: 'done-bloom',
  failed: 'error-signal',
  loading_panel: 'skeleton-plan',
};

const PRESENCE_LABELS: Record<AgentRunPresenceState, string> = {
  thinking: 'Thinking through the request',
  tool_routing: 'Choosing the right tool path',
  task_queue: 'Working through the task queue',
  subagent_spawn: 'Spawning focused subagents',
  multitask_fanout: 'Running parallel workstreams',
  delegate_subtask: 'Delegating a focused task',
  review_gate: 'Ready for review',
  approval_required: 'Waiting for your approval',
  merge_results: 'Merging results',
  complete: 'Complete',
  failed: 'Needs attention',
  loading_panel: 'Loading preview',
};

function modeTone(mode?: AgentMode): ResolvedAgentPresence['tone'] {
  return mode ?? 'neutral';
}

function normalizeRunPresenceState(state?: string | null): AgentRunPresenceState | null {
  const s = String(state || '').trim().toLowerCase();
  if (!s) return null;
  if (s in presenceStateIconMap) return s as AgentRunPresenceState;
  if (s === 'waiting_approval') return 'review_gate';
  if (s === 'planning') return 'thinking';
  if (s === 'executing' || s === 'tool') return 'tool_routing';
  return null;
}

export function resolveAgentPresence(input: {
  mode?: AgentMode;
  phase?: AgentRunPhase;
  presenceState?: string | null;
  lane?: AgentToolLane;
  eventType?: string;
  toolName?: string;
  status?: 'idle' | 'active' | 'waiting' | 'done' | 'failed';
  /** Override header when SSE supplies semantic summary. */
  title?: string;
}): ResolvedAgentPresence {
  const mode = input.mode ?? 'agent';
  const status = input.status ?? (input.phase === 'idle' ? 'idle' : 'active');

  if (status === 'failed' || input.phase === 'failed') {
    return {
      iconKey: 'error-signal',
      label: input.title || PRESENCE_LABELS.failed,
      description: 'Recoverable error — review the trace or retry.',
      tone: 'danger',
      presenceState: 'failed',
    };
  }

  if (status === 'done' || input.phase === 'complete') {
    return {
      iconKey: 'done-bloom',
      label: input.title || PRESENCE_LABELS.complete,
      description: 'Run finished successfully.',
      tone: 'success',
      presenceState: 'complete',
    };
  }

  if (input.phase === 'gated' || status === 'waiting') {
    const runState: AgentRunPresenceState = 'approval_required';
    return {
      iconKey: presenceStateIconMap[runState],
      label: input.title || PRESENCE_LABELS.approval_required,
      description: resolvePresenceDescription({ mode, state: runState }) ?? 'Paused until you approve.',
      tone: 'warning',
      presenceState: 'approval_required',
    };
  }

  const explicitRun = normalizeRunPresenceState(input.presenceState);
  if (explicitRun === 'review_gate') {
    return {
      iconKey: presenceStateIconMap.review_gate,
      label: input.title || PRESENCE_LABELS.review_gate,
      description: 'Prepared for your review before execution.',
      tone: modeTone(mode),
      presenceState: 'waiting_approval',
    };
  }

  if (explicitRun) {
    return {
      iconKey: presenceStateIconMap[explicitRun],
      label: input.title || PRESENCE_LABELS[explicitRun],
      description: resolvePresenceDescription({ mode, state: explicitRun }) ?? '',
      tone: modeTone(mode),
      presenceState: explicitRun as AgentPresenceState,
    };
  }

  const lane = input.lane ?? toolNameToLane(input.toolName);
  if (status === 'active' && lane !== 'default') {
    return {
      iconKey: toolLaneIconMap[lane],
      label: input.title || laneLabel(lane),
      description: input.toolName ? String(input.toolName) : '',
      tone: modeTone(mode),
      presenceState: lane === 'terminal' ? 'terminal' : lane === 'browser' ? 'browser' : 'tool',
    };
  }

  const fallbackState = (input.presenceState || 'thinking') as AgentPresenceState;
  return {
    iconKey: resolvePresenceIconKey({ mode, state: fallbackState }),
    label: input.title || PRESENCE_LABELS.thinking,
    description: resolvePresenceDescription({ mode, state: fallbackState }) ?? '',
    tone: modeTone(mode),
    presenceState: fallbackState,
  };
}
