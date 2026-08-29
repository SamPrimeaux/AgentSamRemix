/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Mechanical peel from ChatAssistant.tsx — behavior-identical move.
 */

import { useCallback, useState, type Dispatch, type SetStateAction, type MutableRefObject } from 'react';
import type { Message, ToolApprovalPayload } from '../types';
import { consumeAgentChatSseBody } from './useAgentChatStream';

export type UseToolApprovalActionsArgs = {
  conversationId: string;
  messages: Message[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setPresenceState: Dispatch<SetStateAction<string>>;
  setWorkflowLedger: Dispatch<SetStateAction<any>>;
  setToolTraceRows: Dispatch<SetStateAction<any>>;
  setConversationId: Dispatch<SetStateAction<string>>;
  setMessageQueue: Dispatch<SetStateAction<string[]>>;
  abortControllerRef: MutableRefObject<AbortController | null>;
  streamFinalizedRef: MutableRefObject<boolean>;
  streamReaderRef: MutableRefObject<ReadableStreamDefaultReader<Uint8Array> | null>;
  messageQueueRef: MutableRefObject<string[]>;
  handleSendRef: MutableRefObject<(msg?: string, opts?: any) => any>;
  stripEmptyAssistantTail: (prev: Message[]) => Message[];
  loadSessions: () => Promise<void>;
  handlePythonDraftOpened: (fileName: string) => void;
  handleThinkingEvent: (ev: any) => void;
  handleSubagentEvent: (ev: any) => void;
  handleStreamModel: (modelKey: string | null) => void;
  onBrowserNavigate?: any;
  onR2FileUpdated?: any;
  onFileSelect?: any;
  onAgentRunContext?: any;
  agentRunId?: string | null;
};

export function useToolApprovalActions(args: UseToolApprovalActionsArgs) {
  const {
    conversationId,
    messages,
    setMessages,
    setIsLoading,
    setPresenceState,
    setWorkflowLedger,
    setToolTraceRows,
    setConversationId,
    setMessageQueue,
    abortControllerRef,
    streamFinalizedRef,
    streamReaderRef,
    messageQueueRef,
    handleSendRef,
    stripEmptyAssistantTail,
    loadSessions,
    handlePythonDraftOpened,
    handleThinkingEvent,
    handleSubagentEvent,
    handleStreamModel,
    onBrowserNavigate,
    onR2FileUpdated,
    onFileSelect,
    onAgentRunContext,
    agentRunId,
  } = args;

  const [pendingToolApproval, setPendingToolApproval] = useState<{
    tool: ToolApprovalPayload;
  } | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);

const handleApprovePendingTool = useCallback(async () => {
  if (!pendingToolApproval) return;
  const { tool } = pendingToolApproval;
  setApprovalBusy(true);
  try {
    if (tool.plan_terminal) {
      const { plan_id, task_id, command_run_id, approval_id } = tool.plan_terminal;
      const approveRes = await fetch(`/api/agent/proposals/${encodeURIComponent(approval_id)}/approve`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!approveRes.ok) {
        const errText = await approveRes.text().catch(() => '');
        throw new Error(errText || `Approve failed (${approveRes.status})`);
      }
      const resumeRes = await fetch('/api/agent/plan-task/resume', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id,
          task_id,
          command_run_id,
          approval_id,
          session_id: conversationId || undefined,
          conversationId: conversationId || undefined,
        }),
      });
      if (!resumeRes.ok || !resumeRes.body) {
        const errText = await resumeRes.text().catch(() => '');
        throw new Error(errText || `Resume failed (${resumeRes.status})`);
      }
      setPendingToolApproval(null);
      setIsLoading(false);
      setPresenceState('idle');
      abortControllerRef.current = null;
      streamFinalizedRef.current = false;
      const reader = resumeRes.body.getReader();
      streamReaderRef.current = reader;
      const resumeSignal = new AbortController().signal;
      const tail =
        messages.length && messages[messages.length - 1]?.role === 'assistant'
          ? String(messages[messages.length - 1].content || '')
          : '';
      await consumeAgentChatSseBody({
        signal: resumeSignal,
        reader,
        streamFinalizedRef,
        streamReaderRef,
        setMessages,
        setIsLoading,
        setWorkflowLedger,
        setToolTraceRows,
        onPythonDraftOpened: handlePythonDraftOpened,
        setConversationId,
        stripEmptyAssistantTail,
        loadSessions,
        onBrowserNavigate,
        onR2FileUpdated,
        onThinkingEvent: handleThinkingEvent,
        onSubagentEvent: handleSubagentEvent,
        onAgentRunContext,
        onStreamModel: handleStreamModel,
        onFileSelect: onFileSelect
          ? (f) => onFileSelect({ name: f.name, content: f.content, originalContent: f.originalContent ?? '' })
          : undefined,
        onToolApprovalRequest: () => {},
        mergeIntoLastAssistant: true,
        initialAssistantBuffer: tail,
      });
      streamReaderRef.current = null;
      const q = messageQueueRef.current;
      if (q.length > 0) {
        const next = q[0];
        setMessageQueue((prev) => prev.slice(1));
        void handleSendRef.current(next);
      }
      return;
    }

    const queueApprovalId = (tool.approval_id || tool.proposal_id || '').trim();
    if (queueApprovalId) {
      const patchRes = await fetch(`/api/agent/approval/${encodeURIComponent(queueApprovalId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ status: 'approved' }),
      });
      if (!patchRes.ok) {
        const errText = await patchRes.text().catch(() => '');
        throw new Error(errText || `Approval failed (${patchRes.status})`);
      }
    }

    const res = await fetch('/api/agent/chat/execute-approved-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        tool_name: tool.name,
        tool_input: {
          ...(tool.parameters ?? {}),
          ...(queueApprovalId ? { approval_id: queueApprovalId } : {}),
        },
        conversation_id: conversationId || undefined,
        agent_run_id: agentRunId?.trim() || undefined,
        approval_id: queueApprovalId || undefined,
      }),
    });
    const j = (await res.json()) as { success?: boolean; error?: string; result?: unknown };
    setPendingToolApproval(null);
    const resultStr =
      typeof j.result === 'string' ? j.result : JSON.stringify(j.result ?? null, null, 2);
    const suffix = j.success
      ? `\n\n---\nTool **${tool.name}** completed.\n\`\`\`\n${resultStr.slice(0, 12000)}\n\`\`\``
      : `\n\n---\nTool **${tool.name}** failed: ${j.error ?? 'unknown error'}`;
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === 'assistant') {
        next[next.length - 1] = { ...last, content: last.content + suffix };
      }
      return next;
    });
    // Approval path used to stop here (no model resume) → "finished without a reply"
    // and follow-up turns lost write tools. Resume the agent with the tool result.
    if (j.success) {
      const continuePrompt =
        `Approved tool \`${tool.name}\` completed. Result JSON:\n\`\`\`json\n${resultStr.slice(0, 6000)}\n\`\`\`\n` +
        `Continue the user's prior instructions from where you left off. ` +
        `Prefer fs_read_file / fs_write_file when those tools are available. ` +
        `Do not invent tool unavailability — call agentsam_search_tools if a needed tool is missing from the menu.`;
      void handleSendRef.current(continuePrompt);
    }
  } catch (e) {
    console.error('[ChatAssistant] execute-approved-tool', e);
    setPendingToolApproval(null);
    const msg = e instanceof Error ? e.message : String(e);
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === 'assistant') {
        next[next.length - 1] = { ...last, content: `${last.content}\n\n[Approve request failed: ${msg}]` };
      }
      return next;
    });
  } finally {
    setApprovalBusy(false);
  }
}, [pendingToolApproval, conversationId, setMessages, messages, onBrowserNavigate, onR2FileUpdated, onFileSelect, loadSessions, stripEmptyAssistantTail, setWorkflowLedger, setToolTraceRows, handlePythonDraftOpened, setConversationId]);

const handleDenyPendingTool = useCallback(async () => {
  if (!pendingToolApproval) return;
  const { tool } = pendingToolApproval;
  const queueApprovalId = (tool.approval_id || tool.proposal_id || '').trim();
  if (queueApprovalId && !tool.plan_terminal) {
    try {
      await fetch(`/api/agent/approval/${encodeURIComponent(queueApprovalId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ status: 'denied' }),
      });
    } catch (e) {
      console.warn('[ChatAssistant] approval deny', e);
    }
  }
  if (tool.plan_terminal?.approval_id) {
    try {
      await fetch(`/api/agent/proposals/${encodeURIComponent(tool.plan_terminal.approval_id)}/deny`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    } catch (e) {
      console.warn('[ChatAssistant] plan terminal deny', e);
    }
  }
  const wasPlanTerminal = !!tool.plan_terminal;
  setPendingToolApproval(null);
  setMessages((prev) => {
    const next = [...prev];
    const last = next[next.length - 1];
    if (last?.role === 'assistant') {
      next[next.length - 1] = {
        ...last,
        content: `${last.content}\n\n[${wasPlanTerminal ? 'Terminal command' : 'Tool execution'} cancelled.]`,
      };
    }
    return next;
  });
}, [pendingToolApproval, setMessages]);

  return {
    pendingToolApproval,
    setPendingToolApproval,
    approvalBusy,
    handleApprovePendingTool,
    handleDenyPendingTool,
  };
}
