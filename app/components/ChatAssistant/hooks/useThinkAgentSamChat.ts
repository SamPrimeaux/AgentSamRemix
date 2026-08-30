import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAgent } from 'agents/react';
import { useAgentChat } from '@cloudflare/think/react';
import type { FileUIPart, UIMessage } from 'ai';

import {
  IAM_AGENT_CHAT_CONVERSATION_CHANGE,
  LS_AGENT_CHAT_CONVERSATION_ID,
} from '../../../agentChatConstants';
import { IAM_AGENT_ABORT_LIVE_STREAM } from '../../../lib/cancelAgentChatRun';
import { deriveAgentChatTitleFromMessage } from '../../../agentSessionsCatalog';
import { notifyAgentChatSessionsRefresh } from '../../../lib/openAgentConversation';
import { replaceAgentConversationUrl } from '../../../lib/agentRoutes';
import type { Message } from '../types';

type PendingSend = {
  text: string;
  files: File[];
};

type UseThinkAgentSamChatArgs = {
  conversationId: string;
  setConversationId: React.Dispatch<React.SetStateAction<string>>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
};

const INLINE_FILE_LIMIT_BYTES = 15 * 1024 * 1024;

function messageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is Extract<UIMessage['parts'][number], { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

function toLegacyMessages(rows: UIMessage[]): Message[] {
  return rows
    .filter((row) => row.role === 'user' || row.role === 'assistant')
    .map((row) => {
      const attachmentPreviews = row.parts
        .filter((part): part is Extract<UIMessage['parts'][number], { type: 'file' }> => part.type === 'file')
        .map((part) => ({
          previewUrl: part.url || null,
          type: part.mediaType?.startsWith('image/') ? ('image' as const) : ('file' as const),
          name: part.filename || 'attachment',
        }));
      return {
        role: row.role as 'user' | 'assistant',
        content: messageText(row),
        ...(attachmentPreviews.length ? { attachmentPreviews } : {}),
      };
    });
}

function fileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('attachment_read_failed'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

async function filesAsUiParts(files: File[]): Promise<FileUIPart[]> {
  if (!files.length) return [];
  const total = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
  if (total > INLINE_FILE_LIMIT_BYTES) {
    throw new Error('Think attachments are limited to 15 MB total during the chat cutover.');
  }
  return Promise.all(
    files.map(async (file) => ({
      type: 'file' as const,
      mediaType: file.type || 'application/octet-stream',
      filename: file.name,
      url: await fileAsDataUrl(file),
    })),
  );
}

/**
 * Durable Think transport for the existing Agent Sam UI.
 *
 * D1 agentsam_chat_sessions is the user-owned conversation catalog. Think's
 * Durable Object SQLite is the authoritative live transcript. New-chat stays
 * completely unallocated until the first real user send.
 */
export function useThinkAgentSamChat({
  conversationId,
  setConversationId,
  setMessages,
}: UseThinkAgentSamChatArgs) {
  const pendingSendsRef = useRef<PendingSend[]>([]);
  const flushingRef = useRef(false);

  const query = useMemo(
    () => (conversationId ? { conversation_id: conversationId } : {}),
    [conversationId],
  );

  const onIdentity = useCallback(
    (name: string) => {
      const id = String(name || '').trim();
      if (!id) return;
      setConversationId((current) => (current === id ? current : id));
      try {
        localStorage.setItem(LS_AGENT_CHAT_CONVERSATION_ID, id);
      } catch {
        /* storage is optional */
      }
      replaceAgentConversationUrl(id);
      notifyAgentChatSessionsRefresh(id);
    },
    [setConversationId],
  );

  const agent = useAgent({
    agent: 'AgentSam',
    basePath: 'api/agent/think',
    query,
    queryDeps: [conversationId],
    startClosed: !conversationId,
    onIdentity,
  });

  const chat = useAgentChat({
    agent,
    credentials: 'same-origin',
    resume: true,
    cancelOnClientAbort: false,
  });

  useEffect(() => {
    setMessages(toLegacyMessages(chat.messages));
  }, [chat.messages, setMessages]);

  const persistConversationSelection = useCallback(
    (id: string) => {
      setConversationId(id);
      try {
        localStorage.setItem(LS_AGENT_CHAT_CONVERSATION_ID, id);
      } catch {
        /* storage is optional */
      }
      replaceAgentConversationUrl(id);
      window.dispatchEvent(
        new CustomEvent(IAM_AGENT_CHAT_CONVERSATION_CHANGE, {
          detail: { id, force: false },
        }),
      );
      notifyAgentChatSessionsRefresh(id);
    },
    [setConversationId],
  );

  const ensureConversation = useCallback(
    async (firstText: string): Promise<string> => {
      const existing = String(conversationId || '').trim();
      if (existing) return existing;
      const response = await fetch('/api/agent/sessions', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: deriveAgentChatTitleFromMessage(firstText) }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(detail || `conversation_create_failed_${response.status}`);
      }
      const payload = (await response.json()) as { id?: string };
      const id = String(payload?.id || '').trim();
      if (!id) throw new Error('conversation_create_missing_id');
      persistConversationSelection(id);
      return id;
    },
    [conversationId, persistConversationSelection],
  );

  const flushPending = useCallback(async () => {
    if (flushingRef.current) return;
    if (!agent.identified || agent.name !== conversationId || !conversationId) return;
    if (!pendingSendsRef.current.length) return;
    flushingRef.current = true;
    try {
      while (pendingSendsRef.current.length) {
        const next = pendingSendsRef.current[0];
        const fileParts = await filesAsUiParts(next.files);
        await chat.sendMessage(
          fileParts.length ? { text: next.text, files: fileParts } : { text: next.text },
        );
        pendingSendsRef.current.shift();
      }
    } finally {
      flushingRef.current = false;
    }
  }, [agent.identified, agent.name, chat, conversationId]);

  useEffect(() => {
    void flushPending();
  }, [flushPending]);

  const send = useCallback(
    async (text: string, files: File[] = []) => {
      const clean = String(text || '').trim();
      if (!clean && !files.length) return;
      const id = await ensureConversation(clean || '(attachment)');
      pendingSendsRef.current.push({ text: clean || '(attachment)', files });

      // Existing connected thread can flush synchronously. A just-created thread
      // rerenders useAgent with startClosed=false; the effect flushes after identity.
      if (agent.identified && agent.name === id) {
        await flushPending();
      }
    },
    [agent.identified, agent.name, ensureConversation, flushPending],
  );

  return {
    agent,
    chat,
    send,
    stop: chat.stop,
    isBusy: chat.isStreaming || chat.isRecovering,
    isRecovering: chat.isRecovering,
    connectionError: chat.connectionError || agent.connectionError || null,
  };
}
