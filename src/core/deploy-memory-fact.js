/**
 * Structured deploy facts for agentsam_memory — DISABLED (curation Stage 1).
 * Real deploy ledger: D1 `deployments` (post-deploy-record.sh).
 * Kept as no-op for quick revert if a downstream reader still expects the call.
 * SSOT: tkt_agentsam_memory_curation_2026_07
 */

const SOURCE = 'post_deploy_hook';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function isD1WorkspaceId(v) {
  return /^ws_[a-z0-9_]+$/i.test(trim(v));
}

function isD1AuthUserId(v) {
  return /^au_[a-f0-9]+$/i.test(trim(v));
}

function readEnvScope(env) {
  return {
    tenantId: trim(env?.TENANT_ID ?? env?.DEPLOY_TENANT_ID ?? env?.DEFAULT_TENANT_ID),
    workspaceId: trim(env?.WORKSPACE_ID ?? env?.DEPLOY_WORKSPACE_ID),
    userId: trim(env?.D1_AUTH_USER_ID ?? env?.IAM_D1_AUTH_USER_ID ?? env?.OPERATOR_USER_ID),
  };
}

function readBodyScope(body) {
  const workspaceId = trim(
    body?.d1_workspace_id ?? body?.workspace_d1_id ?? body?.workspace_id,
  );
  return {
    tenantId: trim(body?.tenant_id ?? body?.tenantId),
    workspaceId: isD1WorkspaceId(workspaceId) ? workspaceId : '',
    userId: trim(body?.user_id ?? body?.d1_auth_user_id),
  };
}

function readFieldsScope(fields) {
  const workspaceId = trim(fields?.workspaceId);
  return {
    tenantId: trim(fields?.tenantId),
    workspaceId: isD1WorkspaceId(workspaceId) ? workspaceId : '',
    userId: trim(fields?.userId),
  };
}

/**
 * Resolve memory scope from explicit deploy inputs, then D1 auth rows. No platform-id fallbacks.
 */
export async function resolveDeployMemoryScope(db, env, fields = {}, body = {}) {
  const fromFields = readFieldsScope(fields);
  const fromBody = readBodyScope(body);
  const fromEnv = readEnvScope(env);

  let tenantId = fromFields.tenantId || fromBody.tenantId || fromEnv.tenantId;
  let workspaceId = fromFields.workspaceId || fromBody.workspaceId || fromEnv.workspaceId;
  let userId = fromFields.userId || fromBody.userId || fromEnv.userId;

  if (!isD1AuthUserId(userId)) userId = '';
  if (!isD1WorkspaceId(workspaceId)) workspaceId = '';

  if (db && userId && (!tenantId || !workspaceId)) {
    const row = await db
      .prepare(
        `SELECT COALESCE(NULLIF(trim(active_tenant_id), ''), NULLIF(trim(tenant_id), '')) AS tenant_id,
                COALESCE(NULLIF(trim(active_workspace_id), ''), '') AS workspace_id
         FROM auth_users WHERE id = ? LIMIT 1`,
      )
      .bind(userId)
      .first()
      .catch(() => null);

    if (!tenantId && row?.tenant_id) tenantId = trim(row.tenant_id);
    const activeWs = trim(row?.workspace_id);
    if (!workspaceId && isD1WorkspaceId(activeWs)) workspaceId = activeWs;
  }

  if (db && userId && !workspaceId) {
    const mem = await db
      .prepare(
        `SELECT workspace_id FROM memberships WHERE account_id = ? ORDER BY joined_at ASC LIMIT 1`,
      )
      .bind(userId)
      .first()
      .catch(() => null);
    const ws = trim(mem?.workspace_id);
    if (isD1WorkspaceId(ws)) workspaceId = ws;
  }

  return { tenantId, workspaceId, userId };
}

/** @param {Record<string, unknown>} fields */
export function buildDeployFactPayload(fields) {
  const shortSha = trim(fields.gitHash ?? fields.shortSha ?? fields.version).slice(0, 12);
  const environment = trim(fields.environment) || 'production';
  const deployedAt = trim(fields.deployedAt) || new Date().toISOString();
  return {
    environment,
    deploy_sha: shortSha || null,
    full_sha: trim(fields.gitHash) || null,
    branch: trim(fields.branchName) || 'main',
    latest_commit_message: trim(fields.description ?? fields.gitMessage) || null,
    deployed_at: deployedAt,
    source: SOURCE,
  };
}

/**
 * NO-OP (Stage 1 curation). Does not write agentsam_memory.
 * Call site kept for quick revert path; enable flag is emergency-only and still no-ops hard.
 */
export async function upsertDeployMemoryFacts(_db, _env, _fields, _body = {}) {
  return {
    ok: true,
    skipped: true,
    reason: 'deploy_memory_facts_disabled',
    ticket: 'tkt_agentsam_memory_curation_2026_07',
  };
}
