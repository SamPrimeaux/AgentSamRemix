/**
 * Multitask lane spawn + status (Cursor Task-style fanout).
 * Ledger: agentsam_spawn_job + parent/child agentsam_agent_run.
 * Async accept — child loops run via ctx.waitUntil when fanout execution is enabled.
 */

import { loadAgentSamUserPolicy } from '../../../identity/index.js';
import {
  createMultitaskParentRun,
  createSpawnJob,
  createChildRun,
  ensureSubagentProfilesAvailable,
  markAgentRunStarted,
  markAgentRunComplete,
  bumpSpawnJobAfterChild,
  finalizeSpawnJob,
  reconcileSpawnJobFromChildren,
} from './d1.js';
import {
  estimateAgentRunCostUsd,
  normalizeCostCapUsd,
  resolveSpawnBudgetStandards,
} from './budget.js';
import {
  getSpawnJobRow,
  parseSkillMergedOutput,
  setSpawnJobMergedOutput,
  setSpawnJobStatus,
} from './status.js';
import { ensureChatSessionRow } from '../../sessions/index.js';
import { stopAllTimersForSpawnJob } from './active-timers.js';
import {
  resolveSubagentProfileForChat,
  applySubagentToolPolicy,
  appendSubagentProfileToSystemPrompt,
} from './profile.js';
import { resolveRuntimeProfile, toolsManifestFromCompiledRows } from './runtime-profile.js';
import { isAgentRunAbortError } from './abort.js';
import { createApprovalRequest } from './approval.js';
import { fireAgentHooks } from './hooks.js';
import { sendWebPushToUser } from './web-push.js';

/** Soft warn band: offer extension once, then halt for in-app approve/deny (no Worker poll). */
const SPAWN_COST_EXTENSION_WARN_RATIO = 0.8;
const SPAWN_LANE_EXTENSION_TOOL = 'spawn_lane_extension';

async function isMultitaskRunCancelled(env, runId) {
  if (!env?.DB || !trim(runId)) return false;
  const row = await env.DB.prepare(
    `SELECT status FROM agentsam_agent_run WHERE id = ? LIMIT 1`,
  ).bind(trim(runId)).first().catch(() => null);
  return trim(row?.status).toLowerCase() === 'cancelled';
}

function modelFacingToolNames(tools) {
  return (Array.isArray(tools) ? tools : [])
    .map((t) => String(t?.name || t?.tool_name || '').trim())
    .filter(Boolean);
}

/** Flatten model/stream text parts — never String(object) → "[object Object]". */
function coercePlainText(value, depth = 0) {
  if (value == null || depth > 6) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map((v) => coercePlainText(v, depth + 1)).filter(Boolean).join('');
  }
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.content === 'string') return value.content;
    if (Array.isArray(value.content)) return coercePlainText(value.content, depth + 1);
    if (typeof value.summary === 'string') return value.summary;
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return '';
}

const MAX_LANES = 6;

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function normalizeLanes(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const title = trim(item.title) || `Lane ${out.length + 1}`;
    const brief = trim(item.brief || item.task || item.prompt || item.description);
    if (!brief) continue;
    // No JS preset slug — caller must pass role_slug (honored exactly).
    const roleSlug = trim(item.role_slug || item.role || item.slug) || null;
    const modelKey = trim(item.model_key || item.modelKey || item.model) || null;
    const mustNot = Array.isArray(item.must_not)
      ? item.must_not.map((x) => trim(x)).filter(Boolean)
      : [];
    const qc = Array.isArray(item.qc) ? item.qc.map((x) => trim(x)).filter(Boolean) : [];
    out.push({ title, brief, role_slug: roleSlug, model_key: modelKey, must_not: mustNot, qc });
    if (out.length >= MAX_LANES) break;
  }
  return out;
}

/**
 * Resolve a lane profile by exact slug. Never swaps to a different preset profile.
 * @param {any} env
 * @param {{ userId: string, workspaceId: string, tenantId?: string|null, roleSlug: string }} opts
 */
export async function resolveLaneProfile(env, opts) {
  const userId = trim(opts.userId);
  const workspaceId = trim(opts.workspaceId);
  const tenantId = opts.tenantId != null ? trim(opts.tenantId) : '';
  const roleSlug = trim(opts.roleSlug);
  if (!env?.DB || !userId || !roleSlug) return null;

  const row = await resolveSubagentProfileForChat(env.DB, {
    userId,
    workspaceId,
    tenantId,
    slug: roleSlug,
  });
  if (row && trim(row.slug) === roleSlug) return row;

  const ensured = await ensureSubagentProfilesAvailable(env, { userId, workspaceId, tenantId });
  const list = ensured.profiles || [];
  const hit = list.find((p) => trim(p.slug) === roleSlug);
  return hit || null;
}

/**
 * Accept multitask spawn — creates parent run, spawn_job, child runs; optionally kicks async fanout.
 *
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   userId: string,
 *   workspaceId: string,
 *   tenantId?: string|null,
 *   conversationId?: string|null,
 *   sessionId?: string|null,
 *   lanes: unknown,
 *   merge?: string|null,
 *   parentRunId?: string|null,
 *   costCapUsd?: number|null,
 *   laneCostCapUsd?: number|null,
 *   execLane?: string|null,
 * }} input
 */
export async function acceptMultitaskSpawn(env, ctx, input) {
  const userId = trim(input.userId);
  const workspaceId = trim(input.workspaceId);
  const tenantId = input.tenantId != null ? trim(input.tenantId) : '';
  if (!env?.DB) return { ok: false, error: 'db_not_configured' };
  if (!userId || !workspaceId) return { ok: false, error: 'user_id_and_workspace_id_required' };
  if (!tenantId) return { ok: false, error: 'tenant_id_required' };

  const budget = await resolveSpawnBudgetStandards(env, {
    userId,
    workspaceId,
    masterAgentSlug: 'agent-sam',
    costCapUsd: input.costCapUsd ?? input.cost_cap_usd,
    laneCostCapUsd: input.laneCostCapUsd ?? input.lane_cost_cap_usd,
    timeoutSeconds: input.timeoutSeconds ?? input.timeout_seconds,
    laneTimeoutSeconds: input.laneTimeoutSeconds ?? input.lane_timeout_seconds,
  });
  if (!budget.ok) {
    return {
      ok: false,
      error: budget.error || 'budget_standards_required',
      hint: budget.hint || null,
    };
  }
  const jobCostCapUsd = budget.jobCostCapUsd;
  const laneCostCapUsd = budget.laneCostCapUsd;
  const jobTimeoutSeconds = budget.jobTimeoutSeconds;
  const laneTimeoutSeconds = budget.laneTimeoutSeconds;

  const lanes = normalizeLanes(input.lanes);
  if (!lanes.length) {
    return {
      ok: false,
      error: 'lanes_required',
      hint: 'Provide lanes: [{ title, brief, role_slug, model_key? }] — role_slug is required (no preset).',
    };
  }

  const policy = budget.policy || (await loadAgentSamUserPolicy(env, userId, workspaceId));
  if (Number(policy.allow_subagent_spawn ?? 0) !== 1) {
    return {
      ok: false,
      error: 'subagent_spawn_disabled',
      hint: 'Enable agentsam_user_policy.allow_subagent_spawn=1 for this user/workspace.',
    };
  }

  // D1 CHECK: merge_strategy IN ('concat','json_merge','vote','first_success','custom')
  const mergeRaw = trim(input.merge || input.merge_strategy) || 'concat';
  const mergeAlias = {
    concat_summaries: 'concat',
    summarize: 'concat',
    summary: 'concat',
    merge: 'json_merge',
  };
  const mergeStrategy = mergeAlias[mergeRaw.toLowerCase()] || mergeRaw;
  const allowedMerge = new Set(['concat', 'json_merge', 'vote', 'first_success', 'custom']);
  if (!allowedMerge.has(mergeStrategy)) {
    return {
      ok: false,
      error: 'invalid_merge_strategy',
      hint: 'Use concat|json_merge|vote|first_success|custom (concat_summaries aliases to concat).',
    };
  }
  let conversationId = input.conversationId != null ? trim(input.conversationId) || null : null;
  const sessionId = input.sessionId != null ? trim(input.sessionId) || null : null;

  // Root chat session required for spawn_session + wall-clock conversation FK (in-app and MCP).
  if (!conversationId) {
    conversationId = crypto.randomUUID();
  }
  try {
    await ensureChatSessionRow(env, {
      conversationId,
      tenantId,
      userId,
      workspaceId,
      title: 'Multitask fanout',
    });
  } catch (e) {
    return {
      ok: false,
      error: 'fanout_conversation_failed',
      detail: e?.message ?? String(e),
    };
  }

  // Resolve roles BEFORE creating ledger rows — fail loud, no orphan spawn_job.
  const resolvedLanes = [];
  for (let i = 0; i < lanes.length; i++) {
    const lane = lanes[i];
    const requestedSlug = trim(lane.role_slug);
    if (!requestedSlug) {
      return {
        ok: false,
        error: 'role_slug_required',
        lane_index: i,
        hint: 'Each lane must set role_slug to an active agentsam_subagent_profile.slug — no default/preset.',
      };
    }
    const profile = await resolveLaneProfile(env, {
      userId,
      workspaceId,
      tenantId,
      roleSlug: requestedSlug,
    });
    if (!profile || trim(profile.slug) !== requestedSlug) {
      return {
        ok: false,
        error: 'role_slug_not_found',
        role_slug: requestedSlug,
        lane_index: i,
        hint: `No active agentsam_subagent_profile.slug='${requestedSlug}' for this user/workspace. Pass the slug you chose — it will not be remapped.`,
      };
    }
    resolvedLanes.push({ ...lane, role_slug: requestedSlug, profile });
  }

  let parentRunId = trim(input.parentRunId) || null;
  if (!parentRunId) {
    const parent = await createMultitaskParentRun(env, ctx, {
      userId,
      workspaceId,
      tenantId,
      conversationId,
      sessionId,
      mode: 'multitask',
      trigger: 'agentsam_multitask_spawn',
    });
    if (!parent.ok || !parent.runId) {
      return { ok: false, error: 'parent_run_failed', detail: parent.reason || null };
    }
    parentRunId = parent.runId;
  } else {
    // Stamp parent conversation when caller supplied an existing parent run.
    try {
      await env.DB.prepare(
        `UPDATE agentsam_agent_run
            SET conversation_id = COALESCE(conversation_id, ?)
          WHERE id = ?`,
      )
        .bind(conversationId, parentRunId)
        .run();
    } catch {
      /* best-effort */
    }
  }

  const taskDescription = resolvedLanes.map((l, i) => `[${i + 1}] ${l.title}: ${l.brief}`).join('\n').slice(0, 4000);

  const spawnJob = await createSpawnJob(env, ctx, {
    masterRunId: parentRunId,
    masterAgentSlug: 'agent-sam',
    userId,
    workspaceId,
    tenantId,
    taskDescription,
    chunkCount: resolvedLanes.length,
    // Job-level label only — per-lane roles are stored in merged_output.lanes.
    orchestratorSlug: 'multitask',
    mergeStrategy,
    mode: 'multitask',
    conversationId,
    costCapUsd: jobCostCapUsd,
    timeoutSeconds: jobTimeoutSeconds,
  });
  if (!spawnJob.ok || !spawnJob.spawnJobId) {
    return { ok: false, error: 'spawn_job_failed', detail: spawnJob.reason || null, parent_run_id: parentRunId };
  }

  const childRunIds = [];
  const laneRows = [];
  for (let i = 0; i < resolvedLanes.length; i++) {
    const lane = resolvedLanes[i];
    const slug = lane.role_slug;
    const profile = lane.profile;
    const modelKey = trim(lane.model_key) || null;
    const child = await createChildRun(env, ctx, {
      parentRunId,
      userId,
      workspaceId,
      tenantId,
      conversationId,
      sessionId,
      subagentSlug: slug,
      spawnJobId: spawnJob.spawnJobId,
      mode: 'multitask',
      costCapUsd: laneCostCapUsd,
      timeoutSeconds: laneTimeoutSeconds,
      modelKey,
    });
    if (!child.ok || !child.runId) {
      try {
        await stopAllTimersForSpawnJob(env, spawnJob.spawnJobId, 'cancelled');
      } catch {
        /* best-effort */
      }
      return {
        ok: false,
        error: 'child_run_or_timer_failed',
        detail: child.reason || null,
        parent_run_id: parentRunId,
        spawn_job_id: spawnJob.spawnJobId,
      };
    }
    const runId = child.runId;
    childRunIds.push(runId);
    laneRows.push({
      index: i,
      title: lane.title,
      brief: lane.brief,
      role_slug: slug,
      role_slug_requested: slug,
      model_key: modelKey,
      must_not: lane.must_not,
      qc: lane.qc,
      run_id: runId,
      conversation_id: child.conversationId || null,
      spawn_session_id: child.spawnSessionId || null,
      profile_id: profile?.id != null ? String(profile.id) : null,
      create_ok: child.ok === true,
      create_error: child.ok ? null : child.reason || 'create_failed',
    });
  }

  const mergedState = {
    source: 'agentsam_multitask_spawn',
    merge: mergeStrategy,
    exec_lane: trim(input.execLane ?? input.exec_lane) || null,
    lanes: laneRows,
    summaries: [],
    cost_cap_usd: jobCostCapUsd,
    lane_cost_cap_usd: laneCostCapUsd,
    timeout_seconds: jobTimeoutSeconds,
  };
  await setSpawnJobMergedOutput(env, spawnJob.spawnJobId, mergedState);

  const executionEnabled = Number(policy.allow_fanout_execution ?? 0) === 1;
  let executionStarted = false;
  if (executionEnabled && childRunIds.length && typeof ctx?.waitUntil === 'function') {
    executionStarted = true;
    ctx.waitUntil(
      executeMultitaskLanesAsync(env, ctx, {
        userId,
        workspaceId,
        tenantId,
        conversationId,
        sessionId,
        parentRunId,
        spawnJobId: spawnJob.spawnJobId,
        lanes: laneRows,
        exec_lane: trim(input.execLane ?? input.exec_lane) || null,
      }).catch((e) => {
        console.warn('[multitask-spawn] async fanout failed', e?.message ?? e);
      }),
    );
  }

  return {
    ok: true,
    spawn_job_id: spawnJob.spawnJobId,
    fanout_id: spawnJob.spawnJobId,
    parent_run_id: parentRunId,
    conversation_id: conversationId,
    child_run_ids: childRunIds,
    lane_count: laneRows.length,
    cost_cap_usd: jobCostCapUsd,
    lane_cost_cap_usd: laneCostCapUsd,
    timeout_seconds: jobTimeoutSeconds,
    execution_started: executionStarted,
    execution_enabled: executionEnabled,
    hint: executionEnabled
      ? `Children running async — poll agentsam_multitask_status. Job cost hard-cap $${jobCostCapUsd} (lane $${laneCostCapUsd}), timeout ${jobTimeoutSeconds}s.`
      : 'Ledger created but fanout not executed — enable allow_fanout_execution=1 to run child agents.',
  };
}

/**
 * Hard stop when spawn_job.total_cost_usd >= cost_cap_usd.
 * Caps are on the job/run ledger — not agentsam_subagent_profile.
 *
 * @param {any} env
 * @param {{ userId: string, workspaceId: string, spawnJobId: string }} input
 */
export async function enforceSpawnJobCostCap(env, input) {
  const spawnJobId = trim(input.spawnJobId);
  if (!env?.DB || !spawnJobId) return { ok: false, over: false, error: 'missing' };
  await reconcileSpawnJobFromChildren(env, spawnJobId).catch(() => null);
  const job = await getSpawnJobRow(env, spawnJobId);
  if (!job?.id) return { ok: false, over: false, error: 'spawn_job_not_found' };

  const cap = normalizeCostCapUsd(job.cost_cap_usd);
  if (cap == null) {
    return { ok: false, over: false, error: 'job_cost_cap_missing', total_cost_usd: Number(job.total_cost_usd) || 0 };
  }

  const total = Number(job.total_cost_usd) || 0;
  if (!(total >= cap)) {
    return { ok: true, over: false, total_cost_usd: total, cost_cap_usd: cap };
  }

  const st = trim(job.status).toLowerCase();
  if (['completed', 'partial', 'failed'].includes(st) && String(job.error_message || '').includes('cost_cap')) {
    return { ok: true, over: true, already: true, total_cost_usd: total, cost_cap_usd: cap };
  }

  await cancelMultitaskFanout(env, {
    userId: trim(input.userId),
    workspaceId: trim(input.workspaceId),
    spawnJobId,
    reason: `cost_cap_exceeded:${total.toFixed(4)}>=${cap}`,
  });
  return { ok: true, over: true, total_cost_usd: total, cost_cap_usd: cap };
}

/**
 * Soft warn at ≥80% of cost_cap_usd (still under 100%): create approval + notify + halt fanout.
 * No Worker poll — same class as chat tool approvals (persist halt, exit immediately).
 * Approve (PATCH) → bump cost_cap_usd + resume remaining queued lanes.
 * Deny → do not extend; resume under existing cap (100% hard-cap still owns kill).
 * Fanout-only — never call from getMultitaskStatus / HTTP poll paths.
 *
 * Halt persistence:
 * - agentsam_spawn_job.status = 'awaiting_approval'
 * - merged_output.budget_extension_halted = true (+ proposal_id, pct, totals)
 * Remaining child runs stay status='queued' (not cancelled) for resume.
 *
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   userId: string,
 *   workspaceId: string,
 *   tenantId?: string,
 *   sessionId?: string,
 *   conversationId?: string,
 *   parentRunId?: string,
 *   spawnJobId: string,
 * }} input
 */
export async function maybeOfferSpawnCostExtension(env, ctx, input) {
  const spawnJobId = trim(input.spawnJobId);
  const workspaceId = trim(input.workspaceId);
  const userId = trim(input.userId);
  if (!env?.DB || !spawnJobId || !workspaceId || !userId) {
    return { ok: false, offered: false, halted: false, error: 'missing' };
  }

  await reconcileSpawnJobFromChildren(env, spawnJobId).catch(() => null);
  const job = await getSpawnJobRow(env, spawnJobId);
  if (!job?.id) return { ok: false, offered: false, halted: false, error: 'spawn_job_not_found' };

  const cap = normalizeCostCapUsd(job.cost_cap_usd);
  if (cap == null) {
    return { ok: false, offered: false, halted: false, error: 'job_cost_cap_missing' };
  }
  const total = Number(job.total_cost_usd) || 0;
  const warnFloor = cap * SPAWN_COST_EXTENSION_WARN_RATIO;
  // Soft band only — hard cancel stays in enforceSpawnJobCostCap at 100%.
  if (!(total >= warnFloor && total < cap)) {
    return {
      ok: true,
      offered: false,
      halted: false,
      skipped: 'outside_warn_band',
      total_cost_usd: total,
      cost_cap_usd: cap,
    };
  }

  const merged = parseSkillMergedOutput(job.merged_output, {});
  if (merged.budget_extension_offered === true || merged.budget_extension_halted === true) {
    return {
      ok: true,
      offered: false,
      halted: merged.budget_extension_halted === true || trim(job.status).toLowerCase() === 'awaiting_approval',
      skipped: 'already_offered',
      total_cost_usd: total,
      cost_cap_usd: cap,
    };
  }

  // Dedupe first so concurrent lane completions cannot double-offer.
  const offeredAt = Math.floor(Date.now() / 1000);
  const pct = Math.round((total / cap) * 100);
  merged.budget_extension_offered = true;
  merged.budget_extension_halted = true;
  merged.budget_extension_offered_at = offeredAt;
  merged.budget_extension_pct = pct;
  merged.budget_extension_total_usd = total;
  merged.budget_extension_cap_usd = cap;
  await setSpawnJobMergedOutput(env, spawnJobId, merged).catch(() => null);
  await setSpawnJobStatus(env, spawnJobId, 'awaiting_approval');

  const tenantId = trim(input.tenantId) || trim(job.tenant_id) || null;
  const sessionId = trim(input.sessionId) || null;
  const parentRunId = trim(input.parentRunId) || trim(job.master_run_id) || null;
  const origin = String(env.IAM_ORIGIN || 'https://inneranimalmedia.com').replace(/\/$/, '');

  const rationale =
    `Spawn lanes are at ${pct}% of the job budget ($${total.toFixed(4)} / $${cap.toFixed(4)}). ` +
    `Approve to extend the budget and resume remaining lanes; deny keeps the current cap ` +
    `(lanes resume until the 100% hard-stop, or cancel).`;

  let proposalId = null;
  try {
    proposalId = await createApprovalRequest(env, ctx, {
      toolName: SPAWN_LANE_EXTENSION_TOOL,
      riskLevel: 'low',
      rationale,
      toolArgs: {
        spawn_job_id: spawnJobId,
        total_cost_usd: total,
        cost_cap_usd: cap,
        warn_ratio: SPAWN_COST_EXTENSION_WARN_RATIO,
        action: 'extend_cost_cap',
      },
      agentRunId: parentRunId,
      workspaceId,
      tenantId,
      sessionId,
      userId,
      conversationId: trim(input.conversationId) || sessionId,
    });
  } catch (e) {
    console.warn('[multitask-spawn] spawn cost extension approval', e?.message ?? e);
    return { ok: false, offered: true, halted: true, error: e?.message ?? String(e) };
  }

  merged.budget_extension_proposal_id = proposalId || null;
  merged.budget_extension_session_id = sessionId || null;
  merged.budget_extension_proposal_expired = false;
  await setSpawnJobMergedOutput(env, spawnJobId, merged).catch(() => null);

  const approveUrl = proposalId
    ? `${origin}/dashboard/agent?proposal=${encodeURIComponent(proposalId)}`
    : `${origin}/dashboard/agent`;

  const pushBody =
    `Spawn job at ${pct}% of $${cap.toFixed(2)} cap ($${total.toFixed(4)} spent). ` +
    `Approve in-app to extend and resume, or deny to continue under the current cap.`;

  await Promise.all([
    sendWebPushToUser(env, {
      userId,
      tenantId,
      workspaceId,
      title: 'Spawn lane budget warning',
      body: pushBody,
      url: approveUrl,
      tag: `spawn-budget-${spawnJobId}`,
      entityType: 'spawn_job',
      entityId: spawnJobId,
    }).catch((e) => {
      console.warn('[multitask-spawn] spawn budget push', e?.message ?? e);
      return null;
    }),
    fireAgentHooks(env, ctx, 'spawn_lane_budget_warning', {
      user_id: userId,
      recipient_id: userId,
      workspace_id: workspaceId,
      tenant_id: tenantId,
      spawn_job_id: spawnJobId,
      parent_run_id: parentRunId,
      proposal_id: proposalId,
      total_cost_usd: total,
      cost_cap_usd: cap,
      pct,
      title: 'Spawn lane budget warning',
      body: pushBody,
      url: approveUrl,
    }).catch((e) => {
      console.warn('[multitask-spawn] spawn budget hook', e?.message ?? e);
      return null;
    }),
  ]);

  // Exit immediately — UI PATCH/approve triggers resumeSpawnAfterBudgetDecision.
  return {
    ok: true,
    offered: true,
    halted: true,
    proposal_id: proposalId,
    total_cost_usd: total,
    cost_cap_usd: cap,
  };
}

/**
 * Soft-expire spawn_lane_extension proposals only: keep agentsam_spawn_job halted
 * (awaiting_approval + queued lanes intact). Used by 20-min approval-notify halt and
 * 1h TTL sweep — never cancel the job here.
 *
 * @param {any} env
 * @param {Array<{ id?: string, tool_name?: string, input_json?: string, session_id?: string|null }>} approvalRows
 */
export async function softExpireSpawnBudgetApprovals(env, approvalRows) {
  if (!env?.DB || !Array.isArray(approvalRows) || !approvalRows.length) {
    return { marked: 0 };
  }
  let marked = 0;
  for (const row of approvalRows) {
    if (trim(row?.tool_name) !== SPAWN_LANE_EXTENSION_TOOL) continue;
    let args = {};
    try {
      const parsed = JSON.parse(String(row.input_json || '{}'));
      if (typeof parsed?.filled_template === 'string' && parsed.filled_template.trim()) {
        args = JSON.parse(parsed.filled_template);
      } else if (parsed?.filled_template && typeof parsed.filled_template === 'object') {
        args = parsed.filled_template;
      } else if (parsed?.spawn_job_id) {
        args = parsed;
      }
    } catch {
      args = {};
    }
    const spawnJobId = trim(args.spawn_job_id || args.spawnJobId);
    if (!spawnJobId) continue;
    const job = await getSpawnJobRow(env, spawnJobId);
    if (!job?.id) continue;
    const merged = parseSkillMergedOutput(job.merged_output, {});
    merged.budget_extension_halted = true;
    merged.budget_extension_proposal_expired = true;
    merged.budget_extension_proposal_expired_at = Math.floor(Date.now() / 1000);
    if (row.id) merged.budget_extension_expired_proposal_id = trim(row.id);
    if (row.session_id != null && String(row.session_id).trim()) {
      merged.budget_extension_session_id = trim(row.session_id);
    }
    await setSpawnJobMergedOutput(env, spawnJobId, merged).catch(() => null);
    const st = trim(job.status).toLowerCase();
    if (st !== 'awaiting_approval' && !['completed', 'partial', 'failed', 'cancelled'].includes(st)) {
      await setSpawnJobStatus(env, spawnJobId, 'awaiting_approval').catch(() => null);
    }
    marked += 1;
  }
  return { marked };
}

/**
 * Resume (or cancel) a soft-halted spawn job after budget decision — by spawn_job_id.
 * Extend = approved (bump cap); Keep cap = denied; Cancel job = hard cancel.
 *
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   spawnJobId: string,
 *   decision: 'approved'|'denied'|'cancel',
 *   userId?: string|null,
 *   workspaceId?: string|null,
 *   sessionId?: string|null,
 *   conversationId?: string|null,
 * }} input
 */
export async function resolveSpawnBudgetDecision(env, ctx, input) {
  const spawnJobId = trim(input.spawnJobId);
  const decision = trim(input.decision).toLowerCase();
  if (!env?.DB || !spawnJobId || !['approved', 'denied', 'cancel'].includes(decision)) {
    return { ok: false, error: 'invalid' };
  }

  if (decision === 'cancel') {
    return cancelMultitaskFanout(env, {
      userId: trim(input.userId) || '',
      workspaceId: trim(input.workspaceId) || '',
      spawnJobId,
      reason: 'budget_decision_cancelled',
    });
  }

  const job = await getSpawnJobRow(env, spawnJobId);
  if (!job?.id) return { ok: false, error: 'spawn_job_not_found' };

  const workspaceId = trim(input.workspaceId) || trim(job.workspace_id);
  const userId = trim(input.userId) || trim(job.user_id);
  if (workspaceId && trim(job.workspace_id) && trim(job.workspace_id) !== workspaceId) {
    return { ok: false, error: 'forbidden' };
  }
  if (userId && trim(job.user_id) && trim(job.user_id) !== userId) {
    return { ok: false, error: 'forbidden' };
  }

  const merged = parseSkillMergedOutput(job.merged_output, {});
  const cap = normalizeCostCapUsd(job.cost_cap_usd);
  if (cap == null) return { ok: false, error: 'job_cost_cap_missing' };
  const total = Number(job.total_cost_usd) || 0;
  let newCap = cap;

  if (decision === 'approved') {
    newCap = Math.max(cap * 1.5, total + cap * 0.5);
    try {
      await env.DB.prepare(`UPDATE agentsam_spawn_job SET cost_cap_usd = ? WHERE id = ?`)
        .bind(newCap, spawnJobId)
        .run();
    } catch (e) {
      return { ok: false, error: e?.message ?? String(e) };
    }
    merged.budget_extension_approved = true;
    merged.budget_extension_new_cap_usd = newCap;
  } else {
    merged.budget_extension_approved = false;
  }

  merged.budget_extension_halted = false;
  merged.budget_extension_proposal_expired = false;
  merged.budget_extension_resolved_at = Math.floor(Date.now() / 1000);
  merged.budget_extension_decision = decision;
  await setSpawnJobMergedOutput(env, spawnJobId, merged).catch(() => null);
  await setSpawnJobStatus(env, spawnJobId, 'running');

  const parentRunId = trim(job.master_run_id);
  const laneMeta = Array.isArray(merged.lanes) ? merged.lanes : [];
  const { results: childRows } = await env.DB.prepare(
    `SELECT r.id, r.status FROM agentsam_agent_run r
       JOIN agentsam_spawn_session s ON s.child_run_id = r.id
      WHERE s.parent_run_id = ?`,
  )
    .bind(parentRunId)
    .all()
    .catch(() => ({ results: [] }));

  const queuedIds = new Set(
    (childRows || [])
      .filter((r) => ['queued', 'pending'].includes(trim(r.status).toLowerCase()))
      .map((r) => trim(r.id)),
  );
  const remainingLanes = laneMeta.filter((l) => queuedIds.has(trim(l?.run_id)));

  const sessionId =
    trim(input.sessionId) || trim(merged.budget_extension_session_id) || null;
  const conversationId = trim(input.conversationId) || sessionId || null;
  const execLane = trim(input.execLane ?? input.exec_lane) || trim(merged.exec_lane) || null;

  let resumeStarted = false;
  if (remainingLanes.length && typeof ctx?.waitUntil === 'function') {
    resumeStarted = true;
    ctx.waitUntil(
      executeMultitaskLanesAsync(env, ctx, {
        userId,
        workspaceId,
        tenantId: trim(job.tenant_id) || null,
        conversationId,
        sessionId,
        parentRunId,
        spawnJobId,
        lanes: remainingLanes,
        exec_lane: execLane,
        resumeAfterBudget: true,
      }).catch((e) => {
        console.warn('[multitask-spawn] resume after budget decision', e?.message ?? e);
      }),
    );
  } else if (!remainingLanes.length) {
    await finalizeSpawnJob(env, ctx, {
      spawnJobId,
      mergedOutput: JSON.stringify(merged),
      subagentsSucceeded: 0,
      subagentsFailed: 0,
    }).catch(() => null);
  }

  return {
    ok: true,
    spawn_job_id: spawnJobId,
    decision,
    cost_cap_usd: newCap,
    remaining_lanes: remainingLanes.length,
    resume_started: resumeStarted,
  };
}

/**
 * After in-app Approve/Deny on spawn_lane_extension: clear halt, optionally bump cap, resume queued lanes.
 * Deny does not extend — resume under existing cap (safer product default).
 *
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   approvalId: string,
 *   decision: 'approved'|'denied',
 *   userId?: string|null,
 *   workspaceId?: string|null,
 * }} input
 */
export async function resumeSpawnAfterBudgetDecision(env, ctx, input) {
  const approvalId = trim(input.approvalId);
  const decision = trim(input.decision).toLowerCase();
  if (!env?.DB || !approvalId || !['approved', 'denied'].includes(decision)) {
    return { ok: false, error: 'invalid' };
  }

  const row = await env.DB.prepare(
    `SELECT id, tool_name, input_json, workspace_id, user_id, session_id, agent_run_id, conversation_id
       FROM agentsam_approval_queue WHERE id = ? LIMIT 1`,
  )
    .bind(approvalId)
    .first()
    .catch(() => null);
  if (!row?.id) return { ok: false, error: 'approval_not_found' };
  if (trim(row.tool_name) !== SPAWN_LANE_EXTENSION_TOOL) {
    return { ok: true, skipped: 'not_spawn_lane_extension' };
  }

  let args = {};
  try {
    const parsed = JSON.parse(String(row.input_json || '{}'));
    if (typeof parsed?.filled_template === 'string' && parsed.filled_template.trim()) {
      args = JSON.parse(parsed.filled_template);
    } else if (parsed?.filled_template && typeof parsed.filled_template === 'object') {
      args = parsed.filled_template;
    } else if (parsed?.spawn_job_id) {
      args = parsed;
    }
  } catch {
    args = {};
  }

  const spawnJobId = trim(args.spawn_job_id || args.spawnJobId);
  if (!spawnJobId) return { ok: false, error: 'spawn_job_id_missing' };

  return resolveSpawnBudgetDecision(env, ctx, {
    spawnJobId,
    decision,
    userId: trim(input.userId) || trim(row.user_id) || null,
    workspaceId: trim(input.workspaceId) || trim(row.workspace_id) || null,
    sessionId: trim(row.session_id) || null,
    conversationId: trim(row.conversation_id) || null,
  });
}

/**
 * Run child lane loops (bounded concurrency). Used from waitUntil.
 */
export async function executeMultitaskLanesAsync(env, ctx, p) {
  const lanes = Array.isArray(p.lanes) ? p.lanes.filter((l) => trim(l?.run_id)) : [];
  const concurrency = 3;
  const summaries = [];
  let okCount = 0;
  let errCount = 0;
  let cancelCount = 0;
  /** Soft budget halt — stop starting new lanes; leave remaining as queued for resume. */
  let budgetHalted = false;

  await markAgentRunStarted(env, ctx, {
    runId: p.parentRunId,
    mode: 'multitask',
  });

  const { buildSystemPrompt } = await import('./prompt.js');
  const { runAgentToolLoop } = await import('../tool-loop/index.js');
  const userPolicy = await loadAgentSamUserPolicy(env, p.userId, p.workspaceId);

  // Inherit the resolved spawning actor. Child lanes receive identity, not a synthetic
  // platform/operator privilege bit; terminal capability is resolved by the normal policy path.
  /** @type {Record<string, unknown>|null} */
  let permitterAuthUser = null;
  try {
    const { resolveGrantAuthUserRow } = await import('./authorization.js');
    permitterAuthUser = await resolveGrantAuthUserRow(env, { id: p.userId });
  } catch (e) {
    console.warn('[multitask-spawn] permitter_identity_load', e?.message ?? e);
  }

  async function fanoutCancelled() {
    if (await isMultitaskRunCancelled(env, p.parentRunId)) return true;
    const capHit = await enforceSpawnJobCostCap(env, {
      userId: p.userId,
      workspaceId: p.workspaceId,
      spawnJobId: p.spawnJobId,
    }).catch(() => null);
    if (capHit?.over) return true;
    return false;
  }

  async function fanoutStopReason() {
    if (budgetHalted) return 'halt';
    const job = await getSpawnJobRow(env, p.spawnJobId).catch(() => null);
    const st = trim(job?.status).toLowerCase();
    if (st === 'awaiting_approval') {
      budgetHalted = true;
      return 'halt';
    }
    try {
      const merged = parseSkillMergedOutput(job?.merged_output, {});
      if (merged.budget_extension_halted === true) {
        budgetHalted = true;
        return 'halt';
      }
    } catch {
      /* ignore */
    }
    if (await fanoutCancelled()) return 'cancel';
    return null;
  }

  async function runOne(lane) {
    const runId = trim(lane.run_id);
    const slug = trim(lane.role_slug);
    if (!slug) {
      throw new Error('role_slug_required');
    }
    const t0 = Date.now();
    const textChunks = [];
    try {
      if ((await fanoutCancelled()) || (await isMultitaskRunCancelled(env, runId))) {
        cancelCount += 1;
        await markAgentRunComplete(env, ctx, {
          runId,
          status: 'cancelled',
          latencyMs: Date.now() - t0,
          errorMessage: 'operator_cancelled',
          mode: 'agent',
        }).catch(() => null);
        summaries.push({ role_slug: slug, run_id: runId, status: 'cancelled', summary: '' });
        return;
      }

      const profileRow = await resolveLaneProfile(env, {
        userId: p.userId,
        workspaceId: p.workspaceId,
        tenantId: p.tenantId,
        roleSlug: slug,
        strict: true,
      });
      if (!profileRow) {
        throw new Error(`role_slug_not_found:${slug}`);
      }

      const mustNotBlock =
        Array.isArray(lane.must_not) && lane.must_not.length
          ? `\n\nMust not: ${lane.must_not.join('; ')}`
          : '';
      const qcBlock =
        Array.isArray(lane.qc) && lane.qc.length
          ? `\n\nAcceptance checks:\n${lane.qc.map((c) => `- ${c}`).join('\n')}`
          : '';
      const message = `## Lane: ${lane.title || slug}\n\n${lane.brief || ''}${mustNotBlock}${qcBlock}`;

      const laneModelKey = trim(lane.model_key) || null;
      const toolProfilePin =
        profileRow?.tool_profile_key != null && String(profileRow.tool_profile_key).trim()
          ? String(profileRow.tool_profile_key).trim()
          : null;
      const childProfile = await resolveRuntimeProfile(env, {
        mode: 'agent',
        message,
        session: {
          userId: p.userId,
          workspaceId: p.workspaceId,
          tenantId: p.tenantId,
          conversationId: trim(lane.conversation_id) || p.sessionId || p.conversationId,
        },
        overrides: {
          subagent_slug: slug,
          mode: 'agent',
          ...(toolProfilePin ? { tool_profile_key: toolProfilePin } : {}),
          ...(laneModelKey ? { model_key: laneModelKey } : {}),
        },
        compile_lane: 'live',
      });

      let tools = toolsManifestFromCompiledRows(childProfile._compiled_tool_rows || []);
      tools = await applySubagentToolPolicy(env, tools, profileRow);

      const promptRouteRow = childProfile._prompt_route_row ?? null;
      const resolvedTaskType =
        trim(childProfile.routing_task_type) || trim(childProfile.mode) || 'agent';
      let systemPrompt;
      try {
        systemPrompt = await buildSystemPrompt(
          env,
          p.tenantId,
          childProfile.mode,
          '',
          null,
          promptRouteRow,
          {
            sessionId: p.sessionId,
            message,
            taskType: resolvedTaskType,
            workspaceId: p.workspaceId,
            userId: p.userId,
          },
        );
      } catch {
        systemPrompt = `You are the ${slug} lane subagent. Complete the lane brief.`;
      }
      if (profileRow) systemPrompt = appendSubagentProfileToSystemPrompt(systemPrompt, profileRow);

      await markAgentRunStarted(env, ctx, {
        runId,
        modelKey: childProfile.model_key,
        provider: childProfile.selected_provider,
        routingArmId: childProfile.routing_arm_id,
        mode: childProfile.mode,
        taskType: resolvedTaskType,
      });

      const sink = (type, payload) => {
        if (type === 'text' && payload?.text != null) {
          const piece = coercePlainText(payload.text);
          if (piece) textChunks.push(piece);
        }
      };

      // Lane budgets: allow real GitHub/branch work. Hard cost stop stays on spawn_job.cost_cap_usd.
      const laneMaxToolCalls = Math.min(24, Math.max(12, Number(childProfile.max_tool_calls) || 16));
      const laneMaxTurns = Math.min(16, Math.max(8, Number(childProfile.max_turns) || 10));
      const laneMaxRuntimeMs = Math.min(
        900_000,
        Math.max(300_000, Number(childProfile.max_runtime_ms) || 600_000),
      );

      const loopResult = await runAgentToolLoop(env, ctx, sink, {
        messages: [{ role: 'user', content: message }],
        tools,
        systemPrompt,
        modelKey: childProfile.model_key,
        temperature: childProfile.temperature,
        maxToolCalls: laneMaxToolCalls,
        mode: childProfile.mode,
        modeConfig: {
          max_runtime_ms: laneMaxRuntimeMs,
          max_turns: laneMaxTurns,
          max_tool_calls: laneMaxToolCalls,
          temperature: childProfile.temperature,
        },
        userPolicy,
        sessionId: p.sessionId,
        tenantId: p.tenantId,
        userId: p.userId,
        workspaceId: p.workspaceId,
        authUser: permitterAuthUser,
        routingTaskType: resolvedTaskType,
        mcpRuntimeContext: {
          userId: p.userId,
          tenantId: p.tenantId,
          workspaceId: p.workspaceId,
          sessionId: p.sessionId,
          taskType: resolvedTaskType,
          routeKey: childProfile.refined_route_key || childProfile.mode,
          writePolicy: childProfile.write_policy,
          userMessage: message,
          runtimeProfile: childProfile,
          authUser: permitterAuthUser,
          personUuid:
            permitterAuthUser?.person_uuid != null
              ? String(permitterAuthUser.person_uuid)
              : null,
          // Accepting multitask spawn is the human approval — skip per-tool email gates.
          spawn_preapproved: true,
          spawnPreapproved: true,
          exec_lane: (() => {
            const raw = String(p.exec_lane || p.execLane || '')
              .trim()
              .toLowerCase();
            if (raw === 'local' || raw === 'remote' || raw === 'sandbox') return raw;
            throw new Error('exec_lane_required');
          })(),
        },
        routingArmId: childProfile.routing_arm_id,
        agentSlug: profileRow?.id ?? slug,
        dispatchSpine: {
          agent_run_id: runId,
          routing_arm_id: childProfile.routing_arm_id,
          mode: childProfile.mode,
        },
        chatAgentRunId: runId,
        maxRuntimeMs: laneMaxRuntimeMs,
      });

      const summary = coercePlainText(loopResult?.finalText || textChunks.join('') || '').slice(0, 4000);
      const cancelled =
        loopResult?.cancelled === true ||
        String(loopResult?.code || '') === 'agent_run_cancelled' ||
        (await isMultitaskRunCancelled(env, runId));
      const failed = !cancelled && (loopResult?.ok === false || Boolean(loopResult?.error));
      const status = cancelled ? 'cancelled' : failed ? 'failed' : 'completed';
      const latencyMs = Date.now() - t0;
      const inputTokens = Number(loopResult?.inputTokens) || 0;
      const outputTokens = Number(loopResult?.outputTokens) || 0;
      const costUsd =
        Number(loopResult?.costUsd) ||
        (await estimateAgentRunCostUsd(env, childProfile.model_key, inputTokens, outputTokens));

      const marked = await markAgentRunComplete(env, ctx, {
        runId,
        status,
        latencyMs,
        inputTokens,
        outputTokens,
        costUsd,
        errorMessage: cancelled
          ? 'agent_run_cancelled'
          : failed
            ? String(loopResult?.error || 'lane_failed').slice(0, 2000)
            : null,
        modelKey: childProfile.model_key,
        provider: childProfile.selected_provider != null ? childProfile.selected_provider : undefined,
        routingArmId: childProfile.routing_arm_id,
        mode: childProfile.mode,
        taskType: resolvedTaskType,
      });
      if (!marked?.ok) {
        console.error('[multitask-spawn] markAgentRunComplete_failed', {
          run_id: runId,
          status,
          reason: marked?.reason || 'unknown',
        });
        // Fail loud into lane status — do not pretend the ledger row is terminal.
        throw new Error(`mark_agent_run_complete_failed:${marked?.reason || 'unknown'}`);
      }
      await bumpSpawnJobAfterChild(env, ctx, {
        spawnJobId: p.spawnJobId,
        ok: !failed && !cancelled,
        inputTokens,
        outputTokens,
        costUsd,
        latencyMs,
      });
      // Soft 80% warn → approval + halt (once). Resume via PATCH approve/deny — no Worker poll.
      const offer = await maybeOfferSpawnCostExtension(env, ctx, {
        userId: p.userId,
        workspaceId: p.workspaceId,
        tenantId: p.tenantId,
        sessionId: p.sessionId,
        conversationId: p.conversationId,
        parentRunId: p.parentRunId,
        spawnJobId: p.spawnJobId,
      }).catch((e) => {
        console.warn('[multitask-spawn] cost extension offer', e?.message ?? e);
        return null;
      });
      if (offer?.halted) budgetHalted = true;
      await enforceSpawnJobCostCap(env, {
        userId: p.userId,
        workspaceId: p.workspaceId,
        spawnJobId: p.spawnJobId,
      }).catch(() => null);
      if (cancelled) cancelCount += 1;
      else if (failed) errCount += 1;
      else okCount += 1;
      summaries.push({
        role_slug: slug,
        run_id: runId,
        status,
        summary: summary.slice(0, 800),
        tool_names: modelFacingToolNames(tools).slice(0, 20),
      });
    } catch (e) {
      const cancelled = isAgentRunAbortError(e) || (await isMultitaskRunCancelled(env, runId));
      if (cancelled) cancelCount += 1;
      else errCount += 1;
      const latencyMs = Date.now() - t0;
      await markAgentRunComplete(env, ctx, {
        runId,
        status: cancelled ? 'cancelled' : 'failed',
        latencyMs,
        errorMessage: String(e?.message || e).slice(0, 2000),
        mode: 'agent',
      }).catch(() => null);
      await bumpSpawnJobAfterChild(env, ctx, {
        spawnJobId: p.spawnJobId,
        ok: false,
        latencyMs,
        costUsd: 0,
      }).catch(() => null);
      summaries.push({
        role_slug: slug,
        run_id: runId,
        status: cancelled ? 'cancelled' : 'failed',
        error: String(e?.message || e).slice(0, 500),
        summary: textChunks.join('').slice(0, 400),
      });
    }
  }

  const queue = [...lanes];
  const workers = [];
  for (let w = 0; w < Math.min(concurrency, Math.max(1, queue.length)); w++) {
    workers.push(
      (async () => {
        while (queue.length) {
          const stop = await fanoutStopReason();
          if (stop === 'halt') {
            // Leave remaining queue items as child status=queued for resume after approve/deny.
            break;
          }
          if (stop === 'cancel') {
            // Drain remaining without starting new LLM work.
            while (queue.length) {
              const skipped = queue.shift();
              if (!skipped) break;
              cancelCount += 1;
              const rid = trim(skipped.run_id);
              await markAgentRunComplete(env, ctx, {
                runId: rid,
                status: 'cancelled',
                latencyMs: 0,
                errorMessage: 'operator_cancelled',
                mode: 'agent',
              }).catch(() => null);
              summaries.push({
                role_slug: trim(skipped.role_slug) || null,
                run_id: rid,
                status: 'cancelled',
                summary: '',
              });
            }
            break;
          }
          const lane = queue.shift();
          if (lane) await runOne(lane);
        }
      })(),
    );
  }
  await Promise.all(workers);

  const jobRow = await getSpawnJobRow(env, p.spawnJobId);
  let merged = {};
  try {
    merged = jobRow?.merged_output ? JSON.parse(String(jobRow.merged_output)) : {};
  } catch {
    merged = {};
  }
  const prevSummaries = Array.isArray(merged.summaries) ? merged.summaries : [];
  const byRun = new Map(prevSummaries.filter((s) => s?.run_id).map((s) => [String(s.run_id), s]));
  for (const s of summaries) {
    if (s?.run_id) byRun.set(String(s.run_id), s);
  }
  merged.summaries = [...byRun.values()];
  merged.ok_count = (Number(merged.ok_count) || 0) + okCount;
  merged.err_count = (Number(merged.err_count) || 0) + errCount;
  merged.cancel_count = (Number(merged.cancel_count) || 0) + cancelCount;

  // Budget halt: persist progress, keep queued children, do not finalize.
  if (budgetHalted || trim(jobRow?.status).toLowerCase() === 'awaiting_approval') {
    merged.budget_extension_halted = true;
    await setSpawnJobMergedOutput(env, p.spawnJobId, merged);
    await setSpawnJobStatus(env, p.spawnJobId, 'awaiting_approval');
    return {
      ok: true,
      halted: true,
      okCount,
      errCount,
      cancelCount,
      summaries: merged.summaries,
    };
  }

  const mergedJson = JSON.stringify(merged);
  // Prefer in-memory lane outcomes when D1 complete patches lagged (never stamp false operator_cancelled).
  for (const s of summaries) {
    const rid = trim(s?.run_id);
    const st = trim(s?.status).toLowerCase();
    if (!rid || !['completed', 'failed', 'cancelled'].includes(st)) continue;
    await markAgentRunComplete(env, ctx, {
      runId: rid,
      status: st,
      latencyMs: 0,
      mode: 'agent',
      errorMessage:
        st === 'cancelled'
          ? trim(s.error) || 'agent_run_cancelled'
          : st === 'failed'
            ? trim(s.error) || 'lane_failed'
            : null,
    }).catch((e) => {
      console.warn('[multitask-spawn] reconcile_child_status', rid, e?.message ?? e);
    });
  }

  const liveAfter = await env.DB.prepare(
    `SELECT
        SUM(CASE WHEN status IN ('queued','running','pending') THEN 1 ELSE 0 END) AS open_n,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS ok_n,
        SUM(CASE WHEN status IN ('failed','partial') THEN 1 ELSE 0 END) AS err_n,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancel_n
       FROM agentsam_agent_run r
       JOIN agentsam_spawn_session s ON s.child_run_id = r.id
      WHERE s.parent_run_id = ?`,
  )
    .bind(p.parentRunId)
    .first()
    .catch(() => null);
  const openN = Number(liveAfter?.open_n) || 0;
  if (openN > 0) {
    // True stragglers only — distinct reason (not the cancel-tool default).
    await env.DB.prepare(
      `UPDATE agentsam_agent_run
          SET status = 'cancelled',
              error_message = COALESCE(NULLIF(trim(error_message), ''), 'fanout_finalize_straggler'),
              completed_at_unix = COALESCE(completed_at_unix, unixepoch()),
              updated_at_unix = unixepoch()
        WHERE id IN (
          SELECT r.id FROM agentsam_agent_run r
          JOIN agentsam_spawn_session s ON s.child_run_id = r.id
          WHERE s.parent_run_id = ?
        ) AND status IN ('queued', 'running')`,
    )
      .bind(p.parentRunId)
      .run()
      .catch(() => null);
  }
  const succ = Number(liveAfter?.ok_n) || okCount;
  const fail =
    (Number(liveAfter?.err_n) || errCount) + (Number(liveAfter?.cancel_n) || cancelCount) + openN;
  await finalizeSpawnJob(env, ctx, {
    spawnJobId: p.spawnJobId,
    mergedOutput: mergedJson,
    subagentsSucceeded: succ,
    subagentsFailed: fail,
  }).catch(async () => {
    await setSpawnJobMergedOutput(env, p.spawnJobId, merged);
  });
  if (cancelCount > 0 || (await isMultitaskRunCancelled(env, p.parentRunId))) {
    await env.DB.prepare(
      `UPDATE agentsam_spawn_job
          SET error_message = COALESCE(error_message, 'operator_cancelled')
        WHERE id = ?`,
    )
      .bind(p.spawnJobId)
      .run()
      .catch(() => null);
  }

  const liveFinal = await env.DB.prepare(
    `SELECT
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS ok_n,
        SUM(CASE WHEN status IN ('failed','partial') THEN 1 ELSE 0 END) AS err_n,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancel_n,
        SUM(CASE WHEN status IN ('queued','running','pending') THEN 1 ELSE 0 END) AS open_n
       FROM agentsam_agent_run r
       JOIN agentsam_spawn_session s ON s.child_run_id = r.id
      WHERE s.parent_run_id = ?`,
  )
    .bind(p.parentRunId)
    .first()
    .catch(() => null);
  const finalOk = Number(liveFinal?.ok_n) || 0;
  const finalErr = Number(liveFinal?.err_n) || 0;
  const finalCancel = Number(liveFinal?.cancel_n) || 0;
  const finalOpen = Number(liveFinal?.open_n) || 0;
  const parentStatus =
    finalOpen > 0
      ? 'running'
      : finalCancel > 0 && finalOk === 0 && finalErr === 0
        ? 'cancelled'
        : finalErr === 0 && finalCancel === 0
          ? 'completed'
          : finalOk > 0
            ? 'completed'
            : finalCancel > 0
              ? 'cancelled'
              : 'failed';
  if (parentStatus !== 'running') {
    const parentMarked = await markAgentRunComplete(env, ctx, {
      runId: p.parentRunId,
      status: parentStatus,
      latencyMs: 0,
      mode: 'multitask',
      errorMessage: parentStatus === 'cancelled' ? 'operator_cancelled' : null,
    }).catch((e) => ({ ok: false, reason: e?.message ?? String(e) }));
    if (!parentMarked?.ok) {
      console.error('[multitask-spawn] parent_mark_failed', {
        parent_run_id: p.parentRunId,
        status: parentStatus,
        reason: parentMarked?.reason || 'unknown',
      });
    }
  }

  return { ok: errCount === 0 && cancelCount === 0, okCount, errCount, cancelCount, summaries: merged.summaries };
}

/**
 * Stop a multitask fanout: force-terminal cancel on parent + all children, close spawn_job.
 * Terminal cancellation closes active child runs and the spawn job together.
 *
 * @param {any} env
 * @param {{
 *   userId: string,
 *   workspaceId: string,
 *   spawnJobId?: string|null,
 *   fanoutId?: string|null,
 *   reason?: string|null,
 * }} input
 */
export async function cancelMultitaskFanout(env, input) {
  const userId = trim(input.userId);
  const workspaceId = trim(input.workspaceId);
  const spawnJobId = trim(input.spawnJobId || input.fanoutId || input.fanout_id || input.spawn_job_id);
  const reason = trim(input.reason) || 'operator_cancelled';
  if (!env?.DB) return { ok: false, error: 'db_not_configured' };
  if (!spawnJobId) return { ok: false, error: 'spawn_job_id_required' };

  const job = await getSpawnJobRow(env, spawnJobId);
  if (!job?.id) return { ok: false, error: 'spawn_job_not_found' };
  if (userId && trim(job.user_id) && trim(job.user_id) !== userId) {
    return { ok: false, error: 'forbidden' };
  }
  if (workspaceId && trim(job.workspace_id) && trim(job.workspace_id) !== workspaceId) {
    return { ok: false, error: 'forbidden' };
  }

  const parentRunId = trim(job.master_run_id);
  const { results: children } = await env.DB.prepare(
    `SELECT r.id, r.status, r.cost_usd
       FROM agentsam_agent_run r
       LEFT JOIN agentsam_spawn_session s ON s.child_run_id = r.id
      WHERE r.id = ? OR s.parent_run_id = ?
      ORDER BY CASE WHEN r.id = ? THEN 0 ELSE 1 END, r.created_at_unix ASC`,
  )
    .bind(parentRunId, parentRunId, parentRunId)
    .all()
    .catch(() => ({ results: [] }));

  const cancelled = [];
  const alreadyTerminal = [];
  for (const row of children || []) {
    const rid = trim(row.id);
    const st = trim(row.status).toLowerCase();
    if (st && !['queued', 'running', 'pending'].includes(st)) {
      alreadyTerminal.push({ run_id: rid, status: st });
      continue;
    }
    cancelled.push({
      run_id: rid,
      status: 'cancelled',
      ok: true,
    });
  }

  // Belt: bulk force-close any race that slipped past per-row updates.
  await env.DB.prepare(
    `UPDATE agentsam_agent_run
        SET status = 'cancelled',
            error_message = COALESCE(NULLIF(trim(error_message), ''), ?),
            completed_at_unix = COALESCE(completed_at_unix, unixepoch()),
            updated_at_unix = unixepoch()
      WHERE id IN (
        SELECT r.id FROM agentsam_agent_run r
        LEFT JOIN agentsam_spawn_session s ON s.child_run_id = r.id
        WHERE (r.id = ? OR s.parent_run_id = ?)
      ) AND status IN ('queued', 'running')`,
  )
    .bind(reason.slice(0, 500), parentRunId, parentRunId)
    .run()
    .catch(() => null);

  const failedN = (children || []).length;
  await env.DB.prepare(
    `UPDATE agentsam_spawn_job
        SET status = CASE
              WHEN status IN ('completed', 'partial') THEN status
              ELSE 'failed'
            END,
            error_message = COALESCE(NULLIF(trim(error_message), ''), ?),
            completed_at = COALESCE(completed_at, datetime('now')),
            subagents_failed = CASE
              WHEN subagents_failed < subagents_spawned THEN subagents_spawned
              ELSE subagents_failed
            END
      WHERE id = ?`,
  )
    .bind(reason.slice(0, 500), spawnJobId)
    .run()
    .catch(() => null);

  const costRollup = await reconcileSpawnJobFromChildren(env, spawnJobId).catch(() => null);

  let timersStopped = 0;
  try {
    const closed = await stopAllTimersForSpawnJob(env, spawnJobId, 'cancelled');
    timersStopped = Number(closed?.stopped) || 0;
  } catch (e) {
    console.warn('[multitask-spawn] cancel_stop_timers', e?.message ?? e);
  }

  const live = await getMultitaskStatus(env, {
    userId,
    workspaceId,
    spawnJobId,
    skipCostEnforce: true,
  });
  return {
    ok: true,
    spawn_job_id: spawnJobId,
    parent_run_id: parentRunId,
    cancelled_runs: cancelled,
    already_terminal: alreadyTerminal,
    runs_touched: cancelled.length + alreadyTerminal.length,
    child_count: failedN,
    timers_stopped: timersStopped,
    total_cost_usd: costRollup?.total_cost_usd ?? live.total_cost_usd ?? null,
    job_status: live.job_status || 'failed',
    lanes: live.lanes || [],
    hint: 'Force-terminal cancel applied. Poll agentsam_multitask_status; lanes should show cancelled (not running).',
  };
}

/**
 * Poll spawn job + child runs (+ approval pending).
 *
 * @param {any} env
 * @param {{
 *   userId: string,
 *   workspaceId: string,
 *   spawnJobId?: string|null,
 *   fanoutId?: string|null,
 *   skipCostEnforce?: boolean,
 * }} input
 */
export async function getMultitaskStatus(env, input) {
  const userId = trim(input.userId);
  const workspaceId = trim(input.workspaceId);
  const spawnJobId = trim(input.spawnJobId || input.fanoutId || input.fanout_id || input.spawn_job_id);
  if (!env?.DB) return { ok: false, error: 'db_not_configured' };
  if (!spawnJobId) return { ok: false, error: 'spawn_job_id_required' };

  const job = await getSpawnJobRow(env, spawnJobId);
  if (!job?.id) return { ok: false, error: 'spawn_job_not_found' };

  if (userId && trim(job.user_id) && trim(job.user_id) !== userId) {
    return { ok: false, error: 'forbidden' };
  }
  if (workspaceId && trim(job.workspace_id) && trim(job.workspace_id) !== workspaceId) {
    return { ok: false, error: 'forbidden' };
  }

  let merged = {};
  try {
    merged = job.merged_output ? JSON.parse(String(job.merged_output)) : {};
  } catch {
    merged = {};
  }
  const laneMeta = Array.isArray(merged.lanes) ? merged.lanes : [];
  const summaryByRun = new Map(
    (Array.isArray(merged.summaries) ? merged.summaries : [])
      .filter((s) => s?.run_id)
      .map((s) => [String(s.run_id), s]),
  );

  const parentRunId = trim(job.master_run_id);
  const { results: childRuns } = await env.DB.prepare(
    `SELECT r.id, r.status, r.error_message, r.latency_ms, r.cost_usd, r.created_at_unix
       FROM agentsam_agent_run r
       JOIN agentsam_spawn_session s ON s.child_run_id = r.id
      WHERE s.parent_run_id = ?
      ORDER BY COALESCE(r.created_at_unix, 0) ASC, r.id ASC
      LIMIT 20`,
  )
    .bind(parentRunId)
    .all()
    .catch(() => ({ results: [] }));

  let parentRow = await env.DB.prepare(
    `SELECT id, status, cost_usd FROM agentsam_agent_run WHERE id = ? LIMIT 1`,
  )
    .bind(parentRunId)
    .first()
    .catch(() => null);

  // Heal zombie parents left running after children reached a terminal state.
  const parentSt = trim(parentRow?.status).toLowerCase();
  if (parentRow?.id && ['queued', 'running', 'pending'].includes(parentSt)) {
    const kids = childRuns || [];
    const openKids = kids.filter((r) =>
      ['queued', 'running', 'pending'].includes(trim(r.status).toLowerCase()),
    ).length;
    if (kids.length > 0 && openKids === 0) {
      const okN = kids.filter((r) => trim(r.status).toLowerCase() === 'completed').length;
      const cancelN = kids.filter((r) => trim(r.status).toLowerCase() === 'cancelled').length;
      const errN = kids.filter((r) =>
        ['failed', 'partial', 'error'].includes(trim(r.status).toLowerCase()),
      ).length;
      const healed =
        cancelN > 0 && okN === 0 && errN === 0
          ? 'cancelled'
          : errN === 0 && cancelN === 0
            ? 'completed'
            : okN > 0
              ? 'completed'
              : cancelN > 0
                ? 'cancelled'
                : 'failed';
      await markAgentRunComplete(env, null, {
        runId: parentRunId,
        status: healed,
        latencyMs: 0,
        mode: 'multitask',
        errorMessage: healed === 'cancelled' ? 'operator_cancelled' : null,
      }).catch(() => null);
      parentRow = await env.DB.prepare(
        `SELECT id, status, cost_usd FROM agentsam_agent_run WHERE id = ? LIMIT 1`,
      )
        .bind(parentRunId)
        .first()
        .catch(() => parentRow);
    }
  }

  const runIds = (childRuns || []).map((r) => String(r.id));
  const pendingApprovals = new Set();
  if (runIds.length) {
    const ph = runIds.map(() => '?').join(',');
    try {
      const { results: appr } = await env.DB.prepare(
        `SELECT agent_run_id FROM agentsam_approval_queue
          WHERE status = 'pending' AND agent_run_id IN (${ph})`,
      )
        .bind(...runIds)
        .all();
      for (const a of appr || []) {
        if (a?.agent_run_id) pendingApprovals.add(String(a.agent_run_id));
      }
    } catch {
      /* approval table optional */
    }
  }

  let openLanes = 0;
  let totalCost = 0;
  const lanes = (childRuns || []).map((r, i) => {
    const id = String(r.id);
    const meta = laneMeta.find((l) => String(l.run_id) === id) || laneMeta[i] || {};
    const sum = summaryByRun.get(id);
    let status = trim(r.status) || 'queued';
    if (pendingApprovals.has(id)) status = 'awaiting_approval';
    else if (status === 'completed' || status === 'success') status = 'done';
    else if (status === 'cancelled') status = 'cancelled';
    else if (status === 'failed' || status === 'error') status = 'failed';
    else if (status === 'running') status = 'running';
    else if (status === 'queued' || status === 'pending') status = 'queued';
    if (status === 'running' || status === 'queued' || status === 'awaiting_approval') {
      openLanes += 1;
    }
    const cost = r.cost_usd != null ? Number(r.cost_usd) : 0;
    totalCost += Number.isFinite(cost) ? cost : 0;
    return {
      run_id: id,
      slug: trim(meta.role_slug) || null,
      role_slug_requested: trim(meta.role_slug_requested || meta.role_slug) || null,
      title: trim(meta.title) || null,
      status,
      summary_excerpt: coercePlainText(sum?.summary || r.error_message || '').slice(0, 400),
      latency_ms: r.latency_ms != null ? Number(r.latency_ms) : null,
      cost_usd: r.cost_usd != null ? Number(r.cost_usd) : null,
    };
  });

  // Keep spawn_job.total_cost_usd honest vs child SUM (status poll is a natural reconcile point).
  const rollup = await reconcileSpawnJobFromChildren(env, spawnJobId).catch(() => null);
  const jobCost =
    rollup?.total_cost_usd != null && Number.isFinite(Number(rollup.total_cost_usd))
      ? Number(rollup.total_cost_usd)
      : totalCost;

  const capEnforced = input.skipCostEnforce
    ? null
    : await enforceSpawnJobCostCap(env, {
        userId,
        workspaceId,
        spawnJobId,
      }).catch(() => null);
  const jobFresh = (await getSpawnJobRow(env, spawnJobId)) || job;

  let jobStatus = trim(jobFresh.status) || null;
  const jobErr = trim(jobFresh.error_message);
  const operatorCancelled =
    jobErr === 'operator_cancelled' ||
    jobErr.startsWith('operator_cancelled') ||
    jobErr.startsWith('cost_cap_exceeded') ||
    jobErr.startsWith('lane_cost_cap_exceeded');
  // Ledger honesty: job marked failed while children still open → report diverged.
  const ledgerDiverged = openLanes > 0 && ['failed', 'completed', 'partial'].includes(String(jobStatus));
  if (operatorCancelled && jobStatus === 'failed') jobStatus = 'cancelled';

  const laneRoles = laneMeta.map((l) => trim(l.role_slug)).filter(Boolean);
  const costCapUsd = normalizeCostCapUsd(jobFresh.cost_cap_usd);

  return {
    ok: true,
    spawn_job_id: spawnJobId,
    fanout_id: spawnJobId,
    parent_run_id: parentRunId,
    parent_status: trim(parentRow?.status) || null,
    job_status: jobStatus,
    job_error: jobErr || null,
    job_orchestrator_slug: trim(jobFresh.subagent_slug) || null,
    lane_role_slugs: laneRoles,
    operator_cancelled: operatorCancelled,
    cost_cap_exceeded: capEnforced?.over === true,
    cost_cap_usd: costCapUsd,
    ledger_diverged: ledgerDiverged,
    open_lane_count: openLanes,
    total_cost_usd: Number(jobFresh.total_cost_usd) || jobCost,
    child_cost_usd: totalCost,
    merge: trim(jobFresh.merge_strategy) || merged.merge || null,
    budget_extension_halted:
      merged.budget_extension_halted === true || String(jobStatus).toLowerCase() === 'awaiting_approval',
    budget_extension_proposal_id: trim(merged.budget_extension_proposal_id) || null,
    budget_extension_proposal_expired: merged.budget_extension_proposal_expired === true,
    budget_extension_pct:
      merged.budget_extension_pct != null && Number.isFinite(Number(merged.budget_extension_pct))
        ? Number(merged.budget_extension_pct)
        : null,
    lanes,
    lane_count: lanes.length,
    manage_hint:
      merged.budget_extension_proposal_expired === true
        ? 'Budget decision expired — Extend / Keep cap / Cancel job in Agent chat.'
        : merged.budget_extension_halted === true || String(jobStatus).toLowerCase() === 'awaiting_approval'
          ? 'Budget warning — approve Extend budget in Agent chat (or ?proposal= deep link) to resume; deny resumes under current cap.'
          : openLanes > 0
            ? 'Lanes still open — call agentsam_multitask_cancel with this spawn_job_id to force-stop.'
            : null,
  };
}
