/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Selected model key, persistence, queue drain, turn summary.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  useEffect, useMemo, useRef, useState,
  type Dispatch, type MutableRefObject, type SetStateAction,
} from 'react';
import type { ChatModelRow } from '../types';
import { AUTO_MODEL_KEY, isAutoModelSelection } from '../types';
import { LS_AGENT_CHAT_MODEL_KEY } from '../../../src/lib/sessionStorageKeys';
import type { AgentToolTraceRow } from '../execution/types';

export function useChatModelSelection(args: {
  chatModels: ChatModelRow[];
  isLoading: boolean;
  messageQueueRef: MutableRefObject<string[]>;
  setMessageQueue: Dispatch<SetStateAction<string[]>>;
  handleSendRef: MutableRefObject<(msg?: string, opts?: any) => any>;
  toolTraceRows: AgentToolTraceRow[];
  streamModelKey: string | null;
}) {
  const {
    chatModels, isLoading, messageQueueRef, setMessageQueue, handleSendRef, toolTraceRows, streamModelKey,
  } = args;
  const [selectedModelKey, setSelectedModelKey] = useState<string>(() => {
    if (typeof localStorage === 'undefined') return AUTO_MODEL_KEY;
    try {
      const stored = localStorage.getItem(LS_AGENT_CHAT_MODEL_KEY);
      if (stored != null && String(stored).trim() !== '') {
        return isAutoModelSelection(stored) ? AUTO_MODEL_KEY : String(stored).trim();
      }
    } catch {
      /* ignore */
    }
    return AUTO_MODEL_KEY;
  });
  const selectedModelKeyRef = useRef(selectedModelKey);
  const userPinnedModelRef = useRef(!isAutoModelSelection(selectedModelKey));
  selectedModelKeyRef.current = selectedModelKey;

  const displayRunModel =
    streamModelKey ||
    (!isAutoModelSelection(selectedModelKey) && selectedModelKey ? selectedModelKey : null);

  /** Turn summary under composer — not in the message stream (avoids mono "Done · model · tools" crowding the reply). */
  const composerTurnSummary = useMemo(() => {
    if (isLoading || !toolTraceRows.length) return null;
    const anyRunning = toolTraceRows.some((r) => r.status === 'running' && !r.cadJobLive);
    if (anyRunning) return null;
    const names = Array.from(
      new Set(toolTraceRows.map((r) => String(r.toolName || '').trim()).filter(Boolean)),
    );
    if (!names.length && !displayRunModel) return null;
    const toolsLabel =
      names.length > 4 ? `${names.slice(0, 4).join(', ')} +${names.length - 4}` : names.join(', ');
    return {
      model: displayRunModel?.trim() || null,
      toolsLabel: toolsLabel || null,
    };
  }, [isLoading, toolTraceRows, displayRunModel]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_AGENT_CHAT_MODEL_KEY, selectedModelKey);
    } catch {
      /* ignore */
    }
  }, [selectedModelKey]);

  useEffect(() => {
    if (!chatModels.length) return;
    if (userPinnedModelRef.current && !isAutoModelSelection(selectedModelKeyRef.current)) return;
    setSelectedModelKey((prev) => {
      if (isAutoModelSelection(prev)) return AUTO_MODEL_KEY;
      if (prev && chatModels.some((m) => m.model_key === prev)) return prev;
      return AUTO_MODEL_KEY;
    });
  }, [chatModels]);

  const prevSelectedModelKeyRef = useRef('');
  useEffect(() => {
    const prev = prevSelectedModelKeyRef.current;
    prevSelectedModelKeyRef.current = selectedModelKey;
    if (!selectedModelKey || prev || isLoading) return;
    const q = messageQueueRef.current;
    if (!q.length) return;
    const next = q[0];
    setMessageQueue((prevQ) => prevQ.slice(1));
    void handleSendRef.current(next);
  }, [selectedModelKey, isLoading]);

  return {
    selectedModelKey, setSelectedModelKey, selectedModelKeyRef, userPinnedModelRef,
    displayRunModel, composerTurnSummary,
  };
}
