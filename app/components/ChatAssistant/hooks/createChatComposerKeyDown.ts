/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Composer textarea keydown (mention/slash/send).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { KeyboardEvent } from 'react';
import { nextAgentMode } from '../../../lib/plan-mode-utils';

export function createChatComposerKeyDown(d: any) {
  const {
    mentionOpen, mentionItems, mentionIndex, setMentionIndex, applyMention, setMentionOpen,
    slashOpen, slashItems, slashIndex, setSlashIndex, applySlash, setSlashOpen,
    setMode, setIsModeOpen, agentsamPolicyRef, isLoading, setMessageQueue, input, setInput, handleSend,
  } = d;
  return (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (mentionOpen && mentionItems.length) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setMentionIndex((i) => Math.min(i + 1, mentionItems.length - 1));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setMentionIndex((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          applyMention(mentionItems[mentionIndex]);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setMentionOpen(false);
          return;
        }
      }
      if (slashOpen && slashItems.length) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSlashIndex((i) => Math.min(i + 1, slashItems.length - 1));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSlashIndex((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          applySlash(slashItems[slashIndex]);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setSlashOpen(false);
          return;
        }
      }
      if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault();
        setMode((m) => nextAgentMode(m));
        setIsModeOpen(false);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        const modEnter = Number(agentsamPolicyRef.current?.submit_with_mod_enter) === 1;
        if (modEnter && !(e.ctrlKey || e.metaKey)) {
          return;
        }
        e.preventDefault();
        if (isLoading) {
          setMessageQueue((prev) => [...prev, input]);
          setInput('');
        } else {
          handleSend();
        }
      }
  };
}
