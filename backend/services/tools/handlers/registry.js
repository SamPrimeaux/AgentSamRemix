/**
 * Catalog handler registry — routes handler_type (+ handler_key metadata) to lane executors.
 * No tool_key checks.
 */
import { parseHandlerConfig } from '../../../credentials/resolver.js';
import { executeMemoryCatalogDispatch } from '../../../../src/core/catalog-tool-memory.js';
import { publicSiteShellService } from '../../../cms/public-site/site-shell.js';
import { normalizeExecutionHandlerType } from './resolve-handler-key.js';

/**
 * @param {Record<string, unknown>} row
 * @param {Record<string, unknown>} [config]
 */
export function resolveHandler(row, config) {
  const parsed = parseHandlerConfig(config ?? row?.handler_config);
  const { handlerType, execConfig } = normalizeExecutionHandlerType(row, parsed);
  const handlerKey = String(row?.handler_key || '').trim() || handlerType || 'unknown';
  return { handlerType, handlerKey, execConfig };
}

/**
 * @param {import('./resolve-handler-key.js').CatalogLaneContext} laneCtx
 */
export async function executeCatalogHandlerLane(laneCtx) {
  const { handlerType, handlerKey, env, config, params, runContext, toolKey } = laneCtx;

  const { isFilesystemCatalogLane, executeFilesystemCatalogLane } = await import(
    '../../../agentsam/filesystem/dispatch.js'
  );
  if (isFilesystemCatalogLane({ handlerType, config, toolKey })) {
    return executeFilesystemCatalogLane(laneCtx);
  }

  const { isTerminalCatalogLane, executeTerminalCatalogLane } = await import(
    '../../../agentsam/terminal/dispatch.js'
  );
  if (isTerminalCatalogLane({ handlerType, handlerKey, config })) {
    return executeTerminalCatalogLane(laneCtx);
  }

  if (handlerKey === 'catalog_discovery' || handlerType === 'meta') {
    const { executeFindToolsMetaTool, normalizeFindToolsInput } = await import(
      '../../../http/agentsam/routes/find-tools-meta-tool.js'
    );
    const out = await executeFindToolsMetaTool(
      env,
      normalizeFindToolsInput(laneCtx.rawInput, runContext),
      runContext,
    );
    if (out?.ok === false) {
      return { ok: false, error: out.error || 'find_tools_failed', body: out.body };
    }
    return { ok: true, body: out.result ?? out };
  }

  if (
    ['d1', 'cf', 'hyperdrive', 'supabase', 'websearch', 'ai', 'codebase_ast', 'local'].includes(
      handlerType,
    )
  ) {
    const { executeCatalogData } = await import('../../../../src/core/catalog-tool-data.js');
    return executeCatalogData(laneCtx);
  }

  if (['container', 'terminal', 'deploy', 'git', 'workspace_argv'].includes(handlerType)) {
    const { executeCatalogHost } = await import('./host.js');
    return executeCatalogHost(laneCtx);
  }

  if (handlerType === 'r2') {
    const { executeCatalogStorage } = await import('../../../../src/core/catalog-tool-storage.js');
    return executeCatalogStorage(laneCtx);
  }

  if (handlerType === 'github') {
    const { executeCatalogGithub } = await import('../../../../src/core/catalog-tool-github.js');
    return executeCatalogGithub(laneCtx);
  }

  if (handlerType === 'memory') {
    return executeMemoryCatalogDispatch(env, config, params, runContext, toolKey);
  }

  const { executeCatalogSurfaces } = await import('../../../../src/core/catalog-tool-surfaces.js');
  return executeCatalogSurfaces({
    ...laneCtx,
    runContext: {
      ...laneCtx.runContext,
      publicSiteShell: publicSiteShellService,
    },
  });
}

/**
 * @typedef {object} CatalogLaneContext
 * @property {any} env
 * @property {Record<string, unknown>} row
 * @property {Record<string, unknown>} config
 * @property {Record<string, unknown>} params
 * @property {Record<string, unknown>} runContext
 * @property {string} handlerType
 * @property {string} handlerKey
 * @property {string} toolKey
 * @property {string} toolName
 * @property {Record<string, unknown>} rawInput
 * @property {Record<string, unknown>} execConfig
 * @property {string} workspaceId
 * @property {string|null} tenantId
 * @property {string|null} userId
 * @property {string|null} agentRunId
 * @property {string|null} routingArmId
 * @property {string|null} agentId
 * @property {string|null} sourceTool
 * @property {string|null} conversationId
 */
