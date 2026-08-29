import { jsonResponse } from '../core/responses.js';
import { getAuthUser } from '../core/auth.js';
import { resolveModelApiKey } from './tokens.js';
import { loadCatalogCapabilities } from '../../backend/agentsam/catalog/model-capabilities.js';
export {
  sanitizeGeminiParameterSchema,
  normalizeGeminiTools,
} from './gemini-schema.js';
import { normalizeGeminiTools } from './gemini-schema.js';

/**
 * Append Gemini built-in code_execution when catalog says the model supports it.
 * Server-side sandbox (no programmatic tool calling — unlike Anthropic 20260120).
 *
 * When catalog/agent `function_declarations` are already mounted, skip native CE:
 * mixing CE + FDs (include_server_side_tool_invocations) steers Gemini into the
 * provider sandbox (print-only "OUTCOME_OK") instead of host tools like
 * fs_search_files / agentsam_d1_query — and that path never writes agentsam_tool_chain.
 *
 * @param {unknown[] | undefined} geminiTools
 * @param {{ supports_code_execution?: boolean } | null | undefined} cap
 */
export function withGeminiCodeExecutionTool(geminiTools, cap) {
  if (!cap?.supports_code_execution) return geminiTools;
  const list = Array.isArray(geminiTools) ? [...geminiTools] : [];
  const hasFunctionDeclarations = list.some(
    (t) =>
      t &&
      typeof t === 'object' &&
      Array.isArray(t.function_declarations) &&
      t.function_declarations.length > 0,
  );
  // Catalog tools win in agent loops — native CE is CE-only / no-FD lanes.
  if (hasFunctionDeclarations) return list;
  if (list.some((t) => t && typeof t === 'object' && 'code_execution' in t)) {
    return list;
  }
  list.push({ code_execution: {} });
  return list;
}

/** Gemini rejects mixing built-in code_execution with function_declarations unless enabled. */
export function buildGeminiToolsRequest(geminiTools) {
  if (!Array.isArray(geminiTools) || geminiTools.length === 0) return {};
  const hasCodeExecution = geminiTools.some(
    (t) => t && typeof t === 'object' && 'code_execution' in t,
  );
  const hasFunctionDeclarations = geminiTools.some(
    (t) =>
      t &&
      typeof t === 'object' &&
      Array.isArray(t.function_declarations) &&
      t.function_declarations.length > 0,
  );
  const payload = { tools: geminiTools };
  if (hasCodeExecution && hasFunctionDeclarations) {
    payload.tool_config = { include_server_side_tool_invocations: true };
  }
  return payload;
}

/**
 * Google Gemini Service Integration.
 *
 * Translates between OpenAI-shaped params (from dispatchStream / dispatchProviderChat)
 * and Gemini's native REST + SSE format, then re-emits as OpenAI-compatible SSE so
 * the agent loop in agent.js parses it without any changes.
 *
 * Gemini 3.x / GA Flash notes (Google generateContent; 3.7 Flash GA 2026-08-13):
 *  - Omit temperature / topP / topK (deprecated; ignored now, 400 later).
 *  - thinkingConfig.thinkingLevel: Flash-Lite = minimal|low|medium|high (default minimal).
 *    3.6 Flash = same four (default medium). 3.7 Flash = low|medium|high (default medium; no minimal).
 *    Raise Flash-Lite to medium/high for tool/subagent work.
 *  - Do not end contents with a model turn (prefill → HTTP 400).
 *  - FunctionResponse must include matching `id` + `name` from FunctionCall.
 *  - thoughtSignature on text/functionCall parts must round-trip for tool loops.
 */

// ─── Model ID + URL helpers ───────────────────────────────────────────────────

/** Strip leading models/ — catalog stores canonical `models/gemini-*` ids. */
export function normalizeGeminiModelId(raw) {
  return String(raw || '').trim().replace(/^models\//, '');
}

export function isGemini3ModelId(modelId) {
  const id = normalizeGeminiModelId(modelId).toLowerCase();
  return id.startsWith('gemini-3');
}

/** Flash-Lite SKUs — default thinking is minimal; raise for agentic tool loops. */
export function isGeminiFlashLiteModelId(modelId) {
  const id = normalizeGeminiModelId(modelId).toLowerCase();
  return id.includes('flash-lite');
}

/**
 * Sampling params are deprecated for Gemini 3.x (hard-fail on 3.6+ / 3.5 Flash-Lite
 * and future releases). Omit them so we never send temperature/topP/topK.
 */
export function omitsGeminiSamplingParams(modelId) {
  return isGemini3ModelId(modelId);
}

/** Visible user-facing text — exclude internal thought summaries only. */
export function isVisibleGeminiTextPart(part) {
  if (!part || part.text == null) return false;
  // Gemini 3.x has used thought:true and other truthy thought flags.
  if (part.thought) return false;
  return true;
}

/** Plain text from an OpenAI-shaped or Gemini `parts` user message. */
export function userMessagePlainText(m) {
  if (!m) return '';
  if (typeof m.content === 'string') return m.content.trim();
  if (Array.isArray(m.content)) {
    return m.content
      .map((b) => (typeof b === 'string' ? b : b?.text != null ? String(b.text) : ''))
      .join('')
      .trim();
  }
  if (Array.isArray(m.parts)) {
    return m.parts
      .map((p) => (typeof p?.text === 'string' ? p.text : ''))
      .join('')
      .trim();
  }
  return '';
}

/** Last user turn as plain text — used to drop prompt-echo parts. */
export function lastUserPlainText(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (m?.role !== 'user') continue;
    const full = userMessagePlainText(m);
    if (!full) continue;
    // File/context dumps make exact-echo matching impossible; keep the instruction line.
    if (full.length > 500) {
      const firstLine = full.split('\n').map((l) => l.trim()).find(Boolean) || '';
      return firstLine || full.slice(0, 500);
    }
    return full;
  }
  return '';
}

/**
 * Gemini streamGenerateContent often sends the user prompt as a later text part.
 * Convert that to a no-op delta so the UI does not concatenate
 * `3.7-ok` + `Reply with exactly: 3.7-ok`.
 *
 * Also catches incremental splits (`3.7-ok` then `Reply` then ` with exactly: …`)
 * by dropping a suffix that reconstitutes the last user prompt.
 */
export function stripPromptEchoDelta(piece, lastUser, emitted = '') {
  let p = String(piece || '');
  const u = String(lastUser || '').trim();
  const already = String(emitted || '');
  if (already && p.startsWith(already)) p = p.slice(already.length);
  if (!u) return p;
  const trimmed = p.trim();
  if (!trimmed) return p;
  if (trimmed === u) return '';
  if (p.endsWith(u) && p.length > u.length) return p.slice(0, -u.length);

  const combined = already + p;
  if (already && combined.endsWith(u) && combined.length > u.length) {
    const keep = combined.slice(0, -u.length);
    if (keep === already) return '';
    if (keep.startsWith(already)) return keep.slice(already.length);
    return '';
  }

  // After a visible answer, drop a later delta that is a long prefix of the prompt.
  const minPrefix = Math.min(16, u.length);
  if (already && trimmed.length >= minPrefix && u.startsWith(trimmed)) return '';

  return p;
}

/** @param {string} providerModelId @param {string} apiKey @param {{ stream?: boolean }} [opts] */
export function buildGeminiUrl(providerModelId, apiKey, opts = {}) {
  const modelId = normalizeGeminiModelId(providerModelId);
  if (modelId.startsWith('models/')) {
    throw new Error(`[gemini] double models/ prefix: ${modelId}`);
  }
  const action = opts.stream ? 'streamGenerateContent' : 'generateContent';
  // Keep `key` and `alt` as separate query params. The historical bug was `alt=sse?key=…`
  // (key glued to alt). For streaming, `alt=sse` is required — without it Google returns a
  // JSON array stream, not `data:` SSE lines that geminiChunkToOpenAI expects.
  const params = new URLSearchParams({ key: apiKey });
  if (opts.stream) params.set('alt', 'sse');
  return `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:${action}?${params.toString()}`;
}

/**
 * @param {{ mode?: string, lane?: string|null, taskType?: string|null }} routingDecision
 * @param {{ maxOutputTokens?: number, modelId?: string|null }} [opts]
 */
/** Gemini 3.x thinking shares the output budget — keep a floor so visible text is not starved. */
export function resolveGeminiMaxOutputTokens(modelId, requested) {
  const gemini3 = isGemini3ModelId(modelId);
  const floor = gemini3 ? 8192 : 2048;
  const req = Number(requested ?? 0);
  if (req > 0) return Math.max(req, floor);
  return floor;
}

/** Composer modes only — keep in sync with `src/core/agent-mode.js` AGENT_MODES. */
const GEMINI_APPROVED_MODES = new Set(['agent', 'ask', 'plan', 'debug', 'multitask']);

export function buildGeminiGenerationConfig(routingDecision, opts = {}) {
  // Prefer runtime mode (same SSOT as agentsam_agent_run.mode). Ignore legacy
  // taskType labels (greeting/chat/router_micro/…) — those are not approved modes.
  const modeRaw = String(routingDecision?.mode || '').toLowerCase().trim();
  const mode = GEMINI_APPROVED_MODES.has(modeRaw) ? modeRaw : '';
  const lane = String(routingDecision?.lane || '').toLowerCase();
  const modelId = normalizeGeminiModelId(opts.modelId || '');
  const gemini3 = isGemini3ModelId(modelId);
  const flashLite = isGeminiFlashLiteModelId(modelId);

  const agentic = mode === 'agent' || mode === 'debug' || mode === 'plan' || mode === 'multitask';
  const premium = mode === 'debug' || mode === 'plan';
  const askLike = mode === 'ask';

  let thinkingLevel = 'low';
  if (flashLite) {
    // GA Flash-Lite: minimal for throughput; medium/high for tool/subagent work.
    if (premium && lane === 'premium') thinkingLevel = 'high';
    else if (agentic && !askLike) thinkingLevel = 'medium';
    else thinkingLevel = 'minimal';
  } else if (gemini3) {
    // 3.6 Flash default = medium; keep low for ask turns.
    if (premium && lane === 'premium') thinkingLevel = 'high';
    else if (agentic && !askLike) thinkingLevel = 'medium';
    else thinkingLevel = 'low';
  } else if (premium) {
    thinkingLevel = 'high';
  } else if (!agentic) {
    thinkingLevel = 'minimal';
  }

  const config = {
    maxOutputTokens: resolveGeminiMaxOutputTokens(modelId, opts.maxOutputTokens),
    thinkingConfig: { thinkingLevel },
  };

  // Gemini 3.x: never send temperature / topP / topK (deprecated → future 400).
  if (!omitsGeminiSamplingParams(modelId)) {
    config.temperature = premium ? 0.7 : 0.2;
  }

  return config;
}

/** Parse Gemini response text for user-visible output. */
export function parseGeminiResponseText(json) {
  return (json?.candidates?.[0]?.content?.parts ?? [])
    .filter(isVisibleGeminiTextPart)
    .map((p) => p.text || '')
    .join('')
    .trim();
}

/** @param {any} json */
export function parseGeminiUsageMetadata(json) {
  const um = json?.usageMetadata ?? {};
  const cached = Math.max(
    0,
    Math.floor(Number(um.cachedContentTokenCount ?? um.cached_content_token_count) || 0),
  );
  return {
    prompt_tokens: um.promptTokenCount ?? 0,
    output_tokens: um.candidatesTokenCount ?? 0,
    thinking_tokens: um.thoughtsTokenCount ?? 0,
    total_tokens: um.totalTokenCount ?? 0,
    cached_content_tokens: cached,
    cache_read_input_tokens: cached,
    model_version: json?.modelVersion ?? null,
    finish_reason: json?.candidates?.[0]?.finishReason ?? null,
  };
}

/** OpenAI-shaped usage so the tool loop can stamp cached_input_tokens. */
export function openAiUsageFromGeminiMeta(meta) {
  const usage = {
    prompt_tokens: Number(meta?.prompt_tokens) || 0,
    completion_tokens:
      (Number(meta?.output_tokens) || 0) + (Number(meta?.thinking_tokens) || 0),
    total_tokens: Number(meta?.total_tokens) || 0,
  };
  const cached = Number(meta?.cached_content_tokens ?? meta?.cache_read_input_tokens) || 0;
  if (cached > 0) {
    usage.prompt_cache_hit_tokens = cached;
    usage.cache_read_input_tokens = cached;
  }
  return usage;
}

/**
 * Stable request prefix for implicit cache: system + sorted tools, then contents.
 * @param {{
 *   contents: unknown,
 *   systemPrompt?: string|null,
 *   geminiTools?: unknown,
 *   generationConfig?: Record<string, unknown>,
 * }} p
 */
export function buildGeminiGenerateContentBody(p) {
  const body = {};
  const systemPrompt = typeof p.systemPrompt === 'string' ? p.systemPrompt.trim() : '';
  if (systemPrompt) {
    body.system_instruction = { parts: [{ text: p.systemPrompt }] };
  }
  Object.assign(body, buildGeminiToolsRequest(p.geminiTools));
  if (p.generationConfig && typeof p.generationConfig === 'object') {
    body.generationConfig = p.generationConfig;
  }
  body.contents = p.contents;
  return body;
}

// ─── Message format conversion ────────────────────────────────────────────────

function buildToolNameById(messages) {
  const map = new Map();
  for (const m of messages || []) {
    if (m?.role !== 'assistant') continue;
    if (Array.isArray(m.content)) {
      for (const b of m.content) {
        if (b?.type === 'tool_use' && b.id && b.name) map.set(String(b.id), String(b.name));
      }
    }
    if (Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        const id = tc?.id != null ? String(tc.id) : '';
        const name = tc?.function?.name != null ? String(tc.function.name) : '';
        if (id && name) map.set(id, name);
      }
    }
  }
  return map;
}

function parseFunctionResponsePayload(content) {
  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (_) {}
    return { result: content };
  }
  if (content && typeof content === 'object') return content;
  return { result: String(content ?? '') };
}

/** Read thoughtSignature from a Gemini part or nested functionCall (camel or snake). */
export function extractGeminiThoughtSignature(part) {
  if (!part || typeof part !== 'object') return '';
  const fc = part.functionCall && typeof part.functionCall === 'object' ? part.functionCall : null;
  const raw =
    part.thoughtSignature ??
    part.thought_signature ??
    fc?.thoughtSignature ??
    fc?.thought_signature ??
    '';
  return raw != null && String(raw).trim() !== '' ? String(raw) : '';
}

/**
 * Gemini 3 validates thoughtSignature on functionCall parts in the current turn.
 * Prefer signatures already on each part; for the first functionCall, promote a
 * signature from an earlier thought/text part in the same model turn; otherwise
 * use Google's documented `skip_thought_signature_validator` escape hatch so
 * rebuilt tool-loop history cannot 400 the next generateContent.
 */
export function ensureGeminiFunctionCallThoughtSignatures(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return parts;
  let promoted = '';
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    if (part.functionCall != null) break;
    const sig = extractGeminiThoughtSignature(part);
    if (sig) promoted = sig;
  }
  let sawFunctionCall = false;
  return parts.map((part) => {
    if (!part || typeof part !== 'object' || part.functionCall == null) return part;
    const isFirst = !sawFunctionCall;
    sawFunctionCall = true;
    const existing = extractGeminiThoughtSignature(part);
    if (existing) {
      return part.thoughtSignature ? part : { ...part, thoughtSignature: existing };
    }
    if (isFirst && promoted) return { ...part, thoughtSignature: promoted };
    // Parallel follow-up FCs normally omit signatures; stamping skip is safe and
    // unblocks validators that flag a non-first FC (e.g. position N) after rebuild.
    return { ...part, thoughtSignature: 'skip_thought_signature_validator' };
  });
}

function assistantAnthropicBlocksToGeminiParts(blocks) {
  const parts = [];
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'text' && b.text) {
      const part = { text: String(b.text) };
      if (b.gemini_thought_signature) part.thoughtSignature = String(b.gemini_thought_signature);
      parts.push(part);
      continue;
    }
    if (b.type === 'tool_use' && b.name) {
      const fc = {
        name: String(b.name),
        args: b.input && typeof b.input === 'object' ? b.input : {},
      };
      if (b.id) fc.id = String(b.id);
      const part = { functionCall: fc };
      if (b.gemini_thought_signature) part.thoughtSignature = String(b.gemini_thought_signature);
      parts.push(part);
    }
  }
  return ensureGeminiFunctionCallThoughtSignatures(parts);
}

function openAiToolCallsToGeminiParts(toolCalls) {
  const parts = [];
  for (const tc of toolCalls) {
    let args = {};
    try {
      args = typeof tc.function?.arguments === 'string'
        ? JSON.parse(tc.function.arguments)
        : (tc.function?.arguments ?? {});
    } catch (_) {}
    const fc = {
      name: tc.function?.name ?? 'unknown',
      args,
    };
    if (tc.id) fc.id = String(tc.id);
    const part = { functionCall: fc };
    const sig = tc.gemini_thought_signature ?? tc.function?.gemini_thought_signature;
    if (sig) part.thoughtSignature = String(sig);
    parts.push(part);
  }
  return ensureGeminiFunctionCallThoughtSignatures(parts);
}

/**
 * GA Flash / Flash-Lite reject requests whose last non-empty turn is role=model.
 * Strip trailing model turns (including text prefills) before generateContent.
 * @param {Array<{ role?: string, parts?: unknown[] }>|null|undefined} contents
 */
export function sanitizeGeminiContents(contents) {
  const out = Array.isArray(contents) ? [...contents] : [];
  while (out.length > 0) {
    const last = out[out.length - 1];
    if (!last || String(last.role || '').toLowerCase() !== 'model') break;
    out.pop();
  }
  return out;
}

/**
 * Convert agent/OpenAI-shaped messages → Gemini `contents` array.
 * Supports Anthropic-style content blocks (tool_use / tool_result) used by AgentSam.
 */
export function toGeminiContents(messages) {
  const toolNames = buildToolNameById(messages);
  const out = [];

  for (const m of messages) {
    if (!m || m.role === 'system') continue;

    if (m.role === 'assistant') {
      if (Array.isArray(m.gemini_model_parts) && m.gemini_model_parts.length > 0) {
        // Prefer verbatim model parts so thoughtSignature / thought parts round-trip.
        out.push({
          role: 'model',
          parts: ensureGeminiFunctionCallThoughtSignatures(m.gemini_model_parts),
        });
        continue;
      }

      const parts = [];
      if (typeof m.content === 'string' && m.content.trim()) {
        parts.push({ text: m.content });
      } else if (Array.isArray(m.content)) {
        parts.push(...assistantAnthropicBlocksToGeminiParts(m.content));
      }
      if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
        parts.push(...openAiToolCallsToGeminiParts(m.tool_calls));
      }
      if (parts.length > 0) {
        out.push({ role: 'model', parts: ensureGeminiFunctionCallThoughtSignatures(parts) });
      }
      continue;
    }

    if (m.role === 'tool') {
      const callId = m.tool_call_id != null ? String(m.tool_call_id) : '';
      const fr = {
        name: m.name || callId || 'tool',
        response: parseFunctionResponsePayload(m.content),
      };
      if (callId) fr.id = callId;
      out.push({
        role: 'user',
        parts: [{ functionResponse: fr }],
      });
      continue;
    }

    if (m.role === 'user') {
      const parts = [];
      if (typeof m.content === 'string' && m.content.trim()) {
        parts.push({ text: m.content });
      } else if (Array.isArray(m.content)) {
        for (const block of m.content) {
          if (!block || typeof block !== 'object') continue;
          if (block.type === 'text' && block.text) {
            parts.push({ text: String(block.text) });
            continue;
          }
          if (block.type === 'tool_result') {
            const toolId = block.tool_use_id != null ? String(block.tool_use_id) : '';
            const toolName =
              (block.name && String(block.name)) ||
              (toolId && toolNames.get(toolId)) ||
              'tool';
            const fr = {
              name: toolName,
              response: parseFunctionResponsePayload(block.content),
            };
            if (toolId) fr.id = toolId;
            parts.push({ functionResponse: fr });
            continue;
          }
          if (block.type === 'image' && block.source?.data) {
            parts.push({
              inlineData: {
                mimeType: block.source.media_type || 'image/png',
                data: String(block.source.data),
              },
            });
          }
        }
      }
      if (parts.length > 0) out.push({ role: 'user', parts });
    }
  }

  return sanitizeGeminiContents(out);
}

// ─── SSE chunk translation ────────────────────────────────────────────────────

/**
 * Translate Gemini SSE JSON → OpenAI-shaped deltas.
 * Preserves gemini_thought_signature on tool_calls for multi-turn tool loops.
 * Forwards usageMetadata as OpenAI `usage` so agent-sse-consumer can stamp tokens.
 */
export function geminiChunkToOpenAI(jsonStr, opts = {}) {
  let parsed;
  try { parsed = JSON.parse(jsonStr); } catch (_) { return []; }

  const dropExact = typeof opts.dropExactText === 'string' ? opts.dropExactText.trim() : '';

  const candidate = parsed?.candidates?.[0];
  const out = [];

  // Usage-only terminal frames (no candidates) still carry billing tokens.
  if (!candidate) {
    const umOnly = parsed?.usageMetadata;
    if (umOnly && typeof umOnly === 'object') {
      const meta = parseGeminiUsageMetadata(parsed);
      out.push({
        usage: openAiUsageFromGeminiMeta(meta),
        choices: [{ index: 0, delta: {}, finish_reason: null }],
      });
    }
    return out;
  }

  const parts = candidate?.content?.parts ?? [];
  const finishReason = candidate?.finishReason ?? null;

  const textParts = parts.filter(isVisibleGeminiTextPart).filter((p) => {
    if (!dropExact) return true;
    return String(p.text || '').trim() !== dropExact;
  });
  // Native code_execution is server-side — surface code + result as visible text
  // so the agent loop / UI aren't blind to sandbox turns.
  const codeBits = [];
  for (const p of parts) {
    if (p?.executableCode?.code) {
      codeBits.push(`\`\`\`python\n${String(p.executableCode.code)}\n\`\`\``);
    }
    if (p?.codeExecutionResult) {
      const outcome = p.codeExecutionResult.outcome
        ? String(p.codeExecutionResult.outcome)
        : '';
      const output =
        p.codeExecutionResult.output != null
          ? String(p.codeExecutionResult.output)
          : '';
      if (outcome || output) {
        codeBits.push(
          outcome
            ? `[code_execution ${outcome}]\n${output}`.trim()
            : output,
        );
      }
    }
  }
  let visible = [
    ...textParts.map((p) => p.text),
    ...codeBits,
  ].filter(Boolean);
  if (dropExact) {
    visible = visible.filter((t) => String(t).trim() !== dropExact);
    const joined = visible.join('\n');
    if (joined.endsWith(dropExact) && joined.length > dropExact.length) {
      visible = [joined.slice(0, -dropExact.length)];
    }
  }
  if (visible.length > 0) {
    out.push({
      choices: [{
        delta: { content: visible.join('\n') },
        finish_reason: null,
        index: 0,
      }],
    });
  }

  const fcParts = parts.filter(p => p.functionCall != null);
  for (let i = 0; i < fcParts.length; i++) {
    const fcPart = fcParts[i];
    const fc = fcPart.functionCall;
    const fn = {
      name: fc.name ?? 'unknown',
      arguments: typeof fc.args === 'string' ? fc.args : JSON.stringify(fc.args ?? {}),
    };
    const sig = extractGeminiThoughtSignature(fcPart);
    if (sig) fn.gemini_thought_signature = sig;
    const callId = fc.id != null && String(fc.id).trim() !== ''
      ? String(fc.id)
      : `call_g_${fn.name}_${i}`;
    out.push({
      choices: [{
        delta: {
          tool_calls: [{
            index: i,
            id: callId,
            type: 'function',
            function: fn,
            ...(sig ? { gemini_thought_signature: sig } : {}),
          }],
        },
        finish_reason: null,
        index: 0,
      }],
    });
  }

  if (finishReason && finishReason !== 'FINISH_REASON_UNSPECIFIED') {
    const oaiFinish =
      finishReason === 'STOP'       ? 'stop'
      : finishReason === 'MAX_TOKENS' ? 'length'
      : finishReason === 'SAFETY'     ? 'content_filter'
      : finishReason === 'TOOL_CODE_EXECUTION' ? 'tool_calls'
      : finishReason.toLowerCase();
    out.push({
      choices: [{ delta: {}, finish_reason: oaiFinish, index: 0 }],
    });
  }

  // Prefer attaching usage on the last emitted frame so chat-completions SSE
  // consumer overwrites with the latest (usually cumulative) totals.
  const um = parsed?.usageMetadata;
  if (um && typeof um === 'object') {
    const meta = parseGeminiUsageMetadata(parsed);
    const usage = openAiUsageFromGeminiMeta(meta);
    if (out.length) {
      out[out.length - 1] = { ...out[out.length - 1], usage };
    } else {
      out.push({
        usage,
        choices: [{ index: 0, delta: {}, finish_reason: null }],
      });
    }
  }

  return out;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function chatWithToolsGemini(env, request, params) {
  const {
    modelKey,
    providerModelId,
    messages,
    tools: toolDefinitions,
    systemPrompt,
    userId: paramUserId,
  } = params;

  const authUser = await getAuthUser(request, env);
  const userId =
    paramUserId != null && String(paramUserId).trim() !== ''
      ? String(paramUserId).trim()
      : authUser
        ? String(authUser.id)
        : null;
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);

  const apiKey = await resolveModelApiKey(env, 'google', modelKey, userId);
  if (!apiKey || !String(apiKey).trim()) {
    return jsonResponse({ error: 'Google AI API key not configured' }, 503);
  }

  const catalogCap = await loadCatalogCapabilities(env, modelKey);
  const geminiTools = withGeminiCodeExecutionTool(
    normalizeGeminiTools(toolDefinitions),
    catalogCap,
  );
  const normalizedModelId = normalizeGeminiModelId(
    providerModelId != null && String(providerModelId).trim() !== ''
      ? String(providerModelId).trim()
      : modelKey,
  );

  const contents = toGeminiContents(messages);
  const dropExactText = lastUserPlainText(messages);
  const body = buildGeminiGenerateContentBody({
    contents,
    systemPrompt,
    geminiTools,
    generationConfig: buildGeminiGenerationConfig(
      { mode: params.mode, lane: params.lane, taskType: params.taskType },
      { maxOutputTokens: params.maxOutputTokens, modelId: normalizedModelId },
    ),
  });

  const url = buildGeminiUrl(normalizedModelId, apiKey, { stream: true });

  let upstream;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
      ...(params.signal != null ? { signal: params.signal } : {}),
    });
  } catch (e) {
    return jsonResponse({ error: `Gemini fetch failed: ${e?.message ?? e}` }, 502);
  }

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '');
    let detail = errText;
    try {
      const j = JSON.parse(errText);
      detail = j?.error?.message ?? j?.message ?? detail;
    } catch {
      /* keep errText */
    }
    const status = upstream.status >= 400 ? upstream.status : 502;
    return jsonResponse({ error: `Gemini ${upstream.status}: ${detail}` }, status);
  }

  if (!upstream.body) {
    return jsonResponse({ error: 'Gemini stream body missing' }, 502);
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const emitJson = async (obj) =>
    writer.write(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

  (async () => {
    const reader = upstream.body.getReader();
    let terminalEvent = false;
    /** @type {unknown[]} */
    const accumulatedModelParts = [];
    let emittedVisible = '';
    try {
      const decoder = new TextDecoder();
      let buf = '';

      const ingestGeminiSseJson = async (jsonStr) => {
        try {
          const parsed = JSON.parse(jsonStr);
          const parts = parsed?.candidates?.[0]?.content?.parts;
          if (Array.isArray(parts) && parts.length) {
            for (const p of parts) accumulatedModelParts.push(p);
          }
        } catch {
          /* geminiChunkToOpenAI also tolerates bad JSON */
        }
        for (const chunk of geminiChunkToOpenAI(jsonStr, { dropExactText })) {
          const delta = chunk?.choices?.[0]?.delta;
          if (delta && typeof delta.content === 'string' && delta.content) {
            const piece = stripPromptEchoDelta(delta.content, dropExactText, emittedVisible);
            if (!piece) delete delta.content;
            else {
              delta.content = piece;
              emittedVisible += piece;
            }
          }
          await emitJson(chunk);
        }
      };

      while (!terminalEvent) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr) continue;
          if (jsonStr === '[DONE]') {
            terminalEvent = true;
            break;
          }

          await ingestGeminiSseJson(jsonStr);
        }
      }

      const tail = buf.trim();
      if (tail.startsWith('data:')) {
        const jsonStr = tail.slice(5).trim();
        if (jsonStr && jsonStr !== '[DONE]') {
          await ingestGeminiSseJson(jsonStr);
        }
      }

      // Emit verbatim model parts so the agent tool loop can round-trip
      // thoughtSignature without rebuilding functionCall parts.
      if (accumulatedModelParts.length > 0) {
        await emitJson({
          choices: [{
            delta: { gemini_model_parts: accumulatedModelParts },
            finish_reason: null,
            index: 0,
          }],
        });
      }

      await writer.write(encoder.encode('data: [DONE]\n\n'));
    } catch (e) {
      await emitJson({
        choices: [{ delta: {}, finish_reason: 'error', index: 0 }],
        error: { message: e?.message ?? String(e) },
      }).catch(() => {});
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
      await writer.close().catch(() => {});
    }
  })().catch((e) => {
    console.warn('[gemini] stream pump failed', e?.message ?? e);
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

export async function completeWithGemini(env, params) {
  const {
    modelKey,
    providerModelId,
    systemPrompt,
    messages = [],
    tools: toolDefinitions = [],
    userId,
  } = params;

  const apiKey = await resolveModelApiKey(env, 'google', modelKey, userId);
  if (!apiKey || !String(apiKey).trim()) {
    throw new Error('Google AI API key not configured');
  }

  const resolvedModel = normalizeGeminiModelId(
    providerModelId != null && String(providerModelId).trim() !== ''
      ? String(providerModelId).trim()
      : String(modelKey || '').trim(),
  );
  if (!resolvedModel) throw new Error('modelKey required');

  const catalogCap = await loadCatalogCapabilities(env, modelKey);
  const geminiTools = withGeminiCodeExecutionTool(
    normalizeGeminiTools(toolDefinitions),
    catalogCap,
  );
  const contents = toGeminiContents(messages);
  const body = buildGeminiGenerateContentBody({
    contents,
    systemPrompt,
    geminiTools,
    generationConfig: buildGeminiGenerationConfig(
      { mode: params.mode, lane: params.lane, taskType: params.taskType },
      { maxOutputTokens: params.maxOutputTokens, modelId: resolvedModel },
    ),
  });

  const url = buildGeminiUrl(resolvedModel, apiKey, { stream: false });

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
      ...(params.signal != null ? { signal: params.signal } : {}),
    });
  } catch (e) {
    throw new Error(`Gemini request failed: ${e?.message ?? e}`);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.error?.message ?? JSON.stringify(data);
    throw new Error(`Gemini ${res.status}: ${detail}`);
  }

  const text = parseGeminiResponseText(data);
  return { text, output_text: text, usage: parseGeminiUsageMetadata(data) };
}
