/**
 * Explicit-spec embedding executor retained for legacy code-index callers.
 * Model selection is NOT owned here: callers must pass opts.spec resolved from D1.
 */
import { assertAgentsamEmbeddingDimensions } from './agentsam-vectorize-index.js';
import {
  OPENAI_AGENTSAM_GPT_TIER_SECRET,
  OPENAI_PLATFORM_DEFAULT_SECRET,
  resolveOpenAiApiKey,
} from '../integrations/openai-credentials.js';
import { resolveApiKey } from './vault.js';
import { logEmbeddingUsageEvent, resolveEmbedTokensIn } from './embedding-usage.js';

export function isOpenAiBillingOrQuotaError(err) {
  const t = String(
    err && typeof err === 'object' && 'message' in err ? err.message : err || '',
  ).toLowerCase();
  if (!t) return false;
  return (
    t.includes('exceeded your current quota') ||
    t.includes('insufficient_quota') ||
    t.includes('billing_hard_limit') ||
    t.includes('billing hard limit') ||
    /\b429\b/.test(t) ||
    (t.includes('rate limit') && t.includes('openai'))
  );
}

function requireEmbeddingSpec(spec) {
  const provider = String(spec?.provider || '').trim().toLowerCase();
  const model = String(spec?.model || spec?.modelKey || '').trim();
  const dimensions = Number(spec?.dimensions);
  if (!provider || !model || !Number.isInteger(dimensions) || dimensions <= 0) {
    const error = new Error('embedding_spec_required');
    error.code = 'embedding_spec_required';
    throw error;
  }
  if (!['openai', 'google', 'workers_ai'].includes(provider)) {
    const error = new Error(`embedding_provider_unsupported:${provider}`);
    error.code = 'embedding_provider_unsupported';
    throw error;
  }
  return { ...spec, provider, model, dimensions };
}

async function resolveTenantIdForWorkspace(env, workspaceId) {
  const ws = workspaceId != null ? String(workspaceId).trim() : '';
  if (!env?.DB || !ws) return null;
  try {
    const row = await env.DB.prepare(`SELECT tenant_id FROM workspaces WHERE id = ? LIMIT 1`)
      .bind(ws)
      .first();
    return row?.tenant_id != null ? String(row.tenant_id).trim() : null;
  } catch {
    return null;
  }
}

async function maybeLogEmbedUsage(env, input, result, apiUsage, opts, startedAt) {
  const usage = opts?.usage;
  if (!usage || usage === false) return null;
  const workspaceId =
    usage.workspace_id != null
      ? String(usage.workspace_id).trim()
      : opts.workspaceId != null
        ? String(opts.workspaceId).trim()
        : '';
  let tenantId = usage.tenant_id != null ? String(usage.tenant_id).trim() : '';
  if (!tenantId && workspaceId) tenantId = (await resolveTenantIdForWorkspace(env, workspaceId)) || '';
  if (!workspaceId || !tenantId) return null;

  try {
    return await logEmbeddingUsageEvent(env, {
      workspace_id: workspaceId,
      tenant_id: tenantId,
      user_id: usage.user_id ?? opts.userId ?? null,
      session_id: usage.session_id ?? null,
      conversation_id: usage.conversation_id ?? null,
      task_type: usage.task_type || 'embed',
      tool_name: usage.tool_name ?? null,
      ref_table: usage.ref_table ?? null,
      ref_id: usage.ref_id ?? null,
      model: result.model,
      model_key: opts.spec?.modelKey || result.model,
      provider: result.provider,
      tokens_in: resolveEmbedTokensIn(input, apiUsage),
      duration_ms: Date.now() - startedAt,
      ctx: usage.ctx ?? opts.ctx ?? null,
    });
  } catch (error) {
    console.warn('[createAgentsamEmbedding] usage log failed', error?.message ?? error);
    return null;
  }
}

async function resolveGoogleAiApiKey(env, userId = null) {
  const fromEnv = String(
    env?.GOOGLE_AI_API_KEY || env?.GEMINI_API_KEY || env?.GOOGLE_API_KEY || '',
  ).trim();
  if (fromEnv) return fromEnv;
  const fromVault = await resolveApiKey(env, userId, 'GOOGLE_AI_API_KEY');
  return fromVault != null ? String(fromVault).trim() : '';
}

async function embedGoogleText(env, input, spec, opts = {}) {
  const apiKey = await resolveGoogleAiApiKey(env, opts.userId ?? null);
  if (!apiKey) throw new Error('Google AI API key required for resolved embedding route');
  const modelId = String(spec.model || '').trim().replace(/^models\//i, '');
  if (!modelId) throw new Error('google_embedding_model_required');
  const taskType =
    opts.taskType === 'RETRIEVAL_QUERY' || opts.taskType === 'RETRIEVAL_DOCUMENT'
      ? opts.taskType
      : 'RETRIEVAL_DOCUMENT';
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:embedContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${modelId}`,
        content: { parts: [{ text: input }] },
        outputDimensionality: spec.dimensions,
        taskType,
      }),
    },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Google embedding HTTP ${response.status}`);
    if (response.status === 429) {
      error.code = 'embedding_quota_exhausted';
      error.status = 429;
    }
    throw error;
  }
  const embedding = Array.isArray(data?.embedding?.values)
    ? data.embedding.values
    : Array.isArray(data?.embedding)
      ? data.embedding
      : null;
  assertAgentsamEmbeddingDimensions(embedding, spec.dimensions);
  return {
    embedding,
    provider: 'google',
    model: modelId,
    usage: null,
    tokens_in: resolveEmbedTokensIn(input, null),
  };
}

async function fetchOpenAiEmbedding(base, apiKey, body) {
  const response = await fetch(`${base}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, status: response.status, message: `OpenAI embeddings: non-JSON (${response.status})` };
  }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: data?.error?.message || `OpenAI embeddings HTTP ${response.status}`,
    };
  }
  return { ok: true, data };
}

export async function createAgentsamEmbedding(env, text, opts = {}) {
  const startedAt = Date.now();
  const spec = requireEmbeddingSpec(opts.spec);
  const input = String(text ?? '').trim();
  if (!input) throw new Error('embedding input required');

  if (spec.provider === 'workers_ai') {
    if (!env?.AI) throw new Error('Workers AI binding required for resolved embedding route');
    const response = await env.AI.run(spec.model, { text: [input] });
    const embedding = response?.data?.[0] ?? response?.result?.[0];
    assertAgentsamEmbeddingDimensions(embedding, spec.dimensions);
    const result = { embedding, provider: 'workers_ai', model: spec.model, usage: null };
    await maybeLogEmbedUsage(env, input, result, null, opts, startedAt);
    return result;
  }

  if (spec.provider === 'google') {
    const result = await embedGoogleText(env, input, spec, opts);
    await maybeLogEmbedUsage(env, input, result, null, opts, startedAt);
    return result;
  }

  const userId = opts.userId ?? null;
  const primaryKey = await resolveOpenAiApiKey(env, spec.model, userId);
  if (!primaryKey) throw new Error('OpenAI API key required for resolved embedding route');
  const base = String(env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1').trim().replace(/\/$/, '');
  const body = { model: spec.model, input, dimensions: spec.dimensions };
  const endUser = userId != null ? String(userId).trim() : '';
  if (endUser) body.user = endUser;

  let usedSecret = OPENAI_PLATFORM_DEFAULT_SECRET;
  let fetched = await fetchOpenAiEmbedding(base, primaryKey, body);
  if (!fetched.ok && isOpenAiBillingOrQuotaError(fetched.message)) {
    const altKey = await resolveApiKey(env, userId, OPENAI_AGENTSAM_GPT_TIER_SECRET);
    if (altKey && altKey !== primaryKey) {
      const retry = await fetchOpenAiEmbedding(base, altKey, body);
      fetched = retry;
      if (retry.ok) usedSecret = OPENAI_AGENTSAM_GPT_TIER_SECRET;
    }
  }
  if (!fetched.ok) {
    const error = new Error(fetched.message);
    if (isOpenAiBillingOrQuotaError(fetched.message)) {
      error.code = 'embedding_quota_exhausted';
      error.status = fetched.status;
    }
    throw error;
  }

  const embedding = fetched.data?.data?.[0]?.embedding;
  assertAgentsamEmbeddingDimensions(embedding, spec.dimensions);
  const apiUsage = fetched.data?.usage && typeof fetched.data.usage === 'object'
    ? {
        prompt_tokens: Number(fetched.data.usage.prompt_tokens) || 0,
        total_tokens: Number(fetched.data.usage.total_tokens) || 0,
      }
    : null;
  const result = {
    embedding,
    provider: 'openai',
    model: spec.model,
    usage: apiUsage,
    tokens_in: resolveEmbedTokensIn(input, apiUsage),
    secret_tier: usedSecret,
  };
  await maybeLogEmbedUsage(env, input, result, apiUsage, opts, startedAt);
  return result;
}
