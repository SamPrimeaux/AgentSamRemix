/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Model picker groups, BYOK hint, pick handler, list renderer.
 */

import { useCallback, useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { ChatModelRow } from '../types';
import { AUTO_MODEL_KEY, isAutoModelSelection } from '../types';
import { LS_AGENT_CHAT_MODEL_KEY } from '../../../src/lib/sessionStorageKeys';
import { ChatModelPickerList } from '../components/ChatModelPickerList';

export function useChatModelPickerControls(args: {
  chatModels: ChatModelRow[];
  selectedModelKey: string;
  setSelectedModelKey: Dispatch<SetStateAction<string>>;
  selectedModelKeyRef: MutableRefObject<string>;
  userPinnedModelRef: MutableRefObject<boolean>;
  setIsModelPickerOpen: Dispatch<SetStateAction<boolean>>;
  setAttachMenuOpen: Dispatch<SetStateAction<boolean>>;
  defaultModelKey: string | null | undefined;
  chatModelsLoading: boolean;
  chatModelsError: string | null | undefined;
  reloadChatModels: () => void;
}) {
  const {
    chatModels, selectedModelKey, setSelectedModelKey, selectedModelKeyRef, userPinnedModelRef,
    setIsModelPickerOpen, setAttachMenuOpen, defaultModelKey, chatModelsLoading, chatModelsError,
    reloadChatModels,
  } = args;
  const modelPickerGroups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, ChatModelRow[]>();
    for (const m of chatModels) {
      const g = (m.picker_group || m.provider || 'Other').trim() || 'Other';
      if (!byGroup.has(g)) {
        byGroup.set(g, []);
        order.push(g);
      }
      byGroup.get(g)!.push(m);
    }
    return order.map((g) => ({ group: g, models: byGroup.get(g)! }));
  }, [chatModels]);

  const modelPickerByokHint = useMemo(() => {
    const platforms = new Set<string>();
    for (const m of chatModels) {
      if (m.billing_key_source === 'byok' || m.byok_configured) continue;
      const p = (m.api_platform || m.provider || '').trim().toLowerCase();
      if (p) platforms.add(p);
    }
    return platforms;
  }, [chatModels]);

  const pickModelKey = useCallback((modelKey: string) => {
    const next = isAutoModelSelection(modelKey) ? AUTO_MODEL_KEY : modelKey.trim();
    userPinnedModelRef.current = !isAutoModelSelection(next);
    selectedModelKeyRef.current = next;
    setSelectedModelKey(next);
    try {
      localStorage.setItem(LS_AGENT_CHAT_MODEL_KEY, next);
    } catch {
      /* ignore */
    }
    setIsModelPickerOpen(false);
    setAttachMenuOpen(false);
  }, []);

  const composerPillClass =
    'iam-composer-pill flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1 min-h-[28px] text-[11px] font-medium text-[var(--dashboard-text)] hover:bg-[var(--bg-hover)] border border-[var(--dashboard-border)] rounded-full transition-colors';

  const renderModelPickerList = useCallback(
    (onPick: (modelKey: string) => void) => (
      <ChatModelPickerList
        onPick={onPick}
        selectedModelKey={selectedModelKey}
        modelPickerGroups={modelPickerGroups}
        modelPickerByokHint={modelPickerByokHint}
        defaultModelKey={defaultModelKey}
        chatModelsLoading={chatModelsLoading}
        chatModelsError={chatModelsError}
        reloadChatModels={reloadChatModels}
      />
    ),
    [modelPickerGroups, defaultModelKey, selectedModelKey, modelPickerByokHint, chatModelsLoading, chatModelsError, reloadChatModels],
  );

  return { modelPickerGroups, modelPickerByokHint, pickModelKey, composerPillClass, renderModelPickerList };
}
