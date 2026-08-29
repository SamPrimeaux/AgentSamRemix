/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * @-mention / slash-command pickers. Mechanical peel from ChatAssistant.tsx.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  useCallback, useLayoutEffect, useMemo, useRef, useState,
  type Dispatch, type MutableRefObject, type RefObject, type SetStateAction,
} from 'react';
import { useClickOutsideToClose } from '../../../hooks/useClickOutsideToClose';
import type { Message, PickerItem, SlashCmd } from '../types';
import { measureAboveAnchor, syncComposerTextareaHeight } from '../composerLayout';
import { COMPOSER_TEXTAREA_MAX_PX_NARROW, COMPOSER_TEXTAREA_MAX_PX_WIDE } from '../types';
import { executeSlashCommand } from './executeSlashCommand';

export type UseChatComposerPickersArgs = {
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  isNarrow: boolean;
  agentsamPolicyRef: MutableRefObject<Record<string, unknown> | null>;
  conversationId: string;
  agentRunId?: string | null;
  workspaceId?: string | null;
  messages: Message[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setMode: Dispatch<SetStateAction<any>>;
  setPlanSuggestDismissed: Dispatch<SetStateAction<boolean>>;
  onApprovalRequired?: (id: string) => void;
};

export function useChatComposerPickers(args: UseChatComposerPickersArgs) {
  const {
    input, setInput, textareaRef, isNarrow, agentsamPolicyRef, conversationId,
    agentRunId, workspaceId, messages, setMessages, setMode, setPlanSuggestDismissed,
    onApprovalRequired,
  } = args;

  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionItems, setMentionItems] = useState<PickerItem[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionStyle, setMentionStyle] = useState<React.CSSProperties | null>(null);
  const mentionQueryRef = useRef<{ start: number; end: number } | null>(null);
  const mentionMenuRef = useRef<HTMLDivElement>(null);

  const [slashOpen, setSlashOpen] = useState(false);
  const [slashItems, setSlashItems] = useState<SlashCmd[]>([]);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashStyle, setSlashStyle] = useState<React.CSSProperties | null>(null);
  const slashQueryRef = useRef<{ start: number; end: number } | null>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);

  const catalogCacheRef = useRef<{ at: number; items: PickerItem[] } | null>(null);
  const commandsCacheRef = useRef<{ at: number; items: SlashCmd[] } | null>(null);

  const closeMention = useCallback(() => setMentionOpen(false), []);
  const closeSlash = useCallback(() => setSlashOpen(false), []);
  const composerExcept = useMemo(() => [textareaRef], [textareaRef]);
  useClickOutsideToClose(mentionMenuRef, mentionOpen, closeMention, composerExcept);
  useClickOutsideToClose(slashMenuRef, slashOpen, closeSlash, composerExcept);

  useLayoutEffect(() => {
    if (!mentionOpen && !slashOpen) return;
    const clampW = slashOpen ? 320 : 280;
    const st = measureAboveAnchor(textareaRef.current, 220, 280, clampW);
    if (mentionOpen) setMentionStyle(st);
    if (slashOpen) setSlashStyle(st);
    const h = () => {
      const s = measureAboveAnchor(textareaRef.current, 220, 280, clampW);
      if (mentionOpen) setMentionStyle(s);
      if (slashOpen) setSlashStyle(s);
    };
    window.addEventListener('resize', h);
    window.addEventListener('scroll', h, true);
    return () => {
      window.removeEventListener('resize', h);
      window.removeEventListener('scroll', h, true);
    };
  }, [mentionOpen, slashOpen, input]);

  const insertAtCursor = (newValue: string, selStart: number, selEnd: number) => {
    setInput(newValue);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(selStart, selEnd);
        syncComposerTextareaHeight(
          el,
          isNarrow ? COMPOSER_TEXTAREA_MAX_PX_NARROW : COMPOSER_TEXTAREA_MAX_PX_WIDE,
        );
      }
    });
  };

  async function loadCatalog(): Promise<PickerItem[]> {
    const now = Date.now();
    if (catalogCacheRef.current && now - catalogCacheRef.current.at < 60000) {
      return catalogCacheRef.current.items;
    }
    const res = await fetch('/api/agent/context-picker/catalog');
    if (!res.ok) return [];
    const data = await res.json();
    const items: PickerItem[] = [
      { id: 'browser:surface', label: 'browser', kind: 'browser' },
    ];
    (data.tables || []).forEach((t: string) => {
      items.push({ id: `table:${t}`, label: t, kind: 'table' });
    });
    (data.workflows || []).forEach((w: { id?: string; name?: string }) => {
      items.push({ id: `wf:${w.id}`, label: w.name || w.id || '', kind: 'workflow' });
    });
    (data.commands || []).forEach((c: { slug?: string; name?: string }) => {
      items.push({ id: `cmd:${c.slug}`, label: c.name || c.slug || '', kind: 'command' });
    });
    (data.memory_keys || []).forEach((k: string) => {
      items.push({ id: `mem:${k}`, label: k, kind: 'memory' });
    });
    (data.workspaces || []).forEach((w: { id?: string; name?: string }) => {
      items.push({ id: `ws:${w.id}`, label: w.name || w.id || '', kind: 'workspace' });
    });
    catalogCacheRef.current = { at: now, items };
    return items;
  }

  async function loadCommands(): Promise<SlashCmd[]> {
    const now = Date.now();
    if (commandsCacheRef.current && now - commandsCacheRef.current.at < 60000) {
      return commandsCacheRef.current.items;
    }
    const res = await fetch('/api/agent/commands');
    if (!res.ok) return [];
    const data = await res.json();
    const arr = Array.isArray(data) ? data : [];
    const items = arr.map((r: { id?: string; slug: string; description?: string }) => ({
      id: r.id,
      slug: r.slug,
      description: r.description ?? null,
    }));
    commandsCacheRef.current = { at: now, items };
    return items;
  }

  const syncPickers = useCallback(
    async (value: string, cursor: number) => {
      const before = value.slice(0, cursor);
      const atMatch = before.match(/@([^\s@]*)$/);
      if (atMatch) {
        if (Number(agentsamPolicyRef.current?.agent_autocomplete) === 0) {
          setMentionOpen(false);
          mentionQueryRef.current = null;
          return;
        }
        const q = atMatch[1];
        const start = cursor - atMatch[0].length;
        mentionQueryRef.current = { start, end: cursor };
        const all = await loadCatalog();
        const f = all.filter((it) => it.label.toLowerCase().includes(q.toLowerCase())).slice(0, 40);
        setMentionItems(f);
        setMentionIndex(0);
        setMentionOpen(f.length > 0);
        setSlashOpen(false);
        return;
      }
      setMentionOpen(false);
      mentionQueryRef.current = null;

      const slashMatch = before.match(/(?:^|\s)(\/[\w-]*)$/);
      if (slashMatch) {
        const full = slashMatch[1];
        const q = full.slice(1);
        const start = cursor - full.length;
        slashQueryRef.current = { start, end: cursor };
        const all = await loadCommands();
        const f = all
          .filter((c) => c.slug.toLowerCase().includes(q.toLowerCase()))
          .slice(0, 40);
        setSlashItems(f);
        setSlashIndex(0);
        setSlashOpen(f.length > 0);
        return;
      }
      setSlashOpen(false);
      slashQueryRef.current = null;
    },
    []
  );

  const applyMention = (item: PickerItem) => {
    const el = textareaRef.current;
    const q = mentionQueryRef.current;
    if (!el || !q) return;
    const v = input;
    const before = v.slice(0, q.start);
    const after = v.slice(q.end);
    const insert = `@${item.label} `;
    const next = before + insert + after;
    const pos = before.length + insert.length;
    setMentionOpen(false);
    mentionQueryRef.current = null;
    insertAtCursor(next, pos, pos);
  };

  const applySlash = (cmd: SlashCmd) => {
    const el = textareaRef.current;
    const q = slashQueryRef.current;
    if (!el || !q) return;
    const v = input;
    const before = v.slice(0, q.start);
    const after = v.slice(q.end);
    const insert = `/${cmd.slug} `;
    const next = before + insert + after;
    const pos = before.length + insert.length;
    setSlashOpen(false);
    slashQueryRef.current = null;
    insertAtCursor(next, pos, pos);

    void executeSlashCommand({
      cmd,
      conversationId,
      agentRunId,
      workspaceId,
      messages,
      setMessages,
      setMode,
      setPlanSuggestDismissed,
      onApprovalRequired,
    });
  };

  return {
    mentionOpen, setMentionOpen, mentionItems, mentionIndex, setMentionIndex, mentionStyle, mentionMenuRef,
    slashOpen, setSlashOpen, slashItems, slashIndex, setSlashIndex, slashStyle, slashMenuRef,
    syncPickers, applyMention, applySlash, insertAtCursor,
  };
}
