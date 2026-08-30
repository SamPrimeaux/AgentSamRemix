/** Provider adapters receive a D1-resolved model spec; they never choose one. */
import { resolveProviderCredential } from '../../credentials/provider-credential.js';

function normalizeProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  if (provider !== 'google' && provider !== 'openai') {
    throw new Error(`rag_embedding_provider_unsupported:${provider || 'unknown'}`);
  }
  return provider;
}

function normalizeModel(value, provider) {
  const model = String(value || '').trim();
  if (!model) throw new Error('rag_embedding_model_required');
  return provider === 'google' ? model.replace(/^models\//i, '') : model;
}

function requireDimensions(value) {
  const dimensions = Number(value);
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error('rag_embedding_dimensions_required');
  }
  return dimensions;
}

async function credentialFor(env, provider, opts) {
  const value = await resolveProviderCredential(env, {
    userId: opts.userId ?? null,
    tenantId: opts.tenantId ?? null,
    provider,
  });
  if (!value) throw new Error(`rag_embedding_credential_required:${provider}`);
  return String(value);
}

export async function embedTextWithSpec(env, text, spec, opts = {}) {
  const input = String(text ?? '').trim();
  if (!input) throw new Error('embedding_input_required');
  const provider = normalizeProvider(spec?.provider);
  const model = normalizeModel(spec?.model ?? spec?.modelKey, provider);
  const dimensions = requireDimensions(spec?.dimensions);
  const apiKey = await credentialFor(env, provider, opts);
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('embedding_fetch_required');

  let embedding;
  if (provider === 'google') {
    const taskType =
      opts.taskType === 'RETRIEVAL_QUERY' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT';
    const response = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:embedContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: `models/${model}`,
          content: { parts: [{ text: input }] },
          outputDimensionality: dimensions,
          taskType,
          ...(opts.title && taskType === 'RETRIEVAL_DOCUMENT' ? { title: String(opts.title) } : {}),
        }),
      },
    );
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(json?.error?.message || `google_embedding_http_${response.status}`);
      error.status = response.status;
      if (response.status === 429) error.code = 'embedding_quota_exhausted';
      throw error;
    }
    embedding = json?.embedding?.values ?? json?.embedding;
  } else {
    const response = await fetchImpl('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model, input, dimensions }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(json?.error?.message || `openai_embedding_http_${response.status}`);
      error.status = response.status;
      if (response.status === 429) error.code = 'embedding_quota_exhausted';
      throw error;
    }
    embedding = json?.data?.[0]?.embedding;
  }

  if (!Array.isArray(embedding) || embedding.length !== dimensions || !embedding.every(Number.isFinite)) {
    throw new Error(
      `rag_embedding_dimension_mismatch:expected=${dimensions}:actual=${embedding?.length ?? 0}`,
    );
  }

  return { embedding, provider, model, dimensions };
}

export function createEmbeddingProvider(env, spec, opts = {}) {
  return {
    async embedDocument(text, extra = {}) {
      const result = await embedTextWithSpec(env, text, spec, {
        ...opts,
        ...extra,
        taskType: 'RETRIEVAL_DOCUMENT',
      });
      return result.embedding;
    },
    async embedQuery(text) {
      const result = await embedTextWithSpec(env, text, spec, {
        ...opts,
        taskType: 'RETRIEVAL_QUERY',
      });
      return result.embedding;
    },
  };
}
