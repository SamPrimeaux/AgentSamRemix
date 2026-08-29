import type { AgentPresence } from '../../../features/agent-presence/presenceTypes';
import type { ThinkingCardState, ThinkingCardStatus } from '../../../src/components/ThinkingCard';

export function deriveHeroThinkingState(input: {
  thinkingState: ThinkingCardState | null;
  isLoading: boolean;
  presence: AgentPresence;
  loadingStartedAt: number | null;
  pendingApproval: boolean;
}): ThinkingCardState | null {
  if (input.thinkingState) return input.thinkingState;
  if (!input.isLoading) return null;

  const status: ThinkingCardStatus = input.pendingApproval
    ? 'blocked'
    : input.presence.state === 'failed'
      ? 'error'
      : input.presence.state === 'complete'
        ? 'done'
        : input.presence.state === 'thinking'
          ? 'thinking'
          : 'working';

  const label =
    input.presence.state === 'idle'
      ? 'Starting…'
      : input.presence.detail || input.presence.label;

  return {
    steps: [],
    thinkingText: label,
    status: input.presence.state === 'idle' ? 'thinking' : status,
    startedAt: input.loadingStartedAt ?? Date.now(),
  };
}

export function shouldShowHeroPresence(input: {
  heroThinking: ThinkingCardState | null;
  isLoading: boolean;
}): boolean {
  return !!input.heroThinking || input.isLoading;
}
