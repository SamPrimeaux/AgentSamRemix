/** Embed compaction summaries into the D1-resolved memory embedding space. */
import { resolveMemoryEmbeddingLaneConfig } from '../../rag/embeddings/memory-route.js';
import { embedTextWithSpec } from '../../rag/embeddings/provider.js';
import { runHyperdriveQuery } from '../database/hyperdrive.js';
import { sha256Hex } from './hash.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function requireQualifiedTable(value) {
  const table = String(value || '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    throw new Error('memory_pgvector_table_required');
  }
  return table;
}

export async function embedCompactionDigestSummary(env, p) {
  const workspaceId = trim(p.workspaceId);
  const conversationId = trim(p.conversationId);
  const content = trim(p.summaryText);
  if (!env || !workspaceId || !conversationId || !content) {
    return { ok: false, reason: 'missing_fields' };
  }

  let route;
  try {
    route = await resolveMemoryEmbeddingLaneConfig(env);
  } catch (e) {
    return { ok: false, reason: 'embed_lane_unresolved', error: String(e?.message ?? e) };
  }

  const provider = trim(route.provider);
  const model = trim(route.modelKey || route.model);
  const dimensions = Number(route.dimensions);
  const table = requireQualifiedTable(route.pgvectorQualifiedTable);
  if (!provider || !model || !Number.isInteger(dimensions) || dimensions <= 0) {
    return { ok: false, reason: 'embed_lane_incomplete' };
  }

  const { embedding } = await embedTextWithSpec(
    env,
    content,
    { provider, model, dimensions },
    { userId: p.userId ?? null, tenantId: p.tenantId ?? null },
  );

  const sourceHash = trim(p.sourceHash) || (await sha256Hex(content));
  const memoryKey = `context_digest/${conversationId}/${sourceHash.slice(0, 16)}`;
  const nowUnix = Math.floor(Date.now() / 1000);
  const rowId = `memcd_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const vectorLiteral = `[${embedding.join(',')}]`;
  const metadata = {
    source_type: 'context_digest',
    digest_id: trim(p.digestId) || null,
    conversation_id: conversationId,
    r2_key: trim(p.r2Key) || null,
    workspace_id_d1: workspaceId,
    user_id: trim(p.userId) || null,
    tenant_id: trim(p.tenantId) || null,
    routing_arm_id: route.armId || null,
    embedding_space_key: route.embeddingSpaceKey || null,
  };

  const write = await runHyperdriveQuery(
    env,
    `INSERT INTO ${table} (
       id, workspace_id, subject_id, tenant_id, memory_type, content, content_hash,
       embedding, embedding_model, embedding_dimensions,
       importance, confidence, source_type, source_id, metadata,
       is_active, created_at_unix, updated_at_unix, embedded_at_unix
     ) VALUES (
       $1, $2, $3, $4, 'context_digest', $5, $6,
       $7::vector(${dimensions}), $8, $9,
       0.7, 0.85, 'conversation_compaction', $10, $11::jsonb,
       TRUE, $12, $12, $12
     )
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [
      rowId,
      workspaceId,
      trim(p.userId) || null,
      trim(p.tenantId) || null,
      content.slice(0, 8000),
      sourceHash,
      vectorLiteral,
      model,
      dimensions,
      trim(p.digestId) || conversationId,
      JSON.stringify(metadata),
      nowUnix,
    ],
  );

  if (!write?.ok) {
    return { ok: false, reason: 'pgvector_insert_failed', error: write?.error || 'insert_failed' };
  }

  return {
    ok: true,
    memory_key: memoryKey,
    memory_id: String(write.rows?.[0]?.id ?? rowId),
    embedding_model: model,
    embedding_dimensions: dimensions,
    provider,
    routing_arm_id: route.armId || null,
    embedding_space_key: route.embeddingSpaceKey || null,
    pgvector_table: table,
  };
}
