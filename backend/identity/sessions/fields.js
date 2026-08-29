/** Shared session field helpers and KV payload builders. */

export function trimSessionField(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

/** PRAGMA cache for auth_sessions column drift (e.g. supabase_user_id). */
let AUTH_SESSIONS_COLUMNS_CACHE = null;

export async function authSessionsColumns(env) {
  if (AUTH_SESSIONS_COLUMNS_CACHE) return AUTH_SESSIONS_COLUMNS_CACHE;
  if (!env?.DB) {
    AUTH_SESSIONS_COLUMNS_CACHE = new Set();
    return AUTH_SESSIONS_COLUMNS_CACHE;
  }
  try {
    const out = await env.DB.prepare('PRAGMA table_info(auth_sessions)').all();
    const cols = new Set();
    for (const row of out.results || []) cols.add(String(row.name || '').toLowerCase());
    AUTH_SESSIONS_COLUMNS_CACHE = cols;
  } catch {
    AUTH_SESSIONS_COLUMNS_CACHE = new Set();
  }
  return AUTH_SESSIONS_COLUMNS_CACHE;
}

/**
 * Safe KV payload for iam_sess_v1:* (cache only; D1 auth_sessions is canonical).
 * @param {string} sessionId
 * @param {object} fields
 */
export function buildSessionKvPayload(sessionId, fields = {}) {
  return {
    v: 1,
    session_id: sessionId,
    user_id: trimSessionField(fields.userId ?? fields.user_id) ?? null,
    tenant_id: trimSessionField(fields.tenantId ?? fields.tenant_id) ?? null,
    workspace_id: trimSessionField(fields.workspaceId ?? fields.workspace_id) ?? null,
    person_uuid: trimSessionField(fields.personUuid ?? fields.person_uuid) ?? null,
    supabase_user_id: trimSessionField(fields.supabaseUserId ?? fields.supabase_user_id) ?? null,
    email: trimSessionField(fields.email) ?? null,
    provider: trimSessionField(fields.provider) ?? null,
    display_name: trimSessionField(fields.displayName ?? fields.display_name) ?? null,
    avatar_url: trimSessionField(fields.avatarUrl ?? fields.avatar_url) ?? null,
    provider_subject: trimSessionField(fields.providerSubject ?? fields.provider_subject) ?? null,
    work_session_id: trimSessionField(fields.workSessionId ?? fields.work_session_id) ?? null,
    last_active_at:
      fields.lastActiveAt ?? fields.last_active_at ?? fields.lastActiveAtMs ?? null,
    expires_at: fields.expiresAt ?? fields.expires_at ?? fields.expiresAtIso ?? null,
  };
}

/** @param {object} row D1 auth_sessions row */
export function authSessionRowToKvPayload(row) {
  return buildSessionKvPayload(row.id, {
    userId: row.user_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    personUuid: row.person_uuid,
    supabaseUserId: row.supabase_user_id,
    email: row.email,
    provider: row.provider,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    providerSubject: row.provider_subject,
    workSessionId: row.work_session_id,
    lastActiveAt: row.last_active_at,
    expiresAt: row.expires_at,
  });
}

/** Session + KV fields derived from auth_users at login (workspace resolved separately). */
export function sessionFieldsFromAuthUser(userRow, sessionProvider, opts = {}) {
  const tenantId =
    trimSessionField(userRow?.active_tenant_id) || trimSessionField(userRow?.tenant_id) || null;
  const workspaceId =
    trimSessionField(opts.workspaceId) ||
    trimSessionField(userRow?.active_workspace_id) ||
    trimSessionField(userRow?.default_workspace_id) ||
    null;
  return {
    tenantId,
    personUuid: userRow?.person_uuid ?? null,
    supabaseUserId: userRow?.supabase_user_id ?? null,
    email: userRow?.email,
    provider: sessionProvider || 'email',
    providerSubject: opts.providerSubject ?? null,
    displayName: userRow?.display_name ?? userRow?.name ?? 'User',
    avatarUrl: userRow?.avatar_url ?? null,
    workspaceId,
  };
}

export function computeAuthCapabilities(membership, policy) {
  const policyPty = Number(policy?.can_run_pty) === 1;
  const memPty = Number(membership?.can_run_pty) === 1;
  const policyMcp = Number(policy?.can_run_mcp) === 1;
  const policyDeploy = Number(policy?.can_deploy) === 1;
  return {
    canRunPty: policyPty || memPty,
    canRunMcp: policyMcp || Number(membership?.can_run_mcp) === 1,
    canDeploy: policyDeploy || Number(membership?.can_deploy) === 1,
  };
}
