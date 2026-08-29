/**
 * Routing-training mutation gateway.
 *
 * During the cutover, the existing single-writer implementation is delegated
 * to. New producers should enter through this module so the legacy gateway can
 * be retired without another repository-wide import migration.
 */

import {
  applyRewardEvent as applyLegacyRewardEvent,
  resolveRewardArmId,
  resolveTenantIdForReward,
} from '../../../../src/core/reward-events.js';

export { resolveRewardArmId, resolveTenantIdForReward };

/**
 * Apply one canonical training event through the current single writer.
 *
 * @param {unknown} env
 * @param {Record<string, unknown>} event
 */
export async function applyTrainingEvent(env, event = {}) {
  return applyLegacyRewardEvent(env, {
    ...event,
    tenant_id: event.tenant_id ?? event.tenantId,
    workspace_id: event.workspace_id ?? event.workspaceId,
    task_type: event.task_type ?? event.taskType,
    route_key: event.route_key ?? event.routeKey,
    signal_type: event.signal_type ?? event.signalType,
    signal_value: event.signal_value ?? event.signalValue,
    routing_arm_id: event.routing_arm_id ?? event.routingArmId,
    model_key: event.model_key ?? event.modelKey,
    signal_source: event.signal_source ?? event.signalSource,
    cost_usd: event.cost_usd ?? event.costUsd,
    latency_ms: event.latency_ms ?? event.latencyMs,
    agent_run_id: event.agent_run_id ?? event.agentRunId,
    dedup_key: event.dedup_key ?? event.dedupKey,
  });
}
