import {
  IAM_AGENT_CHAT_CONVERSATION_CHANGE,
  IAM_AGENT_CHAT_SESSIONS_REFRESH,
  IAM_AGENT_SYNC_CONVERSATION_URL,
  LS_AGENT_CHAT_CONVERSATION_ID,
} from '../agentChatConstants';
import { AGENT_HOME_PATH, AGENT_NEW_CHAT_PATH, agentConversationPath, isAgentConversationPath } from './agentRoutes';
import { stashProjectChatFiles } from './projectChatHandoff';

export type OpenAgentConversationDetail = {
  id: string;
  /** Re-fetch thread messages even when the tab already holds this conversation id. */
  force?: boolean;
  title?: string;
  /** When true (default), App opens the agent column if it was collapsed. */
  ensureAgentPanel?: boolean;
};

export const IAM_AGENT_ENSURE_PANEL = 'iam-agent-ensure-panel';

/** App listens — collapse Agent Sam side rail (CMS editor maximize canvas). */
export const IAM_AGENT_COLLAPSE_PANEL = 'iam-agent-collapse-panel';

/** App broadcasts when agent column opens/closes (detail.open boolean). */
export const IAM_AGENT_PANEL_CHANGED = 'iam-agent-panel-changed';

/** App listens — navigate to Agent full-screen thread (SSOT entry). */
export const IAM_AGENT_OPEN_THREAD = 'iam-agent-open-thread';

export type OpenAgentThreadDetail = {
  conversationId?: string;
  projectId?: string;
  projectName?: string;
  title?: string;
  firstMessage?: string;
  files?: File[];
  force?: boolean;
};

/** App listens — navigate to Agent + open panel, then load the thread. @deprecated Prefer {@link openAgentThreadFullScreen} */
export const IAM_AGENT_RESUME_CHAT = 'iam-agent-resume-chat';

/** Sidebar + session list hooks listen for this to reload /api/agent/sessions. */
export function notifyAgentChatSessionsRefresh(conversationId?: string | null): void {
  if (typeof window === 'undefined') return;
  const id = conversationId != null ? String(conversationId).trim() : '';
  // Dedicated refresh event — never CONVERSATION_CHANGE (empty detail aborted live streams).
  window.dispatchEvent(
    new CustomEvent(IAM_AGENT_CHAT_SESSIONS_REFRESH, {
      detail: id ? { id } : {},
    }),
  );
}

/** Write thread id to localStorage — synchronous, safe before navigation. */
export function persistAgentConversationId(id: string): void {
  const trimmed = id.trim();
  if (!trimmed) return;
  try {
    localStorage.setItem(LS_AGENT_CHAT_CONVERSATION_ID, trimmed);
  } catch {
    /* ignore */
  }
}

/**
 * Select an Agent Sam thread: persist id, ensure panel visible, notify App + ChatAssistant.
 * Does not change dashboard route — resume happens in the mounted agent column.
 */
export function openAgentConversation(detail: OpenAgentConversationDetail): void {
  const id = detail.id?.trim();
  if (!id) return;
  persistAgentConversationId(id);
  if (detail.ensureAgentPanel !== false) {
    window.dispatchEvent(new CustomEvent(IAM_AGENT_ENSURE_PANEL));
  }
  window.dispatchEvent(
    new CustomEvent(IAM_AGENT_CHAT_CONVERSATION_CHANGE, {
      detail: { id, force: detail.force !== false, title: detail.title?.trim() || undefined },
    }),
  );
}

/** Fresh thread: new tab + greeting, navigate to /dashboard/agent/new when needed. */
export const IAM_AGENT_START_NEW_CHAT = 'iam-agent-start-new-chat';

export type StartNewAgentChatDetail = {
  /** When true, open a fresh tab on the current page (e.g. Home hero CTA) without routing away. */
  stayOnPage?: boolean;
};

/** Project detail composer → Agent Sam with session project + optional first message. */
export const IAM_AGENT_START_PROJECT_CHAT = 'iam-agent-start-project-chat';

export type StartProjectAgentChatDetail = {
  projectId: string;
  projectName: string;
  message?: string;
  /** Optional file attachments from project composer. */
  files?: File[];
  /** When true, open Agent Sam panel on the current page instead of navigating away. @deprecated Always full-screen from project. */
  stayOnPage?: boolean;
};

export function buildProjectChatFirstMessage(
  raw: string,
  memory?: string,
  instructions?: string,
): string {
  // Memory/instructions are loaded server-side from project_id (system context).
  // Never concatenate into the user-visible chat bubble.
  void memory;
  void instructions;
  return String(raw || '').trim();
}

export function startProjectAgentChat(detail: StartProjectAgentChatDetail): void {
  openAgentThreadFullScreen({
    projectId: detail.projectId,
    projectName: detail.projectName,
    firstMessage: detail.message,
    memory: detail.memory,
    instructions: detail.instructions,
    files: detail.files,
  });
}

export function startNewAgentChat(detail?: StartNewAgentChatDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(IAM_AGENT_START_NEW_CHAT, { detail: detail ?? {} }));
}

/** Open Agent Sam full-screen — new thread or resume existing (project pages, chats list, deep links). */
export function openAgentThreadFullScreen(detail: OpenAgentThreadDetail): void {
  if (typeof window === 'undefined') return;
  const projectId = String(detail.projectId || '').trim();
  const conversationId = String(detail.conversationId || '').trim();
  if (!projectId && !conversationId && !String(detail.firstMessage || '').trim()) return;

  if (detail.files?.length) stashProjectChatFiles(detail.files);

  window.dispatchEvent(
    new CustomEvent(IAM_AGENT_OPEN_THREAD, {
      detail: {
        ...detail,
        projectId: projectId || undefined,
        projectName: String(detail.projectName || '').trim() || undefined,
        conversationId: conversationId || undefined,
        title: detail.title?.trim() || undefined,
        firstMessage: String(detail.firstMessage || '').trim() || undefined,
        memory: detail.memory,
        instructions: detail.instructions,
        force: detail.force !== false,
      },
    }),
  );
}

/** Sidebar / Chats list / project linked chat — full-screen Agent Sam with history. */
export function resumeAgentChatSession(
  detail: OpenAgentConversationDetail & { projectId?: string; projectName?: string },
): void {
  openAgentThreadFullScreen({
    conversationId: detail.id,
    title: detail.title,
    force: detail.force,
    projectId: detail.projectId,
    projectName: detail.projectName,
  });
}
