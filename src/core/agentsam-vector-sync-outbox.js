/**
 * Wave 2: enqueue + drain agentsam_vector_sync_outbox (pgvector SSOT → Vectorize).
 */
import { isHyperdriveUsable, runHyperdriveQuery } from '../../backend/services/database/hyperdrive.js';
import { createAgentsamEmbedding } from './agentsam-vectorize.js';
import { resolveVectorizeBindingForTable } from '../../backend/agentsam/rag/index.js';

/**
 * @param {any} env
 * @param {{
 *   workspaceId?: string|null,
 *   sourceTable: string,
 *   sourceId: string,
 *   vectorIndex: string,
 *   operation?: 'upsert'|'delete',
 *   contentHash?: string|null,
 *   embeddingModel?: string,
 *   embeddingDims?: number,
 * }} row
 */
export async function enqueueVectorSyncOutbox(env, row) {
  if (!isHyperdriveUsable(env)) return { ok: false, reason: 'hyperdrive_unavailable' };
  const sourceTable = String(row?.sourceTable || '').trim();
  const sourceId = String(row?.sourceId || '').trim();
  const vectorIndex = String(row?.vectorIndex || '').trim();
  if (!sourceTable || !sourceId || !vectorIndex) {
    return { ok: false, reason: 'missing_fields' };
  }
  const operation = row.operation === 'delete' ? 'delete' : 'upsert';
  const out = await runHyperdriveQuery(
    env,
    `INSERT INTO agentsam.agentsam_vector_sync_outbox (
       workspace_id, source_table, source_id, vector_index, operation,
       content_hash, embedding_model, embedding_dims, status, next_attempt_at
     ) VALUES (
       $1::uuid, $2, $3, $4, $5,
       $6, $7, $8, 'pending', now()
     )
     ON CONFLICT (source_table, source_id, vector_index, operation) DO UPDATE SET
       content_hash = EXCLUDED.content_hash,
       status = 'pending',
       next_attempt_at = now(),
       last_error = NULL
     RETURNING id`,
    [
      row.workspaceId && /^[0-9a-f-]{36}$/i.test(String(row.workspaceId))
        ? String(row.workspaceId)
        : null,
      sourceTable,
      sourceId,
      vectorIndex,
      operation,
      row.contentHash != null ? String(row.contentHash) : null,
      row.embeddingModel || 'text-embedding-3-large',
      Number(row.embeddingDims) || 1536,
    ],
  );
  if (!out.ok) return { ok: false, error: out.error };
  return { ok: true, id: out.rows?.[0]?.id ?? null };
}

/**
 * Drain pending/failed outbox rows into Vectorize bindings.
 * @param {any} env
 * @param {{ limit?: number }} [opts]
 */
export async function drainVectorSyncOutbox(env, opts = {}) {
  if (!isHyperdriveUsable(env)) {
    return { ok: false, reason: 'hyperdrive_unavailable', drained: 0 };
  }
  const limit = Math.min(50, Math.max(1, Number(opts.limit) || 25));

  const pending = await runHyperdriveQuery(
    env,
    `SELECT id::text AS id, workspace_id::text AS workspace_id, source_table, source_id,
            vector_index, operation, embedding_dims, attempt_count
       FROM agentsam.agentsam_vector_sync_outbox
      WHERE status IN ('pending', 'failed')
        AND next_attempt_at <= now()
      ORDER BY created_at ASC
      LIMIT $1`,
    [limit],
  );
  if (!pending.ok) return { ok: false, reason: pending.error, drained: 0 };

  let drained = 0;
  let failed = 0;

  for (const item of pending.rows || []) {
    const bindingName =
      (await resolveVectorizeBindingForTable(env, item.source_table)) || item.vector_index;
    const binding = bindingName ? env?.[bindingName] : null;

    await runHyperdriveQuery(
      env,
      `UPDATE agentsam.agentsam_vector_sync_outbox
          SET status = 'syncing', attempt_count = attempt_count + 1
        WHERE id = $1::uuid`,
      [item.id],
    );

    try {
      if (item.operation === 'delete') {
        if (typeof binding?.deleteByIds === 'function') {
          await binding.deleteByIds([String(item.source_id)]);
        } else if (typeof binding?.delete === 'function') {
          await binding.delete([String(item.source_id)]);
        }
      } else {
        if (typeof binding?.upsert !== 'function') {
          throw new Error(`binding_unavailable:${bindingName || 'none'}`);
        }
        const isDocsTable = String(item.source_table) === 'agentsam_documents_oai3large_1536';
        const src = await runHyperdriveQuery(
          env,
          isDocsTable
            ? `SELECT id::text AS id, content, embedding::text AS embedding,
                      title, source_ref, source_type,
                      segment_id, source_snapshot_id, knowledge_object_id, projection_key
                 FROM agentsam.${item.source_table}
                WHERE id = $1::uuid LIMIT 1`
            : `SELECT id::text AS id, content, embedding::text AS embedding
                 FROM agentsam.${item.source_table}
                WHERE id = $1::uuid LIMIT 1`,
          [item.source_id],
        );
        const row = src.rows?.[0];
        if (!row) throw new Error('source_row_missing');

        let values = null;
        if (row.embedding && typeof row.embedding === 'string') {
          const raw = row.embedding.replace(/^\[|\]$/g, '');
          values = raw.split(',').map((n) => Number(n.trim())).filter((n) => Number.isFinite(n));
        }
        if (!values?.length && row.content) {
          const { embedding } = await createAgentsamEmbedding(env, String(row.content), {
            spec: {
              provider: 'openai',
              model: 'text-embedding-3-large',
              dimensions: Number(item.embedding_dims) || 1536,
            },
          });
          values = embedding;
        }
        if (!values?.length) throw new Error('no_embedding');

        const meta = {
          source_table: item.source_table,
          workspace_id: item.workspace_id,
        };
        if (row.source_ref) meta.source_ref = String(row.source_ref);
        if (row.title) meta.title = String(row.title).slice(0, 200);
        if (row.source_type) meta.source_type = String(row.source_type);
        if (row.segment_id) meta.segment_id = String(row.segment_id);
        if (row.source_snapshot_id) meta.source_snapshot_id = String(row.source_snapshot_id);
        if (row.knowledge_object_id) meta.knowledge_object_id = String(row.knowledge_object_id);
        if (row.projection_key) meta.projection_key = String(row.projection_key);

        await binding.upsert([
          {
            id: String(row.id || item.source_id),
            values,
            metadata: meta,
          },
        ]);
      }

      await runHyperdriveQuery(
        env,
        `UPDATE agentsam.agentsam_vector_sync_outbox
            SET status = 'synced', synced_at = now(), last_error = NULL
          WHERE id = $1::uuid`,
        [item.id],
      );
      drained += 1;
    } catch (e) {
      failed += 1;
      const attempts = Number(item.attempt_count) + 1;
      const dead = attempts >= 8;
      await runHyperdriveQuery(
        env,
        `UPDATE agentsam.agentsam_vector_sync_outbox
            SET status = $2,
                last_error = $3,
                next_attempt_at = now() + (($4::text || ' minutes')::interval)
          WHERE id = $1::uuid`,
        [
          item.id,
          dead ? 'dead' : 'failed',
          String(e?.message || e).slice(0, 500),
          String(Math.min(60, 2 ** Math.min(attempts, 5))),
        ],
      );
    }
  }

  return { ok: true, drained, failed, scanned: (pending.rows || []).length };
}
