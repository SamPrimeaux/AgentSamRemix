/**
 * OpenAI Chat Completions output caps — GPT-5.x / o-series / codex reject `max_tokens`.
 * Responses API (`/v1/responses`) uses `max_output_tokens` for all models (see gate.js).
 */

function normModel(modelId) {
  return String(modelId || '').trim().toLowerCase();
}

/** True when POST /v1/chat/completions must use max_completion_tokens. */
export function openAiChatCompletionsUsesMaxCompletionTokens(modelId) {
  const m = normModel(modelId);
  if (!m) return false;
  if (m.includes('codex')) return true;
  if (/^o[1349](-|$|\/)/.test(m)) return true;
  if (m.includes('gpt-5')) return true;
  if (/\bgpt-.*\b5\.[0-9]/.test(m)) return true;
  return false;
}

/**
 * Merge output token cap into a chat/completions JSON body.
 * @param {Record<string, unknown>} body
 * @param {string} modelId — catalog provider_model_id or model_key
 * @param {number} limit
 */
export function applyOpenAiChatCompletionsTokenLimit(body, modelId, limit) {
  return applyOpenAiChatCompletionsOutputLimit(body, modelId, limit);
}

/** Alias used by openai.js integration layer. */
export function applyOpenAiChatCompletionsOutputLimit(body, modelId, limit) {
  if (limit == null || !Number.isFinite(Number(limit)) || Number(limit) <= 0) {
    return body;
  }
  const n = Math.min(128_000, Math.floor(Number(limit)));
  const key = openAiChatCompletionsUsesMaxCompletionTokens(modelId)
    ? 'max_completion_tokens'
    : 'max_tokens';
  return { ...body, [key]: n };
}

/** Responses API output cap (all GPT-5.x paths). */
export function applyOpenAiResponsesTokenLimit(body, limit) {
  if (limit == null || !Number.isFinite(Number(limit)) || Number(limit) <= 0) {
    return body;
  }
  return { ...body, max_output_tokens: Math.min(128_000, Math.floor(Number(limit))) };
}
