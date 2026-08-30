/**
 * Lane-aware embedding dispatch.
 *
 * The lane registry supplies provider/model/dimensions. This module only
 * validates the result and invokes the provider adapter.
 */
import { resolveGoogleAiApiKey } from './google-gemini.js';
import { GeminiEmbedding2Provider } from '../../services/memory/providers/gemini-embedding-2.js';
import { resolveRagLane } from '../lanes/registry.js';

export async function resolveEmbeddingSpec(env, laneName, options = {}) {
  const lane = await resolveRagLane(env, laneName);
  const taskType =
    lane.name === 'media'
      ? 'embeddings_multimodal'
      : lane.name === 'memory'
        ? 'memory_embed'
        : 'embeddings';
  const workspaceId = String(options.workspaceId ?? env?.WORKSPACE_ID ?? '').trim();
  const arm = await env.DB.prepare(
    `SELECT provider, model_key, model_catalog_id
       FROM agentsam_routing_arms
      WHERE task_type = ?
        AND (? = '' OR workspace_id = ?)
        AND COALESCE(is_active, 1) = 1
        AND COALESCE(is_eligible, 1) = 1
        AND COALESCE(is_paused, 0) = 0
        AND COALESCE(budget_exhausted, 0) = 0
      ORDER BY COALESCE(priority, 0) DESC, updated_at DESC
      LIMIT 1`,
  )
    .bind(taskType, workspaceId, workspaceId)
    .first()
    .catch(() => null);
  let provider = String(arm?.provider || '').trim().toLowerCase();
  let model = String(arm?.model_key || lane.embeddingModel || '').trim();
  if (arm?.model_catalog_id) {
    const catalog = await env.DB.prepare(
      `SELECT provider, model_key FROM agentsam_model_catalog
        WHERE id = ? AND COALESCE(is_active, 1) = 1 LIMIT 1`,
    )
      .bind(String(arm.model_catalog_id))
      .first()
      .catch(() => null);
    if (catalog?.provider) provider = String(catalog.provider).trim().toLowerCase();
    if (catalog?.model_key) model = String(catalog.model_key).trim();
  }
  if (!provider || !model) throw new Error(`rag_embedding_arm_required:${lane.name}`);
  return {
    lane,
    provider,
    model,
    dimensions: lane.dimensions,
  };
}

export function assertEmbeddingDimensions(embedding, expected) {
  if (!Array.isArray(embedding) || embedding.length !== Number(expected) || !embedding.every(Number.isFinite)) {
    throw new Error(`rag_embedding_dimension_mismatch:expected=${expected}:actual=${embedding?.length ?? 0}`);
  }
  return embedding;
}

export async function embedTextForLane(env, laneName, text, opts = {}) {
  const spec =
    opts.spec ||
    (await resolveEmbeddingSpec(env, laneName, {
      workspaceId: opts.workspaceId,
    }));
  const provider = String(spec.provider || '').toLowerCase();
  if (provider !== 'google') {
    throw new Error(`rag_embedding_provider_unsupported:${provider || 'unknown'}`);
  }

  const apiKey = await resolveGoogleAiApiKey(env, opts.userId ?? null);
  const adapter = new GeminiEmbedding2Provider({
    apiKey,
    model: String(spec.model || '').replace(/^models\//, ''),
    dimensions: spec.dimensions,
    fetchImpl: opts.fetchImpl || globalThis.fetch,
  });
  const embedding =
    opts.taskType === 'RETRIEVAL_QUERY'
      ? await adapter.embedQuery(text)
      : await adapter.embedDocument(text);
  return {
    embedding: assertEmbeddingDimensions(embedding, spec.dimensions),
    provider,
    model: spec.model,
    dimensions: spec.dimensions,
  };
}
