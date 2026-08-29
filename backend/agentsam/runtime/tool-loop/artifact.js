/**
 * Post-loop finalize: optional chat-artifact schedule from assistant text.
 * No intent heuristics — if fenced output looks like an artifact, schedule it.
 */

import {
  extractBestAssistantPlainText,
  inferArtifactFromAssistantText,
  scheduleAgentsamArtifactFromChatOutput,
} from '../../../../src/core/agent-prompt-builder.js';

export function maybeScheduleChatArtifact({
  env,
  ctx,
  conversationMessages,
  userId,
  tenantId,
  workspaceId,
  chatAgentRunId,
  sessionId,
}) {
  const assistantText = extractBestAssistantPlainText(conversationMessages);
  if (!assistantText || !inferArtifactFromAssistantText(assistantText)) return;
  scheduleAgentsamArtifactFromChatOutput(env, ctx, {
    outputText: assistantText,
    userId,
    tenantId,
    workspaceId,
    sourceAgentRunId: chatAgentRunId,
    sourceSessionId: sessionId,
  });
}
