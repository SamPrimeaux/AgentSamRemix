/**
 * Canonical MCP input schema for agentsam_memory_write (Vectorize / semantic lane only).
 * Operational private memory: agentsam_memory_save or POST /api/agent/memory/private/*.
 */

/** @type {Record<string, unknown>} */
export const CANONICAL_AGENTSAM_MEMORY_VECTOR_WRITE_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    content: {
      type: 'string',
      description:
        'Text to embed and store in Vectorize (semantic / RAG lane). Not for private managed KV — use agentsam_memory_save.',
    },
    namespace: {
      type: 'string',
      default: 'agentsam-memory-oai3large-1536',
      description:
        'Target writable Vectorize index. Operational managed memory does not use this field.',
    },
    source: {
      type: 'string',
      description: 'Origin e.g. chat, tool_result, code_review, r2_ingest',
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Metadata tags stored alongside the vector',
    },
    metadata: {
      type: 'object',
      description: 'Stored alongside vector e.g. { run_id, r2_path }',
    },
    provider: {
      type: 'string',
      enum: ['cf', 'supabase', 'both'],
      default: 'cf',
      description: 'cf=Vectorize 1536d; supabase=pgvector 3072d; both=dual-write',
    },
  },
  required: ['content'],
  additionalProperties: false,
};

/** @returns {Record<string, unknown>} */
export function agentsamMemoryVectorWriteInputSchema() {
  return {
    ...CANONICAL_AGENTSAM_MEMORY_VECTOR_WRITE_INPUT_SCHEMA,
    properties: { ...CANONICAL_AGENTSAM_MEMORY_VECTOR_WRITE_INPUT_SCHEMA.properties },
  };
}
