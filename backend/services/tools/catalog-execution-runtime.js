/**
 * Catalog tool execution runtime — orchestration only.
 * tool_key → handler_key → registry → cache → telemetry
 */
import { parseHandlerConfig } from '../../credentials/resolver.js';
import { parseInput, writeTelemetryError, normalizeCatalogToolErrorMessage } from './shared.js';
import { executeMcpCatalogRow } from '../../../src/core/catalog-tool-mcp.js';
import {
  isToolCacheEnabled,
  resolveToolCachePolicyFromRow,
} from '../tool-cache/contract.js';
import { lookupToolCache } from '../tool-cache/read.js';
import { writeToolCacheResult } from '../tool-cache/write.js';
import { recordToolExecution } from '../telemetry/tool-execution-finalize.js';
import { executeCatalogHandlerLane, resolveHandler } from './handlers/registry.js';
import { resolveToolCacheSourceVersion, resolveToolCacheSourceEtag, warnToolCacheWriteFailure, attachToolCacheProvenance } from '../../../shared/agent-runtime/tool-cache-session.js';

/**
 * @param {any} env
 * @param {Record<string, unknown>} row
 * @param {Record<string, unknown>|string|null} config
 * @param {unknown} input
 * @param {Record<string, unknown>} runContext
 * @param {unknown} credentials
 */
export async function executeCatalogToolRuntime(env, row, config, input, runContext, credentials) {
  const rawInput = parseInput(input);
  config = parseHandlerConfig(config ?? row?.handler_config);
  const { handlerType, handlerKey, execConfig } = resolveHandler(row, config);
  config = execConfig;

  const params = {
    ...rawInput,
    workspace_id: runContext.workspaceId ?? runContext.workspace_id,
    tenant_id: runContext.tenantId ?? runContext.tenant_id,
    user_id: runContext.userId ?? runContext.user_id,
  };
  const toolKey = String(row.tool_key || row.tool_name || '').trim();
  const toolName = String(row.tool_name || row.tool_key || '').trim();

  const workspaceId = String(runContext.workspaceId ?? runContext.workspace_id ?? '').trim();
  const tenantId = String(runContext.tenantId ?? runContext.tenant_id ?? '').trim() || null;
  const userId = String(runContext.userId ?? runContext.user_id ?? '').trim() || null;
  const agentRunIdRaw = runContext.agentRunId ?? runContext.agent_run_id ?? null;
  const agentRunId =
    agentRunIdRaw != null && String(agentRunIdRaw).trim() !== ''
      ? String(agentRunIdRaw).trim()
      : null;
  const routingArmId = runContext.routingArmId ?? runContext.routing_arm_id ?? null;
  const modelKeyForChain =
    runContext.modelKey != null && String(runContext.modelKey).trim() !== ''
      ? String(runContext.modelKey).trim().slice(0, 200)
      : runContext.model_key != null && String(runContext.model_key).trim() !== ''
        ? String(runContext.model_key).trim().slice(0, 200)
        : params.model != null && String(params.model).trim() !== ''
          ? String(params.model).trim().slice(0, 200)
          : null;
  const modeForLog = runContext.mode ?? runContext.agent_mode ?? null;
  const conversationId =
    runContext.conversationId ??
    runContext.conversation_id ??
    runContext.sessionId ??
    runContext.session_id ??
    null;
  const agentId = String(runContext.agentId ?? runContext.agent_id ?? '').trim() || null;
  const sourceTool = String(runContext.sourceTool ?? runContext.source_tool ?? '').trim() || null;

  const cachePolicy = resolveToolCachePolicyFromRow(row);
  const cacheEligible = isToolCacheEnabled(cachePolicy, toolKey);
  const sessionId =
    conversationId != null && String(conversationId).trim() !== ''
      ? String(conversationId).trim()
      : null;
  const sourceVersion = resolveToolCacheSourceVersion(rawInput, runContext);
  const sourceEtag = resolveToolCacheSourceEtag(rawInput, runContext);

  if (env?.DB && toolKey && cacheEligible && workspaceId) {
    try {
      const cached = await lookupToolCache(env, {
        toolRow: row,
        toolInput: rawInput,
        tenantId,
        workspaceId,
        userId,
        sessionId,
        sourceVersion,
        sourceEtag,
      });
      if (cached?.hit && cached.body != null) {
        await recordToolExecution(env, {
          runContext,
          row,
          toolKey,
          toolName,
          rawInput,
          config,
          success: true,
          output: cached.body,
          cacheHit: true,
          resultSource: 'tool_cache',
          cacheLookupMs: cached.lookupDurationMs,
          cacheEligible,
          workspaceId,
          tenantId,
          userId,
          agentRunId,
          routingArmId,
          modelKeyForChain,
          modeForLog,
          conversationId,
          params,
          startedAtMs: Date.now(),
        });
        return {
          ok: true,
          body: attachToolCacheProvenance(cached.body, {
            cache_hit: 1,
            external_execution: 0,
            result_source: 'tool_cache',
          }),
          cacheHit: true,
          resultSource: 'tool_cache',
        };
      }
    } catch (e) {
      await writeTelemetryError(env, runContext, 'agentsam_tool_cache.lookup', e);
    }
  }

  const started = Date.now();
  let result = null;

  const finalize = async (success, output, errorMessage = null) => {
    const telemetry = await recordToolExecution(env, {
      runContext,
      row,
      toolKey,
      toolName,
      rawInput,
      config,
      success,
      output,
      errorMessage,
      startedAtMs: started,
      cacheEligible,
      workspaceId,
      tenantId,
      userId,
      agentRunId,
      routingArmId,
      modelKeyForChain,
      modeForLog,
      conversationId,
      params,
    });

    if (success && cacheEligible && workspaceId) {
      try {
        const writeResult = await writeToolCacheResult(env, {
          toolRow: row,
          toolInput: rawInput,
          result: output,
          tenantId,
          workspaceId,
          userId,
          sessionId,
          sourceVersion,
          sourceEtag,
          originDurationMs: telemetry.durationMs,
          originCostUsd: telemetry.usage?.totalCostUsd ?? 0,
          agentRunId,
        });
        warnToolCacheWriteFailure(toolKey, writeResult);
      } catch (e) {
        await writeTelemetryError(env, runContext, 'agentsam_tool_cache', e);
      }
    }
  };

  {
    const { resolveCfMcpCatalogRoute } = await import('../../../src/core/cf-mcp-proxy.js');
    const cfRoute = resolveCfMcpCatalogRoute(row, config);
    if (cfRoute) {
      const mcpResult = await executeMcpCatalogRow(env, cfRoute.mcpRow, params, runContext);
      if (cfRoute.route === 'mcp_only' || mcpResult?.ok === true) {
        await finalize(
          mcpResult?.ok === true,
          mcpResult?.body ?? mcpResult,
          mcpResult?.ok === true ? null : normalizeCatalogToolErrorMessage(mcpResult?.error ?? mcpResult),
        );
        return mcpResult;
      }
    }
  }

  const laneCtx = {
    env,
    row,
    config,
    params,
    runContext,
    credentials,
    handlerType,
    handlerKey,
    toolKey,
    toolName,
    rawInput,
    execConfig: config,
    workspaceId,
    tenantId,
    userId,
    agentRunId,
    routingArmId,
    agentId,
    sourceTool,
    conversationId,
    executeCatalogTool: executeCatalogToolRuntime,
  };

  result = await executeCatalogHandlerLane(laneCtx);
  await finalize(
    result?.ok === true,
    result?.body ?? result,
    result?.ok === true ? null : normalizeCatalogToolErrorMessage(result?.error ?? result),
  );
  return result;
}
