/**
 * MovieMode ingest — Workers AI Whisper transcription → media_assets.metadata_json.transcript
 */
import { fetchMediaObjectBytes } from './moviemode-media-vectorize.js';

export const WHISPER_MODEL = '@cf/openai/whisper-large-v3-turbo';
export const WHISPER_MAX_BYTES = 25 * 1024 * 1024;

/**
 * @param {any} env
 * @param {ArrayBuffer|Uint8Array} bytes
 */
export async function transcribeMediaBytes(env, bytes) {
  if (!env?.AI?.run) throw new Error('Workers AI binding not configured');
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!u8.byteLength) throw new Error('empty_audio');
  if (u8.byteLength > WHISPER_MAX_BYTES) {
    throw new Error(`media_too_large_for_whisper: ${u8.byteLength} > ${WHISPER_MAX_BYTES}`);
  }

  const result = await env.AI.run(WHISPER_MODEL, {
    audio: u8,
  });
  const text = String(result?.text || result?.transcript || result?.result?.text || '').trim();
  if (!text) throw new Error('whisper_empty_transcript');
  return { text, model: WHISPER_MODEL };
}

/**
 * @param {Record<string, unknown>} meta
 */
export function readTranscriptFromMetadata(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const t = String(meta.transcript || '').trim();
  return t || null;
}

/**
 * @param {any} row — media_assets row
 */
export function transcriptFromAssetRow(row) {
  if (!row) return null;
  try {
    const meta = JSON.parse(String(row.metadata_json || '{}'));
    return readTranscriptFromMetadata(meta);
  } catch {
    return null;
  }
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} asset — full media_assets row
 * @param {{ force?: boolean, reindex?: boolean }} [opts]
 */
export async function transcribeMediaAsset(env, asset, opts = {}) {
  const assetId = String(asset.id || '').trim();
  const workspaceId = String(asset.workspace_id || '').trim();
  const bucket = String(asset.bucket || '').trim();
  const objectKey = String(asset.object_key || '').trim();
  const mediaKind = String(asset.media_kind || '').trim().toLowerCase();

  if (!assetId || !workspaceId || !bucket || !objectKey) {
    throw new Error('transcribeMediaAsset: id, workspace_id, bucket, object_key required');
  }
  if (mediaKind !== 'video' && mediaKind !== 'audio') {
    return { ok: false, skipped: 'not_audio_or_video' };
  }

  if (!opts.force) {
    const existing = transcriptFromAssetRow(asset);
    if (existing) return { ok: true, skipped: 'already_transcribed', transcript: existing };
  }

  if (!env.AI?.run) return { ok: false, skipped: 'no_workers_ai' };

  if (env.DB) {
    await env.DB.prepare(
      `UPDATE media_assets SET status = 'analyzing', updated_at = datetime('now')
        WHERE id = ? AND workspace_id = ? AND status != 'failed'`,
    )
      .bind(assetId, workspaceId)
      .run()
      .catch(() => null);
  }

  let bytes;
  try {
    const fetched = await fetchMediaObjectBytes(env, bucket, objectKey, WHISPER_MAX_BYTES);
    bytes = fetched.bytes;
  } catch (e) {
    const msg = String(e?.message || e);
    if (env.DB) {
      await mergeAssetMetadata(env, assetId, workspaceId, {
        transcript_error: msg.slice(0, 300),
        transcribed_at: new Date().toISOString(),
      }).catch(() => null);
    }
    return { ok: false, error: msg };
  }

  let transcript;
  let model;
  try {
    const out = await transcribeMediaBytes(env, bytes);
    transcript = out.text;
    model = out.model;
  } catch (e) {
    const msg = String(e?.message || e);
    if (env.DB) {
      await mergeAssetMetadata(env, assetId, workspaceId, {
        transcript_error: msg.slice(0, 300),
        transcribed_at: new Date().toISOString(),
      }).catch(() => null);
      await env.DB.prepare(
        `UPDATE media_assets SET status = 'uploaded', updated_at = datetime('now') WHERE id = ? AND workspace_id = ?`,
      )
        .bind(assetId, workspaceId)
        .run()
        .catch(() => null);
    }
    return { ok: false, error: msg };
  }

  await mergeAssetMetadata(env, assetId, workspaceId, {
    transcript,
    transcript_model: model,
    transcribed_at: new Date().toISOString(),
    transcript_error: null,
  });

  if (env.DB) {
    await env.DB.prepare(
      `UPDATE media_assets SET status = 'ready', updated_at = datetime('now') WHERE id = ? AND workspace_id = ?`,
    )
      .bind(assetId, workspaceId)
      .run()
      .catch(() => null);
  }

  let indexResult = null;
  if (opts.reindex !== false) {
    const row = env.DB
      ? await env.DB.prepare(`SELECT * FROM media_assets WHERE id = ? AND workspace_id = ? LIMIT 1`)
          .bind(assetId, workspaceId)
          .first()
      : { ...asset, metadata_json: JSON.stringify({ transcript }) };
    try {
      const { indexMediaAssetForSearch } = await import('./moviemode-media-vectorize.js');
      indexResult = await indexMediaAssetForSearch(env, row, { transcript, force: true });
    } catch (e) {
      indexResult = { ok: false, error: String(e?.message || e).slice(0, 300) };
    }
  }

  return { ok: true, asset_id: assetId, transcript, model, index: indexResult };
}

/**
 * @param {any} env
 * @param {string} assetId
 * @param {string} workspaceId
 * @param {Record<string, unknown>} patch
 */
export async function mergeAssetMetadata(env, assetId, workspaceId, patch) {
  if (!env?.DB) return;
  const row = await env.DB.prepare(
    `SELECT metadata_json FROM media_assets WHERE id = ? AND workspace_id = ? LIMIT 1`,
  )
    .bind(assetId, workspaceId)
    .first();
  if (!row) return;
  let meta = {};
  try {
    meta = JSON.parse(String(row.metadata_json || '{}'));
  } catch {
    meta = {};
  }
  const next = { ...meta, ...patch };
  await env.DB.prepare(
    `UPDATE media_assets SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND workspace_id = ?`,
  )
    .bind(JSON.stringify(next), assetId, workspaceId)
    .run();
}

/**
 * Background ingest hook after asset register.
 * @param {any} env
 * @param {Record<string, unknown>} asset
 */
export async function transcribeAndReindexMediaAsset(env, asset) {
  try {
    return await transcribeMediaAsset(env, asset, { force: false, reindex: true });
  } catch (e) {
    console.warn('[moviemode-whisper] ingest', String(e?.message || e).slice(0, 200));
    return { ok: false, error: String(e?.message || e) };
  }
}
