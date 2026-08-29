/** Canonical agentsam_workflows lookup with tenant/workspace precedence. */
export async function resolveWorkflowRow(db, workflowKey, tenantId, workspaceId) {
  if (!db) return null;
  const key = String(workflowKey || '').trim();
  if (!key) return null;
  const tid = tenantId != null && String(tenantId).trim() !== '' ? String(tenantId).trim() : '';
  const wid = workspaceId != null && String(workspaceId).trim() !== '' ? String(workspaceId).trim() : '';

  if (tid && wid) {
    const exact = await db.prepare(
      `SELECT * FROM agentsam_workflows
       WHERE workflow_key = ? AND tenant_id = ?
         AND (workspace_id = ? OR workspace_id IS NULL)
         AND COALESCE(is_active, 1) = 1
       ORDER BY CASE WHEN workspace_id = ? THEN 0 ELSE 1 END, updated_at DESC
       LIMIT 1`,
    ).bind(key, tid, wid, wid).first();
    if (exact) return exact;
  }

  if (tid) {
    const tenantRow = await db.prepare(
      `SELECT * FROM agentsam_workflows
       WHERE workflow_key = ? AND tenant_id = ?
         AND workspace_id IS NULL AND COALESCE(is_active, 1) = 1
       ORDER BY updated_at DESC
       LIMIT 1`,
    ).bind(key, tid).first();
    if (tenantRow) return tenantRow;
  }

  return db.prepare(
    `SELECT * FROM agentsam_workflows
     WHERE workflow_key = ? AND tenant_id IS NULL AND workspace_id IS NULL
       AND COALESCE(is_platform_global, 0) = 1
       AND COALESCE(is_active, 1) = 1
     ORDER BY updated_at DESC
     LIMIT 1`,
  ).bind(key).first();
}

export async function getWorkflowById(db, workflowId) {
  if (!db || !workflowId) return null;
  return db.prepare(
    `SELECT * FROM agentsam_workflows WHERE id = ? AND COALESCE(is_active, 1) = 1 LIMIT 1`,
  ).bind(String(workflowId)).first();
}

/**
 * Resolve an active workflow template from registry data, without embedding
 * a workflow id or workflow key in runtime code.
 *
 * @param {any} db
 * @param {{
 *   tenantId?: string|null,
 *   triggerType?: string|null,
 *   defaultTaskType?: string|null,
 * }} selector
 */
export async function resolveWorkflowTemplate(db, selector = {}) {
  if (!db) return null;
  const tenantId = selector.tenantId != null ? String(selector.tenantId).trim() : '';
  const triggerType = selector.triggerType != null ? String(selector.triggerType).trim() : '';
  const defaultTaskType =
    selector.defaultTaskType != null ? String(selector.defaultTaskType).trim() : '';
  const clauses = ['COALESCE(is_active, 1) = 1'];
  const binds = [];

  if (triggerType) {
    clauses.push('trigger_type = ?');
    binds.push(triggerType);
  }
  if (defaultTaskType) {
    clauses.push('default_task_type = ?');
    binds.push(defaultTaskType);
  }
  if (tenantId) {
    clauses.push('(tenant_id = ? OR (tenant_id IS NULL AND COALESCE(is_platform_global, 0) = 1))');
    binds.push(tenantId);
  } else {
    clauses.push('tenant_id IS NULL AND COALESCE(is_platform_global, 0) = 1');
  }

  const orderBinds = tenantId ? [tenantId] : [];
  const tenantOrder = tenantId ? 'CASE WHEN tenant_id = ? THEN 0 ELSE 1 END, ' : '';
  const row = await db.prepare(
    `SELECT *
       FROM agentsam_workflows
      WHERE ${clauses.join(' AND ')}
      ORDER BY ${tenantOrder}updated_at DESC
      LIMIT 1`,
  ).bind(...binds, ...orderBinds).first();
  return row || null;
}

export async function listActiveWorkflowOptions(db, limit = 100) {
  if (!db) return [];
  const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
  const { results } = await db.prepare(
    `SELECT id, display_name AS name
       FROM agentsam_workflows
      WHERE COALESCE(is_active, 1) = 1
      ORDER BY display_name ASC
      LIMIT ?`,
  ).bind(safeLimit).all();
  return results || [];
}

export async function listWorkflowsForSubagentSlug(db, slug, limit = 50) {
  if (!db) return [];
  const normalized = String(slug || '').trim();
  if (!normalized) return [];
  const safeLimit = Math.max(1, Math.min(200, Math.floor(Number(limit) || 50)));
  const { results } = await db.prepare(
    `SELECT id, workflow_key, display_name, description, workflow_type
       FROM agentsam_workflows
      WHERE COALESCE(is_active, 1) = 1
        AND json_extract(metadata_json, '$.subagent_slug') = ?
      ORDER BY display_name ASC
      LIMIT ?`,
  ).bind(normalized, safeLimit).all();
  return results || [];
}
