/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Mechanical peel from ChatAssistant.tsx — behavior-identical move.
 */

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction, type MutableRefObject } from 'react';
import type { Message, PlanQuestionsBatchPayload } from '../types';
import { consumeAgentChatSseBody } from './useAgentChatStream';
import { mirrorPlanMarkdownToLocal } from '../../../src/lib/library/planLocalMirror';

export type UsePlanRunActionsArgs = {
  conversationId: string;
  messages: Message[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setPresenceState: Dispatch<SetStateAction<string>>;
  setThinkingState: Dispatch<SetStateAction<any>>;
  setWorkflowLedger: Dispatch<SetStateAction<any>>;
  setToolTraceRows: Dispatch<SetStateAction<any>>;
  setConversationId: Dispatch<SetStateAction<string>>;
  setPendingToolApproval: Dispatch<SetStateAction<any>>;
  setLocalActivePlanId: Dispatch<SetStateAction<string | null>>;
  activePlanIdRef: MutableRefObject<string | null>;
  abortControllerRef: MutableRefObject<AbortController | null>;
  streamFinalizedRef: MutableRefObject<boolean>;
  streamReaderRef: MutableRefObject<ReadableStreamDefaultReader<Uint8Array> | null>;
  lastQuestionsBatchIdRef: MutableRefObject<string | null>;
  stripEmptyAssistantTail: (prev: Message[]) => Message[];
  loadSessions: () => Promise<void>;
  handlePythonDraftOpened: (fileName: string) => void;
  handleThinkingEvent: (ev: any) => void;
  handleSubagentEvent: (ev: any) => void;
  handleStreamModel: (modelKey: string | null) => void;
  setQuestionsIntake: any;
  onFileSelect?: any;
  onBrowserNavigate?: any;
  onR2FileUpdated?: any;
  onAgentRunContext?: any;
  onActivePlanChange?: (planId: string | null) => void;
};

export function usePlanRunActions(args: UsePlanRunActionsArgs) {
  const {
    conversationId,
    messages,
    setMessages,
    setIsLoading,
    setPresenceState,
    setThinkingState,
    setWorkflowLedger,
    setToolTraceRows,
    setConversationId,
    setPendingToolApproval,
    setLocalActivePlanId,
    activePlanIdRef,
    abortControllerRef,
    streamFinalizedRef,
    streamReaderRef,
    lastQuestionsBatchIdRef,
    stripEmptyAssistantTail,
    loadSessions,
    handlePythonDraftOpened,
    handleThinkingEvent,
    handleSubagentEvent,
    handleStreamModel,
    setQuestionsIntake,
    onFileSelect,
    onBrowserNavigate,
    onR2FileUpdated,
    onAgentRunContext,
    onActivePlanChange,
  } = args;

  const [runPlanBusy, setRunPlanBusy] = useState(false);
  const [savePlanBusy, setSavePlanBusy] = useState(false);
  const [planIntakeBusy, setPlanIntakeBusy] = useState(false);

const handlePlanIntakeSubmit = useCallback(
  async (payload: {
    batchId: string;
    selections: Record<string, string>;
    optionalDetails: string;
    skip: boolean;
  }) => {
    const batchId = payload.batchId.trim();
    if (!batchId || planIntakeBusy) return;
    setPlanIntakeBusy(true);
    setMessages((prev) =>
      prev.map((m) =>
        m.planQuestionsBatch?.batch_id === batchId
          ? { ...m, planQuestionsBatch: { ...m.planQuestionsBatch, submitted: true } }
          : m,
      ),
    );
    setThinkingState({
      steps: [],
      thinkingText: payload.skip ? 'Skipping questions — creating plan…' : 'Creating plan from your answers…',
      status: 'thinking',
      startedAt: Date.now(),
      surface: 'plan',
    });
    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    streamFinalizedRef.current = false;
    setIsLoading(true);
    setPresenceState('thinking');
    try {
      const res = await fetch('/api/agent/plan/intake/submit', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch_id: batchId,
          selections: payload.selections,
          optional_details: payload.optionalDetails,
          skip: payload.skip,
          session_id: conversationId || undefined,
          sessionId: conversationId || undefined,
        }),
        signal,
      });
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => '');
        throw new Error(errText || `Plan intake submit failed (${res.status})`);
      }
      const reader = res.body.getReader();
      streamReaderRef.current = reader;
      await consumeAgentChatSseBody({
        signal,
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
        onToolApprovalRequest: (tool) => {
          setPendingToolApproval({ tool });
          setIsLoading(false);
          abortControllerRef.current = null;
        },
      });
      streamReaderRef.current = null;
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      console.error('[ChatAssistant] plan intake submit', e);
      const msg = e instanceof Error ? e.message : String(e);
      setMessages((prev) => {
        const next = [...prev];
        next.push({ role: 'assistant', content: `[Plan intake failed: ${msg}]` });
        return next;
      });
      setThinkingState((prev) => (prev ? { ...prev, status: 'error' } : prev));
    } finally {
      setPlanIntakeBusy(false);
      setIsLoading(false);
      setPresenceState('idle');
      abortControllerRef.current = null;
    }
  },
  [
    planIntakeBusy,
    conversationId,
    setMessages,
    handleThinkingEvent,
    handlePythonDraftOpened,
    stripEmptyAssistantTail,
    loadSessions,
    onBrowserNavigate,
    onR2FileUpdated,
    onAgentRunContext,
    handleStreamModel,
    onFileSelect,
  ],
);

/**
 * Sync the latest plan_questions_batch into the shared EditorContext so
 * MonacoEditorView's 'questions_intake' tab can render QuestionsIntakePage
 * with live busy/onSubmit. Auto-opens the Questions tab once per new
 * batch_id; doesn't re-focus it on every render after that, so it doesn't
 * fight the user if they've switched away.
 */
useEffect(() => {
  let latest: PlanQuestionsBatchPayload | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const candidate = messages[i]?.planQuestionsBatch;
    if (candidate) {
      latest = candidate;
      break;
    }
  }

  if (!latest) {
    if (lastQuestionsBatchIdRef.current !== null) {
      lastQuestionsBatchIdRef.current = null;
      setQuestionsIntake(null);
    }
    return;
  }

  if (latest.submitted) {
    setQuestionsIntake({ batch: latest, busy: false, onSubmit: () => {} });
    return;
  }

  setQuestionsIntake({
    batch: latest,
    busy: planIntakeBusy,
    onSubmit: (payload) => void handlePlanIntakeSubmit(payload),
  });

  if (lastQuestionsBatchIdRef.current !== latest.batch_id) {
    lastQuestionsBatchIdRef.current = latest.batch_id;
    onFileSelect?.({
      name: 'Questions',
      content: '',
      fileKind: 'questions_intake',
      workspacePath: `questions:${latest.batch_id}`,
    });
  }
}, [messages, planIntakeBusy, handlePlanIntakeSubmit, onFileSelect, setQuestionsIntake]);

const handleRunPlan = useCallback(async (planId: string) => {
  const pid = planId.trim();
  if (!pid || runPlanBusy) return;
  setRunPlanBusy(true);
  setLocalActivePlanId(pid);
  activePlanIdRef.current = pid;
  onActivePlanChange?.(pid);
  setThinkingState({
    steps: [],
    thinkingText: 'Building…',
    status: 'working',
    startedAt: Date.now(),
  });
  if (abortControllerRef.current) abortControllerRef.current.abort();
  abortControllerRef.current = new AbortController();
  const signal = abortControllerRef.current.signal;
  streamFinalizedRef.current = false;
  setIsLoading(true);
  setPresenceState('working');
  try {
    const res = await fetch('/api/agent/plan/execute', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan_id: pid,
        session_id: conversationId || undefined,
        sessionId: conversationId || undefined,
      }),
      signal,
    });
    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => '');
      throw new Error(errText || `Plan execute failed (${res.status})`);
    }
    const reader = res.body.getReader();
    streamReaderRef.current = reader;
    await consumeAgentChatSseBody({
      signal,
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
      onToolApprovalRequest: (tool) => {
        setPendingToolApproval({ tool });
        setIsLoading(false);
        abortControllerRef.current = null;
      },
    });
    streamReaderRef.current = null;
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return;
    console.error('[ChatAssistant] plan execute', e);
    const msg = e instanceof Error ? e.message : String(e);
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === 'assistant') {
        next[next.length - 1] = { ...last, content: `${last.content}\n\n[Plan execute failed: ${msg}]` };
      } else {
        next.push({ role: 'assistant', content: `[Plan execute failed: ${msg}]` });
      }
      return next;
    });
    setThinkingState((prev) => (prev ? { ...prev, status: 'error' } : prev));
  } finally {
    setRunPlanBusy(false);
    setIsLoading(false);
    setPresenceState('idle');
    abortControllerRef.current = null;
  }
}, [
  runPlanBusy,
  conversationId,
  setMessages,
  handleThinkingEvent,
  handlePythonDraftOpened,
  stripEmptyAssistantTail,
  loadSessions,
  onBrowserNavigate,
  onR2FileUpdated,
  onAgentRunContext,
  handleStreamModel,
  onFileSelect,
  onActivePlanChange,
]);

const handleSavePlanWorkspace = useCallback(async (planId: string) => {
  const pid = planId.trim();
  if (!pid || savePlanBusy || runPlanBusy) return;
  setSavePlanBusy(true);
  try {
    const res = await fetch('/api/agent/plan/save-workspace', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan_id: pid,
        session_id: conversationId || undefined,
        sessionId: conversationId || undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        typeof data?.message === 'string'
          ? data.message
          : typeof data?.error === 'string'
            ? data.error
            : `Save failed (${res.status})`,
      );
    }
    const key = typeof data?.markdown?.r2_key === 'string' ? data.markdown.r2_key : '';
    let localNote = '';
    const markdownContent = typeof data?.markdown?.content === 'string' ? data.markdown.content : '';
    if (markdownContent) {
      // Best-effort mirror into the connected Local folder — jailed to
      // `.agentsam/plans/plan-{id}.md` (re-derived from planId, never from
      // the response `path`). This is a convenience copy alongside the
      // durable R2 save above; it never replaces or gates on R2 success.
      try {
        const mirrored = await mirrorPlanMarkdownToLocal(pid, markdownContent);
        if (mirrored.ok) localNote = ` Also mirrored to Local (\`${mirrored.path}\`).`;
      } catch {
        /* soft-skip — local mirror is best-effort only */
      }
    }
    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: (key
          ? `Saved plan to workspace ARTIFACTS (\`${key}\`).`
          : 'Saved plan to workspace ARTIFACTS.') + localNote,
      },
    ]);
  } catch (e) {
    console.error('[ChatAssistant] plan save-workspace', e);
    const msg = e instanceof Error ? e.message : String(e);
    setMessages((prev) => [
      ...prev,
      { role: 'assistant', content: `[Save to workspace failed: ${msg}]` },
    ]);
  } finally {
    setSavePlanBusy(false);
  }
}, [savePlanBusy, runPlanBusy, conversationId, setMessages]);

  return {
    runPlanBusy,
    savePlanBusy,
    planIntakeBusy,
    handlePlanIntakeSubmit,
    handleRunPlan,
    handleSavePlanWorkspace,
  };
}
