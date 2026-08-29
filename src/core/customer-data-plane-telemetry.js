/**
 * Audit logging for customer / public / platform data-plane operations (no secrets).
 */

/**
 * @param {string} sql
 */
async function hashSql(sql) {
  const trimmed = String(sql || '').trim().slice(0, 4000);
  if (!trimmed) return null;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(trimmed));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * @param {any} env
 * @param {{
 *   user_id?: string|null,
 *   tenant_id?: string|null,
 *   workspace_id?: string|null,
 *   data_plane: string,
 *   owner_type?: string,
 *   provider?: string|null,
 *   connection_id?: string|null,
 *   external_project_id?: string|null,
 *   external_database_id?: string|null,
 *   operation_type: string,
 *   sql_class?: string|null,
 *   approval_id?: string|null,
 *   success: boolean,
 *   error_message?: string|null,
 *   duration_ms?: number,
 *   sql?: string|null,
 *   agent_run_id?: string|null,
 * }} evt
 */
export async function logCustomerDataPlaneEvent(env, evt) {
  const payload = {
    ts: new Date().toISOString(),
    user_id: evt.user_id ?? null,
    tenant_id: evt.tenant_id ?? null,
    workspace_id: evt.workspace_id ?? null,
    data_plane: String(evt.data_plane || ''),
    owner_type: evt.owner_type ?? null,
    provider: evt.provider ?? null,
    connection_id: evt.connection_id ?? null,
    external_project_id: evt.external_project_id ?? null,
    external_database_id: evt.external_database_id ?? null,
    operation_type: String(evt.operation_type || ''),
    sql_class: evt.sql_class ?? null,
    approval_id: evt.approval_id ?? null,
    success: evt.success === true,
    error_message: evt.error_message ? String(evt.error_message).slice(0, 500) : null,
    duration_ms: evt.duration_ms != null ? Number(evt.duration_ms) : null,
    agent_run_id: evt.agent_run_id ?? null,
    sql_hash: evt.sql ? await hashSql(evt.sql) : null,
  };

  console.info('[data-plane]', JSON.stringify(payload));

  if (!env?.DB) return;

  try {
    const cols = await env.DB.prepare(`PRAGMA table_info(agentsam_command_run)`).all();
    const names = new Set((cols.results || []).map((r) => String(r.name || '').toLowerCase()));
    if (!names.has('command_key')) return;

    const id = `dplane_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
    await env.DB.prepare(
      `INSERT INTO agentsam_command_run (
         id, user_id, tenant_id, workspace_id, command_key, status,
         stdout, stderr, duration_ms, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`,
    )
      .bind(
        id,
        payload.user_id || '',
        payload.tenant_id || '',
        payload.workspace_id || '',
        `data_plane:${payload.data_plane}:${payload.operation_type}`,
        payload.success ? 'completed' : 'failed',
        JSON.stringify(payload).slice(0, 8000),
        payload.error_message || '',
        payload.duration_ms ?? 0,
      )
      .run();
  } catch {
    /* non-fatal */
  }
}
