/**
 * Canonical embedding usage logger — every Worker embed path should call this
 * (or pass usage via createAgentsamEmbedding opts.usage).
 */
import { writeUsageEvent } from '../../backend/telemetry/usage-events.js';
import { resolveUsageEventCostUsd } from '../../backend/telemetry/pricing.js';

/**
 * @param {any} env
 * @param {{
 *   workspace_id?: string|null,
 *   tenant_id?: string|null,
 *   user_id?: string|null,
 *   session_id?: string|null,
 *   conversation_id?: string|null,
 *   task_type: string,
 *   tool_name?: string|null,
 *   ref_table?: string|null,
 *   ref_id?: string|null,
 *   model?: string|null,
 *   model_key?: string|null,
 *   provider?: string|null,
 *   tokens_in?: number|null,
 *   duration_ms?: number|null,
 *   status?: string|null,
 *   reason?: string|null,
 *   ctx?: any,
 * }} params
 */
export async function logEmbeddingUsageEvent(env, params = {}) {
  const workspace_id = params.workspace_id != null ? String(params.workspace_id).trim() : '';
  const tenant_id = params.tenant_id != null ? String(params.tenant_id).trim() : '';
  if (!workspace_id || !tenant_id) {
    console.warn('[logEmbeddingUsageEvent] skipped — workspace_id/tenant_id required', {
      task_type: params.task_type,
    });
    return null;
  }

  const model =
    (params.model_key != null && String(params.model_key).trim()) ||
    (params.model != null && String(params.model).trim()) ||
    '';
  const provider = params.provider != null ? String(params.provider).trim() : '';
  if (!model || !provider) {
    console.warn('[logEmbeddingUsageEvent] skipped — model/provider receipt required');
    return null;
  }
  const tokens_in = Math.max(0, Math.floor(Number(params.tokens_in) || 0));
  const pricingKindRaw =
    params.pricing_kind != null
      ? String(params.pricing_kind).trim()
      : params.ctx?.pricing_kind != null
        ? String(params.ctx.pricing_kind).trim()
        : 'embedding';
  const pricingKind = pricingKindRaw || 'embedding';

  let cost_usd = 0;
  try {
    const priced = await resolveUsageEventCostUsd(env?.DB, {
      modelKey: model,
      provider,
      inputTokens: tokens_in,
      outputTokens: 0,
      pricingKind,
    });
    cost_usd = Number(priced.costUsd) || 0;
  } catch {
    cost_usd = 0;
  }

  return writeUsageEvent(
    env,
    {
      model,
      model_key: model,
      provider,
      workspace_id,
      tenant_id,
      user_id: params.user_id != null ? String(params.user_id).trim() : null,
      session_id: params.session_id != null ? String(params.session_id).trim() : null,
      conversation_id:
        params.conversation_id != null ? String(params.conversation_id).trim() : null,
      event_type: 'embed',
      task_type: String(params.task_type || 'embed').trim().slice(0, 120),
      tool_name: params.tool_name != null ? String(params.tool_name).trim().slice(0, 120) : null,
      tokens_in,
      tokens_out: 0,
      cost_usd,
      duration_ms: params.duration_ms != null ? Number(params.duration_ms) : null,
      ref_table: params.ref_table != null ? String(params.ref_table).trim() : null,
      ref_id: params.ref_id != null ? String(params.ref_id).trim() : null,
      status: params.status || 'ok',
      reason: params.reason != null ? String(params.reason).trim().slice(0, 500) : null,
    },
    params.ctx || null,
  );
}

/**
 * Prefer OpenAI usage.prompt_tokens; fallback ~4 chars/token.
 * @param {string} text
 * @param {{ prompt_tokens?: number, total_tokens?: number }|null|undefined} usage
 */
export function resolveEmbedTokensIn(text, usage) {
  const fromApi = Number(usage?.prompt_tokens ?? usage?.total_tokens);
  if (Number.isFinite(fromApi) && fromApi > 0) return Math.floor(fromApi);
  return Math.max(1, Math.ceil(String(text ?? '').length / 4));
}
