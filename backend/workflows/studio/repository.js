import { buildSignedOffMetadataPatch } from '../approvals/policy.js';
import { loadWorkflowGraph, resolveDagWorkflowId } from '../repository/graph.js';

function parseJsonObject(raw, fallback = {}) {
  if (raw == null) return { ...fallback };
  if (typeof raw === 'object' && !Array.isArray(raw)) return { ...fallback, ...raw };
  try {
    const o = JSON.parse(String(raw || '{}'));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

async function loadWorkflowRunsSummary(db, workflowKey) {
  const key = String(workflowKey || '').trim();
  if (!key) return null;
  const row = await db.prepare(
    `SELECT COUNT(*) AS run_count,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS success_count,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS fail_count,
            AVG(COALESCE(cost_usd, 0)) AS avg_cost_usd,
            SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) AS total_tokens
       FROM agentsam_workflow_runs
      WHERE workflow_key = ?`,
  ).bind(key).first().catch(() => null);
  if (!row) return null;
  const runCount = Number(row.run_count ?? 0);
  const successCount = Number(row.success_count ?? 0);
  const failCount = Number(row.fail_count ?? 0);
  return {
    run_count: runCount,
    success_count: successCount,
    fail_count: failCount,
    success_rate: runCount > 0 ? successCount / runCount : null,
    fail_rate: runCount > 0 ? failCount / runCount : null,
    avg_cost_usd: row.avg_cost_usd != null ? Number(row.avg_cost_usd) : null,
    total_tokens: Number(row.total_tokens ?? 0),
  };
}

export async function loadWorkflowStudioModel(db, registryId, tenantId = null, workspaceId = null) {
  const runtime = await loadWorkflowGraph(db, registryId, tenantId, workspaceId);
  if (!runtime) return null;
  const meta = parseJsonObject(runtime.workflow.metadata_json);
  return {
    ...runtime,
    registry_workflow_id: String(runtime.workflow.id ?? ''),
    dag_workflow_id: runtime.workflow_id,
    canvas_layout: meta.canvas_layout && typeof meta.canvas_layout === 'object' ? meta.canvas_layout : {},
    runs_summary: await loadWorkflowRunsSummary(db, String(runtime.workflow.workflow_key || '')),
  };
}

export async function requireWorkflowGraphContext(db, registryId, tenantId, workspaceId) {
  const bundle = await loadWorkflowStudioModel(db, registryId, tenantId, workspaceId);
  if (!bundle) return { error: 'workflow not found', status: 404 };
  return { bundle };
}

export async function saveWorkflowCanvasLayout(db, registryId, positions, tenantId = null, workspaceId = null) {
  const ctx = await requireWorkflowGraphContext(db, registryId, tenantId, workspaceId);
  if (ctx.error) return { error: ctx.error, status: ctx.status };
  const dagId = ctx.bundle.dag_workflow_id;
  const entries = Object.entries(positions && typeof positions === 'object' ? positions : {});
  if (!entries.length) return { ok: true, dag_workflow_id: dagId, updated: 0 };

  let updated = 0;
  let usedNodeColumns = true;
  for (const [nodeKey, pos] of entries) {
    const x = Math.round(Number(pos?.x ?? 0));
    const y = Math.round(Number(pos?.y ?? 0));
    try {
      const res = await db.prepare(
        `UPDATE agentsam_workflow_nodes
            SET pos_x = ?, pos_y = ?, updated_at = datetime('now')
          WHERE workflow_id = ? AND node_key = ? AND COALESCE(is_active, 1) = 1`,
      ).bind(x, y, dagId, String(nodeKey)).run();
      updated += Number(res?.meta?.changes ?? res?.changes ?? 0);
    } catch {
      usedNodeColumns = false;
      break;
    }
  }

  if (!usedNodeColumns) {
    const workflow = await db.prepare(
      `SELECT id, metadata_json FROM agentsam_workflows WHERE id = ? LIMIT 1`,
    ).bind(registryId).first();
    if (!workflow) return { error: 'workflow not found', status: 404 };
    const meta = parseJsonObject(workflow.metadata_json);
    meta.canvas_layout = { ...(meta.canvas_layout || {}), ...positions };
    await db.prepare(
      `UPDATE agentsam_workflows SET metadata_json = ?, updated_at = datetime('now') WHERE id = ?`,
    ).bind(JSON.stringify(meta), registryId).run();
    return { ok: true, dag_workflow_id: dagId, canvas_layout: meta.canvas_layout, fallback: 'metadata_json' };
  }
  return { ok: true, dag_workflow_id: dagId, updated };
}

const ALLOWED_NODE_TYPES = new Set([
  'agent','mcp_tool','terminal','db_query','script','eval','branch','approval_gate',
  'webhook','trigger','process','output','join','retry','parallel',
]);

export async function createWorkflowNode(db, opts) {
  const { registryId, dagWorkflowId, body } = opts;
  const nodeKey = String(body.node_key || '').trim();
  const title = String(body.title || body.display_name || nodeKey).trim();
  const nodeType = String(body.node_type || 'agent').trim();
  if (!nodeKey) return { error: 'node_key required', status: 400 };
  if (!ALLOWED_NODE_TYPES.has(nodeType)) return { error: `invalid node_type: ${nodeType}`, status: 400 };
  const existing = await db.prepare(
    `SELECT id FROM agentsam_workflow_nodes WHERE workflow_id = ? AND node_key = ? LIMIT 1`,
  ).bind(dagWorkflowId, nodeKey).first();
  if (existing) return { error: 'node_key already exists', status: 409 };
  const sortRow = await db.prepare(
    `SELECT COALESCE(MAX(sort_order), 0) + 10 AS next_order FROM agentsam_workflow_nodes WHERE workflow_id = ?`,
  ).bind(dagWorkflowId).first();
  const sortOrder = body.sort_order != null ? Number(body.sort_order) : Number(sortRow?.next_order ?? 10);
  await db.prepare(
    `INSERT INTO agentsam_workflow_nodes (
       workflow_id, node_key, node_type, title, description, handler_key,
       input_schema_json, output_schema_json, timeout_ms, risk_level,
       requires_approval, is_active, sort_order, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, '{}', '{}', ?, ?, ?, 1, ?, datetime('now'))`,
  ).bind(
    dagWorkflowId, nodeKey, nodeType, title || nodeKey,
    body.description != null ? String(body.description) : null,
    body.handler_key != null ? String(body.handler_key) : null,
    body.timeout_ms != null ? Number(body.timeout_ms) : 30000,
    body.risk_level != null ? String(body.risk_level) : 'low',
    body.requires_approval ? 1 : 0,
    sortOrder,
  ).run();
  return { ok: true, registry_id: registryId, dag_workflow_id: dagWorkflowId, node_key: nodeKey };
}

export async function updateWorkflowNode(db, opts) {
  const { dagWorkflowId, nodeKey, body } = opts;
  const row = await db.prepare(
    `SELECT id FROM agentsam_workflow_nodes WHERE workflow_id = ? AND node_key = ? AND COALESCE(is_active, 1) = 1 LIMIT 1`,
  ).bind(dagWorkflowId, nodeKey).first();
  if (!row) return { error: 'node not found', status: 404 };
  const fields = [];
  const vals = [];
  const set = (col, val) => { fields.push(`${col} = ?`); vals.push(val); };
  if (body.title != null) set('title', String(body.title));
  if (body.description != null) set('description', String(body.description));
  if (body.node_type != null) {
    const nt = String(body.node_type);
    if (!ALLOWED_NODE_TYPES.has(nt)) return { error: `invalid node_type: ${nt}`, status: 400 };
    set('node_type', nt);
  }
  if (body.handler_key !== undefined) set('handler_key', body.handler_key ? String(body.handler_key) : null);
  if (body.sort_order != null) set('sort_order', Number(body.sort_order));
  if (body.risk_level != null) set('risk_level', String(body.risk_level));
  if (body.requires_approval != null) set('requires_approval', body.requires_approval ? 1 : 0);
  if (body.timeout_ms != null) set('timeout_ms', Number(body.timeout_ms));
  if (!fields.length) return { ok: true, node_key: nodeKey, unchanged: true };
  fields.push(`updated_at = datetime('now')`);
  vals.push(dagWorkflowId, nodeKey);
  await db.prepare(`UPDATE agentsam_workflow_nodes SET ${fields.join(', ')} WHERE workflow_id = ? AND node_key = ?`).bind(...vals).run();
  return { ok: true, node_key: nodeKey };
}

export async function deleteWorkflowNode(db, { dagWorkflowId, nodeKey }) {
  const res = await db.prepare(
    `UPDATE agentsam_workflow_nodes SET is_active = 0, updated_at = datetime('now') WHERE workflow_id = ? AND node_key = ?`,
  ).bind(dagWorkflowId, nodeKey).run();
  const changes = res?.meta?.changes ?? res?.changes ?? 0;
  if (!changes) return { error: 'node not found', status: 404 };
  await db.prepare(
    `DELETE FROM agentsam_workflow_edges WHERE workflow_id = ? AND (from_node_key = ? OR to_node_key = ?)`,
  ).bind(dagWorkflowId, nodeKey, nodeKey).run().catch(() => null);
  return { ok: true, node_key: nodeKey };
}

export async function createWorkflowEdge(db, { dagWorkflowId, body }) {
  const from = String(body.from_node_key || body.from || '').trim();
  const to = String(body.to_node_key || body.to || '').trim();
  if (!from || !to) return { error: 'from_node_key and to_node_key required', status: 400 };
  if (from === to) return { error: 'edge cannot loop to same node', status: 400 };
  const edgeId = `wedge_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const priority = body.priority != null ? Number(body.priority) : 0;
  await db.prepare(
    `INSERT INTO agentsam_workflow_edges (
       id, workflow_id, from_node_key, to_node_key, condition_type, condition_json, priority, label
     ) VALUES (?, ?, ?, ?, ?, '{}', ?, ?)`,
  ).bind(edgeId, dagWorkflowId, from, to, body.condition_type != null ? String(body.condition_type) : 'always', priority, body.label != null ? String(body.label) : null).run();
  return { ok: true, id: edgeId, from_node_key: from, to_node_key: to };
}

export async function deleteWorkflowEdge(db, { dagWorkflowId, edgeId }) {
  const res = await db.prepare(`DELETE FROM agentsam_workflow_edges WHERE id = ? AND workflow_id = ?`).bind(edgeId, dagWorkflowId).run();
  const changes = res?.meta?.changes ?? res?.changes ?? 0;
  return changes ? { ok: true, id: edgeId } : { error: 'edge not found', status: 404 };
}

export async function patchWorkflowRegistry(db, registryId, body, opts = {}) {
  const workflow = await db.prepare(`SELECT id, metadata_json FROM agentsam_workflows WHERE id = ? LIMIT 1`).bind(registryId).first();
  if (!workflow) return { error: 'workflow not found', status: 404 };
  const fields = [];
  const vals = [];
  if (body.display_name != null) { fields.push('display_name = ?'); vals.push(String(body.display_name)); }
  if (body.description !== undefined) { fields.push('description = ?'); vals.push(body.description != null ? String(body.description) : null); }
  if (body.risk_level != null) { fields.push('risk_level = ?'); vals.push(String(body.risk_level)); }
  let metadataTouched = false;
  let nextMeta = parseJsonObject(workflow.metadata_json, {});
  if (body.metadata_json != null) { nextMeta = { ...nextMeta, ...parseJsonObject(body.metadata_json, {}) }; metadataTouched = true; }
  if (body.signed_off != null) {
    nextMeta = buildSignedOffMetadataPatch(nextMeta, { signedOff: body.signed_off === true, userId: opts.userId ?? null });
    metadataTouched = true;
  }
  if (metadataTouched) { fields.push('metadata_json = ?'); vals.push(JSON.stringify(nextMeta)); }
  if (!fields.length) return { ok: true, unchanged: true };
  fields.push(`updated_at = datetime('now')`);
  vals.push(registryId);
  await db.prepare(`UPDATE agentsam_workflows SET ${fields.join(', ')} WHERE id = ?`).bind(...vals).run();
  return { ok: true, id: registryId, signed_off: nextMeta.signed_off === true };
}

export { resolveDagWorkflowId };

export async function createWorkflowDefinition(db, {
  tenantId = null,
  workspaceId = null,
  displayName = 'New workflow',
  workflowKey = null,
  description = 'Created in Workflow Studio',
} = {}) {
  const name = String(displayName || 'New workflow').trim();
  const slugRaw = String(workflowKey || name)
    .trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 48);
  const key = slugRaw || `wf_${Date.now().toString(36)}`;
  const dup = await db.prepare(`SELECT id FROM agentsam_workflows WHERE workflow_key = ? LIMIT 1`).bind(key).first();
  if (dup?.id) return { ok: false, error: 'workflow_key_taken', workflow_key: key, status: 409 };
  const id = `wf_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  await db.prepare(
    `INSERT INTO agentsam_workflows (
       id, tenant_id, workspace_id, workflow_key, display_name, description,
       workflow_type, risk_level, is_active, is_platform_global, metadata_json,
       created_at_unix
     ) VALUES (?, ?, ?, ?, ?, ?, 'custom', 'low', 1, 0, ?, unixepoch())`,
  ).bind(
    id,
    tenantId != null ? String(tenantId) : null,
    workspaceId != null ? String(workspaceId) : null,
    key,
    name,
    String(description || '').trim(),
    JSON.stringify({ entry_node_key: 'start', source: 'workflow_studio_create' }),
  ).run();
  await createWorkflowNode(db, {
    registryId: id,
    dagWorkflowId: id,
    body: { node_key: 'start', title: 'Start', node_type: 'trigger', handler_key: 'manual_trigger', sort_order: 0 },
  });
  return { ok: true, id, workflow_key: key, display_name: name, status: 201 };
}

export async function listWorkflowStudioCatalog(db, { workspaceId, userId } = {}) {
  const wid = String(workspaceId || '').trim();
  const uid = String(userId || '').trim();
  if (!wid || !uid) return [];
  const { results } = await db.prepare(
    `SELECT
       w.id, w.workflow_key, w.display_name, w.description,
       w.risk_level, MAX(COALESCE(n.requires_approval, 0)) AS requires_approval,
       w.is_active, w.metadata_json,
       COUNT(DISTINCT n.id) AS node_count,
       COUNT(DISTINCT e.id) AS edge_count,
       COALESCE(rs.run_count, 0) AS run_count,
       COALESCE(rs.success_count, 0) AS success_count,
       COALESCE(rs.fail_count, 0) AS fail_count,
       rs.avg_cost_usd
     FROM agentsam_workflows w
     LEFT JOIN agentsam_workflow_nodes n
       ON n.workflow_id = w.id AND COALESCE(n.is_active, 1) = 1
     LEFT JOIN agentsam_workflow_edges e ON e.workflow_id = w.id
     LEFT JOIN (
       SELECT workflow_key, COUNT(*) AS run_count,
              SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS success_count,
              SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS fail_count,
              AVG(COALESCE(cost_usd,0)) AS avg_cost_usd
         FROM agentsam_workflow_runs
        WHERE workspace_id = ? AND user_id = ?
        GROUP BY workflow_key
     ) rs ON rs.workflow_key = w.workflow_key
     WHERE w.is_active = 1
     GROUP BY w.id
     ORDER BY w.display_name ASC`,
  ).bind(wid, uid).all();
  return results || [];
}
