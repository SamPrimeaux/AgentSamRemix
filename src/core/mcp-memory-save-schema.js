/**
 * Canonical MCP input schema for agentsam_memory_save (private managed memory).
 * Vectorize semantic writes: mcp-memory-vector-write-schema.js (agentsam_memory_write).
 * Keep in sync with inneranimalmedia-mcp-server/src/mcp-memory-save-schema.js.
 */

import { MANAGED_MEMORY_TYPES } from './agentsam-memory-contract.js';

/** @type {Record<string, unknown>} */
export const CANONICAL_AGENTSAM_MEMORY_SAVE_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    key: {
      type: 'string',
      description:
        'Stable memory key (e.g. milestone:20260529_slug, policy:no_public_private_memory, state:production).',
    },
    value: {
      type: 'string',
      description: 'Memory body stored in D1 + private agentsam.agentsam_memory (not public.agent_memory).',
    },
    memory_type: {
      type: 'string',
      enum: [...MANAGED_MEMORY_TYPES],
      description: 'Managed memory category (aligned with D1 commit + Postgres CHECK).',
    },
    title: { type: 'string', description: 'Short title for dashboards.' },
    summary: { type: 'string', description: 'Prompt-friendly summary (defaults from value).' },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional tags for filtering.',
    },
    importance: {
      type: 'integer',
      minimum: 1,
      maximum: 10,
      description: 'Priority 1–10 (default 5).',
    },
    is_pinned: {
      type: 'boolean',
      description: 'Pin for prompt priority.',
    },
    source: {
      type: 'string',
      description: 'Provenance e.g. mcp:chatgpt, cursor_session_sync, deploy_hook.',
    },
    ttl_days: {
      type: 'number',
      description: 'Optional TTL in days (D1 expires_at only).',
    },
  },
  required: ['key', 'value'],
  additionalProperties: false,
};

/** @returns {Record<string, unknown>} */
export function agentsamMemorySaveInputSchema() {
  return {
    ...CANONICAL_AGENTSAM_MEMORY_SAVE_INPUT_SCHEMA,
    properties: { ...CANONICAL_AGENTSAM_MEMORY_SAVE_INPUT_SCHEMA.properties },
  };
}
