/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Slash-command execute side effects (peel from useChatComposerPickers).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Dispatch, SetStateAction } from 'react';
import type { Message, SlashCmd } from '../types';

export type ExecuteSlashCommandArgs = {
  cmd: SlashCmd;
  conversationId: string;
  agentRunId?: string | null;
  workspaceId?: string | null;
  messages: Message[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setMode: Dispatch<SetStateAction<any>>;
  setPlanSuggestDismissed: Dispatch<SetStateAction<boolean>>;
  onApprovalRequired?: (id: string) => void;
};

export async function executeSlashCommand(args: ExecuteSlashCommandArgs): Promise<void> {
  const {
    cmd, conversationId, agentRunId, workspaceId, messages,
    setMessages, setMode, setPlanSuggestDismissed, onApprovalRequired,
  } = args;
  try {
    const res = await fetch('/api/agent/commands/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        slug: cmd.slug,
        command_slug: cmd.slug,
        command_id: cmd.id,
        session_id: conversationId || undefined,
        conversation_id: conversationId || undefined,
        agent_run_id: agentRunId?.trim() || undefined,
        workspace_id: workspaceId?.trim() || undefined,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 202 && (data.approval_id || data.command_run_id)) {
      onApprovalRequired?.(data.command_run_id || data.approval_id);
    }
    let dispatchPayload: Record<string, unknown> | null = null;
    if (typeof data?.output_text === 'string') {
      try {
        dispatchPayload = JSON.parse(data.output_text) as Record<string, unknown>;
      } catch {
        dispatchPayload = null;
      }
    } else if (data && typeof data === 'object') {
      dispatchPayload = data as Record<string, unknown>;
    }
    const threadMsg =
      typeof dispatchPayload?.user_message === 'string'
        ? dispatchPayload.user_message
        : null;
    if (dispatchPayload?.plan_mode === true || dispatchPayload?.force_plan_mode === true) {
      setMode('plan');
      setPlanSuggestDismissed(true);
    }
    if (threadMsg) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: threadMsg, id: `slash-${Date.now()}` },
      ]);
    }
    if (!res.ok && data?.error) {
      console.warn('[slash-command]', data.error);
    }
  } catch (e) {
    console.warn('[slash-command] execute failed', e);
  }

}
