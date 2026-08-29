import { appendChatMessage, markChatTurnStatus } from '../../sessions/chat-do-client.js';
import {
  extractBestAssistantPlainText,
  extractLastAssistantPlainText,
} from '../../../../src/core/agent-prompt-builder.js';
import {
  isAgentRuntimeDumpText,
  isInternalAgentErrorText,
  synthesizeUserVisibleAgentFailure,
} from '../../../../shared/agent-runtime/user-visible-agent-error.js';

export function createPersistChatTurnMessages({
  env,
  sessionId,
  userId,
  modelKey,
  messages,
  params,
  getConversationMessages,
  getTotalUsage,
  getChatTurnPersisted,
  setChatTurnPersisted,
}) {
  return async (opts = {}) => {
    if (getChatTurnPersisted() || !sessionId || !userId) return;
    setChatTurnPersisted(true);
    const turnId = params.chatTurnMeta?.turnId ?? null;
    const assistantMessageId = params.chatTurnMeta?.assistantMessageId ?? null;
    const userMsg = messages?.[0];
    const inferenceUserContent =
      typeof userMsg?.content === 'string'
        ? userMsg.content
        : Array.isArray(userMsg?.content)
          ? userMsg.content
              .filter((block) => block.type === 'text')
              .map((block) => block.text)
              .join('')
          : '';
    // Fallback persistence must obey the same law as beginChatTurn: hidden current-turn
    // context is inference-only. Prefer the explicitly separated durable operator text.
    const userContent =
      typeof params.persistedUserMessage === 'string'
        ? params.persistedUserMessage
        : inferenceUserContent;
    if (userContent && !params.chatTurnMeta?.turnId) {
      appendChatMessage(env, sessionId, {
        role: 'user',
        content: userContent,
        turn_id: turnId,
        model_key: modelKey ?? null,
        tokens_in: 0,
        tokens_out: 0,
      }).catch((error) =>
        console.warn('[tool-loop] appendChatMessage user', error?.message ?? error),
      );
    }

    const conversationMessages = getConversationMessages();
    const totalUsage = getTotalUsage();
    let assistantText =
      typeof opts.assistantText === 'string'
        ? opts.assistantText
        : extractBestAssistantPlainText(conversationMessages) ||
          extractLastAssistantPlainText(conversationMessages);
    if (assistantText && isAgentRuntimeDumpText(assistantText)) assistantText = '';
    if (assistantText && isInternalAgentErrorText(assistantText)) {
      assistantText = synthesizeUserVisibleAgentFailure(assistantText);
    }
    if (!assistantText && opts.errorText) {
      assistantText = synthesizeUserVisibleAgentFailure(opts.errorText).slice(0, 8000);
    }
    if (assistantText) {
      try {
        await appendChatMessage(env, sessionId, {
          id: assistantMessageId ?? undefined,
          turn_id: turnId,
          role: 'assistant',
          content: assistantText,
          status: opts.failed ? 'failed' : 'complete',
          error: opts.failed ? String(opts.errorText || 'turn_failed').slice(0, 500) : null,
          model_key: modelKey ?? null,
          tokens_in: totalUsage.input_tokens ?? 0,
          tokens_out: totalUsage.output_tokens ?? 0,
        });
        // Stream-close owns terminal completion when beginChatTurn reserved the assistant row.
        if (opts.failed || !assistantMessageId) {
          await markChatTurnStatus(
            env,
            sessionId,
            opts.failed ? 'failed' : 'completed',
            opts.failed ? opts.errorText : null,
            {
              assistantMessageId,
              output_tokens: totalUsage.output_tokens ?? 0,
              content: assistantText,
            },
          );
        }
      } catch (error) {
        console.warn('[tool-loop] appendChatMessage assistant', error?.message ?? error);
      }
    } else if (opts.failed) {
      await markChatTurnStatus(env, sessionId, 'failed', opts.errorText || 'turn_failed', {
        assistantMessageId,
      }).catch(() => {});
    }
  };
}
