/**
 * OpenAI Batch API → agentsam_usage_events (embed lane).
 *
 * Webhooks do not fire for sync /v1/embeddings. They do fire for Batch jobs
 * (including endpoint=/v1/embeddings). On batch.completed|failed|expired we
 * pull the batch + output JSONL, sum usage.prompt_tokens, and write one
 * idempotent usage row (ref_table=openai_batches, ref_id=batch_id).
 *
 * Batch embed pricing is ~50% of standard; we price with pricing_kind=embedding
 * then apply BATCH_EMBED_DISCOUNT unless catalog later grows a batch row.
 */
import { resolvePlatformWebhookScope } from '../services/webhooks/ledger.js';
import { resolveUsageEventCostUsd } from './pricing.js';
import { writeUsageEvent } from './usage-events.js';

const BATCH_EMBED_DISCOUNT = 0.5;
const REF_TABLE = 'openai_batches';

function resolveWebhookOpenAiApiKey(env) {
  const value = env?.OPENAI_API_KEY;
  return value != null && String(value).trim() ? String(value).trim() : null;
}

/**
 * @param {unknown} payload
 * @returns {{ eventType: string, batchId: string|null, eventId: string|null }}
 */
export function parseOpenAiBatchWebhookPayload(payload) {
  const p = payload && typeof payload === 'object' ? /** @type {Record<string, unknown>} */ (payload) : {};
  const eventType = String(p.type || '').trim().toLowerCase();
  const data = p.data && typeof p.data === 'object' ? /** @type {Record<string, unknown>} */ (p.data) : {};
  const batchId =
    (data.id != null && String(data.id).trim()) ||
    (p.batch_id != null && String(p.batch_id).trim()) ||
    null;
  const eventId = p.id != null ? String(p.id).trim() : null;
  return { eventType, batchId: batchId || null, eventId };
}

/**
 * @param {string} eventType
 */
export function isOpenAiBatchTerminalEvent(eventType) {
  const t = String(eventType || '').trim().toLowerCase();
  return (
    t === 'batch.completed' ||
    t === 'batch.failed' ||
    t === 'batch.expired' ||
    t === 'batch.cancelled'
  );
}

/**
 * @param {string} endpoint
 */
export function isEmbeddingsBatchEndpoint(endpoint) {
  const e = String(endpoint || '').trim().toLowerCase();
  return e === '/v1/embeddings' || e.endsWith('/embeddings');
}

/**
 * Sum prompt/total tokens from Batch output JSONL (embeddings or chat-shaped bodies).
 * @param {string} jsonl
 * @returns {{ tokens_in: number, lines_ok: number, lines_err: number, model: string|null }}
 */
export function sumBatchOutputUsage(jsonl) {
  let tokens_in = 0;
  let lines_ok = 0;
  let lines_err = 0;
  /** @type {string|null} */
  let model = null;
  const text = String(jsonl || '');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row;
    try {
      row = JSON.parse(trimmed);
    } catch {
      lines_err += 1;
      continue;
    }
    if (row?.error) {
      lines_err += 1;
      continue;
    }
    const body = row?.response?.body || row?.body || null;
    const usage = body?.usage || row?.response?.usage || null;
    const pt = Number(usage?.prompt_tokens ?? usage?.total_tokens ?? usage?.input_tokens);
    if (Number.isFinite(pt) && pt > 0) {
      tokens_in += Math.floor(pt);
      lines_ok += 1;
    } else {
      lines_err += 1;
    }
    if (!model && body?.model) model = String(body.model).trim();
  }
  return { tokens_in, lines_ok, lines_err, model };
}

/**
 * @param {any} env
 * @param {string} path
 * @param {string} apiKey
 */
async function openaiGet(env, path, apiKey) {
  const base = String(env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1')
    .trim()
    .replace(/\/$/, '');
  const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const raw = await res.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = { _raw: raw.slice(0, 500) };
  }
  if (!res.ok) {
    const msg = data?.error?.message || `OpenAI HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

/**
 * @param {any} env
 * @param {string} batchId
 */
async function alreadyLoggedBatch(env, batchId) {
  if (!env?.DB || !batchId) return false;
  try {
    const row = await env.DB.prepare(
      `SELECT id FROM agentsam_usage_events
        WHERE event_type = 'embed'
          AND ref_table = ?
          AND ref_id = ?
        LIMIT 1`,
    )
      .bind(REF_TABLE, batchId)
      .first();
    return Boolean(row?.id);
  } catch {
    return false;
  }
}

/**
 * @param {any} env
 * @param {any} [ctx]
 * @param {Record<string, unknown>} payload
 * @param {{ webhookEventId?: string|null }} [opts]
 */
export async function ingestOpenAiBatchEmbedUsageFromWebhook(env, ctx, payload, opts = {}) {
  const { eventType, batchId, eventId } = parseOpenAiBatchWebhookPayload(payload);
  if (!isOpenAiBatchTerminalEvent(eventType)) {
    return { ok: true, skipped: true, reason: 'not_batch_terminal' };
  }
  if (!batchId) {
    return { ok: false, skipped: true, reason: 'missing_batch_id' };
  }

  if (await alreadyLoggedBatch(env, batchId)) {
    return { ok: true, skipped: true, reason: 'already_logged', batch_id: batchId };
  }

  const apiKey = resolveWebhookOpenAiApiKey(env);
  if (!apiKey) {
    return { ok: false, reason: 'openai_api_key_missing', batch_id: batchId };
  }

  const batch = await openaiGet(env, `/batches/${encodeURIComponent(batchId)}`, apiKey);
  const endpoint = String(batch?.endpoint || '').trim();
  const meta =
    batch?.metadata && typeof batch.metadata === 'object'
      ? /** @type {Record<string, unknown>} */ (batch.metadata)
      : {};
  const forceEmbed =
    String(meta.iam_lane || meta.lane || meta.task_type || '')
      .toLowerCase()
      .includes('embed') || String(meta.purpose || '').toLowerCase() === 'embeddings';

  if (!isEmbeddingsBatchEndpoint(endpoint) && !forceEmbed) {
    return {
      ok: true,
      skipped: true,
      reason: 'not_embeddings_batch',
      batch_id: batchId,
      endpoint,
    };
  }

  const outputFileId = batch?.output_file_id != null ? String(batch.output_file_id).trim() : '';
  if (!outputFileId) {
    // Failed/cancelled with no output — still stamp a zero/partial row so we don't reprocess.
    const scope = await resolvePlatformWebhookScope(env, null);
    if (!scope?.tenantId || !scope?.workspaceId) {
      return { ok: false, reason: 'workspace_scope_unresolved', batch_id: batchId };
    }
    await writeUsageEvent(
      env,
      {
        model: 'unknown',
        model_key: 'unknown',
        provider: 'openai',
        workspace_id: scope.workspaceId,
        tenant_id: scope.tenantId,
        event_type: 'embed',
        task_type: 'openai_batch_embed',
        tool_name: 'openai_batch_webhook',
        tokens_in: 0,
        tokens_out: 0,
        cost_usd: 0,
        ref_table: REF_TABLE,
        ref_id: batchId,
        status: eventType === 'batch.completed' ? 'partial' : 'error',
        reason: `batch_${eventType}_no_output_file event=${eventId || ''}`,
      },
      ctx,
    );
    return { ok: true, batch_id: batchId, tokens_in: 0, lines_ok: 0, note: 'no_output_file' };
  }

  const fileRes = await fetch(
    `${String(env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')}/files/${encodeURIComponent(outputFileId)}/content`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!fileRes.ok) {
    const errText = await fileRes.text().catch(() => '');
    throw new Error(`batch output download failed: ${fileRes.status} ${errText.slice(0, 200)}`);
  }
  const jsonl = await fileRes.text();
  const summed = sumBatchOutputUsage(jsonl);

  const scope = await resolvePlatformWebhookScope(env, null);
  if (!scope?.tenantId || !scope?.workspaceId) {
    return { ok: false, reason: 'workspace_scope_unresolved', batch_id: batchId };
  }

  const observedModel = String(summed.model || '').trim();
  let costUsd = 0;
  if (observedModel) {
    const priced = await resolveUsageEventCostUsd(env.DB, {
      modelKey: observedModel, provider: 'openai', inputTokens: summed.tokens_in, outputTokens: 0, pricingKind: 'embedding',
    });
    costUsd = (Number(priced.costUsd) || 0) * BATCH_EMBED_DISCOUNT;
  }

  const written = await writeUsageEvent(
    env,
    {
      model: observedModel || 'unknown',
      model_key: observedModel || 'unknown',
      provider: 'openai',
      workspace_id: scope.workspaceId,
      tenant_id: scope.tenantId,
      event_type: 'embed',
      task_type: 'openai_batch_embed',
      tool_name: 'openai_batch_webhook',
      tokens_in: summed.tokens_in,
      tokens_out: 0,
      cost_usd: costUsd,
      ref_table: REF_TABLE,
      ref_id: batchId,
      status: summed.tokens_in > 0 ? 'ok' : 'partial',
      reason: `webhook=${eventType};event=${eventId || ''};lines_ok=${summed.lines_ok};lines_err=${summed.lines_err};batch_discount=${BATCH_EMBED_DISCOUNT}`,
    },
    ctx,
  );

  console.info(
    '[openai-batch-embed-usage]',
    JSON.stringify({
      batch_id: batchId,
      event_type: eventType,
      tokens_in: summed.tokens_in,
      cost_usd: costUsd,
      lines_ok: summed.lines_ok,
      usage_event: written != null,
    }),
  );

  return {
    ok: true,
    batch_id: batchId,
    tokens_in: summed.tokens_in,
    cost_usd: costUsd,
    lines_ok: summed.lines_ok,
    lines_err: summed.lines_err,
  };
}
