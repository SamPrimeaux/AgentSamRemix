/**
 * Memory projection outbox — idempotent managed_pg + pgvector_chunk.
 * Marks ready only when all desired projections verify same memory_id/revision/content_hash.
 */
import {
  EMBEDDING_CONTRACT,
  DESIRED_PROJECTIONS,
  buildProjectionKey,
  buildRetrievalText,
  uuidFromProjectionKey,
} from './agentsam-memory-contract.js';
import { createAgentsamEmbedding } from './agentsam-vectorize.js';
import { isHyperdriveUsable, runHyperdriveQuery } from '../../backend/services/database/hyperdrive.js';
import { ensureSupabaseWorkspaceId } from '../../backend/rag/index.js';
import { resolveMemoryEmbeddingLaneConfig } from './memory-embedding-lane-resolve.js';

/** Hard cap — permanent failures (canonical_row_missing) dead-letter immediately. */
export const MEMORY_OUTBOX_MAX_ATTEMPTS = 8;

const PERMANENT_OUTBOX_ERRORS = new Set(['canonical_row_missing', 'outbox_missing', 'projection_skipped']);

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function newReceiptId() {
  return `mrc_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function isDeadLetterError(err) {
  const e = trim(err);
  if (!e) return false;
  if (e.startsWith('dead_letter:')) return true;
  const bare = e.replace(/^dead_letter:/, '');
  return PERMANENT_OUTBOX_ERRORS.has(bare);
}

/**
 * @param {any} env
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {string} outboxId
 * @param {{ retrieval_text?: string, row?: Record<string, unknown> }} [hint]
 */
export async function processMemoryOutboxJob(env, db, outboxId, hint = {}) {
  const now = Math.floor(Date.now() / 1000);
  const job = await db
    .prepare(`SELECT * FROM agentsam_memory_outbox WHERE id = ? LIMIT 1`)
    .bind(outboxId)
    .first();
  if (!job) return { status: 'failed', semantic_ready: false, failed: ['outbox_missing'], receipts: {} };

  if (trim(job.status) === 'completed') {
    return { status: 'completed', semantic_ready: true, failed: [], receipts: safeJson(job.receipts_json) };
  }
  if (isDeadLetterError(job.last_error) || Number(job.attempts) >= MEMORY_OUTBOX_MAX_ATTEMPTS) {
    await deadLetterJob(db, outboxId, job.last_error || 'max_attempts', now);
    return {
      status: 'failed',
      semantic_ready: false,
      failed: ['dead_letter'],
      receipts: safeJson(job.receipts_json),
    };
  }

  await db
    .prepare(
      `UPDATE agentsam_memory_outbox
          SET status = 'processing', locked_at = ?, attempts = attempts + 1, updated_at = ?
        WHERE id = ?`,
    )
    .bind(now, now, outboxId)
    .run();

  let row = hint.row || null;
  if (!row) {
    row = await db
      .prepare(
        `SELECT * FROM agentsam_memory
          WHERE memory_id = ? AND revision = ? AND status = 'active'
          LIMIT 1`,
      )
      .bind(job.memory_id, job.revision)
      .first();
  }
  if (!row) {
    await deadLetterJob(db, outboxId, 'canonical_row_missing', now);
    return { status: 'failed', semantic_ready: false, failed: ['canonical_row_missing'], receipts: {} };
  }

  if (trim(row.status) === 'deleted' || trim(row.status) === 'archived' || trim(row.status) === 'superseded') {
    // Tombstone projections
    return tombstoneProjections(env, db, job, row, now);
  }

  if (trim(row.projection_status) === 'skipped') {
    await deadLetterJob(db, outboxId, 'projection_skipped', now);
    return { status: 'failed', semantic_ready: false, failed: ['projection_skipped'], receipts: {} };
  }

  const desired = parseDesired(job.desired_projections_json);
  const receipts = safeJson(job.receipts_json);
  const failed = [];
  const tags = parseTags(row.tags);
  const retrievalText =
    hint.retrieval_text ||
    buildRetrievalText({
      title: row.title,
      memory_type: row.memory_type,
      scope_type: row.scope_type,
      scope_id: row.scope_id,
      summary: row.summary,
      content: row.value,
      tags,
      memory_key: row.key,
    });

  // D1 is SSOT for which embed provider/model is live — agentsam_routing_arms
  // (task_type='memory_embed'), never a hardcoded JS constant. See
  // src/core/memory-embedding-lane-resolve.js and docs/platform/memory-embedding-gemini-lane-2026-08.md.
  let embedContract;
  try {
    embedContract = await resolveMemoryEmbeddingLaneConfig(env);
  } catch (e) {
    failed.push('embed');
    await markPartial(db, job, row, receipts, failed, e?.message || 'lane_config_unresolved', now);
    return { status: 'partial', semantic_ready: false, failed, receipts, error: e?.message };
  }

  const projectionKey = buildProjectionKey({
    memory_id: row.memory_id,
    revision: row.revision,
    chunk_index: 0,
    embedding_version: embedContract.version,
  });
  const remoteUuid = await uuidFromProjectionKey(projectionKey);

  let embedding = null;
  const needsOpenAiEmbed =
    desired.includes('pgvector_chunk') && embedContract.provider !== 'google';
  if (needsOpenAiEmbed) {
    try {
      const emb = await createAgentsamEmbedding(env, retrievalText, {
        spec: {
          provider: 'openai',
          model: embedContract.model,
          dimensions: embedContract.dimensions,
        },
      });
      embedding = emb.embedding;
    } catch (e) {
      failed.push('embed');
      await markPartial(db, job, row, receipts, failed, e?.message || 'embed_failed', now);
      return { status: 'partial', semantic_ready: false, failed, receipts, error: e?.message };
    }
  }

  // pgvector_chunk twin availability is D1-driven (embedContract.pgvectorAvailable).
  // Provider-specific writers run below in the pgvector_chunk block.

  if (desired.includes('managed_pg')) {
    try {
      await upsertManagedPg(env, row, projectionKey, remoteUuid);
      receipts.managed_pg = {
        ok: true,
        projection_key: projectionKey,
        remote_id: remoteUuid,
        verified_at: now,
      };
      await writeReceipt(db, row, projectionKey, 'managed_pg', remoteUuid, now);
    } catch (e) {
      failed.push('managed_pg');
      receipts.managed_pg = { ok: false, error: e?.message || String(e) };
    }
  }

  if (desired.includes('pgvector_chunk')) {
    if (embedContract.provider === 'google') {
      if (!embedContract.pgvectorAvailable) {
        receipts.pgvector_chunk = {
          ok: true,
          skipped: true,
          reason: 'gemini_pgvector_lane_not_registered',
        };
      } else {
        try {
          const { upsertSemanticMemoryFromCommit } = await import('./memory-service-bridge.js');
          const sem = await upsertSemanticMemoryFromCommit(env, row, retrievalText);
          receipts.pgvector_chunk = {
            ok: true,
            table: embedContract.pgvectorTable || 'agentsam_memory_gemini2_1536',
            projection_key: projectionKey,
            remote_id: sem?.id || row.memory_id,
            verified_at: now,
          };
          await writeReceipt(db, row, projectionKey, 'pgvector_chunk', sem?.id || remoteUuid, now);
        } catch (e) {
          failed.push('pgvector_chunk');
          receipts.pgvector_chunk = { ok: false, error: e?.message || String(e) };
        }
      }
    } else if (embedContract.pgvectorAvailable) {
      try {
        await upsertPgvectorChunk(env, row, projectionKey, remoteUuid, embedding, retrievalText, tags);
        receipts.pgvector_chunk = {
          ok: true,
          projection_key: projectionKey,
          remote_id: remoteUuid,
          verified_at: now,
        };
        await writeReceipt(db, row, projectionKey, 'pgvector_chunk', remoteUuid, now);
      } catch (e) {
        failed.push('pgvector_chunk');
        receipts.pgvector_chunk = { ok: false, error: e?.message || String(e) };
      }
    } else {
      receipts.pgvector_chunk = {
        ok: true,
        skipped: true,
        reason: 'no_active_pgvector_twin_for_resolved_model',
      };
    }
  }

  const allOk = desired.every((d) => receipts[d]?.ok === true);
  const status = allOk ? 'completed' : failed.length === desired.length ? 'failed' : 'partial';
  const projectionStatus = allOk ? 'ready' : status === 'failed' ? 'failed' : 'partial';
  const attemptsAfter = Number(job.attempts || 0) + 1;

  if (!allOk && (status === 'failed' || attemptsAfter >= MEMORY_OUTBOX_MAX_ATTEMPTS)) {
    await deadLetterJob(
      db,
      outboxId,
      failed.length ? failed.join(',') : job.last_error || 'max_attempts',
      now,
      JSON.stringify(receipts),
    );
    await db
      .prepare(
        `UPDATE agentsam_memory
            SET projection_status = ?,
                last_projection_error = ?,
                updated_at = ?
          WHERE memory_id = ? AND revision = ?`,
      )
      .bind(
        projectionStatus,
        failed.length ? failed.join(',').slice(0, 500) : null,
        now,
        row.memory_id,
        row.revision,
      )
      .run();
    return {
      status: 'failed',
      semantic_ready: false,
      failed: failed.length ? failed : ['dead_letter'],
      receipts,
      projection_key: projectionKey,
      remote_id: remoteUuid,
    };
  }

  await db
    .prepare(
      `UPDATE agentsam_memory_outbox
          SET status = ?, receipts_json = ?, last_error = ?, locked_at = NULL,
              next_attempt_at = ?, updated_at = ?
        WHERE id = ?`,
    )
    .bind(
      status,
      JSON.stringify(receipts),
      failed.length ? failed.join(',') : null,
      allOk ? null : now + Math.min(3600, 30 * Math.pow(2, attemptsAfter)),
      now,
      outboxId,
    )
    .run();

  await db
    .prepare(
      `UPDATE agentsam_memory
          SET projection_status = ?,
              projection_version = projection_version + 1,
              last_projection_error = ?,
              embedding_id = CASE WHEN ? = 1 THEN ? ELSE embedding_id END,
              updated_at = ?
        WHERE memory_id = ? AND revision = ?`,
    )
    .bind(
      projectionStatus,
      failed.length ? failed.join(',').slice(0, 500) : null,
      allOk ? 1 : 0,
      allOk ? remoteUuid : null,
      now,
      row.memory_id,
      row.revision,
    )
    .run();

  // Never set embedded_at merely because embedding was attempted.
  // Only set when managed_pg + pgvector_chunk confirmed (semantic ready).
  if (allOk) {
    await db
      .prepare(
        `UPDATE agentsam_memory
            SET embedded_at = ?
          WHERE memory_id = ? AND revision = ?`,
      )
      .bind(now, row.memory_id, row.revision)
      .run();
  }

  return {
    status: projectionStatus,
    semantic_ready: allOk,
    failed,
    receipts,
    projection_key: projectionKey,
    remote_id: remoteUuid,
  };
}

/**
 * Drain pending outbox jobs (cron).
 * Never retries terminal `failed` / dead-letter rows (was unbounded cost bleed).
 * @param {any} env
 * @param {{ limit?: number }} [opts]
 */
export async function drainMemoryProjectionOutbox(env, opts = {}) {
  const db = env?.DB;
  if (!db) return { ok: false, error: 'DB missing', processed: 0 };
  const limit = Math.min(40, Math.max(1, Number(opts.limit) || 20));
  const now = Math.floor(Date.now() / 1000);
  const { results } = await db
    .prepare(
      `SELECT id FROM agentsam_memory_outbox
        WHERE status IN ('pending','partial')
          AND attempts < ?
          AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
          AND (last_error IS NULL OR last_error NOT LIKE 'dead_letter:%')
        ORDER BY created_at ASC
        LIMIT ?`,
    )
    .bind(MEMORY_OUTBOX_MAX_ATTEMPTS, now, limit)
    .all();

  let processed = 0;
  let ready = 0;
  const errors = [];
  for (const r of results || []) {
    try {
      const out = await processMemoryOutboxJob(env, db, r.id);
      processed += 1;
      if (out.semantic_ready) ready += 1;
    } catch (e) {
      errors.push(e?.message || String(e));
    }
  }
  return { ok: true, processed, ready, errors: errors.slice(0, 10) };
}

function parseDesired(json) {
  try {
    const arr = JSON.parse(json || '[]');
    if (Array.isArray(arr) && arr.length) return arr;
  } catch {
    /* ignore */
  }
  return [...DESIRED_PROJECTIONS];
}

function safeJson(json) {
  try {
    return JSON.parse(json || '{}') || {};
  } catch {
    return {};
  }
}

function parseTags(tags) {
  if (Array.isArray(tags)) return tags;
  try {
    const p = JSON.parse(tags || '[]');
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

function vectorLiteral(embedding) {
  return `[${embedding.join(',')}]`;
}

async function writeReceipt(db, row, projectionKey, target, remoteId, now) {
  await db
    .prepare(
      `INSERT INTO agentsam_memory_projection_receipts (
         id, memory_id, revision, content_hash, projection_key, projection_target,
         status, remote_id, details_json, verified_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'ok', ?, '{}', ?, ?)
       ON CONFLICT(projection_key, projection_target) DO UPDATE SET
         status = 'ok',
         remote_id = excluded.remote_id,
         content_hash = excluded.content_hash,
         verified_at = excluded.verified_at`,
    )
    .bind(
      newReceiptId(),
      row.memory_id,
      row.revision,
      row.content_hash,
      projectionKey,
      target,
      remoteId,
      now,
      now,
    )
    .run();
}

async function deadLetterJob(db, outboxId, err, now, receiptsJson = null) {
  const bare = String(err || 'unknown').replace(/^dead_letter:/, '').slice(0, 480);
  const labeled = `dead_letter:${bare}`.slice(0, 500);
  if (receiptsJson != null) {
    await db
      .prepare(
        `UPDATE agentsam_memory_outbox
            SET status = 'failed', last_error = ?, receipts_json = ?,
                locked_at = NULL, next_attempt_at = NULL, updated_at = ?
          WHERE id = ?`,
      )
      .bind(labeled, receiptsJson, now, outboxId)
      .run();
    return;
  }
  await db
    .prepare(
      `UPDATE agentsam_memory_outbox
          SET status = 'failed', last_error = ?, locked_at = NULL,
              next_attempt_at = NULL, updated_at = ?
        WHERE id = ?`,
    )
    .bind(labeled, now, outboxId)
    .run();
}

/** @deprecated use deadLetterJob — kept name for any external callers */
async function failJob(db, outboxId, err, now) {
  await deadLetterJob(db, outboxId, err, now);
}

async function markPartial(db, job, row, receipts, failed, err, now) {
  await db
    .prepare(
      `UPDATE agentsam_memory_outbox
          SET status = 'partial', receipts_json = ?, last_error = ?, locked_at = NULL,
              next_attempt_at = ?, updated_at = ?
        WHERE id = ?`,
    )
    .bind(JSON.stringify(receipts), String(err).slice(0, 500), now + 60, now, job.id)
    .run();
  await db
    .prepare(
      `UPDATE agentsam_memory
          SET projection_status = 'partial', last_projection_error = ?, updated_at = ?
        WHERE memory_id = ? AND revision = ?`,
    )
    .bind(String(err).slice(0, 500), now, row.memory_id, row.revision)
    .run();
}

async function upsertManagedPg(env, row, projectionKey, remoteUuid) {
  if (!isHyperdriveUsable(env)) throw new Error('hyperdrive_unavailable');
  const tags = parseTags(row.tags);
  // Relational projection only — embedding NULL (chunk table owns vectors)
  const sql = `
    INSERT INTO agentsam.agentsam_memory (
      id, tenant_id, workspace_id, user_id, memory_type, memory_key,
      title, content, summary, tags, confidence, importance,
      is_pinned, is_archived, sync_key, d1_id, embedding, embedded_at,
      memory_id, revision, content_hash, status, sensitivity, projection_key,
      scope_type, scope_id, source, created_at, updated_at
    ) VALUES (
      $1::uuid, $2, $3, $4, $5, $6,
      $7, $8, $9, $10::text[], $11, $12,
      $13, false, $14, $15, NULL, NULL,
      $16, $17, $18, $19, $20, $21,
      $22, $23, $24, now(), now()
    )
    ON CONFLICT (tenant_id, user_id, memory_key) DO UPDATE SET
      title = EXCLUDED.title,
      content = EXCLUDED.content,
      summary = EXCLUDED.summary,
      tags = EXCLUDED.tags,
      importance = EXCLUDED.importance,
      is_pinned = EXCLUDED.is_pinned,
      sync_key = EXCLUDED.sync_key,
      d1_id = EXCLUDED.d1_id,
      embedding = NULL,
      memory_id = EXCLUDED.memory_id,
      revision = EXCLUDED.revision,
      content_hash = EXCLUDED.content_hash,
      status = EXCLUDED.status,
      sensitivity = EXCLUDED.sensitivity,
      projection_key = EXCLUDED.projection_key,
      scope_type = EXCLUDED.scope_type,
      scope_id = EXCLUDED.scope_id,
      updated_at = now()
  `;
  const write = await runHyperdriveQuery(env, sql, [
    remoteUuid,
    row.tenant_id,
    row.workspace_id,
    row.user_id,
    row.memory_type,
    row.key,
    row.title || row.key,
    row.value,
    row.summary || null,
    tags,
    1.0,
    Number(row.importance) || 5,
    Number(row.is_pinned) === 1,
    `${row.tenant_id}:${row.user_id}:${row.key}`,
    row.id,
    row.memory_id,
    Number(row.revision) || 1,
    row.content_hash,
    row.status || 'active',
    row.sensitivity || 'normal',
    projectionKey,
    row.scope_type || 'user',
    row.scope_id || row.user_id,
    row.source || 'agentsam_memory_commit',
  ]);
  if (!write?.ok) throw new Error(write?.error || 'managed_pg_upsert_failed');
}

async function upsertPgvectorChunk(env, row, projectionKey, remoteUuid, embedding, retrievalText, tags) {
  if (!isHyperdriveUsable(env)) throw new Error('hyperdrive_unavailable');
  if (!embedding) throw new Error('embedding_required');
  const d1Ws = trim(row.workspace_id);
  // Must be a live agentsam.agentsam_workspaces.id — resolve-only left orphan UUIDs
  // after the 2026-08 cutover and tripped agentsam_memory_workspace_id_fkey.
  if (!d1Ws) throw new Error('workspace_id_required');
  const supabaseWs = await ensureSupabaseWorkspaceId(env, d1Ws);
  const vec = vectorLiteral(embedding);
  const meta = {
    memory_id: row.memory_id,
    revision: Number(row.revision) || 1,
    content_hash: row.content_hash,
    tenant_key: row.tenant_id,
    user_key: row.user_id,
    workspace_key: d1Ws,
    memory_type: row.memory_type,
    status: row.status || 'active',
    sensitivity: row.sensitivity || 'normal',
    tags,
  };
  await runHyperdriveQuery(
    env,
    `DELETE FROM agentsam.agentsam_memory_oai3large_1536 WHERE projection_key = $1`,
    [projectionKey],
  );
  const sql = `
    INSERT INTO agentsam.agentsam_memory_oai3large_1536 (
      id, workspace_id, user_id, memory_key, content, title, embedding, source, metadata,
      vectorize_binding, vectorize_index, vectorize_id, embedded_at, source_type,
      projection_key, memory_id, revision, chunk_index, chunk_count, content_hash,
      tenant_key, user_key, workspace_key, memory_type, status, sensitivity,
      embedding_model, embedding_dimensions, embedding_version,
      created_at, updated_at
    ) VALUES (
      $1::uuid, $2::uuid, NULL, $3, $4, $5, $6::vector, $7, $8::jsonb,
      'AGENTSAM_VECTORIZE_MEMORY', 'agentsam-memory-oai3large-1536', $1::text, now(), $9,
      $10, $11, $12, 0, 1, $13,
      $14, $15, $16, $17, $18, $19,
      $20, $21, $22,
      now(), now()
    )
  `;
  const write = await runHyperdriveQuery(env, sql, [
    remoteUuid,
    supabaseWs,
    row.key,
    retrievalText,
    row.title || row.key,
    vec,
    row.source || 'agentsam_memory_commit',
    JSON.stringify(meta),
    row.source_type || 'memory_commit',
    projectionKey,
    row.memory_id,
    Number(row.revision) || 1,
    row.content_hash,
    row.tenant_id,
    row.user_id,
    d1Ws,
    row.memory_type,
    row.status || 'active',
    row.sensitivity || 'normal',
    EMBEDDING_CONTRACT.model,
    EMBEDDING_CONTRACT.dimensions,
    EMBEDDING_CONTRACT.version,
  ]);
  if (!write?.ok) throw new Error(write?.error || 'pgvector_upsert_failed');
}

async function upsertVectorize(env, row, remoteUuid, embedding, embedContract = EMBEDDING_CONTRACT) {
  if (!embedding) throw new Error('embedding_required');
  const bindingName = embedContract?.vectorizeBinding || 'AGENTSAM_VECTORIZE_MEMORY';
  const binding = env?.[bindingName];
  if (!binding || typeof binding.upsert !== 'function') {
    throw new Error(`${bindingName}_unavailable`);
  }
  await binding.upsert([
    {
      id: remoteUuid,
      values: embedding,
      metadata: {
        memory_id: String(row.memory_id),
        memory_key: String(row.key),
        revision: Number(row.revision) || 1,
        content_hash: String(row.content_hash || ''),
        tenant_key: String(row.tenant_id || ''),
        user_key: String(row.user_id || ''),
        workspace_key: String(row.workspace_id || ''),
        memory_type: String(row.memory_type || ''),
        status: String(row.status || 'active'),
        sensitivity: String(row.sensitivity || 'normal'),
        embedding_model: String(embedContract?.model || ''),
        embedding_provider: String(embedContract?.provider || ''),
      },
    },
  ]);
}

async function tombstoneProjections(env, db, job, row, now) {
  const projectionKey = buildProjectionKey({
    memory_id: row.memory_id,
    revision: row.revision,
    chunk_index: 0,
  });
  const remoteUuid = await uuidFromProjectionKey(projectionKey);
  const receipts = {};
  try {
    if (isHyperdriveUsable(env)) {
      await runHyperdriveQuery(
        env,
        `UPDATE agentsam.agentsam_memory SET status = $1, is_archived = true, updated_at = now()
          WHERE memory_id = $2 AND revision = $3`,
        [row.status, row.memory_id, row.revision],
      );
      await runHyperdriveQuery(
        env,
        `UPDATE agentsam.agentsam_memory_oai3large_1536 SET status = $1, updated_at = now()
          WHERE projection_key = $2`,
        [row.status, projectionKey],
      );
      await runHyperdriveQuery(
        env,
        `UPDATE agentsam.agentsam_memory_gemini2_1536 SET status = $1, updated_at = now()
          WHERE memory_id = $2 AND revision = $3`,
        [row.status, row.memory_id, row.revision],
      );
      receipts.managed_pg = { ok: true, tombstone: true };
      receipts.pgvector_chunk = { ok: true, tombstone: true };
    }
  } catch (e) {
    receipts.managed_pg = { ok: false, error: e?.message };
  }
  try {
    // Legacy OpenAI Vectorize tombstone only — Gemini lane never wrote Vectorize (pgvector SSOT).
    const binding = env?.AGENTSAM_VECTORIZE_MEMORY;
    if (binding?.deleteByIds) await binding.deleteByIds([remoteUuid]);
    else if (binding?.delete) await binding.delete([remoteUuid]);
    receipts.vectorize = { ok: true, tombstone: true };
  } catch (e) {
    receipts.vectorize = { ok: false, error: e?.message };
  }
  await db
    .prepare(
      `UPDATE agentsam_memory_outbox
          SET status = 'completed', receipts_json = ?, updated_at = ?, locked_at = NULL
        WHERE id = ?`,
    )
    .bind(JSON.stringify(receipts), now, job.id)
    .run();
  return { status: 'completed', semantic_ready: false, receipts, failed: [], tombstone: true };
}
