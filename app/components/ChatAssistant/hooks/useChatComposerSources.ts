/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Composer source chips + startup prompt helpers.
 */

import {
  useCallback, useEffect, useMemo,
  type Dispatch, type MutableRefObject, type RefObject, type SetStateAction,
} from 'react';
import type { ChatComposerSource } from '../composer/types';
import { WEB_SEARCH_SOURCE } from '../composer/types';
import { readComposerSources, writeComposerSources } from '../composer/composerSourcesStorage';
import type { ComposerAvailableConnector } from '../../../src/hooks/useAvailableConnectors';
import type { AgentMode } from '../types';

export function useChatComposerSources(args: {
  composerSourcesKey: string;
  composerSources: ChatComposerSource[];
  setComposerSources: Dispatch<SetStateAction<ChatComposerSource[]>>;
  agentsamPolicy: Record<string, unknown> | null | undefined;
  mode: AgentMode;
  setMode: Dispatch<SetStateAction<AgentMode>>;
  setInput: Dispatch<SetStateAction<string>>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  composerActionRef: MutableRefObject<string | null>;
}) {
  const {
    composerSourcesKey, composerSources, setComposerSources, agentsamPolicy,
    mode, setMode, setInput, textareaRef, composerActionRef,
  } = args;
  useEffect(() => {
    setComposerSources(readComposerSources(composerSourcesKey));
  }, [composerSourcesKey]);

  useEffect(() => {
    writeComposerSources(composerSourcesKey, composerSources);
  }, [composerSourcesKey, composerSources]);
  const policyWebSearch = Number(agentsamPolicy?.web_search_enabled ?? 1) === 1;

  const activeComposerSourceIds = useMemo(
    () => new Set(composerSources.map((s) => s.id)),
    [composerSources],
  );

  const toggleComposerSource = useCallback((source: ChatComposerSource, enabled: boolean) => {
    setComposerSources((prev) => {
      if (enabled) {
        if (prev.some((s) => s.id === source.id)) return prev;
        return [...prev, source];
      }
      return prev.filter((s) => s.id !== source.id);
    });
  }, []);

  const sourceFromConnector = useCallback(
    (item: ComposerAvailableConnector): ChatComposerSource => ({
      id: `oauth:${item.providerKey}`,
      label: item.name,
      kind: 'oauth',
      providerKey: item.providerKey,
    }),
    [],
  );

  const startWebSearchLane = useCallback(() => {
    if (policyWebSearch) toggleComposerSource(WEB_SEARCH_SOURCE, true);
    setInput((prev) => (prev.trim() ? prev : 'Search the web for: '));
    if (mode === 'ask') setMode('agent');
    textareaRef.current?.focus();
  }, [policyWebSearch, toggleComposerSource, mode]);

  const startImageGenerationPrompt = useCallback(() => {
    composerActionRef.current = 'create_image';
    setInput('Create a visual for ');
    textareaRef.current?.focus();
  }, []);

  const startDeepResearchPrompt = useCallback(() => {
    setMode('plan');
    setInput((prev) => (prev.trim() ? prev : 'Research in depth: '));
    textareaRef.current?.focus();
  }, []);

  const removeComposerSource = useCallback((id: string) => {
    setComposerSources((prev) => prev.filter((s) => s.id !== id));
  }, []);

  return {
    policyWebSearch, activeComposerSourceIds, toggleComposerSource, sourceFromConnector,
    startWebSearchLane, startImageGenerationPrompt, startDeepResearchPrompt, removeComposerSource,
  };
}
