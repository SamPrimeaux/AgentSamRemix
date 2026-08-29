/**
 * Chat turn SSE handler — Pass B uses canonical turnContext.
 * Ticket: tkt_mod_peel_agent_chat_api_2026_08
 */
import { scheduleChatSessionTitleInsert } from '../../agentsam/sessions/index.js';
import { writeAgentsamErrorLog } from '../../telemetry/error-log.js';
import { jsonResponse } from './shared.js';
import { resolveAgentCommand } from '../../agentsam/commands/resolve.js';
import { resolveAgentTurnContext } from '../../agentsam/runtime/turn/context.js';

function turnContextErrorResponse(error) {
  const body = { error: error.code };
  if (error.message) body.message = error.message;
  if (error.redirect) body.redirect = error.redirect;
  if (error.details) Object.assign(body, error.details);
  return jsonResponse(body, error.httpStatus || 400);
}

export async function agentChatSseHandler(env, request, ctx, opts = {}) {
  const { ingestBypass, identity } = opts;
  const services = opts.services || {};
  const planServices = opts.planServices || null;
  const {
    startAgentChatEarlySse,
    withD1Retry,
    loadAgentSamUserPolicy,
    evaluateGuardrails,
    resolveSubagentProfileForChat,
    applySubagentDefaultModelToBody,
    extractOpenFileContentFromMessage,
    activeFileIsLocalWorkspaceBuffer,
    buildHandoffPrimingUserMessage,
    markHandoffAccepted,
    resolvePendingHandoffForSession,
    kickoffModelTierMigration,
    parseJsonSafe,
    parseStagedAttachmentIds,
    peekAgentAttachment,
    assertTenantSpendPolicy,
    parseActiveFileEnvelope,
    resolveChatGithubRepoContext,
    sanitizeGithubRepoContextForChat,
    parseContextEnvelope,
    mergeContextEnvelopeIntoActiveFile,
    resolveDesignStudioChatOverrides,
    executeAgentChatSpine,
  } = services;
  if (
    typeof startAgentChatEarlySse !== 'function' ||
    typeof withD1Retry !== 'function' ||
    typeof loadAgentSamUserPolicy !== 'function' ||
    typeof evaluateGuardrails !== 'function' ||
    typeof resolveSubagentProfileForChat !== 'function' ||
    typeof applySubagentDefaultModelToBody !== 'function' ||
    typeof kickoffModelTierMigration !== 'function' ||
    typeof parseJsonSafe !== 'function' ||
    typeof parseStagedAttachmentIds !== 'function' ||
    typeof peekAgentAttachment !== 'function' ||
    typeof assertTenantSpendPolicy !== 'function' ||
    typeof executeAgentChatSpine !== 'function'
  ) {
    return jsonResponse({ error: 'agent_chat_services_required' }, 503);
  }
  const contentType = request.headers.get('content-type') || '';
  let body = {};

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    body = Object.fromEntries(formData.entries());
    const files = formData.getAll('files');
    const images = formData.getAll('images');
    if (files.length) body.files = files;
    if (images.length) body.images = images;
  } else {
    body = await request.json().catch(() => ({}));
  }

  const built = await resolveAgentTurnContext({
    env,
    request,
    body,
    identity,
    ingestBypass: !!ingestBypass,
  });
  if (!built.ok) return turnContextErrorResponse(built.error);

  const { turnContext } = built;
  body = built.body;
  let message = built.message;
  // `message` may contain hidden @file/browser/tool context for this inference turn.
  // `durableUserMessage` is the operator-authored text and is the only user text allowed
  // into durable conversation history/title generation.
  const durableUserMessage = String(
    body.user_message ?? body.userMessage ?? built.message ?? '',
  ).trim();
  body._durable_user_message = durableUserMessage;

  const {
    userId,
    tenantId,
    workspaceId,
    conversationId: sessionId,
    runtimeMode: requestedMode,
    ingestBypass: turnIngestBypass,
    authUser: chatAuthUser,
    projectRef,
    workSessionId,
  } = turnContext;

  // Staged tool binaries (att_*) — model can pass attachment_id to agentsam_r2_put.
  try {
    const stagedIds = parseStagedAttachmentIds(
      body.staged_attachment_ids ?? body.stagedAttachmentIds ?? body.attachment_ids,
    );
    if (stagedIds.length) {
      const lines = [];
      for (const id of stagedIds.slice(0, 12)) {
        const peek = await peekAgentAttachment(env, id, {
          workspaceId,
        });
        if (peek.ok) {
          lines.push(
            `- ${id}: ${peek.filename || 'file'} (${peek.content_type}, ${peek.size} bytes)`,
          );
        } else {
          lines.push(`- ${id}: (expired or missing)`);
        }
      }
      message +=
        '\n\n[Staged attachments for tools — pass attachment_id to agentsam_r2_put with bucket, key, purpose; durable library after put: /dashboard/images/storage or /dashboard/artifacts]\n' +
        lines.join('\n');
    }
  } catch (e) {
    console.warn('[agent/chat] staged_attachment_ids', e?.message ?? e);
  }

  const quickstartBatch =
    body?.quickstart_batch != null && String(body.quickstart_batch).trim() !== ''
      ? String(body.quickstart_batch).trim()
      : body?.quickstartBatch != null && String(body.quickstartBatch).trim() !== ''
        ? String(body.quickstartBatch).trim()
        : '';

  let skipCommandResolution = false;
  try {
    const bcRaw = body.browserContext;
    const bc =
      typeof bcRaw === 'string' && bcRaw.trim()
        ? JSON.parse(bcRaw)
        : bcRaw && typeof bcRaw === 'object'
          ? bcRaw
          : null;
    if (bc?.selected_element && typeof bc.selected_element === 'object') skipCommandResolution = true;
  } catch {
    /* ignore */
  }

  const cmdResult = skipCommandResolution
    ? { resolved: false, blocked: false, blockReason: null, requiresConfirmation: false }
    : await resolveAgentCommand(env, {
        message: body.message,
        userId,
        workspaceId,
        tenantId,
        mode: requestedMode,
      });

  if (cmdResult.resolved) {
    if (cmdResult.blocked) {
      return jsonResponse(
        {
          error: cmdResult.blockReason,
          command: cmdResult.mappedCommand,
        },
        403,
      );
    }
    if (cmdResult.requiresConfirmation) {
      return jsonResponse(
        {
          requires_confirmation: true,
          command: cmdResult.mappedCommand,
          risk_level: cmdResult.riskLevel,
          message: 'Confirm execution of: ' + cmdResult.mappedCommand,
        },
        202,
      );
    }
    body.message = cmdResult.mappedCommand;
    body._resolved_command_id = cmdResult.command?.id || null;
    body._resolved_command_slug = cmdResult.command?.slug || null;
  }

  message = (body.message || '').trim();

  scheduleChatSessionTitleInsert(env, ctx, {
    conversationId: sessionId,
    tenantId,
    userId,
    workspaceId,
    message: durableUserMessage || message,
    body,
  });

  /** @type {{ turnId: string, assistantMessageId: string }|null} */
  let chatTurnMeta = null;

  return startAgentChatEarlySse(
    async ({ emit, pipeResponse, streamLifecycle, bindTurnOutbox }) => {
    const heartbeat = setInterval(() => {
      void emit('status', { phase: 'preflight', heartbeat: true });
    }, 12000);
    const stopHeartbeat = () => clearInterval(heartbeat);

    if (sessionId) {
      try {
        const { beginChatTurn, markChatTurnStatus } = await import('../../agentsam/sessions/chat-do-client.js');
        chatTurnMeta = await beginChatTurn(env, sessionId, {
          model_key: body.model_key ?? body.model ?? null,
          timeoutMs: 4000,
          user_content: durableUserMessage || (typeof message === 'string' ? message : ''),
        });
        if (chatTurnMeta) {
          streamLifecycle.setTurnMeta(chatTurnMeta);
          bindTurnOutbox(chatTurnMeta.turnId);
          await emit('turn_meta', {
            turn_id: chatTurnMeta.turnId,
            conversation_id: sessionId,
            assistant_message_id: chatTurnMeta.assistantMessageId,
          });
          void markChatTurnStatus(env, sessionId, 'in_progress', null, {
            assistantMessageId: chatTurnMeta.assistantMessageId,
          });
        }
      } catch (e) {
        console.warn('[agent] beginChatTurn', e?.message ?? e);
      }
    }

    const casualFastPath = false;

    try {
    if (chatTurnMeta) {
      streamLifecycle.setTurnMeta(chatTurnMeta);
    }

    // Text/log/code uploads are current-turn context only. Read their multipart bytes in
    // this Worker invocation after the durable user message has been reserved; never put
    // them in KV/R2 and never copy their bodies into conversation history.
    try {
      const { buildEphemeralTextAttachmentContext } = await import(
        '../../agentsam/runtime/turn/ephemeral-attachments.js'
      );
      const ephemeralAttachments = await buildEphemeralTextAttachmentContext(body.files);
      if (ephemeralAttachments.text) {
        message = `${message}

${ephemeralAttachments.text}`;
        body.message = message;
        await emit('context', {
          phase: 'ephemeral_attachments',
          files: ephemeralAttachments.files,
        });
      }
    } catch (e) {
      console.warn('[agent/chat] ephemeral_attachments', e?.message ?? e);
    }
    if (!casualFastPath && !turnIngestBypass && tenantId) {
      try {
        const spendGate = await withD1Retry(() =>
          assertTenantSpendPolicy(env, {
            tenantId,
            userId,
            workspaceId,
            sessionId: sessionId ? String(sessionId) : null,
            isPlatformOperator: false,
          }),
        );
        if (!spendGate.ok) {
          return jsonResponse(
            {
              error: spendGate.error || 'spend_policy_denied',
              message: spendGate.message || 'Spend policy blocked this request.',
              spent_usd: spendGate.spent_usd ?? null,
              cap_usd: spendGate.cap_usd ?? null,
              upgrade_url: '/dashboard/settings/integrations',
            },
            402,
          );
        }
      } catch (spendErr) {
        console.warn('[agent] spend_policy_gate', spendErr?.message ?? spendErr);
      }
    }

    let handoffResume = null;
    if (!casualFastPath && sessionId && env.DB) {
      try {
        handoffResume = await withD1Retry(() =>
          resolvePendingHandoffForSession(env, {
            sessionId: String(sessionId),
            workspaceId,
          }),
        );
        if (handoffResume?.fallbackModelKey) {
          body.model = handoffResume.fallbackModelKey;
          body.model_key = handoffResume.fallbackModelKey;
          body.handoff_resume = true;
          const primer = buildHandoffPrimingUserMessage(handoffResume);
          if (primer && !body._handoff_priming_applied) {
            body._handoff_priming_applied = true;
            const trimmedMsg = String(message || '').trim();
            if (!trimmedMsg || trimmedMsg.length < 24 || /^continue$/i.test(trimmedMsg)) {
              message = primer;
              body.message = primer;
            } else {
              message = `${primer}\n\n---\nUser follow-up:\n${trimmedMsg}`;
              body.message = message;
            }
          }
          await markHandoffAccepted(env, handoffResume.spawnId, {
            childRunId: handoffResume.childRunId,
          });
        }
      } catch (e) {
        console.warn('[agent-handoff] resume_pickup', e?.message ?? e);
      }
    }

    let activeFileEnvelope = null;
    try {
      activeFileEnvelope = parseActiveFileEnvelope(body);
      if (activeFileEnvelope) {
        if (!activeFileEnvelope.content) {
          const extracted = extractOpenFileContentFromMessage(message);
          if (extracted) activeFileEnvelope.content = extracted;
        }
        body.activeFileEnvelope = activeFileEnvelope;
      }
      const { parseProjectContextFromBody } = await import('../../agentsam/runtime/project-context.js');
      const projectContext = parseProjectContextFromBody(body);
      if (projectContext) body.projectContext = projectContext;

      const githubRepoContext = await resolveChatGithubRepoContext(env, {
        body,
        projectContext,
        activeFileEnvelope,
        userId: String(userId),
        tenantId: tenantId != null ? String(tenantId) : null,
        workspaceId: String(workspaceId),
      });
      if (githubRepoContext) body.selectedGithubRepoContext = githubRepoContext;
      if (activeFileEnvelope?.github_repo && userId && workspaceId && tenantId) {
        try {
          const safeEnv = await sanitizeGithubRepoContextForChat(env, {
            userId: String(userId),
            tenantId: String(tenantId),
            workspaceId: String(workspaceId),
            clientRepo: activeFileEnvelope.github_repo,
          });
          if (!safeEnv) {
            delete activeFileEnvelope.github_repo;
            delete activeFileEnvelope.github_path;
            body.activeFileEnvelope = activeFileEnvelope;
          }
        } catch (_) {
          /* ignore */
        }
      }
      // Never invent a github "open file" from ambient workspace repo.
      // Open buffer = client ActiveFile only (active_file_source + path/sha).
      // githubRepoContext may still be set on body for tool discovery — not as a fake Monaco file.
      if (
        activeFileEnvelope &&
        String(activeFileEnvelope.source || '').toLowerCase() === 'github' &&
        githubRepoContext &&
        !activeFileEnvelope.github_repo
      ) {
        activeFileEnvelope.github_repo = githubRepoContext;
        body.activeFileEnvelope = activeFileEnvelope;
      }
      const contextEnvelope = parseContextEnvelope(body);
      if (contextEnvelope) {
        body.contextEnvelope = contextEnvelope;
        activeFileEnvelope = mergeContextEnvelopeIntoActiveFile(activeFileEnvelope, contextEnvelope, {
          parseActiveFileEnvelope,
          activeFileIsLocalWorkspaceBuffer,
        });
        if (activeFileEnvelope) body.activeFileEnvelope = activeFileEnvelope;
      }
    } catch (e) {
      console.warn('[agent] active_file_envelope_parse', e?.message ?? e);
    }

    let subagentProfileRow = null;
    if (!casualFastPath) {
    try {
      subagentProfileRow = await withD1Retry(() =>
        resolveSubagentProfileForChat(env.DB, {
          userId: String(userId),
          workspaceId,
          tenantId,
          profileId: body.subagent_profile_id ?? body.subagentProfileId,
          slug: body.subagent_slug ?? body.subagentSlug,
        }),
      );
      if (subagentProfileRow) {
        body.subagent_profile_id = subagentProfileRow.id;
        body.subagent_slug = subagentProfileRow.slug;
        body.subagent = true;
        applySubagentDefaultModelToBody(body, subagentProfileRow);
      }
      // No ask-mode codex-default preset — only honor an explicitly chosen slug/id.
    } catch (e) {
      console.warn('[agent] subagent_profile_resolve', e?.message ?? e);
    }
    }

    const grRoute = casualFastPath
      ? { blocked: false }
      : await withD1Retry(() =>
      evaluateGuardrails(env, ctx, {
        applies_to: 'route',
        tenant_id: tenantId,
        workspace_id: workspaceId,
        user_id: userId,
        session_id: sessionId,
        conversation_id: sessionId,
        request_id: sessionId,
        route_path: '/api/agent/chat',
        project_id: projectRef,
      }),
    );
    if (grRoute.blocked) {
      return jsonResponse(
        {
          error: grRoute.decision?.reason || 'guardrail_blocked',
          guardrail: grRoute.decision?.guardrail_key,
        },
        403,
      );
    }

    let browserContextPayload = null;
    try {
      const bc = body.browserContext ?? body.browser_context;
      if (typeof bc === 'string' && bc.trim()) browserContextPayload = parseJsonSafe(bc.trim(), null);
      else if (bc && typeof bc === 'object') browserContextPayload = bc;
    } catch (_) {
      browserContextPayload = null;
    }
    try {
      const dsRouteOverrides = resolveDesignStudioChatOverrides(browserContextPayload, body, message);
      if (dsRouteOverrides?.route_key) body.route_key = dsRouteOverrides.route_key;
      // Do not inject design-studio subagent_slug — only honor an explicit client choice.
    } catch (_) {
      /* ignore */
    }
    const cmsRaw = body.cms_context ?? body.cmsContext;
    if (cmsRaw && typeof cmsRaw === 'object') {
      browserContextPayload = browserContextPayload && typeof browserContextPayload === 'object'
        ? { ...browserContextPayload, cms_context: cmsRaw }
        : { cms_context: cmsRaw };
    }

    // Law: never guess workflows/tools from free-text message shape.
    // Explicit workflow_key / surface pin only (agentsam routes). Chat goes to the model + profile menu.
    const userPolicy = casualFastPath
      ? null
      : await withD1Retry(() => loadAgentSamUserPolicy(env, userId, workspaceId)).catch(() => null);

    kickoffModelTierMigration(env, ctx);

    return executeAgentChatSpine(env, request, ctx, {
      body,
      message,
      requestedMode,
      tenantId,
      userId,
      workspaceId,
      sessionId,
      authUser: chatAuthUser,
      subagentProfileRow,
      activeFileEnvelope,
      browserContextPayload,
      handoffResume,
      userPolicy,
      quickstartBatch,
      streamLifecycle,
      chatTurnMeta,
      projectContext: body.projectContext ?? null,
      planServices,
      services,
      // Single SSE writer — controller must not open a nested TransformStream.
      emit,
    });
    } finally {
      stopHeartbeat();
    }
  }, {
    conversationId: sessionId,
    userId,
    workspaceId,
    env,
    waitUntil: (promise) => ctx.waitUntil(promise),
    onStreamClose: async (result) => {
      if (!sessionId) return;
      const { markChatTurnStatus } = await import('../../agentsam/sessions/chat-do-client.js');
      const turnOpts = {
        assistantMessageId:
          result?.assistantMessageId != null ? String(result.assistantMessageId) : null,
        content:
          typeof result?.assistant_text === 'string' && result.assistant_text.trim()
            ? result.assistant_text
            : undefined,
      };
      if (result?.saw_error) {
        await markChatTurnStatus(env, sessionId, 'failed', String(result.reason || 'stream_error'), turnOpts);
      } else if (!result?.saw_token && !result?.saw_done) {
        await markChatTurnStatus(
          env,
          sessionId,
          'interrupted',
          'close_without_token_or_done',
          turnOpts,
        );
      } else if (result?.saw_done && !result?.saw_token) {
        await markChatTurnStatus(env, sessionId, 'done_no_token', 'stream_done_no_text', turnOpts);
      } else if (result?.saw_token && !result?.saw_done) {
        await markChatTurnStatus(
          env,
          sessionId,
          'interrupted',
          'stream_closed_without_done',
          turnOpts,
        );
      } else if (result?.saw_token && result?.saw_done) {
        await markChatTurnStatus(env, sessionId, 'completed', null, turnOpts);
      }

      // Durable trail for invisible stream deaths (timeout / done_no_token / silent close).
      // Console event_types alone evaporate; agentsam_error_log is the post-facto search surface.
      const needsErrorLog =
        Boolean(result?.saw_error) ||
        (Boolean(result?.saw_done) && !result?.saw_token) ||
        (!result?.saw_token && !result?.saw_done);
      const skipLogCode = String(result?.last_error_code || '') === 'agent_run_cancelled';
      if (needsErrorLog && !skipLogCode && workspaceId && tenantId && env?.DB) {
        try {
          const code =
            (result?.last_error_code != null && String(result.last_error_code).trim()) ||
            (result?.saw_error
              ? 'stream_error'
              : result?.saw_done && !result?.saw_token
                ? 'done_no_token'
                : 'close_without_token_or_done');
          const msg =
            (result?.last_error_message != null && String(result.last_error_message).trim()) ||
            (result?.last_error_detail != null && String(result.last_error_detail).trim()) ||
            String(result?.reason || code);
          const written = await writeAgentsamErrorLog(env, {
            workspaceId: String(workspaceId),
            tenantId: String(tenantId),
            sessionId: String(sessionId),
            errorCode: String(code).slice(0, 120),
            errorType: 'agent_chat_stream',
            errorMessage: msg,
            source: 'agent_chat_early_sse',
            sourceId:
              result?.assistantMessageId != null
                ? String(result.assistantMessageId)
                : result?.last_error_extras?.agent_run_id != null
                  ? String(result.last_error_extras.agent_run_id)
                  : String(sessionId),
            contextJson: JSON.stringify({
              conversation_id: sessionId,
              user_id: userId ?? null,
              elapsed_ms: result?.elapsed_ms ?? null,
              event_types: result?.event_types ?? null,
              saw_token: result?.saw_token ?? null,
              saw_done: result?.saw_done ?? null,
              saw_error: result?.saw_error ?? null,
              reason: result?.reason ?? null,
              turnId: result?.turnId ?? null,
              assistantMessageId: result?.assistantMessageId ?? null,
              last_error_extras: result?.last_error_extras ?? null,
            }),
            stackTrace:
              result?.last_error_detail != null ? String(result.last_error_detail).slice(0, 12000) : null,
          });
          if (!written.ok) {
            console.warn(
              '[agent-chat] stream_close_error_log_failed',
              JSON.stringify({ session_id: sessionId, error: written.error || 'write_failed' }),
            );
          }
        } catch (e) {
          console.warn('[agent-chat] stream_close_error_log', e?.message ?? e);
        }
      }
      // Terminal status safety net for aborts/errors only.
      // Clean completions (saw_done, no error): agent-controller accounting owns
      // status/completed_at. Cancel-sweeping on every close raced that path and
      // still left ghosts when both waitUntil tasks were dropped after long turns.
      try {
        const needsCancelSweep = Boolean(result?.saw_error) || !result?.saw_done;
        if (needsCancelSweep) {
          const { cancelAgentRunsForConversation } = await import(
            '../../telemetry/agent-run.js'
          );
          const reason = result?.saw_error
            ? 'sse_close_error'
            : 'sse_closed_without_done';
          const sweep = () =>
            cancelAgentRunsForConversation(env, {
              conversationId: sessionId,
              userId,
              reason,
            });
          if (ctx?.waitUntil) {
            ctx.waitUntil(
              Promise.resolve()
                .then(sweep)
                .catch((e) => console.warn('[agent] agent_run sse close finalize', e?.message ?? e)),
            );
          } else {
            await sweep();
          }
        }
      } catch (e) {
        console.warn('[agent] agent_run sse close finalize', e?.message ?? e);
      }
    },
  });
}
