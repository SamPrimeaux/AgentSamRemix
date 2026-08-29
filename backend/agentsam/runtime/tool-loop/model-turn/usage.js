import {
  accumulateUsageTokens,
  extractStreamChunkUsage,
} from '../../../../../src/core/openai-usage-tokens.js';
import { resolveProviderForModelKey } from '../../../../telemetry/usage-events.js';
import { fetchModelCostUsd } from '../../../../../src/core/agent-model-resolver.js';
import {
  executeAgentHandoffFromLoop,
  patchAgentRunBudgetProgress,
} from '../../../../../src/core/agent-handoff.js';
import { usageTokensDelta } from '../../../../../src/core/decision-turn-tool-attribution.js';

export function snapshotTurnUsage(totalUsage) {
  return {
    input_tokens: Number(totalUsage?.input_tokens) || 0,
    output_tokens: Number(totalUsage?.output_tokens) || 0,
    cache_read_input_tokens: Number(totalUsage?.cache_read_input_tokens) || 0,
    cache_creation_input_tokens: Number(totalUsage?.cache_creation_input_tokens) || 0,
  };
}

export function createStreamTurnUsage(totalUsage) {
  let streamTurnUsage = null;
  return {
    reset() {
      streamTurnUsage = null;
    },
    note(obj) {
      const usage = extractStreamChunkUsage(obj);
      if (usage.input_tokens || usage.output_tokens || usage.cache_read_input_tokens) {
        streamTurnUsage = usage;
      }
    },
    flush() {
      if (streamTurnUsage) {
        accumulateUsageTokens(totalUsage, streamTurnUsage);
        streamTurnUsage = null;
      }
    },
  };
}

export function decisionTurnUsage(totalUsage, usageAtTurnStart) {
  return usageTokensDelta(totalUsage, usageAtTurnStart);
}

export async function updateBudgetProgressAndMaybeHandoff(L, usageAtTurnStart) {
  const {
    env,
    ctx,
    emit,
    modelKey,
    conversationMessages,
    mode,
    userId,
    tenantId,
    routingWs,
    sessionId,
    chatAgentRunId,
    routingTaskType,
    agentSlugParam,
    handoffDepthParam,
    rootSessionIdParam,
    totalUsage,
    toolCallsUsed,
    executedToolNames,
    turnCount,
    messages,
    toolChainRootId,
    safeDone,
  } = L;

  if (!chatAgentRunId || !routingWs || !env?.DB) return null;

  const progressCost = await fetchModelCostUsd(
    env,
    modelKey,
    totalUsage.input_tokens,
    totalUsage.output_tokens,
    totalUsage.cache_read_input_tokens,
  );
  ctx.waitUntil?.(
    patchAgentRunBudgetProgress(env, String(chatAgentRunId), {
      inputTokens: totalUsage.input_tokens,
      outputTokens: totalUsage.output_tokens,
      cachedInputTokens: totalUsage.cache_read_input_tokens,
      costUsd: progressCost,
      status: 'running',
    }),
  );

  const turnCacheRead =
    Math.max(0, Number(totalUsage.cache_read_input_tokens) || 0) -
    Math.max(0, Number(usageAtTurnStart.cache_read_input_tokens) || 0);
  const turnCacheCreate =
    Math.max(0, Number(totalUsage.cache_creation_input_tokens) || 0) -
    Math.max(0, Number(usageAtTurnStart.cache_creation_input_tokens) || 0);
  const turnInput =
    Math.max(0, Number(totalUsage.input_tokens) || 0) -
    Math.max(0, Number(usageAtTurnStart.input_tokens) || 0);
  const promptManifest = L.promptManifest;
  if (
    (turnCacheRead > 0 || turnCacheCreate > 0) &&
    promptManifest?.pattern_hash
  ) {
    ctx.waitUntil?.(
      (async () => {
        try {
          const { recordPromptCacheObservation } =
            await import('../../../../../src/core/prompt-pattern-bridge.js');
          const provider = await resolveProviderForModelKey(env, modelKey, null);
          await recordPromptCacheObservation(env, {
            manifest: promptManifest,
            tenantId: tenantId || '',
            workspaceId: routingWs,
            provider,
            modelKey,
            totalInputTokens: turnInput,
            cacheReadTokens: turnCacheRead,
            cacheCreationTokens: turnCacheCreate,
            cacheWriteTtl: L.cacheWriteTtlForBilling,
            agentRunId: String(chatAgentRunId),
            runPatternStats: L.promptPatternStats,
          });
        } catch (error) {
          console.warn(
            '[prompt-pattern] recordPromptCacheObservation',
            error?.message ?? error,
          );
        }
      })(),
    );
  }

  return executeAgentHandoffFromLoop(env, ctx, emit, safeDone, {
    chatAgentRunId,
    modelKey,
    workspaceId: routingWs,
    routingTaskType,
    mode,
    agentSlug: agentSlugParam,
    totalUsage,
    toolCallsUsed,
    executedToolNames,
    turnCount,
    conversationMessages,
    goal: messages?.[0]?.content ?? null,
    userId,
    tenantId,
    toolChainRootId,
    sessionId,
    rootSessionId: rootSessionIdParam ?? sessionId,
    handoffDepth: Number(handoffDepthParam) || 0,
  });
}
