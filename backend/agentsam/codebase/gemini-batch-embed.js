/**
 * Gemini Batch Mode for embeddings (50% of online rate).
 * REST: models/{model}:asyncBatchEmbedContent + batches.get
 * Not the same as online models.batchEmbedContents (still interactive pricing).
 */

function googleEmbeddingApiModelId(modelKey) {
  const model = String(modelKey || 'gemini-embedding-2').trim().replace(/^models\//, '');
  return model || 'gemini-embedding-2';
}

function estimateTokensLocal(text) {
  return Math.max(1, Math.ceil(String(text ?? '').length / 4));
}

const TERMINAL = new Set([
  'JOB_STATE_SUCCEEDED',
  'JOB_STATE_FAILED',
  'JOB_STATE_CANCELLED',
  'JOB_STATE_EXPIRED',
  'BATCH_STATE_SUCCEEDED',
  'BATCH_STATE_FAILED',
  'BATCH_STATE_CANCELLED',
  'BATCH_STATE_EXPIRED',
]);

const DEFAULT_POLL_MS = 5_000;
/** Queue consumer budget — small inline batches usually finish well under this. */
const DEFAULT_MAX_WAIT_MS = 600_000;
const DEFAULT_INLINE_CAP = 64;

/**
 * @param {any} env
 * @param {string|null|undefined} userId
 */
async function resolveGoogleAiApiKey(env, userId) {
  const fromEnv = String(
    env?.GOOGLE_AI_API_KEY || env?.GEMINI_API_KEY || env?.GOOGLE_API_KEY || '',
  ).trim();
  if (fromEnv) return fromEnv;
  const { resolveApiKey } = await import('../../../src/core/vault.js');
  return (await resolveApiKey(env, userId, 'GOOGLE_AI_API_KEY')) || null;
}

/**
 * @param {unknown} state
 */
export function isGeminiBatchTerminalState(state) {
  const s = String(state || '')
    .trim()
    .toUpperCase();
  return TERMINAL.has(s) || /SUCCEEDED|FAILED|CANCELLED|CANCELED|EXPIRED/i.test(s);
}

/**
 * @param {unknown} state
 */
export function isGeminiBatchSucceededState(state) {
  const s = String(state || '')
    .trim()
    .toUpperCase();
  return s.includes('SUCCEEDED');
}

/**
 * @param {string[]} texts
 * @param {{ modelId: string, dimensions: number, taskType?: string }} opts
 */
export function buildGeminiAsyncBatchEmbedBody(texts, opts) {
  const modelId = googleEmbeddingApiModelId(opts.modelId);
  const dim = Number(opts.dimensions) || 1536;
  const taskType = opts.taskType || 'RETRIEVAL_DOCUMENT';
  const list = (Array.isArray(texts) ? texts : []).map((t) => String(t ?? '').trim()).filter(Boolean);
  // REST JSON uses camelCase (proto3 JSON mapping).
  return {
    batch: {
      displayName: `code_index_embed_${Date.now()}`,
      inputConfig: {
        requests: {
          requests: list.map((text, i) => ({
            request: {
              model: `models/${modelId}`,
              content: { parts: [{ text }] },
              taskType,
              outputDimensionality: dim,
            },
            metadata: { key: String(i) },
          })),
        },
      },
    },
  };
}

/**
 * @param {any} job
 * @returns {string|null}
 */
export function geminiBatchNameFromJob(job) {
  if (!job || typeof job !== 'object') return null;
  const name =
    job.name != null
      ? String(job.name).trim()
      : job.batch?.name != null
        ? String(job.batch.name).trim()
        : '';
  if (name) return name.startsWith('batches/') ? name : `batches/${name}`;
  return null;
}

/**
 * @param {any} job
 */
export function geminiBatchStateFromJob(job) {
  if (!job || typeof job !== 'object') return '';
  const state = job.state ?? job.batch?.state ?? job.metadata?.state ?? '';
  if (state && typeof state === 'object' && state.name != null) return String(state.name);
  return String(state || '');
}

/**
 * Pull embedding vectors in request order from a succeeded batch job payload.
 * @param {any} job
 * @param {number} expected
 * @returns {number[][]}
 */
export function extractGeminiBatchEmbeddings(job, expected) {
  const n = Math.max(0, Number(expected) || 0);
  /** @type {number[][]} */
  const out = new Array(n).fill(null);

  const tryAssign = (idx, emb) => {
    if (!Number.isFinite(idx) || idx < 0 || idx >= n) return;
    let values = emb?.values ?? emb?.embedding?.values ?? emb;
    if (!Array.isArray(values) && Array.isArray(emb?.embedding)) values = emb.embedding;
    if (Array.isArray(values) && values.length) out[idx] = values.map(Number);
  };

  const unwrapInline = (node) => {
    if (!node) return null;
    if (Array.isArray(node)) return node;
    if (Array.isArray(node.inlinedResponses)) return node.inlinedResponses;
    if (Array.isArray(node.inlined_responses)) return node.inlined_responses;
    return null;
  };

  const inline =
    unwrapInline(job?.response?.inlinedResponses) ||
    unwrapInline(job?.response?.inlined_responses) ||
    unwrapInline(job?.batch?.output?.inlinedResponses) ||
    unwrapInline(job?.batch?.output?.inlined_responses) ||
    unwrapInline(job?.output?.inlinedResponses) ||
    unwrapInline(job?.output?.inlined_responses) ||
    unwrapInline(job?.dest?.inlinedResponses) ||
    unwrapInline(job?.dest?.inlined_responses);

  if (Array.isArray(inline)) {
    for (let i = 0; i < inline.length; i += 1) {
      const row = inline[i];
      const key = Number(row?.metadata?.key ?? row?.key ?? i);
      const emb =
        row?.response?.embedding ||
        row?.embedding ||
        row?.response?.embeddings?.[0] ||
        null;
      if (row?.error) continue;
      tryAssign(Number.isFinite(key) ? key : i, emb);
    }
  }

  const embeddings =
    job?.response?.embeddings ||
    job?.batch?.output?.embeddings ||
    job?.output?.embeddings;
  if (Array.isArray(embeddings)) {
    for (let i = 0; i < embeddings.length; i += 1) {
      if (!out[i]) tryAssign(i, embeddings[i]);
    }
  }

  for (let i = 0; i < n; i += 1) {
    if (!Array.isArray(out[i]) || !out[i].length) {
      const e = new Error(`gemini_batch_embed_missing_vector:${i}`);
      e.code = 'gemini_batch_embed_incomplete';
      throw e;
    }
  }
  return out;
}

/**
 * @param {any} env
 * @param {string[]} texts
 * @param {{
 *   spec: { provider: string, model: string, modelKey?: string, dimensions: number },
 *   userId?: string|null,
 *   displayName?: string,
 *   maxWaitMs?: number,
 *   pollMs?: number,
 *   inlineCap?: number,
 *   usage?: false | Record<string, unknown>,
 * }} opts
 * @returns {Promise<Array<{ embedding: number[], provider: string, model: string, batch_name: string }>>}
 */
export async function embedTextsViaGeminiBatchMode(env, texts, opts) {
  const list = (Array.isArray(texts) ? texts : []).map((t) => String(t ?? '').trim()).filter(Boolean);
  if (!list.length) return [];

  const cap = Math.max(1, Number(opts.inlineCap) || DEFAULT_INLINE_CAP);
  if (list.length > cap) {
    /** @type {Array<{ embedding: number[], provider: string, model: string, batch_name: string }>} */
    const all = [];
    for (let i = 0; i < list.length; i += cap) {
      const slice = list.slice(i, i + cap);
      const part = await embedTextsViaGeminiBatchMode(env, slice, opts);
      all.push(...part);
    }
    return all;
  }

  const spec = opts.spec;
  if (!spec || String(spec.provider || '').toLowerCase() !== 'google') {
    const e = new Error('gemini_batch_embed_requires_google_spec');
    e.code = 'gemini_batch_embed_requires_google_spec';
    throw e;
  }

  const apiKey = await resolveGoogleAiApiKey(env, opts.userId ?? null);
  if (!apiKey) {
    const e = new Error('gemini_batch_embed_api_key_required');
    e.code = 'gemini_batch_embed_api_key_required';
    throw e;
  }

  const modelId = googleEmbeddingApiModelId(spec.model);
  const dim = Number(spec.dimensions) || 1536;
  const body = buildGeminiAsyncBatchEmbedBody(list, {
    modelId,
    dimensions: dim,
  });
  if (opts.displayName) {
    const name = String(opts.displayName).slice(0, 120);
    body.batch.displayName = name;
    body.batch.display_name = name;
  }

  const submitUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:asyncBatchEmbedContent?key=${encodeURIComponent(apiKey)}`;
  const submitRes = await fetch(submitUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const submitJson = await submitRes.json().catch(() => ({}));
  if (!submitRes.ok) {
    const e = new Error(
      submitJson?.error?.message || `gemini_batch_submit_http_${submitRes.status}`,
    );
    e.code = 'gemini_batch_submit_failed';
    e.status = submitRes.status;
    throw e;
  }

  let job = submitJson;
  let batchName = geminiBatchNameFromJob(job);
  if (!batchName && submitJson?.name) {
    batchName = geminiBatchNameFromJob(submitJson);
  }
  if (!batchName) {
    const e = new Error('gemini_batch_name_missing');
    e.code = 'gemini_batch_name_missing';
    throw e;
  }

  const maxWaitMs = Math.max(5_000, Number(opts.maxWaitMs) || DEFAULT_MAX_WAIT_MS);
  const pollMs = Math.max(1_000, Number(opts.pollMs) || DEFAULT_POLL_MS);
  const started = Date.now();

  while (!isGeminiBatchTerminalState(geminiBatchStateFromJob(job))) {
    if (Date.now() - started > maxWaitMs) {
      const e = new Error(`gemini_batch_embed_timeout:${batchName}`);
      e.code = 'gemini_batch_embed_timeout';
      e.batch_name = batchName;
      throw e;
    }
    await new Promise((r) => setTimeout(r, pollMs));
    const getUrl = `https://generativelanguage.googleapis.com/v1beta/${batchName}?key=${encodeURIComponent(apiKey)}`;
    const getRes = await fetch(getUrl, { method: 'GET' });
    const getJson = await getRes.json().catch(() => ({}));
    if (!getRes.ok) {
      const e = new Error(getJson?.error?.message || `gemini_batch_get_http_${getRes.status}`);
      e.code = 'gemini_batch_get_failed';
      e.batch_name = batchName;
      throw e;
    }
    job = getJson;
  }

  const state = geminiBatchStateFromJob(job);
  if (!isGeminiBatchSucceededState(state)) {
    const e = new Error(`gemini_batch_embed_failed:${state}`);
    e.code = 'gemini_batch_embed_failed';
    e.batch_name = batchName;
    e.detail = job?.error || job?.batch?.error || null;
    throw e;
  }

  const vectors = extractGeminiBatchEmbeddings(job, list.length);
  const tokensIn = list.reduce((sum, t) => sum + estimateTokensLocal(t), 0);

  if (opts.usage !== false && opts.usage && typeof opts.usage === 'object') {
    try {
      const { logEmbeddingUsageEvent } = await import('./embedding-usage.js');
      await logEmbeddingUsageEvent(env, {
        ...opts.usage,
        model: modelId,
        model_key: spec.modelKey || modelId,
        provider: 'google',
        tokens_in: tokensIn,
        task_type: opts.usage.task_type || 'codebase_full_batch_embed',
        pricing_kind: 'batch',
        ctx: {
          ...(opts.usage.ctx && typeof opts.usage.ctx === 'object' ? opts.usage.ctx : {}),
          pricing_kind: 'batch',
          gemini_batch_name: batchName,
        },
      });
    } catch (e) {
      console.warn('[gemini-batch-embed] usage log failed', e?.message ?? e);
    }
  }

  // Explicit batch-priced rollup (embedding-usage defaults pricingKind=embedding).
  try {
    const { resolveUsageEventCostUsd } = await import('../../telemetry/pricing.js');
    const priced = await resolveUsageEventCostUsd(env?.DB, {
      modelKey: spec.modelKey || modelId,
      provider: 'google',
      inputTokens: tokensIn,
      outputTokens: 0,
      pricingKind: 'batch',
    });
    if (opts.usage && typeof opts.usage === 'object') {
      opts.usage._batch_cost_usd = Number(priced.costUsd) || 0;
      opts.usage._batch_name = batchName;
      opts.usage._batch_tokens_in = tokensIn;
    }
  } catch {
    /* non-fatal */
  }

  return vectors.map((embedding) => ({
    embedding,
    provider: 'google',
    model: modelId,
    batch_name: batchName,
  }));
}
