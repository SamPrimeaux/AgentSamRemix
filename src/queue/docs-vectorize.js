/**
 * inneranimalmedia-autorag R2 → AGENTSAM_VECTORIZE_DOCUMENTS indexing (queue-driven Put/Delete).
 */
import { embedTextForLane } from '../../backend/rag/embeddings/lane-router.js';
import { resolveRagLane } from '../../backend/rag/lanes/registry.js';
import { chunkTextForCodebaseReindex } from './docs-chunk.js';
import {
  getDocsVectorizePauseState,
  shouldTripDocsVectorizeCircuit,
  tripDocsVectorizeEmbedCircuit,
} from './docs-vectorize-pause.js';

const AUTORAG_BUCKET_NAME = 'inneranimalmedia-autorag';
const DOCS_VECTOR_CHUNK_SIZE = 1000;
const DOCS_VECTOR_CHUNK_OVERLAP = 100;
const RAG_EMBED_BATCH_SIZE = 32;
const SKIP_KEY_PREFIXES = ['screenshots/', 'reports/quality-report/'];

function documentsVectorizeIndex(env) {
  return env?.AGENTSAM_VECTORIZE_DOCUMENTS || null;
}

function autoragDocsBucket(env) {
  return env?.AUTORAG_BUCKET || null;
}

function shouldIndexAutoragKey(key) {
  const k = String(key || '').trim();
  if (!k.endsWith('.md')) return false;
  if (SKIP_KEY_PREFIXES.some((p) => k.startsWith(p))) return false;
  if (k.includes('/screenshots/')) return false;
  return true;
}

/**
 * Remove all document-lane vectors for one R2 object key.
 * @param {any} env
 * @param {string} objectKey
 */
export async function deleteVectorsForDocKey(env, objectKey) {
  const index = documentsVectorizeIndex(env);
  if (!index?.deleteByIds || !objectKey) return;
  const slug = objectKey.replace(/\//g, '_').replace(/\./g, '_');
  let n = null;
  if (env.DB) {
    try {
      const row = await env.DB.prepare(
        'SELECT chunk_count FROM docs_index_log WHERE key = ? AND deleted_at IS NULL ORDER BY indexed_at DESC LIMIT 1',
      )
        .bind(objectKey)
        .first();
      n = row?.chunk_count;
    } catch (_) {
      /* non-fatal */
    }
  }
  if (n != null && n > 0) {
    const ids = [];
    for (let i = 0; i < n; i++) ids.push(`${slug}#${i}`);
    for (let o = 0; o < ids.length; o += 100) {
      await index.deleteByIds(ids.slice(o, o + 100));
    }
    return;
  }
  const lane = await resolveRagLane(env, 'docs');
  const zeroVec = new Array(lane.dimensions).fill(0);
  let safety = 0;
  while (safety++ < 200) {
    let matches;
    try {
      const res = await index.query(zeroVec, {
        topK: 100,
        returnMetadata: 'all',
        filter: { key: { $eq: objectKey } },
      });
      matches = res?.matches ?? [];
    } catch (e) {
      console.warn('[deleteVectorsForDocKey] filter query failed', objectKey, e?.message ?? e);
      break;
    }
    if (!matches.length) break;
    const delIds = matches.map((m) => m.id).filter(Boolean);
    if (!delIds.length) break;
    await index.deleteByIds(delIds);
  }
}

/**
 * Embed .md objects from AUTORAG_BUCKET into AGENTSAM_VECTORIZE_DOCUMENTS.
 * @param {any} env
 * @param {string} [keyFilter] If set, only index this key (single-file queue updates).
 */
export async function performDocsBucketVectorizeIndex(env, keyFilter) {
  let files = 0;
  let chunks = 0;
  try {
    const pause = await getDocsVectorizePauseState(env);
    if (pause.paused) {
      console.warn('[docs-vector-index] skipped (paused)', {
        keyFilter: keyFilter || null,
        reason: pause.reason,
      });
      return { files: 0, chunks: 0, skipped: true, pause_reason: pause.reason };
    }

    const bucket = autoragDocsBucket(env);
    const index = documentsVectorizeIndex(env);
    if (!bucket || !index?.upsert) {
      console.warn('[docs-vector-index] missing AUTORAG_BUCKET or AGENTSAM_VECTORIZE_DOCUMENTS.upsert');
      return { files: 0, chunks: 0 };
    }

    const keys = [];
    if (keyFilter && typeof keyFilter === 'string') {
      const k = keyFilter.trim();
      if (shouldIndexAutoragKey(k)) keys.push(k);
    } else {
      let listCursor;
      do {
        const list = await bucket.list({ cursor: listCursor, limit: 1000 });
        for (const o of list.objects || []) {
          const key = o.key;
          if (shouldIndexAutoragKey(key)) keys.push(key);
        }
        listCursor = list.truncated ? list.cursor : undefined;
      } while (listCursor);
    }

    for (const key of keys) {
      await deleteVectorsForDocKey(env, key);
      const obj = await bucket.get(key);
      if (!obj) continue;
      const text = await obj.text();
      if (!text.trim()) {
        if (env.DB) {
          await env.DB.prepare('DELETE FROM docs_index_log WHERE key = ?').bind(key).run().catch(() => {});
        }
        continue;
      }
      const parts = chunkTextForCodebaseReindex(text, DOCS_VECTOR_CHUNK_SIZE, DOCS_VECTOR_CHUNK_OVERLAP);
      if (!parts.length) {
        if (env.DB) {
          await env.DB.prepare('DELETE FROM docs_index_log WHERE key = ?').bind(key).run().catch(() => {});
        }
        continue;
      }
      files += 1;
      const slug = key.replace(/\//g, '_').replace(/\./g, '_');
      let chunkCountForKey = 0;
      for (let i = 0; i < parts.length; i += RAG_EMBED_BATCH_SIZE) {
        const batchParts = parts.slice(i, i + RAG_EMBED_BATCH_SIZE);
        const vectors = [];
        for (let j = 0; j < batchParts.length; j++) {
          const chunkIndex = i + j;
          const textPart = batchParts[j];
          let embedding;
          try {
            ({ embedding } = await embedTextForLane(env, 'docs', textPart));
          } catch (e) {
            console.warn('[docs-vector-index] embed failed', key, chunkIndex, e?.message ?? e);
            if (shouldTripDocsVectorizeCircuit(e)) {
              await tripDocsVectorizeEmbedCircuit(env, e);
              console.warn('[docs-vector-index] aborting remaining embeds (quota circuit)');
              return {
                files,
                chunks,
                skipped: true,
                pause_reason: 'embedding_quota_exhausted',
              };
            }
            continue;
          }
          if (embedding && Array.isArray(embedding)) {
            vectors.push({
              id: `${slug}#${chunkIndex}`,
              values: embedding,
              metadata: {
                key,
                chunk_index: chunkIndex,
                source: 'autorag_r2',
                bucket: AUTORAG_BUCKET_NAME,
              },
            });
          }
        }
        if (vectors.length) {
          await index.upsert(vectors);
          chunkCountForKey += vectors.length;
        }
      }
      chunks += chunkCountForKey;
      if (env.DB && chunkCountForKey > 0) {
        await env.DB.prepare(
          `INSERT OR REPLACE INTO docs_index_log (key, chunk_count, indexed_at, deleted_at, source, status) VALUES (?, ?, datetime('now'), NULL, 'autorag_r2', 'indexed')`,
        )
          .bind(key, chunkCountForKey)
          .run()
          .catch((e) => console.warn('[docs_index_log]', e?.message ?? e));
      }
    }
    console.log('[docs-vector-index] done', { files, chunks, keyFilter: keyFilter || null, bucket: AUTORAG_BUCKET_NAME });
    return { files, chunks };
  } catch (e) {
    console.warn('[docs-vector-index]', e?.message ?? e);
    throw e;
  }
}
