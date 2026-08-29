/**
 * Canonical knowledge write: ingest_segment.
 * Docs lane projects into agentsam.agentsam_documents_oai3large_1536 with
 * (workspace_id, segment_id, projection_key) identity — not (workspace_id, source_ref).
 */

import { createAgentsamEmbedding } from '../agentsam-vectorize.js';
import { enqueueVectorSyncOutbox } from '../agentsam-vector-sync-outbox.js';
import { runHyperdriveQuery } from '../../../backend/services/database/hyperdrive.js';
import {
  contentHash,
  resolveRagLane,
  resolveSupabaseWorkspaceId,
} from '../../../backend/agentsam/rag/index.js';
import { validateIngestSegmentInput } from './validate-ingest-segment.js';
import {
  bumpKnowledgeCounters,
  ensureKnowledgeControlPlane,
  enqueueKnowledgeProjectionOutbox,
} from './control-plane.js';

const DOCS_SOURCE_TYPES = new Set([
  'document',
  'course',
  'lesson',
  'module',
  'lab',
  'asset',
  'markdown',
  'product_doc',
  'support_doc',
  'architecture_note',
  'knowledge',
  'plans',
  'roadmap',
  'recipes',
  'context',
  'workflows',
  'other',
  'clients',
  'workspaces',
  'brands',
  'policy',
  'skill_playbook',
]);

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const out = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value == null) out[key] = null;
    else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    } else {
      out[key] = JSON.stringify(value).slice(0, 4000);
    }
  }
  return out;
}

function vectorLiteral(embedding) {
  if (!Array.isArray(embedding) || !embedding.length) throw new Error('embedding required');
  return `[${embedding.join(',')}]`;
}

function emptySteps() {
  return {
    validate: { ok: false },
    resolve_workspace: { ok: false },
    hash: { ok: false },
    control_plane: { ok: false },
    idempotency: { ok: false },
    embed: { ok: false },
    supabase: { ok: false },
    vectorize: { ok: false },
    vector_sync_outbox: { ok: false },
    knowledge_outbox: { ok: false },
    d1_counters: { ok: false },
    compat_catalog: { ok: false, skipped: true },
  };
}

/** @param {Record<string, unknown>} partial */
function resultShape(partial) {
  return {
    status: partial.status || 'failed',
    retryable: partial.retryable === true,
    segmentId: partial.segmentId ?? null,
    projectionId: partial.projectionId ?? null,
    projectionKey: partial.projectionKey ?? null,
    receiptId: partial.receiptId ?? null,
    content_hash: partial.content_hash ?? null,
    runId: partial.runId ?? null,
    objectId: partial.objectId ?? null,
    workItemId: partial.workItemId ?? null,
    knowledgeOutboxId: partial.knowledgeOutboxId ?? null,
    pendingSteps: Array.isArray(partial.pendingSteps) ? partial.pendingSteps : [],
    steps: partial.steps || emptySteps(),
  };
}

function mapDocsSourceType(raw) {
  const s = String(raw ?? '').trim();
  if (DOCS_SOURCE_TYPES.has(s)) return s;
  return 'other';
}

/** @param {Record<string, { ok?: boolean, skipped?: boolean }>} steps */
function collectPending(steps) {
  /** @type {string[]} */
  const pending = [];
  const map = {
    vectorize: 'vectorize',
    vector_sync_outbox: 'vector_sync_outbox',
    knowledge_outbox: 'knowledge_outbox',
    d1_counters: 'd1_counters',
    compat_catalog: 'compat_catalog',
    control_plane: 'd1_counters',
  };
  for (const [step, pendingKey] of Object.entries(map)) {
    const s = steps[step];
    if (s && s.ok === false && !s.skipped) pending.push(pendingKey);
  }
  return [...new Set(pending)];
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} input
 */
async function ingestDocsSegment(env, input, workspaceUuid, steps) {
  const lane = await resolveRagLane(env, 'docs');
  const table = lane.tableName;
  const d1WorkspaceId = String(input.workspace_id_d1).trim();
  const segmentId = String(input.segment_id).trim();
  const projectionKey = String(input.projection_key).trim();
  const snapshotId = String(input.source_snapshot_id).trim();
  const knowledgeObjectId = String(input.knowledge_object_id).trim();
  const title = input.title != null ? String(input.title).trim() : '';
  const content = input.content != null ? String(input.content).trim() : '';
  if (!content) {
    steps.supabase = { ok: false, error: 'content required for docs lane' };
    return resultShape({
      status: 'failed',
      retryable: false,
      segmentId,
      projectionKey,
      steps,
    });
  }

  const metaIn =
    input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
      ? /** @type {Record<string, unknown>} */ (input.metadata)
      : {};
  const sourceRef = String(metaIn.source_ref || `seg:${snapshotId}:${segmentId}`).trim();
  const sourcePath = String(metaIn.source_path || sourceRef).trim();
  const chunkIndex = Number.isInteger(Number(input.ordinal)) ? Number(input.ordinal) : 0;
  const sourceType = mapDocsSourceType(metaIn.source_type || 'markdown');
  const chunkType = String(metaIn.chunk_type || 'section').trim() || 'section';
  const routeVersion = String(
    input.embedding_route_version || metaIn.embedding_route_version || 'text-embedding-3-large:1536',
  ).trim();

  const hash = await contentHash(content);
  steps.hash = { ok: true };

  const metadata = sanitizeMetadata({
    ...metaIn,
    source_snapshot_id: snapshotId,
    knowledge_object_id: knowledgeObjectId,
    segment_id: segmentId,
    projection_key: projectionKey,
    embedding_route_version: routeVersion,
    grounding: Array.isArray(input.grounding) ? input.grounding : [],
    tags: Array.isArray(input.tags) ? input.tags : [],
    artifact_key: input.artifact_key ?? metaIn.artifact_key ?? null,
  });

  const cp = await ensureKnowledgeControlPlane(env, {
    ...input,
    knowledge_object_id: knowledgeObjectId,
    metadata,
  });
  /** @type {string|null} */
  let runId = cp.runId || null;
  /** @type {string|null} */
  let objectId = cp.objectId || null;
  /** @type {string|null} */
  let workItemId = cp.workItemId || null;
  /** @type {string|null} */
  let knowledgeOutboxId = null;
  if (cp.ok) {
    steps.control_plane = { ok: true, skipped: !!cp.skipped };
  } else if (cp.skipped) {
    steps.control_plane = { ok: true, skipped: true, error: cp.error };
  } else {
    steps.control_plane = { ok: false, error: cp.error || 'control_plane_failed' };
  }

  const existing = await runHyperdriveQuery(
    env,
    `SELECT id::text AS id, content_hash, vectorize_id
       FROM agentsam.${table}
      WHERE workspace_id = $1::uuid
        AND segment_id = $2
        AND projection_key = $3
        AND is_current = true
      LIMIT 1`,
    [workspaceUuid, segmentId, projectionKey],
  );
  if (!existing?.ok) {
    steps.idempotency = { ok: false, error: existing?.error || 'select_failed' };
    return resultShape({
      status: 'failed',
      retryable: true,
      segmentId,
      projectionKey,
      content_hash: hash,
      steps,
    });
  }

  const existingRow = existing.rows?.[0] ?? null;
  if (
    existingRow?.content_hash &&
    String(existingRow.content_hash) === hash &&
    existingRow.vectorize_id
  ) {
    steps.idempotency = { ok: true, skipped: true };
    steps.embed = { ok: true, skipped: true };
    steps.supabase = { ok: true, skipped: true };
    steps.vectorize = { ok: true, skipped: true };
    steps.vector_sync_outbox = { ok: true, skipped: true };

    const skipReceipts = {
      'pgvector:docs': { ok: true, projection_id: String(existingRow.id), skipped: true },
      'vectorize:documents': { ok: true, projection_id: String(existingRow.id), skipped: true },
    };
    const kpo = await enqueueKnowledgeProjectionOutbox(env, {
      runId,
      objectId,
      segmentId,
      workspaceId: d1WorkspaceId,
      contentHash: hash,
      projectionId: String(existingRow.id),
      projectionKey,
      lane: 'docs',
      receipts: skipReceipts,
      status: 'completed',
    });
    steps.knowledge_outbox = {
      ok: !!kpo?.ok || !!kpo?.skipped,
      skipped: !!kpo?.skipped,
      outbox_enqueued: !!kpo?.ok,
      ...(kpo?.ok ? {} : { error: kpo?.error }),
    };
    knowledgeOutboxId = kpo?.id || null;

    const bump = await bumpKnowledgeCounters(env, {
      runId: runId || '',
      objectId: objectId || '',
      workItemId,
      projectionReady: true,
      skipped: true,
    });
    steps.d1_counters = {
      ok: !!bump?.ok || !!bump?.skipped,
      skipped: !!bump?.skipped,
      ...(bump?.ok ? {} : { error: bump?.error }),
    };

    return resultShape({
      status: 'skipped',
      retryable: false,
      segmentId,
      projectionId: String(existingRow.id),
      projectionKey,
      content_hash: hash,
      receiptId: `rcpt_${segmentId}`,
      runId,
      objectId,
      workItemId,
      knowledgeOutboxId,
      pendingSteps: collectPending(steps),
      steps,
    });
  }
  steps.idempotency = { ok: true, skipped: false };

  let embedding;
  let embedModel = 'text-embedding-3-large';
  try {
    const emb = await createAgentsamEmbedding(env, content, {
      spec: { provider: 'openai', model: 'text-embedding-3-large', dimensions: 1536 },
    });
    embedding = emb.embedding;
    embedModel = emb.model || embedModel;
    steps.embed = { ok: true };
  } catch (e) {
    steps.embed = { ok: false, error: String(e?.message || e).slice(0, 400) };
    return resultShape({
      status: 'failed',
      retryable: true,
      segmentId,
      projectionKey,
      content_hash: hash,
      steps,
    });
  }

  const vector = vectorLiteral(embedding);
  let rowId = existingRow?.id != null ? String(existingRow.id) : null;

  if (!rowId) {
    const byPath = await runHyperdriveQuery(
      env,
      `SELECT id::text AS id
         FROM agentsam.${table}
        WHERE workspace_id = $1::uuid
          AND source_path = $2
          AND chunk_index = $3
        LIMIT 1`,
      [workspaceUuid, sourcePath, chunkIndex],
    );
    if (byPath?.ok && byPath.rows?.[0]?.id) rowId = String(byPath.rows[0].id);
  }
  if (!rowId) rowId = crypto.randomUUID();

  const writeParams = [
    rowId,
    workspaceUuid,
    title || null,
    content,
    sourceType,
    sourceRef,
    sourcePath,
    chunkIndex,
    chunkType,
    hash,
    vector,
    embedModel,
    snapshotId,
    knowledgeObjectId,
    segmentId,
    projectionKey,
    routeVersion,
    JSON.stringify(metadata),
    lane.vectorize || 'AGENTSAM_VECTORIZE_DOCUMENTS',
    'agentsam-documents-oai3large-1536',
  ];

  let upsert;
  if (existingRow?.id) {
    upsert = await runHyperdriveQuery(
      env,
      `UPDATE agentsam.${table} SET
         title = $3,
         content = $4,
         source_type = $5,
         source_ref = $6,
         source_path = $7,
         chunk_index = $8,
         chunk_type = $9,
         content_hash = $10,
         embedding = $11::vector,
         embedding_model = $12,
         source_snapshot_id = $13,
         knowledge_object_id = $14,
         segment_id = $15,
         projection_key = $16,
         embedding_route_version = $17,
         is_current = true,
         superseded_at = NULL,
         metadata = $18::jsonb,
         vectorize_binding = $19,
         vectorize_index = $20,
         vectorize_id = id::text,
         embedded_at = now(),
         updated_at = now()
       WHERE id = $1::uuid AND workspace_id = $2::uuid
       RETURNING id::text AS id`,
      writeParams,
    );
  } else {
    upsert = await runHyperdriveQuery(
      env,
      `INSERT INTO agentsam.${table} (
         id, workspace_id, title, content, source_type, source_ref, source_path,
         chunk_index, chunk_type, content_hash, embedding, embedding_model, embedding_dims,
         source_snapshot_id, knowledge_object_id, segment_id, projection_key,
         embedding_route_version, is_current, superseded_at, metadata,
         vectorize_binding, vectorize_index, vectorize_id, embedded_at, updated_at
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4, $5, $6, $7,
         $8, $9, $10, $11::vector, $12, 1536,
         $13, $14, $15, $16,
         $17, true, NULL, $18::jsonb,
         $19, $20, $1::text, now(), now()
       )
       ON CONFLICT (workspace_id, source_path, chunk_index) DO UPDATE SET
         title = EXCLUDED.title,
         content = EXCLUDED.content,
         source_type = EXCLUDED.source_type,
         source_ref = EXCLUDED.source_ref,
         chunk_type = EXCLUDED.chunk_type,
         content_hash = EXCLUDED.content_hash,
         embedding = EXCLUDED.embedding,
         embedding_model = EXCLUDED.embedding_model,
         source_snapshot_id = EXCLUDED.source_snapshot_id,
         knowledge_object_id = EXCLUDED.knowledge_object_id,
         segment_id = EXCLUDED.segment_id,
         projection_key = EXCLUDED.projection_key,
         embedding_route_version = EXCLUDED.embedding_route_version,
         is_current = true,
         superseded_at = NULL,
         metadata = EXCLUDED.metadata,
         vectorize_binding = EXCLUDED.vectorize_binding,
         vectorize_index = EXCLUDED.vectorize_index,
         vectorize_id = EXCLUDED.id::text,
         embedded_at = now(),
         updated_at = now()
       RETURNING id::text AS id`,
      writeParams,
    );
  }

  if (!upsert?.ok || !upsert.rows?.[0]?.id) {
    steps.supabase = { ok: false, error: upsert?.error || 'upsert_failed' };
    return resultShape({
      status: 'failed',
      retryable: true,
      segmentId,
      projectionKey,
      content_hash: hash,
      steps,
    });
  }
  rowId = String(upsert.rows[0].id);
  steps.supabase = { ok: true };

  const pendingSteps = [];
  const vectorMeta = {
    workspace_id: d1WorkspaceId,
    source_ref: sourceRef,
    source_snapshot_id: snapshotId,
    knowledge_object_id: knowledgeObjectId,
    segment_id: segmentId,
    projection_key: projectionKey,
    title: title.slice(0, 200),
    source_type: sourceType,
  };

  const binding = lane.vectorize ? env?.[lane.vectorize] : null;
  if (binding && typeof binding.upsert === 'function') {
    try {
      await binding.upsert([{ id: rowId, values: embedding, metadata: vectorMeta }]);
      steps.vectorize = { ok: true };
    } catch (e) {
      steps.vectorize = { ok: false, error: String(e?.message || e).slice(0, 400) };
      pendingSteps.push('vectorize');
    }
  } else {
    steps.vectorize = { ok: false, skipped: true, error: 'binding_unavailable' };
    pendingSteps.push('vectorize');
  }

  try {
    const enq = await enqueueVectorSyncOutbox(env, {
      workspaceId: workspaceUuid,
      sourceTable: table,
      sourceId: rowId,
      vectorIndex: lane.vectorize || 'AGENTSAM_VECTORIZE_DOCUMENTS',
      operation: 'upsert',
      contentHash: hash,
      embeddingModel: embedModel,
      embeddingDims: 1536,
    });
    steps.vector_sync_outbox = {
      ok: !!enq?.ok,
      outbox_enqueued: !!enq?.ok,
      ...(enq?.ok ? {} : { error: enq?.error || enq?.reason || 'enqueue_failed' }),
    };
    if (!enq?.ok) pendingSteps.push('vector_sync_outbox');
  } catch (e) {
    steps.vector_sync_outbox = { ok: false, error: String(e?.message || e).slice(0, 400) };
    pendingSteps.push('vector_sync_outbox');
  }

  const receipts = {
    'pgvector:docs': { ok: true, projection_id: rowId, at: Math.floor(Date.now() / 1000) },
  };
  if (steps.vectorize.ok) {
    receipts['vectorize:documents'] = {
      ok: true,
      projection_id: rowId,
      at: Math.floor(Date.now() / 1000),
    };
  }
  if (steps.vector_sync_outbox.ok) {
    receipts.vector_sync_enqueued = {
      ok: true,
      at: Math.floor(Date.now() / 1000),
    };
  }
  const outboxStatus =
    steps.supabase.ok && steps.vectorize.ok && steps.vector_sync_outbox.ok
      ? 'completed'
      : steps.supabase.ok
        ? 'partial'
        : 'pending';
  const kpo = await enqueueKnowledgeProjectionOutbox(env, {
    runId,
    objectId,
    segmentId,
    workspaceId: d1WorkspaceId,
    contentHash: hash,
    projectionId: rowId,
    projectionKey,
    lane: 'docs',
    receipts,
    status: outboxStatus,
  });
  steps.knowledge_outbox = {
    ok: !!kpo?.ok || !!kpo?.skipped,
    skipped: !!kpo?.skipped,
    outbox_enqueued: !!kpo?.ok,
    ...(kpo?.ok ? {} : { error: kpo?.error }),
  };
  knowledgeOutboxId = kpo?.id || null;
  if (!kpo?.ok && !kpo?.skipped) pendingSteps.push('knowledge_outbox');

  const bump = await bumpKnowledgeCounters(env, {
    runId: runId || '',
    objectId: objectId || '',
    workItemId,
    projectionReady: steps.supabase.ok && steps.vectorize.ok,
    projectionFailed: !steps.supabase.ok,
    skipped: false,
  });
  steps.d1_counters = {
    ok: !!bump?.ok || !!bump?.skipped,
    skipped: !!bump?.skipped,
    ...(bump?.ok ? {} : { error: bump?.error }),
  };
  if (!bump?.ok && !bump?.skipped) pendingSteps.push('d1_counters');

  // Optional compat catalog (Pass 4 surface) — best-effort when D1 present.
  if (env?.DB && typeof env.DB.prepare === 'function') {
    try {
      const objectKey = String(input.artifact_key || metaIn.object_key || sourcePath).slice(0, 2000);
      const metaJson = JSON.stringify({
        source_snapshot_id: snapshotId,
        segment_id: segmentId,
        projection_id: rowId,
        projection_key: projectionKey,
      });
      await env.DB.prepare(
        `INSERT INTO agentsam_autorag (
           id, object_key, bucket, lane, type, title, content_preview, char_count, chunk_count,
           embedding_id, embed_model, embed_dims, index_status, metadata, indexed_at, created_at, updated_at
         ) VALUES (?, ?, 'inneranimalmedia-autorag', 'documents_oai3large_1536', 'document',
           ?, ?, ?, 1, ?, ?, 1536, 'indexed', ?, datetime('now'), datetime('now'), datetime('now'))
         ON CONFLICT(object_key) DO UPDATE SET
           title=excluded.title,
           content_preview=excluded.content_preview,
           char_count=excluded.char_count,
           embedding_id=excluded.embedding_id,
           embed_model=excluded.embed_model,
           index_status='indexed',
           metadata=excluded.metadata,
           indexed_at=datetime('now'),
           updated_at=datetime('now')`,
      )
        .bind(
          `autorag_${segmentId}`,
          objectKey,
          title.slice(0, 200),
          content.slice(0, 280),
          content.length,
          rowId,
          embedModel,
          metaJson,
        )
        .run();
      await env.DB.prepare(
        `INSERT OR REPLACE INTO docs_index_log (key, chunk_count, indexed_at, deleted_at, source, status)
         VALUES (?, 1, datetime('now'), NULL, 'ingest_segment', 'indexed')`,
      )
        .bind(objectKey)
        .run();
      steps.compat_catalog = { ok: true, skipped: false };
    } catch (e) {
      steps.compat_catalog = { ok: false, skipped: false, error: String(e?.message || e).slice(0, 300) };
      pendingSteps.push('compat_catalog');
    }
  }

  const status =
    steps.supabase.ok && steps.vectorize.ok
      ? 'complete'
      : steps.supabase.ok
        ? 'partial'
        : 'failed';

  return resultShape({
    status,
    retryable: status !== 'complete',
    segmentId,
    projectionId: rowId,
    projectionKey,
    content_hash: hash,
    receiptId: `rcpt_${segmentId}`,
    runId,
    objectId,
    workItemId,
    knowledgeOutboxId,
    pendingSteps: [...new Set([...pendingSteps, ...collectPending(steps)])],
    steps,
  });
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} input
 */
export async function ingestSegment(env, input) {
  const steps = emptySteps();
  const validated = validateIngestSegmentInput(input);
  if (!validated.ok) {
    steps.validate = { ok: false, error: validated.errors.join('; ') };
    return resultShape({
      status: 'failed',
      retryable: false,
      segmentId: input?.segment_id != null ? String(input.segment_id) : null,
      projectionKey: input?.projection_key != null ? String(input.projection_key) : null,
      steps,
    });
  }
  steps.validate = { ok: true };
  const value = validated.value;
  const laneName = String(value.lane).trim();

  const workspaceUuid = await resolveSupabaseWorkspaceId(env, String(value.workspace_id_d1));
  if (!workspaceUuid) {
    steps.resolve_workspace = { ok: false, error: 'workspace_unresolved' };
    return resultShape({
      status: 'failed',
      retryable: true,
      segmentId: String(value.segment_id),
      projectionKey: String(value.projection_key),
      steps,
    });
  }
  steps.resolve_workspace = { ok: true };

  // Docs-only adapter today. Memory writes go through the backend RAG writer;
  // code/media/schema/etc. have their own indexers — do not route them here yet.
  if (laneName === 'docs') {
    return ingestDocsSegment(env, value, workspaceUuid, steps);
  }

  steps.supabase = {
    ok: false,
    error: `lane_adapter_pending:${laneName}`,
  };
  return resultShape({
    status: 'failed',
    retryable: false,
    segmentId: String(value.segment_id),
    projectionKey: String(value.projection_key),
    steps,
  });
}

/**
 * Map legacy writeToLane entry → ingest_segment input (docs-first).
 * @param {string} laneName
 * @param {Record<string, unknown>} entry
 */
export async function legacyWriteEntryToIngestInput(laneName, entry) {
  const lane = String(laneName || '').trim();
  const d1WorkspaceId = String(entry?.workspace_id_d1 ?? '').trim();
  const sourceRef = String(entry?.source_ref ?? '').trim();
  const content = String(entry?.content ?? '').trim();
  const title = String(entry?.title ?? '').trim();
  const meta =
    entry?.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
      ? { ...entry.metadata }
      : {};

  const snapshotId = String(
    entry?.source_snapshot_id || meta.source_snapshot_id || `snap_legacy_${lane}_${sourceRef}`,
  )
    .trim()
    .slice(0, 200);
  const knowledgeObjectId = String(
    entry?.knowledge_object_id || meta.knowledge_object_id || `obj_legacy_${lane}_${sourceRef}`,
  )
    .trim()
    .slice(0, 200);

  let segmentId = String(entry?.segment_id || meta.segment_id || '').trim();
  if (!segmentId) {
    const hash = await contentHash(`${snapshotId}\n${sourceRef}\n${content}`);
    segmentId = `seg_${hash.slice(0, 32)}`;
  }

  const projectionKey = String(
    entry?.projection_key ||
      meta.projection_key ||
      (lane === 'docs' ? 'docs:oai3large:1536:v1' : `${lane}:oai3large:1536:v1`),
  ).trim();

  const sourceTypeRaw = String(entry?.source_type || meta.source_type || 'other').trim();
  const sourceType = mapDocsSourceType(sourceTypeRaw === 'compaction_digest' ? 'other' : sourceTypeRaw);

  return {
    lane,
    workspace_id_d1: d1WorkspaceId,
    source_snapshot_id: snapshotId,
    knowledge_object_id: knowledgeObjectId,
    segment_id: segmentId,
    projection_key: projectionKey,
    embedding_route_version: String(
      entry?.embedding_route_version || meta.embedding_route_version || 'text-embedding-3-large:1536',
    ),
    ordinal: Number.isInteger(Number(entry?.chunk_index ?? meta.chunk_index))
      ? Number(entry?.chunk_index ?? meta.chunk_index)
      : 0,
    title,
    content,
    artifact_key: entry?.artifact_key || meta.source_path || meta.object_key || null,
    grounding: Array.isArray(entry?.grounding) ? entry.grounding : [],
    tags: Array.isArray(entry?.tags) ? entry.tags : [],
    metadata: {
      ...meta,
      source_ref: sourceRef,
      source_path: String(meta.source_path || sourceRef),
      source_type: sourceType,
      legacy_source_type: sourceTypeRaw,
      chunk_type: meta.chunk_type || 'section',
    },
  };
}
