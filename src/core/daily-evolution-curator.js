/**
 * Daily evolution curator — v1: code activity → evolution brief + conditional router patch.
 * Worker-native; writes via agentsam_memory commit (D1 SSOT + pgvector outbox).
 */
import { chicagoDateIso } from '../../backend/jobs/daily-memory-pipeline.js';
import { resolveDailyDigestScope } from '../../backend/jobs/daily-digest-scope.js';
import { resolveDailyPlanNotifyUser } from '../../backend/jobs/daily-plan-support.js';
import {
  collectDailyCodeActivity,
  dailyCodeActivityForDigest,
  renderDailyCodeActivityMarkdown,
} from './daily-code-activity.js';
import { evaluateCodeActivitySignificance } from './daily-evolution-significance.js';
import {
  DAILY_EVOLUTION_SOURCE,
  HOT_WINDOW_DAYS,
  evolutionMemoryKey,
  platformContextRouterKey,
} from './daily-evolution-keys.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function parseTextPayload(mcpStyle) {
  const text = mcpStyle?.content?.[0]?.text;
  if (typeof text !== 'string') return mcpStyle;
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: 'unparseable_memory_response', raw: text };
  }
}

import { executeAgentsamMemoryCommit } from './agentsam-memory-commit.js';
import { sha256Hex } from './agentsam-memory-contract.js';

export {
  DAILY_EVOLUTION_SOURCE,
  HOT_WINDOW_DAYS,
  evolutionMemoryKey,
  platformContextRouterKey,
} from './daily-evolution-keys.js';

function dayBeforeChicagoIso(dateIso) {
  const parts = trim(dateIso).split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return chicagoYesterdayIso();
  }
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return chicagoDateIso(dt);
}

function chicagoYesterdayIso(d = new Date()) {
  return dayBeforeChicagoIso(chicagoDateIso(d));
}

/**
 * @param {import('@cloudflare/workers-types').D1Database} db
 */
async function loadPriorSignalsSnapshot(db, tenantId, userId, workspaceId, dateIso) {
  const yesterdayKey = evolutionMemoryKey(workspaceId, dayBeforeChicagoIso(dateIso));
  const row = await db
    .prepare(
      `SELECT value_json FROM agentsam_memory
        WHERE tenant_id = ? AND user_id = ? AND key = ?
          AND status = 'active'
        LIMIT 1`,
    )
    .bind(tenantId, userId, yesterdayKey)
    .first()
    .catch(() => null);
  if (!row?.value_json) return null;
  try {
    const parsed = JSON.parse(String(row.value_json));
    return parsed?.signals && typeof parsed.signals === 'object' ? parsed.signals : parsed;
  } catch {
    return null;
  }
}

/**
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {string} workspaceId
 * @param {string} dateIso
 */
async function loadExperienceRollup(db, workspaceId, dateIso) {
  const ws = trim(workspaceId);
  if (!db || !ws) return null;
  const parts = trim(dateIso).split('-').map(Number);
  if (parts.length !== 3) return null;
  const dayStart = Math.floor(Date.UTC(parts[0], parts[1] - 1, parts[2], 5, 0, 0) / 1000);
  const dayEnd = dayStart + 86400;
  try {
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS n,
                SUM(CASE WHEN outcome = 'useful_success' THEN 1 ELSE 0 END) AS useful,
                SUM(COALESCE(total_task_cost_usd, cost_usd, 0)) AS spend,
                SUM(COALESCE(cache_savings_usd, 0)) AS cache_saved
           FROM agentsam_agent_experience
          WHERE workspace_id = ? AND created_at_unix >= ? AND created_at_unix < ?`,
      )
      .bind(ws, dayStart, dayEnd)
      .first();
    if (!row) return null;
    return {
      experiences: Number(row.n) || 0,
      useful_outcomes: Number(row.useful) || 0,
      spend_usd: Number(row.spend) || 0,
      cache_savings_usd: Number(row.cache_saved) || 0,
    };
  } catch {
    return null;
  }
}

function buildEvolutionBriefMarkdown(dateIso, activityCompact, significance) {
  const lines = [
    `# Daily evolution — ${dateIso}`,
    '',
    '## What changed (code activity)',
    '',
    activityCompact.markdown || '_No code activity markdown._',
    '',
    '## Significance (v1 gate)',
    '',
  ];
  if (significance?.reasons?.length) {
    for (const reason of significance.reasons) lines.push(`- ${reason}`);
  } else {
    lines.push('- no_router_trigger');
  }
  lines.push(
    '',
    '_Derivation: observed (GitHub commits). Source: daily_evolution_curator. Not a deploy log._',
  );
  return lines.join('\n');
}

function buildRouterMarkdown(dateIso, activityCompact, significance) {
  const signals = significance?.signals || activityCompact.signals || {};
  const primary = activityCompact.primary_focus?.name || 'none';
  const subsystems = topSubsystemList(activityCompact.subsystem_commits, 5);
  return [
    `# Platform context router — ${dateIso}`,
    '',
    'Pinned hot lanes for agents. Read before broad repo search.',
    '',
    `**Primary focus:** ${primary}`,
    `**Work mode:** ${signals.work_mode || 'unknown'}`,
    `**Hot subsystems:** ${subsystems.join(', ') || 'none'}`,
    '',
    significance?.reasons?.length
      ? `**Router refresh reasons:** ${significance.reasons.join('; ')}`
      : '**Router refresh reasons:** baseline',
    '',
    '_Derivation: observed. Source: daily_evolution_curator._',
  ].join('\n');
}

function topSubsystemList(subsystemCommits, limit = 5) {
  return Object.entries(subsystemCommits || {})
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .slice(0, limit)
    .map(([name]) => name);
}

/**
 * @param {any} env
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {{ userId: string, tenantId: string|null, workspaceId: string, workspaceIds?: string[] }} scope
 * @param {string} dateIso
 */
export async function runDailyEvolutionCuratorForWorkspace(env, db, scope, dateIso) {
  const userId = trim(scope.userId);
  const tenantId = trim(scope.tenantId);
  const workspaceId = trim(scope.workspaceId);
  if (!db || !userId || !tenantId || !workspaceId) {
    return { ok: false, error: 'scope_required', workspaceId };
  }

  const digestScope = {
    userId,
    tenantId,
    workspaceIds: scope.workspaceIds?.length ? scope.workspaceIds : [workspaceId],
  };

  const activity = await collectDailyCodeActivity(env, digestScope, { hours: 24 });
  const activityCompact = dailyCodeActivityForDigest(activity);
  const priorSignals = await loadPriorSignalsSnapshot(db, tenantId, userId, workspaceId, dateIso);
  const significance = evaluateCodeActivitySignificance(activityCompact, priorSignals);

  const workspace = {
    tenant_id: tenantId,
    user_id: userId,
    workspace_id: workspaceId,
    _,
    authorized_workspaces: digestScope.workspaceIds,
  };

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + HOT_WINDOW_DAYS * 86400;
  const evolutionKey = evolutionMemoryKey(workspaceId, dateIso);
  const briefBody = buildEvolutionBriefMarkdown(dateIso, activityCompact, significance);
  const valueJson = {
    derivation: 'observed',
    curator_version: 'daily_evolution_v1',
    date: dateIso,
    workspace_id: workspaceId,
    signals: significance.signals || activityCompact.signals || null,
    significance: {
      router_patch: significance.routerPatch,
      reasons: significance.reasons || [],
    },
    code_activity: {
      available: activityCompact.available === true,
      commits: activityCompact.commits || 0,
      primary_focus: activityCompact.primary_focus || null,
    },
    experience_rollup: await loadExperienceRollup(db, workspaceId, dateIso).catch(() => null),
  };

  const evolutionCommit = await executeAgentsamMemoryCommit(
    env,
    db,
    workspace,
    {
      memory_key: evolutionKey,
      key: evolutionKey,
      title: `Daily evolution ${dateIso}`,
      summary: activityCompact.primary_focus?.name
        ? `Hot focus: ${activityCompact.primary_focus.name} (${activityCompact.commits || 0} commits)`
        : `Daily evolution brief ${dateIso}`,
      content: briefBody,
      memory_type: 'state',
      source: DAILY_EVOLUTION_SOURCE,
      source_type: 'daily_evolution_brief',
      importance: 6,
      is_pinned: false,
      expires_at: expiresAt,
      value_json: valueJson,
      idempotency_key: `daily_evolution:${workspaceId}:${dateIso}`,
      workspace_id: workspaceId,
      scope_type: 'workspace',
      scope_id: workspaceId,
      eager: true,
    },
    { eager: true },
  );
  const evolutionResult = parseTextPayload(evolutionCommit);

  let routerResult = { skipped: true, reason: 'significance_gate' };
  if (significance.routerPatch) {
    const routerKey = platformContextRouterKey(workspaceId);
    const routerBody = buildRouterMarkdown(dateIso, activityCompact, significance);
    const routerHash = (await sha256Hex(routerBody)).slice(0, 16);
    const routerCommit = await executeAgentsamMemoryCommit(
      env,
      db,
      workspace,
      {
        memory_key: routerKey,
        key: routerKey,
        title: 'Platform context router',
        summary: `Hot lanes ${dateIso}: ${activityCompact.primary_focus?.name || 'see body'}`,
        content: routerBody,
        memory_type: 'state',
        source: DAILY_EVOLUTION_SOURCE,
        source_type: 'platform_context_router',
        importance: 9,
        is_pinned: true,
        value_json: {
          derivation: 'observed',
          curator_version: 'daily_evolution_v1',
          date: dateIso,
          workspace_id: workspaceId,
          signals: significance.signals || null,
          reasons: significance.reasons || [],
        },
        idempotency_key: `daily_evolution_router:${workspaceId}:${dateIso}:${routerHash}`,
        workspace_id: workspaceId,
        scope_type: 'workspace',
        scope_id: workspaceId,
        eager: true,
      },
      { eager: true },
    );
    routerResult = parseTextPayload(routerCommit);
  }

  return {
    ok: evolutionResult.ok !== false,
    workspaceId,
    dateIso,
    evolutionKey,
    activityAvailable: activityCompact.available === true,
    significance,
    evolution: evolutionResult,
    router: routerResult,
  };
}

/**
 * @param {any} env
 * @param {{ dateIso?: string, workspaceIds?: string[] }} [opts]
 */
export async function runDailyEvolutionCurator(env, opts = {}) {
  if (!env?.DB) return { ok: false, error: 'db_not_configured' };

  const dateIso = trim(opts.dateIso) || chicagoDateIso();
  const notify = await resolveDailyPlanNotifyUser(env);
  if (!notify.userId) return { ok: false, error: 'notify_user_unresolved', dateIso };

  const scope = await resolveDailyDigestScope(env, notify);
  if (!scope.tenantId) return { ok: false, error: 'tenant_unresolved', dateIso };

  const targetWorkspaces =
    Array.isArray(opts.workspaceIds) && opts.workspaceIds.length
      ? opts.workspaceIds.map((w) => trim(w)).filter(Boolean)
      : (scope.workspaceIds || []).slice(0, 3);

  if (!targetWorkspaces.length) {
    return { ok: false, error: 'no_workspace_scope', dateIso };
  }

  const results = [];
  for (const workspaceId of targetWorkspaces) {
    results.push(
      await runDailyEvolutionCuratorForWorkspace(env, env.DB, {
        userId: scope.userId,
        tenantId: scope.tenantId,
        workspaceId,
        workspaceIds: scope.workspaceIds,
      }, dateIso),
    );
  }

  const ok = results.every((r) => r.ok !== false);
  return {
    ok,
    dateIso,
    workspace_count: results.length,
    results,
    metadata: {
      source: DAILY_EVOLUTION_SOURCE,
      curator_version: 'daily_evolution_v1',
    },
  };
}
