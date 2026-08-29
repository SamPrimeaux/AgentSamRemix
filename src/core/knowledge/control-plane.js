/**
 * D1 agentsam_knowledge_* control plane — runs / objects / work_items / projection_outbox.
 * Timestamps are INTEGER unixepoch seconds only.
 */

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

function newId(prefix) {
  const hex = crypto.randomUUID().replace(/-/g, '');
  return `${prefix}_${hex}`;
}

function hasDb(env) {
  return env?.DB && typeof env.DB.prepare === 'function';
}

/**
 * Desired projections for a lane (ADR: D1 outbox coordinates; Vectorize via Postgres outbox).
 * @param {string} lane
 */
export function desiredProjectionsForLane(lane) {
  const l = String(lane || '').trim();
  if (l === 'docs') return ['pgvector:docs', 'vectorize:documents'];
  if (l === 'media') return ['pgvector:media', 'vectorize:media'];
  if (l === 'code') return ['pgvector:code', 'vectorize:code'];
  if (l === 'schema') return ['pgvector:schema', 'vectorize:schema'];
  if (l === 'memory') return ['pgvector:memory', 'vectorize:memory'];
  if (l === 'archive') return ['pgvector:archive'];
  return [`pgvector:${l || 'docs'}`];
}

/**
 * Ensure run + object + work_item exist for an ingest_segment call.
 * @param {any} env
 * @param {Record<string, unknown>} input — validated ingest_segment input
 * @returns {Promise<{ ok: boolean, skipped?: boolean, runId?: string, objectId?: string, workItemId?: string, error?: string }>}
 */
export async function ensureKnowledgeControlPlane(env, input) {
  if (!hasDb(env)) return { ok: false, skipped: true, error: 'd1_unavailable' };

  const workspaceId = String(input.workspace_id_d1 || '').trim();
  const snapshotId = String(input.source_snapshot_id || '').trim();
  const objectIdIn = String(input.knowledge_object_id || '').trim();
  const segmentId = String(input.segment_id || '').trim();
  const lane = String(input.lane || 'docs').trim();
  const meta =
    input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
      ? /** @type {Record<string, unknown>} */ (input.metadata)
      : {};

  const now = nowUnix();
  const title = input.title != null ? String(input.title).trim() : null;
  const artifactKey =
    input.artifact_key != null
      ? String(input.artifact_key)
      : meta.object_key != null
        ? String(meta.object_key)
        : null;

  let runId = String(input.run_id || meta.run_id || '').trim();
  let objectId = objectIdIn;
  let workItemId = String(input.work_item_id || meta.work_item_id || '').trim();

  try {
    if (!runId) {
      // Prefer one run per snapshot (scale 198); callers may override via metadata.idempotency_key / run_id.
      const idem = String(
        meta.run_idempotency_key ||
          meta.idempotency_key ||
          `snap:${workspaceId}:${snapshotId}`,
      ).trim();
      const existing = await env.DB.prepare(
        `SELECT id FROM agentsam_knowledge_runs
          WHERE workspace_id = ? AND idempotency_key = ?
          LIMIT 1`,
      )
        .bind(workspaceId, idem)
        .first();
      if (existing?.id) {
        runId = String(existing.id);
      } else {
        runId = newId('run');
        await env.DB.prepare(
          `INSERT INTO agentsam_knowledge_runs (
             id, workspace_id, profile, routing_mode, requested_family,
             adapter_id, adapter_version, source_type, source_locator_json,
             source_snapshot_id, root_object_id, status, current_stage,
             security_disposition, objects_discovered, idempotency_key,
             created_at, started_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', 'projecting',
             'accepted', 1, ?, ?, ?, ?)`,
        )
          .bind(
            runId,
            workspaceId,
            String(meta.profile || 'balanced'),
            String(meta.routing_mode || 'auto'),
            lane === 'docs' ? 'document' : lane === 'media' ? 'visual' : 'technical',
            String(meta.adapter_id || 'docs-topic-adapter'),
            String(meta.adapter_version || meta.pipeline_version || 'v1'),
            String(meta.source_type || 'markdown'),
            JSON.stringify({
              kind: artifactKey ? 'r2' : 'inline',
              artifact_key: artifactKey,
              segment_id: segmentId,
            }),
            snapshotId,
            objectId,
            idem,
            now,
            now,
            now,
          )
          .run();
      }
    } else {
      await env.DB.prepare(
        `UPDATE agentsam_knowledge_runs
            SET status = CASE WHEN status IN ('completed','failed','cancelled') THEN status ELSE 'processing' END,
                current_stage = 'projecting',
                updated_at = ?
          WHERE id = ?`,
      )
        .bind(now, runId)
        .run();
    }

    const objExisting = await env.DB.prepare(
      `SELECT id FROM agentsam_knowledge_objects WHERE workspace_id = ? AND id = ? LIMIT 1`,
    )
      .bind(workspaceId, objectId)
      .first();
    if (!objExisting?.id) {
      await env.DB.prepare(
        `INSERT INTO agentsam_knowledge_objects (
           id, run_id, workspace_id, root_object_id, source_snapshot_id,
           family, object_type, title, source_locator_json,
           adapter_id, adapter_version, artifact_prefix, status, ordinal,
           segment_count, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'projecting', ?, 0, ?, ?)`,
      )
        .bind(
          objectId,
          runId,
          workspaceId,
          objectId,
          snapshotId,
          lane === 'docs' ? 'document' : lane === 'media' ? 'visual' : 'technical',
          String(meta.object_type || 'topic'),
          title,
          JSON.stringify({ artifact_key: artifactKey, segment_id: segmentId }),
          String(meta.adapter_id || 'docs-topic-adapter'),
          String(meta.adapter_version || meta.pipeline_version || 'v1'),
          artifactKey ? String(artifactKey).replace(/\/[^/]+$/, '') : null,
          Number.isInteger(Number(input.ordinal)) ? Number(input.ordinal) : 0,
          now,
          now,
        )
        .run();
      await env.DB.prepare(
        `UPDATE agentsam_knowledge_runs
            SET root_object_id = COALESCE(root_object_id, ?), updated_at = ?
          WHERE id = ?`,
      )
        .bind(objectId, now, runId)
        .run();
    } else {
      await env.DB.prepare(
        `UPDATE agentsam_knowledge_objects
            SET run_id = ?, status = 'projecting', title = COALESCE(?, title), updated_at = ?
          WHERE workspace_id = ? AND id = ?`,
      )
        .bind(runId, title, now, workspaceId, objectId)
        .run();
    }

    if (!workItemId) {
      workItemId = `work_${segmentId}`;
    }
    const workExisting = await env.DB.prepare(
      `SELECT id FROM agentsam_knowledge_work_items WHERE id = ? LIMIT 1`,
    )
      .bind(workItemId)
      .first();
    if (!workExisting?.id) {
      const pages = Array.isArray(input.grounding)
        ? input.grounding.find((g) => g && typeof g === 'object' && g.kind === 'pdf_page')
        : null;
      await env.DB.prepare(
        `INSERT INTO agentsam_knowledge_work_items (
           id, run_id, object_id, workspace_id, work_type, ordinal,
           range_start, range_end, input_artifact_key, status,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'segment', ?, ?, ?, ?, 'processing', ?, ?)`,
      )
        .bind(
          workItemId,
          runId,
          objectId,
          workspaceId,
          Number.isInteger(Number(input.ordinal)) ? Number(input.ordinal) : 0,
          pages?.pageStart != null ? Number(pages.pageStart) : null,
          pages?.pageEnd != null ? Number(pages.pageEnd) : null,
          artifactKey,
          now,
          now,
        )
        .run();
    } else {
      await env.DB.prepare(
        `UPDATE agentsam_knowledge_work_items
            SET status = 'processing', attempts = attempts + 1, updated_at = ?
          WHERE id = ?`,
      )
        .bind(now, workItemId)
        .run();
    }

    return { ok: true, runId, objectId, workItemId };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 400) };
  }
}

/**
 * Enqueue or refresh knowledge projection outbox after Supabase write.
 * @param {any} env
 * @param {{
 *   runId?: string|null,
 *   objectId?: string|null,
 *   segmentId: string,
 *   workspaceId: string,
 *   contentHash: string,
 *   projectionId: string,
 *   projectionKey: string,
 *   lane: string,
 *   receipts?: Record<string, unknown>,
 *   status?: string,
 * }} row
 */
export async function enqueueKnowledgeProjectionOutbox(env, row) {
  if (!hasDb(env)) return { ok: false, skipped: true, error: 'd1_unavailable' };

  const now = nowUnix();
  const id = newId('kpo');
  const desired = JSON.stringify(desiredProjectionsForLane(row.lane));
  const receipts = JSON.stringify(row.receipts && typeof row.receipts === 'object' ? row.receipts : {});
  const status = String(row.status || 'pending');

  try {
    const existing = await env.DB.prepare(
      `SELECT id, status, receipts_json FROM agentsam_knowledge_projection_outbox
        WHERE workspace_id = ? AND segment_id = ? AND content_hash = ? AND operation = 'upsert'
          AND status IN ('pending','processing','partial','completed')
        ORDER BY CASE status WHEN 'completed' THEN 0 WHEN 'partial' THEN 1 ELSE 2 END
        LIMIT 1`,
    )
      .bind(row.workspaceId, row.segmentId, row.contentHash)
      .first();

    if (existing?.id) {
      const prev =
        existing.receipts_json && typeof existing.receipts_json === 'string'
          ? JSON.parse(existing.receipts_json)
          : {};
      const merged = { ...prev, ...(row.receipts || {}) };
      const nextStatus =
        status === 'completed' || existing.status === 'completed' ? 'completed' : status;
      await env.DB.prepare(
        `UPDATE agentsam_knowledge_projection_outbox SET
           run_id = COALESCE(?, run_id),
           object_id = COALESCE(?, object_id),
           projection_id = ?,
           projection_key = ?,
           lane = ?,
           desired_projections_json = ?,
           receipts_json = ?,
           status = ?,
           last_error = NULL,
           updated_at = ?
         WHERE id = ?`,
      )
        .bind(
          row.runId || null,
          row.objectId || null,
          row.projectionId,
          row.projectionKey,
          row.lane,
          desired,
          JSON.stringify(merged),
          nextStatus,
          now,
          String(existing.id),
        )
        .run();
      return { ok: true, id: String(existing.id), updated: true, status: nextStatus };
    }

    await env.DB.prepare(
      `INSERT INTO agentsam_knowledge_projection_outbox (
         id, run_id, object_id, segment_id, workspace_id, content_hash, operation,
         desired_projections_json, status, attempts, next_attempt_at,
         receipts_json, projection_id, projection_key, lane, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'upsert', ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        row.runId || null,
        row.objectId || null,
        row.segmentId,
        row.workspaceId,
        row.contentHash,
        desired,
        status,
        now,
        receipts,
        row.projectionId,
        row.projectionKey,
        row.lane,
        now,
        now,
      )
      .run();
    return { ok: true, id, updated: false, status };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 400) };
  }
}

/**
 * Bump run/object/work counters after a successful projection write.
 * @param {any} env
 * @param {{
 *   runId: string,
 *   objectId: string,
 *   workItemId?: string|null,
 *   projectionReady?: boolean,
 *   projectionFailed?: boolean,
 *   skipped?: boolean,
 * }} opts
 */
export async function bumpKnowledgeCounters(env, opts) {
  if (!hasDb(env)) return { ok: false, skipped: true, error: 'd1_unavailable' };
  const now = nowUnix();
  const runId = String(opts.runId || '').trim();
  const objectId = String(opts.objectId || '').trim();
  if (!runId || !objectId) return { ok: false, error: 'missing_ids' };

  try {
    const segInc = opts.skipped ? 0 : 1;
    const readyInc = opts.projectionReady ? 1 : 0;
    const failInc = opts.projectionFailed ? 1 : 0;
    const runStatus = opts.projectionFailed
      ? 'partial'
      : opts.projectionReady
        ? 'completed'
        : 'projecting';

    await env.DB.prepare(
      `UPDATE agentsam_knowledge_runs SET
         segments_created = segments_created + ?,
         projections_ready = projections_ready + ?,
         projections_failed = projections_failed + ?,
         objects_completed = CASE
           WHEN ? > 0 AND objects_completed < 1 THEN 1
           ELSE objects_completed
         END,
         status = ?,
         current_stage = CASE WHEN ? THEN 'completed' ELSE 'projecting' END,
         completed_at = CASE WHEN ? THEN ? ELSE completed_at END,
         updated_at = ?
       WHERE id = ?`,
    )
      .bind(
        segInc,
        readyInc,
        failInc,
        readyInc,
        runStatus,
        opts.projectionReady ? 1 : 0,
        opts.projectionReady ? 1 : 0,
        now,
        now,
        runId,
      )
      .run();

    await env.DB.prepare(
      `UPDATE agentsam_knowledge_objects SET
         segment_count = segment_count + ?,
         status = CASE WHEN ? THEN 'completed' WHEN ? THEN 'partial' ELSE 'projecting' END,
         updated_at = ?
       WHERE id = ?`,
    )
      .bind(
        segInc,
        opts.projectionReady ? 1 : 0,
        opts.projectionFailed ? 1 : 0,
        now,
        objectId,
      )
      .run();

    if (opts.workItemId) {
      await env.DB.prepare(
        `UPDATE agentsam_knowledge_work_items SET
           status = CASE WHEN ? THEN 'completed' WHEN ? THEN 'failed' ELSE status END,
           completed_at = CASE WHEN ? THEN ? ELSE completed_at END,
           updated_at = ?
         WHERE id = ?`,
      )
        .bind(
          opts.projectionReady ? 1 : 0,
          opts.projectionFailed ? 1 : 0,
          opts.projectionReady ? 1 : 0,
          now,
          now,
          String(opts.workItemId),
        )
        .run();
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 400) };
  }
}
