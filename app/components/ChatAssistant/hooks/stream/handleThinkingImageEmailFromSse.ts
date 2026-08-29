/**
 * Thinking / status / github_branch / image_generation_* / email_draft SSE.
 */
import { normalizeImageGenerationEvent } from '../../streamParsing';
import {
  agentFilesFromImageSse,
  appendAgentFilesToAssistantTail,
  patchAssistantImageGeneration,
} from './sseHelpersMedia';
import type { SseSession, SseDispatchResult } from './sseTypes';

export function handleThinkingImageEmailFromSse(
  s: SseSession,
  data: unknown,
  evType: string | undefined,
): SseDispatchResult {
if (evType === 'thinking_start') {
  s.ctx.onThinkingEvent?.({ type: 'thinking_start' });
  return 'continue';
}
if (evType === 'provider_transport' || evType === 'provider_response') {
  return 'continue';
}
if (evType === 'status' && data && typeof data === 'object') {
  const phase = String((data as { phase?: string }).phase || '').trim();
  if (phase === 'preflight') {
    s.ctx.onThinkingEvent?.({ type: 'thinking', text: 'Starting…' });
  } else if (phase === 'context') {
    // Honest status — "Gathering context" implied RAG theater before tools ran.
    s.ctx.onThinkingEvent?.({ type: 'thinking', text: 'Working…' });
  }
  return 'continue';
}
if (evType === 'github_branch_context' && data && typeof data === 'object') {
  const d = data as { repo?: string | null; branch?: string | null; source?: string };
  const branch = d.branch?.trim() || '';
  if (branch) {
    window.dispatchEvent(
      new CustomEvent('iam:github-branch-context', {
        detail: {
          repo: d.repo?.trim() || null,
          branch,
          source: d.source || 'agent',
        },
      }),
    );
  }
  return 'continue';
}
if (evType === 'thinking') {
  const d = data as { text?: string };
  s.ctx.onThinkingEvent?.({ type: 'thinking', text: d.text || '' });
  return 'continue';
}
if (
  evType === 'image_generation_started' ||
  evType === 'image_generation_progress' ||
  evType === 'image_generation_preview' ||
  evType === 'image_generation_complete'
) {
  const normalized = normalizeImageGenerationEvent(data);
  if (normalized) {
    const scratchpadFiles =
      evType === 'image_generation_preview' || evType === 'image_generation_complete'
        ? agentFilesFromImageSse(data)
        : [];
    patchAssistantImageGeneration(
      s.ctx.setMessages,
      s.assistantContent,
      normalized.patch,
      normalized.eventType,
      scratchpadFiles,
    );
  } else if (evType === 'image_generation_preview' || evType === 'image_generation_complete') {
    appendAgentFilesToAssistantTail(s.ctx.setMessages, agentFilesFromImageSse(data));
  }
  return 'continue';
}
if (evType === 'email_draft') {
  const d = data as { subject?: string; body?: string; to?: string; from?: string };
  s.ctx.setMessages((prev) => {
    const last = [...prev];
    const lastMsg = last[last.length - 1];
    if (lastMsg && lastMsg.role === 'assistant') {
      last[last.length - 1] = {
        ...lastMsg,
        emailArtifact: {
          subject: d.subject ?? '',
          body: d.body ?? '',
          to: d.to,
          from: d.from,
        },
      };
    }
    return last;
  });
  return 'continue';
}
  return 'fallthrough';
}
