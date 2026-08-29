/** Catalog executor domain lane: host. */
/**
 * Execute agentsam_tools rows by handler_type + handler_config only.
 * No hardcoded tool_key / tool_name branches.

 */
export { wrapWorkspaceShellCommand } from '../shared.js';
import { handlers as dbToolHandlers } from '../../../agentsam/tools/db.js';
import { handlers as storageHandlers } from '../../../agentsam/tools/storage.js';
import { handlers as aiOpsHandlers } from '../../../agentsam/tools/ai-ops.js';
import { runHyperdriveQuery, isHyperdriveUsable } from '../../database/hyperdrive.js';
import { resolveMcpServerForTool } from '../../../../src/core/mcp-servers.js';
import { executeOpenWebCatalogDispatch, isOpenWebCatalogConfig } from '../../../../src/core/open-web-catalog-dispatch.js';
import {
  assertOwnerPlatformR2Bucket,
  ownerHasPlatformR2Transport,
  resolveRegisteredR2BucketName,
  resolveToolRunAuthUser,
} from '../../../../src/core/platform-owner-r2-access.js';
import { mergeR2S3EnvFromUserStorage } from '../../../../src/core/user-storage-r2-credentials.js';
import { invokeR2DeleteHttp } from '../../../agentsam/tools/r2-http-catalog.js';
import {
  executeR2CatalogOperation,
  executeR2ListCatalogOperation,
  isR2ListLikeOperation,
  normalizeR2CatalogOperation,
} from '../../../agentsam/tools/r2-object-crud.js';
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
} from '../../../../src/core/catalog-data-plane-operation.js';
import {
  resolveRepoRootForHost,
  sanitizeShellCommandForGcpExec,
  vmWorkspaceCdCommandFromSettings,
  vmWorkspaceRootFromSettings,
} from '../../../agentsam/terminal/host-workspace-paths.js';
import {
  resolveTerminalExecRoutingFromDb,
  terminalToolPrefersGcpLane,
} from '../../../agentsam/terminal/routing-policy.js';
import {
  parseInput,
  safeJsonString,
  summarizeOutput,
  writeTelemetryError,
  insertToolCallLog,
  bindingBucket,
} from '../shared.js';


export async function executeCatalogHost(ctx) {
  const {
  env,row,config,params,runContext,credentials,handlerType,toolKey,toolName,rawInput,execConfig,workspaceId,tenantId,userId,agentRunId,routingArmId,agentId,sourceTool,conversationId,executeCatalogTool,executeCatalogCfD1,executeMcpCatalogRow,executeMemoryCatalogDispatch,isCatalogCfD1Operation,
  } = ctx;
  let { result } = ctx;
  switch (handlerType) {
    case 'container': {
      const { buildTerminalToolResponseBody } = await import(
        '../../../../src/core/mcp-terminal-contract.js'
      );
      const { isPrivilegedTerminalTool } = await import(
        '../../../http/agentsam/routes/pty-policy.js'
      );
      const { userMayUsePrivilegedTerminal } = await import(
        '../../../identity/workspace/grants.js'
      );
      const { tryContainerExec } = await import('../../../agentsam/sandbox/my-container.js');

      if (isPrivilegedTerminalTool(toolKey, config)) {
        const op = await userMayUsePrivilegedTerminal(env, runContext?.authUser, workspaceId);
        if (!op) {
          result = {
            ok: false,
            error: 'privileged_terminal_required',
            body: {
              user_message:
                'agentsam_container_exec requires an explicit privileged terminal grant.',
            },
          };
          break;
        }
      }

      const cmd = String(params.command || params.cmd || '').trim();
      if (!cmd) {
        result = { ok: false, error: 'container tool requires command in input' };
        break;
      }

      const cwd = params.cwd != null ? String(params.cwd).trim() : '';
      const timeoutMs =
        params.timeout_ms != null
          ? Number(params.timeout_ms)
          : params.timeoutMs != null
            ? Number(params.timeoutMs)
            : undefined;

      const rawAuth = runContext.authUser ?? runContext.user ?? null;
      const authUser = rawAuth
        ? {
            ...rawAuth,
            id: rawAuth.id ?? rawAuth.user_id ?? userId,
            tenant_id: rawAuth.tenant_id ?? tenantId,
            workspace_id: rawAuth.workspace_id ?? workspaceId,
          }
        : userId
          ? { id: userId, tenant_id: tenantId, workspace_id: workspaceId }
          : null;

      const execOut = await tryContainerExec(env, {
        command: cmd,
        cwd: cwd || undefined,
        timeout_ms: Number.isFinite(timeoutMs) ? timeoutMs : undefined,
        authUser,
      });

      if (!execOut?.ok) {
        result = {
          ok: false,
          error: execOut?.error || 'container_exec_failed',
          body: {
            lane: 'container',
            image: execOut?.image ?? null,
            command: cmd,
            stdout: execOut?.stdout ?? '',
            stderr: execOut?.stderr ?? '',
            exit_code: execOut?.exit_code ?? null,
            http_status: execOut?.http_status ?? null,
          },
        };
        break;
      }

      const body = buildTerminalToolResponseBody({
        explicitPath: cwd || '/tmp',
        executedCommand: cmd,
        stdout: String(execOut.stdout ?? ''),
        stderr: String(execOut.stderr ?? ''),
        exitCode: execOut.exit_code ?? 0,
        status: execOut.exit_code === 0 ? 'success' : 'error',
      });

      result = {
        ok: true,
        body: {
          ...body,
          lane: 'container',
          image: execOut.image ?? null,
        },
      };
      return result;
    }



    case 'deploy':
    case 'git':
    case 'command': {
      const { executeCatalogCommandFabric } = await import(
        '../../../../src/core/catalog-tool-command-fabric.js'
      );
      result = await executeCatalogCommandFabric(env, ctx, {
        config,
        params,
        row,
        runContext,
        workspaceId,
        tenantId,
        userId,
        agentRunId,
        conversationId,
        toolKey,
      });
      break;
    }


  }
  return result;
}
