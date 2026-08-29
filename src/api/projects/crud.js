/**
 * Projects API — peeled from monolithic projects.js (mechanical).
 */
import { jsonResponse } from '../../core/auth.js';
import { withD1Retry } from '../../core/d1-retry.js';
import { insertProjectCost, listProjectCosts, summarizeProjectCosts } from '../../core/project-costs.js';
import { readProjectGithubRepoFromRow } from '../../../backend/agentsam/codebase/project-github-repo.js';
import {
  projectsJsonResponse,
  safeJsonArray,
  parseMetadataObject,
  extractCoverImageUrl,
  priorityToLabel,
  VALID_PROJECT_TYPES,
  VALID_PROJECT_STATUSES,
  normalizeEnum,
  mirrorProjectWrite,
  assertWorkspaceAllowed,
  buildProjectWhereClause,
  attachCodeIndexProgressToProjects,
  assertProjectAccess,
  fetchCollaboratorProjectRows,
  mergeProjectRowsById,
} from './helpers.js';
import { resolveIdentity } from '../../../backend/identity/index.js';

/**
 * projects is SSOT. chat_project_id === projects.id.
 * Cover images live on projects.metadata_json (cover_image_url / cover_url / …).
 * Do not read workspace_projects for list hydration.
 */
export async function mergeWorkspaceProjectRows(_env, _workspaceId, projectRows) {
  const rows = Array.isArray(projectRows) ? [...projectRows] : [];
  rows.sort(
    (a, b) =>
      (Number(b.priority) || 0) - (Number(a.priority) || 0) ||
      String(a.name || '').localeCompare(String(b.name || '')),
  );
  const chatProjectIdByProjectsId = new Map(rows.map((r) => [String(r.id), String(r.id)]));
  return { projectRows: rows, chatProjectIdByProjectsId };
}

export async function attachChatProjectIds(_env, rows) {
  if (!rows?.length) return rows || [];
  return rows.map((row) => ({
    ...row,
    chat_project_id: String(row.id),
  }));
}

export async function handleClientProjectsList(env, authUser) {
  const tenantId = authUser.tenant_id ? String(authUser.tenant_id) : null;
  try {
    let sql = `SELECT id, client_name, project_name, project_id, client_id, status,
                      cloudflare_worker_url, payments_received, total_invoiced, payment_notes
               FROM client_projects
               WHERE COALESCE(status, 'active') NOT IN ('archived', 'cancelled')`;
    const binds = [];
    if (tenantId) {
      sql += ` AND (tenant_id = ? OR tenant_id IS NULL)`;
      binds.push(tenantId);
    }
    sql += ` ORDER BY client_name ASC, project_name ASC`;
    const { results } = await withD1Retry(() => env.DB.prepare(sql).bind(...binds).all());
    return projectsJsonResponse({ ok: true, clients: results || [] }, 200, 'private, no-store');
  } catch (e) {
    console.warn('[projects/clients]', e?.message ?? e);
    return projectsJsonResponse({ ok: true, clients: [] }, 200, 'private, no-store');
  }
}

export async function handleList(request, env, authUser, url, workspaceId) {
  const tenantId = authUser.tenant_id ? String(authUser.tenant_id) : null;
  const scope = String(url.searchParams.get('scope') || '').trim().toLowerCase();
  const includeArchived =
    url.searchParams.get('include_archived') === '1' ||
    url.searchParams.get('include_archived') === 'true';
  let whereSql;
  let whereBinds;
  if (scope === 'tenant' && tenantId) {
    whereSql = 'p.tenant_id = ?';
    whereBinds = [tenantId];
  } else {
    ({ sql: whereSql, binds: whereBinds } = buildProjectWhereClause(workspaceId, tenantId));
  }
  if (!includeArchived) {
    whereSql += ` AND COALESCE(p.status, '') != 'archived'`;
  }
  const clientId = url.searchParams.get('client_id')?.trim() || null;
  const clientWork =
    url.searchParams.get('client_work') === '1' || url.searchParams.get('client_work') === 'true';
  if (clientId) {
    whereSql += ` AND p.client_id = ?`;
    whereBinds.push(clientId);
  } else if (clientWork) {
    // External client work only — never hardcode platform client ids (clients.is_internal).
    whereSql += ` AND p.client_id IS NOT NULL AND TRIM(p.client_id) != ''
      AND EXISTS (
        SELECT 1 FROM clients c
        WHERE c.id = p.client_id AND COALESCE(c.is_internal, 0) = 0
      )`;
  }
  const { results } = await withD1Retry(() =>
    env.DB.prepare(`SELECT p.* FROM projects p WHERE ${whereSql} ORDER BY COALESCE(p.priority,0) DESC, p.name ASC`).bind(...whereBinds).all(),
  );
  const mergedRows = mergeProjectRowsById(results || [], await fetchCollaboratorProjectRows(env, authUser));
  const { projectRows } = await mergeWorkspaceProjectRows(
    env,
    scope === 'tenant' ? null : workspaceId,
    mergedRows,
  );
  const enriched = projectRows.map((p) => {
    const meta = parseMetadataObject(p?.metadata_json);
    const tags = safeJsonArray(p?.tags_json, []);
    const priorityNum = Number(p?.priority) || 0;
    return {
      ...p,
      cover_image_url: extractCoverImageUrl(p, meta),
      priority_num: priorityNum,
      priority_label: priorityToLabel(priorityNum),
      is_pinned: meta.is_pinned === true || tags.includes('pinned'),
      github_repo: readProjectGithubRepoFromRow(p),
    };
  });
  const withIndex = await attachCodeIndexProgressToProjects(env, enriched);
  const projects = await attachChatProjectIds(env, withIndex);
  return projectsJsonResponse({ ok: true, success: true, projects, total: projects.length }, 200, 'private, no-store');
}

export async function handleGetOne(env, authUser, id) {
  const row = await env.DB.prepare(`SELECT * FROM projects WHERE id = ?`).bind(id).first();
  const access = await assertProjectAccess(env, authUser, row);
  if (!access.ok) return jsonResponse({ ok: false, error: access.error }, access.status);
  const [project] = await attachChatProjectIds(env, [row]);
  let cost_summary = null;
  try {
    cost_summary = await summarizeProjectCosts(env, id);
  } catch {
    /* schema may pre-802 */
  }
  return jsonResponse({ ok: true, project: project || row, cost_summary });
}

export async function handleProjectCostsGet(env, authUser, projectId) {
  const row = await env.DB.prepare(`SELECT * FROM projects WHERE id = ?`).bind(projectId).first();
  const access = await assertProjectAccess(env, authUser, row);
  if (!access.ok) return jsonResponse({ ok: false, error: access.error }, access.status);
  const costs = await listProjectCosts(env, projectId);
  const summary = await summarizeProjectCosts(env, projectId);
  return jsonResponse({ ok: true, project_id: projectId, costs, summary });
}

export async function handleProjectCostsPost(request, env, authUser, projectId) {
  const row = await env.DB.prepare(`SELECT * FROM projects WHERE id = ?`).bind(projectId).first();
  const access = await assertProjectAccess(env, authUser, row);
  if (!access.ok) return jsonResponse({ ok: false, error: access.error }, access.status);
  const body = await request.json().catch(() => ({}));
  const costType = String(body.cost_type || body.costType || '').trim();
  if (!costType) return jsonResponse({ ok: false, error: 'cost_type_required' }, 400);

  const metaRaw = body.metadata_json ?? body.metadata;
  let metadata = null;
  if (metaRaw != null) {
    if (typeof metaRaw === 'object' && !Array.isArray(metaRaw)) metadata = metaRaw;
    else if (typeof metaRaw === 'string') {
      try {
        metadata = JSON.parse(metaRaw);
      } catch {
        return jsonResponse({ ok: false, error: 'invalid_metadata_json' }, 400);
      }
    }
  }

  const bodyWorkspaceId = String(body.workspace_id ?? body.workspaceId ?? '').trim() || null;
  const rowWorkspaceId = String(row?.workspace_id ?? '').trim() || null;
  const identity = await resolveIdentity(request, env);
  const authWorkspaceId = identity.workspace?.id || null;
  // Explicit inequality → reject (same shape as approvals-plans tenant checks).
  // No ?? chain that silently picks a winner when two sources disagree.
  if (bodyWorkspaceId && rowWorkspaceId && bodyWorkspaceId !== rowWorkspaceId) {
    return jsonResponse(
      {
        ok: false,
        error: 'workspace_id_mismatch',
        message: 'body.workspace_id must match projects.workspace_id',
        body_workspace_id: bodyWorkspaceId,
        project_workspace_id: rowWorkspaceId,
      },
      400,
    );
  }
  if (bodyWorkspaceId && authWorkspaceId && bodyWorkspaceId !== authWorkspaceId && !rowWorkspaceId) {
    return jsonResponse(
      {
        ok: false,
        error: 'workspace_id_mismatch',
        message: 'body.workspace_id disagrees with auth active workspace',
        body_workspace_id: bodyWorkspaceId,
        auth_workspace_id: authWorkspaceId,
      },
      400,
    );
  }
  // Project row is SSOT when present. Auth active workspace may differ (user switched
  // shell workspace); do not reject — do not let auth override the row either.
  let costWorkspaceId = null;
  let costWorkspaceSource = 'none';
  if (rowWorkspaceId) {
    costWorkspaceId = rowWorkspaceId;
    costWorkspaceSource = 'project_row';
  } else if (bodyWorkspaceId) {
    costWorkspaceId = bodyWorkspaceId;
    costWorkspaceSource = 'request_body';
  } else if (authWorkspaceId) {
    costWorkspaceId = authWorkspaceId;
    costWorkspaceSource = 'auth_active_workspace';
  }
  if (!costWorkspaceId) {
    return jsonResponse({ ok: false, error: 'workspace_id_required' }, 400);
  }
  console.info(
    '[projects] insert_project_cost_workspace',
    JSON.stringify({
      project_id: projectId,
      workspace_id: costWorkspaceId,
      source: costWorkspaceSource,
    }),
  );

  const bodyTenantId = String(body.tenant_id ?? body.tenantId ?? '').trim() || null;
  const rowTenantId = String(row?.tenant_id ?? '').trim() || null;
  const authTenantId = String(authUser?.tenant_id ?? '').trim() || null;
  if (bodyTenantId && rowTenantId && bodyTenantId !== rowTenantId) {
    return jsonResponse(
      {
        ok: false,
        error: 'cost_scope_tenant_mismatch',
        message: 'body tenant must match projects.tenant_id',
        body_tenant: bodyTenantId,
        project_tenant: rowTenantId,
      },
      400,
    );
  }
  const costTenantId = rowTenantId || bodyTenantId || authTenantId || null;

  try {
    const inserted = await insertProjectCost(env, {
      projectId,
      costType,
      amount: body.amount != null ? Number(body.amount) : null,
      description: body.description ?? null,
      workspaceId: costWorkspaceId,
      tenantId: costTenantId,
      userId: body.user_id ?? authUser.id ?? null,
      provider: body.provider ?? null,
      modelKey: body.model_key ?? body.model ?? null,
      taskType: body.task_type ?? body.taskType ?? null,
      inputTokens: body.input_tokens ?? body.inputTokens ?? 0,
      outputTokens: body.output_tokens ?? body.outputTokens ?? 0,
      qualityTier: body.quality_tier ?? body.quality ?? null,
      qualityScore: body.quality_score ?? body.qualityScore ?? null,
      currency: body.currency ?? 'USD',
      sourceKind: body.source_kind ?? body.sourceKind ?? 'manual',
      sourceId: body.source_id ?? body.sourceId ?? null,
      routingArmId: body.routing_arm_id ?? body.routingArmId ?? null,
      imageCount: body.image_count ?? body.imageCount ?? (costType === 'ai_image' ? 1 : 0),
      metadata,
      pricingKind: body.pricing_kind ?? body.pricingKind ?? null,
    });
    return jsonResponse({ ok: true, cost: inserted });
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e?.message || e) }, 500);
  }
}

export async function handlePatch(request, env, authUser, id, ctx) {
  const row = await env.DB.prepare(`SELECT * FROM projects WHERE id = ?`).bind(id).first();
  if (!row) return jsonResponse({ ok: false, error: 'not_found' }, 404);
  if (authUser.tenant_id && row.tenant_id && String(row.tenant_id) !== String(authUser.tenant_id)) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403);
  }
  const body = await request.json().catch(() => ({}));

  if (Object.prototype.hasOwnProperty.call(body, 'project_type')) {
    body.project_type = normalizeEnum(body.project_type, VALID_PROJECT_TYPES, row.project_type || 'dashboard');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    body.status = normalizeEnum(body.status, VALID_PROJECT_STATUSES, row.status || 'discovery');
  }

  if (Object.prototype.hasOwnProperty.call(body, 'is_pinned')) {
    const meta = parseMetadataObject(row.metadata_json);
    meta.is_pinned = body.is_pinned === true;
    body.metadata_json = JSON.stringify(meta);
    let tags = safeJsonArray(row.tags_json, []);
    if (body.is_pinned === true) {
      if (!tags.includes('pinned')) tags = [...tags, 'pinned'];
    } else {
      tags = tags.filter((t) => t !== 'pinned');
    }
    body.tags_json = tags;
    delete body.is_pinned;
  }

  // Cover SSOT: projects.metadata_json.cover_image_url (not workspace_projects).
  if (Object.prototype.hasOwnProperty.call(body, 'cover_image_url')) {
    const meta = parseMetadataObject(
      body.metadata_json != null ? body.metadata_json : row.metadata_json,
    );
    const cover = body.cover_image_url != null ? String(body.cover_image_url).trim() : '';
    if (cover) meta.cover_image_url = cover;
    else delete meta.cover_image_url;
    body.metadata_json = JSON.stringify(meta);
    delete body.cover_image_url;
  }

  const allowed = [
    'name',
    'description',
    'client_name',
    'project_type',
    'status',
    'priority',
    'parent_id',
    'domain',
    'worker_id',
    'd1_databases',
    'r2_buckets',
    'launch_date',
    'accessibility_target',
    'performance_budget',
    'tags_json',
    'metadata_json',
    'workspace_id',
  ];
  const updates = [];
  const binds = [];
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, k)) {
      updates.push(`${k} = ?`);
      if (k === 'tags_json' && Array.isArray(body[k])) binds.push(JSON.stringify(body[k]));
      else binds.push(body[k]);
    }
  }
  if (!updates.length) return jsonResponse({ ok: true, project: row });
  updates.push('updated_at = datetime(\'now\')');
  binds.push(id);
  try {
    await env.DB.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
  } catch (e) {
    return jsonResponse({ ok: false, error: `db_update_failed: ${e?.message || e}` }, 500);
  }
  const next = await env.DB.prepare(`SELECT * FROM projects WHERE id = ?`).bind(id).first();
  const mirror = await mirrorProjectWrite(env, ctx, next, { updatedBy: authUser?.id ?? null });
  return jsonResponse({ ok: true, project: next, supabase_mirror: mirror });
}

export async function handlePost(request, env, authUser, ctx) {
  const body = await request.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  if (!name) return jsonResponse({ ok: false, error: 'name_required' }, 400);

  const requestedWorkspaceId = String(body.workspace_id || body.workspaceId || '').trim();
  const identity = await resolveIdentity(request, env, {
    workspaceIdOverride: requestedWorkspaceId || null,
  });
  const workspaceId = identity.workspace?.id || null;
  if (!workspaceId) return jsonResponse({ ok: false, error: 'workspace_required' }, 400);
  if (requestedWorkspaceId && requestedWorkspaceId !== workspaceId) {
    return jsonResponse({ ok: false, error: 'workspace_id_mismatch' }, 403);
  }

  const tenantId = authUser.tenant_id ? String(authUser.tenant_id) : null;
  if (!tenantId) return jsonResponse({ ok: false, error: 'tenant_required' }, 400);

  if (!(await assertWorkspaceAllowed(env, workspaceId, authUser?.id))) {
    return jsonResponse({ ok: false, error: 'workspace_not_allowed' }, 403);
  }

  const projectId = `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const tags = Array.isArray(body.tags) ? body.tags : [];
  const tagsJson = JSON.stringify(tags);
  const priority = Number(body.priority);
  const prio = Number.isFinite(priority) ? Math.max(0, Math.min(100, Math.floor(priority))) : 50;
  const status = normalizeEnum(body.status, VALID_PROJECT_STATUSES, 'development');
  const projectType = normalizeEnum(body.project_type, VALID_PROJECT_TYPES, 'dashboard');
  const clientName = String(body.client_name || '').trim() || null;
  const description = String(body.description || '').trim() || null;

  const ownerUserId = authUser?.id != null ? String(authUser.id).trim() || null : null;
  const metaObj = parseMetadataObject(body.metadata_json ?? body.metadata);
  const coverIn =
    body.cover_image_url != null
      ? String(body.cover_image_url).trim()
      : metaObj.cover_image_url != null
        ? String(metaObj.cover_image_url).trim()
        : '';
  if (coverIn) metaObj.cover_image_url = coverIn;
  const metadataJson = JSON.stringify(metaObj);

  // Main row insert is the only failure mode that should ever surface as a hard
  // error to the caller — everything below this point is best-effort sidecar
  // bookkeeping and stays wrapped in its own try/catch so a missing/odd table
  // never turns "project created" into a 500.
  try {
    await env.DB
      .prepare(
        `INSERT INTO projects (
          id, name, client_name, project_type, status, tenant_id, description, priority,
          workspace_id, tags_json, metadata_json, domain, worker_id, d1_databases, r2_buckets,
          launch_date, accessibility_target, performance_budget, owner_user_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      )
      .bind(
        projectId,
        name,
        clientName,
        projectType,
        status,
        tenantId,
        description,
        prio,
        workspaceId,
        tagsJson,
        metadataJson,
        body.domain || null,
        body.worker_id || null,
        body.d1_database || body.d1_databases || null,
        body.r2_buckets || null,
        body.target_launch_date || body.launch_date || null,
        body.accessibility_target || null,
        body.performance_budget || null,
        ownerUserId,
      )
      .run();
  } catch (e) {
    return jsonResponse({ ok: false, error: `db_insert_failed: ${e?.message || e}` }, 500);
  }
  // Do not mirror into workspace_projects — projects is SSOT (cover + chat bind).

  // Every project gets exactly one kanban board + the canonical 7-column
  // template, matching what /api/kanban/boards self-heals to on first read.
  // Created eagerly here so the dashboard's Workspace Kanban panel never
  // shows a transient "no board" state for a brand-new project.
  try {
    const boardId = `kb_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const now = Math.floor(Date.now() / 1000);
    await env.DB
      .prepare(
        `INSERT INTO kanban_boards (
           id, tenant_id, workspace_id, project_id, owner_id, name, description, board_type, is_active, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'Project kanban board', 'project', 1, ?, ?)`,
      )
      .bind(boardId, tenantId, workspaceId, projectId, ownerUserId, `${name} Board`, now, now)
      .run();

    const defaultColumns = [
      { name: 'Backlog', position: 0, status: 'backlog' },
      { name: 'To Do', position: 1, status: 'todo' },
      { name: 'In Progress', position: 2, status: 'in_progress' },
      { name: 'Testing', position: 3, status: 'testing' },
      { name: 'Awaiting Approval', position: 4, status: 'awaiting_approval' },
      { name: 'Complete', position: 5, status: 'complete' },
      { name: 'Blocked', position: 6, status: 'blocked' },
    ];
    for (const col of defaultColumns) {
      const columnId = `kcol_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
      await env.DB
        .prepare(
          `INSERT INTO kanban_columns (
             id, tenant_id, board_id, name, position, config_json, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(columnId, tenantId, boardId, col.name, col.position, JSON.stringify({ status: col.status }), now, now)
        .run();
    }
  } catch (e) {
    console.warn('[projects POST kanban_boards]', e?.message || e);
  }

  try {
    const planId = `plan_${projectId.slice(0, 24)}_${Math.random().toString(36).slice(2, 6)}`;
    const today = new Date().toISOString().slice(0, 10);
    const linked = JSON.stringify([projectId]);
    await env.DB
      .prepare(
        `INSERT INTO agentsam_plans (
          id, tenant_id, workspace_id, plan_date, plan_type, title, status,
          linked_project_keys, tasks_total, tasks_done, tasks_blocked, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'feature', ?, 'draft', ?, 0, 0, 0, unixepoch(), unixepoch())`,
      )
      .bind(planId, tenantId, workspaceId, today, `Plan: ${name}`, linked)
      .run();
  } catch (e) {
    console.warn('[projects POST agentsam_plans]', e?.message || e);
  }

  try {
    if (body.seed_goal !== false) {
      const gid = `goal_${Math.random().toString(36).slice(2, 10)}`;
      await env.DB
        .prepare(
          `INSERT INTO project_goals (
            id, project_id, tenant_id, goal_name, goal_description, goal_type, status, priority, created_at
          ) VALUES (?, ?, ?, ?, ?, 'primary', 'active', 70, unixepoch())`,
        )
        .bind(gid, projectId, tenantId, `Launch ${name}`, description || 'Initial project goal from dashboard.')
        .run();
    }
  } catch (e) {
    console.warn('[projects POST project_goals]', e?.message || e);
  }

  const row = await env.DB.prepare(`SELECT * FROM projects WHERE id = ?`).bind(projectId).first();
  const mirror = await mirrorProjectWrite(env, ctx, row, { updatedBy: authUser?.id ?? null });
  return jsonResponse(
    { ok: true, project: row, workspace_project_id: wpId, supabase_mirror: mirror },
    201,
  );
}

export async function deleteProjectDependents(env, projectId) {
  const pid = String(projectId);
  const runOptional = async (sql, ...binds) => {
    try {
      await env.DB.prepare(sql).bind(...binds).run();
    } catch {
      /* optional table / legacy schema */
    }
  };

  // Todos before kanban (agentsam_todo → kanban_tasks / kanban_boards FKs).
  await runOptional(
    `DELETE FROM agentsam_todo WHERE project_id = ? OR project_key = ?`,
    pid,
    pid,
  );
  await runOptional(
    `DELETE FROM kanban_tasks WHERE board_id IN (SELECT id FROM kanban_boards WHERE project_id = ?)`,
    pid,
  );
  await runOptional(`DELETE FROM kanban_boards WHERE project_id = ?`, pid);

  // FK RESTRICT (no ON DELETE) — must clear before projects row delete.
  await runOptional(`DELETE FROM project_costs WHERE CAST(project_id AS TEXT) = ?`, pid);
  await runOptional(`DELETE FROM project_metrics WHERE CAST(project_id AS TEXT) = ?`, pid);
  await runOptional(`UPDATE worker_registry SET project_id = NULL WHERE project_id = ?`, pid);

  await runOptional(`DELETE FROM project_collaborators WHERE project_id = ?`, pid);
  await runOptional(`DELETE FROM project_memory WHERE project_id = ?`, pid);
  await runOptional(`DELETE FROM project_capability_constraints WHERE project_id = ?`, pid);
  await runOptional(`DELETE FROM project_permissions WHERE project_id = ?`, pid);

  await runOptional(`DELETE FROM project_goals WHERE project_id = ?`, pid);

  // FK ON DELETE SET NULL — explicit for legacy rows.
  await runOptional(`UPDATE client_workflows SET project_id = NULL WHERE CAST(project_id AS TEXT) = ?`, pid);
  await runOptional(`UPDATE cicd_events SET project_id = NULL WHERE project_id = ?`, pid);
  await runOptional(`UPDATE cicd_runs SET project_id = NULL WHERE project_id = ?`, pid);
  await runOptional(`UPDATE pipelines SET project_id = NULL WHERE project_id = ?`, pid);
  await runOptional(`UPDATE calendar_events SET project_id = NULL WHERE project_id = ?`, pid);
  await runOptional(`UPDATE client_projects SET project_id = NULL WHERE project_id = ?`, pid);
  await runOptional(`UPDATE time_projects SET projects_id = NULL WHERE projects_id = ?`, pid);
  await runOptional(`UPDATE agentsam_workspace SET project_id = NULL WHERE project_id = ?`, pid);
}

export async function detectProjectDeleteBlockers(env, projectId) {
  const pid = String(projectId);
  const tables = [
    ['worker_registry', `SELECT COUNT(*) AS c FROM worker_registry WHERE project_id = ?`],
    ['project_costs', `SELECT COUNT(*) AS c FROM project_costs WHERE CAST(project_id AS TEXT) = ?`],
    ['project_metrics', `SELECT COUNT(*) AS c FROM project_metrics WHERE CAST(project_id AS TEXT) = ?`],
    ['project_goals', `SELECT COUNT(*) AS c FROM project_goals WHERE project_id = ?`],
    ['project_memory', `SELECT COUNT(*) AS c FROM project_memory WHERE project_id = ?`],
    ['client_projects', `SELECT COUNT(*) AS c FROM client_projects WHERE project_id = ?`],
  ];
  const blockers = [];
  for (const [table, sql] of tables) {
    try {
      const row = await env.DB.prepare(sql).bind(pid).first();
      const count = Number(row?.c ?? 0);
      if (count > 0) blockers.push({ table, count });
    } catch {
      /* optional */
    }
  }
  return blockers;
}

export async function handleDelete(request, env, authUser, id, url, ctx) {
  const row = await env.DB.prepare(`SELECT * FROM projects WHERE id = ?`).bind(id).first();
  if (!row) return jsonResponse({ ok: false, error: 'not_found' }, 404);
  if (authUser.tenant_id && row.tenant_id && String(row.tenant_id) !== String(authUser.tenant_id)) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403);
  }

  await deleteProjectDependents(env, id);

  try {
    await env.DB.prepare(`DELETE FROM projects WHERE id = ?`).bind(id).run();
  } catch (e) {
    const blockers = await detectProjectDeleteBlockers(env, id).catch(() => []);
    return jsonResponse(
      {
        ok: false,
        error: `db_delete_failed: ${e?.message || e}`,
        blockers,
        hint:
          blockers.length > 0
            ? 'Dependent rows still reference this project; retry after cleanup or archive instead.'
            : 'Foreign key constraint — contact support with project id.',
      },
      500,
    );
  }
  try {
    await env.DB.prepare(
      `DELETE FROM workspace_projects
       WHERE json_extract(metadata_json, '$.projects_table_id') = ?
          OR id = ?`,
    )
      .bind(String(id), String(id))
      .run();
  } catch {
    /* optional */
  }

  let mirror = { ok: false, skipped: true };
  try {
    mirror = await mirrorProjectWrite(env, ctx, row, {
      hardDelete: true,
      updatedBy: authUser?.id ?? null,
    });
  } catch (e) {
    mirror = { ok: false, error: e?.message || String(e) };
  }

  if (!mirror?.ok) {
    return jsonResponse({
      ok: true,
      deleted: true,
      id,
      supabase_mirror: mirror,
      warning: 'supabase_mirror_failed',
    });
  }

  return jsonResponse({ ok: true, deleted: true, id, supabase_mirror: mirror });
}
