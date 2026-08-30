/**
 * MovieMode media semantic search — Gemini multimodal @1536 on AGENTSAM_VECTORIZE_MEDIA.
 * D1 `media_assets` hydrates hits; never mix OpenAI vectors into this index.
 */
import { getR2Binding } from '../api/r2-api.js';
import {
  RAG_EMBED_LANE_MULTIMODAL,
  createEmbedding,
} from '../../backend/http/agentsam/routes/memory-legacy.js';
import {
  buildMediaEmbedParts,
  isEmbeddableMediaMime,
  resolveMediaMimeType,
  MULTIMODAL_EMBED_DIMS,
} from './multimodal-embedding.js';
import { embeddingPolicy } from './embedding-routes.js';
import { contentHash, resolveSupabaseWorkspaceId } from '../../backend/rag/index.js';
import { runHyperdriveQuery } from '../../backend/services/database/hyperdrive.js';

export const MOVIEMODE_PGVECTOR_TABLE = 'agentsam_media_gemini2_1536';

export const MOVIEMODE_VECTORIZE_BINDING = 'AGENTSAM_VECTORIZE_MEDIA';
export const MOVIEMODE_VECTORIZE_INDEX_NAME = 'agentsam-moviemode-gemini2-1536';
export const MOVIEMODE_MEDIA_MAX_EMBED_BYTES = 20 * 1024 * 1024;

/** @param {any} env */
export function moviemodeVectorizeBinding(env) {
  return env?.[MOVIEMODE_VECTORIZE_BINDING] || null;
}

/**
 * @param {any} env
 * @param {string} bucket
 * @param {string} objectKey
 * @param {number} [maxBytes]
 */
export async function fetchMediaObjectBytes(env, bucket, objectKey, maxBytes = MOVIEMODE_MEDIA_MAX_EMBED_BYTES) {
  const binding = getR2Binding(env, bucket);
  if (!binding?.get) throw new Error(`r2_binding_unavailable: ${bucket}`);
  const obj = await binding.get(objectKey);
  if (!obj) throw new Error('media_object_not_found');
  const buf = await obj.arrayBuffer();
  if (buf.byteLength > maxBytes) {
    throw new Error(`media_too_large: ${buf.byteLength} bytes (max ${maxBytes})`);
  }
  return { bytes: buf, contentType: obj.httpMetadata?.contentType || obj.customMetadata?.content_type || null };
}

/**
 * @param {any} env
 * @param {{ text?: string, parts?: import('./multimodal-embedding.js').MultimodalContentPart[], assetBytes?: ArrayBuffer, mimeType?: string, caption?: string }} opts
 */
export async function createMovieModeQueryEmbedding(env, opts = {}) {
  /** @type {import('./multimodal-embedding.js').MultimodalContentPart[]} */
  let parts = Array.isArray(opts.parts) ? [...opts.parts] : [];

  if (opts.assetBytes && opts.assetBytes.byteLength > 0) {
    const mimeType = resolveMediaMimeType(opts.mimeType, null, null);
    parts = [...parts, ...buildMediaEmbedParts({ bytes: opts.assetBytes, mimeType, caption: opts.caption })];
  }

  const text = String(opts.text || opts.caption || '').trim();
  return createEmbedding(env, text, RAG_EMBED_LANE_MULTIMODAL, { parts });
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} asset
 * @param {{ caption?: string, transcript?: string, force?: boolean }} [opts]
 */
export async function indexMediaAssetForSearch(env, asset, opts = {}) {
  const binding = moviemodeVectorizeBinding(env);
  if (!binding?.upsert) return { ok: false, skipped: 'no_vectorize_binding' };

  const assetId = String(asset.id || '').trim();
  const workspaceId = String(asset.workspace_id || '').trim();
  const bucket = String(asset.bucket || '').trim();
  const objectKey = String(asset.object_key || '').trim();
  if (!assetId || !workspaceId || !bucket || !objectKey) {
    throw new Error('indexMediaAssetForSearch: id, workspace_id, bucket, object_key required');
  }

  if (!opts.force && asset.vectorize_id && asset.embed_model === embeddingPolicy.multimodalAssetSearch) {
    return { ok: true, skipped: 'already_indexed', vectorize_id: asset.vectorize_id };
  }

  const mimeType = resolveMediaMimeType(
    asset.content_type,
    asset.media_kind,
    asset.filename || objectKey,
  );
  const captionParts = [
    String(asset.filename || '').trim(),
    String(opts.caption || '').trim(),
    String(opts.transcript || '').trim(),
    String(asset.media_kind || '').trim(),
  ].filter(Boolean);
  const caption = captionParts.join(' · ');

  /** @type {import('./multimodal-embedding.js').MultimodalContentPart[]} */
  let parts = [];
  if (isEmbeddableMediaMime(mimeType)) {
    try {
      const { bytes } = await fetchMediaObjectBytes(env, bucket, objectKey);
      parts = buildMediaEmbedParts({ bytes, mimeType, caption });
    } catch (e) {
      const msg = String(e?.message || e);
      if (!caption) throw e;
      parts = [{ type: 'text', text: caption }];
      console.warn('[moviemode-media-vectorize] bytes skipped:', msg.slice(0, 200));
    }
  } else if (caption) {
    parts = [{ type: 'text', text: caption }];
  } else {
    return { ok: false, skipped: 'no_embeddable_content' };
  }

  const { embedding, model, dimensions } = await createEmbedding(env, caption, RAG_EMBED_LANE_MULTIMODAL, {
    parts,
  });

  if (dimensions !== MULTIMODAL_EMBED_DIMS) {
    throw new Error(`dimension_mismatch: expected ${MULTIMODAL_EMBED_DIMS}, got ${dimensions}`);
  }

  const vectorId = assetId;
  const metadata = {
    workspace_id: workspaceId,
    asset_id: assetId,
    bucket,
    object_key: objectKey,
    filename: String(asset.filename || objectKey.split('/').pop() || '').slice(0, 200),
    media_kind: String(asset.media_kind || 'unknown').slice(0, 32),
    content_type: mimeType.slice(0, 120),
    embed_model: model,
    lane: 'moviemode_media',
  };
  if (asset.project_id) metadata.project_id = String(asset.project_id).slice(0, 64);
  if (asset.tenant_id) metadata.tenant_id = String(asset.tenant_id).slice(0, 64);

  await binding.upsert([{ id: vectorId, values: embedding, metadata }]);

  const pgWrite = await upsertMediaPgvectorRow(env, {
    d1WorkspaceId: workspaceId,
    assetId,
    title: metadata.filename,
    content: caption || metadata.filename,
    mediaKind: metadata.media_kind,
    bucket,
    objectKey,
    contentType: mimeType,
    projectId: asset.project_id ? String(asset.project_id) : null,
    embedding,
    model,
    vectorizeId: vectorId,
    userId: asset.user_id ? String(asset.user_id) : null,
    extraMetadata: {
      lane: 'moviemode_media',
      parts_count: parts.length,
    },
  });

  if (env.DB) {
    await env.DB.prepare(
      `UPDATE media_assets
          SET vectorize_id = ?, embed_model = ?, embedded_at = datetime('now'),
              status = CASE WHEN status = 'registered' THEN 'ready' ELSE status END,
              updated_at = datetime('now')
        WHERE id = ? AND workspace_id = ?`,
    )
      .bind(vectorId, model, assetId, workspaceId)
      .run();
  }

  return { ok: true, vectorize_id: vectorId, dimensions, model, parts_count: parts.length, pgvector: pgWrite };
}

/**
 * Mirror indexed media into Supabase agentsam.agentsam_media_gemini2_1536 (Hyperdrive).
 * @param {any} env
 * @param {Record<string, unknown>} row
 */
export async function upsertMediaPgvectorRow(env, row) {
  const d1WorkspaceId = String(row.d1WorkspaceId || '').trim();
  const assetId = String(row.assetId || '').trim();
  const content = String(row.content || '').trim();
  if (!d1WorkspaceId || !assetId || !content) {
    return { ok: false, skipped: 'missing_required_fields' };
  }

  const workspaceUuid = await resolveSupabaseWorkspaceId(env, d1WorkspaceId);
  if (!workspaceUuid) return { ok: false, skipped: 'workspace_unresolved' };

  /** @type {number[]} */
  const embedding = Array.isArray(row.embedding) ? row.embedding : [];
  if (!embedding.length) return { ok: false, skipped: 'missing_embedding' };

  const hash = await contentHash(content);
  const vector = `[${embedding.join(',')}]`;
  const rowId = crypto.randomUUID();
  const table = MOVIEMODE_PGVECTOR_TABLE;
  const metadata = {
    ...(row.extraMetadata && typeof row.extraMetadata === 'object' ? row.extraMetadata : {}),
    asset_id: assetId,
    bucket: row.bucket || null,
    object_key: row.objectKey || null,
  };

  const write = await runHyperdriveQuery(
    env,
    `INSERT INTO agentsam.${table} (
       id, workspace_id, user_id, asset_id, title, content, media_kind,
       bucket, object_key, content_type, project_id, content_hash,
       embedding, embedding_model, embedding_dims, embedded_at,
       vectorize_binding, vectorize_index, vectorize_id, metadata,
       created_at, updated_at
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7,
       $8, $9, $10, $11, $12,
       $13::vector, $14, $15, now(),
       $16, $17, $18, $19::jsonb,
       now(), now()
     )
     ON CONFLICT (workspace_id, asset_id) DO UPDATE SET
       title = EXCLUDED.title,
       content = EXCLUDED.content,
       media_kind = EXCLUDED.media_kind,
       bucket = EXCLUDED.bucket,
       object_key = EXCLUDED.object_key,
       content_type = EXCLUDED.content_type,
       project_id = EXCLUDED.project_id,
       content_hash = EXCLUDED.content_hash,
       embedding = EXCLUDED.embedding,
       embedding_model = EXCLUDED.embedding_model,
       embedding_dims = EXCLUDED.embedding_dims,
       embedded_at = now(),
       vectorize_id = EXCLUDED.vectorize_id,
       metadata = EXCLUDED.metadata,
       updated_at = now()
     RETURNING id`,
    [
      rowId,
      workspaceUuid,
      row.userId || null,
      assetId,
      row.title || null,
      content,
      String(row.mediaKind || 'unknown').slice(0, 32),
      row.bucket || null,
      row.objectKey || null,
      row.contentType || null,
      row.projectId || null,
      hash,
      vector,
      String(row.model || 'gemini-embedding-2'),
      embedding.length,
      MOVIEMODE_VECTORIZE_BINDING,
      MOVIEMODE_VECTORIZE_INDEX_NAME,
      String(row.vectorizeId || assetId),
      JSON.stringify(metadata),
    ],
  );

  if (!write?.ok) {
    console.warn('[moviemode-media-vectorize] pgvector upsert failed:', write?.error || 'unknown');
    return { ok: false, error: write?.error || 'pgvector_upsert_failed' };
  }
  return { ok: true, id: String(write.rows?.[0]?.id ?? rowId), content_hash: hash };
}

/**
 * @param {any} env
 * @param {{ workspaceId: string, query: string, topK?: number, projectId?: string|null, mediaKind?: string|null, queryParts?: import('./multimodal-embedding.js').MultimodalContentPart[] }} opts
 */
export async function searchMovieModeMedia(env, opts) {
  const binding = moviemodeVectorizeBinding(env);
  if (!binding?.query) return { ok: false, error: 'no_vectorize_binding', results: [] };

  const workspaceId = String(opts.workspaceId || '').trim();
  const query = String(opts.query || '').trim();
  if (!workspaceId || !query) return { ok: false, error: 'workspaceId and query required', results: [] };

  const { embedding, model, dimensions } = await createMovieModeQueryEmbedding(env, {
    text: query,
    parts: opts.queryParts,
  });

  const topK = Math.min(Math.max(1, Number(opts.topK) || 12), 50);
  /** @type {Record<string, unknown>} */
  const filter = { workspace_id: workspaceId };
  if (opts.projectId) filter.project_id = String(opts.projectId).trim();
  if (opts.mediaKind) filter.media_kind = String(opts.mediaKind).trim();

  const raw = await binding.query(embedding, {
    topK,
    filter,
    returnMetadata: 'all',
  });
  const matches = raw?.matches || raw?.result?.matches || [];

  /** @type {Record<string, unknown>[]} */
  const results = [];
  for (const match of matches) {
    const meta = match?.metadata && typeof match.metadata === 'object' ? match.metadata : {};
    const assetId = String(meta.asset_id || match.id || '').trim();
    let assetRow = null;
    if (env.DB && assetId) {
      assetRow = await env.DB.prepare(
        `SELECT id, bucket, object_key, filename, content_type, media_kind, size_bytes, duration_ms,
                width, height, project_id, status, metadata_json, vectorize_id, embed_model
           FROM media_assets
          WHERE id = ? AND workspace_id = ?
          LIMIT 1`,
      )
        .bind(assetId, workspaceId)
        .first();
    }
    results.push({
      score: Number(match?.score ?? 0),
      asset_id: assetId,
      bucket: meta.bucket || assetRow?.bucket || null,
      object_key: meta.object_key || assetRow?.object_key || null,
      filename: meta.filename || assetRow?.filename || null,
      media_kind: meta.media_kind || assetRow?.media_kind || null,
      content_type: meta.content_type || assetRow?.content_type || null,
      project_id: meta.project_id || assetRow?.project_id || null,
      asset: assetRow,
      embed_model: model,
      dimensions,
    });
  }

  return { ok: true, results, model, dimensions, match_count: results.length };
}
