/**
 * Anthropic Messages API custom tool input_schema sanitizer (pure).
 * Anthropic rejects top-level oneOf / allOf / anyOf on tools[].custom.input_schema.
 * Nested combinators (e.g. items.oneOf) are allowed and left intact.
 */

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} schema
 * @returns {Record<string, unknown>}
 */
export function sanitizeAnthropicToolInputSchema(schema) {
  if (!isPlainObject(schema)) {
    return { type: 'object', properties: {} };
  }

  const out = { ...schema };
  const hadCombinator =
    Array.isArray(out.anyOf) || Array.isArray(out.oneOf) || Array.isArray(out.allOf);

  if (hadCombinator) {
    const branches = /** @type {unknown[]} */ (out.anyOf || out.oneOf || out.allOf || []);
    delete out.anyOf;
    delete out.oneOf;
    delete out.allOf;

    // Soften required: combinator branches encode "one of these shapes".
    // Keeping a hard required list would over-constrain after flattening.
    if (!Array.isArray(out.required) || out.required.length === 0) {
      delete out.required;
    }

    const hints = [];
    for (const branch of branches) {
      if (!isPlainObject(branch)) continue;
      if (Array.isArray(branch.required) && branch.required.length) {
        hints.push(branch.required.map((k) => String(k)).join('+'));
      }
    }
    if (hints.length) {
      const note = `Provide one of: ${hints.join(' | ')}.`;
      out.description =
        out.description != null && String(out.description).trim()
          ? `${String(out.description).trim()} ${note}`
          : note;
    }
  }

  if (out.type == null) out.type = 'object';
  if (!isPlainObject(out.properties)) out.properties = {};

  return out;
}
