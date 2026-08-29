/**
 * Finalize agentsam chat agent_run + spend alerts after a turn.
 */

import { finalizeAgentRun } from '../../../telemetry/agent-run.js';
import { reportAgentControllerWarning } from './agent-controller-report.js';

/**
 * @param {any} env
 * @param {any} ctx
 * @param {object} args
 */
export async function finalizeAgentControllerAccounting(env, ctx, args) {
  const {
    chatAgentRunId,
    userId,
    workspaceId,
    tenantId,
    sessionId,
    agentRunStartPromise,
    loopStats,
    clientAborted,
    profile,
    sessionAuthUser,
    quickstartBatch,
    chatT0,
    services = {},
  } = args;
  const { fetchModelCostUsd, processWorkspaceSpendAlertsAfterUsage } = services;

  try {
    // Terminal status must not depend on agentRunStartPromise being present.
    // Primary stuck-running failure mode is waitUntil-only accounting after stream
    // close (isolate drop) — callers must await this function's D1 finalize path.
    if (!chatAgentRunId || !userId || !workspaceId) return;
    const cancelled = loopStats?.cancelled === true || clientAborted;
    const timedOut = loopStats?.timedOut === true;
    const inputTokens = Math.max(0, Math.floor(Number(loopStats?.totalUsage?.input_tokens) || 0));
    const outputTokens = Math.max(
      0,
      Math.floor(Number(loopStats?.totalUsage?.output_tokens) || 0),
    );
    const cacheReadTokens = Math.max(
      0,
      Math.floor(Number(loopStats?.totalUsage?.cache_read_input_tokens) || 0),
    );
    const mk = loopStats?.modelKey || profile.model_key;
    const costUsd =
      inputTokens > 0 || outputTokens > 0
        ? typeof fetchModelCostUsd === 'function'
          ? await fetchModelCostUsd(env, mk, inputTokens, outputTokens, cacheReadTokens)
          : 0
        : 0;
    let toolOutcomeFailed = false;
    if (env?.DB && chatAgentRunId) {
      try {
        const bad = await env.DB.prepare(
          `SELECT COUNT(*) AS n FROM agentsam_tool_chain
           WHERE agent_run_id = ? AND outcome IN ('soft_fail', 'error')`,
        )
          .bind(String(chatAgentRunId))
          .first();
        toolOutcomeFailed = Number(bad?.n) > 0;
      } catch {
        toolOutcomeFailed = false;
      }
    }
    const terminalStatus = cancelled
      ? 'cancelled'
      : timedOut || loopStats == null
        ? 'failed'
        : toolOutcomeFailed
          ? 'partial'
          : 'completed';
    const finalSuccess = terminalStatus === 'completed';
    const errorMessage = cancelled
      ? 'agent_run_cancelled'
      : timedOut
        ? 'agent_run_timeout'
        : loopStats == null
          ? 'agent_spine_error'
          : toolOutcomeFailed
            ? 'tool_outcome_not_ok'
            : null;

    if (agentRunStartPromise && typeof agentRunStartPromise.then === 'function') {
      await agentRunStartPromise.catch(() => {});
    }
    // Critical path: terminal agentsam_agent_run row (status + completed_at).
    await finalizeAgentRun(env, {
      runId: chatAgentRunId,
      userId,
      tenantId,
      workspaceId,
      conversationId: sessionId ? String(sessionId) : null,
      routingArmId: profile.routing_arm_id,
      modelKey: mk,
      taskType: profile.routing_task_type,
      mode: profile.mode,
      status: terminalStatus,
      success: finalSuccess,
      cancelled,
      inputTokens,
      outputTokens,
      cachedInputTokens: cacheReadTokens,
      costUsd,
      latencyMs: Date.now() - chatT0,
      errorCode: errorMessage,
      errorMessage,
    });

    if ((inputTokens > 0 || outputTokens > 0) && sessionId && env?.DB) {
      try {
        await env.DB.prepare(
          `UPDATE agentsam_chat_sessions
           SET total_tokens_in = COALESCE(total_tokens_in, 0) + ?,
               total_tokens_out = COALESCE(total_tokens_out, 0) + ?,
               last_model_key = COALESCE(?, last_model_key),
               updated_at = unixepoch()
           WHERE conversation_id = ?`,
        )
          .bind(inputTokens, outputTokens, mk || null, String(sessionId))
          .run();
      } catch (e) {
        reportAgentControllerWarning(env, 'session_token_bump', e, {
          workspaceId,
          tenantId,
          sessionId,
          sourceId: chatAgentRunId,
        });
      }
    }

    const isPlatformOperator =
      sessionAuthUser?.role === 'superadmin' ||
      sessionAuthUser?.is_superadmin === true ||
      sessionAuthUser?.is_superadmin === 1;
    if (
      typeof processWorkspaceSpendAlertsAfterUsage === 'function' &&
      (inputTokens > 0 || outputTokens > 0 || costUsd > 0)
    ) {
      const spendTask = processWorkspaceSpendAlertsAfterUsage(env, ctx, {
        tenantId,
        workspaceId,
        userId,
        sessionId: sessionId ? String(sessionId) : null,
        superadmin: isPlatformOperator,
      }).catch((e) => {
        reportAgentControllerWarning(env, 'finalize_spend_alerts', e, {
          workspaceId,
          tenantId,
          sessionId,
          sourceId: chatAgentRunId,
        });
      });
      // Keep this function's awaitable surface = D1 terminal write only.
      if (ctx?.waitUntil) ctx.waitUntil(spendTask);
      else await spendTask;
    }
  } catch (e) {
    reportAgentControllerWarning(env, 'finalize_accounting', e, {
      workspaceId,
      tenantId,
      sessionId,
      sourceId: chatAgentRunId,
    });
  }
}
