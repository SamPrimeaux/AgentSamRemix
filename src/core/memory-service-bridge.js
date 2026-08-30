/**
 * Worker bridge: agentsam_memory commit/outbox ↔ backend/services/memory.
 * Keeps embedding provider + pgvector details out of dashboard and tool handlers.
 */
import { buildRetrievalText } from './agentsam-memory-contract.js';
import { createMemoryServiceFromEnv } from '../../backend/services/memory/memory-runtime.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function mapImportance(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  if (n <= 1) return Math.max(0, Math.min(1, n));
  return Math.max(0, Math.min(1, n / 10));
}

/**
 * Write semantic pgvector row using the D1-selected memory embedding space.
 * @param {Record<string, unknown>} env
 * @param {Record<string, unknown>} row
 * @param {string} [retrievalText]
 */
export async function upsertSemanticMemoryFromCommit(env, row, retrievalText) {
  const workspaceId = trim(row.workspace_id);
  const memoryId = trim(row.memory_id);
  if (!workspaceId || !memoryId) {
    throw new Error('memory_projection_identity_required');
  }

  const content = trim(retrievalText) || trim(row.value);
  if (!content) throw new Error('memory_content_required');

  const service = await createMemoryServiceFromEnv(env, {
    userId: row.user_id,
    tenantId: row.tenant_id,
    idFactory: () => memoryId,
  });

  const metadata = {
    memory_key: row.key,
    memory_id: memoryId,
    revision: Number(row.revision) || 1,
    content_hash: row.content_hash,
    d1_row_id: row.id,
    tenant_id: row.tenant_id,
    user_id: row.user_id,
  };

  const existing = await service.get({ id: memoryId, workspaceId });
  const base = {
    workspaceId,
    content,
    memoryType: row.memory_type || 'fact',
    subjectId: row.user_id,
    tenantId: row.tenant_id,
    sourceType: row.source_type || 'memory_commit',
    sourceId: `${memoryId}:r${Number(row.revision) || 1}`,
    metadata,
    importance: mapImportance(row.importance),
    confidence: 0.95,
  };

  if (existing) {
    return service.update({
      id: memoryId,
      workspaceId,
      patch: {
        content: base.content,
        memoryType: base.memoryType,
        subjectId: base.subjectId,
        tenantId: base.tenantId,
        sourceType: base.sourceType,
        sourceId: base.sourceId,
        metadata: base.metadata,
        importance: base.importance,
        confidence: base.confidence,
      },
    });
  }

  return service.remember(base);
}

/**
 * Semantic search via the D1-selected MemoryService lane.
 * @param {Record<string, unknown>} env
 * @param {{ workspaceId: string, query: string, limit?: number, subjectId?: string|null, minConfidence?: number }} input
 */
export async function searchSemanticMemory(env, input) {
  const service = await createMemoryServiceFromEnv(env, {
    userId: input.subjectId ?? null,
    tenantId: input.tenantId ?? null,
  });
  return service.search(input);
}

/**
 * Build embed text the same way the outbox does.
 * @param {Record<string, unknown>} row
 */
export function commitRowRetrievalText(row, tags = []) {
  return buildRetrievalText({
    title: row.title,
    memory_type: row.memory_type,
    scope_type: row.scope_type,
    scope_id: row.scope_id,
    summary: row.summary,
    content: row.value,
    tags,
    memory_key: row.key,
  });
}
