/**
 * Post-stream finalize: empty reply, fence truncate (never auto-open Monaco).
 */
import {
  collapseEmbeddedFileDumpsForChat,
  hideIncompleteMonacoInvokeTail,
} from '../../streamParsing';
import {
  isInternalAgentErrorText,
  synthesizeUserVisibleAgentFailure,
} from '../../../../shared/agent-runtime/user-visible-agent-error.js';
import { patchIamAgentStreamDebug } from '../../streamDebug';
import { truncateLines } from './sseHelpers';
import type { SseSession } from './sseTypes';

export function finalizeSseConsume(s: SseSession): void {
  if (typeof window !== 'undefined' && window.__IAM_AGENT_LAST_STREAM_DEBUG) {
    patchIamAgentStreamDebug({
      assistant_text_length: s.assistantContent.length,
    });
  }

  if (!s.assistantContent.trim() && !s.fileEchoSuppress) {
    if (s.doneReceived) {
      // Image / artifact turns are the reply — don't inject a false "no reply" line.
      s.ctx.setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === 'assistant') {
          const ig = last.imageGenerationState;
          if (
            ig &&
            (ig.phase === 'completed' ||
              ig.phase === 'failed' ||
              Boolean(ig.previewUrl || ig.imageUrl || ig.previewFrames?.length))
          ) {
            return prev;
          }
          if (last.previewArtifacts?.length || last.emailArtifact) return prev;
        }
        s.assistantContent =
          'Agent finished without a visible reply. Try Ask mode for quick questions, or send again.';
        if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: s.assistantContent };
        else next.push({ role: 'assistant', content: s.assistantContent });
        return next;
      });
    } else {
      s.ctx.setMessages((prev) => s.ctx.stripEmptyAssistantTail(prev));
    }
  } else if (s.assistantContent.trim() && isInternalAgentErrorText(s.assistantContent)) {
    // Model or preinvoke may echo tool_timeout strings as the only "reply".
    s.assistantContent = synthesizeUserVisibleAgentFailure(s.assistantContent);
    s.ctx.setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: s.assistantContent };
      return next;
    });
  }

  const fullStreamText = hideIncompleteMonacoInvokeTail(s.assistantStreamBuf);

  if (s.fileEchoSuppress) {
    // Persist full HTML as a fence (AgentCodeFencePreview collapses visually). Do not
    // truncate fence bodies here — Open in Monaco / Live preview need the full app.
    const preview = collapseEmbeddedFileDumpsForChat(fullStreamText);
    s.assistantContent =
      preview.trim() ||
      'Writing file… (full content opens in the editor or artifacts when the stream completes.)';
    s.ctx.setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: s.assistantContent };
      return next;
    });
  }

  // Mid-stream may have truncated fences; final non-suppress path still caps non-HTML fences.
  // For HTML, keep full body so the mini-workstation card can open Monaco/preview on click.
  const truncatedForChat = (() => {
    const collapsed = collapseEmbeddedFileDumpsForChat(s.assistantContent);
    const re = /```(\w+)?\n([\s\S]*?)\n```/g;
    return collapsed.replace(re, (_full, lang, body) => {
      const b = String(body || '');
      const langKey = String(lang || '').toLowerCase();
      if (langKey === 'html' || langKey === 'htm' || langKey === 'css' || langKey === 'svg') {
        return `\`\`\`${lang || ''}\n${b}\n\`\`\``;
      }
      const { head, truncated, total } = truncateLines(b, 200);
      if (!truncated) return `\`\`\`${lang || ''}\n${b}\n\`\`\``;
      return `\`\`\`${lang || ''}\n${head}\n\`\`\`\n_(truncated: showing first 200 of ${total} lines — open Monaco for full content)_`;
    });
  })();
  if (truncatedForChat !== s.assistantContent) {
    s.assistantContent = truncatedForChat;
    s.ctx.setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: s.assistantContent };
      return next;
    });
  }

  // Never auto-open Monaco from streamed code fences — operator opens via fence / scratchpad click.
}
