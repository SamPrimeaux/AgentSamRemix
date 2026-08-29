import type { AgentMode, AgentPresenceState } from '../mode-presence/agentModePresenceMap';
import type { ModePresenceIconKey } from '../mode-presence/agentModePresenceMap';

/** Canonical run-level presence (process / orchestration). */
export type AgentRunPresenceState =
  | 'thinking'
  | 'tool_routing'
  | 'task_queue'
  | 'subagent_spawn'
  | 'multitask_fanout'
  | 'delegate_subtask'
  | 'review_gate'
  | 'approval_required'
  | 'merge_results'
  | 'complete'
  | 'failed'
  | 'loading_panel';

/** Tool-lane motion (receipts, active tool work). */
export type AgentToolLane =
  | 'default'
  | 'inspect'
  | 'terminal'
  | 'diff'
  | 'image'
  | 'video'
  | 'diagram'
  | 'files'
  | 'browser'
  | 'database'
  | 'workflow'
  | 'subagent'
  | 'skeleton';

export type AgentRunPhase =
  | 'idle'
  | 'thinking'
  | 'gated'
  | 'executing'
  | 'receipt'
  | 'complete'
  | 'failed'
  | 'denied';

export type ResolvedAgentPresence = {
  iconKey: ModePresenceIconKey;
  label: string;
  description: string;
  tone: AgentMode | 'neutral' | 'danger' | 'success' | 'warning';
  presenceState: AgentPresenceState;
};

export type { AgentMode, AgentPresenceState, ModePresenceIconKey };
