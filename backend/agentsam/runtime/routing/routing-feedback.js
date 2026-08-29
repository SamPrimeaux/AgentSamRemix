/**
 * Bandit feedback writers — usage, quality, and observed-model learning.
 */
import { writeRoutingMemoryPrior } from '../../../ai/routing/training/routing-priors.js';
import { inferArmAttribution } from '../../../ai/routing/training/arm-inference.js';
import { findGlobalRoutingArm } from '../../../ai/routing/training/event-repository.js';
import { resolveCronWorkspaceId } from '../../../jobs/cron-tenant.js';
import { banditTaskType, ROUTING_ARMS_TABLE } from './routing-arms.js';

/**
 * Usage feedback → applyRewardEvent (bandit + Welford cost/latency).
 * Always ledger-writes — ETO table presence must not skip cost/latency learning.
 */
export async function applyRoutingArmUsageFeedback(env, o) {
  const db = env?.DB;
  const armId = o?.armId != null ? String(o.armId).trim() : '';
  if (!db || !armId) return;
  const success = !!o.success;
  const costUsd = Number(o.costUsd);
  const hasCost = Number.isFinite(costUsd) && costUsd >= 0;
  const durationMs = Math.max(0, Math.floor(Number(o.durationMs) || 0));

  try {
    const { applyTrainingEvent: applyRewardEvent } = await import(
      '../../../ai/routing/training/apply-events.js'
    );
    const arm = await db
      .prepare(
        `SELECT id, workspace_id, task_type, model_key, provider FROM ${ROUTING_ARMS_TABLE} WHERE id = ? LIMIT 1`,
      )
      .bind(armId)
      .first();
    if (!arm?.id) return;

    let workspaceId =
      (o?.workspaceId != null ? String(o.workspaceId).trim() : '') ||
      (arm.workspace_id != null ? String(arm.workspace_id).trim() : '');
    if (!workspaceId) {
      workspaceId = (await resolveCronWorkspaceId(env)) || '';
      if (!workspaceId) {
        console.warn('[routing] recordArmOutcome skipped — no workspace_id');
        return;
      }
    }
    const taskType = banditTaskType(
      o?.taskType != null && String(o.taskType).trim()
        ? o.taskType
        : arm.task_type,
      o?.routeKey ?? o?.chatRouteKey,
    );
    const modelKey =
      (o?.modelKey != null ? String(o.modelKey).trim() : '') ||
      (arm.model_key != null ? String(arm.model_key).trim() : '') ||
      null;

    // Workspace is not a bandit dimension — credit the global policy arm when present.
    let learnArmId = armId;
    if (String(arm.workspace_id ?? '').trim() && modelKey) {
      const twinMode = o?.mode != null ? String(o.mode).trim() : '';
      const twin = await findGlobalRoutingArm(db, {
        modelKey,
        taskType,
        mode: twinMode,
      });
      learnArmId = inferArmAttribution({
        selectedArmId: armId,
        globalArmId: twin?.id,
        modelKey,
        workspaceId,
        taskType,
      }).learnedArmId;
    }

    const tenantId = await resolveTenantIdForReward(env, {
      tenantId: o?.tenantId,
      workspaceId,
      userId: o?.userId,
    });
    if (!tenantId) {
      console.warn('[routing_arms] usage feedback skipped — no tenant_id');
      return;
    }

    const dedupBase =
      o?.agentRunId != null
        ? String(o.agentRunId).trim()
        : `${learnArmId}:${Math.floor(Date.now() / 1000)}`;
    const signalValueRaw = Number(o?.signalValue);
    const signalValue =
      Number.isFinite(signalValueRaw) && signalValueRaw > 0 ? signalValueRaw : 1;
    const dedupKey =
      o?.dedupKey != null && String(o.dedupKey).trim()
        ? String(o.dedupKey).trim().slice(0, 191)
        : `usage:${dedupBase}:${success ? 'ok' : 'err'}`;
    const reason =
      o?.reason != null && String(o.reason).trim()
        ? String(o.reason).trim().slice(0, 128)
        : 'applyRoutingArmUsageFeedback';

    await applyRewardEvent(env, {
      tenant_id: tenantId,
      workspace_id: workspaceId,
      task_type: taskType,
      route_key: o?.routeKey ?? o?.chatRouteKey ?? null,
      mode: o?.mode ?? null,
      signal_type: success ? 'auto_success' : 'auto_error',
      signal_value: signalValue,
      signal_source: 'bandit',
      routing_arm_id: learnArmId,
      model_key: modelKey,
      provider: o?.provider ?? arm.provider ?? null,
      cost_usd: hasCost ? costUsd : null,
      latency_ms: durationMs,
      apply_cost: hasCost,
      apply_latency: true,
      apply_execution: true,
      agent_run_id: o?.agentRunId ?? null,
      dedup_key: dedupKey,
      reason,
      failure_category: success ? null : o?.failure_category ?? null,
      metadata: {
        attribution: 'auto_selected_arm',
        selected_arm_id: armId,
        learned_arm_id: learnArmId,
        ...(o?.metadata && typeof o.metadata === 'object' ? o.metadata : {}),
      },
    });

    // Cost-only efficiency ledger when we have a real cost (no second bandit bump).
    if (hasCost && costUsd > 0) {
      const efficiency = 1 / (1 + costUsd);
      await applyRewardEvent(env, {
        tenant_id: tenantId,
        workspace_id: workspaceId,
        task_type: taskType,
        route_key: o?.routeKey ?? o?.chatRouteKey ?? null,
        signal_type: 'auto_cost_efficiency',
        signal_value: efficiency,
        signal_source: 'system',
        routing_arm_id: learnArmId,
        model_key: modelKey,
        provider: o?.provider ?? arm.provider ?? null,
        cost_usd: costUsd,
        apply_cost: false,
        apply_latency: false,
        apply_execution: false,
        agent_run_id: o?.agentRunId ?? null,
        dedup_key: `usage_cost_eff:${dedupBase}`,
        reason: 'auto_cost_efficiency',
        metadata: { efficiency, cost_usd: costUsd },
      }).catch((e) => console.warn('[routing_arms] cost_efficiency', e?.message ?? e));
    }

    if (workspaceId && taskType && modelKey) {
      writeRoutingMemoryPrior(env, {
        workspaceId,
        taskType,
        modelKey,
        provider: o.provider ?? null,
        success,
        latencyMs: durationMs,
        costUsd: hasCost ? costUsd : 0,
      }).catch(() => {});
    }
  } catch (e) {
    console.warn('[routing_arms] usage feedback', e?.message ?? e);
  }
}

export function scheduleRoutingArmFeedbackFromUsage(env, ctx, o) {
  if (!env?.DB || !ctx?.waitUntil) return;
  ctx.waitUntil(applyRoutingArmUsageFeedback(env, o));
}

/**
 * Execution + Thompson feedback on `agentsam_routing_arms` (fire-and-forget).
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   taskType: string,
 *   mode: string,
 *   modelKey: string,
 *   workspaceId: string,
 *   success: boolean,
 *   lastChainId?: string | null,
 * }} o
 */
export function scheduleRoutingArmBanditUpdate(env, ctx, o) {
  if (!env?.DB || !ctx?.waitUntil) return;
  const routeKey = o?.routeKey ?? o?.chatRouteKey ?? null;
  const taskType = banditTaskType(o?.taskType, routeKey);
  const mode = o?.mode != null ? String(o.mode).trim() : '';
  const modelKey = o?.modelKey != null ? String(o.modelKey).trim() : '';
  if (!taskType || !mode || !modelKey) return;

  const success = !!o.success;
  const lastChainId = o?.lastChainId != null ? String(o.lastChainId).trim() : '';

  ctx.waitUntil(
    (async () => {
      let workspaceId = o?.workspaceId != null ? String(o.workspaceId).trim() : '';
      if (!workspaceId) {
        workspaceId = (await resolveCronWorkspaceId(env)) || '';
      }
      if (!workspaceId) return;
      try {
        const { applyTrainingEvent: applyRewardEvent } = await import(
          '../../../ai/routing/training/apply-events.js'
        );
        const tenantId = await resolveTenantIdForReward(env, {
          tenantId: o?.tenantId,
          workspaceId,
        });
        if (!tenantId) {
          console.warn('[routing_arms] bandit update skipped — no tenant_id');
          return;
        }
        const out = await applyRewardEvent(env, {
          tenant_id: tenantId,
          workspace_id: workspaceId,
          task_type: taskType,
          route_key: routeKey,
          mode,
          signal_type: success ? 'auto_success' : 'auto_error',
          signal_value: 0.8,
          // Path B / unresolved arm: observed_model learning — not Auto selection.
          signal_source: 'picker',
          model_key: modelKey,
          apply_cost: false,
          apply_latency: false,
          apply_execution: true,
          dedup_key: `bandit:${workspaceId}:${taskType}:${routeKey || 'noroute'}:${mode}:${modelKey}:${lastChainId || 'nochain'}:${success ? 'ok' : 'err'}`,
          reason: 'scheduleRoutingArmBanditUpdate',
          failure_category: success ? null : o?.failure_category ?? null,
          metadata: {
            last_chain_id: lastChainId || null,
            attribution: 'observed_model',
            selection: 'requested_or_unresolved',
          },
        });
        if (out?.routing_arm_id && lastChainId) {
          await env.DB.prepare(
            `UPDATE ${ROUTING_ARMS_TABLE} SET last_chain_id = ?, updated_at = unixepoch() WHERE id = ?`,
          )
            .bind(lastChainId, out.routing_arm_id)
            .run()
            .catch(() => {});
        }
      } catch (e) {
        const msg = String(e?.message ?? e);
        // Should be rare after ensureObservedModelRoutingArm in applyRewardEvent.
        if (/routing_arm_id_unresolved/i.test(msg)) {
          try {
            const { ensureObservedModelRoutingArm } = await import('./routing-arms-ensure.js');
            const { applyRewardEvent, resolveTenantIdForReward } = await import(
              './reward-events.js'
            );
            const ensured = await ensureObservedModelRoutingArm(env, {
              modelKey,
              taskType,
              mode,
            });
            if (!ensured?.armId) {
              console.warn('[routing_arms] bandit skip — ensure arm failed', {
                modelKey,
                workspaceId,
                mode: mode || taskType || null,
              });
              return;
            }
            const tenantId = await resolveTenantIdForReward(env, {
              tenantId: o?.tenantId,
              workspaceId,
            });
            if (!tenantId) return;
            await applyRewardEvent(env, {
              tenant_id: tenantId,
              workspace_id: workspaceId,
              task_type: taskType,
              route_key: routeKey,
              mode,
              signal_type: success ? 'auto_success' : 'auto_error',
              signal_value: 0.8,
              signal_source: 'picker',
              model_key: modelKey,
              routing_arm_id: ensured.armId,
              apply_cost: false,
              apply_latency: false,
              apply_execution: true,
              dedup_key: `bandit:${workspaceId}:${taskType}:${routeKey || 'noroute'}:${mode}:${modelKey}:${lastChainId || 'nochain'}:${success ? 'ok' : 'err'}`,
              reason: 'scheduleRoutingArmBanditUpdate_ensure_retry',
              failure_category: success ? null : o?.failure_category ?? null,
              metadata: {
                last_chain_id: lastChainId || null,
                attribution: 'observed_model',
                selection: 'requested_ensure_retry',
              },
            });
          } catch (e2) {
            console.warn('[routing_arms] bandit ensure-retry failed', e2?.message ?? e2);
          }
        } else {
          console.warn('[routing_arms] bandit update failed', msg);
        }
      }
    })(),
  );
}

/**
 * Rolling mean quality score on the routing arm row (fire-and-forget).
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   taskType: string,
 *   mode: string,
 *   modelKey: string,
 *   workspaceId: string,
 *   qualityScore: number,
 * }} o
 */
export function scheduleRoutingArmQualityUpdate(env, ctx, o) {
  if (!env?.DB || !ctx?.waitUntil) return;
  const routeKey = o?.routeKey ?? o?.chatRouteKey ?? null;
  const taskType = banditTaskType(o?.taskType, routeKey);
  const mode = o?.mode != null ? String(o.mode).trim() : '';
  const modelKey = o?.modelKey != null ? String(o.modelKey).trim() : '';
  const q = Number(o?.qualityScore);
  if (!taskType || !mode || !modelKey || !Number.isFinite(q)) return;

  ctx.waitUntil(
    (async () => {
      try {
        const sql = `UPDATE ${ROUTING_ARMS_TABLE}
           SET avg_quality_score =
                 ((COALESCE(avg_quality_score, 0) * COALESCE(quality_n, 0)) + ?)
                 / (COALESCE(quality_n, 0) + 1),
               quality_n = COALESCE(quality_n, 0) + 1,
               updated_at = unixepoch()
           WHERE task_type = ? AND mode = ? AND model_key = ?
            AND COALESCE(TRIM(workspace_id), '') = ''`;
        await env.DB.prepare(sql).bind(q, taskType, mode, modelKey).run();
      } catch (e) {
        console.warn('[routing_arms] quality update failed', e?.message ?? e);
      }
    })(),
  );
}

/**
 * @deprecated Removed — probed non-existent columns (alpha/success_count).
 * Use applyRewardEvent via applyRoutingArmUsageFeedback / recordArmOutcome.
 */
export async function recordRoutingArmOutcome(_env, _outcome) {
  console.warn('[routing_arms] recordRoutingArmOutcome retired — use applyRewardEvent');
  return { ok: false, reason: 'retired_use_applyRewardEvent' };
}
