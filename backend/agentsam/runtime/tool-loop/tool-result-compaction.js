export const CONSUMED_TOOL_RESULT_CHAR_CAP = 4000;
export const FIRST_PASS_TOOL_RESULT_CHAR_CAP = 24_000;

function summarizeJsonValue(value, depth = 0) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }
  if (depth >= 2) {
    return Array.isArray(value)
      ? `[array:${value.length}]`
      : `[object:${Object.keys(value || {}).length}]`;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 8).map((item) => summarizeJsonValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 20)
        .map(([key, item]) => [key, summarizeJsonValue(item, depth + 1)]),
    );
  }
  return String(value);
}

function compactString(value, maxChars, markerKind = 'after first model pass') {
  const text = String(value ?? '');
  if (text.length <= maxChars) return { value: text, removed: 0 };

  try {
    const parsed = JSON.parse(text);
    const compactedJson = JSON.stringify({
      _compacted: {
        after_first_model_pass: markerKind === 'after first model pass',
        original_chars: text.length,
        kind: Array.isArray(parsed) ? 'array' : typeof parsed,
        ...(Array.isArray(parsed) ? { original_items: parsed.length } : {}),
      },
      preview: summarizeJsonValue(parsed),
    });
    if (compactedJson.length <= maxChars) {
      return { value: compactedJson, removed: text.length - compactedJson.length };
    }
    let previewChars = Math.max(64, maxChars - 320);
    let minimalJson = '';
    do {
      minimalJson = JSON.stringify({
        _compacted: {
          after_first_model_pass: markerKind === 'after first model pass',
          original_chars: text.length,
          kind: Array.isArray(parsed) ? 'array' : typeof parsed,
        },
        preview_text: text.slice(0, previewChars),
      });
      previewChars = Math.floor(previewChars / 2);
    } while (minimalJson.length > maxChars && previewChars >= 32);
    return {
      value: minimalJson,
      removed: text.length - Math.min(text.length, minimalJson.length),
    };
  } catch {
    // Plain text keeps a head/tail representation below.
  }

  const markerReserve = 96;
  const available = Math.max(256, maxChars - markerReserve);
  const headChars = Math.floor(available * 0.8);
  const tailChars = available - headChars;
  const removed = text.length - headChars - tailChars;
  const marker = `\n…[compacted ${markerKind}; ${removed} chars omitted]…\n`;

  return {
    value: `${text.slice(0, headChars)}${marker}${text.slice(-tailChars)}`.slice(0, maxChars),
    removed,
  };
}

/**
 * Hard cap a tool payload before the first model pass.
 * A single D1/terminal dump must not be allowed to cost a full context window once.
 *
 * @param {unknown} value
 * @param {number} [maxChars]
 * @returns {string}
 */
export function capToolResultForPrompt(value, maxChars = FIRST_PASS_TOOL_RESULT_CHAR_CAP) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  const cap = Math.max(1024, Math.floor(Number(maxChars) || FIRST_PASS_TOOL_RESULT_CHAR_CAP));
  return compactString(text, cap, 'for prompt budget').value;
}

function compactToolPayload(content, maxChars) {
  if (typeof content === 'string') return compactString(content, maxChars);
  if (content == null) return { value: content, removed: 0 };
  try {
    return compactString(JSON.stringify(content), maxChars);
  } catch {
    return { value: content, removed: 0 };
  }
}

function maybeParseToolResultArray(content) {
  if (typeof content !== 'string') return content;
  const t = content.trim();
  if (!t || (t[0] !== '[' && t[0] !== '{')) return content;
  if (!t.includes('tool_result')) return content;
  try {
    return JSON.parse(t);
  } catch {
    return content;
  }
}

function extractPartThoughtSignature(part) {
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
 * Drop Gemini thought *text* from replayed model parts while keeping functionCall
 * thought signatures. Thought blobs are the main in-loop growth on Gemini 3.x;
 * signatures are required for the next generateContent.
 *
 * @param {Array<Record<string, any>>} messages
 * @returns {{ droppedThoughts: number, removedChars: number }}
 */
export function compactGeminiReplayPartsInPlace(messages) {
  if (!Array.isArray(messages)) {
    return { droppedThoughts: 0, removedChars: 0 };
  }
  let droppedThoughts = 0;
  let removedChars = 0;

  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    if (String(message.role || '') !== 'assistant') continue;
    const parts = message.gemini_model_parts;
    if (!Array.isArray(parts) || !parts.length) continue;

    let promoted = '';
    for (const part of parts) {
      if (!part || typeof part !== 'object') continue;
      if (part.functionCall != null) break;
      const sig = extractPartThoughtSignature(part);
      if (sig) promoted = sig;
    }

    let sawFunctionCall = false;
    const nextParts = [];
    for (const part of parts) {
      if (!part || typeof part !== 'object') continue;
      if (part.thought) {
        droppedThoughts += 1;
        removedChars += String(part.text || '').length;
        const sig = extractPartThoughtSignature(part);
        if (sig) promoted = sig;
        continue;
      }
      if (part.functionCall != null) {
        const next = { ...part };
        const existing = extractPartThoughtSignature(next);
        if (existing) {
          if (!next.thoughtSignature) next.thoughtSignature = existing;
        } else if (!sawFunctionCall && promoted) {
          next.thoughtSignature = promoted;
        }
        sawFunctionCall = true;
        nextParts.push(next);
        continue;
      }
      nextParts.push(part);
    }
    message.gemini_model_parts = nextParts;
  }

  return { droppedThoughts, removedChars };
}

function messageHasToolResult(message) {
  if (!message || typeof message !== 'object') return false;
  if (message.role === 'tool') return true;
  if (Array.isArray(message.content) && message.content.some((b) => b && b.type === 'tool_result')) {
    return true;
  }
  if (typeof message.content === 'string' && message.content.includes('tool_result')) return true;
  return false;
}

function lastToolResultMessageIndex(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messageHasToolResult(messages[i])) return i;
  }
  return -1;
}

/**
 * Compact tool outputs only after a model has consumed them once.
 *
 * Default: shrink every tool_result in the array (post-model). Pass
 * `protectLatestBatch: true` before a model call so the freshest tool
 * payloads stay at first-pass fidelity unless a char budget forces them down.
 *
 * @param {Array<Record<string, any>>} messages
 * @param {{ maxChars?: number, protectLatestBatch?: boolean }} [opts]
 */
export function compactConsumedToolResultsInPlace(messages, opts = {}) {
  if (!Array.isArray(messages)) {
    return { compactedBlocks: 0, removedChars: 0 };
  }

  const maxChars = Math.max(
    512,
    Math.floor(Number(opts.maxChars) || CONSUMED_TOOL_RESULT_CHAR_CAP),
  );
  const protectLatest = opts.protectLatestBatch === true;
  const skipIndex = protectLatest ? lastToolResultMessageIndex(messages) : -1;
  let compactedBlocks = 0;
  let removedChars = 0;

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (!message || typeof message !== 'object') continue;
    if (protectLatest && i === skipIndex) continue;

    if (typeof message.content === 'string') {
      const parsed = maybeParseToolResultArray(message.content);
      if (parsed !== message.content) message.content = parsed;
    }

    if (message.role === 'tool' && typeof message.content === 'string') {
      const compacted = compactString(message.content, maxChars);
      if (compacted.removed > 0) {
        message.content = compacted.value;
        compactedBlocks += 1;
        removedChars += compacted.removed;
      }
      continue;
    }

    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (!block || typeof block !== 'object' || block.type !== 'tool_result') continue;
      const compacted = compactToolPayload(block.content, maxChars);
      if (compacted.removed > 0) {
        block.content = compacted.value;
        compactedBlocks += 1;
        removedChars += compacted.removed;
      }
    }
  }

  return { compactedBlocks, removedChars };
}
