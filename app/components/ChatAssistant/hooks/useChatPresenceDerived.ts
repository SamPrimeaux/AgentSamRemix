/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Running tool label, loading ledger flip, hero thinking card.
 */

import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';
import type { AgentToolTraceRow } from '../execution/types';
import type { ThinkingCardState } from '../../../src/components/ThinkingCard';
import { deriveHeroThinkingState } from '../components/deriveHeroThinking';

export function useChatPresenceDerived(args: {
  isLoading: boolean;
  toolTraceRows: AgentToolTraceRow[];
  presence: { toolName?: string | null; state?: string };
  setLoadingStartedAt: Dispatch<SetStateAction<number | null>>;
  setWorkflowLedger: Dispatch<SetStateAction<any>>;
  thinkingState: ThinkingCardState | null;
  loadingStartedAt: number | null;
  pendingToolApproval: unknown;
}) {
  const {
    isLoading, toolTraceRows, presence, setLoadingStartedAt, setWorkflowLedger,
    thinkingState, loadingStartedAt, pendingToolApproval,
  } = args;
  const runningToolName = useMemo(() => {
    if (!isLoading) return null;
    for (let i = toolTraceRows.length - 1; i >= 0; i--) {
      const row = toolTraceRows[i];
      if (row?.status === 'running' && row.toolName) return row.toolName;
    }
    return presence.toolName || null;
  }, [isLoading, toolTraceRows, presence.toolName]);

  useEffect(() => {
    if (isLoading) {
      setLoadingStartedAt((t) => t ?? Date.now());
      return;
    }
    setLoadingStartedAt(null);
    // Stream ended (done, error, or Worker cancel) — never leave the workstreams banner stuck.
    setWorkflowLedger((prev) =>
      prev.runId
        ? {
            ...prev,
            runId: null,
            currentNodeKey: null,
            status: prev.lastError ? 'failed' : 'completed',
          }
        : prev,
    );
  }, [isLoading]);

  const heroThinking = deriveHeroThinkingState({
    thinkingState,
    isLoading,
    presence,
    loadingStartedAt,
    pendingApproval: !!pendingToolApproval,
  });

  return { runningToolName, heroThinking };
}
