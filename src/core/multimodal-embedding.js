/**
 * Gemini gemini-embedding-2 multimodal embed parts (image/audio/video/PDF).
 * Separate Vectorize index only — never mix with OpenAI text-embedding-3-large vectors.
 */
import {
  embeddingPolicy,
  googleEmbeddingApiModelId,
  resolveMultimodalEmbeddingRoute,
  EMBEDDING_DIMS,
} from './embedding-routes.js';

export const MULTIMODAL_EMBED_DIMS = EMBEDDING_DIMS.balancedProductionRag;

/** @typedef {{ type: 'text', text: string }} MultimodalTextPart */
/** @typedef {{ type: 'inline_data', mimeType: string, data: ArrayBuffer | Uint8Array | string }} MultimodalInlinePart */
/** @typedef {MultimodalTextPart | MultimodalInlinePart} MultimodalContentPart */

const DEFAULT_MAX_INLINE_BYTES = 20 * 1024 * 1024;

const MIME_BY_MEDIA_KIND = Object.freeze({
  video: 'video/mp4',
  image: 'image/jpeg',
  audio: 'audio/mpeg',
  text: 'text/plain',
  binary: 'application/octet-stream',
});

const EMBEDDABLE_MIME_PREFIXES = ['image/', 'audio/', 'video/', 'application/pdf'];

/**
 * @param {string} [contentType]
 * @param {string} [mediaKind]
 * @param {string} [filename]
 */
export function resolveMediaMimeType(contentType, mediaKind, filename) {
  const ct = String(contentType || '').trim().toLowerCase();
  if (ct && ct !== 'application/octet-stream') return ct;
  const kind = String(mediaKind || '').trim().toLowerCase();
  if (MIME_BY_MEDIA_KIND[kind]) return MIME_BY_MEDIA_KIND[kind];
  const ext = String(filename || '').split('.').pop()?.toLowerCase();
  if (ext === 'mp4' || ext === 'mov') return 'video/mp4';
  if (ext === 'webm') return 'video/webm';
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'wav') return 'audio/wav';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  return ct || 'application/octet-stream';
}

/** @param {string} mime */
export function isEmbeddableMediaMime(mime) {
  const m = String(mime || '').trim().toLowerCase();
  if (!m) return false;
  return EMBEDDABLE_MIME_PREFIXES.some((p) => (p.endsWith('/') ? m.startsWith(p) : m === p));
}

/**
 * @param {ArrayBuffer | Uint8Array} bytes
 * @returns {string}
 */
export function bytesToBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * @param {MultimodalContentPart[]} parts
 * @returns {Record<string, unknown>[]}
 */
export function geminiEmbedPartsFromContent(parts) {
  if (!Array.isArray(parts) || !parts.length) throw new Error('multimodal parts required');
  /** @type {Record<string, unknown>[]} */
  const out = [];
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text') {
      const t = String(part.text || '').trim();
      if (t) out.push({ text: t });
      continue;
    }
    if (part.type === 'inline_data') {
      const mimeType = String(part.mimeType || '').trim().toLowerCase();
      if (!mimeType) throw new Error('inline_data mimeType required');
      if (!isEmbeddableMediaMime(mimeType)) {
        throw new Error(`unsupported embed mime: ${mimeType}`);
      }
      let data = '';
      if (typeof part.data === 'string') {
        data = part.data.replace(/\s/g, '');
      } else if (part.data instanceof ArrayBuffer || part.data instanceof Uint8Array) {
        data = bytesToBase64(part.data);
      } else {
        throw new Error('inline_data requires base64 string or ArrayBuffer');
      }
      if (!data) throw new Error('inline_data empty');
      out.push({ inline_data: { mime_type: mimeType, data } });
    }
  }
  if (!out.length) throw new Error('no valid multimodal parts');
  return out;
}

/**
 * @param {any} env
 * @param {{ text?: string, parts?: MultimodalContentPart[], dimensions?: number, modelKey?: string }} opts
 * @returns {Promise<{ embedding: number[], provider: 'google', model: string, dimensions: number }>}
 */
export async function embedMultimodalContent(env, opts = {}) {
  const route = resolveMultimodalEmbeddingRoute();
  const apiKey = String(
    env?.GOOGLE_AI_API_KEY || env?.GEMINI_API_KEY || env?.GOOGLE_API_KEY || '',
  ).trim();
  if (!apiKey) {
    throw new Error(
      `multimodal_embedding_unavailable: ${embeddingPolicy.multimodalAssetSearch} requires Google API key`,
    );
  }

  const dim = Number(
    opts.dimensions || env?.RAG_MULTIMODAL_EMBEDDING_DIMENSIONS || route.dimensions || MULTIMODAL_EMBED_DIMS,
  );
  const modelId = googleEmbeddingApiModelId(
    opts.modelKey || env?.RAG_MULTIMODAL_EMBEDDING_MODEL || route.model,
  );

  /** @type {MultimodalContentPart[]} */
  const merged = [];
  const textCue = String(opts.text || '').trim();
  if (textCue) merged.push({ type: 'text', text: textCue });
  if (Array.isArray(opts.parts)) merged.push(...opts.parts);

  const geminiParts = geminiEmbedPartsFromContent(merged);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:embedContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${modelId}`,
      content: { parts: geminiParts },
      outputDimensionality: dim,
    }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(d?.error?.message || `Gemini embed HTTP ${res.status}`);
  }
  let emb = d?.embedding?.values;
  if (!Array.isArray(emb) && Array.isArray(d?.embedding)) emb = d.embedding;
  if (!Array.isArray(emb) || emb.length !== dim) {
    throw new Error(`Gemini embed: expected ${dim} dimensions, got ${emb?.length ?? 0}`);
  }
  return { embedding: emb, provider: 'google', model: modelId, dimensions: dim };
}

/**
 * Build parts from raw media bytes + optional caption/transcript.
 * @param {{ bytes: ArrayBuffer, mimeType: string, caption?: string, maxBytes?: number }} opts
 * @returns {MultimodalContentPart[]}
 */
export function buildMediaEmbedParts(opts) {
  const maxBytes = Number(opts.maxBytes) > 0 ? Number(opts.maxBytes) : DEFAULT_MAX_INLINE_BYTES;
  const mimeType = String(opts.mimeType || '').trim().toLowerCase();
  /** @type {MultimodalContentPart[]} */
  const parts = [];
  const caption = String(opts.caption || '').trim();
  if (caption) parts.push({ type: 'text', text: caption });

  if (opts.bytes && opts.bytes.byteLength > 0) {
    if (opts.bytes.byteLength > maxBytes) {
      throw new Error(`media_too_large_for_embed: ${opts.bytes.byteLength} > ${maxBytes}`);
    }
    if (!isEmbeddableMediaMime(mimeType)) {
      throw new Error(`mime_not_embeddable: ${mimeType}`);
    }
    parts.push({ type: 'inline_data', mimeType, data: opts.bytes });
  }

  if (!parts.length) throw new Error('media embed requires caption or embeddable bytes');
  return parts;
}
