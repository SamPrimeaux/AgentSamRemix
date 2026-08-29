/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Mode label/icon + model picker label + mode broadcast.
 */

import { useEffect, useMemo } from 'react';
import { Bug, Infinity, ListTodo, MessageCircle, RefreshCw } from 'lucide-react';
import type { AgentMode, ChatModelRow } from '../types';
import { isAutoModelSelection } from '../types';
import { LS_AGENT_CHAT_MODE } from '../../../src/lib/sessionStorageKeys';

export function useChatModeChrome(args: {
  mode: AgentMode;
  modes: { id: AgentMode; label: string }[];
  selectedModelKey: string;
  chatModels: ChatModelRow[];
}) {
  const { mode, modes, selectedModelKey, chatModels } = args;

  useEffect(() => {
    try {
      localStorage.setItem(LS_AGENT_CHAT_MODE, mode);
    } catch {
      /* ignore */
    }
  }, [mode]);

  const modeLabel = modes.find((m) => m.id === mode)?.label ?? mode;

  const modelPickerLabel = useMemo(() => {
    if (isAutoModelSelection(selectedModelKey)) return 'Auto';
    const row = chatModels.find((m) => m.model_key === selectedModelKey);
    return row?.name || selectedModelKey || 'Auto';
  }, [chatModels, selectedModelKey]);

  const modeIcon = useMemo(() => {
    const sz = 12;
    const cls = 'shrink-0 text-[var(--dashboard-muted)]';
    switch (mode) {
      case 'plan':
        return <ListTodo size={sz} className={cls} />;
      case 'debug':
        return <Bug size={sz} className={cls} />;
      case 'multitask':
        return <RefreshCw size={sz} className={cls} />;
      case 'ask':
        return <MessageCircle size={sz} className={cls} />;
      default:
        return <Infinity size={sz} className={cls} />;
    }
  }, [mode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('iam-chat-mode', { detail: { label: modeLabel, slug: mode.toLowerCase() } }));
  }, [modeLabel, mode]);

  return { modeLabel, modelPickerLabel, modeIcon };
}
