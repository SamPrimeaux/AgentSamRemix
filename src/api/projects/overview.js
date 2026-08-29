/**
 * Projects API — peeled from monolithic projects.js (mechanical).
 */
import { jsonResponse } from '../../core/auth.js';
import { resolveWorkspaceBindings } from '../../../backend/identity/workspace/agentsam-workspace.js';
import { readProjectGithubRepoFromRow } from '../../../backend/agentsam/codebase/project-github-repo.js';
import {
  PROJECTS_OVERVIEW_CACHE,
  projectsJsonResponse,
  safeJsonArray,
  parseMetadataObject,
  extractCoverImageUrl,
  priorityToLabel,
  mapDbStatusToUi,
  assertWorkspaceAllowed,
  fetchPlanTasksForTenant,
  indexTasksByProject,
  fetchQualityByProject,
  fetchOpenIssuesByProject,
  computeHealth,
  attachCodeIndexProgressToProjects,
  fetchCollaboratorProjectRows,
  mergeProjectRowsById,
  buildProjectWhereClause,
} from './helpers.js';
import { mergeWorkspaceProjectRows } from './crud.js';

export async function handleOverview(request, url, env, authUser, workspaceId) {
  try {
  const tenantId = authUser.tenant_id ? String(authUser.tenant_id) : null;

  if (workspaceId && !(await assertWorkspaceAllowed(env, workspaceId, authUser?.id))) {
    return jsonResponse({ ok: false, error: 'workspace_not_allowed' }, 403);
  }

  const { sql: whereSql, binds: whereBinds } = buildProjectWhereClause(workspaceId, tenantId);

  let projectRows = [];
  try {
    const { results } = await env.DB.prepare(`SELECT p.* FROM projects p WHERE ${whereSql} ORDER BY COALESCE(p.priority,0) DESC, p.name ASC`).bind(...whereBinds).all();
    projectRows = mergeProjectRowsById(results || [], await fetchCollaboratorProjectRows(env, authUser));
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e.message || e) }, 500);
  }

  const { projectRows: mergedRows } = await mergeWorkspaceProjectRows(env, workspaceId, projectRows);
  projectRows = mergedRows;

  const projectIds = projectRows.map((r) => String(r.id));

  const [planTasks, qualityMap, issuesMap, goalsRows] = await Promise.all([
    tenantId ? fetchPlanTasksForTenant(env.DB, tenantId, workspaceId) : Promise.resolve([]),
    fetchQualityByProject(env.DB, projectIds),
    fetchOpenIssuesByProject(env.DB, projectIds),
    (async () => {
      if (!projectIds.length) return [];
      try {
        const ph = projectIds.map(() => '?').join(',');
        const { results } = await env.DB
          .prepare(
            `SELECT id, project_id, goal_name, status, current_progress_percent, priority, created_at
             FROM project_goals WHERE project_id IN (${ph}) ORDER BY priority DESC LIMIT 80`,
          )
          .bind(...projectIds)
          .all();
        return results || [];
      } catch {
        return [];
      }
    })(),
  ]);

  const taskByProject = indexTasksByProject(planTasks);

  let budgetAllocated = 0;
  try {
    if (workspaceId) {
      const row = await env.DB
        .prepare(`SELECT COALESCE(SUM(budget_usd),0) as v FROM workspace_projects WHERE workspace_id = ?`)
        .bind(workspaceId)
        .first();
      budgetAllocated = Number(row?.v ?? 0);
    }
  } catch {
    /* */
  }

  let budgetBurn = 0;
  try {
    if (workspaceId) {
      const row = await env.DB
        .prepare(
          `SELECT COALESCE(SUM(cost_usd),0) as v FROM agentsam_usage_events
           WHERE workspace_id = ? AND COALESCE(created_at_unix, created_at) >= unixepoch() - 30 * 86400`,
        )
        .bind(workspaceId)
        .first();
      budgetBurn = Number(row?.v ?? 0);
    } else if (tenantId) {
      const row = await env.DB
        .prepare(
          `SELECT COALESCE(SUM(cost_usd),0) as v FROM agentsam_usage_events
           WHERE tenant_id = ? AND COALESCE(created_at_unix, created_at) >= unixepoch() - 30 * 86400`,
        )
        .bind(tenantId)
        .first();
      budgetBurn = Number(row?.v ?? 0);
    }
  } catch {
    /* */
  }

  let thisWeekHours = 0;
  try {
    const weekStart = Math.floor(Date.now() / 1000) - 7 * 86400;
    if (tenantId) {
      const row = await env.DB
        .prepare(
          `SELECT COALESCE(SUM(t.actual_minutes),0) as m
           FROM agentsam_plan_tasks t
           INNER JOIN agentsam_plans pl ON pl.id = t.plan_id
           WHERE pl.tenant_id = ?
             AND t.completed_at IS NOT NULL AND t.completed_at >= ?
             AND ( ? IS NULL OR pl.workspace_id = ? OR pl.workspace_id IS NULL OR pl.workspace_id = '')`,
        )
        .bind(tenantId, weekStart, workspaceId, workspaceId)
        .first();
      thisWeekHours = Math.round((Number(row?.m ?? 0) / 60) * 10) / 10;
    }
  } catch {
    /* */
  }

  /** @type {Record<string, number>} */
  const statusCountsMap = {};
  let activeProjects = 0;
  let healthSum = 0;

  const projects = await attachCodeIndexProgressToProjects(
    env,
    projectRows.map((p) => {
    const id = String(p.id);
    const t = taskByProject[id] || { total: 0, done: 0, blocked: 0, open: 0 };
    const progress = t.total ? Math.round((t.done / t.total) * 100) : 0;
    const passRate = qualityMap[id] || 0;
    const issueC = issuesMap[id] || 0;
    const uiStatus = mapDbStatusToUi(p.status);
    const health = computeHealth({
      passRate,
      blockedCount: t.blocked,
      openIssueCount: issueC,
      estDate: p.estimated_completion_date,
      status: p.status,
    });

    const stKey = String(p.status || 'unknown');
    statusCountsMap[stKey] = (statusCountsMap[stKey] || 0) + 1;

    if (uiStatus !== 'complete') activeProjects += 1;
    healthSum += health;

    const tags = safeJsonArray(p.tags_json, []);
    const budgetTotal = Number(p.budget_tokens) > 0 ? Number(p.budget_tokens) : 0;
    const budgetUsed = Number(p.tokens_used) || 0;

    return {
      id,
      name: p.name,
      client: p.client_name || '',
      client_name: p.client_name || '',
      owner: p.owner_user_id || '',
      stage: p.description ? String(p.description).slice(0, 120) : '',
      description: p.description || '',
      status: uiStatus,
      status_raw: p.status || '',
      priority: priorityToLabel(p.priority),
      priority_num: Number(p.priority) || 0,
      project_type: p.project_type || '',
      progress,
      health,
      budgetUsed: Math.round(budgetUsed),
      budgetTotal: Math.round(budgetTotal) || Math.round(budgetAllocated / Math.max(1, projectIds.length)) || 1,
      budget_allocated_workspace: Math.round(budgetAllocated),
      dueDate: p.estimated_completion_date
        ? new Date(Number(p.estimated_completion_date) * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : p.launch_date || '—',
      lastDeploy: '—',
      activeTasks: t.open + t.blocked,
      blockedTasks: t.blocked,
      completedTasks: t.done,
      totalTasks: t.total,
      openIssueCount: issueC,
      tags,
      workspace_id: p.workspace_id || null,
      tenant_id: p.tenant_id || null,
      chat_project_id: id,
      cover_image_url: extractCoverImageUrl(p, parseMetadataObject(p?.metadata_json)),
      metadata_json: p.metadata_json,
      github_repo: readProjectGithubRepoFromRow(p),
    };
  }),
  );

  const openTasks = planTasks.filter((r) => {
    const st = String(r.status || '').toLowerCase();
    return st !== 'done' && st !== 'complete';
  }).length;

  const blockedTasks = planTasks.filter((r) => String(r.status || '').toLowerCase() === 'blocked').length;

  const avgHealth = projects.length ? Math.round(healthSum / projects.length) : 0;

  const status_counts = Object.entries(statusCountsMap).map(([status, count]) => ({ status, count }));

  const categoryMix = {};
  for (const row of planTasks) {
    const c = String(row.priority || 'P1');
    categoryMix[c] = (categoryMix[c] || 0) + 1;
  }
  const totalCat = Object.values(categoryMix).reduce((a, b) => a + b, 0) || 1;
  const workload_mix = Object.entries(categoryMix).map(([name, count]) => ({
    name,
    value: Math.round((count / totalCat) * 1000) / 10,
  }));

  const milestones = (goalsRows || []).slice(0, 20).map((g) => {
    const milestoneDateRaw = g.target_date || g.due_date || g.deadline || g.created_at;
    return {
      id: String(g.id),
      projectId: String(g.project_id),
      title: g.goal_name || 'Goal',
      date: milestoneDateRaw
        ? new Date(Number(milestoneDateRaw) * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : '—',
      status: ['complete', 'completed', 'done'].includes(String(g.status || '').toLowerCase())
        ? 'done'
        : String(g.status || '').toLowerCase() === 'in_progress' || Number(g.current_progress_percent) >= 50
          ? 'current'
          : Number(g.current_progress_percent) >= 25
            ? 'upcoming'
            : 'risk',
    };
  });

  const velocity_week = [];
  const burn_week = [];
  try {
    for (let i = 6; i >= 0; i -= 1) {
      const dayStart = Math.floor(Date.now() / 1000) - i * 86400;
      const dayEnd = dayStart + 86400;
      const label = new Date(dayStart * 1000).toLocaleDateString('en-US', { weekday: 'short' });
      let completed = 0;
      let added = 0;
      let blocked = 0;
      if (tenantId) {
        const c1 = await env.DB
          .prepare(
            `SELECT COUNT(*) as c FROM agentsam_plan_tasks t
             INNER JOIN agentsam_plans pl ON pl.id = t.plan_id
             WHERE pl.tenant_id = ? AND t.completed_at >= ? AND t.completed_at < ?
             AND ( ? IS NULL OR pl.workspace_id = ? OR pl.workspace_id IS NULL OR pl.workspace_id = '')`,
          )
          .bind(tenantId, dayStart, dayEnd, workspaceId, workspaceId)
          .first();
        completed = Number(c1?.c ?? 0);
        const c2 = await env.DB
          .prepare(
            `SELECT COUNT(*) as c FROM agentsam_plan_tasks t
             INNER JOIN agentsam_plans pl ON pl.id = t.plan_id
             WHERE pl.tenant_id = ? AND t.created_at >= ? AND t.created_at < ?
             AND ( ? IS NULL OR pl.workspace_id = ? OR pl.workspace_id IS NULL OR pl.workspace_id = '')`,
          )
          .bind(tenantId, dayStart, dayEnd, workspaceId, workspaceId)
          .first();
        added = Number(c2?.c ?? 0);
        const c3 = await env.DB
          .prepare(
            `SELECT COUNT(*) as c FROM agentsam_plan_tasks t
             INNER JOIN agentsam_plans pl ON pl.id = t.plan_id
             WHERE pl.tenant_id = ? AND LOWER(t.status) = 'blocked' AND t.created_at >= ? AND t.created_at < ?
             AND ( ? IS NULL OR pl.workspace_id = ? OR pl.workspace_id IS NULL OR pl.workspace_id = '')`,
          )
          .bind(tenantId, dayStart, dayEnd, workspaceId, workspaceId)
          .first();
        blocked = Number(c3?.c ?? 0);
      }
      velocity_week.push({ day: label, completed, added, blocked });
    }
  } catch {
    for (let i = 6; i >= 0; i -= 1) {
      velocity_week.push({ day: '?', completed: 0, added: 0, blocked: 0 });
    }
  }

  try {
    for (let i = 6; i >= 0; i -= 1) {
      const dayStart = Math.floor(Date.now() / 1000) - i * 86400;
      const dayEnd = dayStart + 86400;
      const label = new Date(dayStart * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      let planned = 0;
      let actual = 0;
      if (workspaceId) {
        const r1 = await env.DB
          .prepare(
            `SELECT COALESCE(SUM(cost_usd),0) as v FROM agentsam_usage_events
             WHERE workspace_id = ? AND COALESCE(created_at_unix, created_at) >= ? AND COALESCE(created_at_unix, created_at) < ?`,
          )
          .bind(workspaceId, dayStart, dayEnd)
          .first();
        actual = Math.round(Number(r1?.v ?? 0) * 1000) / 1000;
      } else if (tenantId) {
        const r1 = await env.DB
          .prepare(
            `SELECT COALESCE(SUM(cost_usd),0) as v FROM agentsam_usage_events
             WHERE tenant_id = ? AND COALESCE(created_at_unix, created_at) >= ? AND COALESCE(created_at_unix, created_at) < ?`,
          )
          .bind(tenantId, dayStart, dayEnd)
          .first();
        actual = Math.round(Number(r1?.v ?? 0) * 1000) / 1000;
      }
      planned = Math.round(actual * 1.08 * 1000) / 1000;
      burn_week.push({ date: label, planned, actual });
    }
  } catch {
    /* */
  }

  const priority_tasks = planTasks.slice(0, 40).map((t) => {
    let projectId = '';
    const keys = safeJsonArray(t.linked_project_keys, []);
    if (keys[0]) projectId = String(keys[0]);
    return {
      id: String(t.id),
      title: t.title || 'Task',
      projectId,
      owner: '—',
      status: String(t.status || 'todo').toLowerCase(),
      priority: ['P0', 'P1', 'P2', 'P3'].includes(String(t.priority))
        ? String(t.priority)
        : Number(t.priority) === 0
          ? 'P0'
          : Number(t.priority) === 1
            ? 'P1'
            : Number(t.priority) === 2
              ? 'P2'
              : 'P3',
      due: '—',
      estimateHours: Number(t.actual_minutes || 0) / 60 || 0,
    };
  });

  const kpis = {
    active_projects: activeProjects,
    open_tasks: openTasks,
    blocked: blockedTasks,
    avg_health: avgHealth,
    budget_burn: Math.round(budgetBurn * 100) / 100,
    budget_allocated: Math.round(budgetAllocated * 100) / 100,
    this_week_hours: thisWeekHours,
  };

  return projectsJsonResponse(
    {
      ok: true,
      kpis,
      projects,
      milestones,
      workload_mix,
      status_counts,
      velocity_week,
      burn_week,
      priority_tasks,
      updated_at: new Date().toISOString(),
    },
    200,
    PROJECTS_OVERVIEW_CACHE,
  );
  } catch (e) {
    console.warn('[projects/overview]', e?.message ?? e);
    return jsonResponse({ ok: false, error: String(e?.message || e).slice(0, 500) }, 500);
  }
}
