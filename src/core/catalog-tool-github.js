/** Catalog executor domain lane: github. */
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


export async function executeCatalogGithub(ctx) {
  const {
  env,row,config,params,runContext,credentials,handlerType,toolKey,toolName,rawInput,execConfig,workspaceId,tenantId,userId,agentRunId,routingArmId,agentId,sourceTool,conversationId,executeCatalogTool,executeCatalogCfD1,executeMcpCatalogRow,executeMemoryCatalogDispatch,isCatalogCfD1Operation,
  } = ctx;
  let { result } = ctx;
  switch (handlerType) {
    case 'github': {
      const { githubWriteOperationFromArgs } = await import('./mcp-github-write-schema.js');
      const opHint = githubWriteOperationFromArgs(params?.operation);
      const op = opHint || String(config.operation || '').toLowerCase();
      const { handlers: ghHandlers } = await import('../../backend/agentsam/tools/github-worker.js');
      const opMap = {
        get_file: 'github_get_file',
        read_file: 'github_get_file',
        list_repos: 'github_repos',
        create_repo: 'github_create_repo',
        list_branches: 'github_list_branches',
        list_commits: 'github_list_commits',
        get_tree: 'github_get_tree',
        read_dir: 'github_read_dir',
        batch_read: 'github_batch_read',
        patch_file: 'github_patch_file',
        get_commit: 'github_get_commit',
        compare_commits: 'github_compare_commits',
        get_pr: 'github_get_pr',
        list_prs: 'github_list_prs',
        get_pr_diff: 'github_get_pr_diff',
        list_pr_files: 'github_list_pr_files',
        list_issues: 'github_list_issues',
        get_issue: 'github_get_issue',
        search_code: 'github_search_code',
        search: 'github_search_code',
        search_issues: 'github_search_issues_prs',
        list_workflow_runs: 'github_list_workflow_runs',
        get_workflow_run: 'github_get_workflow_run',
        list_workflow_jobs: 'github_list_workflow_jobs',
        get_job_logs: 'github_get_job_logs',
        get_commit_status: 'github_get_commit_status',
        check_permission: 'github_check_permission',
        get_repo: 'github_get_repo',
        update_file: 'github_update_file',
        create_file: 'github_create_file',
        upsert_file: 'github_upsert_file',
        commit_tree: 'github_commit_tree',
        delete_file: 'github_delete_file',
        create_pr: 'github_create_pr',
        update_pr: 'github_update_pr',
        merge_pr: 'github_merge_pr',
        create_comment: 'github_create_comment',
        create_issue: 'github_create_issue',
        update_issue: 'github_update_issue',
        close_issue: 'github_close_issue',
        search_issues_prs: 'github_search_issues_prs',
        create_branch: 'github_create_branch',
        delete_branch: 'github_delete_branch',
        set_commit_status: 'github_set_commit_status',
      };
      // Tool-key-first: dedicated catalog keys win over stale/wrong handler_config.operation.
      // (MCP Worker had the same gap — list_commits advertised but no case until mirrored.)
      const toolKeyHandlerFirst = {
        agentsam_github_list_commits: 'github_list_commits',
        agentsam_github_read: 'github_get_file',
        agentsam_github_tree: 'github_get_tree',
        agentsam_github_get_tree: 'github_get_tree',
        agentsam_github_read_many: 'github_batch_read',
        agentsam_github_batch_read: 'github_batch_read',
        agentsam_github_patch: 'github_patch_file',
        agentsam_github_repo_list: 'github_repos',
        agentsam_github_repo_get: 'github_get_repo',
        agentsam_github_create_repo: 'github_create_repo',
        agentsam_github_write: 'github_upsert_file',
        agentsam_github_commit_tree: 'github_commit_tree',
        agentsam_github_search: 'github_search_code',
        agentsam_github_search_code: 'github_search_code',
        agentsam_github_grep: 'github_search_code',
        agentsam_github_search_issues: 'github_search_issues_prs',
        agentsam_github_search_issues_prs: 'github_search_issues_prs',
        agentsam_github_pr: 'github_create_pr',
        agentsam_github_pr_create: 'github_create_pr',
        agentsam_github_pr_get: 'github_get_pr',
        agentsam_github_pr_list: 'github_list_prs',
        agentsam_github_pr_diff: 'github_get_pr_diff',
        agentsam_github_pr_files: 'github_list_pr_files',
        agentsam_github_list_branches: 'github_list_branches',
        agentsam_github_compare: 'github_compare_commits',
        agentsam_github_check_permission: 'github_check_permission',
        agentsam_github_create_branch: 'github_create_branch',
        agentsam_github_delete_branch: 'github_delete_branch',
        agentsam_github_delete: 'github_delete_file',
        github_file: 'github_get_file',
        github_update_file: 'github_update_file',
        github_create_file: 'github_create_file',
        github_repos: 'github_repos',
        github_create_repo: 'github_create_repo',
        github_create_pr: 'github_create_pr',
        github_search: 'github_search_code',
      };
      /** Handlers that must not require an existing workspace github_repo. */
      const GITHUB_HANDLERS_WITHOUT_REPO = new Set(['github_repos', 'github_create_repo']);
      /** Mutations require an explicit params.repo — no workspace / envelope / sticky fill-in. */
      const GITHUB_MUTATING_HANDLERS = new Set([
        'github_upsert_file',
        'github_create_file',
        'github_update_file',
        'github_delete_file',
        'github_patch_file',
        'github_commit_tree',
        'github_create_pr',
        'github_merge_pr',
        'github_update_pr',
        'github_create_branch',
        'github_delete_branch',
        'github_create_issue',
        'github_close_issue',
        'github_update_issue',
        // github_create_repo intentionally omitted — creates a new repo (no target repo arg).
      ]);
      let handlerName = toolKeyHandlerFirst[toolKey] || opMap[op] || null;
      if (!handlerName && toolKey === 'agentsam_github_write') handlerName = 'github_upsert_file';
      if (!handlerName && toolKey === 'agentsam_github_commit_tree') handlerName = 'github_commit_tree';
      // Issue tool: args.operation wins over handler_config (schema allows create|get|list|close|update).
      if (toolKey === 'agentsam_github_issue') {
        const issueOp = String(params?.operation || op || 'create').toLowerCase();
        if (issueOp === 'list' || issueOp === 'list_issues') handlerName = 'github_list_issues';
        else if (issueOp === 'get' || issueOp === 'get_issue') handlerName = 'github_get_issue';
        else if (issueOp === 'close' || issueOp === 'close_issue') handlerName = 'github_close_issue';
        else if (issueOp === 'update' || issueOp === 'update_issue') handlerName = 'github_update_issue';
        else handlerName = 'github_create_issue';
      }
      if (!handlerName) {
        result = {
          ok: false,
          error: `unsupported_github_operation:${op || 'unknown'}`,
          body: { user_message: `GitHub operation "${op || 'unknown'}" is not configured for ${toolKey}.` },
        };
        break;
      }
      const fn = ghHandlers[handlerName];
      if (typeof fn !== 'function') {
        result = { ok: false, error: `github_handler_missing:${handlerName}` };
        break;
      }
      const envelope = runContext.activeFileEnvelope || runContext.activeFile || null;
      const { applyActiveFileDefaultsToToolInput } = await import('./active-file-envelope.js');
      const ghParams = applyActiveFileDefaultsToToolInput(toolKey, params, envelope);
      // Grep aliases use `pattern`; Search API handlers require `q`.
      if (
        (handlerName === 'github_search_code' || handlerName === 'github_search_issues_prs') &&
        !String(ghParams.q || '').trim()
      ) {
        const alt = String(ghParams.pattern || ghParams.query || ghParams.search || '').trim();
        if (alt) ghParams.q = alt;
      }
      // Model args first; then user-visible explorer / active-file selection.
      // Workspace DB fill-in stays off for mutations (resolveGithubRepoForToolCall).
      // Compose { owner, repo: "slug" } → owner/slug before scope (common codemode shape).
      const { composeGithubRepoArg } = await import('./github-repo-scope.js');
      const explicitRepo = composeGithubRepoArg(params) || composeGithubRepoArg(ghParams);
      const explorerRepo = String(
        params.github_repo ||
          params.active_file_github_repo ||
          ghParams.github_repo ||
          ghParams.active_file_github_repo ||
          runContext.selectedGithubRepoContext ||
          runContext.github_repo_context ||
          runContext.active_repo ||
          runContext.activeRepo ||
          runContext.github_repo ||
          runContext.activeFileEnvelope?.github_repo ||
          '',
      ).trim();
      const isMutatingGithub = GITHUB_MUTATING_HANDLERS.has(handlerName);
      if (explicitRepo) {
        ghParams.repo = explicitRepo;
      } else if (explorerRepo) {
        // Open Files/GitHub selection or active GitHub file — not silent workspace fill-in.
        ghParams.repo = explorerRepo;
      } else if (!isMutatingGithub) {
        ghParams.repo = null;
      } else {
        ghParams.repo = null;
      }
      if (isMutatingGithub && !String(ghParams.repo || '').trim()) {
        result = {
          ok: false,
          error: 'explicit_repo_required_for_mutation',
          body: {
            user_message:
              'Mutating GitHub tools require repo as owner/repository (tool arg, open GitHub explorer repo, or active GitHub file). Workspace fill-in alone is not used.',
            requested_repo: null,
            handler: handlerName,
          },
        };
        break;
      }
      const { resolveGithubRepoForToolCall } = await import('./github-repo-scope.js');
      const repoOptional = GITHUB_HANDLERS_WITHOUT_REPO.has(handlerName);
      const repoScope = await resolveGithubRepoForToolCall(env, {
        userId: userId || String(ghParams.user_id || ''),
        tenantId,
        workspaceId,
        requestedRepo: ghParams.repo,
        allowWorkspaceFillIn: !isMutatingGithub && !repoOptional,
      });
      if (repoScope.reason === 'github_not_connected' || (repoScope.blocked && repoScope.reason === 'github_not_connected')) {
        result = {
          ok: false,
          error: 'github_not_connected',
          body: {
            user_message: 'Connect GitHub in Integrations first.',
            requested_repo: ghParams.repo || null,
          },
        };
        break;
      }
      if (!repoOptional && (repoScope.blocked || !repoScope.repo)) {
        const loginHint =
          repoScope.hint ||
          'Pass repo as owner/repository matching your connected GitHub login — owners are not rewritten silently.';
        result = {
          ok: false,
          error: repoScope.reason || 'github_repo_scope_denied',
          body: {
            user_message: `${loginHint} Requested: ${ghParams.repo || '(none)'}.`,
            requested_repo: ghParams.repo || null,
            suggested_repo: repoScope.suggested_repo || null,
            allowed_owner_namespace: true,
          },
        };
        break;
      }
      if (!repoOptional && repoScope.repo) {
        ghParams.repo = repoScope.repo;
      }
      let handlerNameResolved = handlerName;
      let opResolved = op;
      // Sync op label when tool-key fallbacks picked a handler without config.operation.
      if (handlerNameResolved === 'github_batch_read') opResolved = 'batch_read';
      if (handlerNameResolved === 'github_patch_file') opResolved = 'patch_file';
      if (handlerNameResolved === 'github_get_tree') opResolved = 'get_tree';
      if (handlerNameResolved === 'github_get_file') opResolved = 'get_file';
      if (handlerNameResolved === 'github_repos') opResolved = 'list_repos';
      if (handlerNameResolved === 'github_create_repo') opResolved = 'create_repo';
      if (handlerNameResolved === 'github_list_commits') opResolved = 'list_commits';
      if (handlerNameResolved === 'github_create_pr') opResolved = 'create_pr';
      if (handlerNameResolved === 'github_list_issues') opResolved = 'list_issues';
      if (handlerNameResolved === 'github_get_issue') opResolved = 'get_issue';
      if (handlerNameResolved === 'github_close_issue') opResolved = 'close_issue';
      if (handlerNameResolved === 'github_update_issue') opResolved = 'update_issue';
      if (handlerNameResolved === 'github_create_issue') opResolved = 'create_issue';
      if (handlerNameResolved === 'github_search_code') opResolved = 'search_code';
      if (
        (handlerNameResolved === 'github_get_file' || opResolved === 'get_file') &&
        !String(ghParams.path || '').trim() &&
        String(ghParams.repo || '').trim()
      ) {
        // Pathless read → tree; leave branch/ref unset so github_get_tree resolves default_branch.
        handlerNameResolved = 'github_get_tree';
        opResolved = 'get_tree';
      }
      if (handlerNameResolved === 'github_get_repo') opResolved = 'get_repo';
      if (handlerNameResolved === 'github_list_branches') opResolved = 'list_branches';
      if (handlerNameResolved === 'github_compare_commits') opResolved = 'compare_commits';
      if (handlerNameResolved === 'github_check_permission') opResolved = 'check_permission';
      if (handlerNameResolved === 'github_get_pr') opResolved = 'get_pr';
      if (handlerNameResolved === 'github_list_prs') opResolved = 'list_prs';
      if (handlerNameResolved === 'github_get_pr_diff') opResolved = 'get_pr_diff';
      if (handlerNameResolved === 'github_list_pr_files') opResolved = 'list_pr_files';
      if (handlerNameResolved === 'github_create_branch') opResolved = 'create_branch';
      if (handlerNameResolved === 'github_delete_branch') opResolved = 'delete_branch';
      if (handlerNameResolved === 'github_delete_file') opResolved = 'delete_file';
      const fnResolved = ghHandlers[handlerNameResolved] || fn;
      const ghParamsWithMeta = {
        ...ghParams,
        user_id: userId || ghParams.user_id,
        tool: ghParams?.tool ?? toolKey,
        operation: ghParams?.operation ?? opResolved,
      };
      if (!String(ghParamsWithMeta.user_id || '').trim()) {
        result = {
          ok: false,
          error: 'user_id_required',
          body: {
            user_message: 'GitHub tools require an authenticated session.',
            missing: ['user_id'],
          },
        };
        break;
      }
      const out = await fnResolved(ghParamsWithMeta, env);

      if (out?.success === false || out?.error) {
        result = {
          ok: false,
          error: String(out?.error || out?.message || 'github_failed'),
          body: {
            ...out,
            user_message: out?.user_message || out?.message || null,
          },
        };
        break;
      }

      const normalize = () => {
        switch (opResolved) {
          case 'get_file': {
            return {
              ok: true,
              repo: out.repo ?? ghParamsWithMeta.repo ?? null,
              path: out.path ?? ghParamsWithMeta.path ?? null,
              sha: out.sha ?? null,
              size: out.size ?? null,
              encoding: out.encoding ?? 'base64',
              text: out.text ?? '',
            };
          }
          case 'list_repos':
            return { ok: true, repos: out.repos || [] };
          case 'create_repo':
            return {
              ok: true,
              repo: out.repo || out.full_name || null,
              full_name: out.full_name || out.repo || null,
              html_url: out.html_url || null,
              clone_url: out.clone_url || null,
              ssh_url: out.ssh_url || null,
              default_branch: out.default_branch != null ? String(out.default_branch) : null,
              private: out.private === true,
              owner: out.owner || null,
              created: out.created === true,
            };
          case 'list_branches':
            return { ok: true, branches: out.branches || [] };
          case 'list_commits':
            return {
              ok: true,
              repo: out.repo ?? ghParamsWithMeta.repo ?? null,
              ref: out.ref ?? ghParamsWithMeta.sha ?? ghParamsWithMeta.ref ?? ghParamsWithMeta.branch ?? null,
              commits: out.commits || [],
            };
          case 'get_tree': {
            const tree = out.tree || [];
            const sample = tree.slice(0, 200).map((e) => ({
              path: e.path,
              type: e.type,
              size: e.size ?? null,
            }));
            return {
              ok: true,
              repo: ghParamsWithMeta.repo ?? null,
              branch: out.branch ?? ghParamsWithMeta.branch ?? null,
              sha: out.sha ?? null,
              tree_count: tree.length,
              truncated: tree.length > 200,
              tree: sample,
            };
          }
          case 'read_dir':
            return { ok: true, repo: ghParamsWithMeta.repo ?? null, path: ghParamsWithMeta.path ?? null, entries: out.entries || [] };
          case 'batch_read':
            return {
              ok: true,
              files: out.files || [],
              truncated: out.truncated === true,
              hint: out.hint || null,
            };
          case 'patch_file': {
            const commitSha = out.commit?.sha ?? null;
            const sha = out.content?.sha ?? null;
            return {
              ok: true,
              path: ghParamsWithMeta.path ?? null,
              sha,
              commit_sha: commitSha,
              created: out.created === true,
            };
          }
          case 'get_commit': {
            const c = out.commit || {};
            return {
              ok: true,
              sha: c.sha ?? ghParamsWithMeta.sha ?? null,
              message: c.commit?.message ?? null,
              author: c.commit?.author?.name ?? c.author?.login ?? null,
              date: c.commit?.author?.date ?? null,
              files: c.files || [],
            };
          }
          case 'compare_commits': {
            const cmp = out.compare || {};
            return {
              ok: true,
              base: cmp.base_commit?.sha ?? ghParamsWithMeta.base ?? null,
              head: cmp.merge_base_commit?.sha ?? ghParamsWithMeta.head ?? null,
              diff_stat: {
                ahead_by: cmp.ahead_by ?? null,
                behind_by: cmp.behind_by ?? null,
                total_commits: cmp.total_commits ?? null,
                files: Array.isArray(cmp.files) ? cmp.files.length : null,
              },
              files: cmp.files || [],
            };
          }
          case 'get_pr': {
            const pr = out.pr || {};
            return {
              ok: true,
              number: pr.number ?? null,
              title: pr.title ?? null,
              state: pr.state ?? null,
              head: pr.head?.ref ?? null,
              base: pr.base?.ref ?? null,
              body: pr.body ?? null,
            };
          }
          case 'list_prs':
            return { ok: true, prs: out.prs || [] };
          case 'get_pr_diff':
            return { ok: true, number: Number(ghParamsWithMeta.pull_number) || null, diff: out.diff || '' };
          case 'list_pr_files':
            return { ok: true, number: Number(ghParamsWithMeta.pull_number) || null, files: out.files || [] };
          case 'list_issues':
            return { ok: true, issues: out.issues || [] };
          case 'get_issue': {
            const issue = out.issue || {};
            return {
              ok: true,
              number: issue.number ?? null,
              title: issue.title ?? null,
              state: issue.state ?? null,
              body: issue.body ?? null,
              labels: (issue.labels || []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean),
            };
          }
          case 'search_code':
            return { ok: true, items: out.results?.items || [] };
          case 'search_issues':
          case 'search_issues_prs':
            return { ok: true, items: out.results?.items || [] };
          case 'list_workflow_runs':
            return { ok: true, runs: out.runs || [] };
          case 'get_workflow_run':
            return { ok: true, run: out.run || null };
          case 'list_workflow_jobs':
            return { ok: true, jobs: out.jobs || [] };
          case 'get_job_logs':
            return { ok: true, log: out.log || '' };
          case 'get_commit_status': {
            const s = out.status || {};
            return { ok: true, state: s.state ?? null, statuses: s.statuses || [] };
          }
          case 'check_permission':
            return { ok: true, permission: out.permission || 'none' };
          case 'get_repo':
            return {
              ok: true,
              full_name: out.full_name ?? ghParamsWithMeta.repo ?? null,
              default_branch: out.default_branch ?? null,
              private: out.private === true,
              archived: out.archived === true,
              disabled: out.disabled === true,
              permission: out.permission || 'none',
              permissions: out.permissions || {},
              html_url: out.html_url ?? null,
              description: out.description ?? null,
              pushed_at: out.pushed_at ?? null,
            };
          case 'create_file': {
            const commitSha = out.commit?.sha ?? null;
            const sha = out.content?.sha ?? null;
            return { ok: true, path: ghParamsWithMeta.path ?? null, sha, commit_sha: commitSha };
          }
          case 'update_file': {
            const commitSha = out.commit?.sha ?? null;
            const sha = out.content?.sha ?? null;
            return { ok: true, path: ghParamsWithMeta.path ?? null, sha, commit_sha: commitSha };
          }
          case 'delete_file': {
            const commitSha = out.commit?.sha ?? null;
            return { ok: true, path: ghParamsWithMeta.path ?? null, commit_sha: commitSha };
          }
          case 'create_branch': {
            const sha = out.ref?.object?.sha ?? null;
            const branch = out.ref?.ref ? String(out.ref.ref).replace(/^refs\/heads\//, '') : ghParamsWithMeta.name ?? null;
            return { ok: true, branch, sha };
          }
          case 'delete_branch':
            return { ok: true };
          case 'create_pr':
            return { ok: true, number: out.number ?? null, url: out.html_url ?? null };
          case 'update_pr':
            return {
              ok: true,
              number:
                out.pr?.number ??
                (() => {
                  const n = Number(ghParamsWithMeta.pull_number);
                  return Number.isFinite(n) && n > 0 ? n : null;
                })(),
            };
          case 'merge_pr':
            return { ok: true, result: out.result ?? null };
          case 'create_comment':
            return { ok: true, id: out.comment?.id ?? null };
          case 'create_issue':
            return { ok: true, number: out.issue?.number ?? null, url: out.issue?.html_url ?? null };
          case 'update_issue':
            return {
              ok: true,
              number:
                out.issue?.number ??
                (() => {
                  const n = Number(ghParamsWithMeta.issue_number);
                  return Number.isFinite(n) && n > 0 ? n : null;
                })(),
            };
          case 'close_issue':
            return {
              ok: true,
              number:
                out.issue?.number ??
                (() => {
                  const n = Number(ghParamsWithMeta.issue_number);
                  return Number.isFinite(n) && n > 0 ? n : null;
                })(),
            };
          case 'set_commit_status': {
            const st = out.status || {};
            return { ok: true, state: st.state ?? ghParamsWithMeta.state ?? null };
          }
          default:
            return { ok: true, body: out };
        }
      };
      result = normalize();
      return result;
    }


  }
  return result;
}
