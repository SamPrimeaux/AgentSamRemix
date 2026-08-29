import type { AgentMode, ModePresenceIconKey } from '../mode-presence/agentModePresenceMap';
import type { AgentToolTraceStatus } from '../../components/ChatAssistant/execution/types';
import { resolveAgentPresence } from './resolveAgentPresence';
import { laneLabel, toolNameToLane } from './lanes';
import type { AgentToolLane } from './types';

export type ToolTracePresenceDisplay = {
  lane: AgentToolLane;
  label: string;
  description: string;
  presenceState: string;
  iconKey: ModePresenceIconKey;
};

export function resolveToolTracePresence(input: {
  toolName: string;
  status: AgentToolTraceStatus;
  mode?: AgentMode;
  lines?: string[];
}): ToolTracePresenceDisplay {
  const lane = toolNameToLane(input.toolName);
  const hay = `${input.toolName} ${(input.lines || []).join(' ')}`.toLowerCase();
  const status =
    input.status === 'error' ? 'failed' : input.status === 'running' ? 'active' : 'done';

  const resolved = resolveAgentPresence({
    mode: input.mode ?? 'agent',
    lane,
    toolName: input.toolName,
    status,
    phase: input.status === 'running' ? 'executing' : input.status === 'error' ? 'failed' : 'complete',
    title: laneLabel(lane),
  });

  const description =
    resolved.description ||
    (input.lines?.filter(Boolean).join(' · ') ?? input.toolName);

  return {
    lane,
    label: /terminal|d1|sql|browser|image|file|patch/i.test(hay)
      ? resolved.label
      : `${resolved.label} · ${input.toolName}`,
    description: description.slice(0, 200),
    presenceState: resolved.presenceState,
    iconKey: resolved.iconKey,
  };
}
