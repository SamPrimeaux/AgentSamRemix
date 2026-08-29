/**
 * Parse model tool-call argument JSON with repair for truncated streams.
 *
 * Live failure class (2026-07-23): fs_write_file HTML bodies often arrive as
 * incomplete JSON (unterminated "content" string) when output tokens cut off
 * mid-tool-call. JSON.parse fails → tool_arguments_json_parse_error → nothing written.
 * Quotes in HTML were a red herring — error_log only stored slice(0,2000) of __raw.
 */

/**
 * @param {string} text
 * @returns {unknown|null}
 */
export function repairTruncatedJson(text) {
  let s = String(text || '').trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    /* continue */
  }

  // Drop a dangling backslash at EOF (incomplete escape).
  if (s.endsWith('\\')) s = s.slice(0, -1);

  // Close an open string if we ended mid-value.
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString && c === '\\') {
      escape = true;
      continue;
    }
    if (c === '"') inString = !inString;
  }
  if (inString) s += '"';

  // Balance braces / brackets outside strings.
  /** @type {string[]} */
  const stack = [];
  inString = false;
  escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString && c === '\\') {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') {
      if (stack.length) stack.pop();
    }
  }
  while (stack.length) {
    const open = stack.pop();
    s += open === '{' ? '}' : ']';
  }

  // Trailing commas before closer (rare with trunc repair).
  s = s.replace(/,\s*([}\]])/g, '$1');

  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
export function safeJsonParse(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return /** @type {Record<string, unknown>} */ (value);
  }
  if (!value || typeof value !== 'string') return {};
  const raw = value;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? /** @type {Record<string, unknown>} */ (parsed)
      : { value: parsed };
  } catch {
    const repaired = repairTruncatedJson(raw);
    if (repaired && typeof repaired === 'object' && !Array.isArray(repaired)) {
      console.warn(
        '[tool-args] repaired_truncated_json',
        JSON.stringify({
          raw_len: raw.length,
          keys: Object.keys(repaired).slice(0, 12),
        }),
      );
      return {
        .../** @type {Record<string, unknown>} */ (repaired),
        __tool_args_repaired: true,
        __tool_args_truncated: true,
      };
    }
    return { __raw: raw, __parse_error: true };
  }
}

/**
 * Operator-facing copy when args still cannot be repaired.
 * @param {string} toolName
 * @param {string} [rawPreview]
 */
export function toolArgumentsParseErrorMessage(toolName, rawPreview = '') {
  const name = String(toolName || 'tool').trim() || 'tool';
  const looksWrite = /fs_write|write_file|save_page|github_write|github_patch/i.test(name);
  if (looksWrite) {
    return (
      `Could not parse arguments for ${name} (JSON was cut off mid-string — usually an output-token limit on a large HTML/file body). ` +
      `Retry with a shorter file, or write in two steps (skeleton then fs_edit_file / second fs_write_file).`
    );
  }
  return (
    `Could not parse arguments for ${name} (invalid or truncated tool JSON). ` +
    `Retry with smaller arguments.` +
    (rawPreview ? ` Preview: ${String(rawPreview).slice(0, 120)}` : '')
  );
}
