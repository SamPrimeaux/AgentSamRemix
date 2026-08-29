/** Catalog executor domain lane: storage. */
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
import { userMayUseWorkspaceCredentials } from '../../backend/identity/workspace/grants.js';
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
import { getR2Binding, resolveR2BucketName } from './r2-storage-scope.js';
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


export async function executeCatalogStorage(ctx) {
  const {
  env,row,config,params,runContext,credentials,handlerType,toolKey,toolName,rawInput,execConfig,workspaceId,tenantId,userId,agentRunId,routingArmId,agentId,sourceTool,conversationId,executeCatalogTool,executeCatalogCfD1,executeMcpCatalogRow,executeMemoryCatalogDispatch,isCatalogCfD1Operation,
  } = ctx;
  let { result } = ctx;
  switch (handlerType) {
    case 'r2': {
      const authUser = await resolveToolRunAuthUser(env, runContext);
      const op = normalizeR2CatalogOperation(config.operation || config.r2_operation || 'write');
      const authSource = String(config.auth_source || '').toLowerCase();
      const isOwner = await userMayUseWorkspaceCredentials(env, authUser, workspaceId);
      const bucketParam = params.bucket != null ? String(params.bucket).trim() : '';

      if (isR2ListLikeOperation(op)) {
        if (authSource === 'platform' && !isOwner) {
          result = {
            ok: false,
            error: 'platform_r2_owner_only',
            body: {
              user_message:
                'IAM platform R2 bindings are owner-only. Connect your Cloudflare R2 API keys in Settings → Storage to use your buckets.',
            },
          };
          break;
        }

        const effectiveEnv = await mergeR2S3EnvFromUserStorage(env, authUser);
        if (authSource === 'customer' && !effectiveEnv.R2_ACCESS_KEY_ID && !getR2Binding(effectiveEnv, bucketParam)) {
          result = {
            ok: false,
            error: 'customer_r2_not_connected',
            body: {
              user_message:
                'Connect your Cloudflare R2 access key + secret in Settings → Storage before R2 list runs.',
            },
          };
          break;
        }

        // Object listing only — account bucket inventory is agentsam_cf_r2_buckets (r2_buckets_list).
        if (!bucketParam) {
          result = {
            ok: false,
            error: 'bucket_required',
            body: {
              user_message:
                'agentsam_r2_list requires bucket. Use agentsam_cf_r2_buckets to list account buckets.',
            },
          };
          break;
        }

        let bucket = await resolveRegisteredR2BucketName(effectiveEnv, bucketParam);
        if (!bucket) {
          bucket = resolveR2BucketName(effectiveEnv, bucketParam);
        }
        if (!bucket) {
          result = {
            ok: false,
            error: 'bucket_required',
            body: {
              user_message: 'R2 object listing requires a resolvable bucket name.',
            },
          };
          break;
        }

        if (authSource === 'platform' && isOwner) {
          const transport = await ownerHasPlatformR2Transport(effectiveEnv, authUser, bucket);
          if (!transport.ok) {
            result = {
              ok: false,
              error: 'platform_r2_transport_unavailable',
              body: { user_message: transport.user_message, bucket },
            };
            break;
          }
        }

        const out = await executeR2ListCatalogOperation(
          effectiveEnv,
          { ...params, bucket },
          config,
          'objects',
        );
        result = out?.ok === false
          ? { ok: false, error: String(out.error || 'r2_list_failed'), body: out }
          : { ok: true, body: out };
        break;
      }

      if (authSource === 'platform' && !isOwner) {
        result = {
          ok: false,
          error: 'platform_r2_owner_only',
          body: {
            user_message:
              'IAM platform R2 bindings are owner-only. Connect your Cloudflare R2 API keys in Settings → Storage to use your buckets.',
          },
        };
        break;
      }

      const bucketRaw =
        params.bucket != null
          ? String(params.bucket)
          : config.binding != null
            ? String(config.binding)
            : config.default_bucket != null
              ? String(config.default_bucket)
              : '';
      if (!bucketRaw.trim()) {
        result = {
          ok: false,
          error: 'bucket_required',
          body: {
            user_message:
              'R2 tools require an explicit bucket parameter registered in D1 (r2_bucket_list / r2_bucket_bindings / project_storage).',
          },
        };
        break;
      }
      let bucket = await resolveRegisteredR2BucketName(env, bucketRaw);
      const effectiveEnv = await mergeR2S3EnvFromUserStorage(env, authUser);
      const bucketCandidate = resolveR2BucketName(effectiveEnv, bucketRaw) || bucketRaw;

      if (authSource === 'platform' && isOwner) {
        const bucketCheck = await assertOwnerPlatformR2Bucket(env, bucket);
        if (bucketCheck.ok) {
          bucket = bucketCheck.bucket;
        } else {
          const transport = await ownerHasPlatformR2Transport(effectiveEnv, authUser, bucketCandidate);
          if (transport.ok) {
            bucket = bucketCandidate;
          } else {
            result = {
              ok: false,
              error: String(bucketCheck.error || 'platform_r2_bucket_not_registered'),
              body: {
                bucket: bucketCheck.bucket,
                allowed_preview: bucketCheck.allowed_preview,
                user_message: bucketCheck.user_message,
              },
            };
            break;
          }
        }
      }

      if (authSource === 'customer' && !effectiveEnv.R2_ACCESS_KEY_ID && !getR2Binding(effectiveEnv, bucket)) {
        result = {
          ok: false,
          error: 'customer_r2_not_connected',
          body: {
            user_message: 'Connect your Cloudflare R2 access key + secret in Settings → Storage before R2 tools run.',
          },
        };
        break;
      }

      if (authSource === 'platform' && isOwner) {
        const transport = await ownerHasPlatformR2Transport(effectiveEnv, authUser, bucket);
        if (!transport.ok) {
          result = {
            ok: false,
            error: 'platform_r2_transport_unavailable',
            body: { user_message: transport.user_message, bucket },
          };
          break;
        }
      }

      if (op === 'delete' && runContext?.request) {
        const key = String(params.key || params.object_key || params.path || '').trim();
        if (!key) {
          result = {
            ok: false,
            error: 'key_required',
            body: { user_message: 'r2_delete requires bucket and key.' },
          };
          break;
        }
        const httpOut = await invokeR2DeleteHttp(effectiveEnv, runContext, bucket, key);
        result = httpOut.ok
          ? { ok: true, body: httpOut.body }
          : {
              ok: false,
              error: String(httpOut.error || 'r2_delete_failed'),
              body: httpOut.body,
            };
        break;
      }

      const out = await executeR2CatalogOperation(
        effectiveEnv,
        { ...params, bucket },
        config,
        op,
        runContext,
      );
      result = out?.ok === false ? { ok: false, error: String(out.error || 'r2_failed'), body: out } : { ok: true, body: out };
      return result;
    }



    case 'filesystem': {
      const op = String(config.operation || config.dispatcher || 'read').toLowerCase();
      const dispatcher = String(config.dispatcher || '').trim().toLowerCase();
      // edit MUST run before the default read fallthrough — fs_edit_file is
      // handler_type=filesystem; without this branch the catalog returned a
      // successful fs_read_file body and the agent reported a fake edit.
      // Match tool_key / dispatcher only (not bare operation=edit).
      if (dispatcher === 'fs_edit_file' || toolKey === 'fs_edit_file') {
        const { executeFsEditFile } = await import('../../backend/agentsam/filesystem/edit.js');
        const out = await executeFsEditFile(env, params, runContext);
        result = out?.error
          ? { ok: false, error: String(out.error), body: out }
          : { ok: true, body: out };
        break;
      }
      if (op === 'write' || op === 'put' || op === 'fs_write_file') {
        const { handlers: fsHandlers } = await import('../../backend/agentsam/tools/fs.js');
        const out = await fsHandlers.write_file?.(params, env, runContext);
        result = out?.error ? { ok: false, error: String(out.error) } : { ok: true, body: out };
        break;
      }
      if (op === 'list' || op === 'list_dir' || op === 'fs_list_dir') {
        const { handlers: fsHandlers } = await import('../../backend/agentsam/tools/fs.js');
        const out = await fsHandlers.list_dir?.(params, env, runContext);
        result = out?.error ? { ok: false, error: String(out.error) } : { ok: true, body: out };
        break;
      }
      // agentsam_workspace_search ships operation=grep — must NOT fall through to read_file
      // (that produced file_not_found when models passed SPA URLs like /dashboard/artifacts).
      if (
        op === 'grep' ||
        op === 'search' ||
        op === 'search_files' ||
        op === 'fs_search_files' ||
        op === 'workspace_grep' ||
        op === 'workspace_search'
      ) {
        const { executeFsSearchFiles } = await import('../../backend/agentsam/filesystem/search.js');
        const out = await executeFsSearchFiles(env, params, runContext);
        result = out?.error
          ? { ok: false, error: String(out.error), body: out }
          : { ok: true, body: out };
        break;
      }
      const { executeFsReadFile } = await import('../../backend/agentsam/filesystem/read.js');
      const readOut = await executeFsReadFile(env, params, runContext);
      if (!readOut?.error) {
        result = { ok: true, body: readOut };
        break;
      }
      const { handlers: fsHandlers } = await import('../../backend/agentsam/tools/fs.js');
      const out = await fsHandlers.read_file?.(params, env, runContext);
      result = out?.error ? { ok: false, error: String(out.error) } : { ok: true, body: out };
      return result;
    }


  }
  return result;
}
