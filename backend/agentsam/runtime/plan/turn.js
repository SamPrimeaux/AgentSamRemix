/**
 * Plan-mode runtime boundary.
 *
 * A planning turn is one unit of Agent Sam compute. The intake batch owns any
 * human pause between turns; agentsam_agent_run owns this runtime envelope.
 * Planning code should use this boundary instead of importing telemetry
 * primitives directly.
 */

import {
  createAgentRunId,
  finalizeAgentRun,
  startAgentRun,
} from '../../../telemetry/agent-run.js';

function trim(value) {
  return value == null ? '' : String(value).trim();
}

/**
 * Resolve the auth-derived request scope. This deliberately does not inspect
 * request bodies or invent tenant/workspace identities.
 *
 * @param {Record<string, unknown>} input
 * @returns {{ userId: string, tenantId: string, workspaceId: string, conversationId: string|null }}
 */
export function resolvePlanningScope(input = {}) {
  const source =
    input.scope && typeof input.scope === 'object'
      ? input.scope
      : input.session && typeof input.session === 'object'
        ? input.session
        : input;
  const userId = trim(source.userId ?? source.user_id);
  const tenantId = trim(source.tenantId ?? source.tenant_id);
  const workspaceId = trim(source.workspaceId ?? source.workspace_id);
  const conversationId =
    trim(source.conversationId ?? source.conversation_id ?? source.sessionId ?? source.session_id) || null;

  if (!userId || !tenantId || !workspaceId) {
    throw new Error('planning_scope_required');
  }

  return { userId, tenantId, workspaceId, conversationId };
}

/**
 * Start one plan-mode runtime turn.
 *
 * @param {any} env
 * @param {Record<string, unknown>} scope Auth-derived request scope
 * @param {Record<string, unknown>} [opts]
 */
export async function startPlanningRun(env, scope, opts = {}) {
  const resolved = resolvePlanningScope(scope);
  const runId = trim(opts.runId) || createAgentRunId({ label: 'plan' });
  const started = await startAgentRun(env, {
    runId,
    ...resolved,
    mode: 'plan',
    modelKey: opts.modelKey ?? opts.model_key ?? null,
    routingArmId: opts.routingArmId ?? opts.routing_arm_id ?? null,
    selectedBy: opts.selectedBy ?? opts.selected_by ?? opts.routingStrategy ?? null,
  });

  if (!started?.ok) {
    throw new Error(`planning_run_start_failed:${started?.reason || 'unknown'}`);
  }

  return {
    runId,
    scope: resolved,
    startedAtMs: Date.now(),
  };
}

/**
 * Complete one plan-mode runtime turn.
 *
 * @param {any} env
 * @param {{ runId: string, scope: ReturnType<typeof resolvePlanningScope>, startedAtMs: number }} execution
 * @param {Record<string, unknown>} [outcome]
 */
export async function completePlanningRun(env, execution, outcome = {}) {
  const scope = resolvePlanningScope(execution?.scope);
  const status = trim(outcome.status) || 'completed';
  const finalized = await finalizeAgentRun(env, {
    runId: execution.runId,
    ...scope,
    mode: 'plan',
    status,
    success: outcome.success !== false && status !== 'failed',
    cancelled: outcome.cancelled === true,
    errorCode: outcome.errorCode ?? outcome.error_code ?? null,
    errorMessage: outcome.errorMessage ?? outcome.error_message ?? null,
    inputTokens: outcome.inputTokens ?? outcome.input_tokens ?? 0,
    outputTokens: outcome.outputTokens ?? outcome.output_tokens ?? 0,
    cachedInputTokens: outcome.cachedInputTokens ?? outcome.cached_input_tokens ?? 0,
    reasoningTokens: outcome.reasoningTokens ?? outcome.reasoning_tokens ?? 0,
    costUsd: outcome.costUsd ?? outcome.cost_usd ?? 0,
    latencyMs: Math.max(0, Date.now() - Number(execution.startedAtMs || Date.now())),
    modelKey: outcome.modelKey ?? outcome.model_key ?? null,
    routingArmId: outcome.routingArmId ?? outcome.routing_arm_id ?? null,
  });

  if (!finalized?.ok) {
    throw new Error(`planning_run_finalize_failed:${finalized?.reason || 'unknown'}`);
  }
  return finalized;
}

/**
 * Adapt the boundary to a stream that is owned by another composition layer.
 * The stream must call exactly one of these callbacks before it closes.
 *
 * @param {any} env
 * @param {any} execution
 * @param {AbortSignal|null} [signal]
 */
export function planningRunLifecycle(env, execution, signal = null) {
  let terminalized = false;
  const terminalize = async (outcome) => {
    if (terminalized) return;
    const aborted = signal?.aborted === true;
    await completePlanningRun(env, execution, aborted
      ? {
          ...outcome,
          status: 'cancelled',
          success: false,
          cancelled: true,
          errorCode: 'plan_run_cancelled',
        }
      : outcome);
    terminalized = true;
  };
  return {
    execution,
    complete: (outcome = {}) => terminalize(outcome),
    fail: (error) =>
      terminalize({
        status: signal?.aborted === true || error?.name === 'AbortError' ? 'cancelled' : 'failed',
        success: false,
        cancelled: signal?.aborted === true || error?.name === 'AbortError',
        errorCode:
          signal?.aborted === true || error?.name === 'AbortError'
            ? 'plan_run_cancelled'
            : 'plan_run_failed',
        errorMessage: error?.message ?? String(error),
      }),
  };
}

/**
 * Run planning compute with a terminal runtime envelope.
 *
 * Returning from operation — including a question-card pause — completes the
 * current turn. A later question submission starts a new planning turn.
 *
 * @param {any} env
 * @param {Record<string, unknown>} scope Auth-derived request scope
 * @param {(execution: any) => Promise<any>} operation
 * @param {Record<string, unknown>} [opts]
 */
export async function withPlanningRun(env, scope, operation, opts = {}) {
  const execution = await startPlanningRun(env, scope, opts);
  if (typeof opts.onStarted === 'function') {
    await opts.onStarted(execution);
  }

  try {
    const result = await operation(execution);
    const outcome =
      result?.planningRun && typeof result.planningRun === 'object' ? result.planningRun : {};
    await completePlanningRun(env, execution, outcome);
    return result;
  } catch (error) {
    const cancelled =
      error?.name === 'AbortError' ||
      opts.signal?.aborted === true ||
      error?.code === 'ABORT_ERR';
    await completePlanningRun(env, execution, {
      status: cancelled ? 'cancelled' : 'failed',
      success: false,
      cancelled,
      errorCode: cancelled ? 'plan_run_cancelled' : 'plan_run_failed',
      errorMessage: error?.message ?? String(error),
    }).catch((finalizeError) => {
      console.warn('[planning-run] finalize_failed', finalizeError?.message ?? finalizeError);
    });
    throw error;
  }
}
