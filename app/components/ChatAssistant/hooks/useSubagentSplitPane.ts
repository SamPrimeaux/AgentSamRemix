/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Mechanical peel from ChatAssistant.tsx — behavior-identical move.
 */

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction, type MutableRefObject } from 'react';
import type { ActiveSubagentRow, Message } from '../types';
import { IAM_AGENT_CHAT_CONVERSATION_CHANGE } from '../../../agentChatConstants';
import { asChatMessages, fetchAgentSessionMessages } from '../../../lib/mapAgentSessionMessages';

export type UseSubagentSplitPaneArgs = {
  conversationId: string;
  isNarrow: boolean;
  isLoading: boolean;
  abortControllerRef: MutableRefObject<AbortController | null>;
  streamReaderRef: MutableRefObject<ReadableStreamDefaultReader<Uint8Array> | null>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
};

export function useSubagentSplitPane({
  conversationId,
  isNarrow,
  isLoading,
  abortControllerRef,
  streamReaderRef,
  setIsLoading,
}: UseSubagentSplitPaneArgs) {
  const [activeSubagents, setActiveSubagents] = useState<ActiveSubagentRow[]>([]);
  const [splitChild, setSplitChild] = useState<{ conversationId: string; label: string } | null>(null);
  const [splitChildMessages, setSplitChildMessages] = useState<Message[]>([]);
  const [focusedPane, setFocusedPane] = useState<'parent' | 'child'>('parent');
  const [splitRatio, setSplitRatio] = useState(0.5);

  useEffect(() => {
    if (isLoading) return;
    const t = window.setTimeout(() => {
      setActiveSubagents((prev) => prev.filter((r) => r.cardStatus === 'approval_required'));
    }, 4500);
    return () => window.clearTimeout(t);
  }, [isLoading]);

  useEffect(() => {
    if (!splitChild) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSplitChild(null);
        setSplitChildMessages([]);
        setFocusedPane('parent');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [splitChild]);

  const openBeside = useCallback(
  async (conversationId: string, label: string) => {
    const cid = String(conversationId || '').trim();
    if (!cid) return;
    if (isNarrow) {
      window.dispatchEvent(
        new CustomEvent(IAM_AGENT_CHAT_CONVERSATION_CHANGE, { detail: { id: cid } }),
      );
      return;
    }
    setSplitChild({ conversationId: cid, label: (label || 'Child').slice(0, 40) });
    setFocusedPane('child');
    try {
      const mapped = await fetchAgentSessionMessages(cid);
      setSplitChildMessages(asChatMessages(mapped));
    } catch {
      setSplitChildMessages([]);
    }
  },
  [isNarrow],
);

const resolveMissingChildConversation = useCallback(
  async (runId: string, slug: string) => {
    const parentId = String(conversationId || '').trim();
    if (!parentId) return null;
    try {
      const r = await fetch(
        `/api/agentsam/spawn-tree?conversation_id=${encodeURIComponent(parentId)}&limit=50`,
        { credentials: 'same-origin' },
      );
      if (!r.ok) return null;
      const data = (await r.json().catch(() => null)) as {
        runs?: Array<{ id?: string; conversation_id?: string; agent_id?: string }>;
      } | null;
      const runs = Array.isArray(data?.runs) ? data!.runs! : [];
      const byRun = runs.find((x) => String(x.id || '') === runId && x.conversation_id);
      if (byRun?.conversation_id) return String(byRun.conversation_id).trim();
      const bySlug = runs.find(
        (x) =>
          String(x.agent_id || '').toLowerCase() === slug.toLowerCase() && x.conversation_id,
      );
      return bySlug?.conversation_id ? String(bySlug.conversation_id).trim() : null;
    } catch {
      return null;
    }
  },
  [conversationId],
);

const handleSubagentEvent = useCallback(
  (ev: {
    type: string;
    fanout_id?: string;
    subagent_slug?: string;
    subagent_run_id?: string;
    status?: string;
    conversation_id?: string;
    task_title?: string;
  }) => {
    const t = String(ev.type || '');
    const slug = ev.subagent_slug ? ev.subagent_slug.replace(/^agentsam_/i, '') : 'subagent';
    const id = ev.subagent_run_id || `${slug}-${ev.fanout_id || 'fanout'}`;
    const label = (ev.task_title || slug).slice(0, 40);

    if (t === 'agentsam_subagent_fanout_result' || (t === 'agentsam_subagent_run_result' && ev.status !== 'running')) {
      setActiveSubagents((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                state: ev.status === 'failed' ? 'failed' : 'done',
                cardStatus: ev.status === 'failed' ? 'failed' : 'done',
                conversationId: ev.conversation_id || r.conversationId || null,
              }
            : r,
        ),
      );
      return;
    }

    const state =
      t === 'agentsam_subagent_fanout_started'
        ? 'multitask_fanout'
        : t === 'agentsam_subagent_run_started'
          ? 'subagent_spawn'
          : t === 'agentsam_subagent_run_progress'
            ? 'parallel_work'
            : t === 'agentsam_subagent_action_required'
              ? 'approval_required'
              : 'delegate_subtask';

    const cardStatus =
      t === 'agentsam_subagent_action_required' ? 'approval_required' : 'running';

    setActiveSubagents((prev) => {
      const existing = prev.find((r) => r.id === id);
      const stepCount = (existing?.stepCount || 0) + (t === 'agentsam_subagent_run_progress' ? 1 : 0);
      const row: ActiveSubagentRow = {
        id,
        slug,
        label,
        state,
        cardStatus,
        conversationId: ev.conversation_id || existing?.conversationId || null,
        startedAt: existing?.startedAt ?? Date.now(),
        stepCount,
      };
      if (existing) return prev.map((r) => (r.id === id ? row : r));
      return [...prev, row];
    });

    if (!ev.conversation_id && (t === 'agentsam_subagent_run_started' || t === 'agentsam_subagent_run_progress')) {
      void resolveMissingChildConversation(id, slug).then((cid) => {
        if (!cid) return;
        setActiveSubagents((prev) =>
          prev.map((r) => (r.id === id && !r.conversationId ? { ...r, conversationId: cid } : r)),
        );
      });
    }
  },
  [resolveMissingChildConversation],
);

const handleStopSubagent = useCallback(
  (_id: string) => {
    abortControllerRef.current?.abort();
    streamReaderRef.current?.cancel().catch(() => {});
    setIsLoading(false);
  },
  [],
);
  return {
    activeSubagents,
    setActiveSubagents,
    splitChild,
    setSplitChild,
    splitChildMessages,
    setSplitChildMessages,
    focusedPane,
    setFocusedPane,
    splitRatio,
    setSplitRatio,
    openBeside,
    resolveMissingChildConversation,
    handleSubagentEvent,
    handleStopSubagent,
  };
}
