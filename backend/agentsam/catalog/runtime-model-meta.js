/**
 * Runtime model metadata and the normalized provider execution contract.
 *
 * `agentsam_model_catalog` remains the execution SSOT.  The catalog loader owns
 * validation and provider/model identity; this module only adapts its result to
 * the stable dispatch contract used by the runtime facade.
 */
import { loadModelRecord } from './model-resolution.js';
import { normalizeApiPlatform } from './resolve-model-platform.js';

function debugModelFallbackEnabled(env) {
  const value = env?.AGENT_SAM_DEBUG ?? env?.AGENT_SAM_MODEL_DEBUG ?? env?.DEBUG;
  return value === true || value === 1 || String(value ?? '').toLowerCase() === 'true' || String(value) === '1';
}

function isModelNotFound(error) {
  return error?.code === 'MODEL_NOT_FOUND' || /not found or inactive/i.test(String(error?.message || error || ''));
}

/**
 * Resolve catalog metadata through the canonical catalog loader.
 * The agentsam_ai query is retained only as a transition fallback for rows
 * that have not yet been cut over to agentsam_model_catalog.
 */
export async function resolveModelMeta(env, modelKey) {
  if (!env?.DB || modelKey == null) return null;
  const logicalKey = String(modelKey).trim();
  if (!logicalKey) return null;

  try {
    const resolved = await loadModelRecord(env.DB, logicalKey, 'runtime_dispatch');
    return {
      ...resolved,
      id: resolved.model_catalog_id ?? null,
      name: logicalKey,
      model_key: resolved.model_key,
      provider_model_id: resolved.provider_model_id ?? null,
      api_platform: resolved.api_platform,
      secret_key_name: resolved.secret_key_name ?? null,
      supports_tools: resolved.supports_tools,
      supports_vision: resolved.supports_vision,
      supports_streaming: resolved.supports_streaming,
      context_max_tokens: resolved.context_window,
      output_max_tokens: resolved.max_output_tokens,
      input_rate_per_mtok: resolved.input_price_per_1m,
      output_rate_per_mtok: resolved.output_price_per_1m,
      thinking_mode: resolved.thinking_policy ?? null,
      thinking_policy: resolved.thinking_policy ?? null,
      effort: resolved.reasoning_effort ?? null,
    };
  } catch (error) {
    // A catalog row with invalid metadata or exhausted budget must fail loud.
    if (!isModelNotFound(error)) throw error;
  }

  try {
    const legacy = await env.DB.prepare(
      `SELECT id, name, model_key, api_platform, provider,
              secret_key_name, supports_tools, supports_vision,
              context_max_tokens, output_max_tokens,
              input_rate_per_mtok, output_rate_per_mtok,
              tool_invocation_style, thinking_mode, thinking_policy, effort
         FROM agentsam_ai
        WHERE model_key = ? AND mode = 'model' AND status = 'active'
        LIMIT 1`,
    ).bind(logicalKey).first();
    if (!legacy) return null;
    if (debugModelFallbackEnabled(env)) {
      console.warn(
        '[provider] resolveModelMeta: using agentsam_ai transition fallback',
        logicalKey,
      );
    }
    return {
      ...legacy,
      model_key: logicalKey,
      provider_model_id: null,
      api_platform: normalizeApiPlatform(legacy.api_platform, logicalKey),
      supports_streaming: legacy.supports_streaming ?? 1,
    };
  } catch (error) {
    if (/api_platform_|provider_required/i.test(String(error?.message || error || ''))) {
      throw error;
    }
    return null;
  }
}

function maxOutputTokens(meta, input, options) {
  const requested = Number(
    input?.maxOutputTokens ??
      input?.max_output_tokens ??
      options?.maxOutputTokens ??
      options?.max_output_tokens ??
      0,
  );
  const catalog = Number(meta?.max_output_tokens ?? meta?.output_max_tokens ?? 0);
  return requested > 0 ? requested : catalog > 0 ? catalog : undefined;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value != null && String(value).trim() !== '') return value;
  }
  return null;
}

/**
 * Build the provider-neutral dispatch contract.
 * Resolved catalog identity is applied after caller options so options cannot
 * overwrite provider/model/platform metadata.
 */
export function buildRuntimeDispatchParams(params, modelKey, meta) {
  const input = params && typeof params === 'object' ? params : {};
  const options = input.options && typeof input.options === 'object' ? input.options : {};
  const providerModelId =
    meta?.provider_model_id != null && String(meta.provider_model_id).trim() !== ''
      ? String(meta.provider_model_id).trim()
      : null;
  const platform = normalizeApiPlatform(
    meta?.api_platform,
    String(meta?.model_key || modelKey || ''),
  );
  const routingArmId = firstNonEmpty(
    input.routingArmId,
    input.routing_arm_id,
    options.routingArmId,
    options.routing_arm_id,
  );
  const routeKey = firstNonEmpty(
    input.routeKey,
    input.chatRouteKey,
    input.route_key,
    options.routeKey,
    options.chatRouteKey,
    options.route_key,
  );
  const taskType = firstNonEmpty(input.taskType, input.task_type, options.taskType, options.task_type);
  const mode = firstNonEmpty(input.mode, input.runtimeMode, options.mode, options.runtimeMode);
  const lane = firstNonEmpty(input.lane, options.lane);

  return {
    ...input,
    ...options,
    modelKey,
    providerModelId,
    provider: meta?.provider ?? null,
    apiPlatform: platform,
    secretKeyName: meta?.secret_key_name ?? null,
    systemPrompt: input.systemPrompt,
    messages: input.messages,
    tools: Array.isArray(input.tools) ? input.tools : [],
    userId: input.userId,
    tenantId: input.tenantId ?? input.tenant_id ?? options.tenantId ?? options.tenant_id ?? null,
    workspaceId:
      input.workspaceId ?? input.workspace_id ?? options.workspaceId ?? options.workspace_id ?? null,
    taskType: taskType != null ? String(taskType).trim() : null,
    routeKey: routeKey != null ? String(routeKey).trim() : null,
    mode: mode != null ? String(mode).trim() : null,
    lane: lane != null ? String(lane).trim() : null,
    signal: input.signal ?? options.signal ?? null,
    maxOutputTokens: maxOutputTokens(meta, input, options),
    reasoningEffort: input.reasoningEffort ?? input.reasoning_effort ?? options.reasoningEffort ?? options.reasoning_effort ?? null,
    jsonSchema: input.jsonSchema ?? input.json_schema ?? options.jsonSchema ?? options.json_schema ?? null,
    jsonMode: input.jsonMode ?? input.json_mode ?? options.jsonMode ?? options.json_mode ?? false,
    responseFormat:
      input.responseFormat ??
      input.response_format ??
      options.responseFormat ??
      options.response_format ??
      null,
    routingArmId: routingArmId != null ? String(routingArmId).trim() : null,
    options,
    openaiPreviousResponseId: input.openaiPreviousResponseId ?? options.openaiPreviousResponseId ?? null,
    openaiResponsesReplayInput:
      input.openaiResponsesReplayInput ?? options.openaiResponsesReplayInput ?? null,
    openaiResponsesCapture: input.openaiResponsesCapture ?? options.openaiResponsesCapture ?? null,
  };
}

export function resolveDispatchPlatform(meta) {
  return normalizeApiPlatform(
    meta?.api_platform,
    String(meta?.model_key || meta?.logical_model_key || ''),
  );
}
