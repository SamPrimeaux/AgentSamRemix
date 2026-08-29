/** Catalog executor domain lane: data. */
/**
 * Execute agentsam_tools rows by handler_type + handler_config only.
 * No hardcoded tool_key / tool_name branches.
 *
 * Credential resolution: backend/credentials/resolver.js (resolveCredential).
 */
import { resolveCredential, parseHandlerConfig, normalizeAuthSource } from '../../backend/credentials/resolver.js';
export { wrapWorkspaceShellCommand } from '../../backend/services/tools/shared.js';
import { handlers as dbToolHandlers } from '../../backend/agentsam/tools/db.js';
import { handlers as storageHandlers } from '../../backend/agentsam/tools/storage.js';
import { handlers as aiOpsHandlers } from '../../backend/agentsam/tools/ai-ops.js';
import { compileAgentsamSqlWrite } from './hyperdrive-write.js';
import { resolveMcpServerForTool } from './mcp-servers.js';
import { executeOpenWebCatalogDispatch, isOpenWebCatalogConfig } from './open-web-catalog-dispatch.js';
import {
  assertOwnerPlatformR2Bucket,
  ownerHasPlatformR2Transport,
  resolveRegisteredR2BucketName,
  resolveToolRunAuthUser,
} from './platform-owner-r2-access.js';
import { mergeR2S3EnvFromUserStorage } from './user-storage-r2-credentials.js';
import { invokeR2DeleteHttp } from '../../backend/agentsam/tools/r2-http-catalog.js';
import {
  assertJournalPayloadUnderCeiling,
  compactPayloadForJournal,
  ensureOutputSummary,
  insertExecutionArtifactPointer,
} from '../../backend/telemetry/execution-journal-compact.js';
import {
  extractToolExecUsage as extractUsageMetrics,
  shouldSkipCatalogToolCallLog,
} from '../../backend/telemetry/tool-exec-telemetry.js';
import {
  executeR2CatalogOperation,
  executeR2ListCatalogOperation,
  isR2ListLikeOperation,
  normalizeR2CatalogOperation,
} from '../../backend/agentsam/tools/r2-object-crud.js';
import { getR2Binding, resolveR2BucketName } from '../api/r2-api.js';
import {
  catalogOperationIsSemanticSearch,
  catalogOperationRequiresSql,
  isSupabaseManagementOperation,
  resolveCatalogDataPlaneOperation,
  resolveCatalogDataPlaneProvider,
  resolveCatalogSqlDispatchFields,
  resolveCatalogSupabaseDataPlane,
  resolveCustomerSupabaseDataPlane,
  resolveSupabaseOperationTransport,
} from './catalog-data-plane-operation.js';
import {
  resolveRepoRootForHost,
  sanitizeShellCommandForGcpExec,
  vmWorkspaceCdCommandFromSettings,
  vmWorkspaceRootFromSettings,
} from '../../backend/agentsam/terminal/host-workspace-paths.js';
import {
  resolveTerminalExecRoutingFromDb,
  terminalToolPrefersGcpLane,
} from '../../backend/agentsam/terminal/routing-policy.js';
import {
  parseInput,
  wrapWorkspaceShellCommand,
  safeJsonString,
  summarizeOutput,
  writeTelemetryError,
  insertToolCallLog,
  bindingBucket,
} from '../../backend/services/tools/shared.js';
import { isCatalogCfD1Operation, executeCatalogCfD1 } from './catalog-tool-cf-d1.js';


export async function executeCatalogData(ctx) {
  const {
  env,row,config,params,runContext,credentials,handlerType,toolKey,toolName,rawInput,execConfig,workspaceId,tenantId,userId,agentRunId,routingArmId,agentId,sourceTool,conversationId,executeCatalogTool,executeMcpCatalogRow,executeMemoryCatalogDispatch,
  } = ctx;
  let { result } = ctx;
  switch (handlerType) {
    case 'd1':


    case 'cf': {
      if (handlerType === 'd1' || isCatalogCfD1Operation(toolKey, config)) {
        result = await executeCatalogCfD1(env, row, config, params, {
          ...runContext,
          agentsam_tool_key: toolKey,
        });
        break;
      }
      if (handlerType === 'd1') {
        result = {
          ok: false,
          error:
            'handler_type d1 is deprecated; use handler_type=cf with operation d1.query|d1.write',
        };
        break;
      }

      const cfOp = String(config.operation || '').toLowerCase();
      const r2ToolKeys = new Set(['agentsam_r2_get', 'agentsam_r2_put', 'agentsam_r2_delete']);
      if (
        r2ToolKeys.has(toolKey) ||
        String(config.resource || '').toLowerCase() === 'r2' ||
        cfOp.startsWith('r2.')
      ) {
        const r2Row = { ...row, handler_type: 'r2' };
        return executeCatalogTool(env, r2Row, config, params, runContext, credentials);
      }

      if (
        cfOp.startsWith('vectorize.') ||
        String(config.resource || '').toLowerCase() === 'vectorize' ||
        toolKey === 'agentsam_cf_vectorize'
      ) {
        const { handleCfVectorizeManage } = await import('../handlers/cf/vectorize.js');
        const vectorOpRaw =
          params?.operation ?? params?.op ?? (cfOp.startsWith('vectorize.') ? cfOp.slice('vectorize.'.length) : '');
        const vectorOp = String(vectorOpRaw || 'query').trim().toLowerCase();
        result = await handleCfVectorizeManage(
          env,
          { ...params, operation: vectorOp },
          { workspaceId, tenantId, userId },
        );
        break;
      }

      if (
        cfOp === 'kv.manage' ||
        toolKey === 'agentsam_kv_manage' ||
        String(config.resource || '').toLowerCase() === 'kv'
      ) {
        const { handleCfKvManage } = await import('../handlers/cf/kv.js');
        const kvOut = await handleCfKvManage(
          env,
          params,
          { workspaceId, tenantId, userId },
          credentials,
        );
        result = kvOut?.ok === false
          ? { ok: false, error: String(kvOut.error || 'kv_manage_failed'), body: kvOut }
          : { ok: true, body: kvOut };
        break;
      }

      const httpRow = { ...row, handler_type: 'http' };
      return executeCatalogTool(env, httpRow, config, params, runContext, credentials);
    }



    // Distinct faces: supabase = product; hyperdrive = CF transport/catalog face.
    // Both may use env.HYPERDRIVE for platform Postgres — do not collapse handler_types.
    case 'supabase':
    case 'hyperdrive': {
      const { enrichSupabaseParamsFromStudioContext } = await import(
        './database-studio-tool-enrich.js'
      );
      const studioSupabase = enrichSupabaseParamsFromStudioContext(params, runContext);
      const sbParams = studioSupabase.params;
      const requestedSupabaseOperation = String(sbParams.operation || '')
        .trim()
        .toLowerCase();
      if (
        studioSupabase.strippedListProjects &&
        !String(
          sbParams.sql || sbParams.query || sbParams.statement || sbParams.text || '',
        ).trim()
      ) {
        result = {
          ok: false,
          error: 'platform_supabase_selected',
          user_message:
            'Platform Supabase is selected in Database Studio. Run SQL with resource_ref=platform_supabase (do not call list_projects / customer OAuth).',
        };
        break;
      }
      const dispatchOperation = isSupabaseManagementOperation(requestedSupabaseOperation)
        ? requestedSupabaseOperation
        : resolveCatalogDataPlaneOperation(config, toolKey);
      const requestedProvider = resolveCatalogDataPlaneProvider(config);

      if (
        toolKey === 'knowledge_search' ||
        catalogOperationIsSemanticSearch(dispatchOperation) ||
        String(execConfig.dispatcher || '').toLowerCase().includes('semantic')
      ) {
        const { dispatchSemanticRetrieval } = await import('../../backend/agentsam/rag/semantic-retrieval.js');
        const query = String(
          sbParams.query || sbParams.q || sbParams.message || runContext.userMessage || '',
        ).trim();
        if (!query) {
          result = {
            ok: false,
            error: `${dispatchOperation || 'semantic_search'} requires query in input`,
          };
          break;
        }
        if (!workspaceId) {
          result = { ok: false, error: 'workspace_id_required' };
          break;
        }
        const lane = String(
          sbParams.lane || config.semantic_lane || config.execution_lane || '',
        ).trim() || 'docs';
        const out = await dispatchSemanticRetrieval(env, {
          lane,
          query,
          workspace_id: workspaceId,
          tenant_id: tenantId,
          user_id: userId,
          agent_run_id: agentRunId,
          top_k: Math.min(Math.max(Number(sbParams.top_k ?? sbParams.topK ?? 8) || 8, 1), 24),
        });
        const hits = Array.isArray(out?.results) ? out.results : [];
        result = {
          ok: out?.ok !== false,
          error: out?.ok === false ? out?.error || 'semantic_retrieval_failed' : undefined,
          body: {
            matches: hits.map((h) => String(h.content || h.title || '').trim()).filter(Boolean),
            results: hits,
            count: hits.length,
            operation: dispatchOperation,
            lane: out?.lane || lane,
            backend: out?.backend || null,
          },
        };
        break;
      }

      if (!catalogOperationRequiresSql(dispatchOperation) && !isSupabaseManagementOperation(dispatchOperation)) {
        result = {
          ok: false,
          error: `unsupported catalog operation for sql dispatch: ${dispatchOperation}`,
        };
        break;
      }

      let sql = String(
        sbParams.sql || sbParams.query || sbParams.statement || sbParams.text || '',
      ).trim();
      let boundParams = Array.isArray(sbParams.params) ? sbParams.params : [];
      // Platform supabase.query face: Codemode often omits resource_ref; default it.
      const authSource = String(config.auth_source || config.authSource || '')
        .trim()
        .toLowerCase();
      const configuredPlane = String(config.data_plane || config.dataPlane || '')
        .trim()
        .toLowerCase();
      if (
        !String(sbParams.resource_ref || sbParams.resourceRef || '').trim() &&
        (authSource === 'platform' ||
          configuredPlane === 'platform' ||
          configuredPlane === 'platform_supabase' ||
          configuredPlane === 'platform_supabase_agentsam')
      ) {
        sbParams.resource_ref = 'platform_supabase';
        if (!String(sbParams.data_plane || sbParams.dataPlane || '').trim()) {
          sbParams.data_plane = 'platform_supabase';
        }
      }
      if (!sql && dispatchOperation === 'run_write_sql') {
        const compiled = compileAgentsamSqlWrite(sbParams);
        if (!compiled.ok) {
          result = {
            ok: false,
            error: compiled.error || 'sql_or_crud_operation_required',
            user_message: compiled.user_message,
          };
          break;
        }
        sql = compiled.sql;
        boundParams = compiled.params;
      }
      if (catalogOperationRequiresSql(dispatchOperation) && !sql) {
        result = {
          ok: false,
          error: `supabase tool requires sql (or query) in input (operation=${dispatchOperation})`,
        };
        break;
      }

      // Use the resolved session actor only — never invent superadmin from Codemode flags.
      const authUser = runContext.authUser ?? runContext.user ?? null;
      const { dispatchCustomerDataPlaneOperation } = await import('./customer-data-plane-dispatch.js');
      // Preferred: `project` (name or project_ref). When set → customer Management plane.
      // Operator with no project → platform Hyperdrive (config data_plane).
      const projectRef = String(
        sbParams.project ||
          sbParams.project_ref ||
          sbParams.projectRef ||
          sbParams.project_id ||
          sbParams.projectId ||
          '',
      ).trim();
      const requestedDataPlane = String(sbParams.data_plane || sbParams.dataPlane || '').trim();
      let customerPlane = isSupabaseManagementOperation(dispatchOperation)
        ? 'customer_supabase'
        : resolveCatalogSupabaseDataPlane(
            toolKey,
            requestedDataPlane ? { ...config, data_plane: requestedDataPlane } : config,
            projectRef,
          );
      if (studioSupabase.preferPlatform && !isSupabaseManagementOperation(dispatchOperation)) {
        customerPlane = 'platform_supabase';
      }
      if (!customerPlane) {
        result = {
          ok: false,
          error: 'supabase_resource_required',
          user_message:
            'Select the platform Supabase database or a connected Supabase project before running SQL.',
        };
        break;
      }
      const sqlDispatchFields = {
        ...resolveCatalogSqlDispatchFields(sbParams),
        params: boundParams,
      };
      const platformManagementProjectRef =
        isSupabaseManagementOperation(dispatchOperation) &&
        sqlDispatchFields.resource_ref === 'platform_supabase'
          ? String(env?.SUPABASE_PROJECT_REF || '').trim()
          : '';
      if (
        isSupabaseManagementOperation(dispatchOperation) &&
        dispatchOperation !== 'list_projects' &&
        sqlDispatchFields.resource_ref === 'platform_supabase' &&
        !platformManagementProjectRef
      ) {
        result = {
          ok: false,
          error: 'platform_supabase_management_resource_unresolved',
          user_message:
            'The server must resolve the platform Supabase project before management operations can run.',
        };
        break;
      }
      const resolvedResourceRef =
        sqlDispatchFields.resource_ref ||
        (customerPlane === 'platform_supabase' ? 'platform_supabase' : projectRef || null);
      const routed = await dispatchCustomerDataPlaneOperation(env, {
        operation: dispatchOperation,
        sql,
        message: sql,
        authUser,
        user_id: userId,
        tenant_id: tenantId,
        workspace_id: workspaceId,
        agent_run_id: agentRunId,
        approval_id: sbParams.approval_id ?? sbParams.approvalId ?? null,
        ...sqlDispatchFields,
        resource_ref: resolvedResourceRef,
        requested_provider: requestedProvider || (customerPlane === 'customer_supabase' ? 'supabase' : null),
        data_plane: customerPlane,
        project_ref: platformManagementProjectRef || projectRef || null,
        project_id: platformManagementProjectRef || projectRef || null,
        log_sql: sbParams.log_sql != null ? String(sbParams.log_sql) : null,
        iso_timestamp_start:
          sbParams.iso_timestamp_start != null ? String(sbParams.iso_timestamp_start) : null,
        iso_timestamp_end:
          sbParams.iso_timestamp_end != null ? String(sbParams.iso_timestamp_end) : null,
      });
      if (!routed.ok) {
        result = {
          ok: false,
          error: routed.error || 'access_denied',
          reason: routed.reason,
          user_message: routed.user_message,
        };
        break;
      }
      result = {
        ok: true,
        body: {
          ...routed,
          rows: routed.rows || [],
          data_plane: routed.data_plane,
          operation: dispatchOperation,
          transport:
            routed.transport ||
            resolveSupabaseOperationTransport(dispatchOperation, customerPlane),
          read_only: routed.read_only === true,
          write_path: routed.write_path === true,
        },
      };
      return result;
    }



    case 'websearch': {
      result = await executeOpenWebCatalogDispatch(env, config, params, runContext, toolKey);
      return result;
    }



    case 'ai': {
      if (isOpenWebCatalogConfig(config, toolKey)) {
        result = await executeOpenWebCatalogDispatch(env, config, params, runContext, toolKey);
        break;
      }
      const dispatcher = String(config.dispatcher || '').trim();
      if (dispatcher === 'search_web' || dispatcher === 'web_fetch') {
        result = await executeOpenWebCatalogDispatch(env, config, params, runContext, toolKey);
        break;
      }
      if (dispatcher === 'fs_search_files') {
        const { executeFsSearchFiles } = await import('../../backend/agentsam/filesystem/search.js');
        const out = await executeFsSearchFiles(env, params, runContext);
        result = out?.error ? { ok: false, error: String(out.error) } : { ok: true, body: out };
        break;
      }
      if (dispatcher === 'fs_read_file') {
        const { executeFsReadFile } = await import('../../backend/agentsam/filesystem/read.js');
        const out = await executeFsReadFile(env, params, runContext);
        const failed =
          !!out?.error ||
          out?.success === false ||
          (out?.exit_code != null && Number(out.exit_code) !== 0);
        result = failed
          ? {
              ok: false,
              error: String(out?.error || out?.message || 'fs_read_failed'),
              body: out,
            }
          : { ok: true, body: out };
        break;
      }
      if (dispatcher === 'fs_write_file') {
        const { executeFsWriteFile } = await import('../../backend/agentsam/filesystem/write.js');
        const out = await executeFsWriteFile(env, params, runContext);
        result = out?.error ? { ok: false, error: String(out.error) } : { ok: true, body: out };
        break;
      }
      if (dispatcher === 'fs_edit_file' || toolKey === 'fs_edit_file') {
        const { executeFsEditFile } = await import('../../backend/agentsam/filesystem/edit.js');
        const out = await executeFsEditFile(env, params, runContext);
        result = out?.error ? { ok: false, error: String(out.error), body: out } : { ok: true, body: out };
        break;
      }
      if (dispatcher === 'semantic_retrieval') {
        const { dispatchSemanticRetrieval } = await import('../../backend/agentsam/rag/semantic-retrieval.js');
        const lane = String(
          config.semantic_lane || config.execution_lane || toolKey || '',
        ).trim();
        const query = String(params.query || params.q || '').trim();
        if (!query) {
          result = { ok: false, error: 'semantic_retrieval requires query' };
          break;
        }
        const out = await dispatchSemanticRetrieval(env, {
          lane,
          query,
          workspace_id: workspaceId,
          tenant_id: tenantId,
          user_id: userId,
          agent_run_id: agentRunId,
          top_k: Math.min(Math.max(Number(params.top_k ?? params.topK ?? 6) || 6, 1), 24),
        });
        result = { ok: out?.ok !== false, body: out };
        break;
      }
      if (dispatcher === 'database_assistant') {
        const authUser = runContext.authUser ?? runContext.user ?? null;
        const isOwner = false;
        const cfgPlane = String(config.data_plane || '').trim();
        if ((config.admin_only === true || config.admin_only === 1 || cfgPlane.startsWith('platform_')) && !isOwner) {
          result = {
            ok: false,
            error: 'access_denied',
            reason: 'platform_tool_owner_only',
          };
          break;
        }
      }
      if (dispatcher === 'database_assistant' || dispatcher === 'customer_data_plane') {
        const { dispatchCustomerDataPlaneOperation } = await import('./customer-data-plane-dispatch.js');
        const operation = String(
          params.operation || config.operation || 'inspect_schema',
        ).trim();
        const projectRef = String(
          params.project ||
            params.project_ref ||
            params.projectRef ||
            params.project_id ||
            params.projectId ||
            '',
        ).trim();
        const customerPlane = projectRef
          ? 'customer_supabase'
          : resolveCustomerSupabaseDataPlane(toolKey, config);
        const dataPlane =
          String(params.data_plane || config.data_plane || customerPlane || '').trim() || null;
        const resourceRef =
          String(params.resource_ref || params.resourceRef || '').trim() ||
          (projectRef
            ? projectRef
            : dataPlane === 'platform_supabase'
              ? 'platform_supabase'
              : null);
        const out = await dispatchCustomerDataPlaneOperation(env, {
          operation,
          message: params.message != null ? String(params.message) : '',
          requested_provider:
            params.provider ||
            config.provider ||
            (dataPlane === 'customer_supabase' ? 'supabase' : null),
          data_plane: dataPlane,
          authUser: runContext.authUser ?? runContext.user ?? null,
          user_id: userId,
          tenant_id: tenantId,
          workspace_id: workspaceId,
          schema: String(params.schema || '').trim() || undefined,
          table: params.table != null ? String(params.table).trim() : '',
          resource_ref: resourceRef,
          sql: params.sql != null ? String(params.sql) : '',
          params: Array.isArray(params.params) ? params.params : [],
          migration_sql: params.migration_sql != null ? String(params.migration_sql) : '',
          approval_id: params.approval_id ?? null,
          agent_run_id: agentRunId,
          project_ref: projectRef || null,
          project_id: projectRef || null,
        });
        result = { ok: out?.ok !== false, body: out };
        break;
      }
      if (dispatcher === 'legacy_unified_rag' || config.legacy_unified_rag === true) {
        // Retired public.* unified RAG — same job as docs/client-project semantic lanes.
        const { dispatchSemanticRetrieval } = await import('../../backend/agentsam/rag/semantic-retrieval.js');
        const query = String(params.query || params.q || '').trim();
        if (!query) {
          result = { ok: false, error: 'legacy_unified_rag requires query' };
          break;
        }
        if (!workspaceId) {
          result = { ok: false, error: 'workspace_id_required' };
          break;
        }
        const lane = String(config.semantic_lane || params.lane || 'client_project').trim();
        const out = await dispatchSemanticRetrieval(env, {
          lane,
          query,
          workspace_id: workspaceId,
          tenant_id: tenantId,
          user_id: userId,
          agent_run_id: agentRunId,
          top_k: Math.min(Math.max(Number(params.top_k ?? params.topK ?? 8) || 8, 1), 24),
        });
        const hits = Array.isArray(out?.results) ? out.results : [];
        result = {
          ok: out?.ok !== false,
          error: out?.ok === false ? out?.error || 'semantic_retrieval_failed' : undefined,
          body: {
            retired_legacy_unified_rag: true,
            lane: out?.lane || lane,
            matches: hits.map((h) => String(h.content || h.title || '').trim()).filter(Boolean),
            results: hits,
            count: hits.length,
          },
        };
        break;
      }
      const op = String(config.operation || config.ai_operation || 'complete').toLowerCase();
      const fnKey = op === 'embed' ? 'ai_embed' : op === 'compare' ? 'ai_compare' : 'ai_complete';
      const fn = aiOpsHandlers[fnKey];
      if (typeof fn !== 'function') {
        result = { ok: false, error: `ai operation not supported: ${op}` };
        break;
      }
      const out = await fn(params, env);
      result = out?.error ? { ok: false, error: String(out.error) } : { ok: true, body: out };
      return result;
    }



    case 'codebase_ast':


    case 'local': {
      if (toolKey === 'agentsam_codebase_retrieve' || handlerType === 'codebase_ast') {
        const { retrieveCodebaseAstContext, resolveCodebaseRetrieveQuery } = await import(
          './codebase-ast-retrieve.js'
        );
        const { coerceGithubRepoSlug } = await import('./fs-container-workspace.js');
        const execWs =
          String(
            runContext.projectExecutionBindings?.workspaceId ||
              runContext.project_execution_workspace_id ||
              runContext.execution_workspace_id ||
              '',
          ).trim() || workspaceId;
        const repoFromCtx = coerceGithubRepoSlug(
          params.repo ||
            params.github_repo ||
            runContext.selectedGithubRepoContext ||
            runContext.github_repo_context ||
            runContext.active_repo ||
            runContext.activeRepo ||
            runContext.github_repo ||
            runContext.githubRepo ||
            runContext.projectExecutionBindings?.githubRepo ||
            null,
        );
        const retrieveQuery = resolveCodebaseRetrieveQuery(params);
        if (
          !String(params.query || '').trim() &&
          retrieveQuery &&
          (params.information_request != null ||
            params.informationRequest != null ||
            params.symbol != null ||
            params.name != null)
        ) {
          console.info(
            '[catalog-tool-executor] codebase_retrieve_query_coerced',
            JSON.stringify({
              from_keys: Object.keys(params || {}).slice(0, 12),
              query_len: retrieveQuery.length,
            }),
          );
        }
        const out = await retrieveCodebaseAstContext(env, retrieveQuery, {
          topK: Math.min(Math.max(Number(params.top_k ?? params.topK ?? params.limit) || 8, 1), 32),
          repo_full_name: repoFromCtx,
          repo: repoFromCtx,
          expand: params.expand !== false && params.expand !== 'false',
          hydrate: params.hydrate !== false && params.hydrate !== 'false',
          hydrateNeighbors:
            params.hydrate_neighbors === true ||
            params.hydrateNeighbors === true ||
            params.hydrate_neighbors === 'true' ||
            params.hydrateNeighbors === 'true',
          workspaceId: execWs || undefined,
          userId: userId || null,
          tenantId: tenantId || null,
          sessionId: runContext.sessionId ?? runContext.session_id ?? null,
          conversationId: runContext.conversationId ?? runContext.conversation_id ?? null,
          direction: params.graph_direction ?? params.direction ?? params.graphDirection,
          graphDirection: params.graph_direction ?? params.graphDirection ?? params.direction,
          edgeTypes: params.edge_types ?? params.edgeTypes,
          mode: params.mode ?? params.route ?? params.intent,
          escalate: params.escalate !== false && params.escalate !== 'false',
        });
        if (out?.ok === false) {
          const err = String(out.error || 'codebase_retrieve_failed');
          const quota =
            err === 'embedding_quota_exhausted' ||
            /exceeded your current quota|insufficient_quota/i.test(err);
          if (quota) {
            result = {
              ok: false,
              soft_validation_error: true,
              code: 'embedding_quota_exhausted',
              error: err,
              hint:
                out.hint ||
                'OpenAI embedding quota exhausted. Use fs_search_files / fs_read_file / agentsam_terminal_local — do not retry agentsam_codebase_retrieve this turn.',
              body: out,
            };
          } else if (err === 'empty_query') {
            result = {
              ok: false,
              soft_validation_error: true,
              code: 'empty_query',
              error: err,
              hint:
                out.hint ||
                'query is required (symbol name). Retry agentsam_codebase_retrieve with a non-empty query — do not fall back to fs_search_files for an empty retrieve.',
              body: out,
            };
          } else {
            result = { ok: false, error: err, body: out };
          }
        } else {
          result = { ok: true, body: out };
        }
        break;
      }
      if (
        toolKey === 'agentsam_knowledge_ingest_segment' ||
        toolKey === 'sam.knowledge.ingest_segment' ||
        String(config.operation || '').toLowerCase() === 'knowledge.ingest_segment'
      ) {
        const { ingestSegment } = await import('./knowledge/ingest-segment.js');
        const { docsTopicToIngestInput } = await import('./knowledge/docs-topic-adapter.js');
        const execWs =
          String(
            params.workspace_id_d1 ||
              params.workspace_id ||
              runContext.workspaceId ||
              runContext.workspace_id ||
              '',
          ).trim() || workspaceId;
        let ingestInput = params;
        if (params.markdown != null || params.content_markdown != null) {
          ingestInput = await docsTopicToIngestInput({
            workspace_id_d1: execWs,
            markdown: String(params.markdown ?? params.content_markdown ?? ''),
            fileName: String(params.file_name || params.fileName || 'topic.md'),
            source_snapshot_id: params.source_snapshot_id,
            pipeline_version: params.pipeline_version,
            knowledge_object_id: params.knowledge_object_id,
            artifact_key: params.artifact_key,
            ordinal: params.ordinal,
            metadata: params.metadata,
          });
        } else {
          ingestInput = {
            ...params,
            workspace_id_d1: execWs || params.workspace_id_d1,
          };
        }
        const out = await ingestSegment(env, ingestInput);
        result =
          out?.status === 'failed'
            ? { ok: false, error: 'ingest_segment_failed', body: out }
            : { ok: true, body: out };
        break;
      }
      result = {
        ok: false,
        error: `handler_type local/codebase_ast has no handler for tool_key=${toolKey}`,
      };
      return result;
    }


  }
  return result;
}
