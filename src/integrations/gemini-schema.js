/**
 * Gemini function_declarations JSON Schema sanitizer (pure — no auth/network).
 * Vendor MCP schemas often include OpenAI/Anthropic-only keys and x-* extensions
 * (e.g. Gmail MCP `x-google-enum-descriptions`) that Gemini 400s on.
 */

/** JSON Schema keys Gemini function_declarations reject (OpenAI/Anthropic allow them). */
const GEMINI_SCHEMA_STRIP_KEYS = new Set([
  'additionalProperties',
  '$schema',
  '$id',
  '$ref',
  '$defs',
  'definitions',
  'patternProperties',
  'default',
  'examples',
  'const',
  'deprecated',
  'readOnly',
  'writeOnly',
  'format',
  'title',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'contentMediaType',
  'contentEncoding',
]);

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Gemini only allows `required` / `properties` on OBJECT branches of anyOf/oneOf/allOf.
 * Catalog schemas often use partial branches like `{ "required": ["raw_text"] }` that
 * inherit parent properties in JSON Schema — Gemini rejects those.
 * @param {Record<string, unknown>} branch
 * @param {Record<string, unknown>} parentProperties
 */
function normalizeGeminiCombinatorBranch(branch, parentProperties) {
  if (!isPlainObject(branch)) return { type: 'OBJECT', properties: {} };

  const out = { ...branch };
  const typeUpper = out.type != null ? String(out.type).toUpperCase() : '';
  const hasRequired = Array.isArray(out.required) && out.required.length > 0;
  const hasProps = isPlainObject(out.properties) && Object.keys(out.properties).length > 0;

  if (hasRequired || hasProps || typeUpper === 'OBJECT' || !typeUpper) {
    const mergedProps = {
      ...parentProperties,
      ...(isPlainObject(out.properties) ? out.properties : {}),
    };
    const sanitizedProps = {};
    for (const [propKey, propVal] of Object.entries(mergedProps)) {
      sanitizedProps[propKey] = sanitizeGeminiParameterSchema(propVal);
    }
    out.type = 'OBJECT';
    out.properties = sanitizedProps;
    if (hasRequired) {
      const filtered = out.required
        .map((k) => String(k))
        .filter((k) => Object.prototype.hasOwnProperty.call(sanitizedProps, k));
      if (filtered.length) out.required = filtered;
      else delete out.required;
    }
    return out;
  }

  // Non-object scalar/array branch — required/properties are illegal for Gemini.
  delete out.required;
  delete out.properties;
  if (out.type) out.type = typeUpper;
  return out;
}

/**
 * Recursively strip unsupported JSON Schema keys and uppercase Gemini type literals.
 * Also drops vendor extensions (`x-*`, including `x-google-enum-descriptions` from Gmail MCP).
 * @param {unknown} schema
 */
export function sanitizeGeminiParameterSchema(schema) {
  if (schema == null) return schema;
  if (Array.isArray(schema)) {
    return schema.map((entry) => sanitizeGeminiParameterSchema(entry));
  }
  if (typeof schema !== 'object') return schema;

  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (GEMINI_SCHEMA_STRIP_KEYS.has(key)) continue;
    if (key.startsWith('x-') || key.startsWith('X-')) continue;
    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      const props = {};
      for (const [propKey, propVal] of Object.entries(value)) {
        props[propKey] = sanitizeGeminiParameterSchema(propVal);
      }
      out.properties = props;
      continue;
    }
    if (key === 'items') {
      out.items = sanitizeGeminiParameterSchema(value);
      continue;
    }
    if (key === 'anyOf' || key === 'oneOf' || key === 'allOf') {
      // Deferred — need sibling properties first (normalized below).
      out[key] = value;
      continue;
    }
    out[key] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? sanitizeGeminiParameterSchema(value)
        : value;
  }
  if (out.type) out.type = String(out.type).toUpperCase();
  // Gemini requires array schemas to declare items (OpenAI tolerates bare "type":"array").
  if (out.type === 'ARRAY') {
    if (!out.items || typeof out.items !== 'object' || Array.isArray(out.items)) {
      out.items = { type: 'STRING' };
    } else if (!out.items.type) {
      out.items = { ...out.items, type: 'STRING' };
    } else {
      out.items.type = String(out.items.type).toUpperCase();
    }
  }

  const parentProperties = isPlainObject(out.properties) ? out.properties : {};
  for (const combinator of ['anyOf', 'oneOf', 'allOf']) {
    if (!Object.prototype.hasOwnProperty.call(out, combinator)) continue;
    const value = out[combinator];
    if (!Array.isArray(value)) {
      delete out[combinator];
      continue;
    }
    out[combinator] = value.map((entry) => {
      const sanitized = sanitizeGeminiParameterSchema(entry);
      return normalizeGeminiCombinatorBranch(
        isPlainObject(sanitized) ? sanitized : {},
        parentProperties,
      );
    });
  }

  return out;
}

/**
 * @param {unknown[]} tools
 */
export function normalizeGeminiTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  return [
    {
      function_declarations: tools
        .map((t) => {
          let parameters = { type: 'OBJECT', properties: {} };
          try {
            const raw =
              typeof t.input_schema === 'string'
                ? JSON.parse(t.input_schema)
                : t.input_schema || t.function?.parameters || {};
            if (raw && typeof raw === 'object') {
              parameters = sanitizeGeminiParameterSchema(raw);
              if (!parameters.type) parameters.type = 'OBJECT';
            }
          } catch (_) {
            /* keep empty object params */
          }
          return {
            name: t.tool_name || t.name || t.function?.name,
            description: (
              t.description ||
              t.tool_name ||
              t.function?.description ||
              t.name ||
              ''
            ).slice(0, 500),
            parameters,
          };
        })
        .filter((fd) => fd.name)
        .sort((a, b) => String(a.name).localeCompare(String(b.name))),
    },
  ];
}
