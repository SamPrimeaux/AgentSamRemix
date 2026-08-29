/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentToolTraceRow } from '../agent-chat/execution/types';
import type { WorkflowLedgerState, AgentMode } from '../agent-chat/types';
import type { ThinkingCardState } from '../../src/components/ThinkingCard';
import type { AgentPresence, AgentLogoMotion } from './presenceTypes';
import { deriveAgentPresence, type DerivePresenceInput } from './deriveAgentPresence';

export function useAgentPresence(args: {
  isLoading: boolean;
  mode: AgentMode;
  thinkingState: ThinkingCardState | null;
  pendingToolApproval: DerivePresenceInput['pendingToolApproval'];
  approvalBusy: boolean;
  toolTraceRows: AgentToolTraceRow[];
  workflowLedger: WorkflowLedgerState;
  draftSyntaxBusy: boolean;
  draftRunBusy: boolean;
  subagentWork?: DerivePresenceInput['subagentWork'];
  activePlanRunningCount?: number;
}): { presence: AgentPresence; logoMotion: AgentLogoMotion } {
  const [presenceFlash, setPresenceFlash] = useState<'complete' | 'failed' | null>(null);
  const prevLoadingRef = useRef(args.isLoading);

  useEffect(() => {
    if (prevLoadingRef.current && !args.isLoading) {
      const last = args.toolTraceRows[args.toolTraceRows.length - 1];
      if (last?.status === 'error') setPresenceFlash('failed');
      else setPresenceFlash('complete');
      const t = window.setTimeout(() => setPresenceFlash(null), 720);
      prevLoadingRef.current = args.isLoading;
      return () => window.clearTimeout(t);
    }
    prevLoadingRef.current = args.isLoading;
  }, [args.isLoading, args.toolTraceRows]);

  return useMemo(() => {
    const input: DerivePresenceInput = {
      isLoading: args.isLoading,
      mode: args.mode,
      thinkingState: args.thinkingState,
      pendingToolApproval: args.pendingToolApproval,
      approvalBusy: args.approvalBusy,
      toolTraceRows: args.toolTraceRows,
      workflowLedger: args.workflowLedger,
      draftSyntaxBusy: args.draftSyntaxBusy,
      draftRunBusy: args.draftRunBusy,
      subagentWork: args.subagentWork,
      presenceFlash,
      activePlanRunningCount: args.activePlanRunningCount,
    };
    return deriveAgentPresence(input);
  }, [
    args.isLoading,
    args.mode,
    args.thinkingState,
    args.pendingToolApproval,
    args.approvalBusy,
    args.toolTraceRows,
    args.workflowLedger,
    args.draftSyntaxBusy,
    args.draftRunBusy,
    args.subagentWork,
    args.activePlanRunningCount,
    presenceFlash,
  ]);
}
