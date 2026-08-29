import { GoogleGenAI } from '@google/genai';
import { resolveProviderCredential } from '../../credentials/provider-credential.js';

function normalizeProvider(value) {
  return String(value || '').trim().toLowerCase().replace(/-/g, '_');
}

function vectorFromWorkersAi(result) {
  const data = result?.data ?? result?.result?.data ?? result?.result ?? result;
  if (Array.isArray(data) && Array.isArray(data[0])) return data[0];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.[0])) return data[0];
  return null;
}

async function embedGoogle(env, route, text, actor) {
  const apiKey = await resolveProviderCredential(env, {
    userId: actor?.userId,
    tenantId: actor?.tenantId,
    provider: 'google',
  });
  if (!apiKey) throw new Error('google_embedding_credential_unavailable');
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.embedContent({
    model: route.model,
    contents: text,
    config: {
      outputDimensionality: route.dimensions,
      taskType: 'RETRIEVAL_QUERY',
    },
  });
  return response?.embedding?.values || response?.embeddings?.[0]?.values || null;
}

async function embedOpenAI(env, route, text, actor) {
  const apiKey = await resolveProviderCredential(env, {
    userId: actor?.userId,
    tenantId: actor?.tenantId,
    provider: 'openai',
  });
  if (!apiKey) throw new Error('openai_embedding_credential_unavailable');
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: route.model, input: text, dimensions: route.dimensions }),
  });
  if (!response.ok) throw new Error(`openai_embedding_http_${response.status}`);
  const payload = await response.json();
  return payload?.data?.[0]?.embedding || null;
}

async function embedWorkersAI(env, route, text) {
  if (!env?.AGENTSAM_WAI?.run) throw new Error('workers_ai_binding_unavailable');
  const result = await env.AGENTSAM_WAI.run(route.model, { text: [text] });
  return vectorFromWorkersAi(result);
}

/** Provider-neutral query embedding. The route is authoritative; no fallback provider/model. */
export async function embedQueryForRoute(env, route, text, actor = {}) {
  const query = String(text || '').trim();
  if (!query) throw new Error('embedding_query_required');
  const provider = normalizeProvider(route?.provider);
  let vector;
  if (provider === 'google') vector = await embedGoogle(env, route, query, actor);
  else if (provider === 'openai') vector = await embedOpenAI(env, route, query, actor);
  else if (provider === 'workers_ai') vector = await embedWorkersAI(env, route, query);
  else throw new Error(`embedding_provider_unsupported:${provider || 'missing'}`);

  if (!Array.isArray(vector)) throw new Error('embedding_vector_missing');
  if (vector.length !== route.dimensions) {
    throw new Error(`embedding_dimensions_mismatch:${route.dimensions}:${vector.length}`);
  }
  if (!vector.every((value) => Number.isFinite(Number(value)))) throw new Error('embedding_vector_non_finite');
  return {
    vector: vector.map(Number),
    provider,
    model: route.model,
    dimensions: route.dimensions,
    embeddingSpaceKey: route.embeddingSpaceKey,
    routeKey: route.routeKey,
  };
}
