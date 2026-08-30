/**
 * Gemini text embeddings for backend lanes that are NOT going through
 * Workers AI billing — direct Google Generative Language API.
 *
 * Currently used by: Agent Sam memory lane (agentsam-memory-outbox.js),
 * branched here because OpenAI credits ran out 2026-08 and Cloudflare
 * Workers AI billing is intentionally avoided for this path.
 *
 * Mirrors the existing code-index Gemini call in
 * src/core/agentsam-vectorize.js (embedGoogleText) but lives in /backend
 * as a self-contained module — no dependency on that file's private
 * helpers, so this lane can evolve independently.
 *
 * SSOT: docs/platform/memory-embedding-gemini-lane-2026-08.md
 * Never mix vector spaces in one Vectorize index — see EMBEDDING_POLICY below.
 */
import { resolveApiKey } from '../../../src/core/vault.js';

export const GEMINI_EMBED_MODEL = 'gemini-embedding-2';
export const GEMINI_EMBED_DIMENSIONS = 1536;

export const EMBEDDING_POLICY = Object.freeze({
  provider: 'google',
  model: GEMINI_EMBED_MODEL,
  dimensions: GEMINI_EMBED_DIMENSIONS,
  version: 'gemini2_1536_v1',
  migrationRule: 'do not mix vectors; this lane writes to its own Vectorize index only',
});

/**
 * Resolve Google AI key — platform Wrangler secret first, then BYOK vault.
 * @param {any} env
 * @param {string|null|undefined} [userId]
 * @returns {Promise<string>}
 */
export async function resolveGoogleAiApiKey(env, userId = null) {
  const fromEnv = String(
    env?.GOOGLE_AI_API_KEY || env?.GEMINI_API_KEY || env?.GOOGLE_API_KEY || '',
  ).trim();
  if (fromEnv) return fromEnv;
  const fromVault = await resolveApiKey(env, userId, 'GOOGLE_AI_API_KEY');
  return fromVault != null ? String(fromVault).trim() : '';
}

/**
 * Single text embed via Gemini embedContent.
 * @param {any} env
 * @param {string} text
 * @param {{ userId?: string|null, taskType?: 'RETRIEVAL_QUERY'|'RETRIEVAL_DOCUMENT' }} [opts]
 * @returns {Promise<{ embedding: number[], provider: 'google', model: string, dimensions: number }>}
 */
export async function embedTextGemini(env, text, opts = {}) {
  const input = String(text ?? '').trim();
  if (!input) throw new Error('embedding input required');

  const apiKey = await resolveGoogleAiApiKey(env, opts.userId ?? null);
  if (!apiKey) {
    throw new Error('Google AI API key required for gemini-embedding-2 memory embeds');
  }

  const taskType =
    opts.taskType === 'RETRIEVAL_QUERY' || opts.taskType === 'RETRIEVAL_DOCUMENT'
      ? opts.taskType
      : 'RETRIEVAL_DOCUMENT';

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBED_MODEL}:embedContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${GEMINI_EMBED_MODEL}`,
      content: { parts: [{ text: input }] },
      outputDimensionality: GEMINI_EMBED_DIMENSIONS,
      taskType,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Gemini embed HTTP ${res.status}`);
    if (res.status === 429) {
      err.code = 'embedding_quota_exhausted';
      err.status = 429;
    }
    throw err;
  }

  let embedding = data?.embedding?.values;
  if (!Array.isArray(embedding) && Array.isArray(data?.embedding)) embedding = data.embedding;
  if (!Array.isArray(embedding) || embedding.length !== GEMINI_EMBED_DIMENSIONS) {
    throw new Error(
      `Gemini embed dimension mismatch: got ${embedding?.length ?? 0}, expected ${GEMINI_EMBED_DIMENSIONS}`,
    );
  }

  return {
    embedding,
    provider: 'google',
    model: GEMINI_EMBED_MODEL,
    dimensions: GEMINI_EMBED_DIMENSIONS,
  };
}
