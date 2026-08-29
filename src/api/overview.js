/**
 * API Service: Overview & Analytics
 * Handles activity strips, deployment history, and stats.
 */
import { getAuthUser, jsonResponse } from '../core/auth.js';
import { handleOverviewDashboardBundle } from './overview-bundle.js';
import { sumUserHours } from '../core/time-tracking-spine.js';

/** @param {import('@cloudflare/workers-types').D1Database} db */
async function pragmaColumnSet(db, tableName) {
  const safe = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(String(tableName || '')) ? String(tableName) : '';
  if (!safe || !db) return new Set();
  try {
    const { results } = await db.prepare(`PRAGMA table_info(${safe})`).all();
    return new Set((results || []).map((r) => String(r.name || '').toLowerCase()));
  } catch {
    return new Set();
  }
}

/**
 * CI/CD pipeline rows for overview + worker (schema-safe via PRAGMA).
 * @param {{ DB?: import('@cloudflare/workers-types').D1Database }} env
 */
export async function fetchCicdPipelineRunsForOverview(env) {
  const db = env?.DB;
  if (!db) return [];

  const pCols = await pragmaColumnSet(db, 'cicd_pipeline_runs');
  if (!pCols.size) return [];

  const runKey = pCols.has('run_id') ? 'run_id' : pCols.has('id') ? 'id' : null;
  if (!runKey) return [];

  const pk = `p.${runKey}`;
  const envSel = pCols.has('env')
    ? `p.env AS environment`
    : pCols.has('environment')
      ? `p.environment AS environment`
      : `NULL AS environment`;
  const branchSel = pCols.has('branch') ? `p.branch` : `NULL`;
  const statusSel = pCols.has('status') ? `p.status` : `NULL`;
  const startedSel = pCols.has('triggered_at')
    ? `p.triggered_at AS started_at`
    : pCols.has('started_at')
      ? `p.started_at AS started_at`
      : `NULL AS started_at`;
  const completedSel = pCols.has('completed_at') ? `p.completed_at` : `NULL`;
  const notesSel = pCols.has('notes') ? `p.notes` : `NULL`;

  const gCols = await pragmaColumnSet(db, 'cicd_github_runs');
  const sCols = await pragmaColumnSet(db, 'cicd_run_steps');

  const joinG =
    gCols.size && gCols.has('run_id')
      ? `LEFT JOIN cicd_github_runs g ON g.run_id = 'gh_' || substr(${pk}, 6)`
      : ``;

  const joinS = sCols.size && sCols.has('run_id') ? `LEFT JOIN cicd_run_steps s ON s.run_id = ${pk}` : ``;

  const wf = gCols.has('workflow_name') ? `g.workflow_name` : `NULL`;
  const cm = gCols.has('commit_message') ? `g.commit_message` : `NULL`;
  const dm = gCols.has('duration_ms') ? `g.duration_ms` : `NULL`;

  const stepPass =
    sCols.has('status') ? `COUNT(CASE WHEN s.status = 'pass' THEN 1 END)` : `0`;
  const stepFail =
    sCols.has('status') ? `COUNT(CASE WHEN s.status = 'fail' THEN 1 END)` : `0`;
  const stepTot =
    sCols.has('id') ? `COUNT(s.id)` : sCols.size ? `COUNT(*)` : `0`;

  // cicd_pipeline_runs may be a VIEW — SQLite does not allow p.rowid on all views.
  const orderTsParts = [
    pCols.has('updated_at') ? 'p.updated_at' : null,
    pCols.has('completed_at') ? 'p.completed_at' : null,
    pCols.has('started_at') ? 'p.started_at' : null,
    pCols.has('created_at') ? 'p.created_at' : null,
  ].filter(Boolean);
  const orderByClause =
    orderTsParts.length > 0
      ? `ORDER BY COALESCE(${orderTsParts.join(', ')}) DESC`
      : `ORDER BY ${pk} DESC`;

  const sql = `
    SELECT
      ${pk} AS id,
      ${envSel},
      ${statusSel},
      ${branchSel},
      ${startedSel},
      ${completedSel},
      ${notesSel},
      ${wf} AS workflow_name,
      ${cm} AS commit_message,
      ${dm} AS duration_ms,
      ${stepPass} AS steps_passed,
      ${stepFail} AS steps_failed,
      ${stepTot} AS steps_total
    FROM cicd_pipeline_runs p
    ${joinG}
    ${joinS}
    GROUP BY ${pk}
    ${orderByClause}
    LIMIT 10
  `;

  try {
    const { results } = await db.prepare(sql).all();
    return results || [];
  } catch (e) {
    console.warn('[overview/deployments] cicd_pipeline_runs', e?.message || e);
    return [];
  }
}

export async function handleOverviewApi(request, url, env, ctx) {
  const pathLower = url.pathname.toLowerCase().replace(/\/$/, '') || '/';

  const authUser = await getAuthUser(request, env);
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);

  try {
    if (pathLower === '/api/overview/dashboard-bundle') return handleOverviewDashboardBundle(authUser, env, url);
    if (pathLower === '/api/overview/activity-strip') return handleOverviewActivityStrip(authUser, env);
    if (pathLower === '/api/overview/agent-activity') return handleOverviewAgentActivity(env);
    if (pathLower === '/api/overview/commands-workflows') return handleOverviewCommandsWorkflows(env);
    if (pathLower === '/api/overview/kpi-strip') return handleOverviewKpiStrip(authUser, env);
    if (pathLower === '/api/overview/goals-launch') return handleOverviewGoalsLaunch(authUser, env);
    if (pathLower === '/api/overview/deployments') return handleOverviewDeployments(env);
    if (pathLower === '/api/overview/stats') return handleOverviewStats(env);
    return jsonResponse({ error: 'Overview route not found' }, 404);
  } catch (e) {
    return jsonResponse({ error: String(e.message || e) }, 500);
  }
}

async function handleOverviewAgentActivity(env) {
  // last 24h grouped by event_type
  const since = Math.floor(Date.now() / 1000) - 24 * 3600;
  try {
    const { results } = await env.DB.prepare(
      `SELECT COALESCE(event_type,'unknown') as type,
              COUNT(*) as count,
              COALESCE(SUM(COALESCE(cost_usd,0)),0) as cost_usd
       FROM agentsam_usage_events
       WHERE COALESCE(created_at,0) >= ?
       GROUP BY COALESCE(event_type,'unknown')
       ORDER BY count DESC`
    ).bind(since).all();

    const events = (results || []).map((r) => ({
      type: String(r.type || 'unknown'),
      count: Number(r.count || 0),
      cost: Number(r.cost_usd || 0),
    }));

    const sessions = events.reduce((acc, e) => acc + (e.type.toLowerCase().includes('session') ? e.count : 0), 0);
    const llm_calls = events.reduce((acc, e) => acc + (e.type.toLowerCase().includes('llm') || e.type.toLowerCase().includes('chat') ? e.count : 0), 0);
    const total_cost_usd = events.reduce((acc, e) => acc + (Number(e.cost) || 0), 0);

    let top_model = null;
    try {
      const row = await env.DB.prepare(
        `SELECT COALESCE(NULLIF(model_key,''), NULLIF(model,''), '') AS m, COUNT(*) AS c
         FROM agentsam_usage_events
         WHERE COALESCE(created_at,0) >= ?
         GROUP BY COALESCE(NULLIF(model_key,''), NULLIF(model,''), '')
         ORDER BY c DESC
         LIMIT 1`
      ).bind(since).first();
      if (row?.m && String(row.m).trim()) top_model = String(row.m).trim();
    } catch (_) {}

    return jsonResponse({
      sessions,
      llm_calls,
      top_model,
      total_cost_usd: Math.round(total_cost_usd * 10000) / 10000,
      events,
    });
  } catch (e) {
    // If table doesn't exist yet, return safe empty payload (do not 500).
    return jsonResponse({ sessions: 0, llm_calls: 0, top_model: null, total_cost_usd: 0, events: [] });
  }
}

async function handleOverviewCommandsWorkflows(env) {
  // last 7d
  const since = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
  try {
    const totalRow = await env.DB.prepare(
      `SELECT COUNT(*) as c
       FROM agentsam_command_run
       WHERE COALESCE(created_at,0) >= ?`
    ).bind(since).first().catch(() => ({ c: 0 }));

    const byIntentRes = await env.DB.prepare(
      `SELECT COALESCE(intent,'unknown') as intent,
              COUNT(*) as count,
              AVG(CASE WHEN LOWER(COALESCE(status,'')) IN ('success','ok','done','completed') THEN 1.0 ELSE 0.0 END) as success_rate
       FROM agentsam_command_run
       WHERE COALESCE(created_at,0) >= ?
       GROUP BY COALESCE(intent,'unknown')
       ORDER BY count DESC
       LIMIT 50`
    ).bind(since).all().catch(() => ({ results: [] }));

    const recentRes = await env.DB.prepare(
      `SELECT id, model, intent, status, error_message, created_at
       FROM agentsam_command_run
       WHERE COALESCE(created_at,0) >= ?
       ORDER BY created_at DESC
       LIMIT 5`
    ).bind(since).all().catch(() => ({ results: [] }));

    return jsonResponse({
      total: Number(totalRow?.c || 0),
      by_intent: (byIntentRes.results || []).map((r) => ({
        intent: String(r.intent || 'unknown'),
        count: Number(r.count || 0),
        success_rate: Math.round((Number(r.success_rate || 0) || 0) * 10000) / 10000,
      })),
      recent: (recentRes.results || []).map((r) => ({
        id: r.id ?? null,
        model: r.model ?? null,
        intent: r.intent ?? null,
        status: r.status ?? null,
        error_message: r.error_message ?? null,
        created_at: r.created_at ?? null,
      })),
    });
  } catch (_) {
    return jsonResponse({ total: 0, by_intent: [], recent: [] });
  }
}

async function handleOverviewKpiStrip(authUser, env) {
  // Alias of "activity-strip" but with explicit KPI keys for today's strip.
  // This endpoint should never hard-fail; return zeros if tables are missing.
  try {
    const userId = authUser?.id || '';
    const today = new Date().toISOString().slice(0, 10);

    const safeFirst = async (q, ...binds) => {
      try { return await env.DB.prepare(q).bind(...binds).first(); } catch { return null; }
    };

    const [
      apiCallsRow,
      toolCallsRow,
      mcpCallsRow,
      deploymentsRow,
    ] = await Promise.all([
      safeFirst(`SELECT COUNT(*) as c FROM worker_analytics WHERE date(created_at) = date(?)`, today),
      safeFirst(`SELECT COUNT(*) as c FROM agentsam_mcp_tool_execution WHERE date(created_at) = date(?)`, today),
      safeFirst(
        `SELECT COUNT(*) as c FROM agentsam_usage_events WHERE date(datetime(created_at, 'unixepoch')) = date(?)`,
        today,
      ),
      safeFirst(`SELECT COUNT(*) as c FROM deployments WHERE date(timestamp) = date(?) AND status = 'success'`, today),
    ]);

    return jsonResponse({
      api_calls: Number(apiCallsRow?.c || 0),
      tool_calls: Number(toolCallsRow?.c || 0),
      mcp_calls: Number(mcpCallsRow?.c || 0),
      deployments: Number(deploymentsRow?.c || 0),
      user_id: userId || null,
    });
  } catch (_) {
    return jsonResponse({ api_calls: 0, tool_calls: 0, mcp_calls: 0, deployments: 0 });
  }
}

async function handleOverviewGoalsLaunch(authUser, env) {
  // Return empty arrays if no data or table not present.
  const tenantId = String(authUser?.tenant_id || '').trim();
  if (!tenantId) return jsonResponse({ goals: [], launch_milestones: [] });
  try {
    const goals = await env.DB.prepare(
      `SELECT * FROM goals WHERE tenant_id = ? ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 200`
    ).bind(tenantId).all().catch(() => ({ results: [] }));
    const milestones = await env.DB.prepare(
      `SELECT * FROM launch_milestones WHERE tenant_id = ? ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 200`
    ).bind(tenantId).all().catch(() => ({ results: [] }));
    return jsonResponse({ goals: goals.results || [], launch_milestones: milestones.results || [] });
  } catch (_) {
    return jsonResponse({ goals: [], launch_milestones: [] });
  }
}

async function handleOverviewActivityStrip(authUser, env) {
  const userId = authUser.id || 'anonymous';
  const safe = (p) => (p ? p.catch(() => null) : Promise.resolve(null));
  const num = (r, k) => (r != null && r[k] != null ? Number(r[k]) : r?.c != null ? Number(r.c) : 0);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const [
    deployCountWeek,
    agentCallsWeek,
    taskCountWeek,
    hoursThisWeek,
    hoursToday,
    dailyRows,
    projectsActiveRow,
    projectsTopRows,
  ] = await Promise.all([
    safe(env.DB.prepare(
      `SELECT COUNT(*) as c FROM deployments WHERE date(timestamp) >= date(?) AND status = 'success'`
    ).bind(sevenDaysAgo).first()),
    safe(env.DB.prepare(
      `SELECT COUNT(*) as c FROM agentsam_usage_events WHERE created_at >= unixepoch(?)`
    ).bind(sevenDaysAgo).first()),
    safe(env.DB.prepare(
      `SELECT COUNT(*) as c FROM cicd_pipeline_runs WHERE created_at >= unixepoch(?) AND status = 'success'`
    ).bind(sevenDaysAgo).first()),
    sumUserHours(env, userId, { weekStart: true }),
    sumUserHours(env, userId, { dayStart: true }),
    safe(env.DB.prepare(
      `SELECT date(datetime(COALESCE(started_at, created_at), 'unixepoch')) as d,
              ROUND(SUM(
                CASE
                  WHEN ended_at IS NULL THEN MAX(0, (unixepoch() - COALESCE(started_at, created_at))) / 3600.0
                  ELSE COALESCE(hours, MAX(0, ended_at - COALESCE(started_at, created_at)) / 3600.0)
                END
              ), 2) as h
       FROM time_entries
       WHERE user_id = ?
         AND COALESCE(started_at, created_at) >= unixepoch(date('now','weekday 1'))
       GROUP BY date(datetime(COALESCE(started_at, created_at), 'unixepoch'))
       ORDER BY d ASC`
    ).bind(userId).all()),
    safe(env.DB.prepare(
      `SELECT COUNT(*) as c FROM projects WHERE status NOT IN ('archived','maintenance')`
    ).first()),
    safe(env.DB.prepare(
      `SELECT name, status, priority FROM projects WHERE status NOT IN ('archived') ORDER BY COALESCE(priority,0) DESC, created_at DESC LIMIT 4`
    ).all()),
  ]);

  return jsonResponse({
    weekly_activity: {
      deploys: num(deployCountWeek),
      tasks_completed: num(taskCountWeek),
      agent_calls: num(agentCallsWeek),
    },
    worked_this_week: {
      hours_this_week: hoursThisWeek,
      hours_today: hoursToday,
    },
    projects: {
      active: num(projectsActiveRow),
      top: projectsTopRows?.results || [],
    },
  });
}

async function handleOverviewDeployments(env) {
  const { results: deployments } = await env.DB.prepare(
    `SELECT worker_name, environment, status,
            COALESCE(timestamp_unix, CAST(strftime('%s', timestamp) AS INTEGER)) AS deployed_at_unix,
            timestamp AS deployed_at, notes AS deployment_notes, git_hash, id
     FROM deployments
     ORDER BY COALESCE(timestamp_unix, 0) DESC, timestamp DESC
     LIMIT 20`,
  ).all();
  const cicd = await fetchCicdPipelineRunsForOverview(env);
  return jsonResponse({ deployments: deployments || [], cicd_runs: cicd || [] });
}

async function handleOverviewStats(env) {
  const [tasks, deploys] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) as c FROM cicd_pipeline_runs WHERE status = 'success'`).first(),
    env.DB.prepare(`SELECT COUNT(*) as c FROM deployments WHERE status = 'success'`).first(),
  ]);
  return jsonResponse({
    tasks_completed: tasks?.c || 0,
    deploys_total: deploys?.c || 0,
  });
}
