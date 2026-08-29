/**
 * Tool: Memory — compatibility adapters into canonical agentsam_memory_commit / hybrid search.
 * All ops scoped to (tenant_id, user_id) — never cross-tenant.
 */
import { resolveManagedMemoryType, normalizeMemoryTags } from '../../../../src/core/mcp-memory-type-compat.js';
import { agentsamMemoryActiveSqlOrEmpty, resolveAgentsamMemory } from './memory-resolve-runtime.js';

// ---------------------------------------------------------------------------
// Tool schemas — registered with the model via buildAnthropicMessagesTools
// ---------------------------------------------------------------------------

export const MEMORY_TOOL_SCHEMAS = [
  {
    name: 'memory_write',
    description:
      'Store or update a memory entry. Use for facts, preferences, decisions, errors, ' +
      'project context, or skills learned. key must be concise and unique per user. ' +
      'Overwrites existing entry with the same key.',
    input_schema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'Short unique identifier, e.g. "preferred_model", "last_deploy_error"',
        },
        value: {
          type: 'string',
          description: 'The memory content to store.',
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
          description: 'Category of memory.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for grouping, e.g. ["deploy", "anthropic"]',
        },
        confidence: {
          type: 'number',
          description: 'Certainty score 0.0–1.0. Default 1.0.',
        },
        ttl_days: {
          type: 'number',
          description: 'Optional TTL in days. Omit for permanent storage.',
        },
        source: {
          type: 'string',
          description: 'Where this memory came from, e.g. "user_statement", "inferred"',
        },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'memory_resolve',
    description:
      'Mark a memory key (or keys) as resolved/closed. Resolved rows stop appearing in daily briefs and active recall. Use when a blocker or alert is confirmed done.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Single memory key to resolve' },
        keys: {
          type: 'array',
          items: { type: 'string' },
          description: 'Multiple keys to resolve',
        },
        note: { type: 'string', description: 'Optional resolution note appended to summary' },
      },
    },
  },
  {
    name: 'memory_read',
    description:
      'Read one or more memory entries by exact key(s). Returns current value and metadata.',
    input_schema: {
      type: 'object',
      properties: {
        keys: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of keys to retrieve.',
        },
      },
      required: ['keys'],
    },
  },
  {
    name: 'memory_search',
    description:
      'Search memory by type, tags, or a text substring in key/value. ' +
      'Returns up to 20 results ordered by recall_count desc, last_recalled_at desc.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Substring to match against key or value.',
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
          description: 'Filter by memory type.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter: entries must contain ALL listed tags.',
        },
        limit: {
          type: 'number',
          description: 'Max results to return. Default 10, max 20.',
        },
      },
    },
  },
  {
    name: 'memory_delete',
    description: 'Permanently delete a memory entry by key.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key to delete.' },
      },
      required: ['key'],
    },
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

function safeJson(str, fallback = []) {
  try { return JSON.parse(str); } catch { return fallback; }
}

/**
 * Strip expired entries — called opportunistically on read/search, not blocking.
 * @param {D1Database} db
 * @param {string} tenantId
 * @param {string} userId
 */
async function sweepExpired(db, tenantId, userId) {
  const now = nowUnix();
  await db
    .prepare(
      `DELETE FROM agentsam_memory
       WHERE tenant_id = ? AND user_id = ? AND expires_at IS NOT NULL AND expires_at < ?`
    )
    .bind(tenantId, userId, now)
    .run()
    .catch(() => null); // non-blocking; ignore errors
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * memory_write — compatibility adapter → canonical agentsam_memory_commit (+ outbox).
 * Prefer agentsam_memory_commit / agentsam_memory_save in new call sites.
 */
export async function memoryWrite(input, env, context = {}) {
  const { tenantId, userId, workspaceId, agentId, sessionId } = context;
  if (!tenantId || !userId) {
    return { error: 'memory_write requires tenantId and userId in context' };
  }

  const resolved = resolveManagedMemoryType(input);
  const key = input.key ?? input.memory_key ?? input.memoryKey;
  const value = input.value ?? input.content ?? input.body;
  if (!key || !value) {
    return { error: 'key and value required' };
  }

  const expiresAt =
    input.ttl_days != null
      ? nowUnix() + Math.round(Number(input.ttl_days) * 86400)
      : input.expires_at ?? null;

  const { executeAgentsamMemoryCommit } = await import('../../../../src/core/agentsam-memory-commit.js');
  const out = await executeAgentsamMemoryCommit(
    env,
    env.DB,
    {
      tenant_id: tenantId,
      user_id: userId,
      workspace_id: workspaceId || undefined,
    },
    {
      ...input,
      memory_key: key,
      key,
      content: value,
      value,
      memory_type: resolved.memory_type,
      tags: normalizeMemoryTags(resolved.tags.length ? resolved.tags : input.tags),
      source: input.source ?? 'agent',
      source_client: input.source_client ?? 'dashboard',
      expires_at: expiresAt,
      agent_id: agentId,
      session_id: sessionId,
    },
    { eager: input.eager !== false },
  );

  let body = null;
  try {
    body = JSON.parse(out?.content?.[0]?.text || '{}');
  } catch {
    return { error: 'unparseable_commit_response', raw: out };
  }
  if (body?.ok === false) {
    return { error: body.error || 'commit_failed', ...body };
  }
  return {
    ok: true,
    key: body.memory_key || key,
    memory_id: body.memory_id,
    revision: body.revision,
    memory_type: resolved.memory_type,
    expires_at: expiresAt,
    sync_key: `${tenantId}:${userId}:${key}`,
    outbox_id: body.outbox_id,
    projection_status: body.projection_status,
    semantic_ready: body.semantic_ready,
    private_mirror: { ok: true, scheduled: false, via: 'canonical_outbox' },
    canonical: true,
  };
}

/**
 * memory_read — fetch entries by key, bump recall stats.
 */
export async function memoryRead(input, env, context = {}) {
  const { tenantId, userId } = context;
  if (!tenantId || !userId) {
    return { error: 'memory_read requires tenantId and userId in context' };
  }

  const requestedKeys = input.keys;
  if (!Array.isArray(requestedKeys) || requestedKeys.length === 0) {
    return { error: 'keys must be a non-empty array' };
  }
  const keys = requestedKeys.map(String).filter(Boolean).slice(0, 10);

  // Sweep expired first (fire-and-forget)
  sweepExpired(env.DB, tenantId, userId);

  const now = nowUnix();
  const activeSql = await agentsamMemoryActiveSqlOrEmpty(env.DB);
  const placeholders = keys.map(() => '?').join(', ');
  const rows = await env.DB
    .prepare(
      `SELECT id, key, substr(value, 1, 4000) AS value, memory_type, source, confidence, decay_score,
              recall_count, last_recalled_at, expires_at, tags, created_at, updated_at,
              is_resolved, resolved_at
       FROM agentsam_memory
       WHERE tenant_id = ? AND user_id = ? AND key IN (${placeholders})
         AND ${activeSql}
         AND (expires_at IS NULL OR expires_at > ?)`
    )
    .bind(tenantId, userId, ...keys, now)
    .all();

  const found = rows.results ?? [];

  // Bump recall stats (no await — non-blocking)
  if (found.length > 0) {
    const ids = found.map(r => r.id);
    const idPlaceholders = ids.map(() => '?').join(', ');
    env.DB.prepare(
      `UPDATE agentsam_memory
       SET recall_count = recall_count + 1, last_recalled_at = ?
       WHERE id IN (${idPlaceholders})`
    )
      .bind(now, ...ids)
      .run()
      .catch(() => null);
  }

  return {
    found: found.map(r => ({
      key: r.key,
      value: r.value,
      memory_type: r.memory_type,
      source: r.source,
      confidence: r.confidence,
      tags: safeJson(r.tags, []),
      recall_count: r.recall_count,
      created_at: r.created_at,
      updated_at: r.updated_at,
    })),
    missing: keys.filter(k => !found.some(r => r.key === k)),
  };
}

/**
 * memory_search — compatibility adapter → canonical hybrid recall.
 */
export async function memorySearch(input, env, context = {}) {
  const { tenantId, userId, workspaceId } = context;
  if (!tenantId || !userId) {
    return { error: 'memory_search requires tenantId and userId in context' };
  }

  sweepExpired(env.DB, tenantId, userId);

  const { executeAgentsamMemoryHybridSearch } = await import(
    '../../../../src/core/agentsam-memory-hybrid-search.js'
  );
  const out = await executeAgentsamMemoryHybridSearch(
    env,
    env.DB,
    {
      tenant_id: tenantId,
      user_id: userId,
      workspace_id: workspaceId || undefined,
    },
    {
      ...input,
      query: input.query ?? input.q ?? '',
      limit: Math.min(Math.max(Number(input.limit) || 10, 1), 20),
      source_client: input.source_client ?? 'dashboard',
    },
  );

  let body = null;
  try {
    body = JSON.parse(out?.content?.[0]?.text || '{}');
  } catch {
    return { error: 'unparseable_search_response', raw: out };
  }
  if (body?.ok === false) {
    return { error: body.error || 'search_failed', ...body };
  }

  const items = body.items || [];
  return {
    results: items.map((r) => ({
      key: r.memory_key,
      memory_id: r.memory_id,
      revision: r.revision,
      value: r.content,
      memory_type: r.memory_type,
      title: r.title,
      summary: r.summary,
      score: r.score,
      provenance: r.provenance,
      projection_status: r.projection_status,
    })),
    count: items.length,
    canonical: true,
    source_client: body.source_client,
    active_project_workspace_key: body.active_project_workspace_key,
  };
}

/**
 * memory_delete — hard delete a single entry by key.
 */
export async function memoryDelete(input, env, context = {}) {
  const { tenantId, userId } = context;
  if (!tenantId || !userId) {
    return { error: 'memory_delete requires tenantId and userId in context' };
  }

  const { key } = input;
  const result = await env.DB
    .prepare(
      `DELETE FROM agentsam_memory WHERE tenant_id = ? AND user_id = ? AND key = ?`
    )
    .bind(tenantId, userId, key)
    .run();

  return { ok: true, key, deleted: result.meta?.changes ?? 0 };
}

/**
 * memory_resolve — mark blocker/alert memory as closed (excluded from briefs).
 */
export async function memoryResolve(input, env, context = {}) {
  const { tenantId, userId } = context;
  if (!tenantId || !userId) {
    return { error: 'memory_resolve requires tenantId and userId in context' };
  }
  const out = await resolveAgentsamMemory(env, {
    tenantId,
    userId,
    key: input.key,
    keys: input.keys,
    id: input.id,
    resolvedBy: input.resolved_by ?? userId,
    note: input.note,
  });
  if (!out.ok) return { error: out.error, ...out };
  return out;
}

// ---------------------------------------------------------------------------
// Unified dispatch — plug into your existing tool router
// ---------------------------------------------------------------------------

export const handlers = {
  memory_write:  (input, env, ctx) => memoryWrite(input, env, ctx),
  memory_read:   (input, env, ctx) => memoryRead(input, env, ctx),
  memory_search: (input, env, ctx) => memorySearch(input, env, ctx),
  memory_delete: (input, env, ctx) => memoryDelete(input, env, ctx),
  memory_resolve: (input, env, ctx) => memoryResolve(input, env, ctx),
};
