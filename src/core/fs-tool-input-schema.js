/**
 * Code-owned compatibility fields for workspace filesystem tools.
 * Catalog rows can lag a worker deploy; these fields must still reach the model tool schema.
 *
 * @param {string|null|undefined} toolName
 * @param {Record<string, unknown>|null|undefined} schema
 * @returns {Record<string, unknown>}
 */
export function augmentWorkspaceFsInputSchema(toolName, schema) {
  const key = String(toolName || '').trim().toLowerCase();
  const base = schema && typeof schema === 'object' && !Array.isArray(schema) ? schema : {};
  const out = {
    ...base,
    type: String(base.type || 'object'),
    properties:
      base.properties && typeof base.properties === 'object' && !Array.isArray(base.properties)
        ? { ...base.properties }
        : {},
  };

  if (key === 'fs_read_file') {
    out.properties.prefer_github = {
      type: 'boolean',
      description:
        'Read the committed GitHub tip directly. Use when PTY/local workspace is unavailable or committed code truth is required.',
      default: false,
    };
    out.properties.max_bytes = {
      type: 'integer',
      description:
        'Max UTF-8 bytes to return (default 32768). Above 65536 requires force:true. Prefer line_start/line_end for symbol reads.',
    };
    out.properties.byte_offset = {
      type: 'integer',
      description: 'Resume offset in UTF-8 bytes. Pass next_byte_offset from a prior truncated read.',
    };
    out.properties.line_start = {
      type: 'integer',
      description:
        '1-based start line (preferred). Use agentsam_codebase_retrieve line_start + margin for symbol bodies.',
    };
    out.properties.line_end = {
      type: 'integer',
      description: '1-based end line (inclusive). Pair with line_start from retrieve hits.',
    };
    out.properties.line_margin = {
      type: 'integer',
      description: 'Extra lines before/after line_start/line_end (default 15 when line_start set).',
    };
    out.properties.force = {
      type: 'boolean',
      description:
        'Required to exceed soft ceilings (max_bytes>65536 or very large line windows). Deliberate large reads only.',
      default: false,
    };
  }

  return out;
}
