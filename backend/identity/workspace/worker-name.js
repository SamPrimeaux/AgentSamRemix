function trim(value) {
  return value == null ? '' : String(value).trim();
}

export async function setAgentsamWorkspaceWorkerName(env, workspaceId, workerName) {
  const wid = trim(workspaceId);
  const wn = trim(workerName);
  if (!env?.DB || !wid || !wn) return { ok: false, reason: 'missing_args' };
  try {
    const clash = await env.DB.prepare(
      `SELECT id FROM agentsam_workspace
       WHERE lower(trim(worker_name)) = lower(?)
         AND id != ?
         AND COALESCE(status, 'active') = 'active'
       LIMIT 1`,
    ).bind(wn, wid).first();
    if (clash?.id) return { ok: false, reason: 'worker_name_in_use', otherId: String(clash.id) };
    await env.DB.prepare(
      `UPDATE agentsam_workspace SET worker_name = ?, updated_at = unixepoch() WHERE id = ?`,
    ).bind(wn, wid).run();
    return { ok: true };
  } catch (error) {
    console.warn('[workspace-worker-name] set', error?.message ?? error);
    return { ok: false, reason: String(error?.message || error) };
  }
}

export async function lookupWorkspaceScopeByWorkerName(db, workerName) {
  const wn = trim(workerName);
  if (!db || !wn) return null;
  try {
    const { results } = await db.prepare(
      `SELECT id, tenant_id FROM agentsam_workspace
       WHERE lower(trim(worker_name)) = lower(?)
         AND COALESCE(status, 'active') = 'active'
       LIMIT 2`,
    ).bind(wn).all();
    const rows = Array.isArray(results) ? results : [];
    if (rows.length !== 1) return null;
    const row = rows[0];
    if (!row?.tenant_id || !String(row.tenant_id).trim()) return null;
    return {
      tenantId: String(row.tenant_id).trim(),
      workspaceId: row.id != null ? String(row.id).trim() : null,
    };
  } catch {
    return null;
  }
}

export async function maybeBackfillWorkspaceWorkerName(env, opts) {
  const wid = trim(opts?.workspaceId);
  const wn = trim(opts?.workerName);
  if (!env?.DB || !wid || !wn) return { ok: false, reason: 'missing_args' };
  try {
    const row = await env.DB.prepare(
      `SELECT worker_name FROM agentsam_workspace WHERE id = ? LIMIT 1`,
    ).bind(wid).first();
    const existing = trim(row?.worker_name);
    if (existing && existing.toLowerCase() === wn.toLowerCase()) return { ok: true, skipped: 'already_set' };
    if (existing) return { ok: false, reason: 'workspace_has_different_worker_name' };
    return setAgentsamWorkspaceWorkerName(env, wid, wn);
  } catch (error) {
    return { ok: false, reason: String(error?.message || error) };
  }
}
