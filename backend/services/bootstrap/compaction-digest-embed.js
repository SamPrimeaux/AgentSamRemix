/**
 * Embed compaction summaries into the memory lane (D1-driven: gemini-embedding-2 @ 1536).
 * Links vectors back to agentsam_context_digest via memory_key + metadata.
 */
import { createAgentsamEmbedding } from '../../../src/core/agentsam-vectorize.js';
import { resolveMemoryEmbeddingLaneConfig } from '../../../src/core/memory-embedding-lane-resolve.js';
import { runHyperdriveQuery } from '../database/hyperdrive.js';
import { sha256Hex } from './hash.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @param {any} env
 * @param {{
 *   workspaceId: string,
 *   conversationId: string,
 *   summaryText: string,
 *   r2Key?: string|null,
 *   digestId?: string|null,
 *   sourceHash?: string|null,
 *   userId?: string|null,
 *   tenantId?: string|null,
 * }} p
 */
export async function embedCompactionDigestSummary(env, p) {
  const workspaceId = trim(p.workspaceId);
  const conversationId = trim(p.conversationId);
  const content = trim(p.summaryText);
  if (!env || !workspaceId || !conversationId || !content) {
    return { ok: false, reason: 'missing_fields' };
  }

  let embedContract;
  try {
    embedContract = await resolveMemoryEmbeddingLaneConfig(env);
  } catch (e) {
    return { ok: false, reason: 'embed_lane_unresolved', error: String(e?.message ?? e) };
  }

  const model = trim(embedContract.model) || 'gemini-embedding-2';
  const dimensions = Number(embedContract.dimensions) || 1536;
  const provider = trim(embedContract.provider) || 'google';

  const { embedding } = await createAgentsamEmbedding(env, content, {
    spec: { provider, model, dimensions },
  });

  const sourceHash =
    trim(p.sourceHash) || (await sha256Hex(content));
  const memoryKey = `context_digest/${conversationId}/${sourceHash.slice(0, 16)}`;
  const nowUnix = Math.floor(Date.now() / 1000);
  const rowId = `memcd_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const table =
    provider === 'google' && embedContract.pgvectorTable
      ? embedContract.pgvectorTable
      : 'agentsam_memory_gemini2_1536';

  const vectorLiteral = `[${embedding.join(',')}]`;
  const metadata = {
    source_type: 'context_digest',
    digest_id: trim(p.digestId) || null,
    conversation_id: conversationId,
    r2_key: trim(p.r2Key) || null,
    workspace_id_d1: workspaceId,
    user_id: trim(p.userId) || null,
    tenant_id: trim(p.tenantId) || null,
  };

  const write = await runHyperdriveQuery(
    env,
    `INSERT INTO agentsam.${table} (
       id, workspace_id, subject_id, tenant_id, memory_type, content, content_hash,
       embedding, embedding_model, embedding_dimensions,
       importance, confidence, source_type, source_id, metadata,
       is_active, created_at_unix, updated_at_unix, embedded_at_unix
     ) VALUES (
       $1, $2, $3, $4, 'context_digest', $5, $6,
       $7::vector, $8, $9,
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
    pgvector_table: table,
  };
}
