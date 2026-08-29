/**
 * Assistant text delta accumulation from SSE payloads.
 */
import {
  extractMonacoInvokesFromBuffer,
  hideIncompleteMonacoInvokeTail,
  looksLikeEmbeddedFileDumpStart,
  normalizeAssistantSseText,
  ssePayloadLooksReasoningOnly,
} from '../../streamParsing';
import { isAgentRuntimeDumpText } from '../../../../shared/agent-runtime/user-visible-agent-error.js';
import { patchIamAgentStreamDebug } from '../../streamDebug';
import { prepareAssistantChatText } from './sseHelpers';
import {
  imageGenerationDisplayUrls,
  stripRedundantImageRefs,
} from './sseHelpersMedia';
import type { SseSession, SseDispatchResult } from './sseTypes';

export function handleTextDeltaFromSse(s: SseSession, data: unknown): SseDispatchResult {
const delta = normalizeAssistantSseText(data);
if (delta && isAgentRuntimeDumpText(delta)) {
  return 'continue';
}
if (!delta && ssePayloadLooksReasoningOnly(data)) {
  if (!s.fileEchoSuppress) {
    s.emptyRun += 1;
    if (s.emptyRun >= s.MAX_EMPTY_RUN) {
      s.stopStreamForSafety('max_empty_run');
      return 'break_loop';
    }
  }
} else if (delta) {
  s.emptyRun = 0;
  if (typeof window !== 'undefined') {
    const dbg = window.__IAM_AGENT_LAST_STREAM_DEBUG;
    if (dbg && dbg.first_text_at == null) {
      patchIamAgentStreamDebug({ first_text_at: Date.now() });
    }
  }
}
const sseText = normalizeAssistantSseText(data);
const trialBuf = s.assistantStreamBuf + sseText;
const extracted = extractMonacoInvokesFromBuffer(trialBuf);
const nextBuf = extracted.text;
const nextVisible = hideIncompleteMonacoInvokeTail(nextBuf);

if (!s.fileEchoSuppress && looksLikeEmbeddedFileDumpStart(nextVisible)) {
  s.fileEchoSuppress = true;
  if (typeof window !== 'undefined') {
    patchIamAgentStreamDebug({ artifact_echo_suppress: true, artifact_echo_at: Date.now() });
  }
}

// Always accumulate — artifact/HTML must reach code-block + monaco invoke handlers even when chat echo is suppressed.
s.assistantStreamBuf = nextBuf;

for (const f of extracted.files) {
  try {
    if (/\.py$/i.test(f.name)) {
      s.ctx.onPythonDraftOpened?.(f.name);
    }
    // Do not auto-open Monaco — operator expands via fence / scratchpad click.
    // Still stage agentFiles on the assistant bubble when present elsewhere.
  } catch (e) {
    console.warn('[ChatAssistant] monaco invoke handle failed', e);
  }
}

if (!s.fileEchoSuppress) {
  s.assistantContent = prepareAssistantChatText(nextVisible, 200);
  s.ctx.setMessages((prev) => {
    const last = [...prev];
    const idx = last.length - 1;
    if (idx < 0) return prev;
    const prevMsg = last[idx];
    // Never replace the whole bubble — text deltas used to wipe imageGenerationState
    // (and the live card) after image_generation_* SSE had already succeeded.
    if (prevMsg?.role === 'assistant') {
      const ig = prevMsg.imageGenerationState;
      const content =
        ig &&
        (ig.phase === 'completed' ||
          ig.phase === 'generating' ||
          ig.phase === 'refining' ||
          ig.phase === 'initializing' ||
          Boolean(ig.imageUrl || ig.previewUrl || ig.previewFrames?.length))
          ? stripRedundantImageRefs(s.assistantContent, imageGenerationDisplayUrls(ig))
          : s.assistantContent;
      last[idx] = { ...prevMsg, role: 'assistant', content };
      return last;
    }
    last[idx] = { role: 'assistant', content: s.assistantContent };
    return last;
  });
}
  return 'fallthrough';
}
