/**
 * Kanban API — /api/kanban/* (D1 kanban_boards, kanban_columns, kanban_tasks).
 */
import { getAuthUser, jsonResponse } from '../core/auth.js';
import { resolveWorkerR2BucketName } from '../core/r2-storage-scope.js';
import { userCanAccessWorkspace } from '../core/workspace-access.js';
import { resolveIdentity } from '../../backend/identity/index.js';

function resolveTenantId(authUser, env) {
  const tid = authUser?.tenant_id ?? authUser?.tenantId ?? null;
  if (tid != null && String(tid).trim() !== '') return String(tid).trim();
  return env?.TENANT_ID ? String(env.TENANT_ID).trim() : null;
}

function inClausePlaceholders(count) {
  const n = Number(count) || 0;
  return n > 0 ? Array(n).fill('?').join(', ') : "''";
}

async function listCollabTenantIds(db, workspaceId) {
  try {
    const { results } = await db
      .prepare(
        `SELECT DISTINCT tenant_id
         FROM workspace_members
         WHERE workspace_id = ?
           AND COALESCE(is_active, 1) = 1
           AND tenant_id IS NOT NULL
           AND TRIM(tenant_id) != ''`,
      )
      .bind(workspaceId)
      .all();
    return [...new Set((results || []).map((r) => String(r.tenant_id).trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

async function resolveKanbanTenantScope(db, authUser, env, workspaceId) {
  const tenantId = resolveTenantId(authUser, env);
  if (!tenantId) return [];
  if (!workspaceId) return [tenantId];
  const collabTenantIds = await listCollabTenantIds(db, workspaceId);
  if (collabTenantIds.length < 2) return [tenantId];
  if (!(await userCanAccessWorkspace(env, authUser, workspaceId))) return [tenantId];
  return collabTenantIds;
}

async function assertBoardAccess(db, boardId, tenantIds, workspaceId) {
  if (!tenantIds?.length) return false;
  const row = await db
    .prepare(
      `SELECT id FROM kanban_boards
       WHERE id = ?
         AND tenant_id IN (${inClausePlaceholders(tenantIds.length)})
         AND (workspace_id = ? OR workspace_id IS NULL OR workspace_id = '')
       LIMIT 1`,
    )
    .bind(boardId, ...tenantIds, workspaceId)
    .first();
  return !!row;
}

function resolveUserId(authUser) {
  const id = authUser?.id ?? authUser?.user_id ?? authUser?.userId ?? null;
  return id != null && String(id).trim() ? String(id).trim() : null;
}

function attachmentDownloadUrl(requestUrl, env, fileKey) {
  const origin = new URL(requestUrl).origin;
  const bucket = resolveWorkerR2BucketName(env, 'ASSETS');
  if (!bucket) throw new Error('r2_bucket_required: ASSETS binding missing');
  return `${origin}/api/r2/buckets/${encodeURIComponent(bucket)}/object/${encodeURIComponent(fileKey)}`;
}

async function assertTaskAccess(db, taskId, tenantIds, workspaceId) {
  if (!tenantIds?.length) return null;
  return db
    .prepare(
      `SELECT kt.id, kt.tenant_id, kt.board_id, kt.column_id, kt.title, kt.description,
              kt.priority, kt.assignee_id, kt.position, kt.completed_at, kt.updated_at
       FROM kanban_tasks kt
       INNER JOIN kanban_boards kb ON kb.id = kt.board_id
       WHERE kt.id = ?
         AND kt.tenant_id IN (${inClausePlaceholders(tenantIds.length)})
         AND (kb.workspace_id = ? OR kb.workspace_id IS NULL OR kb.workspace_id = '')
       LIMIT 1`,
    )
    .bind(taskId, ...tenantIds, workspaceId)
    .first();
}

async function logTaskActivity(db, { taskId, tenantId, userId, action, changes }) {
  const id = `ta_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const now = Math.floor(Date.now() / 1000);
  const changesJson =
    changes != null && typeof changes === 'object' ? JSON.stringify(changes) : changes != null ? String(changes) : null;
  await db
    .prepare(
      `INSERT INTO task_activity (id, task_id, tenant_id, user_id, action, changes_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, taskId, tenantId, userId || null, action, changesJson, now)
    .run();
}

function mapTaskRow(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    board_id: row.board_id != null ? String(row.board_id) : null,
    column_id: row.column_id != null ? String(row.column_id) : null,
    project_id: row.project_id != null ? String(row.project_id) : null,
    title: String(row.title || ''),
    description: row.description != null ? String(row.description) : null,
    category: row.category != null ? String(row.category) : null,
    priority: row.priority != null ? String(row.priority) : 'medium',
    assignee_id: row.assignee_id != null ? String(row.assignee_id) : null,
    client_name: row.client_name != null ? String(row.client_name) : null,
    tags: row.tags != null ? String(row.tags) : null,
    position: Number(row.position) || 0,
    due_date: row.due_date != null ? Number(row.due_date) : null,
    completed_at: row.completed_at != null ? Number(row.completed_at) : null,
    todo_id: row.todo_id != null ? String(row.todo_id) : null,
    created_at: row.created_at != null ? Number(row.created_at) : null,
    updated_at: row.updated_at != null ? Number(row.updated_at) : null,
  };
}

const DEFAULT_WORKSPACE_COLUMNS = [
  { name: 'Backlog', position: 0, status: 'backlog' },
  { name: 'To Do', position: 1, status: 'todo' },
  { name: 'In Progress', position: 2, status: 'in_progress' },
  { name: 'Testing', position: 3, status: 'testing' },
  { name: 'Awaiting Approval', position: 4, status: 'awaiting_approval' },
  { name: 'Complete', position: 5, status: 'complete' },
  { name: 'Blocked', position: 6, status: 'blocked' },
];

async function ensureDefaultWorkspaceBoard(db, tenantId, workspaceId, ownerId) {
  const boardId = `kb_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO kanban_boards (
         id, tenant_id, workspace_id, owner_id, name, description, board_type, is_active, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'Workspace Board', 'Default workspace kanban', 'workspace', 1, ?, ?)`,
    )
    .bind(boardId, tenantId, workspaceId, ownerId || null, now, now)
    .run();

  for (const col of DEFAULT_WORKSPACE_COLUMNS) {
    const columnId = `kcol_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
    const configJson = JSON.stringify({ status: col.status });
    await db
      .prepare(
        `INSERT INTO kanban_columns (
           id, tenant_id, board_id, name, position, config_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(columnId, tenantId, boardId, col.name, col.position, configJson, now, now)
      .run();
  }

  return boardId;
}

async function handleBoards(url, env, authUser, workspaceId) {
  const tenantIds = await resolveKanbanTenantScope(env.DB, authUser, env, workspaceId);
  if (!tenantIds.length) return jsonResponse({ ok: false, error: 'tenant_required' }, 403);
  if (!workspaceId) return jsonResponse({ ok: false, error: 'workspace_required' }, 403);

  let { results } = await env.DB.prepare(
    `SELECT id, tenant_id, workspace_id, project_id, owner_id, name, description, board_type, is_active, created_at, updated_at
     FROM kanban_boards
     WHERE tenant_id IN (${inClausePlaceholders(tenantIds.length)})
       AND is_active = 1
       AND (workspace_id = ? OR workspace_id IS NULL OR workspace_id = '')
     ORDER BY COALESCE(updated_at, created_at) DESC, name ASC`,
  )
    .bind(...tenantIds, workspaceId)
    .all();

  if (!(results || []).length) {
    const ownerId = authUser?.id ?? authUser?.user_id ?? null;
    const primaryTenantId = resolveTenantId(authUser, env);
    await ensureDefaultWorkspaceBoard(env.DB, primaryTenantId, workspaceId, ownerId);
    ({ results } = await env.DB.prepare(
      `SELECT id, tenant_id, workspace_id, project_id, owner_id, name, description, board_type, is_active, created_at, updated_at
       FROM kanban_boards
       WHERE tenant_id IN (${inClausePlaceholders(tenantIds.length)})
         AND is_active = 1
         AND (workspace_id = ? OR workspace_id IS NULL OR workspace_id = '')
       ORDER BY COALESCE(updated_at, created_at) DESC, name ASC`,
    )
      .bind(...tenantIds, workspaceId)
      .all());
  }

  return jsonResponse({ ok: true, boards: results || [] });
}

async function handleColumns(url, env, authUser, workspaceId) {
  const tenantIds = await resolveKanbanTenantScope(env.DB, authUser, env, workspaceId);
  const boardId = url.searchParams.get('board_id')?.trim();
  if (!tenantIds.length) return jsonResponse({ ok: false, error: 'tenant_required' }, 403);
  if (!workspaceId) return jsonResponse({ ok: false, error: 'workspace_required' }, 403);
  if (!boardId) return jsonResponse({ ok: false, error: 'board_id_required' }, 400);

  if (!(await assertBoardAccess(env.DB, boardId, tenantIds, workspaceId))) {
    return jsonResponse({ ok: false, error: 'board_not_found' }, 404);
  }

  const isCollab = tenantIds.length > 1;
  const { results } = isCollab
    ? await env.DB.prepare(
        `SELECT id, board_id, name, position, color, config_json, created_at, updated_at
         FROM kanban_columns
         WHERE board_id = ?
         ORDER BY position ASC, name ASC`,
      )
        .bind(boardId)
        .all()
    : await env.DB.prepare(
        `SELECT id, board_id, name, position, color, config_json, created_at, updated_at
         FROM kanban_columns
         WHERE tenant_id = ? AND board_id = ?
         ORDER BY position ASC, name ASC`,
      )
        .bind(tenantIds[0], boardId)
        .all();

  return jsonResponse({ ok: true, columns: results || [] });
}

async function handleTasksList(url, env, authUser, workspaceId) {
  const tenantIds = await resolveKanbanTenantScope(env.DB, authUser, env, workspaceId);
  const boardId = url.searchParams.get('board_id')?.trim();
  const projectId = url.searchParams.get('project_id')?.trim();
  if (!tenantIds.length) return jsonResponse({ ok: false, error: 'tenant_required' }, 403);
  if (!workspaceId) return jsonResponse({ ok: false, error: 'workspace_required' }, 403);
  if (!boardId && !projectId) return jsonResponse({ ok: false, error: 'board_id_or_project_id_required' }, 400);

  if (boardId) {
    if (!(await assertBoardAccess(env.DB, boardId, tenantIds, workspaceId))) {
      return jsonResponse({ ok: false, error: 'board_not_found' }, 404);
    }
    const { results } = await env.DB.prepare(
      `SELECT kt.*, kb.project_id
       FROM kanban_tasks kt
       INNER JOIN kanban_boards kb ON kb.id = kt.board_id
       WHERE kt.board_id = ?
         AND kt.tenant_id IN (${inClausePlaceholders(tenantIds.length)})
         AND (kb.workspace_id = ? OR kb.workspace_id IS NULL OR kb.workspace_id = '')
       ORDER BY kt.column_id ASC, kt.position ASC, kt.created_at ASC`,
    )
      .bind(boardId, ...tenantIds, workspaceId)
      .all();
    return jsonResponse({ ok: true, tasks: (results || []).map(mapTaskRow) });
  }

  const { results } = await env.DB.prepare(
    `SELECT kt.*, kb.project_id
     FROM kanban_tasks kt
     INNER JOIN kanban_boards kb ON kb.id = kt.board_id
     WHERE kt.tenant_id IN (${inClausePlaceholders(tenantIds.length)})
       AND kb.project_id = ?
       AND (kb.workspace_id = ? OR kb.workspace_id IS NULL OR kb.workspace_id = '')
     ORDER BY kt.position ASC, kt.created_at ASC`,
  )
    .bind(...tenantIds, projectId, workspaceId)
    .all();

  return jsonResponse({ ok: true, tasks: (results || []).map(mapTaskRow) });
}

async function handleTaskCreate(request, env, authUser, workspaceId) {
  const url = new URL(request.url);
  const tenantIds = await resolveKanbanTenantScope(env.DB, authUser, env, workspaceId);
  if (!tenantIds.length) return jsonResponse({ ok: false, error: 'tenant_required' }, 403);
  if (!workspaceId) return jsonResponse({ ok: false, error: 'workspace_required' }, 403);

  const body = await request.json().catch(() => ({}));
  const title = String(body.title || '').trim();
  if (!title) return jsonResponse({ ok: false, error: 'title_required' }, 400);

  let boardId = body.board_id != null ? String(body.board_id).trim() : '';
  const projectId = body.project_id != null ? String(body.project_id).trim() : '';

  if (!boardId && projectId) {
    const boardRow = await env.DB.prepare(
      `SELECT id FROM kanban_boards
       WHERE project_id = ?
         AND tenant_id IN (${inClausePlaceholders(tenantIds.length)})
         AND (workspace_id = ? OR workspace_id IS NULL OR workspace_id = '')
         AND is_active = 1
       ORDER BY COALESCE(updated_at, created_at) DESC
       LIMIT 1`,
    )
      .bind(projectId, ...tenantIds, workspaceId)
      .first();
    if (boardRow?.id) boardId = String(boardRow.id);
  }

  if (!boardId) return jsonResponse({ ok: false, error: 'board_id_or_project_id_required' }, 400);
  if (!(await assertBoardAccess(env.DB, boardId, tenantIds, workspaceId))) {
    return jsonResponse({ ok: false, error: 'board_not_found' }, 404);
  }

  const primaryTenantId = tenantIds[0];
  const isCollab = tenantIds.length > 1;
  const columnIdParam = body.column_id != null ? String(body.column_id).trim() : '';
  let columnId = columnIdParam || null;
  if (!columnId) {
    const col = isCollab
      ? await env.DB.prepare(
          `SELECT id FROM kanban_columns WHERE board_id = ? ORDER BY position ASC LIMIT 1`,
        )
          .bind(boardId)
          .first()
      : await env.DB.prepare(
          `SELECT id FROM kanban_columns WHERE board_id = ? AND tenant_id = ? ORDER BY position ASC LIMIT 1`,
        )
          .bind(boardId, primaryTenantId)
          .first();
    columnId = col?.id ? String(col.id) : null;
  }
  if (!columnId) return jsonResponse({ ok: false, error: 'no_columns_on_board' }, 400);

  const taskId = `kt_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
  const now = Math.floor(Date.now() / 1000);
  const priority = ['low', 'medium', 'high', 'urgent'].includes(String(body.priority || '').toLowerCase())
    ? String(body.priority).toLowerCase()
    : 'medium';
  const resolvedProjectId = projectId || null;

  await env.DB.prepare(
    `INSERT INTO kanban_tasks (
       id, tenant_id, board_id, column_id, project_id, title, description, priority, position, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  )
    .bind(
      taskId,
      primaryTenantId,
      boardId,
      columnId,
      resolvedProjectId,
      title.slice(0, 500),
      body.description != null ? String(body.description).slice(0, 4000) : null,
      priority,
      now,
      now,
    )
    .run();

  const row = await env.DB.prepare(`SELECT * FROM kanban_tasks WHERE id = ? LIMIT 1`).bind(taskId).first();
  return jsonResponse({ ok: true, task: mapTaskRow(row) }, 201);
}

async function handleTaskPatch(request, env, authUser, taskId, workspaceId) {
  const tenantIds = await resolveKanbanTenantScope(env.DB, authUser, env, workspaceId);
  if (!tenantIds.length) return jsonResponse({ ok: false, error: 'tenant_required' }, 403);
  if (!workspaceId) return jsonResponse({ ok: false, error: 'workspace_required' }, 403);

  const row = await assertTaskAccess(env.DB, taskId, tenantIds, workspaceId);
  if (!row) return jsonResponse({ ok: false, error: 'not_found' }, 404);

  const body = await request.json().catch(() => ({}));
  const updates = [];
  const binds = [];
  const activityLogs = [];
  const isCollab = tenantIds.length > 1;
  const userId = resolveUserId(authUser);
  const tenantId = String(row.tenant_id);

  if (body.column_id != null) {
    const columnId = String(body.column_id).trim();
    const col = isCollab
      ? await env.DB.prepare(`SELECT id FROM kanban_columns WHERE id = ? AND board_id = ? LIMIT 1`)
          .bind(columnId, row.board_id)
          .first()
      : await env.DB.prepare(
          `SELECT id FROM kanban_columns WHERE id = ? AND board_id = ? AND tenant_id = ? LIMIT 1`,
        )
          .bind(columnId, row.board_id, tenantIds[0])
          .first();
    if (!col) return jsonResponse({ ok: false, error: 'invalid_column' }, 400);
    if (String(row.column_id || '') !== columnId) {
      activityLogs.push({
        action: 'status_changed',
        changes: { field: 'column_id', from: row.column_id, to: columnId },
      });
    }
    updates.push('column_id = ?');
    binds.push(columnId);
  }

  if (body.position != null) {
    const position = Number(body.position) || 0;
    if (Number(row.position) !== position) {
      activityLogs.push({
        action: 'updated',
        changes: { field: 'position', from: row.position, to: position },
      });
    }
    updates.push('position = ?');
    binds.push(position);
  }

  if (body.status === 'complete' || body.completed === true) {
    if (!row.completed_at) {
      activityLogs.push({ action: 'status_changed', changes: { field: 'completed_at', from: null, to: 'set' } });
    }
    updates.push('completed_at = ?');
    binds.push(Math.floor(Date.now() / 1000));
  } else if (body.completed === false || body.status === 'open') {
    if (row.completed_at) {
      activityLogs.push({ action: 'status_changed', changes: { field: 'completed_at', from: row.completed_at, to: null } });
    }
    updates.push('completed_at = NULL');
  }

  if (body.title != null) {
    const title = String(body.title).trim();
    if (String(row.title || '') !== title) {
      activityLogs.push({ action: 'updated', changes: { field: 'title', from: row.title, to: title } });
    }
    updates.push('title = ?');
    binds.push(title);
  }

  if (body.assignee_id != null) {
    const assigneeId = String(body.assignee_id).trim() || null;
    if (String(row.assignee_id || '') !== String(assigneeId || '')) {
      activityLogs.push({
        action: 'assigned',
        changes: { field: 'assignee_id', from: row.assignee_id, to: assigneeId },
      });
    }
    updates.push('assignee_id = ?');
    binds.push(assigneeId);
  }

  if (!updates.length) return jsonResponse({ ok: false, error: 'no_updates' }, 400);

  updates.push('updated_at = unixepoch()');
  binds.push(taskId);

  await env.DB.prepare(`UPDATE kanban_tasks SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();

  for (const entry of activityLogs) {
    await logTaskActivity(env.DB, {
      taskId,
      tenantId,
      userId,
      action: entry.action,
      changes: entry.changes,
    });
  }

  const next = await env.DB.prepare(
    `SELECT kt.*, kb.project_id
     FROM kanban_tasks kt
     INNER JOIN kanban_boards kb ON kb.id = kt.board_id
     WHERE kt.id = ? LIMIT 1`,
  )
    .bind(taskId)
    .first();

  return jsonResponse({ ok: true, task: mapTaskRow(next) });
}

async function handleTaskActivityList(request, env, authUser, taskId, workspaceId) {
  const tenantIds = await resolveKanbanTenantScope(env.DB, authUser, env, workspaceId);
  if (!tenantIds.length) return jsonResponse({ ok: false, error: 'tenant_required' }, 403);
  if (!workspaceId) return jsonResponse({ ok: false, error: 'workspace_required' }, 403);

  const row = await assertTaskAccess(env.DB, taskId, tenantIds, workspaceId);
  if (!row) return jsonResponse({ ok: false, error: 'not_found' }, 404);

  const { results } = await env.DB.prepare(
    `SELECT id, task_id, tenant_id, user_id, action, changes_json, created_at
     FROM task_activity
     WHERE task_id = ? AND tenant_id = ?
     ORDER BY created_at DESC
     LIMIT 100`,
  )
    .bind(taskId, String(row.tenant_id))
    .all();

  return jsonResponse({ ok: true, activity: results || [] });
}

async function handleTaskCommentsList(request, env, authUser, taskId, workspaceId) {
  const tenantIds = await resolveKanbanTenantScope(env.DB, authUser, env, workspaceId);
  if (!tenantIds.length) return jsonResponse({ ok: false, error: 'tenant_required' }, 403);
  if (!workspaceId) return jsonResponse({ ok: false, error: 'workspace_required' }, 403);

  const row = await assertTaskAccess(env.DB, taskId, tenantIds, workspaceId);
  if (!row) return jsonResponse({ ok: false, error: 'not_found' }, 404);

  const { results } = await env.DB.prepare(
    `SELECT id, task_id, tenant_id, user_id, content, metadata_json, created_at, updated_at
     FROM task_comments
     WHERE task_id = ? AND tenant_id = ?
     ORDER BY created_at ASC
     LIMIT 200`,
  )
    .bind(taskId, String(row.tenant_id))
    .all();

  return jsonResponse({ ok: true, comments: results || [] });
}

async function handleTaskCommentPost(request, env, authUser, taskId, workspaceId) {
  const tenantIds = await resolveKanbanTenantScope(env.DB, authUser, env, workspaceId);
  if (!tenantIds.length) return jsonResponse({ ok: false, error: 'tenant_required' }, 403);
  if (!workspaceId) return jsonResponse({ ok: false, error: 'workspace_required' }, 403);

  const row = await assertTaskAccess(env.DB, taskId, tenantIds, workspaceId);
  if (!row) return jsonResponse({ ok: false, error: 'not_found' }, 404);

  const userId = resolveUserId(authUser);
  if (!userId) return jsonResponse({ ok: false, error: 'user_required' }, 403);

  const body = await request.json().catch(() => ({}));
  const content = String(body.content || '').trim();
  if (!content) return jsonResponse({ ok: false, error: 'content_required' }, 400);

  const tenantId = String(row.tenant_id);
  const now = Math.floor(Date.now() / 1000);
  const id = `tc_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

  await env.DB.prepare(
    `INSERT INTO task_comments (id, task_id, tenant_id, user_id, content, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '{}', ?, ?)`,
  )
    .bind(id, taskId, tenantId, userId, content, now, now)
    .run();

  await logTaskActivity(env.DB, {
    taskId,
    tenantId,
    userId,
    action: 'commented',
    changes: { comment_id: id },
  });

  return jsonResponse({
    ok: true,
    comment: {
      id,
      task_id: taskId,
      tenant_id: tenantId,
      user_id: userId,
      content,
      metadata_json: '{}',
      created_at: now,
      updated_at: now,
    },
  });
}

async function handleTaskAttachmentsList(request, env, authUser, taskId, workspaceId) {
  const tenantIds = await resolveKanbanTenantScope(env.DB, authUser, env, workspaceId);
  if (!tenantIds.length) return jsonResponse({ ok: false, error: 'tenant_required' }, 403);
  if (!workspaceId) return jsonResponse({ ok: false, error: 'workspace_required' }, 403);

  const row = await assertTaskAccess(env.DB, taskId, tenantIds, workspaceId);
  if (!row) return jsonResponse({ ok: false, error: 'not_found' }, 404);

  const { results } = await env.DB.prepare(
    `SELECT id, task_id, file_name, file_key, file_size, content_type, created_at
     FROM task_attachments
     WHERE task_id = ?
     ORDER BY created_at DESC
     LIMIT 100`,
  )
    .bind(taskId)
    .all();

  const attachments = (results || []).map((a) => ({
    ...a,
    url: attachmentDownloadUrl(request.url, env, String(a.file_key)),
  }));

  return jsonResponse({ ok: true, attachments });
}

async function handleTaskAttachmentPost(request, env, authUser, taskId, workspaceId) {
  const tenantIds = await resolveKanbanTenantScope(env.DB, authUser, env, workspaceId);
  if (!tenantIds.length) return jsonResponse({ ok: false, error: 'tenant_required' }, 403);
  if (!workspaceId) return jsonResponse({ ok: false, error: 'workspace_required' }, 403);

  const row = await assertTaskAccess(env.DB, taskId, tenantIds, workspaceId);
  if (!row) return jsonResponse({ ok: false, error: 'not_found' }, 404);

  const bucket = env.ASSETS;
  if (!bucket?.put) return jsonResponse({ ok: false, error: 'storage_not_configured' }, 503);

  const userId = resolveUserId(authUser);
  const tenantId = String(row.tenant_id);
  const contentTypeHeader = request.headers.get('content-type') || '';

  let fileName = 'file';
  let contentType = 'application/octet-stream';
  let bytes;

  if (contentTypeHeader.includes('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return jsonResponse({ ok: false, error: 'file_required' }, 400);
    fileName = file.name || fileName;
    contentType = file.type || contentType;
    bytes = await file.arrayBuffer();
  } else {
    bytes = await request.arrayBuffer();
    if (!bytes?.byteLength) return jsonResponse({ ok: false, error: 'file_required' }, 400);
    const url = new URL(request.url);
    fileName = url.searchParams.get('file_name') || fileName;
    contentType = request.headers.get('content-type') || contentType;
  }

  const safeName = String(fileName).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
  const fileKey = `tasks/${tenantId}/${taskId}/${crypto.randomUUID().slice(0, 8)}-${safeName}`;

  await bucket.put(fileKey, bytes, { httpMetadata: { contentType } });

  const id = `tatt_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
  await env.DB.prepare(
    `INSERT INTO task_attachments (id, task_id, file_name, file_key, file_size, content_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
  )
    .bind(id, taskId, fileName, fileKey, bytes.byteLength, contentType)
    .run();

  if (userId) {
    await logTaskActivity(env.DB, {
      taskId,
      tenantId,
      userId,
      action: 'updated',
      changes: { field: 'attachment', file_name: fileName, file_key: fileKey },
    });
  }

  const attachment = {
    id,
    task_id: taskId,
    file_name: fileName,
    file_key: fileKey,
    file_size: bytes.byteLength,
    content_type: contentType,
    url: attachmentDownloadUrl(request.url, env, fileKey),
  };

  return jsonResponse({ ok: true, attachment });
}

export async function handleKanbanApi(request, url, env) {
  const pathLower = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
  const method = request.method.toUpperCase();
  const authUser = await getAuthUser(request, env);
  if (!authUser) return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  if (!env.DB) return jsonResponse({ ok: false, error: 'DB not configured' }, 503);
  const identity = await resolveIdentity(request, env);
  const workspaceId = identity.workspace?.id || null;

  if (pathLower === '/api/kanban/boards' && method === 'GET') {
    return handleBoards(url, env, authUser, workspaceId);
  }

  if (pathLower === '/api/kanban/columns' && method === 'GET') {
    return handleColumns(url, env, authUser, workspaceId);
  }

  if (pathLower === '/api/kanban/tasks' && method === 'GET') {
    return handleTasksList(url, env, authUser, workspaceId);
  }

  if (pathLower === '/api/kanban/tasks' && method === 'POST') {
    return handleTaskCreate(request, env, authUser, workspaceId);
  }

  const taskSubMatch = pathLower.match(/^\/api\/kanban\/tasks\/([^/]+)\/(activity|comments|attachments)$/);
  if (taskSubMatch) {
    const subId = taskSubMatch[1];
    const subResource = taskSubMatch[2];
    if (subResource === 'activity' && method === 'GET') {
      return handleTaskActivityList(request, env, authUser, subId, workspaceId);
    }
    if (subResource === 'comments' && method === 'GET') {
      return handleTaskCommentsList(request, env, authUser, subId, workspaceId);
    }
    if (subResource === 'comments' && method === 'POST') {
      return handleTaskCommentPost(request, env, authUser, subId, workspaceId);
    }
    if (subResource === 'attachments' && method === 'GET') {
      return handleTaskAttachmentsList(request, env, authUser, subId, workspaceId);
    }
    if (subResource === 'attachments' && method === 'POST') {
      return handleTaskAttachmentPost(request, env, authUser, subId, workspaceId);
    }
  }

  const taskMatch = pathLower.match(/^\/api\/kanban\/tasks\/([^/]+)$/);
  if (taskMatch && method === 'PATCH') {
    return handleTaskPatch(request, env, authUser, taskMatch[1], workspaceId);
  }

  return jsonResponse({ ok: false, error: 'Not found' }, 404);
}
