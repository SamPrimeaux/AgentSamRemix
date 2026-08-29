/**
 * OpenAI Responses webhooks → agentsam_usage_events (chat lane).
 *
 * Dashboard may subscribe to response.completed|failed|cancelled|incomplete.
 * Sync streaming chat already stamps usage on the SSE path — we only stamp
 * here when the Response was (or is marked) background, so we don't double-count.
 *
 * Idempotent: ref_table=openai_responses, ref_id=resp_*.
 */
import { resolvePlatformWebhookScope } from '../services/webhooks/ledger.js';
import { writeUsageEvent } from './usage-events.js';

const REF_TABLE = 'openai_responses';

function resolveWebhookOpenAiApiKey(env) {
  const value = env?.OPENAI_API_KEY;
  return value != null && String(value).trim() ? String(value).trim() : null;
}

/**
 * @param {unknown} payload
 * @returns {{ eventType: string, responseId: string|null, eventId: string|null }}
 */
export function parseOpenAiResponseWebhookPayload(payload) {
  const p = payload && typeof payload === 'object' ? /** @type {Record<string, unknown>} */ (payload) : {};
  const eventType = String(p.type || '').trim().toLowerCase();
  const data = p.data && typeof p.data === 'object' ? /** @type {Record<string, unknown>} */ (p.data) : {};
  const responseId =
    (data.id != null && String(data.id).trim()) ||
    (p.response_id != null && String(p.response_id).trim()) ||
    null;
  const eventId = p.id != null ? String(p.id).trim() : null;
  return { eventType, responseId: responseId || null, eventId };
}

/**
 * @param {string} eventType
 */
export function isOpenAiResponseTerminalEvent(eventType) {
  const t = String(eventType || '').trim().toLowerCase();
  return (
    t === 'response.completed' ||
    t === 'response.failed' ||
    t === 'response.cancelled' ||
    t === 'response.incomplete'
  );
}

/**
 * @param {Record<string, unknown>|null|undefined} response
 */
export function shouldStampResponseUsageViaWebhook(response) {
  if (!response || typeof response !== 'object') return false;
  if (response.background === true) return true;
  const meta =
    response.metadata && typeof response.metadata === 'object'
      ? /** @type {Record<string, unknown>} */ (response.metadata)
      : {};
  const flag = String(
    meta.iam_usage_via_webhook || meta.usage_via_webhook || meta.iam_background || meta.background || '',
  )
    .trim()
    .toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes';
}

/**
 * @param {Record<string, unknown>|null|undefined} response
 */
export function extractOpenAiResponseUsage(response) {
  const usage =
    response?.usage && typeof response.usage === 'object'
      ? /** @type {Record<string, unknown>} */ (response.usage)
      : {};
  const input = Math.floor(
    Number(usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens) || 0,
  );
  const output = Math.floor(
    Number(usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokens) || 0,
  );
  const model =
    (response?.model != null && String(response.model).trim()) ||
    null;
  return { tokens_in: Math.max(0, input), tokens_out: Math.max(0, output), model };
}

/**
 * Prefer Response.metadata attribution; fall back to platform workspace.
 * @param {any} env
 * @param {Record<string, unknown>|null|undefined} response
 */
export async function resolveResponseUsageScope(env, response) {
  const meta =
    response?.metadata && typeof response.metadata === 'object'
      ? /** @type {Record<string, unknown>} */ (response.metadata)
      : {};
  const workspaceId =
    (meta.workspace_id != null && String(meta.workspace_id).trim()) ||
    (meta.workspaceId != null && String(meta.workspaceId).trim()) ||
    null;
  const tenantId =
    (meta.tenant_id != null && String(meta.tenant_id).trim()) ||
    (meta.tenantId != null && String(meta.tenantId).trim()) ||
    null;
  const userId =
    (meta.user_id != null && String(meta.user_id).trim()) ||
    (meta.userId != null && String(meta.userId).trim()) ||
    null;
  const sessionId =
    (meta.session_id != null && String(meta.session_id).trim()) ||
    (meta.sessionId != null && String(meta.sessionId).trim()) ||
    (meta.conversation_id != null && String(meta.conversation_id).trim()) ||
    null;

  if (workspaceId && tenantId) {
    return { workspaceId, tenantId, userId, sessionId, source: 'metadata' };
  }

  const platform = await resolvePlatformWebhookScope(env, workspaceId);
  if (!platform?.workspaceId || !platform?.tenantId) return null;
  return {
    workspaceId: platform.workspaceId,
    tenantId: platform.tenantId,
    userId,
    sessionId,
    source: workspaceId ? 'platform_workspace' : 'platform_default',
  };
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
 * @param {string} responseId
 */
async function alreadyLoggedResponse(env, responseId) {
  if (!env?.DB || !responseId) return false;
  try {
    const row = await env.DB.prepare(
      `SELECT id FROM agentsam_usage_events
        WHERE ref_table = ?
          AND ref_id = ?
        LIMIT 1`,
    )
      .bind(REF_TABLE, responseId)
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
export async function ingestOpenAiResponseUsageFromWebhook(env, ctx, payload, opts = {}) {
  const { eventType, responseId, eventId } = parseOpenAiResponseWebhookPayload(payload);
  if (!isOpenAiResponseTerminalEvent(eventType)) {
    return { ok: true, skipped: true, reason: 'not_response_terminal' };
  }
  if (!responseId) {
    return { ok: false, skipped: true, reason: 'missing_response_id' };
  }

  if (await alreadyLoggedResponse(env, responseId)) {
    return { ok: true, skipped: true, reason: 'already_logged', response_id: responseId };
  }

  const apiKey = resolveWebhookOpenAiApiKey(env);
  if (!apiKey) {
    return { ok: false, reason: 'openai_api_key_missing', response_id: responseId };
  }

  const response = await openaiGet(env, `/responses/${encodeURIComponent(responseId)}`, apiKey);
  if (!shouldStampResponseUsageViaWebhook(response)) {
    return {
      ok: true,
      skipped: true,
      reason: 'not_background_response',
      response_id: responseId,
      status: response?.status ?? null,
    };
  }

  const scope = await resolveResponseUsageScope(env, response);
  if (!scope?.tenantId || !scope?.workspaceId) {
    return { ok: false, reason: 'workspace_scope_unresolved', response_id: responseId };
  }

  const summed = extractOpenAiResponseUsage(response);
  const modelKey = summed.model || 'unknown';
  const okEvent = eventType === 'response.completed';
  const status = okEvent
    ? summed.tokens_in + summed.tokens_out > 0
      ? 'ok'
      : 'partial'
    : 'error';

  const written = await writeUsageEvent(
    env,
    {
      model: modelKey,
      model_key: modelKey,
      provider: 'openai',
      workspace_id: scope.workspaceId,
      tenant_id: scope.tenantId,
      user_id: scope.userId,
      session_id: scope.sessionId,
      conversation_id: scope.sessionId,
      event_type: 'chat_completion',
      task_type: 'openai_response_webhook',
      tool_name: 'openai_response_webhook',
      tokens_in: summed.tokens_in,
      tokens_out: summed.tokens_out,
      cost_usd: 0,
      ref_table: REF_TABLE,
      ref_id: responseId,
      status,
      mode: 'background',
      reason: `webhook=${eventType};event=${eventId || ''};scope=${scope.source};resp_status=${response?.status || ''}`,
    },
    ctx,
  );

  console.info(
    '[openai-response-usage]',
    JSON.stringify({
      response_id: responseId,
      event_type: eventType,
      tokens_in: summed.tokens_in,
      tokens_out: summed.tokens_out,
      usage_event: written != null,
      scope: scope.source,
    }),
  );

  return {
    ok: true,
    response_id: responseId,
    tokens_in: summed.tokens_in,
    tokens_out: summed.tokens_out,
    status,
    scope: scope.source,
  };
}
