/**
 * Drain agentsam_knowledge_projection_outbox.
 * Does NOT upsert Vectorize itself — enqueues agentsam.agentsam_vector_sync_outbox (ADR).
 */

import { enqueueVectorSyncOutbox } from '../agentsam-vector-sync-outbox.js';
import { resolveRagLane, resolveSupabaseWorkspaceId } from '../../../backend/rag/index.js';

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

function parseJson(raw, fallback) {
  if (raw == null) return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

/**
 * @param {any} env
 * @param {{ limit?: number }} [opts]
 */
export async function drainKnowledgeProjectionOutbox(env, opts = {}) {
  if (!env?.DB || typeof env.DB.prepare !== 'function') {
    return { ok: false, reason: 'd1_unavailable', drained: 0 };
  }

  const limit = Math.min(50, Math.max(1, Number(opts.limit) || 25));
  const now = nowUnix();
  const pending = await env.DB.prepare(
    `SELECT id, run_id, object_id, segment_id, workspace_id, content_hash, operation,
            desired_projections_json, status, attempts, receipts_json,
            projection_id, projection_key, lane
       FROM agentsam_knowledge_projection_outbox
      WHERE status IN ('pending', 'partial', 'failed')
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      ORDER BY created_at ASC
      LIMIT ?`,
  )
    .bind(now, limit)
    .all();

  const rows = pending?.results || [];
  let drained = 0;
  let failed = 0;

  for (const item of rows) {
    const id = String(item.id);
    await env.DB.prepare(
      `UPDATE agentsam_knowledge_projection_outbox
          SET status = 'processing', attempts = attempts + 1, locked_at = ?, updated_at = ?
        WHERE id = ?`,
    )
      .bind(now, now, id)
      .run();

    try {
      const desired = parseJson(item.desired_projections_json, []);
      const receipts = parseJson(item.receipts_json, {});
      const laneName = String(item.lane || 'docs').trim();
      const lane = await resolveRagLane(env, laneName === 'documents' ? 'docs' : laneName);
      const projectionId = String(item.projection_id || '').trim();
      if (!projectionId) throw new Error('projection_id_missing');

      const workspaceUuid = await resolveSupabaseWorkspaceId(env, String(item.workspace_id));
      const wantsVectorize = desired.some((d) => String(d).startsWith('vectorize:'));
      const vectorizeReceipt = receipts['vectorize:documents'] || receipts[`vectorize:${laneName}`];
      const pgReceipt = receipts['pgvector:docs'] || receipts[`pgvector:${laneName}`];

      if (!pgReceipt?.ok) {
        receipts[`pgvector:${laneName === 'docs' ? 'docs' : laneName}`] = {
          ok: true,
          projection_id: projectionId,
          assumed: true,
          at: now,
        };
      }

      if (wantsVectorize && lane.vectorizeBinding?.bindingName && !vectorizeReceipt?.ok) {
        const enq = await enqueueVectorSyncOutbox(env, {
          workspaceId: workspaceUuid,
          sourceTable: lane.tableName,
          sourceId: projectionId,
          vectorIndex: lane.vectorizeBinding.bindingName,
          operation: item.operation === 'delete' ? 'delete' : 'upsert',
          contentHash: item.content_hash,
          embeddingDims: lane.dimensions,
        });
        if (!enq?.ok) throw new Error(enq?.error || enq?.reason || 'vector_sync_enqueue_failed');
        receipts[`vectorize:${laneName === 'docs' ? 'documents' : laneName}`] = {
          ok: true,
          outbox_enqueued: true,
          vector_sync_id: enq.id || null,
          at: now,
        };
        receipts.vector_sync_enqueued = { ok: true, id: enq.id || null, at: now };
      }

      const allDesiredMet = desired.every((key) => {
        const k = String(key);
        if (receipts[k]?.ok) return true;
        // docs aliases
        if (k === 'pgvector:docs' && (receipts['pgvector:docs']?.ok || receipts['pgvector:docs']))
          return !!receipts['pgvector:docs']?.ok;
        if (k === 'vectorize:documents' && receipts['vectorize:documents']?.ok) return true;
        return false;
      });

      const status = allDesiredMet ? 'completed' : 'partial';
      await env.DB.prepare(
        `UPDATE agentsam_knowledge_projection_outbox SET
           status = ?, receipts_json = ?, last_error = NULL, locked_at = NULL, updated_at = ?
         WHERE id = ?`,
      )
        .bind(status, JSON.stringify(receipts), now, id)
        .run();
      drained += 1;
    } catch (e) {
      failed += 1;
      const attempts = Number(item.attempts || 0) + 1;
      const dead = attempts >= 8;
      await env.DB.prepare(
        `UPDATE agentsam_knowledge_projection_outbox SET
           status = ?,
           last_error = ?,
           next_attempt_at = ?,
           locked_at = NULL,
           updated_at = ?
         WHERE id = ?`,
      )
        .bind(
          dead ? 'failed' : 'failed',
          String(e?.message || e).slice(0, 500),
          now + Math.min(3600, 2 ** Math.min(attempts, 5) * 60),
          now,
          id,
        )
        .run();
    }
  }

  return { ok: true, drained, failed, scanned: rows.length };
}
