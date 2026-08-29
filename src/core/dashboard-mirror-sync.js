/**
 * Push canonical D1 rows into Supabase mirror tables (service role, Worker-only).
 */
import { supabaseUpsertJson, supabaseDeleteJson } from '../api/health/supabaseRest.js';

function parseJsonField(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

function intOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function boolFromSqlite(v) {
  return Number(v) === 1;
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} row — D1 kanban_boards row
 */
export async function mirrorKanbanBoard(env, row) {
  if (!row?.id) return { ok: false, skipped: true };
  const cfg = parseJsonField(row.config_json, {});
  const payload = {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    workspace_id: row.workspace_id != null ? String(row.workspace_id) : null,
    project_id: row.project_id != null ? String(row.project_id) : null,
    owner_id: row.owner_id != null ? String(row.owner_id) : null,
    name: String(row.name ?? ''),
    description: row.description != null ? String(row.description) : null,
    board_type: row.board_type != null ? String(row.board_type) : 'project',
    config_json: cfg,
    is_active: boolFromSqlite(row.is_active ?? 1),
    created_at: intOrNull(row.created_at),
    updated_at: intOrNull(row.updated_at),
  };
  const r = await supabaseUpsertJson(env, 'kanban_boards_mirror', payload, 'public');
  return { ok: r.ok, status: r.status };
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} row
 */
export async function mirrorKanbanColumn(env, row) {
  if (!row?.id) return { ok: false, skipped: true };
  const cfg = parseJsonField(row.config_json, {});
  const payload = {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    board_id: String(row.board_id),
    name: String(row.name ?? ''),
    position: intOrNull(row.position) ?? 0,
    color: row.color != null ? String(row.color) : null,
    config_json: cfg,
    created_at: intOrNull(row.created_at),
    updated_at: intOrNull(row.updated_at),
  };
  const r = await supabaseUpsertJson(env, 'kanban_columns_mirror', payload, 'public');
  return { ok: r.ok, status: r.status };
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} taskRow — D1 kanban_tasks
 * @param {string | null} workspaceId — from parent board
 */
export async function mirrorKanbanTask(env, taskRow, workspaceId) {
  if (!taskRow?.id) return { ok: false, skipped: true };
  const meta = parseJsonField(taskRow.meta_json, {});
  const tagsRaw = taskRow.tags;
  let tagsVal = tagsRaw;
  if (typeof tagsRaw === 'string') {
    const parsed = parseJsonField(tagsRaw, null);
    tagsVal = parsed != null ? parsed : tagsRaw;
  }
  const bindingsRaw = taskRow.bindings;
  let bindingsVal = bindingsRaw;
  if (typeof bindingsRaw === 'string') {
    const p = parseJsonField(bindingsRaw, null);
    bindingsVal = p != null ? p : bindingsRaw;
  }
  const payload = {
    id: String(taskRow.id),
    tenant_id: String(taskRow.tenant_id),
    workspace_id: workspaceId != null ? String(workspaceId) : null,
    board_id: String(taskRow.board_id),
    column_id: taskRow.column_id != null ? String(taskRow.column_id) : null,
    todo_id: taskRow.todo_id != null ? String(taskRow.todo_id) : null,
    title: String(taskRow.title ?? ''),
    description: taskRow.description != null ? String(taskRow.description) : null,
    category: taskRow.category != null ? String(taskRow.category) : null,
    priority: taskRow.priority != null ? String(taskRow.priority) : 'medium',
    assignee_id: taskRow.assignee_id != null ? String(taskRow.assignee_id) : null,
    client_name: taskRow.client_name != null ? String(taskRow.client_name) : null,
    project_url: taskRow.project_url != null ? String(taskRow.project_url) : null,
    bindings: bindingsVal,
    tags: tagsVal,
    meta_json: meta,
    position: intOrNull(taskRow.position) ?? 0,
    due_date: intOrNull(taskRow.due_date),
    completed_at: intOrNull(taskRow.completed_at),
    created_at: intOrNull(taskRow.created_at),
    updated_at: intOrNull(taskRow.updated_at),
  };
  const r = await supabaseUpsertJson(env, 'kanban_tasks_mirror', payload, 'public');
  return { ok: r.ok, status: r.status };
}

export async function deleteMirrorKanbanTask(env, taskId) {
  const r = await supabaseDeleteJson(env, 'kanban_tasks_mirror', 'id', String(taskId), 'public');
  return { ok: r.ok, status: r.status };
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} row — agentsam_project_context
 */
export async function mirrorProjectContext(env, row) {
  if (!row?.id) return { ok: false, skipped: true };
  const parseList = (t) => {
    const p = parseJsonField(t, null);
    if (Array.isArray(p)) return p;
    if (typeof t === 'string' && t.trim()) {
      try {
        const j = JSON.parse(t);
        return Array.isArray(j) ? j : [];
      } catch {
        return t.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
      }
    }
    return [];
  };
  const payload = {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    workspace_id: row.workspace_id != null ? String(row.workspace_id) : null,
    project_key: String(row.project_key ?? ''),
    project_name: String(row.project_name ?? ''),
    project_type: row.project_type != null ? String(row.project_type) : null,
    status: row.status != null ? String(row.status) : 'active',
    priority: intOrNull(row.priority) ?? 50,
    description: String(row.description ?? ''),
    goals: row.goals != null ? String(row.goals) : null,
    constraints: row.constraints != null ? String(row.constraints) : null,
    current_blockers: row.current_blockers != null ? String(row.current_blockers) : null,
    primary_tables: parseList(row.primary_tables),
    secondary_tables: parseList(row.secondary_tables),
    workers_involved: parseList(row.workers_involved),
    r2_buckets_involved: parseList(row.r2_buckets_involved),
    domains_involved: parseList(row.domains_involved),
    mcp_services_involved: parseList(row.mcp_services_involved),
    key_files: parseList(row.key_files),
    related_routes: parseList(row.related_routes),
    linked_todo_ids: parseList(row.linked_todo_ids),
    tokens_budgeted: intOrNull(row.tokens_budgeted),
    tokens_used: intOrNull(row.tokens_used) ?? 0,
    cost_usd: Number(row.cost_usd) || 0,
    linked_plan_id: row.linked_plan_id != null ? String(row.linked_plan_id) : null,
    agent_id: row.agent_id != null ? String(row.agent_id) : null,
    client_id: row.client_id != null ? String(row.client_id) : null,
    session_id: row.session_id != null ? String(row.session_id) : null,
    created_by: row.created_by != null ? String(row.created_by) : null,
    notes: row.notes != null ? String(row.notes) : null,
    started_at: intOrNull(row.started_at),
    target_completion: intOrNull(row.target_completion),
    completed_at: intOrNull(row.completed_at),
    created_at: intOrNull(row.created_at),
    updated_at: intOrNull(row.updated_at),
  };
  const r = await supabaseUpsertJson(env, 'project_context_mirror', payload, 'public');
  return { ok: r.ok, status: r.status };
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} row — agentsam_artifacts
 */
export async function mirrorArtifact(env, row) {
  if (!row?.id) return { ok: false, skipped: true };
  const tags = parseJsonField(row.tags, []);
  const payload = {
    id: String(row.id),
    user_id: String(row.user_id),
    tenant_id: String(row.tenant_id),
    workspace_id: row.workspace_id != null ? String(row.workspace_id) : null,
    name: String(row.name ?? ''),
    description: row.description != null ? String(row.description) : null,
    artifact_type: String(row.artifact_type ?? 'html'),
    r2_key: String(row.r2_key ?? ''),
    public_url: row.public_url != null ? String(row.public_url) : null,
    source: String(row.source ?? ''),
    tags: Array.isArray(tags) ? tags : [],
    is_public: boolFromSqlite(row.is_public ?? 0),
    file_size_bytes: intOrNull(row.file_size_bytes),
    created_at: intOrNull(row.created_at),
    updated_at: intOrNull(row.updated_at),
  };
  const r = await supabaseUpsertJson(env, 'artifacts_mirror', payload, 'public');
  return { ok: r.ok, status: r.status };
}

export async function deleteMirrorArtifact(env, artifactId) {
  const r = await supabaseDeleteJson(env, 'artifacts_mirror', 'id', String(artifactId), 'public');
  return { ok: r.ok, status: r.status };
}
