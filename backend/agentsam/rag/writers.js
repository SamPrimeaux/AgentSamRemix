/**
 * RAG write adapters. Persistence remains owned by the memory and knowledge
 * services; this module only translates lane-facing input.
 */
import { createMemoryServiceFromEnv } from '../../services/memory/index.js';
import {
  ensureSupabaseWorkspaceId,
  isSupabaseWorkspaceUuid,
} from './workspace-resolver.js';

export async function writeMemoryLane(env, params = {}, options = {}) {
  const d1WorkspaceId = String(params.workspace_id ?? params.workspace_id_d1 ?? '').trim();
  if (!d1WorkspaceId) throw new Error('writeMemoryLane: workspace_id required');
  const content = String(params.content ?? '').trim();
  if (!content) throw new Error('writeMemoryLane: content required');

  const workspaceId = isSupabaseWorkspaceUuid(d1WorkspaceId)
    ? d1WorkspaceId
    : await ensureSupabaseWorkspaceId(env, d1WorkspaceId);
  const service =
    options.service ||
    (await createMemoryServiceFromEnv(env, {
      userId: params.user_id ?? null,
    }));
  const row = await service.remember({
    workspaceId,
    content,
    memoryType: params.memory_type ?? params.memory_key ?? 'fact',
    subjectId: params.subject_id ?? null,
    agentId: params.agent_id ?? null,
    tenantId: params.tenant_id ?? null,
    importance: params.importance,
    confidence: params.confidence,
    sourceType: params.source_type ?? params.source ?? null,
    sourceId: params.source_id ?? params.memory_key ?? null,
    metadata: params.metadata ?? {},
    expiresAtUnix: params.expires_at_unix ?? null,
  });
  return {
    ok: true,
    id: row?.id ?? null,
    memory_key: params.memory_key ?? null,
    row,
  };
}
