/** Small helpers for App agent chat tabs (Wave 2 E4). */
import { buildAgentSamGreeting } from './appShellConstants';
import { formatWorkspaceStatusLine } from '../src/ideWorkspace';
import type { Message } from '../components/ChatAssistant/types';

export type AgentChatTabRow = { id: string; conversationId: string; title: string };

export function newAgentChatTabId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tab_${Date.now()}`;
}

export function freshAgentGreetingMessages(workspaceDisplayLine?: string): Message[] {
  return [
    {
      role: 'assistant',
      content: buildAgentSamGreeting(
        workspaceDisplayLine ?? formatWorkspaceStatusLine({ source: 'none' }),
      ),
    },
  ];
}
