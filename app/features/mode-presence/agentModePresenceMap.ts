import type { AgentMode } from '../../components/ChatAssistant/types';

export type ModePresenceIconKey =
  // Mode lab icons
  | 'tool-route'
  | 'execute-pulse'
  | 'patch-sweep'
  | 'verify-bloom'
  | 'context-scan'
  | 'source-thread'
  | 'answer-forming'
  | 'clarify-gate'
  | 'map-build'
  | 'task-stack'
  | 'risk-radar'
  | 'handoff-ready'
  | 'trace-probe'
  | 'fault-isolate'
  | 'patch-hypothesis'
  | 'regression-check'
  | 'subagent-swarm'
  | 'delegate-chain'
  | 'parallel-orbit'
  | 'merge-weave'
  // Global agent-work icons (from work-loading lab)
  | 'agent-spark'
  | 'fanout-orbit'
  | 'work-queue'
  | 'tool-router'
  | 'review-gate'
  | 'approval-wait'
  | 'done-bloom'
  | 'error-signal'
  | 'skeleton-plan'
  // Legacy concrete tool icons (existing presence system)
  | 'scan'
  | 'diff'
  | 'terminal'
  | 'browser'
  | 'files'
  | 'path'
  | 'pixel';

export type AgentPresenceState =
  | 'thinking'
  | 'planning'
  | 'tool_routing'
  | 'task_queue'
  | 'reading'
  | 'reading_context'
  | 'tracing_sources'
  | 'answering'
  | 'clarifying'
  | 'executing'
  | 'terminal'
  | 'writing'
  | 'verifying'
  | 'mapping'
  | 'task_stack'
  | 'risk_scan'
  | 'handoff_ready'
  | 'trace_probe'
  | 'fault_isolate'
  | 'hypothesis'
  | 'regression_check'
  | 'subagent_spawn'
  | 'delegate_subtask'
  | 'multitask_fanout'
  | 'parallel_work'
  | 'merge_results'
  | 'summarizing_subagents'
  | 'waiting_approval'
  | 'approval_required'
  | 'complete'
  | 'failed'
  | 'database'
  | 'browser'
  | 'files'
  | 'drawing'
  | 'imaging'
  | 'tool'
  | 'loading_panel'
  | 'idle';

export type ModePresenceStateKey =
  | Exclude<AgentPresenceState, 'idle' | 'complete' | 'failed' | 'thinking' | 'planning' | 'loading_panel'>
  | 'thinking'
  | 'planning'
  | 'complete'
  | 'failed'
  | 'loading_panel';

export const modeDefaultStateMap: Record<AgentMode, AgentPresenceState> = {
  agent: 'thinking',
  ask: 'reading_context',
  plan: 'planning',
  debug: 'trace_probe',
  multitask: 'multitask_fanout',
};

/**
 * Mode-scoped state → icon mapping (canonical, minimal).
 * This is only used when you supply BOTH mode and state.
 */
export const modePresenceStateMap: Partial<Record<AgentMode, Partial<Record<AgentPresenceState, ModePresenceIconKey>>>> = {
  agent: {
    tool_routing: 'tool-route',
    executing: 'execute-pulse',
    writing: 'patch-sweep',
    verifying: 'verify-bloom',
    terminal: 'execute-pulse',
    tool: 'tool-route',
    database: 'context-scan',
    reading: 'context-scan',
  },
  ask: {
    reading_context: 'context-scan',
    tracing_sources: 'source-thread',
    answering: 'answer-forming',
    clarifying: 'clarify-gate',
    reading: 'context-scan',
    thinking: 'context-scan',
  },
  plan: {
    mapping: 'map-build',
    task_stack: 'task-stack',
    risk_scan: 'risk-radar',
    handoff_ready: 'handoff-ready',
    planning: 'map-build',
  },
  debug: {
    trace_probe: 'trace-probe',
    fault_isolate: 'fault-isolate',
    hypothesis: 'patch-hypothesis',
    regression_check: 'regression-check',
    thinking: 'trace-probe',
    tool: 'trace-probe',
  },
  multitask: {
    subagent_spawn: 'subagent-swarm',
    delegate_subtask: 'delegate-chain',
    parallel_work: 'parallel-orbit',
    multitask_fanout: 'fanout-orbit',
    merge_results: 'merge-weave',
    summarizing_subagents: 'merge-weave',
  },
};

/** Runtime SSE / tool states → best-matching animated icon (prefer concrete tool glyphs). */
const runtimeStateIconMap: Partial<Record<string, ModePresenceIconKey>> = {
  terminal: 'execute-pulse',
  browser: 'browser',
  browser_live: 'browser',
  browser_debug: 'scan',
  browser_capture: 'pixel',
  browser_human_input: 'approval-wait',
  database: 'scan',
  reading: 'scan',
  web_search: 'context-scan',
  web_fetch: 'source-thread',
  writing: 'diff',
  filing: 'files',
  files: 'files',
  drawing: 'path',
  imaging: 'pixel',
  tool: 'tool-router',
  executing: 'execute-pulse',
  verifying: 'verify-bloom',
  mapping: 'map-build',
  task_stack: 'task-stack',
  risk_scan: 'risk-radar',
  handoff_ready: 'handoff-ready',
  trace_probe: 'trace-probe',
  fault_isolate: 'fault-isolate',
  hypothesis: 'patch-hypothesis',
  regression_check: 'regression-check',
  reading_context: 'context-scan',
  tracing_sources: 'source-thread',
  answering: 'answer-forming',
  clarifying: 'clarify-gate',
  subagent_spawn: 'subagent-swarm',
  delegate_subtask: 'delegate-chain',
  multitask_fanout: 'fanout-orbit',
  parallel_work: 'parallel-orbit',
  merge_results: 'merge-weave',
  summarizing_subagents: 'merge-weave',
  waiting_approval: 'review-gate',
  approval_required: 'approval-wait',
  complete: 'done-bloom',
  failed: 'error-signal',
  loading_panel: 'skeleton-plan',
  thinking: 'agent-spark',
  planning: 'agent-spark',
  task_queue: 'work-queue',
  tool_routing: 'tool-router',
};

/** Global semantic state → icon mapping (used when you only have state). */
export const stateIconMap: Partial<Record<AgentPresenceState, ModePresenceIconKey>> = {
  thinking: 'agent-spark',
  planning: 'agent-spark',
  task_queue: 'work-queue',
  tool_routing: 'tool-router',
  waiting_approval: 'review-gate',
  approval_required: 'approval-wait',
  complete: 'done-bloom',
  failed: 'error-signal',
  loading_panel: 'skeleton-plan',

  subagent_spawn: 'subagent-swarm',
  delegate_subtask: 'delegate-chain',
  multitask_fanout: 'fanout-orbit',
  parallel_work: 'fanout-orbit',
  merge_results: 'merge-weave',
  summarizing_subagents: 'merge-weave',
};

/** Legacy concrete tool states (from the existing presence system). */
export const legacySurfaceStateMap: Partial<Record<AgentPresenceState, ModePresenceIconKey>> = {
  reading: 'context-scan',
  database: 'context-scan',
  tool: 'tool-router',
  writing: 'patch-sweep',
  terminal: 'execute-pulse',
  browser: 'browser',
  files: 'files',
  drawing: 'path',
  imaging: 'pixel',
};

export function resolvePresenceIconKey(input: {
  mode?: AgentMode;
  state?: string | null;
  iconKey?: ModePresenceIconKey | null;
}): ModePresenceIconKey {
  if (input.iconKey) return input.iconKey;
  const mode = input.mode;
  const s = String(input.state || '').trim().toLowerCase();
  const state = (s || 'thinking') as AgentPresenceState;

  if (runtimeStateIconMap[s]) return runtimeStateIconMap[s]!;
  if (legacySurfaceStateMap[state]) return legacySurfaceStateMap[state]!;
  if (mode && modePresenceStateMap[mode]?.[state]) return modePresenceStateMap[mode]![state]!;
  if (stateIconMap[state]) return stateIconMap[state]!;
  if (mode) {
    const defState = modeDefaultStateMap[mode];
    const iconFromDefault = stateIconMap[defState] || modePresenceStateMap[mode]?.[defState];
    if (iconFromDefault) return iconFromDefault;
  }
  return 'agent-spark';
}

export function resolvePresenceLabel(input: { mode?: AgentMode; state?: string | null }): string {
  const s = String(input.state || '').trim().toLowerCase();
  const state = (s || 'thinking') as AgentPresenceState;
  // Keep this intentionally simple; consuming components can override title/meta.
  const base: Partial<Record<AgentPresenceState, string>> = {
    thinking: 'Thinking',
    planning: 'Planning',
    tool_routing: 'Routing tools',
    task_queue: 'Workflow running',
    waiting_approval: 'Waiting for approval',
    approval_required: 'Approval required',
    complete: 'Complete',
    failed: 'Failed',
    multitask_fanout: 'Fanout',
    parallel_work: 'Parallel work',
    merge_results: 'Merging results',
  };
  return base[state] || (input.mode ? `${input.mode}…` : 'Working…');
}

export function resolvePresenceDescription(input: { mode?: AgentMode; state?: string | null }): string | undefined {
  const s = String(input.state || '').trim().toLowerCase();
  const state = (s || 'thinking') as AgentPresenceState;
  const desc: Partial<Record<AgentPresenceState, string>> = {
    tool_routing: 'Choosing the right tool lane before execution.',
    task_queue: 'Task list processing and staged work.',
    approval_required: 'Paused until you approve the next action.',
    waiting_approval: 'Applying your approval safely.',
    merge_results: 'Combining parallel outputs into one result.',
  };
  return desc[state];
}
