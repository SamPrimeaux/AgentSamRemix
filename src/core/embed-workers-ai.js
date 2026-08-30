/**
 * Text embeddings for docs / memory / skills Vectorize lanes.
 *
 * Historical export name only; actual provider/model is resolved by the `docs` RAG lane.
 *
 * Historical export name `generateWorkersAiEmbedding` is kept so cron/tool
 * imports keep working; the implementation is OpenAI-only.
 */
import { embedTextForLane } from '../../backend/rag/embeddings/lane-router.js';

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
    const { embedding } = await embedTextForLane(env, 'docs', input);
    if (!Array.isArray(embedding) || !embedding.length) {
      throw new Error('No embeddings returned');
    }
    vectors.push(embedding);
  }
  return batch ? vectors : vectors[0];
}
