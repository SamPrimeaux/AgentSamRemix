import { useEffect, useRef, useState } from 'react';
import { openAgentThreadFullScreen } from '../../../lib/openAgentConversation';
import { useComposerConnectorSheet } from '../../../hooks/useComposerConnectorSheet';
import type { Project } from '../ProjectDetailPage';

/**
 * B3 peel — mechanical move only, no behavior change.
 * Extracted from ProjectDetailPage.tsx (composer → Agent Sam panel region).
 * Owns composer draft/attachment state and the send-to-Agent-Sam bridge for
 * the project-scoped chat composer. Page-level context (project, memory,
 * instructions, loadChats) is passed in rather than re-derived here.
 */
export interface UseProjectComposerBridgeParams {
  workspaceId: string | null | undefined;
  sessionUserId: string | null | undefined;
  project: Project | null;
  projectChatId: string;
  loadChats: () => Promise<void> | void;
}

export function useProjectComposerBridge({
  workspaceId,
  sessionUserId,
  project,
  projectChatId,
  loadChats,
}: UseProjectComposerBridgeParams) {
  const [draft, setDraft] = useState('');
  const [composerAttachments, setComposerAttachments] = useState<File[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerAttachRef = useRef<HTMLInputElement>(null);

  const {
    composerRef,
    attachButtonRef,
    composerSources,
    attachMenuOpen,
    toggleAttachMenu,
    removeComposerSource,
    renderAttachMenuPortal,
  } = useComposerConnectorSheet({
    workspaceId,
    sessionUserId,
    onAttachFiles: () => composerAttachRef.current?.click(),
    onCreateImage: () => {
      setDraft((prev) => (prev.trim() ? prev : 'Generate an image of '));
      textareaRef.current?.focus();
    },
    onWebSearch: () => {
      setDraft((prev) => (prev.trim() ? prev : 'Search the web for: '));
      textareaRef.current?.focus();
    },
    onDeepResearch: () => {
      setDraft((prev) => (prev.trim() ? prev : 'Research in depth: '));
      textareaRef.current?.focus();
    },
  });

  // auto-grow textarea (moved with draft/textareaRef from host)
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft]);

  const sendProjectChat = () => {
    if (!project) return;
    const message = draft.trim();
    const hasFiles = composerAttachments.length > 0;
    if (!message && !hasFiles) return;

    const userVisible =
      message ||
      (hasFiles
        ? `Review ${composerAttachments.length} attached file${composerAttachments.length === 1 ? '' : 's'}.`
        : '');

    openAgentThreadFullScreen({
      projectId: projectChatId,
      projectName: project.name,
      firstMessage: userVisible,
      files: composerAttachments,
    });
    setDraft('');
    setComposerAttachments([]);
    window.setTimeout(() => void loadChats(), 1500);
  };

  const onComposerFiles = (files: FileList | File[] | null) => {
    if (!files) return;
    const next = Array.from(files);
    if (!next.length) return;
    setComposerAttachments((prev) => [...prev, ...next].slice(0, 12));
  };

  return {
    draft,
    setDraft,
    composerAttachments,
    setComposerAttachments,
    textareaRef,
    composerAttachRef,
    composerRef,
    attachButtonRef,
    composerSources,
    attachMenuOpen,
    toggleAttachMenu,
    removeComposerSource,
    renderAttachMenuPortal,
    sendProjectChat,
    onComposerFiles,
  };
}
