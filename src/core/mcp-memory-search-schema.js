/**
 * Canonical MCP input schema for agentsam_memory_search (tools/list).
 * Keep in sync with inneranimalmedia-mcp-server/src/mcp-memory-search-schema.js
 */

export const DEFAULT_MEMORY_SEARCH_QUERY = 'recent relevant workspace memory';
/** Legacy Vectorize label — D1 + private PG search ignore this. */
export const DEFAULT_MEMORY_NAMESPACE = 'agentsam-private-managed';

/** @type {Record<string, unknown>} */
export const CANONICAL_AGENTSAM_MEMORY_SEARCH_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description:
        'Substring search against D1 + agentsam.agentsam_memory (no Vectorize). Defaults to recent workspace memory when omitted.',
    },
    namespace: {
      type: 'string',
      default: DEFAULT_MEMORY_NAMESPACE,
      description: 'Legacy connector field (ignored; private managed memory does not use Vectorize).',
    },
    top_k: {
      type: 'integer',
      default: 5,
      maximum: 20,
      description: 'Max results (maps to D1 row limit).',
    },
    filter: {
      type: 'object',
      description: 'Optional metadata filter (ignored on D1 substring path).',
    },
    provider: {
      type: 'string',
      enum: ['cf', 'supabase', 'auto'],
      default: 'auto',
      description: 'Legacy provider hint (D1 search ignores; kept for connector compatibility).',
    },
    memory_type: {
      type: 'string',
      enum: [
        'fact',
        'preference',
        'project',
        'skill',
        'error',
        'decision',
        'policy',
        'state',
      ],
      description: 'Optional filter for managed memory category (D1 + agentsam.agentsam_memory).',
    },
  },
  additionalProperties: false,
};

/** @returns {Record<string, unknown>} */
export function agentsamMemorySearchInputSchema() {
  return {
    ...CANONICAL_AGENTSAM_MEMORY_SEARCH_INPUT_SCHEMA,
    properties: { ...CANONICAL_AGENTSAM_MEMORY_SEARCH_INPUT_SCHEMA.properties },
  };
}
