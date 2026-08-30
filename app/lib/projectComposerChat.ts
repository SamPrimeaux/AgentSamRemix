/**
 * Project composer → Agent Sam direct POST (inline thread variant).
 *
 * **Canonical path (P0):** {@link openAgentThreadFullScreen} in `openAgentConversation.ts`
 * → full-screen ChatAssistant → `/api/agent/chat` with the same FormData shape below.
 *
 * `loadProjectThreadMessages` remains useful for inline/hydration helpers.
 */
import type { Dispatch, SetStateAction } from 'react';
import { consumeAgentChatSseBody } from '../components/ChatAssistant/hooks/useAgentChatStream';
import type { ChatComposerSource } from '../components/ChatAssistant/composer/types';
import { WEB_SEARCH_SOURCE_ID } from '../components/ChatAssistant/composer/types';
import { notifyAgentChatSessionsRefresh } from './openAgentConversation';
import {
  flattenSessionEnabledTools,
  readSessionEnabledConnectors,
} from '../src/lib/freshChatSession';
import { mapAgentSessionMessages } from './mapAgentSessionMessages';
import { CHAT_RUNTIME_LANE_FULL_COMPILE } from './chatProjectContext';

export type ProjectThreadMessage = { role: 'user' | 'assistant'; content: string; id?: string };

export type SendProjectChatOpts = {
  projectId: string;
  workspaceId?: string | null;
  conversationId?: string | null;
  message: string;
  files?: File[];
  memory?: string;
  instructions?: string;
  composerSources?: ChatComposerSource[];
  signal?: AbortSignal;
  onConversationId?: (id: string) => void;
  setMessages: Dispatch<SetStateAction<ProjectThreadMessage[]>>;
  setStreaming: (v: boolean) => void;
};

function buildProjectMessage(raw: string, memory: string, instructions: string, isNewThread: boolean): string {
  // project_id is scope only. Saved memory/instructions are never hidden-concatenated
  // by the project composer; explicit context selection is a separate turn input.
  void memory;
  void instructions;
  void isNewThread;
  return raw.trim();
}

/** Send from project detail composer — stays on page; links session to project_id. */
export async function sendProjectComposerChat(opts: SendProjectChatOpts): Promise<string> {
  const projectId = String(opts.projectId || '').trim();
  const userMessage = String(opts.message || '').trim();
  if (!projectId || !userMessage) throw new Error('message_required');

  const isNewThread = !String(opts.conversationId || '').trim();
  const conversationId =
    String(opts.conversationId || '').trim() ||
    (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `proj_chat_${Date.now()}`);

  opts.onConversationId?.(conversationId);
  notifyAgentChatSessionsRefresh(conversationId);

  const messageForApi = buildProjectMessage(
    userMessage,
    opts.memory || '',
    opts.instructions || '',
    isNewThread,
  );

  opts.setMessages((prev) => [
    ...prev,
    { role: 'user', content: userMessage, id: `u_${Date.now()}` },
    { role: 'assistant', content: '', id: `a_${Date.now()}` },
  ]);
  opts.setStreaming(true);

  const form = new FormData();
  form.append('message', messageForApi);
  form.append('conversationId', conversationId);
  form.append('project_id', projectId);
  form.append('project_scope_explicit', '1');
  form.append('project_context_source', 'project_composer');
  form.append('runtime_lane', CHAT_RUNTIME_LANE_FULL_COMPILE);
  form.append('mode', 'agent');
  // Canonical wire field only — server still accepts legacy aliases for one release.
  if (opts.workspaceId?.trim()) {
    form.append('workspace_id', opts.workspaceId.trim());
  }
  for (const file of opts.files || []) {
    if (file.type.startsWith('image/')) {
      form.append('images', file, file.name || 'image.png');
      form.append('files', file, file.name || 'image.png');
    } else {
      form.append('files', file, file.name || 'attachment');
    }
  }

  const composerSources = opts.composerSources || [];
  const workspaceContextPacket = {
    composer_sources: composerSources.map((s) => ({
      id: s.id,
      label: s.label,
      kind: s.kind,
      provider_key: s.providerKey ?? null,
    })),
    web_search_enabled: composerSources.some((s) => s.id === WEB_SEARCH_SOURCE_ID),
    enabled_connectors: readSessionEnabledConnectors(),
    enabled_tools: flattenSessionEnabledTools(),
  };
  form.append('workspaceContext', JSON.stringify(workspaceContextPacket));

  const headers: Record<string, string> = {};
  if (opts.workspaceId?.trim()) headers['x-iam-workspace-id'] = opts.workspaceId.trim();

  const response = await fetch('/api/agent/chat', {
    method: 'POST',
    body: form,
    credentials: 'same-origin',
    signal: opts.signal,
    headers,
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    opts.setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === 'assistant') {
        next[next.length - 1] = {
          ...last,
          content: errBody || `Chat failed (${response.status})`,
        };
      }
      return next;
    });
    opts.setStreaming(false);
    throw new Error(errBody || `Chat failed (${response.status})`);
  }

  if (!response.body) {
    opts.setStreaming(false);
    throw new Error('Empty response body');
  }

  const streamFinalizedRef = { current: false };
  const streamReaderRef = { current: null as ReadableStreamDefaultReader<Uint8Array> | null };
  const reader = response.body.getReader();
  streamReaderRef.current = reader;

  try {
    await consumeAgentChatSseBody({
      signal: opts.signal,
      reader,
      streamFinalizedRef,
      streamReaderRef,
      setMessages: opts.setMessages as Dispatch<
        SetStateAction<{ role: 'user' | 'assistant'; content: string; id?: string }[]>
      >,
      setIsLoading: opts.setStreaming,
      setWorkflowLedger: () => {},
      setToolTraceRows: () => {},
      setConversationId: () => {},
      stripEmptyAssistantTail: (prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === 'assistant' && last.content === '') next.pop();
        return next;
      },
      loadSessions: async () => {
        notifyAgentChatSessionsRefresh(conversationId);
      },
    });
  } finally {
    opts.setStreaming(false);
    streamReaderRef.current = null;
  }

  return conversationId;
}

export async function loadProjectThreadMessages(conversationId: string): Promise<ProjectThreadMessage[]> {
  const id = String(conversationId || '').trim();
  if (!id) return [];
  const r = await fetch(`/api/agent/sessions/${encodeURIComponent(id)}/messages`, {
    credentials: 'same-origin',
  });
  if (!r.ok) return [];
  const rows = await r.json().catch(() => []);
  return mapAgentSessionMessages(rows) as ProjectThreadMessage[];
}
