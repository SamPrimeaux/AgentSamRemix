/**
 * Main resolver: resolveModelForTask — Paths A–D, fail loud (no emergency fallback).
 * Composer turns: mode profile owns the bandit namespace (not classifier task_type).
 */

import { resolveCronWorkspaceId } from '../../../jobs/cron-tenant.js';
import { resolveArmLookupFromOpts } from './route-keys.js';
import { ResolutionError } from '../../catalog/resolve-model-error.js';
import {
  isExecutionMode,
  normalizeCanonicalTaskType,
  resolveRoutingMode,
} from './resolve-model-task-types.js';
import { loadModelRecord } from '../../catalog/model-resolution.js';
import { selectThompsonArm, queryGlobalPolicyArm } from './resolve-model-thompson.js';

function logResolved(resolved, t0, path, extra = {}) {
  console.log(
    '[resolveModel]',
    JSON.stringify({
      path,
      model: resolved.model_key,
      provider: resolved.provider,
      lane: resolved.routing_lane,
      arm: resolved.routing_arm_id,
      source: resolved.resolution_source,
      ms: Date.now() - t0,
      ...extra,
    }),
  );
}

/**
 * @param {object} env
 * @param {object} opts
 * @param {string}   [opts.mode='agent'] execution mode / mode profile (tool ceiling + bandit)
 * @param {string}   [opts.task_type] system-lane only (compaction, rag, workflows) — not composer
 * @param {string}   [opts.requested_model_key]
 * @param {string}   [opts.routing_arm_id]
 * @param {string}   [opts.workspace_id]
 * @param {string}   [opts.tenant_id]
 * @param {boolean}  [opts.require_tools=false]
 * @param {boolean}  [opts.require_vision=false]
 * @param {boolean}  [opts.require_json_mode=false]
 * @returns {Promise<import('../../catalog/model-resolution.js').ResolvedModel>}
 */
export async function resolveModelForTask(env, opts = {}) {
  const {
    requested_model_key = null,
    routing_arm_id = null,
    workspace_id = null,
    tenant_id = null,
    require_tools = false,
    require_vision = false,
    require_json_mode = false,
  } = opts;

  if (!env?.DB) throw new ResolutionError('NO_DB', 'env.DB unavailable');

  const armLookup = resolveArmLookupFromOpts(opts, {
    isExecutionMode,
    normalizeCanonicalTaskType,
    resolveRoutingMode,
  });
  const { mode_profile: modeProfile, arm_task_type: armTaskType, arm_mode: armMode } = armLookup;

  const db = env.DB;
  const t0 = Date.now();
  const cap = { require_tools, require_vision, require_json_mode };
  let source = 'unknown';

  const stamp = (resolved) => {
    if (!resolved || typeof resolved !== 'object') return resolved;
    resolved.mode_profile = modeProfile;
    resolved.arm_task_type = armTaskType;
    resolved.arm_mode = armMode;
    resolved.routing_mode = modeProfile;
    // Legacy telemetry fields — alias mode profile, not classifier intent.
    resolved.intent_task_type = modeProfile;
    resolved.thompson_task_type = armTaskType;
    resolved.route_key = modeProfile;
    return resolved;
  };

  try {
    // ── Path A: explicit arm ID ─────────────────────────────────────────────
    if (routing_arm_id) {
      source = 'arm';
      const arm = await db
        .prepare(
          `
        SELECT ra.id, ra.model_key, ra.reasoning_effort, ra.workspace_id,
               ra.is_active, ra.is_eligible, ra.is_paused, ra.budget_exhausted
        FROM agentsam_routing_arms ra
        WHERE ra.id = ?
      `,
        )
        .bind(routing_arm_id)
        .first();

      if (!arm) {
        throw new ResolutionError('ARM_NOT_ELIGIBLE', `arm "${routing_arm_id}" is not eligible`, {
          routing_arm_id,
        });
      }

      if (String(arm.workspace_id || '').trim()) {
        const { resolveRoutingArmByModelKey } = await import('./routing-arms.js');
        const mapped = await resolveRoutingArmByModelKey(env, {
          modelKey: arm.model_key,
          taskType: armTaskType,
          mode: armMode,
        });
        const globalArmId = mapped?.armId ?? mapped?.armId ?? null;
        if (!globalArmId) {
          throw new ResolutionError('ARM_NOT_ELIGIBLE', `workspace clone "${routing_arm_id}" has no global arm`, {
            routing_arm_id,
          });
        }
        arm.id = globalArmId;
      } else {
        const live =
          Number(arm.is_active) === 1 &&
          Number(arm.is_eligible) === 1 &&
          Number(arm.is_paused) === 0 &&
          Number(arm.budget_exhausted) === 0;
        if (!live) {
          throw new ResolutionError('ARM_NOT_ELIGIBLE', `arm "${routing_arm_id}" is not eligible`, {
            routing_arm_id,
          });
        }
      }

      const resolved = stamp(await loadModelRecord(db, arm.model_key, 'arm', arm.id, cap));
      const armEffort =
        arm.reasoning_effort != null && String(arm.reasoning_effort).trim() !== ''
          ? String(arm.reasoning_effort).trim()
          : null;
      resolved.reasoning_effort = armEffort ?? resolved.effort_default ?? null;
      logResolved(resolved, t0, 'A');
      return resolved;
    }

    // ── Path B: explicit model key ──────────────────────────────────────────
    if (requested_model_key) {
      source = 'requested';
      let observedArmId = null;
      try {
        const { ensureObservedModelRoutingArm } = await import('./routing-arms-ensure.js');
        const ensured = await ensureObservedModelRoutingArm(env, {
          modelKey: requested_model_key,
          taskType: armTaskType,
          mode: armMode,
        });
        if (ensured?.armId) observedArmId = ensured.armId;
      } catch (e) {
        console.warn('[resolveModel] Path B ensure arm', e?.message ?? e);
      }
      const resolved = stamp(
        await loadModelRecord(db, requested_model_key, 'requested', observedArmId, cap),
      );
      logResolved(resolved, t0, 'B');
      return resolved;
    }

    // ── Path C: Thompson ────────────────────────────────────────────────────
    source = 'thompson';
    const candidates = await selectThompsonArm(db, {
      task_type: armTaskType,
      mode: armMode,
      workspace_id,
      require_tools,
      require_vision,
    });

    if (candidates && candidates.length > 0) {
      const allowOpusAuto = opts.allow_opus_auto === true || opts.allowOpusAuto === true;
      for (const arm of candidates) {
        const armMk = String(arm.model_key || '').toLowerCase();
        if (!allowOpusAuto && /opus/.test(armMk)) {
          console.warn(
            `[resolveModel] C skip opus on auto arm=${arm.id} model=${arm.model_key}`,
          );
          continue;
        }
        try {
          const resolved = stamp(
            await loadModelRecord(db, arm.model_key, 'thompson', arm.id, cap),
          );
          const armEffort =
            arm.reasoning_effort != null && String(arm.reasoning_effort).trim() !== ''
              ? String(arm.reasoning_effort).trim()
              : null;
          resolved.reasoning_effort = armEffort ?? resolved.effort_default ?? null;
          logResolved(resolved, t0, 'C', {
            draw: arm.draw,
            candidates: candidates.length,
            mode_profile: modeProfile,
            arm_task_type: armTaskType,
            arm_mode: armMode,
          });
          return resolved;
        } catch (e) {
          if (
            e instanceof ResolutionError &&
            ['MODEL_NOT_FOUND', 'BUDGET_EXHAUSTED', 'CAPABILITY_MISMATCH'].includes(e.code)
          ) {
            console.warn(
              `[resolveModel] C skip arm=${arm.id} model=${arm.model_key}: ${e.code}`,
            );
            try {
              const { applyRewardEvent, resolveTenantIdForReward } = await import(
                './reward-events.js'
              );
              let workspaceId = String(workspace_id || arm.workspace_id || '').trim();
              if (!workspaceId) {
                workspaceId = (await resolveCronWorkspaceId(env)) || '';
              }
              if (!workspaceId) continue;
              const tenantId = await resolveTenantIdForReward(env, {
                tenantId: tenant_id,
                workspaceId,
              });
              if (tenantId) {
                const { failureCategoryFromResolutionCode } = await import(
                  '../../../../src/core/reward-failure-category.js'
                );
                await applyRewardEvent(env, {
                  tenant_id: tenantId,
                  workspace_id: workspaceId,
                  task_type: armTaskType,
                  signal_type: 'auto_error',
                  signal_value: 1,
                  routing_arm_id: arm.id,
                  model_key: arm.model_key,
                  apply_cost: false,
                  apply_latency: false,
                  apply_execution: false,
                  dedup_key: `resolve_cap:${arm.id}:${e.code}:${Math.floor(Date.now() / 60)}`,
                  reason: `resolveModel_${e.code}`,
                  failure_category: failureCategoryFromResolutionCode(e.code),
                });
              }
              await db
                .prepare(
                  'UPDATE agentsam_routing_arms SET pause_reason = ?, updated_at = unixepoch() WHERE id = ?',
                )
                .bind(`${e.code} at ${new Date().toISOString()}`, arm.id)
                .run();
            } catch (_) {
              /* non-fatal */
            }
            if (arm.fallback_model_key) {
              try {
                const fallbackResolved = stamp(
                  await loadModelRecord(
                    db,
                    arm.fallback_model_key,
                    'thompson_fallback',
                    arm.id,
                    cap,
                  ),
                );
                if (fallbackResolved) return fallbackResolved;
              } catch (_) {
                /* continue */
              }
            }
            continue;
          }
          throw e;
        }
      }
    }

    // ── Path D: DB global policy ────────────────────────────────────────────
    source = 'policy';
    const globalArm = await queryGlobalPolicyArm(db, {
      task_type: armTaskType,
      mode: armMode,
      workspace_id,
      require_tools,
    });
    if (globalArm) {
      try {
        const resolved = stamp(
          await loadModelRecord(db, globalArm.model_key, 'policy', globalArm.id, cap),
        );
        logResolved(resolved, t0, 'D');
        return resolved;
      } catch (e) {
        console.warn(
          `[resolveModel] D policy arm failed model=${globalArm.model_key}: ${e.message}`,
        );
      }
    }

    throw new ResolutionError(
      'NO_ELIGIBLE_ARM',
      `No eligible routing arm for mode_profile=${modeProfile} arm=(${armTaskType},${armMode})`,
      {
        mode_profile: modeProfile,
        arm_task_type: armTaskType,
        arm_mode: armMode,
        lookup_source: armLookup.lookup_source,
        source: 'none',
      },
    );
  } catch (e) {
    if (e instanceof ResolutionError) throw e;
    throw new ResolutionError('UNEXPECTED', e?.message ?? String(e), {
      mode_profile: modeProfile,
      arm_task_type: armTaskType,
      arm_mode: armMode,
      source,
    });
  }
}
