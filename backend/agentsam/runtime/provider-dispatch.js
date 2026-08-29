/**
 * Stable provider-dispatch facade.
 *
 * Callers depend on this file for dispatchStream/dispatchComplete and the
 * Workers AI helper exports. Provider transports, metadata, selection, stream
 * normalization, and auditing live in their owning backend modules.
 */
import { isFeatureEnabled } from '../../platform/feature-flags.js';
import {
  resolveModelMeta,
  buildRuntimeDispatchParams,
  resolveDispatchPlatform,
} from '../catalog/runtime-model-meta.js';
import { resolveAutoModelKey } from './routing/model-selection.js';
import { maybeLogAgentChatPromptAudit } from './prompt-audit.js';
import {
  buildWorkersAiPayload,
  normalizeWorkersAiSseChunk,
  dispatchWorkersAI,
  dispatchWorkersAIComplete,
} from '../providers/workers-ai.js';
import {
  dispatchOpenAIStream,
  dispatchOpenAIResponsesStream,
  dispatchOpenAIComplete,
  dispatchOpenAIResponsesComplete,
  chatWithToolsOpenAIResponsesWs,
  buildOpenAIMessages,
  toOpenAITools,
} from '../providers/openai.js';
import { dispatchAnthropicStream, dispatchAnthropicComplete, normalizeAnthropicEffort } from '../providers/anthropic.js';
import { dispatchGeminiStream, dispatchGeminiComplete } from '../providers/gemini.js';
import { dispatchCursorStream, dispatchCursorComplete } from '../providers/cursor.js';
import { dispatchOllamaStream, dispatchOllamaComplete, OLLAMA_SKIP_MESSAGE } from '../providers/ollama.js';
import { jsonResponse } from '../../http/agentsam/shared.js';

export {
  resolveModelMeta,
  resolveDispatchPlatform,
  buildWorkersAiPayload,
  normalizeWorkersAiSseChunk,
  buildOpenAIMessages,
  toOpenAITools,
  normalizeAnthropicEffort,
  OLLAMA_SKIP_MESSAGE,
};

function deepseekDispatchExtras(meta, options = {}) {
  const out = {};
  if (meta?.thinking_mode) out.thinkingMode = String(meta.thinking_mode).trim();
  if (meta?.thinking_policy) out.thinkingPolicy = String(meta.thinking_policy).trim();
  if (meta?.tool_invocation_style) out.toolInvocationStyle = String(meta.tool_invocation_style).trim();
  if (options.deepseekStrictTools === true || options.deepseek_strict_tools === true) {
    out.deepseekStrictTools = true;
  }
  const format = options.response_format ?? options.responseFormat;
  if (format && typeof format === 'object') out.responseFormat = format;
  if (options.jsonMode === true || options.json_mode === true || options.requireJsonOutput === true) {
    out.jsonMode = true;
  }
  return out;
}

async function resolveDispatchContract(env, params) {
  const modelKey = await resolveAutoModelKey(env, params);
  if (modelKey == null || String(modelKey).trim() === '') return { modelKey: null };
  const meta = await resolveModelMeta(env, modelKey);
  const dispatchParams = {
    ...buildRuntimeDispatchParams(params, modelKey, meta),
    ...deepseekDispatchExtras(meta, params.options || {}),
  };
  return { modelKey, meta, dispatchParams };
}

export async function dispatchStream(env, request, params = {}) {
  const contract = await resolveDispatchContract(env, params);
  if (!contract.modelKey) {
    return jsonResponse(
      {
        error: 'No routable model for auto selection',
        detail: 'Configure agentsam_routing_arms and agentsam_model_catalog or set model explicitly.',
      },
      503,
    );
  }
  const { modelKey, meta, dispatchParams } = contract;
  maybeLogAgentChatPromptAudit(env, params, modelKey, meta);
  const platform = resolveDispatchPlatform(meta);

  switch (platform) {
    case 'deepseek':
    case 'openai':
    case 'openai_chat_completions':
      return dispatchOpenAIStream(env, request, dispatchParams);
    case 'openai_responses':
    case 'responses': {
      let useWs = false;
      const userId = String(params.userId ?? '').trim();
      const tenantId = String(params.tenantId ?? params.workspaceId ?? '').trim();
      try {
        useWs = await isFeatureEnabled(env, 'openai_responses_ws', {
          userId: userId || undefined,
          tenantId: tenantId || undefined,
        });
      } catch {
        useWs = false;
      }
      if (useWs && env?.OPENAI_RESPONSES_WS) {
        return chatWithToolsOpenAIResponsesWs(env, request, {
          ...dispatchParams,
          sessionKey: params.sessionId || params.sessionKey || params.agentRunId || userId || 'default',
          sessionId: params.sessionId || null,
          agentRunId: params.agentRunId || null,
        });
      }
      return dispatchOpenAIResponsesStream(env, request, dispatchParams);
    }
    case 'gemini_api':
      return dispatchGeminiStream(env, request, dispatchParams);
    case 'workers_ai':
      return dispatchWorkersAI(env, request, dispatchParams);
    case 'ollama':
      return dispatchOllamaStream(env, request, dispatchParams);
    case 'anthropic':
    case 'anthropic_messages':
      return dispatchAnthropicStream(env, request, dispatchParams);
    case 'cursor_sdk':
      return dispatchCursorStream(env, request, dispatchParams);
    case 'google_interactions':
      throw new Error(
        '[dispatchStream] api_platform "google_interactions" is not a chat provider. Select it in the model picker for the Interactions sandbox lane.',
      );
    default:
      throw new Error(
        `[dispatchStream] unsupported api_platform: "${platform}" for model "${modelKey}"`,
      );
  }
}

export async function dispatchComplete(env, params = {}) {
  const contract = await resolveDispatchContract(env, params);
  if (!contract.modelKey) {
    throw new Error('No routable model for auto selection; configure agentsam_routing_arms or agentsam_model_catalog.');
  }
  const { meta, modelKey, dispatchParams } = contract;
  const platform = resolveDispatchPlatform(meta);
  const completeParams = {
    ...dispatchParams,
    taskType: params.taskType ?? params.task_type ?? dispatchParams.taskType,
    mode: params.mode ?? dispatchParams.mode,
    lane: params.lane ?? dispatchParams.lane,
    signal: params.signal ?? dispatchParams.signal,
    jsonSchema: params.jsonSchema ?? params.json_schema ?? dispatchParams.jsonSchema,
    reasoningEffort: params.reasoningEffort ?? params.reasoning_effort ?? dispatchParams.reasoningEffort,
    verbosity: params.verbosity ?? dispatchParams.verbosity,
    provider: meta?.provider ?? dispatchParams.provider,
    apiPlatform: platform,
  };

  switch (platform) {
    case 'deepseek':
    case 'openai':
    case 'openai_chat_completions':
      return dispatchOpenAIComplete(env, completeParams);
    case 'openai_responses':
    case 'responses':
      return dispatchOpenAIResponsesComplete(env, completeParams);
    case 'gemini_api':
      return dispatchGeminiComplete(env, completeParams);
    case 'anthropic':
    case 'anthropic_messages':
      return dispatchAnthropicComplete(env, completeParams);
    case 'workers_ai':
      return dispatchWorkersAIComplete(env, completeParams);
    case 'ollama':
      return dispatchOllamaComplete(env, completeParams);
    case 'cursor_sdk':
      return dispatchCursorComplete(env, completeParams);
    default:
      throw new Error(`[dispatchComplete] unsupported api_platform: "${platform}" for model "${modelKey}"`);
  }
}
