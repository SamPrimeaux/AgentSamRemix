/**
 * Daily plan email — Gemini-only generation, owner notify, push alerts.
 */

import {
  EMPTY_ALL,
  resolveDailyDigestScope,
  workspaceIdInSql,
} from './daily-digest-scope.js';
import { notifySam } from '../http/agentsam/routes/git-notifications-runtime.js';
import { sendWebPushToUser } from '../agentsam/runtime/spawn/web-push.js';
import { snapshotGmailInboxForUser } from '../../src/core/gmail-inbox-snapshot.js';
import { agentsamMemoryActiveSqlOrEmpty } from '../http/agentsam/routes/memory-resolve-runtime.js';
import { buildGeminiGenerationConfig, parseGeminiResponseText } from '../../src/integrations/gemini.js';

export { resolveDailyDigestScope } from './daily-digest-scope.js';

export class DailyPlanError extends Error {
  constructor(message, { stage = 'unknown', model = '', detail = '' } = {}) {
    super(message);
    this.name = 'DailyPlanError';
    this.stage = stage;
    this.model = model;
    this.detail = detail;
  }
}

function geminiApiKey(env) {
  return (
    (env?.GOOGLE_AI_API_KEY && String(env.GOOGLE_AI_API_KEY).trim()) ||
    (env?.GEMINI_API_KEY && String(env.GEMINI_API_KEY).trim()) ||
    ''
  );
}

/** @param {*} env */
export async function resolveDailyPlanNotifyUser(env) {
  const resendTo = env?.RESEND_TO ? String(env.RESEND_TO).trim().toLowerCase() : '';
  if (resendTo && env?.DB) {
    const row = await env.DB.prepare(
      `SELECT id, email FROM auth_users WHERE lower(email) = ? LIMIT 1`
    ).bind(resendTo).first().catch(() => null);
    if (row?.id) {
      return { userId: String(row.id), email: String(row.email || resendTo) };
    }
  }
  return { userId: null, email: null };
}

/**
 * Users who should receive their own scoped daily digest + Gmail triage.
 * Primary: active google_gmail OAuth linked to auth_users.email (all connected accounts per user).
 * No fallback recipient is added: every digest must resolve to an authenticated user.
 * Context is isolated per recipient — never cross-tenant / cross-user data.
 * @param {*} env
 * @returns {Promise<Array<{ userId: string, email: string, tenantId?: string|null, hasGmail?: boolean }>>}
 */
export async function listDailyMemoryRecipients(env) {
  if (!env?.DB) return [];
  const seen = new Map();

  const { results } = await env.DB.prepare(
    `SELECT DISTINCT
       u.id AS user_id,
       lower(trim(u.email)) AS email,
       COALESCE(NULLIF(trim(u.active_tenant_id), ''), NULLIF(trim(u.tenant_id), '')) AS tenant_id
     FROM user_oauth_tokens t
     INNER JOIN auth_users u ON u.id = t.user_id
     WHERE lower(t.provider) IN ('google_gmail', 'gmail')
       AND u.email IS NOT NULL AND trim(u.email) != ''
       AND (
         COALESCE(trim(t.refresh_token), '') != ''
         OR COALESCE(trim(t.refresh_token_encrypted), '') != ''
         OR COALESCE(trim(t.access_token), '') != ''
         OR COALESCE(trim(t.access_token_encrypted), '') != ''
       )`,
  ).all().catch(() => ({ results: [] }));

  for (const row of results || []) {
    const userId = String(row.user_id || '').trim();
    const email = String(row.email || '').trim().toLowerCase();
    if (!userId || !email.includes('@')) continue;
    seen.set(userId, {
      userId,
      email,
      tenantId: row.tenant_id ? String(row.tenant_id).trim() : null,
      hasGmail: true,
    });
  }

  return [...seen.values()];
}

/** @param {*} env @param {string} sql @param  {...*} bind */
async function d1All(env, sql, ...bind) {
  if (!env?.DB) return { results: [] };
  return env.DB.prepare(sql).bind(...bind).all().catch(() => ({ results: [] }));
}

/** @param {*} env @param {string} sql @param  {...*} bind */
async function d1First(env, sql, ...bind) {
  if (!env?.DB) return null;
  return env.DB.prepare(sql).bind(...bind).first().catch(() => null);
}

/** @param {*} env @param {string} tenantId @param {{ userId?: string|null, email?: string|null }} owner @param {import('./daily-digest-scope.js').DailyDigestScope|null} [presetScope] */
export async function gatherMorningPlanContext(env, tenantId, owner, presetScope = null) {
  const safe = (p) => (p ? p.catch(() => null) : Promise.resolve(null));
  const today = new Date().toISOString().slice(0, 10);
  const digestScope = presetScope || await resolveDailyDigestScope(env, owner);
  const effectiveTenant = digestScope.tenantId || tenantId;
  const wsIn = workspaceIdInSql(digestScope.workspaceIds);
  const memoryActiveSql = await agentsamMemoryActiveSqlOrEmpty(env.DB);
  const emptyAll = () => Promise.resolve(EMPTY_ALL);
  const emptyFirst = () => Promise.resolve(null);

  const [
    memoryRows,
    clientCtxRows,
    recentRuns,
    runCostToday,
    mcpActivity,
    spawnJobs,
    emailLogs24h,
    pendingNotifications,
    gmailSnapshot,
    usageToday,
    usage7d,
    planTasks,
    openTodosByProject,
    calendarUpcoming,
    taskActivityRecent,
    trackedTimeToday,
  ] = await Promise.all([
    effectiveTenant && digestScope.userId && wsIn.binds.length
      ? env.DB.prepare(
        `SELECT key, value, memory_type, updated_at FROM agentsam_memory
         WHERE tenant_id = ? AND user_id = ? AND ${wsIn.clause}
           AND ${memoryActiveSql}
           AND memory_type IN ('decision','skill','state','policy')
           AND decay_score > 0
         ORDER BY updated_at DESC LIMIT 12`
      ).bind(effectiveTenant, digestScope.userId, ...wsIn.binds).all()
      : emptyAll(),

    wsIn.binds.length
      ? env.DB.prepare(
        `SELECT project_name, status, current_blockers, goals, updated_at
         FROM agentsam_project_context
         WHERE tenant_id = ?
           AND ${wsIn.clause}
           AND status IN ('active','blocked_live_platform_regression')
           AND project_type != 'cms_site'
         ORDER BY updated_at DESC LIMIT 6`
      ).bind(effectiveTenant, ...wsIn.binds).all()
      : emptyAll(),

    wsIn.binds.length
      ? safe(env.DB.prepare(
        `SELECT COUNT(*) as total_runs,
                ROUND(SUM(cost_usd), 4) as total_cost,
                SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed,
                SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) as stuck_running
         FROM agentsam_agent_run
         WHERE ${wsIn.clause}
           AND created_at_unix > unixepoch('now','-24 hours')`
      ).bind(...wsIn.binds).first())
      : emptyFirst(),

    wsIn.binds.length
      ? safe(env.DB.prepare(
        `SELECT ROUND(SUM(cost_usd), 4) as week_cost
         FROM agentsam_agent_run
         WHERE ${wsIn.clause}
           AND created_at_unix > unixepoch('now','-7 days')`
      ).bind(...wsIn.binds).first())
      : emptyFirst(),

    digestScope.userId
      ? env.DB.prepare(
        `SELECT tool_name, COUNT(*) as calls,
                SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as ok,
                SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errors
         FROM agentsam_mcp_tool_execution
         WHERE user_id = ?
           AND COALESCE(created_at_unix, unixepoch(created_at)) > unixepoch('now','-24 hours')
         GROUP BY tool_name ORDER BY calls DESC LIMIT 10`
      ).bind(digestScope.userId).all()
      : emptyAll(),

    wsIn.binds.length
      ? env.DB.prepare(
        `SELECT master_agent_slug, status, subagents_spawned,
                subagents_succeeded, subagents_failed, started_at, completed_at
         FROM agentsam_spawn_job
         WHERE ${wsIn.clause}
         ORDER BY started_at DESC LIMIT 5`
      ).bind(...wsIn.binds).all()
      : emptyAll(),

    safe(env.DB.prepare(
        `SELECT subject, status, to_email, from_email, created_at
         FROM email_logs
         WHERE user_id = ?
           AND datetime(created_at) >= datetime('now', '-24 hours')
         ORDER BY created_at DESC LIMIT 15`
      ).bind(digestScope.userId).all()),

    safe(env.DB.prepare(
        `SELECT channel, subject, status, priority, created_at
         FROM notification_outbox
         WHERE status IN ('pending','queued','failed')
           AND (tenant_id = ? OR user_id = ?)
         ORDER BY created_at DESC LIMIT 10`
      ).bind(effectiveTenant, digestScope.userId).all()),

    snapshotGmailInboxForUser(env, {
      email: owner.email || digestScope.email || undefined,
      userId: owner.userId || digestScope.userId || undefined,
      maxPerAccount: 100,
      searchAnywhere: true,
      hoursBack: 24,
    }),

    effectiveTenant && wsIn.binds.length
        ? d1First(env,
          `SELECT day,
                  MAX(cost_usd) as cost_usd, MAX(ai_calls) as ai_calls,
                  MAX(tool_calls) as tool_calls, MAX(tool_failures) as tool_failures,
                  MAX(deployments) as deployments
           FROM agentsam_usage_rollups_daily
           WHERE tenant_id = ? AND ${wsIn.clause} AND day = ?
           GROUP BY day`,
          effectiveTenant, ...wsIn.binds, today)
        : emptyFirst(),

    effectiveTenant && wsIn.binds.length
        ? d1First(env,
          `SELECT ROUND(SUM(sub.cost_usd), 4) as week_cost,
                  ROUND(AVG(sub.cost_usd), 4) as avg_daily_cost
           FROM (
             SELECT day, MAX(cost_usd) as cost_usd
             FROM agentsam_usage_rollups_daily
             WHERE tenant_id = ? AND ${wsIn.clause}
               AND day >= date(?, '-7 days') AND day < ?
             GROUP BY day
           ) sub`,
          effectiveTenant, ...wsIn.binds, today, today)
        : emptyFirst(),

    wsIn.binds.length
      ? d1All(env,
        `SELECT status, COUNT(*) as cnt
         FROM agentsam_plan_tasks
         WHERE tenant_id = ? AND ${wsIn.clause}
         GROUP BY status`,
        effectiveTenant, ...wsIn.binds)
      : emptyAll(),

    wsIn.binds.length
      ? d1All(env,
        `SELECT COALESCE(project_id, 'unassigned') as project_id, COUNT(*) as open_cnt
         FROM agentsam_todo
         WHERE tenant_id = ? AND ${wsIn.clause}
           AND status NOT IN ('done','completed','cancelled')
         GROUP BY COALESCE(project_id, 'unassigned')
         ORDER BY open_cnt DESC LIMIT 12`,
        effectiveTenant, ...wsIn.binds)
      : emptyAll(),

    wsIn.binds.length
      ? d1All(env,
        `SELECT id, title, start_datetime, end_datetime, event_type
         FROM calendar_events
         WHERE ${wsIn.clause}
           AND date(start_datetime) BETWEEN date('now') AND date('now', '+1 day')
         ORDER BY start_datetime ASC LIMIT 12`,
        ...wsIn.binds)
      : emptyAll(),

    wsIn.binds.length
      ? d1All(env,
        `SELECT action, COUNT(*) as cnt
         FROM task_activity
         WHERE tenant_id = ? AND ${wsIn.clause}
           AND created_at > unixepoch('now', '-24 hours')
         GROUP BY action ORDER BY cnt DESC`,
        effectiveTenant, ...wsIn.binds)
      : emptyAll(),

    d1First(env,
        `SELECT ROUND(COALESCE(SUM(
           CASE
             WHEN ended_at IS NULL THEN MAX(0, (unixepoch() - COALESCE(started_at, created_at))) / 60.0
             ELSE COALESCE(hours * 60, MAX(0, ended_at - COALESCE(started_at, created_at)) / 60.0)
           END
         ), 0)) as minutes
         FROM time_entries
         WHERE user_id = ?
           AND date(datetime(COALESCE(started_at, created_at), 'unixepoch')) = date('now')`,
        digestScope.userId),
  ]);

  const chronicBlockers = wsIn.binds.length
    ? await d1All(env,
      `SELECT id, title, status, project_id, updated_at
       FROM agentsam_todo
       WHERE tenant_id = ? AND ${wsIn.clause}
         AND status = 'carried'
         AND date(updated_at) <= date('now', '-3 days')
       ORDER BY updated_at ASC LIMIT 8`,
      effectiveTenant, ...wsIn.binds)
    : EMPTY_ALL;

  const agentRunLifetime = wsIn.binds.length
    ? await safe(
        env.DB.prepare(
          `SELECT
             COUNT(*) AS total_all_time,
             SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_all_time,
             SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_all_time,
             SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_all_time,
             SUM(CASE WHEN status IN ('queued','running','stuck') OR status IS NULL THEN 1 ELSE 0 END) AS open_or_stuck
           FROM agentsam_agent_run
           WHERE ${wsIn.clause}`,
        )
          .bind(...wsIn.binds)
          .first(),
      )
    : null;

  let escalationsRecent = EMPTY_ALL;
  try {
    escalationsRecent = wsIn.binds.length
      ? await env.DB.prepare(
          `SELECT id, kind, reason, mode, to_route_key, status, created_at_unix, workspace_id
             FROM agentsam_escalation
            WHERE ${wsIn.clause}
              AND created_at_unix > unixepoch('now', '-7 days')
            ORDER BY created_at_unix DESC
            LIMIT 12`,
        )
          .bind(...wsIn.binds)
          .all()
      : EMPTY_ALL;
  } catch {
    escalationsRecent = EMPTY_ALL;
  }

  const activeBlockers = [];
  for (const row of clientCtxRows?.results || []) {
    if (row?.current_blockers) {
      activeBlockers.push({
        project: row.project_name,
        current_blockers: row.current_blockers,
        status: row.status || null,
      });
    }
  }

  const runs24 = recentRuns || {};
  const lifetime = agentRunLifetime || {};
  const agentCompletion = {
    last_24h: {
      total: Number(runs24.total_runs) || 0,
      completed: Number(runs24.completed) || 0,
      failed: Number(runs24.failed) || 0,
      stuck_running: Number(runs24.stuck_running) || 0,
    },
    all_time: {
      total: Number(lifetime.total_all_time) || 0,
      completed: Number(lifetime.completed_all_time) || 0,
      failed: Number(lifetime.failed_all_time) || 0,
      cancelled: Number(lifetime.cancelled_all_time) || 0,
      open_or_stuck: Number(lifetime.open_or_stuck) || 0,
    },
    note:
      'Use created_at_unix for day windows. Report completion rates from counts above only. Stale non-terminal rows may exist; a 35m sweeper marks long-running as failed — do not invent a missing DO teardown narrative.',
  };

  return {
    digestScope,
    memoryRows,
    clientCtxRows,
    recentRuns,
    runCostToday,
    mcpActivity,
    spawnJobs,
    emailLogs24h,
    pendingNotifications,
    gmailSnapshot,
    usageToday,
    usage7d,
    planTasks,
    openTodosByProject,
    calendarUpcoming,
    taskActivityRecent,
    trackedTimeToday,
    chronicBlockers,
    activeBlockers,
    agentCompletion,
    escalationsRecent,
  };
}

/** @param {*} env @param {{ modelKey: string, systemInstruction: string, userText: string, stage: string, maxOutputTokens?: number, temperature?: number, json?: boolean }} opts */
export async function generateWithGemini(env, opts) {
  const apiKey = geminiApiKey(env);
  if (!apiKey) {
    throw new DailyPlanError('GOOGLE_AI_API_KEY / GEMINI_API_KEY not configured', {
      stage: opts.stage,
      model: opts.modelKey,
    });
  }

  const modelKey = String(opts.modelKey || '').trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelKey}:generateContent?key=${apiKey}`;
  const generationConfig = {
    ...buildGeminiGenerationConfig(
      { mode: 'ask', taskType: opts.taskType || 'summary' },
      { modelId: modelKey, maxOutputTokens: opts.maxOutputTokens ?? 900 },
    ),
  };
  if (opts.json) generationConfig.responseMimeType = 'application/json';

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: opts.systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text: opts.userText }] }],
      generationConfig,
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.error?.message || `HTTP ${res.status}`;
    throw new DailyPlanError(`Gemini ${modelKey} failed: ${detail}`, {
      stage: opts.stage,
      model: modelKey,
      detail,
    });
  }

  const text = parseGeminiResponseText(data);
  if (!text) {
    throw new DailyPlanError(`Gemini ${modelKey} returned empty content`, {
      stage: opts.stage,
      model: modelKey,
    });
  }
  return text;
}

/**
 * Same contract as generateWithGemini, but retries once with a short backoff
 * before giving up. Used for the daily-memory Pro synthesis calls, where a
 * single call covers the whole digest and a bare failure means a silent miss.
 * @param {*} env @param {Parameters<typeof generateWithGemini>[1]} opts @param {number} [retries]
 */
export async function generateWithGeminiRetry(env, opts, retries = 1) {
  try {
    return await generateWithGemini(env, opts);
  } catch (err) {
    if (retries <= 0) throw err;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return generateWithGeminiRetry(env, opts, retries - 1);
  }
}

/** @param {*} env @param {object[]} emails */
export async function triageInboxForDailyPlan(env, emails) {
  if (!Array.isArray(emails) || !emails.length) {
    return { items: [], summary: 'No inbox messages in last 48h from connected Gmail accounts.' };
  }

  const raw = await generateWithGemini(env, {
    modelKey: 'gemini-3.5-flash-lite',
    stage: 'inbox_triage',
    systemInstruction:
      'You triage email for a solo founder. Return JSON only: {"summary":"one line","items":[{"id":"","account":"","urgency":"critical|high|normal|low|fyi","category":"primary|updates|action|fyi","needs_reply":true,"suggested_action":"archive|reply|schedule|ignore","reason":""}]}. Max 20 items. No emojis.',
    userText: `Inbox batch (${emails.length}):\n${JSON.stringify(emails.slice(0, 40))}`,
    maxOutputTokens: 2048,
    json: true,
  });

  try {
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    return JSON.parse(cleaned);
  } catch (e) {
    throw new DailyPlanError(`Inbox triage JSON parse failed: ${e?.message}`, {
      stage: 'inbox_triage_parse',
      model: 'gemini-3.5-flash-lite',
      detail: raw.slice(0, 400),
    });
  }
}

/** @param {*} env @param {{ ok: boolean, title: string, body: string, userId?: string|null, tenantId?: string|null, tag?: string }} alert @param {ExecutionContext|null} ctx */
export async function alertDailyPlan(env, alert, ctx) {
  const pushPayload = {
    title: alert.title,
    body: alert.body.slice(0, 240),
    url: alert.ok ? '/dashboard/agent' : '/dashboard/mail',
    tag: alert.tag || 'daily-plan',
  };

  const run = async () => {
    if (alert.userId) {
      await sendWebPushToUser(env, {
        userId: alert.userId,
        tenantId: alert.tenantId || undefined,
        ...pushPayload,
      }).catch((e) => console.warn('[daily-plan] push', e?.message));
    } else {
      const { broadcastWebPushToActiveSubscriptions } =
        await import('../identity/web-push-runtime.js');
      await broadcastWebPushToActiveSubscriptions(env, pushPayload).catch((e) =>
        console.warn('[daily-plan] push broadcast', e?.message),
      );
    }

    if (!alert.ok) {
      await notifySam(env, {
        subject: alert.title,
        body: alert.body,
        category: 'daily_plan_failure',
      }, null);
    }
  };

  if (ctx?.waitUntil) ctx.waitUntil(run());
  else await run();
}
