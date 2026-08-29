/**
 * Canonical D1 writes for agentsam_plans + agentsam_plan_tasks.
 * Uses PRAGMA table_info so inserts survive column drift (new optional columns, renames avoided).
 */

import { pragmaTableInfo } from '../../backend/services/retention.js';

const INSERTABLE_TABLES = new Set(['agentsam_plans', 'agentsam_plan_tasks']);

const PLAN_TYPES = new Set(['daily', 'sprint', 'incident', 'feature', 'refactor']);
const PLAN_STATUS = new Set(['draft', 'active', 'complete', 'abandoned']);
const TASK_PRIORITY = new Set(['P0', 'P1', 'P2', 'P3']);
const TASK_CATEGORY = new Set(['frontend', 'backend', 'db', 'infra', 'ux', 'research', 'other']);
const TASK_STATUS = new Set(['todo', 'in_progress', 'done', 'blocked', 'skipped', 'carried']);
const HANDLER_TYPES = new Set([
  'agent',
  'db_query',
  'terminal',
  'mcp_tool',
  'script',
  'eval',
  'branch',
  'webhook',
  'approval_gate',
  'retry',
  'parallel',
  'join',
]);

function newPlanId() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return `plan_${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}

function newTaskId() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return `task_${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}

function jsonArrField(v, fallback = '[]') {
  if (v == null) return fallback;
  if (Array.isArray(v)) return JSON.stringify(v);
  return String(v);
}

/** Map legacy / LLM labels to CHECK-safe agentsam_plans.plan_type */
export function normalizePlanType(raw) {
  const s = String(raw || '')
    .toLowerCase()
    .trim();
  if (PLAN_TYPES.has(s)) return s;
  if (s === 'studio_session' || s === 'studio' || s === 'session') return 'feature';
  return 'feature';
}

export function normalizePlanStatus(raw) {
  const s = String(raw || '')
    .toLowerCase()
    .trim();
  return PLAN_STATUS.has(s) ? s : 'draft';
}

/**
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {string} table
 * @param {Record<string, unknown>} row
 * @param {Set<string> | null} [colsCached]
 */
async function insertRowDynamic(db, table, row, colsCached = null) {
  if (!INSERTABLE_TABLES.has(String(table))) throw new Error('invalid insert table');
  const cols = colsCached && colsCached.size ? colsCached : await pragmaTableInfo(db, table);
  if (!cols.size) throw new Error(`${table} missing`);

  const names = [];
  const ph = [];
  const binds = [];
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined) continue;
    const key = String(k).toLowerCase();
    if (!cols.has(key)) continue;
    names.push(k);
    if (v === Symbol.for('sql_now')) {
      ph.push(`datetime('now')`);
      continue;
    }
    if (v === Symbol.for('sql_unixepoch')) {
      ph.push(`unixepoch()`);
      continue;
    }
    ph.push('?');
    binds.push(v);
  }
  if (!names.length) throw new Error(`${table}: no matching columns for insert`);
  const sql = `INSERT INTO ${table} (${names.join(', ')}) VALUES (${ph.join(', ')})`;
  await db
    .prepare(sql)
    .bind(...binds)
    .run();
}

/**
 * Insert one agentsam_plans row. Required: tenant_id, title. plan_date defaults to UTC YYYY-MM-DD.
 *
 * @param {any} env
 * @param {Record<string, unknown>} input
 * @param {any} [ctx] ExecutionContext for Supabase mirror waitUntil
 * @returns {Promise<{ id: string }>}
 */
export async function insertAgentsamPlanRow(env, input, ctx = null) {
  if (!env?.DB) throw new Error('DB not available');
  const tenantId = String(input.tenant_id ?? '').trim();
  if (!tenantId) throw new Error('tenant_id required');

  const id = String(input.id ?? '').trim() || newPlanId();
  const planDate =
    input.plan_date != null && String(input.plan_date).trim() !== ''
      ? String(input.plan_date).trim()
      : new Date().toISOString().slice(0, 10);
  const title = String(input.title ?? 'Plan').trim().slice(0, 500) || 'Plan';

  const row = {
    id,
    tenant_id: tenantId,
    workspace_id: input.workspace_id != null ? String(input.workspace_id).trim() || null : null,
    session_id: input.session_id != null ? String(input.session_id).trim() || null : null,
    agent_id: input.agent_id != null ? String(input.agent_id).trim() || null : null,
    client_id: input.client_id != null ? String(input.client_id).trim() || null : null,
    client_name: input.client_name != null ? String(input.client_name).trim() || null : null,
    plan_date: planDate,
    plan_type: normalizePlanType(input.plan_type),
    title,
    status: normalizePlanStatus(input.status ?? 'active'),
    morning_brief: input.morning_brief != null ? String(input.morning_brief) : null,
    session_notes: input.session_notes != null ? String(input.session_notes) : null,
    eod_summary: input.eod_summary != null ? String(input.eod_summary) : null,
    available_providers:
      input.available_providers != null ? String(input.available_providers) : '["anthropic","openai","google","workers_ai"]',
    blocked_providers: input.blocked_providers != null ? String(input.blocked_providers) : '[]',
    budget_snapshot: input.budget_snapshot != null ? String(input.budget_snapshot) : '{}',
    default_model: input.default_model != null ? String(input.default_model).trim() || null : null,
    token_budget: input.token_budget != null ? Number(input.token_budget) : null,
    tokens_used: input.tokens_used != null ? Number(input.tokens_used) || 0 : 0,
    cost_usd: input.cost_usd != null ? Number(input.cost_usd) || 0 : 0,
    carry_over_from: input.carry_over_from != null ? String(input.carry_over_from) : null,
    carry_over_count: input.carry_over_count != null ? Number(input.carry_over_count) || 0 : 0,
    tasks_total: input.tasks_total != null ? Number(input.tasks_total) || 0 : 0,
    tasks_done: input.tasks_done != null ? Number(input.tasks_done) || 0 : 0,
    tasks_blocked: input.tasks_blocked != null ? Number(input.tasks_blocked) || 0 : 0,
    linked_project_keys: input.linked_project_keys != null ? String(input.linked_project_keys) : '[]',
    linked_todo_ids: input.linked_todo_ids != null ? String(input.linked_todo_ids) : '[]',
    linked_context_ids: input.linked_context_ids != null ? String(input.linked_context_ids) : '[]',
    workflow_id: input.workflow_id != null ? String(input.workflow_id).trim() || null : null,
    workflow_run_id: input.workflow_run_id != null ? String(input.workflow_run_id).trim() || null : null,
    graph_mode: input.graph_mode != null ? Number(input.graph_mode) || 0 : 0,
    risk_level: input.risk_level != null ? String(input.risk_level).slice(0, 32) : 'low',
    requires_approval: input.requires_approval != null ? (Number(input.requires_approval) ? 1 : 0) : 0,
    created_at: Symbol.for('sql_unixepoch'),
    updated_at: Symbol.for('sql_unixepoch'),
  };

  await insertRowDynamic(env.DB, 'agentsam_plans', row);
  return { id };
}

function normTaskPriority(p) {
  const s = String(p || 'P1').toUpperCase();
  return TASK_PRIORITY.has(s) ? s : 'P1';
}

function normTaskCategory(c) {
  const s = String(c || 'other').toLowerCase();
  return TASK_CATEGORY.has(s) ? s : 'other';
}

function normTaskStatus(s) {
  const x = String(s || 'todo').toLowerCase();
  return TASK_STATUS.has(x) ? x : 'todo';
}

function normHandlerType(ht) {
  if (ht == null || String(ht).trim() === '') return null;
  const x = String(ht).toLowerCase();
  return HANDLER_TYPES.has(x) ? x : 'agent';
}

/**
 * @param {any} env
 * @param {{
 *   planId: string,
 *   tenantId?: string | null,
 *   workspaceId?: string | null,
 *   tasks: Array<Record<string, unknown>>,
 * }} p
 * @param {any} [ctx] ExecutionContext for Supabase mirror waitUntil
 * @returns {Promise<{ ids: string[] }>}
 */
export async function insertAgentsamPlanTaskRows(env, p, ctx = null) {
  if (!env?.DB) throw new Error('DB not available');
  const planId = String(p.planId || '').trim();
  if (!planId) throw new Error('planId required');
  const tasks = Array.isArray(p.tasks) ? p.tasks : [];
  if (!tasks.length) return { ids: [] };

  const tid = p.tenantId != null ? String(p.tenantId).trim() || null : null;
  const ws = p.workspaceId != null ? String(p.workspaceId).trim() || null : null;
  const cols = await pragmaTableInfo(env.DB, 'agentsam_plan_tasks');
  if (!cols.size) throw new Error('agentsam_plan_tasks missing');

  const ids = [];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i] || {};
    const id = String(t.id ?? '').trim() || newTaskId();
    ids.push(id);
    const orderIndex = t.order_index != null ? Number(t.order_index) : i;
    const title = String(t.title ?? `Task ${i + 1}`).slice(0, 500);

    const row = {
      id,
      plan_id: planId,
      tenant_id: t.tenant_id != null ? String(t.tenant_id).trim() || null : tid,
      workspace_id: t.workspace_id != null ? String(t.workspace_id).trim() || null : ws,
      todo_id: t.todo_id != null ? String(t.todo_id).trim() || null : null,
      command_run_id: t.command_run_id != null ? String(t.command_run_id).trim() || null : null,
      agent_id: t.agent_id != null ? String(t.agent_id).trim() || null : null,
      assigned_model: t.assigned_model != null ? String(t.assigned_model).trim() || null : null,
      order_index: Number.isFinite(orderIndex) ? orderIndex : i,
      title,
      description: t.description != null ? String(t.description).slice(0, 8000) : null,
      priority: normTaskPriority(t.priority),
      category: normTaskCategory(t.category),
      status: normTaskStatus(t.status),
      files_involved: jsonArrField(t.files_involved),
      tables_involved: jsonArrField(t.tables_involved),
      routes_involved: jsonArrField(t.routes_involved),
      depends_on: jsonArrField(t.depends_on),
      estimated_minutes: t.estimated_minutes != null ? Number(t.estimated_minutes) : null,
      actual_minutes: t.actual_minutes != null ? Number(t.actual_minutes) : null,
      blocked_reason: t.blocked_reason != null ? String(t.blocked_reason) : null,
      notes: t.notes != null ? String(t.notes) : null,
      output_summary: t.output_summary != null ? String(t.output_summary) : null,
      error_trace: t.error_trace != null ? String(t.error_trace) : null,
      tokens_used: t.tokens_used != null ? Number(t.tokens_used) || 0 : 0,
      cost_usd: t.cost_usd != null ? Number(t.cost_usd) || 0 : 0,
      started_at: t.started_at != null ? Number(t.started_at) : null,
      completed_at: t.completed_at != null ? Number(t.completed_at) : null,
      node_key: t.node_key != null ? String(t.node_key).slice(0, 500) : null,
      execution_step_id: t.execution_step_id != null ? String(t.execution_step_id).trim() || null : null,
      workflow_run_id: t.workflow_run_id != null ? String(t.workflow_run_id).trim() || null : null,
      handler_key: t.handler_key != null ? String(t.handler_key).slice(0, 500) : null,
      handler_type: normHandlerType(t.handler_type),
      risk_level: t.risk_level != null ? String(t.risk_level) : 'low',
      requires_approval: t.requires_approval != null ? (Number(t.requires_approval) ? 1 : 0) : 0,
      quality_gate_json:
        t.quality_gate_json != null
          ? typeof t.quality_gate_json === 'object'
            ? JSON.stringify(t.quality_gate_json).slice(0, 8000)
            : String(t.quality_gate_json).slice(0, 8000)
          : '{}',
      edge_taken: t.edge_taken != null ? String(t.edge_taken) : null,
      created_at: Symbol.for('sql_unixepoch'),
    };

    await insertRowDynamic(env.DB, 'agentsam_plan_tasks', row, cols);
  }

  return { ids };
}
