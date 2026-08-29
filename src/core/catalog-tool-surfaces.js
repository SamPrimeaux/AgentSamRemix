/** Catalog executor domain lane: surfaces. */
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
import { runHyperdriveQuery, isHyperdriveUsable } from '../../backend/services/database/hyperdrive.js';
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


export async function executeCatalogSurfaces(ctx) {
  const {
  env,row,config,params,runContext,credentials,handlerType,toolKey,toolName,rawInput,execConfig,workspaceId,tenantId,userId,agentRunId,routingArmId,agentId,sourceTool,conversationId,executeCatalogTool,executeCatalogCfD1,executeMcpCatalogRow,executeMemoryCatalogDispatch,isCatalogCfD1Operation,
  } = ctx;
  let { result } = ctx;
  switch (handlerType) {
    case 'builtin': {
      const dispatcher = String(config.dispatcher || toolKey || '').trim();
      const { handlers: webHandlers } = await import('../../backend/agentsam/tools/web.js');
      const fn = webHandlers[dispatcher];
      if (typeof fn !== 'function') {
        result = { ok: false, error: `builtin dispatcher not registered: ${dispatcher}` };
        break;
      }
      const out = await fn(params, env, runContext);
      result = out?.error ? { ok: false, error: String(out.error) } : { ok: true, body: out };
      return result;
    }



    case 'http': {
      const base = String(config.base_url || '').replace(/\/$/, '');
      const path = String(config.endpoint || config.path || '');
      const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`;
      const method = String(config.method || 'POST').toUpperCase();
      const headers = {
        'Content-Type': 'application/json',
        ...(config.headers && typeof config.headers === 'object' ? config.headers : {}),
      };
      if (credentials?.value) {
        const authType = String(config.auth_type || 'bearer').toLowerCase();
        if (authType === 'bearer') headers.Authorization = `Bearer ${credentials.value}`;
        else if (authType === 'token') headers.Authorization = `token ${credentials.value}`;
      }
      const body =
        params.body != null
          ? typeof params.body === 'string'
            ? params.body
            : JSON.stringify(params.body)
          : method !== 'GET' && method !== 'HEAD'
            ? JSON.stringify(params)
            : undefined;
      const res = await fetch(url, { method, headers, body });
      const text = await res.text().catch(() => '');
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { raw: text.slice(0, 8000) };
      }
      if (!res.ok) {
        result = { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 500)}`, status: res.status, body: json };
        break;
      }
      result = { ok: true, status: res.status, body: json };
      return result;
    }



    case 'mybrowser':


    case 'browser': {
      const toolName = String(row.tool_key || row.tool_name || '').trim();
      const { handlers: webHandlers } = await import('../../backend/agentsam/tools/web.js');
      const fn = webHandlers[toolName];
      if (typeof fn !== 'function') {
        result = { ok: false, error: `browser handler not registered for tool_key=${toolName}` };
        break;
      }
      const out = await fn(params, env, runContext);
      result = out?.error ? { ok: false, error: String(out.error) } : { ok: true, body: out };
      return result;
    }



    case 'cms': {
      const handlerKey = String(config.handler || row.handler_key || row.tool_key || toolKey || '').trim();
      const { handlers: cmsHandlers } = await import('../core/agentsam/cms/tools/index.js');
      const fn = cmsHandlers[handlerKey] || cmsHandlers[row.tool_key] || cmsHandlers[row.tool_name];
      if (typeof fn !== 'function') {
        result = { ok: false, error: `cms handler not registered: ${handlerKey}` };
        break;
      }
      const out = await fn(params, env, { ...runContext, executionCtx: runContext.ctx });
      result = out?.error ? { ok: false, error: String(out.error), body: out } : { ok: true, body: out };
      return result;
    }



    case 'mcp':


    case 'browser_agentic':


    case 'proxy':


    case 'workspace.reader': {
      const op = String(config.operation || '').toLowerCase();
      const memOps = new Set([
        'memory_write',
        'memory_search',
        'memory_read',
        'memory_delete',
      ]);
      if (memOps.has(op)) {
        // Compatibility adapter → shared commit / hybrid core
        if (op === 'memory_write' || op === 'memory_search') {
          result = await executeMemoryCatalogDispatch(
            env,
            { ...config, operation: op },
            params,
            runContext,
            toolKey || `legacy_${op}`,
          );
          break;
        }
        const { handlers: memoryHandlers } = await import('../../backend/http/agentsam/routes/memory-write-runtime.js');
        const fn = memoryHandlers[op];
        if (typeof fn !== 'function') {
          result = { ok: false, error: `memory handler not registered: ${op}` };
          break;
        }
        const memCtx = {
          tenantId,
          userId,
          workspaceId,
          agentId: runContext.agentId ?? runContext.agent_id,
          sessionId: runContext.sessionId ?? runContext.session_id,
        };
        const out = await fn(params, env, memCtx);
        result = out?.error ? { ok: false, error: String(out.error), body: out } : { ok: true, body: out };
        break;
      }
      if (
        handlerType === 'workspace.reader' ||
        ['read', 'list', 'grep', 'write', 'search'].includes(op)
      ) {
        const { handlers: fsHandlers } = await import('../../backend/agentsam/tools/fs.js');
        const fsOp = op === 'write' || op === 'put' ? 'write_file' : 'read_file';
        const fn = fsHandlers[fsOp];
        if (typeof fn !== 'function') {
          result = { ok: false, error: `filesystem operation not available: ${fsOp}` };
          break;
        }
        const out = await fn(params, env, runContext);
        result = out?.error ? { ok: false, error: String(out.error) } : { ok: true, body: out };
        break;
      }

      const moduleKey = String(config.module || config.executor_module || '').toLowerCase();
      if (moduleKey === 'memory' || moduleKey === 'tools/memory.js') {
        const { handlers: memoryHandlers } = await import('../../backend/http/agentsam/routes/memory-write-runtime.js');
        const memKey = String(config.handler || row.tool_key || '').trim();
        const fn = memoryHandlers[memKey];
        if (typeof fn !== 'function') {
          result = { ok: false, error: `memory handler not registered: ${memKey}` };
          break;
        }
        const out = await fn(params, env, runContext);
        result = out?.error ? { ok: false, error: String(out.error) } : { ok: true, body: out };
        break;
      }
      if (moduleKey === 'context' || String(config.executor || '').includes('context')) {
        const { handlers: contextHandlers } = await import('../../backend/agentsam/tools/context.js');
        const ctxKey = String(config.handler || config.tool_name || row.tool_key || '').trim();
        const fn = contextHandlers[ctxKey];
        if (typeof fn !== 'function') {
          result = { ok: false, error: `context handler not registered: ${ctxKey}` };
          break;
        }
        const out = await fn(params, env);
        result = out?.error ? { ok: false, error: String(out.error) } : { ok: true, body: out };
        break;
      }

      // Phase 5 composites: run locally on main worker (never proxy through MCP host).
      if (toolKey === 'agentsam_repo_context' || op === 'repo_context') {
        const { executeAgentsamRepoContext } = await import('./agentsam-repo-context.js');
        result = await executeAgentsamRepoContext(env, params, runContext);
        break;
      }

      const mcpUrl = String(row.mcp_service_url || config.mcp_service_url || '').trim();
      if (mcpUrl) {
        const syntheticRow = {
          tool_key: row.tool_key,
          tool_name: row.tool_name || row.tool_key,
          mcp_service_url: mcpUrl,
          handler_config: row.handler_config,
          server_key: config.server_key,
        };
        result = await executeMcpCatalogRow(env, syntheticRow, params, runContext);
        break;
      }

      if (String(config.binding || '').toLowerCase() === 'internal') {
        result = {
          ok: false,
          error: `internal binding tool_key=${row.tool_key} requires handler_config.module or mcp_service_url`,
        };
        break;
      }

      result = {
        ok: false,
        error: `handler_config not routable for tool_key=${row.tool_key} (need operation+filesystem, module, or mcp_service_url)`,
      };
      return result;
    }



    case 'agent': {
      const moduleKey = String(config.module || config.executor_module || '').toLowerCase();
      if (moduleKey.includes('design_studio')) {
        const handlerKey = String(config.handler || row.handler_key || toolKey || '').trim();
        const { handlers: designStudioHandlers } = await import('../../backend/agentsam/tools/design-studio.js');
        const fn =
          designStudioHandlers[handlerKey] ||
          designStudioHandlers[row.tool_key] ||
          designStudioHandlers[row.tool_name];
        if (typeof fn === 'function') {
          const out = await fn(params, env, { ...runContext, executionCtx: runContext.ctx });
          result = out?.error
            ? { ok: false, error: String(out.error), body: out }
            : { ok: true, body: out };
          break;
        }
      }
      if (moduleKey.includes('cms')) {
        const handlerKey = String(config.handler || row.handler_key || toolKey || '').trim();
        const { handlers: cmsHandlers } = await import('../core/agentsam/cms/tools/index.js');
        const fn = cmsHandlers[handlerKey] || cmsHandlers[row.tool_key] || cmsHandlers[row.tool_name];
        if (typeof fn === 'function') {
          const out = await fn(params, env, { ...runContext, executionCtx: runContext.ctx });
          result = out?.error ? { ok: false, error: String(out.error), body: out } : { ok: true, body: out };
          break;
        }
      }
      if (moduleKey.includes('gmail')) {
        const handlerKey = String(config.handler || row.handler_key || toolKey || '').trim();
        const { handlers: gmailHandlers } = await import('../../backend/agentsam/tools/gmail.js');
        const fn = gmailHandlers[handlerKey] || gmailHandlers[row.tool_key] || gmailHandlers[row.tool_name];
        if (typeof fn === 'function') {
          const out = await fn(params, env, { ...runContext, executionCtx: runContext.ctx });
          result = out?.error ? { ok: false, error: String(out.error), body: out } : { ok: true, body: out };
          break;
        }
      }
      if (moduleKey.includes('tickets')) {
        const handlerKey = String(config.handler || row.handler_key || toolKey || '').trim();
        const { handlers: ticketHandlers } = await import('../../backend/agentsam/tools/tickets.js');
        const fn = ticketHandlers[handlerKey] || ticketHandlers[row.tool_key] || ticketHandlers[row.tool_name];
        if (typeof fn === 'function') {
          const out = await fn(params, env, { ...runContext, executionCtx: runContext.ctx });
          result = out?.error ? { ok: false, error: String(out.error), body: out } : { ok: true, body: out };
          break;
        }
      }
      {
        const handlerKey = String(config.handler || row.handler_key || toolKey || '').trim();
        const { handlers: agentHandlers } = await import('../../backend/agentsam/tools/agent.js');
        let fn = agentHandlers[handlerKey];
        if (typeof fn !== 'function') {
          const { handlers: fsMerkleHandlers } = await import('../../backend/agentsam/tools/fs-merkle.js');
          fn =
            fsMerkleHandlers[handlerKey] ||
            fsMerkleHandlers[row.tool_key] ||
            fsMerkleHandlers[toolKey];
        }
        if (typeof fn === 'function') {
          const out = await fn(
            {
              ...params,
              executionCtx: runContext?.ctx || runContext?.executionCtx || null,
              session: {
                workspace_id: runContext?.workspaceId,
                tenant_id: runContext?.tenantId,
                user_id: runContext?.userId,
                conversation_id: runContext?.sessionId || runContext?.conversationId || null,
                session_id: runContext?.sessionId || null,
                ...(params.session && typeof params.session === 'object' ? params.session : {}),
              },
              workspace_id: params.workspace_id || runContext?.workspaceId,
              tenant_id: params.tenant_id || runContext?.tenantId,
              user_id: params.user_id || runContext?.userId,
              conversation_id:
                params.conversation_id ||
                runContext?.sessionId ||
                runContext?.conversationId ||
                null,
              session_id: params.session_id || runContext?.sessionId || null,
            },
            env,
          );
          result = out?.error
            ? { ok: false, error: String(out.error), body: out }
            : out?.ok === false
              ? { ok: false, error: String(out.error || 'tool_failed'), body: out }
              : { ok: true, body: out };
          break;
        }
      }
      result = {
        ok: false,
        error: `handler_type agent requires handler_config.sql or registered handler for tool_key=${row.tool_key}`,
      };
      return result;
    }



    case 'media':


    case 'canvas': {
      const handlerKey = String(
        config.handler || row.handler_key || row.tool_key || row.tool_name || toolKey || '',
      ).trim();
      const { handlers: mediaHandlers } = await import('../../backend/agentsam/tools/media.js');
      let out;
      const mediaFn = mediaHandlers[handlerKey];
      if (typeof mediaFn === 'function') {
        out = await mediaFn(params, env, runContext);
      } else {
        // Veo / MovieMode live in moviemode.js (ai-dispatch already routes there).
        // Catalog rows use handler_type=media — without this fallback agents see
        // "media handler not registered: veo_generate_video".
        const { handlers: moviemodeHandlers } = await import('../../backend/agentsam/tools/moviemode.js');
        const mmFn = moviemodeHandlers[handlerKey];
        if (typeof mmFn !== 'function') {
          result = { ok: false, error: `media handler not registered: ${handlerKey}` };
          break;
        }
        const mmParams = {
          ...params,
          user_id:
            params?.user_id ||
            params?.session?.user_id ||
            runContext?.userId ||
            runContext?.user_id ||
            null,
          workspace_id:
            params?.workspace_id ||
            params?.session?.workspace_id ||
            runContext?.workspaceId ||
            runContext?.workspace_id ||
            null,
          tenant_id:
            params?.tenant_id ||
            params?.session?.tenant_id ||
            runContext?.tenantId ||
            runContext?.tenant_id ||
            null,
          session: {
            ...(params?.session && typeof params.session === 'object' ? params.session : {}),
            user_id:
              params?.session?.user_id ||
              runContext?.userId ||
              runContext?.user_id ||
              null,
            workspace_id:
              params?.session?.workspace_id ||
              runContext?.workspaceId ||
              runContext?.workspace_id ||
              null,
            tenant_id:
              params?.session?.tenant_id ||
              runContext?.tenantId ||
              runContext?.tenant_id ||
              null,
          },
        };
        out = await mmFn(env, mmParams);
      }
      result =
        out?.ok === false || out?.error
          ? { ok: false, error: String(out?.error || 'media tool failed'), body: out }
          : { ok: true, body: out };
      return result;
    }



    case 'memory': {
      // handler_type=memory is first-class (agentsam_memory_search/commit/save + manager).
      // Do not rely on mcp/proxy operation aliases — those only fire when config.operation is set.
      result = await executeMemoryCatalogDispatch(env, config, params, runContext, toolKey);
      return result;
    }

    case 'notify': {
      const channel = String(config.channel || config.provider || '').toLowerCase();
      if (channel === 'imessage' || channel === 'imessage_mac') {
        const { executeImessageCatalog } = await import('../../backend/integrations/imessage-relay.js');
        result = await executeImessageCatalog(env, config, params, runContext);
        return result;
      }

      const message = String(params.message || params.body || params.text || '').trim();
      const subject = String(params.subject || params.title || 'Agent Sam notice').trim();
      if (!message) {
        result = { ok: false, error: 'notify requires message (or body/text)' };
        break;
      }

      // agentsam_notify = in-app + PWA web push (never Resend).
      if (toolKey === 'agentsam_notify') {
        const userId = String(
          runContext?.userId || runContext?.canonicalUserId || runContext?.user_id || '',
        ).trim();
        if (!userId) {
          result = { ok: false, error: 'user_id_required for agentsam_notify push' };
          break;
        }
        try {
          const { notifyUserInAppAndPush } =
            await import('../../backend/identity/web-push-runtime.js');
          const pushOut = await notifyUserInAppAndPush(env, runContext?.ctx, {
            tenantId: runContext?.tenantId || runContext?.tenant_id || null,
            userId,
            workspaceId: runContext?.workspaceId || runContext?.workspace_id || null,
            eventType: 'notification.push',
            subject,
            bodyText: message.slice(0, 4000),
            entityType: params.entityType || params.entity_type || null,
            entityId: params.entityId || params.entity_id || null,
            payloadJson: {
              url: params.url || '/dashboard/agent',
              tag: params.tag || 'agentsam_notify',
              severity: params.severity || 'info',
            },
          });
          result =
            pushOut?.ok === false
              ? { ok: false, error: pushOut.reason || 'push_notify_failed', body: pushOut }
              : { ok: true, body: { channel: 'push', ...pushOut } };
        } catch (e) {
          result = { ok: false, error: e?.message || String(e) };
        }
        break;
      }

      // agentsam_send_email (+ legacy resend_*): Resend only.
      const { notifySam } = await import('../../backend/http/agentsam/routes/git-notifications-runtime.js');
      const emailOut = await notifySam(
        env,
        {
          to: params.to || params.recipient || undefined,
          subject,
          body: message,
          html: params.html || undefined,
          category: params.category || 'agentsam_send_email',
          conversationId: params.conversationId || params.conversation_id || undefined,
          inReplyTo: params.inReplyTo || params.in_reply_to || undefined,
        },
        runContext?.ctx,
      );
      const emailOk = !!(emailOut && (emailOut.success === true || emailOut.ok === true));
      result = emailOk
        ? {
            ok: true,
            body: {
              channel: 'email',
              provider: 'resend',
              id: emailOut?.externalMessageId || emailOut?.data?.id || emailOut?.id || null,
              conversation_id: params.conversationId || params.conversation_id || null,
            },
          }
        : {
            ok: false,
            error: emailOut?.error || 'email_send_failed',
            body: emailOut || null,
          };
      return result;
    }

    default:
      result = {
        ok: false,
        error: `unsupported agentsam_tools.handler_type=${handlerType} (configure handler_config or add executor)`,
      };
      return result;
  }

  return result;
}
