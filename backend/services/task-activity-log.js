/**
 * Append-only task_activity events for agentsam_todo lifecycle.
 */

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @param {*} db
 * @param {{ taskId: string, tenantId?: string|null, userId?: string|null, action: string, changes?: object|null, taskSource?: string }} opts
 */
export async function logTaskActivity(db, opts) {
  if (!db || !opts?.taskId || !opts?.action) return;
  const tenantId = trim(opts.tenantId);
  if (!tenantId) return;
  const id = `ta_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const now = Math.floor(Date.now() / 1000);
  const changes =
    opts.changes != null && typeof opts.changes === 'object'
      ? JSON.stringify({ ...opts.changes, task_source: opts.taskSource || 'agentsam_todo' })
      : null;
  try {
    await db
      .prepare(
        `INSERT INTO task_activity (id, task_id, task_source, tenant_id, workspace_id, user_id, action, changes_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        trim(opts.taskId),
        trim(opts.taskSource) || 'agentsam_todo',
        tenantId,
        trim(opts.workspaceId) || null,
        trim(opts.userId) || null,
        trim(opts.action).slice(0, 64),
        changes,
        now,
      )
      .run();
  } catch (e) {
    console.warn('[task-activity-log]', e?.message ?? e);
  }
}

/**
 * @param {Record<string, unknown>|null|undefined} existing
 * @param {Record<string, unknown>} body
 */
export function taskActivityChangesFromPatch(existing, body) {
  const changes = {};
  if (body.status != null && String(body.status) !== String(existing?.status || '')) {
    changes.field = 'status';
    changes.from = existing?.status ?? null;
    changes.to = body.status;
  }
  if (body.project_id != null && String(body.project_id) !== String(existing?.project_id || '')) {
    changes.field = 'project_id';
    changes.from = existing?.project_id ?? null;
    changes.to = body.project_id;
  }
  if (Object.keys(changes).length === 0) return null;
  return changes;
}
