/**
 * Online embedding adapter for the code-index lane.
 *
 * Full-index Google batches use gemini-batch-embed.js. Incremental and
 * single-item paths use this adapter so codebase orchestration stays under
 * backend ownership.
 */
import { embedTextGemini } from '../../embeddings/google-gemini-embed.js';

/**
 * @param {any} env
 * @param {string} text
 * @param {{ spec?: { provider?: string }, userId?: string|null, taskType?: string }} [opts]
 */
export async function createCodeIndexEmbedding(env, text, opts = {}) {
  const provider = String(opts.spec?.provider || 'google').toLowerCase();
  if (provider !== 'google') {
    const error = new Error(`code_index_online_embed_provider_unsupported:${provider}`);
    error.code = 'code_index_online_embed_provider_unsupported';
    throw error;
  }
  return embedTextGemini(env, text, {
    userId: opts.userId ?? null,
    taskType: opts.taskType,
  });
}
