/**
 * CMS M3 heavy-work spawn bridge — agentsam_spawn_job + agentsam_spawn_session.
 *
 * Thresholds (documented):
 * - CMS_SPAWN_SECTION_THRESHOLD = 8 — multi-section draft promote / import mapping
 * - CMS_SPAWN_PAYLOAD_BYTES = 32768 — draft JSON or import payload size
 * - CMS_SPAWN_SESSION_TURN_THRESHOLD = 3 — multi-turn CMS editor → spawn_session handoff
 */

import { initiateHandoff } from './agent-handoff.js';
import { createSpawnJob } from '../../backend/agentsam/runtime/spawn/d1.js';

export {
  CMS_SPAWN_SECTION_THRESHOLD,
  CMS_SPAWN_PAYLOAD_BYTES,
  CMS_SPAWN_SESSION_TURN_THRESHOLD,
  cmsDraftPayloadBytes,
  cmsDraftSectionCount,
  cmsExceedsSpawnThreshold,
  cmsShouldHandoffSession,
} from './agentsam/cms/agents/spawn-policy.js';

import {
  CMS_SPAWN_SECTION_THRESHOLD,
  cmsExceedsSpawnThreshold,
  cmsShouldHandoffSession,
} from './agentsam/cms/agents/spawn-policy.js';
import { resolveCmsHandoffModelKey } from './cms-ai-runtime.js';

/**
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   userId: string,
 *   workspaceId: string,
 *   tenantId: string|null,
 *   masterRunId: string,
 *   taskDescription: string,
 *   chunkCount: number,
 * }} opts
 */
export async function maybeSpawnCmsHeavyJob(env, ctx, opts) {
  const threshold = cmsExceedsSpawnThreshold({
    sectionCount: opts.chunkCount,
    payloadBytes: 0,
  });
  if (!threshold.spawn || !env?.DB) return { spawned: false, spawn_job_id: null, reason: threshold.reason };

  const res = await createSpawnJob(env, ctx, {
    masterRunId: opts.masterRunId,
    masterAgentSlug: 'cms_edit',
    userId: opts.userId,
    workspaceId: opts.workspaceId,
    tenantId: opts.tenantId,
    taskDescription: opts.taskDescription,
    chunkCount: Math.max(1, opts.chunkCount),
    orchestratorSlug: 'cms_edit',
    mergeStrategy: 'concat',
    mode: 'agent',
  });
  return {
    spawned: !!res.ok,
    spawn_job_id: res.spawnJobId || null,
    reason: threshold.reason,
    threshold: CMS_SPAWN_SECTION_THRESHOLD,
  };
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   userId: string,
 *   workspaceId: string,
 *   tenantId: string|null,
 *   parentRunId: string,
 *   parentSessionId: string,
 *   turnCount: number,
 *   goal: string,
 *   messages?: unknown[],
 * }} opts
 */
export async function maybeSpawnCmsSessionHandoff(env, ctx, opts) {
  const handoffPolicy = cmsShouldHandoffSession(opts.turnCount);
  if (!handoffPolicy.spawn || !env?.DB) return { spawned: false, spawn_session_id: null, reason: handoffPolicy.reason };
  try {
    const fallbackModelKey = await resolveCmsHandoffModelKey(env, { workspaceId: opts.workspaceId, tenantId: opts.tenantId });
    const handoff = await initiateHandoff(env, {
      userId: opts.userId,
      workspaceId: opts.workspaceId,
      tenantId: opts.tenantId,
      parentRunId: opts.parentRunId,
      parentSessionId: opts.parentSessionId,
      parentSlug: 'cms_edit',
      fallbackModelKey,
      goal: opts.goal,
      messages: opts.messages || [],
      reason: 'budget',
      urgency: 'medium',
      depth: 1,
      triggeredBy: 'cms_edit',
    });
    return {
      spawned: true,
      spawn_session_id: handoff.spawnId || null,
      child_session_id: handoff.childSessionId || null,
    };
  } catch (e) {
    console.warn('[cms-spawn-bridge] spawn_session', e?.message ?? e);
    return { spawned: false, spawn_session_id: null, error: String(e?.message || e) };
  }
}
