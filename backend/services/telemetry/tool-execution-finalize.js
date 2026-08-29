/**
 * Catalog tool execution telemetry — tool_call_log, tool_chain, ETO, use_count.
 * Single write path; executors call recordToolExecution only.
 */
import {
  assertJournalPayloadUnderCeiling,
  compactPayloadForJournal,
  ensureOutputSummary,
  insertExecutionArtifactPointer,
} from '../../telemetry/execution-journal-compact.js';
import {
  extractToolExecUsage as extractUsageMetrics,
  shouldSkipCatalogToolCallLog,
  shouldSkipCatalogToolChain,
} from '../../telemetry/tool-exec-telemetry.js';
import { resolveToolChainOutcome, normalizeToolChainParentId } from '../../telemetry/tool-chain-outcome.js';
import { upsertEtoFromToolCall } from '../../http/agentsam/routes/ops-runtime.js';
import { resolveProviderForModelKey } from '../../telemetry/usage-events.js';
import { insertToolCallLog, summarizeOutput, writeTelemetryError } from '../tools/shared.js';
import { resolveToolCallLogProvenance } from '../../../shared/agent-runtime/tool-call-log-provenance.js';

/**
 * @param {any} env
 * @param {Record<string, unknown>} payload
 * @param {Record<string, unknown>} runContext
 */
async function writeCatalogToolAudit(env, payload, runContext) {
  return insertToolCallLog(env, payload, runContext);
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} args
 */
export async function recordToolExecution(env, args) {
  const {
    runContext = {},
    row = {},
    toolKey = '',
    toolName = '',
    rawInput = {},
    config = {},
    success = false,
    output = null,
    errorMessage = null,
    startedAtMs = Date.now(),
    cacheHit = false,
    resultSource = null,
    cacheLookupMs = null,
    cacheEligible = false,
    workspaceId = '',
    tenantId = null,
    userId = null,
    agentRunId = null,
    routingArmId = null,
    modelKeyForChain = null,
    modeForLog = null,
    conversationId = null,
    params = {},
  } = args;

  if (!env?.DB) return { toolCallLogId: null };

  const durationMs =
    cacheHit && cacheLookupMs != null
      ? Math.max(0, Math.floor(Number(cacheLookupMs) || 0))
      : Math.max(0, Date.now() - startedAtMs);

  const usage = extractUsageMetrics(
    output,
    params.model ?? config.default_model ?? modelKeyForChain ?? null,
    config.default_provider ?? runContext.provider ?? runContext.provider_key ?? null,
  );
  const modelUsedForCache = usage.modelUsed ?? modelKeyForChain ?? null;
  let providerForCache =
    usage.provider ??
    (runContext.provider != null && String(runContext.provider).trim() !== ''
      ? String(runContext.provider).trim()
      : null) ??
    (runContext.provider_key != null && String(runContext.provider_key).trim() !== ''
      ? String(runContext.provider_key).trim()
      : null);
  if (!providerForCache && modelUsedForCache) {
    providerForCache = await resolveProviderForModelKey(
      env,
      modelUsedForCache,
      runContext.armProvider ?? runContext.arm_provider ?? null,
    );
    if (providerForCache === 'unknown') providerForCache = null;
  }

  const provenance = resolveToolCallLogProvenance({
    cacheHit,
    resultSource: resultSource ?? (cacheHit ? 'tool_cache' : 'live'),
  });

  const packedResult = await compactPayloadForJournal(output, { field: 'result_json' });
  const packedInput = await compactPayloadForJournal(rawInput ?? {}, { field: 'input_json' });
  const outputJson = packedResult.jsonText;
  const inputJson = packedInput.jsonText;
  assertJournalPayloadUnderCeiling(outputJson, {
    digest: packedResult.digest,
    field: 'result_json',
  });
  assertJournalPayloadUnderCeiling(inputJson, {
    digest: packedInput.digest,
    field: 'input_json',
  });
  ensureOutputSummary(summarizeOutput(output) ?? packedResult.summaryHint, {
    toolName,
    ok: success,
    errorMessage: errorMessage ?? null,
  });

  let executionArtifactId = null;
  if (!success && packedResult.compact) {
    executionArtifactId = await insertExecutionArtifactPointer(env, {
      retentionClass: 'failed',
      digest: packedResult.digest,
      byteLen: packedResult.byteLen,
      tenantId,
      workspaceId,
      userId,
      agentRunId,
      field: 'result_json',
      preview: packedResult.summaryHint,
    });
  }

  let toolChainId = null;
  try {
    if (
      !shouldSkipCatalogToolChain(runContext) &&
      toolKey &&
      !String(toolKey).startsWith('workflow:') &&
      workspaceId &&
      tenantId &&
      userId
    ) {
      const completedAt = Math.floor(Date.now() / 1000);
      const startedAt = Math.max(0, completedAt - Math.max(0, Math.ceil(durationMs / 1000)));
      const { outcome, outcome_reason: outcomeReason } = resolveToolChainOutcome({
        ok: success,
        body: output,
        execErr: success ? null : errorMessage,
      });
      const parentChainId = normalizeToolChainParentId(
        runContext.parentChainId ?? runContext.parent_chain_id ?? null,
      );
      const chainRow = await env.DB.prepare(
        `INSERT INTO agentsam_tool_chain
          (workspace_id, tenant_id, user_id, tool_key, tool_status,
           agent_run_id, conversation_id, routing_arm_id, model_key,
           parent_chain_id,
           outcome, outcome_reason,
           started_at, completed_at, duration_ms)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         RETURNING id`,
      )
        .bind(
          workspaceId,
          tenantId,
          userId,
          toolKey,
          success ? 'completed' : 'failed',
          agentRunId,
          conversationId,
          routingArmId,
          modelKeyForChain,
          parentChainId,
          outcome,
          outcomeReason,
          startedAt,
          completedAt,
          durationMs,
        )
        .first();
      toolChainId = chainRow?.id != null ? String(chainRow.id) : null;
    }
  } catch (e) {
    await writeTelemetryError(env, runContext, 'agentsam_tool_chain', e);
  }

  let toolCallLogId = null;
  if (!shouldSkipCatalogToolCallLog(runContext)) {
    try {
      toolCallLogId = await writeCatalogToolAudit(
        env,
        {
          tenantId,
          workspaceId,
          userId,
          agentRunId,
          toolName,
          toolKey,
          handlerKey: row.handler_key ?? null,
          agentsamToolsId: row.id ?? null,
          routingArmId,
          conversationId,
          status: success ? 'success' : 'error',
          errorMessage: errorMessage ?? null,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalCostUsd: usage.totalCostUsd,
          durationMs,
          cacheHit: provenance.cache_hit === 1,
          resultSource: provenance.result_source,
          externalExecution: provenance.external_execution === 1,
          toolCategory: row.tool_category ?? null,
          mode: modeForLog,
          modelKey: modelKeyForChain,
          toolChainId,
          source_client: runContext.source_client ?? runContext.sourceClient ?? null,
          sourceClient: runContext.sourceClient ?? runContext.source_client ?? null,
        },
        runContext,
      );
    } catch (e) {
      await writeTelemetryError(env, runContext, 'agentsam_tool_call_log', e);
    }
  }

  try {
    await upsertEtoFromToolCall(env, {
      tenantId,
      workspaceId,
      userId,
      toolCallLogId,
      agentRunId,
      routingArmId,
      taskType: runContext.taskType ?? runContext.task_type ?? 'tool_call',
      modelKey: modelUsedForCache,
      provider: providerForCache,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: usage.totalCostUsd,
      latencyMs: durationMs,
      success,
      timedOut: false,
      evidence: { toolKey, handlerType: row.handler_type, durationMs },
    });
  } catch (e) {
    await writeTelemetryError(env, runContext, 'agentsam_performance_eto_events', e);
  }

  if (success && toolKey) {
    const bumpTools = env.DB.prepare(
      `UPDATE agentsam_tools
       SET use_count = COALESCE(use_count, 0) + 1,
           last_used_at = datetime('now'),
           updated_at = datetime('now')
       WHERE tool_key = ? AND COALESCE(is_active, 1) = 1`,
    )
      .bind(toolKey)
      .run()
      .catch(() => {});
    const wu = runContext?.ctx;
    if (wu && typeof wu.waitUntil === 'function') {
      wu.waitUntil(bumpTools);
    } else {
      await bumpTools;
    }
  }

  return {
    toolCallLogId,
    toolChainId,
    executionArtifactId,
    usage,
    provenance,
    durationMs,
    cacheEligible,
  };
}
