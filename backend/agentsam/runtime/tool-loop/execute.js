import { sanitizeToolCredentialError } from '../../../credentials/resolver.js';
import {
  isMissingRequiredArgErrorText,
  softMissingRequiredArgResult,
} from '../../../../shared/agent-runtime/user-visible-agent-error.js';
import {
  CODEMODE_TOOL_NAME,
  enqueueCodemodePendingActions,
} from '../../../../src/core/codemode-agent-bridge.js';
import {
  CODEBASE_RETRIEVE_TOOL_KEYS,
  githubRepoFieldsFromMcpCtx,
  projectFieldsFromMcpCtx,
  lastUserMessageText,
} from './helpers.js';
import { isImageGenerationTool, streamImageGenerationSse } from '../../tools/image_generation.js';
import { imageGenerationShouldPersist } from '../../../../src/core/image-draft-store.js';
import { auditToolDecision } from '../../../../src/core/agent-approval-gate.js';
import {
  dispatchToolCallWithBudget,
  resolveToolExecutionBudgetMs,
} from '../../../../src/core/agent-tool-validator.js';
import { extractExplicitCatalogToolKeys } from '../../../../src/core/code-implementation-intent.js';
import { isAgentRunAbortError } from '../run-cancel.js';
import {
  agentRunDeadlineError,
  clampToolBudgetToRunDeadline,
  raceToolExecutionBudget,
} from '../../../../src/core/agent-run-deadline.js';
import { capToolResultForPrompt } from './tool-result-compaction.js';
import { newToolChainId } from '../../../telemetry/tool-chain-outcome.js';

/**
 * Try/catch execution: codemode, image gen, github-bound buffer block,
 * dispatchToolCallWithBudget, soft validation, retrieve absorb, search_tools hydrate.
 * @param {object} ctx
 */
export async function executeToolHostCall(execCtx) {
  const {
    call,
    validation,
    ctx: workerCtx,
    emit,
    env,
    request,
    mode,
    tenantId,
    userId,
    workspaceId,
    sessionId,
    mcpCtx,
    authUserParam,
    activeFileEnvelopeParam,
    codemodeRuntimeParam,
    chatAgentRunId,
    abortScope,
    runSpineIds,
    turnCount,
    conversationMessages,
    retrieveKnownSymbols,
    userTextForForce,
    imageAskForTurn,
    runStartedAt,
    maxRunMs,
    exitCancelled,
    toolCallsUsed: toolCallsUsedIn,
    executedToolNames: executedToolNamesIn,
    activeTools: activeToolsIn,
  } = execCtx;

  let toolCallsUsed = toolCallsUsedIn;
  const executedToolNames = [...executedToolNamesIn];
  let activeTools = activeToolsIn;

  toolCallsUsed++;
  executedToolNames.push(call.name);
  emit('tool_call', { tool: call.name, args: call.input });
  await auditToolDecision(env, {
    tenantId,
    workspaceId,
    userId,
    toolName: call.name,
    eventType: 'tool_executed',
    message: `Executing: ${call.name}`,
    riskLevel: validation.riskLevel,
    reason: 'allowed',
  });
  const toolT0 = Date.now();
  const toolStartNs = toolT0 * 1_000_000;
  let toolOutput = '';
  let execErr = null;
  const inputPreviewMax =
    /terminal|shell|pty|bash|run_command/i.test(String(call.name || '')) ? 4000 : 200;
  emit('tool_start', {
    tool_name: call.name,
    tool_call_id: call.id,
    input_preview: JSON.stringify(call.input || {}).slice(0, inputPreviewMax),
  });
  try {
    const { emitBrowserLiveSessionSse } = await import('../../../browser/sessions/live-session.js');
    emitBrowserLiveSessionSse(emit, 'start', call.name, null);
  } catch {
    /* non-fatal */
  }
  let toolRows = null;
  let execResult = null;
  let wrapperChainId = null;
  let cacheProvenance = null;
  const toolBudgetMs = clampToolBudgetToRunDeadline(
    resolveToolExecutionBudgetMs(call.name, call.input),
    { runStartedAt, maxRunMs, toolName: call.name },
  );
  try {
    if (toolBudgetMs <= 0) throw agentRunDeadlineError(call.name);
    console.info(
      '[agent] tool_execution_start',
      JSON.stringify({ tool_name: call.name, budget_ms: toolBudgetMs, turn: turnCount }),
    );
    if (call.name === CODEMODE_TOOL_NAME && codemodeRuntimeParam?.execute) {
      wrapperChainId = newToolChainId();
      const nestedAuthUser = mcpCtx.authUser ?? authUserParam ?? null;
      execResult = await raceToolExecutionBudget(
        codemodeRuntimeParam.execute(call.input || {}, {
          parentChainId: wrapperChainId,
          parent_chain_id: wrapperChainId,
          // Same resolved actor as native tools — no Codemode privilege synthesis.
          authUser: nestedAuthUser,
          user: nestedAuthUser,
          userId,
          user_id: userId,
          workspaceId,
          workspace_id: workspaceId,
          tenantId,
          tenant_id: tenantId,
          mode: mcpCtx.mode ?? mcpCtx.agent_mode ?? null,
          agent_mode: mcpCtx.mode ?? mcpCtx.agent_mode ?? null,
          source_client: mcpCtx.source_client ?? mcpCtx.sourceClient ?? 'internal_agent',
          sourceClient: mcpCtx.sourceClient ?? mcpCtx.source_client ?? 'internal_agent',
          modelKey: mcpCtx.modelKey ?? mcpCtx.model_key ?? null,
          model_key: mcpCtx.model_key ?? mcpCtx.modelKey ?? null,
          agentRunId: chatAgentRunId,
          agent_run_id: chatAgentRunId,
          conversationId: sessionId,
          conversation_id: sessionId,
          routingArmId: mcpCtx.routingArmId ?? mcpCtx.routing_arm_id ?? null,
          routing_arm_id: mcpCtx.routing_arm_id ?? mcpCtx.routingArmId ?? null,
        }),
        toolBudgetMs,
        call.name,
      );
      if (execResult?.ok === false) {
        execErr = new Error(String(execResult.error || 'codemode_execution_failed'));
      }
      if (execResult?.pending_actions?.length) {
        const proposalIds = await enqueueCodemodePendingActions(
          env,
          workerCtx,
          {
            tenantId,
            workspaceId,
            userId,
            sessionId,
            agent_run_id: chatAgentRunId,
            conversationId: sessionId,
          },
          execResult.pending_actions,
        );
        if (proposalIds.length) {
          emit('approval_required', {
            proposal_ids: proposalIds,
            tool_name: CODEMODE_TOOL_NAME,
            message: 'Codemode queued actions require approval.',
          });
        }
      }
    } else if (isImageGenerationTool(call.name)) {
      const toolInput =
        call.input && typeof call.input === 'object' ? { ...call.input } : {};
      const turnUserMessage =
        lastUserMessageText(conversationMessages) || userTextForForce || '';
      if (!String(toolInput.prompt || toolInput.description || '').trim() && turnUserMessage) {
        toolInput.prompt = turnUserMessage.slice(0, 2000);
      }
      toolInput.persist = imageGenerationShouldPersist(toolInput, {
        userMessage: turnUserMessage,
      });
      execResult = await abortScope.race(
        raceToolExecutionBudget(
          streamImageGenerationSse(emit, env, call.name, toolInput, {
            authUser: { id: userId },
            workspaceId,
            tenantId,
            userId,
            conversationId: sessionId,
            sessionId,
            userMessage: turnUserMessage,
            message: turnUserMessage,
            origin: (env.IAM_ORIGIN || request?.url ? new URL(request.url).origin : '').replace(/\/$/, ''),
          }),
          toolBudgetMs,
          call.name,
        ),
      );
    } else if (
      activeFileEnvelopeParam &&
      /^(fs_write_file|fs_edit_file|write_file|save_file|put_file)$/.test(String(call.name || '')) &&
      activeFileEnvelopeParam.github_repo &&
      activeFileEnvelopeParam.github_path &&
      !(
        mcpCtx.fsa_root === true ||
        mcpCtx._fsa_root === true ||
        mcpCtx.runtimeProfile?._fsa_root === true ||
        String(
          mcpCtx.files_source ||
            mcpCtx.filesSource ||
            mcpCtx.runtimeProfile?._files_source ||
            '',
        )
          .trim()
          .toLowerCase() === 'local'
      )
    ) {
      const ghRepo = activeFileEnvelopeParam.github_repo;
      const ghPath = activeFileEnvelopeParam.github_path;
      execResult = {
        ok: false,
        error: 'wrong_tool_for_github_bound_buffer',
        hint: /edit/i.test(String(call.name || ''))
          ? `This buffer is bound to ${ghRepo}/${ghPath}. Use agentsam_github_patch({ repo: "${ghRepo}", path: "${ghPath}", find: "<exact text>", replace: "<new text>" }).`
          : `This buffer is bound to ${ghRepo}/${ghPath}. Use agentsam_github_write({ repo: "${ghRepo}", path: "${ghPath}", content: "<full file>" }).`,
      };
    } else {
      let toolInput = call.input && typeof call.input === 'object' ? { ...call.input } : {};
      if (call.name === 'fs_search_files') {
        const { normalizeFsSearchFilesParams } = await import('../../filesystem/search.js');
        toolInput = normalizeFsSearchFilesParams(toolInput, {
          userMessage: mcpCtx.userMessage ?? mcpCtx.message ?? null,
          activeFileEnvelope: activeFileEnvelopeParam ?? null,
        });
        if (retrieveKnownSymbols.size > 0) {
          const {
            matchFsSearchAgainstRetrieveKnown,
            softRetrieveFactAlreadyKnownResult,
          } = await import('../../../../src/core/codebase-ast-retrieve.js');
          const hit = matchFsSearchAgainstRetrieveKnown(
            String(toolInput?.query || ''),
            retrieveKnownSymbols,
          );
          if (hit) {
            execResult = softRetrieveFactAlreadyKnownResult(
              String(toolInput.query || ''),
              hit.matched,
              [...retrieveKnownSymbols],
            );
          }
        }
      } else if (
        call.name === 'agentsam_search_tools' ||
        call.name === 'search_tools' ||
        call.name === 'find_tools'
      ) {
        const { normalizeFindToolsInput } = await import(
          '../../../http/agentsam/routes/find-tools-meta-tool.js'
        );
        toolInput = normalizeFindToolsInput(toolInput, {
          userMessage: mcpCtx.userMessage ?? mcpCtx.message ?? null,
          message: mcpCtx.message ?? mcpCtx.userMessage ?? null,
          workspaceId: workspaceId,
          workspace_id: workspaceId,
        });
      } else if (activeFileEnvelopeParam) {
        const { applyActiveFileDefaultsToToolInput } = await import('../../../../src/core/active-file-envelope.js');
        toolInput = applyActiveFileDefaultsToToolInput(call.name, toolInput, activeFileEnvelopeParam);
      }
      if (toolInput?.__blocked === true) {
        execResult = {
          ok: false,
          error: String(toolInput.error || 'tool_blocked'),
          hint: toolInput.hint != null ? String(toolInput.hint) : undefined,
        };
      } else if (execResult == null) {
        const { clientFsBridgeFields } = await import('../../filesystem/transport.js');
        execResult = await abortScope.race(
          dispatchToolCallWithBudget(
            env,
            call.name,
            toolInput,
            {
                sessionId,
                toolCallId: call.id,
                tool_call_id: call.id,
                tenantId,
                userId,
                workspaceId,
                authUser: mcpCtx.authUser ?? authUserParam ?? null,
                personUuid: mcpCtx.personUuid,
                request,
                activeFileEnvelope: activeFileEnvelopeParam,
                ...githubRepoFieldsFromMcpCtx(mcpCtx),
                ...projectFieldsFromMcpCtx(mcpCtx),
                userMessage: mcpCtx.userMessage ?? mcpCtx.message ?? null,
                client_surface: mcpCtx.client_surface ?? mcpCtx.clientSurface ?? null,
                clientSurface: mcpCtx.clientSurface ?? mcpCtx.client_surface ?? null,
                exec_lane: mcpCtx.exec_lane ?? mcpCtx.execLane ?? null,
                execLane: mcpCtx.execLane ?? mcpCtx.exec_lane ?? null,
                ...clientFsBridgeFields(mcpCtx, {
                  emit,
                  toolCallId: call.id,
                  sessionId,
                  signal: abortScope.signal,
                }),
                signal: abortScope.signal,
                abortSignal: abortScope.signal,
                toolBudgetMs,
                ...(mcpCtx.databaseContext
                  ? {
                      databaseContext: mcpCtx.databaseContext,
                      database_context: mcpCtx.databaseContext,
                    }
                  : {}),
                ...(mcpCtx.browserContext
                  ? {
                      browserContext: mcpCtx.browserContext,
                      browser_context: mcpCtx.browserContext,
                      browser_session_id:
                        mcpCtx.browserContext.browser_session_id ??
                        mcpCtx.browserContext.browserSessionId ??
                        null,
                      browserSessionId:
                        mcpCtx.browserContext.browser_session_id ??
                        mcpCtx.browserContext.browserSessionId ??
                        null,
                    }
                  : {}),
                skipToolCallLog: true,
                ledgerOwner: 'tool_loop',
                ...runSpineIds,
            },
            toolBudgetMs,
          ),
        );
      }
    }
    if (execResult && typeof execResult === 'object') {
      if (Array.isArray(execResult.rows)) toolRows = execResult.rows;
      else if (Array.isArray(execResult.results)) toolRows = execResult.results;
    }
    cacheProvenance =
      execResult &&
      typeof execResult === 'object' &&
      /** @type {{ __cacheProvenance?: { cacheHit?: boolean, resultSource?: string } }} */ (execResult)
        .__cacheProvenance
        ? /** @type {{ __cacheProvenance: { cacheHit?: boolean, resultSource?: string } }} */ (execResult)
            .__cacheProvenance
        : null;
    if (
      !execErr &&
      /^agentsam_github_create_branch$|^github_create_branch$/.test(String(call.name || '').trim()) &&
      execResult &&
      typeof execResult === 'object'
    ) {
      const createdBranch = String(execResult.branch || execResult.body?.branch || '').trim();
      if (createdBranch) {
        emit('github_branch_context', {
          repo: String(execResult.repo || execResult.body?.repo || call.arguments?.repo || '').trim() || null,
          branch: createdBranch,
          source: 'create_branch',
        });
      }
    }
    toolOutput = capToolResultForPrompt(
      typeof execResult === 'string' ? execResult : JSON.stringify(execResult),
    );
    if (
      !execErr &&
      execResult &&
      typeof execResult === 'object' &&
      execResult.soft_validation_error === true
    ) {
      const softDetail =
        execResult.user_message != null && String(execResult.user_message).trim() !== ''
          ? String(execResult.user_message).trim()
          : String(execResult.error || 'missing_required_arg');
      const softCode = String(execResult.code || 'missing_required_arg');
      execErr = Object.assign(new Error(softDetail), {
        code: softCode,
        soft: true,
      });
      console.warn('[agent] tool_error', call.name, softDetail);
      emit('tool_error', {
        tool: call.name,
        tool_name: call.name,
        tool_call_id: call.id,
        error: softDetail,
        code: softCode,
        soft: true,
        ...(execResult.hint ? { hint: String(execResult.hint) } : {}),
        ...(execResult.recovery ? { recovery: execResult.recovery } : {}),
        ...(execResult.schema_hint ? { schema_hint: execResult.schema_hint } : {}),
      });
    }
    if (!execErr && CODEBASE_RETRIEVE_TOOL_KEYS.has(String(call.name || ''))) {
      try {
        const { absorbRetrieveKnownSymbols } = await import('../../../../src/core/codebase-ast-retrieve.js');
        const payload =
          execResult && typeof execResult === 'object'
            ? execResult
            : JSON.parse(String(toolOutput || '{}'));
        absorbRetrieveKnownSymbols(payload, retrieveKnownSymbols);
      } catch {
        /* non-fatal */
      }
    }
    if (!execErr) {
      try {
        const {
          isAgentsamSearchToolsName,
          hydrateActiveToolsFromSearchResult,
        } = await import('../../../../src/core/progressive-tool-discovery.js');
        if (isAgentsamSearchToolsName(call.name)) {
          const userMessage =
            lastUserMessageText(conversationMessages) || userTextForForce || '';
          const preferKeys = extractExplicitCatalogToolKeys(userMessage);
          try {
            const { userMessageReferencesTicketId, TICKET_INSPECT_PIN_TOOL_KEYS } =
              await import('../../../../src/core/progressive-tool-discovery.js');
            if (userMessageReferencesTicketId(userMessage)) {
              for (const k of TICKET_INSPECT_PIN_TOOL_KEYS) {
                if (!preferKeys.includes(k)) preferKeys.push(k);
              }
            }
          } catch {
            /* pin helpers optional */
          }
          const hydrated = await hydrateActiveToolsFromSearchResult(
            env,
            activeTools,
            execResult,
            {
              preferKeys,
              userMessage,
              allowMediaTools: imageAskForTurn === true,
              imageAsk: imageAskForTurn === true,
              fsaRoot:
                mcpCtx.fsa_root === true || mcpCtx.runtimeProfile?._fsa_root === true,
              filesSource: String(
                mcpCtx.files_source || mcpCtx.runtimeProfile?._files_source || '',
              )
                .trim()
                .toLowerCase(),
            },
          );
          if (hydrated.added.length) {
            activeTools = hydrated.tools;
            emit('tools_hydrated', {
              source: 'agentsam_search_tools',
              added: hydrated.added,
              active_tools: activeTools.length,
            });
          }
        }
      } catch (e) {
        console.warn('[agent] progressive_hydrate', e?.message ?? e);
      }
    }
    const BROWSER_VERIFY_FAIL_TOOLS = new Set([
      'browser_navigate',
      'cdt_navigate_page',
      'browser_verify_current_page',
      'browser_content',
    ]);
    if (
      !execErr &&
      execResult &&
      typeof execResult === 'object' &&
      BROWSER_VERIFY_FAIL_TOOLS.has(call.name)
    ) {
      const verificationFailed =
        execResult.ok === false ||
        execResult.verified === false ||
        execResult.url_verified === false ||
        execResult.live_view_verified === false ||
        execResult.verification_failed === true;
      if (verificationFailed) {
        const detail =
          typeof execResult.error === 'string' && execResult.error.trim()
            ? execResult.error.trim()
            : 'Navigation was requested but not verified.';
        execErr = Object.assign(new Error(detail), { code: 'verification_failed' });
        emit('browser_verification_failed', {
          tool_name: call.name,
          tool_call_id: call.id,
          agent_run_id:
            execResult.agent_run_id ??
            execResult.smoke_debug?.agent_run_id ??
            runSpineIds?.agent_run_id ??
            null,
          session_id:
            execResult.session_id ?? execResult.smoke_debug?.session_id ?? null,
          target_id: execResult.target_id ?? null,
          requested_url:
            execResult.requested_url ?? execResult.expected_url ?? null,
          url: execResult.url ?? null,
          verified: false,
          code: 'verification_failed',
        });
        emit('tool_error', {
          tool: call.name,
          tool_name: call.name,
          tool_call_id: call.id,
          error: detail,
          code: 'verification_failed',
        });
      }
    }
    if (
      execResult &&
      typeof execResult === 'object' &&
      (execResult.code === 'browser_origin_not_trusted' ||
        String(execResult.error || '').includes('Browser origin not trusted'))
    ) {
      emit('browser_trust_required', {
        origin: execResult.origin ?? null,
        tool_name: call.name,
        message:
          'Trust this origin in the IAM browser consent modal (Browser tab), then retry.',
      });
    }
    if (call.name === 'excalidraw_plan_map_create') {
      try {
        const parsed =
          execResult && typeof execResult === 'object'
            ? execResult
            : JSON.parse(String(toolOutput || '{}'));
        if (
          parsed &&
          !parsed.error &&
          parsed.open_draw &&
          (parsed.artifact_id || parsed.public_url)
        ) {
          const origin = (env.IAM_ORIGIN || '').replace(/\/$/, '') || '';
          const loadUrl =
            typeof parsed.public_url === 'string' && parsed.public_url.trim()
              ? parsed.public_url.trim()
              : origin && parsed.artifact_id
                ? `${origin}/api/artifacts/${encodeURIComponent(String(parsed.artifact_id))}/content`
                : '';
          emit('surface_open', {
            surface: 'excalidraw',
            reason: 'excalidraw_plan_map_create',
            artifact_id: parsed.artifact_id ?? null,
            load_url: loadUrl,
            artifact_type: 'excalidraw',
          });
          emit('agent_surface_open', {
            surface: 'excalidraw',
            reason: 'excalidraw_plan_map_create',
            artifact_id: parsed.artifact_id ?? null,
            load_url: loadUrl,
            artifact_type: 'excalidraw',
          });
        }
      } catch (_) {
        /* ignore malformed tool JSON */
      }
    }
    if (call.name === 'illustration_create') {
      try {
        const parsed =
          execResult && typeof execResult === 'object'
            ? execResult
            : JSON.parse(String(toolOutput || '{}'));
        if (!parsed || parsed.error || parsed.ok === false) {
          /* skip surface open */
        } else if (parsed.open_draw && (parsed.artifact_id || parsed.public_url)) {
          const origin = (env.IAM_ORIGIN || '').replace(/\/$/, '') || '';
          const loadUrl =
            typeof parsed.public_url === 'string' && parsed.public_url.trim()
              ? parsed.public_url.trim()
              : origin && parsed.artifact_id
                ? `${origin}/api/artifacts/${encodeURIComponent(String(parsed.artifact_id))}/content`
                : '';
          emit('surface_open', {
            surface: 'excalidraw',
            reason: 'illustration_create',
            artifact_id: parsed.artifact_id ?? null,
            load_url: loadUrl,
            artifact_type: 'excalidraw',
            lane: parsed.lane ?? 'excalidraw',
            engine: parsed.engine ?? null,
          });
          emit('agent_surface_open', {
            surface: 'excalidraw',
            reason: 'illustration_create',
            artifact_id: parsed.artifact_id ?? null,
            load_url: loadUrl,
            artifact_type: 'excalidraw',
            lane: parsed.lane ?? 'excalidraw',
            engine: parsed.engine ?? null,
          });
        } else if (parsed.open_designstudio && (parsed.job_id || parsed.cad_job_id)) {
          const jobId = parsed.job_id ?? parsed.cad_job_id;
          emit('surface_open', {
            surface: 'designstudio',
            reason: 'illustration_create',
            job_id: jobId != null ? String(jobId) : null,
            lane: parsed.lane ?? 'cad',
            engine: parsed.engine ?? null,
            cad_job_live: true,
          });
          emit('agent_surface_open', {
            surface: 'designstudio',
            reason: 'illustration_create',
            job_id: jobId != null ? String(jobId) : null,
            lane: parsed.lane ?? 'cad',
            engine: parsed.engine ?? null,
            cad_job_live: true,
          });
        }
      } catch (_) {
        /* ignore malformed tool JSON */
      }
    }
    if (!execErr) {
      const surfaceFromTool = (() => {
        const input =
          call.input && typeof call.input === 'object'
            ? /** @type {Record<string, unknown>} */ (call.input)
            : {};
        const result =
          execResult && typeof execResult === 'object'
            ? /** @type {Record<string, unknown>} */ (execResult)
            : {};
        if (call.name === 'browser_navigate' || call.name === 'cdt_navigate_page') {
          const navUrl =
            (typeof input.url === 'string' && input.url.trim()) ||
            (typeof result.url === 'string' && result.url.trim()) ||
            '';
          const target = navUrl.startsWith('http://localhost')
            ? { kind: 'localhost', port: Number(navUrl.match(/:(\d+)/)?.[1]) || undefined }
            : navUrl
              ? { kind: 'url', url: navUrl }
              : null;
          return {
            surface: 'browser',
            reason: call.name,
            tool_name: call.name,
            url: navUrl || undefined,
            target,
          };
        }
        if (call.name === 'monaco_open' || call.name === 'monaco_open_file') {
          const path =
            (typeof input.path === 'string' && input.path.trim()) ||
            (typeof input.file_path === 'string' && input.file_path.trim()) ||
            '';
          return {
            surface: 'monaco',
            reason: call.name,
            tool_name: call.name,
            workspace_path: path || undefined,
            target: path ? { kind: 'local_file', workspace_path: path } : { kind: 'surface_only', surface: 'code' },
          };
        }
        if (call.name === 'excalidraw_open' || call.name === 'agentsam_excalidraw') {
          return { surface: 'excalidraw', reason: 'agentsam_excalidraw', tool_name: call.name };
        }
        if (
          call.name === 'cms_read' ||
          call.name === 'cms_write' ||
          call.name === 'cms_publish' ||
          call.name === 'agentsam_cms_read' ||
          call.name === 'agentsam_cms_write' ||
          call.name === 'agentsam_cms_publish' ||
          call.name === 'agentsam_cms_page_create' ||
          call.name === 'agentsam_cms_section_create' ||
          call.name === 'agentsam_cms_section_update' ||
          call.name === 'agentsam_cms_block_create' ||
          call.name === 'agentsam_cms_block_update' ||
          call.name === 'agentsam_cms_save_site_shell' ||
          call.name === 'agentsam_cms_publish_site_shell' ||
          call.name === 'cms_pipeline_prototype' ||
          call.name === 'cms_pipeline_extract' ||
          call.name === 'cms_pipeline_inject' ||
          call.name === 'cms_pipeline_bootstrap'
        ) {
          const slug =
            (typeof input.project_slug === 'string' && input.project_slug.trim()) ||
            (typeof result.project_slug === 'string' && result.project_slug.trim()) ||
            '';
          const pageId =
            (typeof input.page_id === 'string' && input.page_id.trim()) ||
            (typeof result.page_id === 'string' && result.page_id.trim()) ||
            '';
          const previewUrl =
            (typeof result.preview_url === 'string' && result.preview_url.trim()) ||
            (typeof result.public_url === 'string' && result.public_url.trim()) ||
            '';
          if (previewUrl) {
            return {
              surface: 'browser',
              reason: call.name,
              tool_name: call.name,
              url: previewUrl,
              page_id: pageId || undefined,
              project_slug: slug || undefined,
              target: { kind: 'cms_preview_url', url: previewUrl, page_id: pageId || undefined },
            };
          }
          if (slug) {
            return {
              surface: 'cms',
              reason: call.name,
              tool_name: call.name,
              project_slug: slug,
              page_id: pageId || undefined,
              target: { kind: 'cms_panel', project_slug: slug, page_id: pageId || undefined },
            };
          }
        }
        if (call.name === 'image_generate' || isImageGenerationTool(call.name)) {
          return { surface: 'image', reason: call.name, tool_name: call.name };
        }
        return null;
      })();
      if (surfaceFromTool) {
        emit('surface_open', surfaceFromTool);
        emit('agent_surface_open', surfaceFromTool);
      }
    }
  } catch (e) {
    if (isAgentRunAbortError(e)) return { earlyReturn: exitCancelled() };
    execErr = e;
    const isTimeout =
      e &&
      typeof e === 'object' &&
      'code' in e &&
      /** @type {{ code?: string }} */ (e).code === 'tool_timeout';
    const isDeadline =
      e &&
      typeof e === 'object' &&
      'code' in e &&
      /** @type {{ code?: string }} */ (e).code === 'agent_run_deadline';
    const detailRaw = isTimeout
      ? `Tool timed out after ${toolBudgetMs}ms`
      : e && typeof e === 'object' && 'message' in e && typeof e.message === 'string'
        ? e.message
        : String(e ?? 'unknown_error');
    const detail = isTimeout ? detailRaw : sanitizeToolCredentialError(detailRaw);
    if (!isTimeout && !isDeadline && isMissingRequiredArgErrorText(detail)) {
      toolOutput = JSON.stringify(softMissingRequiredArgResult(call.name, detail));
      if (execErr && typeof execErr === 'object') {
        /** @type {{ code?: string, soft?: boolean }} */ (execErr).code = 'missing_required_arg';
        /** @type {{ code?: string, soft?: boolean }} */ (execErr).soft = true;
      }
    } else {
      toolOutput = isDeadline ? detail : `Tool execution failed: ${detail}`;
    }
    console.warn('[agent] tool_error', call.name, detailRaw);
    emit('tool_error', {
      tool: call.name,
      tool_name: call.name,
      tool_call_id: call.id,
      error: detail,
      ...(isTimeout ? { code: 'tool_timeout' } : {}),
      ...(isDeadline ? { code: 'agent_run_deadline' } : {}),
      ...(!isTimeout && !isDeadline && isMissingRequiredArgErrorText(detail)
        ? { code: 'missing_required_arg', soft: true }
        : {}),
    });
  }

  return {
    toolOutput,
    execErr,
    execResult,
    toolRows,
    toolT0,
    toolStartNs,
    toolBudgetMs,
    activeTools,
    toolCallsUsed,
    executedToolNames,
    wrapperChainId,
    cacheProvenance,
  };
}
