/** Online embedding adapter for the D1-resolved code-index lane. */
import { embedTextWithSpec } from '../../rag/embeddings/provider.js';

export async function createCodeIndexEmbedding(env, text, opts = {}) {
  const spec = opts.spec;
  const provider = String(spec?.provider || '').trim().toLowerCase();
  const model = String(spec?.model ?? spec?.modelKey ?? '').trim();
  const dimensions = Number(spec?.dimensions);
  if (!provider || !model || !Number.isInteger(dimensions) || dimensions <= 0) {
    const error = new Error('code_index_embedding_spec_required');
    error.code = 'code_index_embedding_spec_required';
    throw error;
  }
  return embedTextWithSpec(env, text, { provider, model, dimensions }, {
    userId: opts.userId ?? null,
    tenantId: opts.tenantId ?? null,
    taskType: opts.taskType,
    fetchImpl: opts.fetchImpl,
  });
}
