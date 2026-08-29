import {
  compactConsumedToolResultsInPlace,
  compactGeminiReplayPartsInPlace,
} from '../tool-result-compaction.js';
import { consumeReadableWithAbort } from '../../run-cancel.js';

export function compactConsumedContext(conversationMessages, opts = {}) {
  const tool = compactConsumedToolResultsInPlace(conversationMessages, opts);
  const gemini = compactGeminiReplayPartsInPlace(conversationMessages);
  return {
    compactedBlocks: tool.compactedBlocks + gemini.droppedThoughts,
    removedChars: tool.removedChars + gemini.removedChars,
  };
}

/** Working-copy only — never persist trimmed tool payloads back to DO. */
export function compactConversationForNextModelPass(conversationMessages) {
  return compactConsumedContext(conversationMessages, { protectLatestBatch: true });
}

export function compactGeminiReplay(conversationMessages) {
  return compactGeminiReplayPartsInPlace(conversationMessages);
}

export async function consumeSseText(readable, {
  assistantContent,
  emit,
  abortScope,
  usage,
}) {
  usage.reset();
  const decoder = new TextDecoder();
  let buf = '';
  await consumeReadableWithAbort(readable, (value) => {
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() || '';
    for (const part of parts) {
      const lines = part.split('\n').map((line) => line.trim()).filter(Boolean);
      const dataLines = lines
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim());
      if (!dataLines.length) continue;
      const payload = dataLines.join('\n');
      if (payload === '[DONE]') {
        usage.flush();
        return false;
      }
      try {
        const json = JSON.parse(payload);
        usage.note(json);
        const raw =
          json?.choices?.[0]?.delta?.content ??
          json?.choices?.[0]?.text ??
          json?.response ??
          json?.text ??
          '';
        const text = Array.isArray(raw)
          ? raw
              .map((partValue) =>
                typeof partValue === 'string'
                  ? partValue
                  : partValue?.text != null
                    ? String(partValue.text)
                    : '',
              )
              .join('')
          : typeof raw === 'string'
            ? raw
            : raw && typeof raw === 'object' && raw.text != null
              ? String(raw.text)
              : '';
        if (text) {
          const last = assistantContent.findLast((block) => block.type === 'text');
          if (last) last.text += text;
          emit('text', { text });
        }
      } catch {
        // Ignore non-JSON SSE frames.
      }
    }
    return true;
  }, {
    throwIfAborted: () => abortScope.throwIfAborted(),
    signal: abortScope.signal,
  });
  usage.flush();
}

export function readOpenAiTransportMeta(stream, {
  emit,
  turnCount,
  chatAgentRunId,
}) {
  const transport = String(stream.headers.get('X-IAM-OpenAI-Transport') || '').trim();
  if (!transport) return null;
  const meta = {
    transport,
    fallback_reason: stream.headers.get('X-IAM-OpenAI-Fallback-Reason') || null,
    full_input: stream.headers.get('X-IAM-OpenAI-Full-Input') === '1',
    turn: turnCount,
    agent_run_id: chatAgentRunId != null ? String(chatAgentRunId) : null,
  };
  console.info('[agent] openai_transport', JSON.stringify(meta));
  emit('provider_transport', meta);
  return meta;
}

export async function assertSuccessfulResponse(stream, { emit, routeArmOutcome }) {
  if (stream.ok) return;
  const detailRaw = await stream.text().catch(() => '');
  let detailMsg = String(detailRaw || '').slice(0, 8000);
  try {
    const json = JSON.parse(detailRaw);
    const message =
      json?.error?.message ??
      (typeof json?.error === 'string' ? json.error : null) ??
      json?.message ??
      json?.detail;
    if (message) detailMsg = String(message).slice(0, 8000);
  } catch {
    // Keep detailRaw slice.
  }
  console.warn('[agent] model stream HTTP error', stream.status, detailMsg.slice(0, 500));
  const { failureCategoryFromProviderHttpStatus } =
    await import('../../../../../src/core/reward-failure-category.js');
  routeArmOutcome(false, {
    failure_category: failureCategoryFromProviderHttpStatus(stream.status),
  });
  emit('error', {
    message: detailMsg || 'Model stream failed',
    status: stream.status,
    detail: detailRaw.slice(0, 8000),
  });
  const hard = new Error('__IAM_PROVIDER_HTTP__');
  hard.code = 'IAM_PROVIDER_HTTP';
  hard.status = stream.status;
  hard.detail = detailRaw.slice(0, 8000);
  throw hard;
}
