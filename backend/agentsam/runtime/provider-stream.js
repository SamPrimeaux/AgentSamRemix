/**
 * Provider-agnostic stream helpers.
 *
 * Every chat adapter emits the same OpenAI-compatible SSE contract consumed by
 * the tool loop: choices[0].delta, optional usage, then [DONE].
 */
export function openAiSseResponse(body, extraHeaders = {}) {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      ...extraHeaders,
    },
  });
}

export function openAiSseFrame(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export function normalizeOllamaChunk(chunk) {
  if (chunk == null || typeof chunk !== 'object') return null;
  const message = chunk.message && typeof chunk.message === 'object' ? chunk.message : {};
  const delta = {};

  if (typeof message.content === 'string' && message.content) {
    delta.content = message.content;
  }
  if (typeof message.reasoning_content === 'string' && message.reasoning_content) {
    delta.reasoning_content = message.reasoning_content;
  }
  if (Array.isArray(message.tool_calls)) {
    delta.tool_calls = message.tool_calls.map((call, index) => ({
      index,
      id: call.id || `ollama_call_${index}`,
      type: 'function',
      function: {
        name: call.function?.name || call.name || 'unknown',
        arguments:
          typeof call.function?.arguments === 'string'
            ? call.function.arguments
            : JSON.stringify(call.function?.arguments ?? call.arguments ?? {}),
      },
    }));
  }

  const promptTokens = Number(chunk.prompt_eval_count ?? chunk.prompt_tokens ?? 0) || 0;
  const completionTokens = Number(chunk.eval_count ?? chunk.completion_tokens ?? 0) || 0;
  const usage =
    promptTokens || completionTokens
      ? {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: Number(chunk.total_tokens) || promptTokens + completionTokens,
        }
      : undefined;
  const finishReason = chunk.done ? (delta.tool_calls?.length ? 'tool_calls' : 'stop') : null;
  if (!Object.keys(delta).length && !usage && !chunk.done) return null;
  return {
    ...(usage ? { usage } : {}),
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

/**
 * Convert newline-delimited JSON or SSE-ish upstream data into OpenAI SSE.
 * Handles arbitrary chunk boundaries and flushes the final line.
 */
export function pipeJsonStreamToOpenAiSse(upstreamBody, normalizeChunk) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const source = upstreamBody.getReader();
  let buffer = '';
  let closed = false;

  return new ReadableStream({
    async pull(controller) {
      if (closed) return;
      try {
        while (true) {
          const newline = buffer.indexOf('\n');
          if (newline >= 0) {
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            const value = line.trim();
            if (!value || value === '[DONE]' || value === 'data: [DONE]') continue;
            const jsonText = value.startsWith('data:') ? value.slice(5).trim() : value;
            try {
              const normalized = normalizeChunk(JSON.parse(jsonText));
              if (normalized) {
                controller.enqueue(encoder.encode(openAiSseFrame(normalized)));
                return;
              }
            } catch {
              // Upstream protocol noise is ignored; a later valid frame wins.
            }
            continue;
          }

          const { done, value } = await source.read();
          if (done) {
            const tail = buffer.trim();
            buffer = '';
            if (tail && tail !== '[DONE]' && tail !== 'data: [DONE]') {
              try {
                const normalized = normalizeChunk(JSON.parse(tail.startsWith('data:') ? tail.slice(5).trim() : tail));
                if (normalized) {
                  controller.enqueue(encoder.encode(openAiSseFrame(normalized)));
                  return;
                }
              } catch {
                // Ignore malformed trailing data.
              }
            }
            closed = true;
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
        }
      } catch (error) {
        closed = true;
        controller.error(error);
      }
    },
    async cancel(reason) {
      closed = true;
      await source.cancel(reason).catch(() => {});
    },
  });
}
