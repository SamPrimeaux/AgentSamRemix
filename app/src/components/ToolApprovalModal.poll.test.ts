import { describe, expect, it } from 'vitest';
import { shouldPollApprovals } from './ToolApprovalModal';

describe('shouldPollApprovals', () => {
  const base = {
    pathname: '/dashboard/agent/editor',
    hasVisibleApproval: false,
    workspaceId: 'ws_inneranimalmedia',
    agentRunId: null as string | null,
    toolExecutionActive: false,
    recentPending: false,
    chatSessionId: 'conv_1',
    proposalId: '',
  };

  it('does not poll on hung Working… alone', () => {
    expect(shouldPollApprovals({ ...base, toolExecutionActive: true })).toBe(false);
  });

  it('polls when an approval card is visible', () => {
    expect(shouldPollApprovals({ ...base, hasVisibleApproval: true })).toBe(true);
  });

  it('polls during a live turn only after a recent pending signal', () => {
    expect(
      shouldPollApprovals({ ...base, toolExecutionActive: true, recentPending: true }),
    ).toBe(true);
  });

  it('polls proposal deep-links', () => {
    expect(shouldPollApprovals({ ...base, proposalId: 'prop_1' })).toBe(true);
  });
});
