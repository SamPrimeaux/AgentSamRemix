/**
 * Normalize token usage from OpenAI-compatible providers without importing
 * telemetry or persistence modules into stream consumers.
 *
 * @param {Record<string, unknown>|null|undefined} usage
 */
export function emptyUsageTokens() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
}

/**
 * @param {Record<string, unknown>|null|undefined} usage
 */
export function aggregateOpenAiCompatibleUsageTokens(usage) {
  if (!usage || typeof usage !== 'object') {
    return emptyUsageTokens();
  }
  const cacheHit = Math.max(0, Math.floor(Number(usage.prompt_cache_hit_tokens) || 0));
  const cacheMiss = Math.max(0, Math.floor(Number(usage.prompt_cache_miss_tokens) || 0));
  const prompt = Math.max(0, Math.floor(Number(usage.prompt_tokens) || 0));
  const input =
    cacheHit + cacheMiss > 0
      ? cacheHit + cacheMiss
      : prompt || Math.max(0, Math.floor(Number(usage.input_tokens) || 0));
  return {
    input_tokens: input,
    output_tokens: Math.max(
      0,
      Math.floor(Number(usage.completion_tokens) || Number(usage.output_tokens) || 0),
    ),
    cache_read_input_tokens:
      cacheHit || Math.max(0, Math.floor(Number(usage.cache_read_input_tokens) || 0)),
    cache_creation_input_tokens: Math.max(
      0,
      Math.floor(Number(usage.cache_creation_input_tokens) || 0),
    ),
  };
}

/**
 * Gemini / Google generateContent usageMetadata → OpenAI-shaped totals.
 * thoughtsTokenCount is billed like output on Gemini 2.5/3.x — fold into output_tokens.
 *
 * @param {Record<string, unknown>|null|undefined} usageMetadata
 */
export function aggregateGeminiUsageMetadata(usageMetadata) {
  if (!usageMetadata || typeof usageMetadata !== 'object') {
    return emptyUsageTokens();
  }
  const prompt = Math.max(
    0,
    Math.floor(
      Number(usageMetadata.promptTokenCount ?? usageMetadata.prompt_tokens ?? usageMetadata.input_tokens) ||
        0,
    ),
  );
  const candidates = Math.max(
    0,
    Math.floor(
      Number(
        usageMetadata.candidatesTokenCount ??
          usageMetadata.completion_tokens ??
          usageMetadata.output_tokens,
      ) || 0,
    ),
  );
  const thoughts = Math.max(
    0,
    Math.floor(Number(usageMetadata.thoughtsTokenCount ?? usageMetadata.thinking_tokens) || 0),
  );
  const cached = Math.max(
    0,
    Math.floor(Number(usageMetadata.cachedContentTokenCount ?? usageMetadata.cache_read_input_tokens) || 0),
  );
  return {
    input_tokens: prompt,
    output_tokens: candidates + thoughts,
    cache_read_input_tokens: cached,
    cache_creation_input_tokens: 0,
  };
}

/**
 * Pull usage from any SSE/JSON chunk: OpenAI `usage`, Gemini `usageMetadata`, or both.
 *
 * @param {Record<string, unknown>|null|undefined} json
 */
export function extractStreamChunkUsage(json) {
  if (!json || typeof json !== 'object') return emptyUsageTokens();
  if (json.usage && typeof json.usage === 'object') {
    return aggregateOpenAiCompatibleUsageTokens(
      /** @type {Record<string, unknown>} */ (json.usage),
    );
  }
  const nested =
    json.response && typeof json.response === 'object'
      ? /** @type {Record<string, unknown>} */ (json.response).usage
      : null;
  if (nested && typeof nested === 'object') {
    return aggregateOpenAiCompatibleUsageTokens(/** @type {Record<string, unknown>} */ (nested));
  }
  if (json.usageMetadata && typeof json.usageMetadata === 'object') {
    return aggregateGeminiUsageMetadata(
      /** @type {Record<string, unknown>} */ (json.usageMetadata),
    );
  }
  if (json.usage_metadata && typeof json.usage_metadata === 'object') {
    return aggregateGeminiUsageMetadata(
      /** @type {Record<string, unknown>} */ (json.usage_metadata),
    );
  }
  return emptyUsageTokens();
}

/**
 * @param {{ input_tokens?: number, output_tokens?: number, cache_read_input_tokens?: number, cache_creation_input_tokens?: number }|null|undefined} u
 */
export function usageHasTokens(u) {
  return Boolean(
    (u?.input_tokens || 0) > 0 ||
      (u?.output_tokens || 0) > 0 ||
      (u?.cache_read_input_tokens || 0) > 0 ||
      (u?.cache_creation_input_tokens || 0) > 0,
  );
}

/**
 * Mutates `total` by adding `delta` when delta has any tokens.
 * @param {ReturnType<typeof emptyUsageTokens>} total
 * @param {ReturnType<typeof emptyUsageTokens>|null|undefined} delta
 */
export function accumulateUsageTokens(total, delta) {
  if (!total || !delta || !usageHasTokens(delta)) return total;
  total.input_tokens += delta.input_tokens || 0;
  total.output_tokens += delta.output_tokens || 0;
  total.cache_read_input_tokens += delta.cache_read_input_tokens || 0;
  total.cache_creation_input_tokens += delta.cache_creation_input_tokens || 0;
  return total;
}

/** Rough token estimate when a provider omits usage on a completed stream. */
export function estimateTokensFromChars(text) {
  const n = String(text || '').length;
  if (n <= 0) return 0;
  return Math.max(1, Math.ceil(n / 4));
}

/**
 * Fill zero usage from transcript text. Never overwrites provider-reported counts.
 * @param {ReturnType<typeof emptyUsageTokens>|null|undefined} usage
 * @param {{ inputText?: unknown, outputText?: unknown }} [opts]
 */
export function fillMissingUsageFromText(usage, opts = {}) {
  const next = usage && typeof usage === 'object' ? usage : emptyUsageTokens();
  if (!(Number(next.output_tokens) > 0)) {
    const out = estimateTokensFromChars(opts.outputText);
    if (out > 0) next.output_tokens = out;
  }
  if (!(Number(next.input_tokens) > 0)) {
    const inn = estimateTokensFromChars(opts.inputText);
    if (inn > 0) next.input_tokens = inn;
  }
  return next;
}

/**
 * OpenAI-shaped usage object for SSE frames (Gemini adapter / Workers AI).
 * @param {ReturnType<typeof emptyUsageTokens>} tokens
 */
export function toOpenAiUsageField(tokens) {
  return {
    prompt_tokens: tokens.input_tokens || 0,
    completion_tokens: tokens.output_tokens || 0,
    total_tokens: (tokens.input_tokens || 0) + (tokens.output_tokens || 0),
    ...(tokens.cache_read_input_tokens
      ? { prompt_cache_hit_tokens: tokens.cache_read_input_tokens }
      : {}),
  };
}
