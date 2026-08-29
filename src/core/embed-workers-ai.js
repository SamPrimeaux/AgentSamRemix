/**
 * Text embeddings for docs / memory / skills Vectorize lanes.
 *
 * SSOT (tkt_embed_ssot_openai): OpenAI text-embedding-3-large @ 1536 via
 * createAgentsamEmbedding — never Workers AI bge-m3 on this path.
 *
 * Historical export name `generateWorkersAiEmbedding` is kept so cron/tool
 * imports keep working; the implementation is OpenAI-only.
 */
import { createAgentsamEmbedding } from './agentsam-vectorize.js';

/**
 * @param {any} env
 * @param {string|string[]} text Single string or batch of strings.
 * @returns {Promise<number[]|number[][]>}
 */
export async function generateWorkersAiEmbedding(env, text) {
  return generateSsotTextEmbedding(env, text);
}

/**
 * @param {any} env
 * @param {string|string[]} text
 * @returns {Promise<number[]|number[][]>}
 */
export async function generateSsotTextEmbedding(env, text) {
  const batch = Array.isArray(text);
  const inputs = (batch ? text : [text]).map((t) => String(t ?? ''));
  if (!inputs.length) throw new Error('embedding input required');

  const vectors = [];
  for (const input of inputs) {
    const { embedding } = await createAgentsamEmbedding(env, input);
    if (!Array.isArray(embedding) || !embedding.length) {
      throw new Error('No embeddings returned');
    }
    vectors.push(embedding);
  }
  return batch ? vectors : vectors[0];
}
