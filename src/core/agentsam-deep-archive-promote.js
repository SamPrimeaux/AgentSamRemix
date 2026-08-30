/**
 * Wave 2: promote aged / superseded / ADR-class memory into deep_archive_oai3large_3072.
 * Supplement-only retrieval was retired with agent-chat-lane-context (shouldSupplementDeepArchive → always false).
 */
import { createAgentsamEmbedding } from './agentsam-vectorize.js';
import { contentHash, resolveSupabaseWorkspaceId, resolveRagLane } from '../../backend/rag/index.js';
import { isHyperdriveUsable, runHyperdriveQuery } from '../../backend/services/database/hyperdrive.js';

export const DEEP_ARCHIVE_AGE_DAYS = 90;
export const DEEP_ARCHIVE_EMBED_SPEC = Object.freeze({
  provider: 'openai',
  model: 'text-embedding-3-large',
  dimensions: 3072,
});

function vectorLiteral(embedding) {
  if (!Array.isArray(embedding) || !embedding.length) throw new Error('embedding required');
  return `[${embedding.join(',')}]`;
}

/**
 * @param {any} env
 * @param {{
 *   workspace_id_d1: string,
 *   title: string,
 *   content: string,
 *   source_type?: string,
 *   archive_tier?: string,
 *   source_ref?: string,
 *   source_path?: string,
 *   user_id?: string|null,
 *   metadata?: Record<string, unknown>,
 * }} entry
 */
export async function writeDeepArchiveLane(env, entry) {
  const d1WorkspaceId = String(entry?.workspace_id_d1 || '').trim();
  if (!d1WorkspaceId) throw new Error('writeDeepArchiveLane: workspace_id_d1 required');
  const content = String(entry?.content || '').trim();
  if (!content) throw new Error('writeDeepArchiveLane: content required');

  const workspaceId = await resolveSupabaseWorkspaceId(env, d1WorkspaceId);
  if (!workspaceId) return { ok: false, skipped: 'workspace_unresolved' };

  const sourceRef = String(entry?.source_ref || '').trim() || `deep:${await contentHash(content)}`;
  const sourceType = String(entry?.source_type || 'deep_archive').trim() || 'deep_archive';
  const archiveTier = String(entry?.archive_tier || 'standard').trim() || 'standard';
  const title = String(entry?.title || sourceRef).trim();
  const hash = await contentHash(content);
  const table = (await resolveRagLane(env, 'archive')).tableName;

  const existing = await runHyperdriveQuery(
    env,
    `SELECT id, content_hash FROM agentsam.${table}
      WHERE workspace_id = $1::uuid AND source_ref = $2 LIMIT 1`,
    [workspaceId, sourceRef],
  );
  const existingRow = existing?.rows?.[0] ?? null;
  if (existingRow?.content_hash && String(existingRow.content_hash) === hash) {
    return { ok: true, skipped: 'unchanged', id: String(existingRow.id) };
  }

  const { embedding, model } = await createAgentsamEmbedding(env, content, {
    spec: DEEP_ARCHIVE_EMBED_SPEC,
  });
  if (!Array.isArray(embedding) || embedding.length !== 3072) {
    throw new Error(`deep archive embed dims ${embedding?.length ?? 0}, expected 3072`);
  }

  const rowId = existingRow?.id != null ? String(existingRow.id) : crypto.randomUUID();
  const upsert = await runHyperdriveQuery(
    env,
    `INSERT INTO agentsam.${table} (
       id, workspace_id, user_id, title, content, content_hash,
       source_type, archive_tier, source_ref, source_path,
       embedding, embedding_model, embedding_dims, embedded_at, metadata, updated_at
     ) VALUES (
       $1::uuid, $2::uuid, $3, $4, $5, $6,
       $7, $8, $9, $10,
       $11::vector, $12, 3072, now(), $13::jsonb, now()
     )
     ON CONFLICT (workspace_id, source_ref) DO UPDATE SET
       title = EXCLUDED.title,
       content = EXCLUDED.content,
       content_hash = EXCLUDED.content_hash,
       source_type = EXCLUDED.source_type,
       archive_tier = EXCLUDED.archive_tier,
       source_path = EXCLUDED.source_path,
       embedding = EXCLUDED.embedding,
       embedding_model = EXCLUDED.embedding_model,
       embedding_dims = 3072,
       embedded_at = now(),
       metadata = EXCLUDED.metadata,
       updated_at = now()
     RETURNING id`,
    [
      rowId,
      workspaceId,
      entry?.user_id != null ? String(entry.user_id) : null,
      title,
      content,
      hash,
      sourceType,
      archiveTier,
      sourceRef,
      entry?.source_path != null ? String(entry.source_path) : null,
      vectorLiteral(embedding),
      model || DEEP_ARCHIVE_EMBED_SPEC.model,
      JSON.stringify(entry?.metadata && typeof entry.metadata === 'object' ? entry.metadata : {}),
    ],
  );
  if (!upsert?.ok) throw new Error(upsert?.error || 'deep archive upsert failed');
  return { ok: true, id: String(upsert.rows?.[0]?.id ?? rowId), content_hash: hash };
}

/**
 * Promote eligible managed / memory-lane rows into deep archive.
 * Candidates: conversation_summary older than 90d, superseded_by set, decision_record tags.
 *
 * @param {any} env
 * @param {{ limit?: number, ageDays?: number }} [opts]
 */
export async function promoteEligibleMemoryToDeepArchive(env, opts = {}) {
  if (!isHyperdriveUsable(env)) {
    return { ok: false, reason: 'hyperdrive_unavailable', promoted: 0 };
  }

  const limit = Math.min(50, Math.max(1, Number(opts.limit) || 20));
  const ageDays = Math.max(30, Number(opts.ageDays) || DEEP_ARCHIVE_AGE_DAYS);

  const aged = await runHyperdriveQuery(
    env,
    `SELECT m.id::text AS id,
            m.workspace_id AS workspace_id,
            m.memory_key, m.title, m.content, m.source, m.memory_type,
            m.superseded_by IS NOT NULL AS is_superseded,
            m.created_at
       FROM agentsam.agentsam_memory m
      WHERE COALESCE(m.is_archived, false) = false
        AND (
          m.source = 'conversation_summary'
          OR m.memory_key LIKE 'conversation_summary:%'
          OR m.superseded_by IS NOT NULL
          OR COALESCE(m.memory_type, '') = 'decision'
        )
        AND m.created_at < now() - ($1::text || ' days')::interval
        AND COALESCE(m.content, '') <> ''
      ORDER BY m.created_at ASC
      LIMIT $2`,
    [String(ageDays), limit],
  );

  if (!aged.ok) {
    return { ok: false, reason: aged.error || 'select_failed', promoted: 0 };
  }

  const rows = aged.rows || [];
  let promoted = 0;
  const errors = [];

  for (const row of rows) {
    const content = String(row.content || '').trim();
    if (!content) continue;

    // Map PG workspace UUID → use as d1 key via reverse lookup of workspace_key, else pass UUID
    // (resolveSupabaseWorkspaceId accepts UUID passthrough).
    const workspaceKey = String(row.workspace_id || '').trim();
    const memoryKey = String(row.memory_key || row.id || '').trim();
    const sourceType =
      String(row.source || '') === 'conversation_summary' || memoryKey.startsWith('conversation_summary:')
        ? 'deep_archive'
        : row.is_superseded
          ? 'other'
          : 'decision_record';
    const archiveTier = sourceType === 'decision_record' ? 'architecture' : 'standard';

    try {
      const out = await writeDeepArchiveLane(env, {
        workspace_id_d1: workspaceKey,
        title: String(row.title || memoryKey).slice(0, 200),
        content,
        source_type: sourceType,
        archive_tier: archiveTier,
        source_ref: `memory:${memoryKey}`,
        source_path: `agentsam_memory/${memoryKey}`,
        user_id: null,
        metadata: {
          promoted_from: 'agentsam_memory',
          memory_id: row.id,
          memory_key: memoryKey,
          age_days: ageDays,
          was_superseded: Boolean(row.is_superseded),
        },
      });
      if (out?.ok) {
        promoted += 1;
        if (row.is_superseded) {
          await runHyperdriveQuery(
            env,
            `UPDATE agentsam.agentsam_memory
                SET is_archived = true, updated_at = now()
              WHERE id = $1::uuid`,
            [row.id],
          ).catch(() => {});
        }
      }
    } catch (e) {
      errors.push({ memory_key: memoryKey, error: String(e?.message || e) });
    }
  }

  return { ok: true, candidates: rows.length, promoted, errors: errors.slice(0, 10) };
}
