import { jsonResponse } from '../core/responses.js';
import { getAuthUser, fetchAuthUserTenantId } from '../core/auth.js';
import { resolveEffectiveWorkspaceId } from '../../backend/identity/bootstrap.js';
import { logSecretAudit } from '../core/security-scan.js';
import { encryptWithVault, decryptWithVault } from '../../backend/identity/oauth/token-store.js';
import { isVaultConfigured, VAULT_SETUP_HINT } from '../../backend/credentials/vault-key-material.js';
import {
  getTenantLlmByokStatus,
  llmSecretNameForApiPlatform,
  listLlmKeysFromUserApiKeys,
  SECRET_NAME_TO_PROVIDER,
} from '../core/llm-byok-registry.js';

export { getTenantLlmByokStatus, llmSecretNameForApiPlatform };

const LLM_VAULT_PROJECT = 'iam_user_llm_keys';
const LLM_ALLOWED_NAMES = new Set(['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY']);

/** @type {Set<string> | null} */
let userSecretsColumnsCache = null;

/** @param {import('@cloudflare/workers-types').D1Database} db */
async function userSecretsColumns(db) {
  if (userSecretsColumnsCache) return userSecretsColumnsCache;
  const res = await db.prepare(`PRAGMA table_info(user_secrets)`).all();
  userSecretsColumnsCache = new Set((res.results || []).map((r) => String(r.name)));
  return userSecretsColumnsCache;
}

async function resolveUserTenantId(env, authUser) {
  if (authUser.tenant_id != null && String(authUser.tenant_id).trim() !== '') {
    return String(authUser.tenant_id).trim();
  }
  let tid = await fetchAuthUserTenantId(env, authUser.id);
  if (tid) return tid;
  if (authUser.email) {
    tid = await fetchAuthUserTenantId(env, authUser.email);
    if (tid) return tid;
  }
  return null;
}

/**
 * Authenticated vault scope — tenant is mandatory; workspace when request is available.
 * @returns {Promise<{ uid: string, tenantId: string, workspaceId: string | null } | { error: string, status: number }>}
 */
async function vaultAuthContext(env, authUser, request = null) {
  const uid = String(authUser?.id || '').trim();
  if (!uid) return { error: 'Unauthorized', status: 401 };
  const tenantId = await resolveUserTenantId(env, authUser);
  if (!tenantId) return { error: 'Tenant not configured for this account', status: 503 };
  let workspaceId = null;
  if (request) {
    const ws = await resolveEffectiveWorkspaceId(env, request, authUser, {});
    workspaceId = ws.workspaceId || null;
  }
  return { uid, tenantId, workspaceId };
}

/** Build `user_id = ? AND tenant_id = ?` (+ optional workspace) for user_secrets. */
function userSecretsScopeWhere(ctx, cols, opts = {}) {
  const parts = ['user_id = ?', 'tenant_id = ?'];
  const binds = [ctx.uid, ctx.tenantId];
  if (opts.workspaceId && cols.has('workspace_id')) {
    parts.push('workspace_id = ?');
    binds.push(opts.workspaceId);
  }
  return { clause: parts.join(' AND '), binds };
}

/**
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function fetchScopedUserSecret(env, ctx, secretId, extra = '') {
  const cols = await userSecretsColumns(env.DB);
  const scope = userSecretsScopeWhere(ctx, cols);
  const row = await env.DB.prepare(
    `SELECT * FROM user_secrets WHERE id = ? AND ${scope.clause}${extra ? ` AND ${extra}` : ''} LIMIT 1`,
  )
    .bind(secretId, ...scope.binds)
    .first();
  return row || null;
}

/**
 * BYOK slot status for model picker — canonical source: user_secrets (see llm-byok-registry.js).
 */

function vaultJson(data, status = 200) {
  return jsonResponse(data, status);
}

function vaultErr(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

export async function vaultDecrypt(env, encryptedB64) {
  return decryptWithVault(env, encryptedB64);
}

function vaultLast4(str) {
  return str ? str.slice(-4) : '????';
}

function vaultNewId(prefix = 'sec') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Event types that close the audit trail (prior open rows + new row marked resolved). */
const VAULT_AUDIT_CLOSURE_EVENTS = new Set(['rotated', 'revoked']);

/** @type {Set<string> | null} */
let secretAuditColumnsCache = null;

/** @param {import('@cloudflare/workers-types').D1Database} db */
async function secretAuditColumns(db) {
  if (secretAuditColumnsCache) return secretAuditColumnsCache;
  const res = await db.prepare(`PRAGMA table_info(secret_audit_log)`).all();
  secretAuditColumnsCache = new Set((res.results || []).map((r) => String(r.name)));
  return secretAuditColumnsCache;
}

/**
 * Mark unresolved audit rows for a secret as resolved (rotation/revoke from dashboard).
 * @param {import('@cloudflare/workers-types').D1Database} db
 */
async function vaultResolveOpenAuditEntries(db, { secret_id, tenant_id, resolved_notes }) {
  const cols = await secretAuditColumns(db);
  if (!cols.has('resolved') || !secret_id || !tenant_id) return;
  const note = String(resolved_notes || 'Resolved via dashboard vault action').slice(0, 500);
  const sets = ['resolved = 1'];
  const binds = [];
  if (cols.has('resolved_at')) {
    sets.push('resolved_at = unixepoch()');
  }
  if (cols.has('resolved_notes')) {
    sets.push('resolved_notes = ?');
    binds.push(note);
  }
  binds.push(secret_id, tenant_id);
  await db
    .prepare(
      `UPDATE secret_audit_log SET ${sets.join(', ')}
       WHERE secret_id = ? AND tenant_id = ? AND COALESCE(resolved, 0) = 0`,
    )
    .bind(...binds)
    .run();
}

/**
 * Insert one secret_audit_log row (schema-aligned: tenant_id required, optional resolved_*).
 * @param {import('@cloudflare/workers-types').D1Database} db
 */
async function vaultWriteAudit(db, opts) {
  const {
    secret_id,
    tenant_id,
    user_id = null,
    event_type,
    triggered_by = null,
    previous_last4 = null,
    new_last4 = null,
    notes = null,
    request = null,
    secret_source = 'user_secrets',
    resolved_notes = null,
  } = opts;

  if (!secret_id || !tenant_id || !event_type) return;

  const cols = await secretAuditColumns(db);
  const isClosure = VAULT_AUDIT_CLOSURE_EVENTS.has(event_type);
  const closureNote = String(
    resolved_notes || notes || `Closed by ${event_type} via dashboard`,
  ).slice(0, 500);

  if (isClosure) {
    await vaultResolveOpenAuditEntries(db, { secret_id, tenant_id, resolved_notes: closureNote });
  }

  const id = `saudit_${Math.random().toString(36).slice(2, 14)}`;
  const ip = request?.headers?.get('CF-Connecting-IP') || null;
  const ua = request?.headers?.get('User-Agent')?.slice(0, 200) || null;

  const row = {
    id,
    secret_id,
    secret_source,
    tenant_id,
    user_id: user_id || null,
    event_type,
    triggered_by: triggered_by || null,
    previous_last4: previous_last4 || null,
    new_last4: new_last4 || null,
    notes: notes || null,
    ip_address: ip,
    user_agent: ua,
    resolved: isClosure && cols.has('resolved') ? 1 : cols.has('resolved') ? 0 : undefined,
    resolved_at: isClosure && cols.has('resolved_at') ? 'unixepoch()' : undefined,
    resolved_notes: isClosure && cols.has('resolved_notes') ? closureNote : undefined,
  };

  const colNames = [];
  const placeholders = [];
  const binds = [];
  for (const [col, val] of Object.entries(row)) {
    if (val === undefined || !cols.has(col)) continue;
    colNames.push(col);
    if (val === 'unixepoch()') {
      placeholders.push('unixepoch()');
    } else {
      placeholders.push('?');
      binds.push(val);
    }
  }
  if (!colNames.includes('created_at') && cols.has('created_at')) {
    colNames.push('created_at');
    placeholders.push('unixepoch()');
  }

  await db
    .prepare(
      `INSERT INTO secret_audit_log (${colNames.join(', ')}) VALUES (${placeholders.join(', ')})`,
    )
    .bind(...binds)
    .run();
}

async function vaultCreateSecret(request, env, authUser) {
  if (!authUser) return vaultErr('Unauthorized', 401);
  const ctx = await vaultAuthContext(env, authUser, request);
  if ('error' in ctx) return vaultErr(ctx.error, ctx.status);
  const body = await request.json();
  const { secret_name, secret_value, service_name, description, project_label, project_id, tags, scopes_json, expires_at } = body;
  if (!secret_name || !secret_value) return vaultErr('secret_name and secret_value are required');
  const encrypted = await encryptWithVault(env, secret_value);
  const id = vaultNewId('sec');
  const last4val = vaultLast4(secret_value);
  const metadata = JSON.stringify({ last4: last4val });
  const cols = await userSecretsColumns(env.DB);
  const wsCol = ctx.workspaceId && cols.has('workspace_id') ? ', workspace_id' : '';
  const wsVal = ctx.workspaceId && cols.has('workspace_id') ? ', ?' : '';
  const createBinds = [
    id,
    ctx.uid,
    ctx.tenantId,
    secret_name,
    encrypted,
    service_name || null,
    description || null,
    project_label || null,
    project_id || null,
    tags || null,
    scopes_json ? JSON.stringify(scopes_json) : '[]',
    metadata,
    expires_at || null,
  ];
  if (ctx.workspaceId && cols.has('workspace_id')) createBinds.push(ctx.workspaceId);
  await env.DB.prepare(
    `INSERT INTO user_secrets (id, user_id, tenant_id, secret_name, secret_value_encrypted, service_name, description, project_label, project_id, tags, scopes_json, metadata_json, expires_at, is_active${wsCol})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1${wsVal})`,
  )
    .bind(...createBinds)
    .run();
  await vaultWriteAudit(env.DB, {
    secret_id: id,
    tenant_id: ctx.tenantId,
    user_id: ctx.uid,
    event_type: 'created',
    triggered_by: ctx.uid,
    new_last4: last4val,
    notes: `Created for service: ${service_name || 'unspecified'}`,
    request,
  });
  return vaultJson({ success: true, id, last4: last4val });
}

async function vaultListSecrets(request, env, authUser) {
  if (!authUser) return vaultErr('Unauthorized', 401);
  const ctx = await vaultAuthContext(env, authUser, request);
  if ('error' in ctx) return vaultErr(ctx.error, ctx.status);
  const url = new URL(request.url);
  const project = url.searchParams.get('project');
  const cols = await userSecretsColumns(env.DB);
  const scope = userSecretsScopeWhere(ctx, cols);
  let query = `SELECT id, secret_name, service_name, description, project_label, project_id, tags, scopes_json, metadata_json, is_active, expires_at, last_used_at, usage_count, created_at, updated_at
     FROM user_secrets WHERE ${scope.clause}`;
  const params = [...scope.binds];
  if (project) {
    query += ` AND project_label = ?`;
    params.push(project);
  }
  query += ` ORDER BY project_label ASC, service_name ASC, secret_name ASC`;
  const result = await env.DB.prepare(query).bind(...params).all();
  return vaultJson({ secrets: result.results });
}

async function vaultGetSecret(id, env, authUser) {
  if (!authUser) return vaultErr('Unauthorized', 401);
  const ctx = await vaultAuthContext(env, authUser, null);
  if ('error' in ctx) return vaultErr(ctx.error, ctx.status);
  const row = await fetchScopedUserSecret(env, ctx, id);
  if (!row) return vaultErr('Secret not found', 404);
  const {
    secret_value_encrypted: _enc,
    ...safe
  } = row;
  return vaultJson(safe);
}

async function vaultRevealSecret(id, eventType, request, env, authUser) {
  if (!authUser) return vaultErr('Unauthorized', 401);
  const ctx = await vaultAuthContext(env, authUser, request);
  if ('error' in ctx) return vaultErr(ctx.error, ctx.status);
  const row = await fetchScopedUserSecret(env, ctx, id, 'is_active = 1');
  if (!row) return vaultErr('Secret not found or inactive', 404);
  let plaintext;
  try {
    plaintext = await vaultDecrypt(env, row.secret_value_encrypted);
  } catch {
    return vaultErr('Decryption failed — master key may have changed', 500);
  }
  await env.DB.prepare(`UPDATE user_secrets SET last_used_at = unixepoch(), usage_count = usage_count + 1, updated_at = unixepoch() WHERE id = ? AND tenant_id = ? AND user_id = ?`)
    .bind(id, ctx.tenantId, ctx.uid)
    .run();
  await vaultWriteAudit(env.DB, {
    secret_id: id,
    tenant_id: ctx.tenantId,
    user_id: ctx.uid,
    event_type: eventType,
    notes: `Secret ${eventType} for ${row.service_name || 'unknown service'}`,
    request,
  });
  await logSecretAudit(env, {
    secretId: id,
    tenantId: ctx.tenantId,
    userId: authUser.id,
    eventType,
    triggeredBy: 'dashboard_ui',
    ipAddress: request.headers.get('CF-Connecting-IP'),
    userAgent: request.headers.get('User-Agent'),
  });
  return vaultJson({ value: plaintext });
}

async function vaultEditSecret(id, request, env, authUser) {
  if (!authUser) return vaultErr('Unauthorized', 401);
  const ctx = await vaultAuthContext(env, authUser, request);
  if ('error' in ctx) return vaultErr(ctx.error, ctx.status);
  const body = await request.json();
  const { secret_name, description, project_label, project_id, tags, scopes_json, expires_at } = body;
  const existing = await fetchScopedUserSecret(env, ctx, id);
  if (!existing) return vaultErr('Secret not found', 404);
  await env.DB.prepare(
    `UPDATE user_secrets SET secret_name = COALESCE(?, secret_name), description = COALESCE(?, description), project_label = COALESCE(?, project_label), project_id = COALESCE(?, project_id), tags = COALESCE(?, tags), scopes_json = COALESCE(?, scopes_json), expires_at = COALESCE(?, expires_at), updated_at = unixepoch()
     WHERE id = ? AND user_id = ? AND tenant_id = ?`,
  )
    .bind(
      secret_name || null,
      description || null,
      project_label || null,
      project_id || null,
      tags || null,
      scopes_json ? JSON.stringify(scopes_json) : null,
      expires_at || null,
      id,
      ctx.uid,
      ctx.tenantId,
    )
    .run();
  await vaultWriteAudit(env.DB, {
    secret_id: id,
    tenant_id: ctx.tenantId,
    user_id: ctx.uid,
    event_type: 'edited',
    notes: 'Metadata updated',
    request,
  });
  return vaultJson({ success: true });
}

async function vaultRotateSecret(id, request, env, authUser) {
  if (!authUser) return vaultErr('Unauthorized', 401);
  const ctx = await vaultAuthContext(env, authUser, request);
  if ('error' in ctx) return vaultErr(ctx.error, ctx.status);
  const body = await request.json();
  const { new_value } = body;
  if (!new_value) return vaultErr('new_value is required');
  const existing = await fetchScopedUserSecret(env, ctx, id);
  if (!existing) return vaultErr('Secret not found', 404);
  let oldLast4 = '????';
  try {
    const oldPlain = await vaultDecrypt(env, existing.secret_value_encrypted);
    oldLast4 = vaultLast4(oldPlain);
  } catch { }
  const newEncrypted = await encryptWithVault(env, new_value);
  const newLast4 = vaultLast4(new_value);
  const newMeta = JSON.stringify({ ...JSON.parse(existing.metadata_json || '{}'), last4: newLast4 });
  await env.DB.prepare(
    `UPDATE user_secrets SET secret_value_encrypted = ?, metadata_json = ?, updated_at = unixepoch()
     WHERE id = ? AND user_id = ? AND tenant_id = ?`,
  )
    .bind(newEncrypted, newMeta, id, ctx.uid, ctx.tenantId)
    .run();
  const rotationNotes = 'Secret rotated via dashboard';
  await vaultWriteAudit(env.DB, {
    secret_id: id,
    tenant_id: ctx.tenantId,
    user_id: ctx.uid,
    event_type: 'rotated',
    triggered_by: ctx.uid,
    previous_last4: oldLast4,
    new_last4: newLast4,
    notes: rotationNotes,
    request,
    resolved_notes: rotationNotes,
  });
  await logSecretAudit(env, {
    secretId: id,
    tenantId,
    userId: authUser.id,
    eventType: 'rotated',
    triggeredBy: 'dashboard_ui',
    previousLast4: oldLast4,
    newLast4: newLast4,
    notes: rotationNotes,
    ipAddress: request.headers.get('CF-Connecting-IP'),
    userAgent: request.headers.get('User-Agent'),
    closeAuditTrail: true,
    resolvedNotes: rotationNotes,
  });
  return vaultJson({ success: true, new_last4: newLast4 });
}

async function vaultRevokeSecret(id, env, request, authUser) {
  if (!authUser) return vaultErr('Unauthorized', 401);
  const ctx = await vaultAuthContext(env, authUser, request);
  if ('error' in ctx) return vaultErr(ctx.error, ctx.status);
  const existing = await fetchScopedUserSecret(env, ctx, id);
  if (!existing) return vaultErr('Secret not found', 404);
  await env.DB.prepare(
    `UPDATE user_secrets SET is_active = 0, updated_at = unixepoch() WHERE id = ? AND user_id = ? AND tenant_id = ?`,
  )
    .bind(id, ctx.uid, ctx.tenantId)
    .run();
  const revokeNotes = 'Secret revoked via dashboard';
  await vaultWriteAudit(env.DB, {
    secret_id: id,
    tenant_id: ctx.tenantId,
    user_id: ctx.uid,
    event_type: 'revoked',
    triggered_by: ctx.uid,
    notes: revokeNotes,
    request,
    resolved_notes: revokeNotes,
  });
  await logSecretAudit(env, {
    secretId: id,
    tenantId: ctx.tenantId,
    userId: authUser.id,
    eventType: 'revoked',
    triggeredBy: 'dashboard_ui',
    notes: revokeNotes,
    ipAddress: request.headers.get('CF-Connecting-IP'),
    userAgent: request.headers.get('User-Agent'),
    closeAuditTrail: true,
    resolvedNotes: revokeNotes,
  });
  return vaultJson({ success: true });
}

async function vaultGetSecretAudit(id, env, authUser) {
  if (!authUser) return vaultErr('Unauthorized', 401);
  const ctx = await vaultAuthContext(env, authUser, null);
  if ('error' in ctx) return vaultErr(ctx.error, ctx.status);
  const owned = await fetchScopedUserSecret(env, ctx, id);
  if (!owned) return vaultErr('Secret not found', 404);
  const rows = await env.DB.prepare(
    `SELECT * FROM secret_audit_log WHERE secret_id = ? AND tenant_id = ? ORDER BY created_at DESC LIMIT 100`,
  )
    .bind(id, ctx.tenantId)
    .all();
  return vaultJson({ audit: rows.results });
}

async function vaultListProjects(env, authUser) {
  if (!authUser) return vaultErr('Unauthorized', 401);
  const ctx = await vaultAuthContext(env, authUser, null);
  if ('error' in ctx) return vaultErr(ctx.error, ctx.status);
  const rows = await env.DB.prepare(
    `SELECT DISTINCT project_label, project_id, COUNT(*) as secret_count FROM user_secrets
     WHERE user_id = ? AND tenant_id = ? AND project_label IS NOT NULL AND is_active = 1
     GROUP BY project_label ORDER BY project_label ASC`,
  )
    .bind(ctx.uid, ctx.tenantId)
    .all();
  return vaultJson({ projects: rows.results });
}

async function vaultFullAudit(request, env, authUser) {
  if (!authUser) return vaultErr('Unauthorized', 401);
  const ctx = await vaultAuthContext(env, authUser, request);
  if ('error' in ctx) return vaultErr(ctx.error, ctx.status);
  const url = new URL(request.url);
  const eventType = url.searchParams.get('event_type') || '';
  const since = url.searchParams.get('since');
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') || '200', 10) || 200));
  let query = `SELECT sal.id, sal.secret_id, sal.secret_source, sal.tenant_id, sal.event_type, sal.triggered_by,
       sal.previous_last4, sal.new_last4, sal.notes, sal.resolved, sal.resolved_at, sal.resolved_notes,
       sal.ip_address, sal.user_agent, sal.created_at, us.secret_name, us.service_name, us.project_label
     FROM secret_audit_log sal
     INNER JOIN user_secrets us ON sal.secret_id = us.id AND us.user_id = ? AND us.tenant_id = ?
     WHERE sal.tenant_id = ?`;
  const params = [ctx.uid, ctx.tenantId, ctx.tenantId];
  if (eventType && ['created', 'viewed', 'copied', 'edited', 'rotated', 'revoked'].includes(eventType)) {
    query += ` AND sal.event_type = ?`;
    params.push(eventType);
  }
  if (since && /^\d+$/.test(since)) {
    query += ` AND sal.created_at >= ?`;
    params.push(since);
  }
  query += ` ORDER BY sal.created_at DESC LIMIT ?`;
  params.push(limit);
  const rows = await env.DB.prepare(query).bind(...params).all();
  return vaultJson({ audit: rows.results || [], filters: { event_type: eventType || null, since: since || null, limit } });
}

function vaultRegistry() {
  const secrets = [
    { name: 'AGENT_SAM_DEPLOY_HOOK_URL', type: 'secret', description: 'Workers Builds deploy hook URL (POST); agent-sam-trigger' },
    { name: 'ANTHROPIC_API_KEY', type: 'secret', description: 'Claude API' },
    {
      name: 'ANTHROPIC_WEBHOOK_SIGNING_KEY',
      type: 'secret',
      description: 'Managed Agents webhooks: whsec_… secret for POST /api/webhooks/anthropic (X-Webhook-Signature)',
    },
    { name: 'CF_ACCESS_CLIENT_ID', type: 'secret', description: 'Zero Trust / Access' },
    { name: 'CF_ACCESS_CLIENT_SECRET', type: 'secret', description: 'Zero Trust / Access' },
    { name: 'CLOUDFLARE_ACCOUNT_ID', type: 'plaintext', description: 'Account ID' },
    { name: 'CLOUDFLARE_API_TOKEN', type: 'secret', description: 'Workers, R2, D1, API' },
    { name: 'CLOUDFLARE_IMAGES_ACCOUNT_HASH', type: 'plaintext', description: 'Images account hash' },
    { name: 'CLOUDFLARE_IMAGES_TOKEN', type: 'secret', description: 'Images API' },
    { name: 'CLOUDFLARE_STREAM_TOKEN', type: 'secret', description: 'Stream API' },
    { name: 'DEPLOY_HOOK_SECRET', type: 'secret', description: 'Deploy webhooks' },
    { name: 'GITHUB_CLIENT_ID', type: 'plaintext', description: 'GitHub OAuth' },
    { name: 'GITHUB_CLIENT_SECRET', type: 'secret', description: 'GitHub OAuth' },
    { name: 'GITHUB_TOKEN', type: 'secret', description: 'GitHub PAT for github_repos / github_file (preferred over per-user OAuth when set)' },
    { name: 'GOOGLE_AI_API_KEY', type: 'secret', description: 'Google AI' },
    { name: 'GOOGLE_CLIENT_ID', type: 'plaintext', description: 'Google OAuth' },
    { name: 'GOOGLE_CLIENT_SECRET', type: 'secret', description: 'Google OAuth' },
    { name: 'GOOGLE_OAUTH_CLIENT_SECRET', type: 'secret', description: 'Google OAuth (alternate)' },
    { name: 'AGENTSAM_BRIDGE_KEY', type: 'secret', description: 'SSOT machine-to-machine auth (internal APIs, ExecOS, ingest, POST /api/auth/agent-session/mint)' },
    {
      name: 'AGENT_SESSION_DEFAULT_USER_ID',
      type: 'plaintext',
      description:
        'Optional: auth_users.id when mint body omits user_id/user_email (narrow CI user; prefer explicit body)',
    },
    { name: 'INGEST_SECRET', type: 'secret', description: 'DEPRECATED — send AGENTSAM_BRIDGE_KEY via X-Ingest-Secret or Bearer' },
    { name: 'INTERNAL_WEBHOOK_SECRET', type: 'secret', description: 'Reserved — /api/webhooks/internal route not yet implemented. Do not remove secret.' },
    { name: 'MCP_AUTH_TOKEN', type: 'secret', description: 'MCP server auth' },
    { name: 'TOKEN_SIGNING_KEY', type: 'secret', description: 'HMAC signing key for per-user MCP bearer tokens (32-byte)' },
    { name: 'MCP_AUTH_IDENTITY_USER_ID', type: 'secret', description: 'IAM user id for MCP_AUTH_TOKEN / AGENTSAM_BRIDGE_KEY legacy bearer identity' },
    { name: 'OPENAI_API_KEY', type: 'secret', description: 'OpenAI API' },
    { name: 'OPENAI_WEBHOOK_SECRET', type: 'secret', description: 'OpenAI webhooks (Standard Webhooks whsec_; legacy x-openai-signature fallback)' },
    { name: 'PTY_AUTH_TOKEN', type: 'secret', description: 'PTY / terminal' },
    { name: 'R2_ACCESS_KEY_ID', type: 'secret', description: 'R2 storage' },
    { name: 'R2_SECRET_ACCESS_KEY', type: 'secret', description: 'R2 storage' },
    { name: 'RESEND_API_KEY', type: 'secret', description: 'Transactional email' },
    { name: 'TERMINAL_SECRET', type: 'secret', description: 'Terminal auth' },
    { name: 'TERMINAL_WS_URL', type: 'secret', description: 'Terminal WebSocket URL' },
    { name: 'VAULT_MASTER_KEY', type: 'secret', description: 'Vault encryption' },
  ];
  const domains = [
    { type: 'workers.dev', value: 'inneranimalmedia.meauxbility.workers.dev', description: 'Preview URLs: *-inneranimalmedia.meauxbility.workers.dev' },
    { type: 'route', value: 'inneranimalmedia.com/*', description: 'Route' },
    { type: 'route', value: 'www.inneranimalmedia.com/*', description: 'Route' },
    { type: 'route', value: 'webhooks.inneranimalmedia.com/*', description: 'Route' },
    { type: 'custom_domain', value: 'inneranimalmedia.com', description: 'Custom domain' },
    { type: 'custom_domain', value: 'www.inneranimalmedia.com', description: 'Custom domain' },
    { type: 'custom_domain', value: 'webhooks.inneranimalmedia.com', description: 'Custom domain' },
  ];
  return vaultJson({ secrets, domains });
}

async function vaultStoreUserKey(request, env) {
  const authUser = await getAuthUser(request, env);
  if (!authUser) return vaultErr('Unauthorized', 401);
  const ctx = await vaultAuthContext(env, authUser, request);
  if ('error' in ctx) return vaultErr(ctx.error, ctx.status);
  const body = await request.json().catch(() => ({}));
  const keyName = String(body.key_name || body.secret_name || '').trim();
  const value = String(body.value ?? body.secret_value ?? '');
  if (!keyName || !value) return vaultErr('key_name and value are required', 400);
  if (!LLM_ALLOWED_NAMES.has(keyName)) {
    return vaultErr('key_name must be one of OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY', 400);
  }
  const provider = SECRET_NAME_TO_PROVIDER[keyName];
  if (!provider) return vaultErr('Unsupported key_name', 400);

  const existing = await env.DB.prepare(
    `SELECT id FROM user_secrets
     WHERE user_id = ?
       AND (tenant_id IS NULL OR tenant_id = '' OR tenant_id = ?)
       AND COALESCE(is_active, 1) = 1
       AND (
         LOWER(COALESCE(service_name, '')) = LOWER(?)
         OR LOWER(COALESCE(json_extract(metadata_json, '$.provider'), '')) = LOWER(?)
       )
     LIMIT 1`,
  )
    .bind(ctx.uid, ctx.tenantId, provider, provider)
    .first()
    .catch(() => null);

  const origin = new URL(request.url).origin;
  const headers = {
    'Content-Type': 'application/json',
    Cookie: request.headers.get('Cookie') || '',
  };
  if (ctx.workspaceId) headers['X-IAM-Workspace-Id'] = ctx.workspaceId;

  const settingsBody = {
    category: 'provider',
    provider,
    api_key: value,
    label: `${provider} (dashboard vault)`,
    scope: 'workspace',
    validate: false,
  };

  const settingsPath = existing?.id
    ? `/api/settings/keys/${encodeURIComponent(String(existing.id))}/rotate`
    : '/api/settings/keys';
  const res = await fetch(`${origin}${settingsPath}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(settingsBody),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    return vaultErr(j.message || j.error || 'Could not save key to Settings → Keys', res.status || 500);
  }

  const last4val = vaultLast4(value);
  return vaultJson({
    success: true,
    id: existing?.id ? String(existing.id) : j.id ? String(j.id) : null,
    key_name: keyName,
    masked: maskApiKeyPreview(value, last4val),
    source: 'user_secrets',
  });
}

function maskApiKeyPreview(plain, last4) {
  const l4 = last4 || '????';
  const p = String(plain || '');
  if (!p) return `stored…${l4}`;
  if (p.startsWith('sk-ant')) return `sk-ant-...${l4}`;
  if (p.startsWith('sk-')) return `sk-...${l4}`;
  if (p.length > 8) return `${p.slice(0, 4)}...${l4}`;
  return `••••${l4}`;
}

async function vaultListUserLlmKeys(request, env) {
  const authUser = await getAuthUser(request, env);
  if (!authUser) return vaultErr('Unauthorized', 401);
  const ctx = await vaultAuthContext(env, authUser, request);
  if ('error' in ctx) return vaultErr(ctx.error, ctx.status);
  const rows = await listLlmKeysFromUserApiKeys(env, ctx.tenantId, ctx.uid);
  return vaultJson({ keys: rows });
}

async function vaultDeleteUserLlmKey(request, env, id) {
  const authUser = await getAuthUser(request, env);
  if (!authUser) return vaultErr('Unauthorized', 401);
  const ctx = await vaultAuthContext(env, authUser, request);
  if ('error' in ctx) return vaultErr(ctx.error, ctx.status);

  const keyId = String(id || '').trim();
  if (keyId.startsWith('uak_')) {
    const origin = new URL(request.url).origin;
    const headers = { Cookie: request.headers.get('Cookie') || '' };
    if (ctx.workspaceId) headers['X-IAM-Workspace-Id'] = ctx.workspaceId;
    const res = await fetch(`${origin}/api/settings/keys/${encodeURIComponent(keyId)}`, {
      method: 'DELETE',
      headers,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return vaultErr(j.message || j.error || 'Revoke failed', res.status || 500);
    return vaultJson({ ok: true, revoked: true, source: 'user_secrets' });
  }

  const row = await env.DB.prepare(
    `SELECT id FROM user_secrets
     WHERE id = ? AND tenant_id = ? AND user_id = ? AND project_label = ? AND is_active = 1 LIMIT 1`,
  )
    .bind(keyId, ctx.tenantId, ctx.uid, LLM_VAULT_PROJECT)
    .first();
  if (!row) return vaultErr('Not found', 404);
  await env.DB.prepare(
    `UPDATE user_secrets SET is_active = 0, updated_at = unixepoch() WHERE id = ? AND tenant_id = ? AND user_id = ?`,
  )
    .bind(keyId, ctx.tenantId, ctx.uid)
    .run();
  const llmRevokeNotes = 'User removed legacy LLM API key';
  await vaultWriteAudit(env.DB, {
    secret_id: keyId,
    tenant_id: ctx.tenantId,
    user_id: ctx.uid,
    event_type: 'revoked',
    triggered_by: ctx.uid,
    notes: llmRevokeNotes,
    request,
    resolved_notes: llmRevokeNotes,
  });
  await logSecretAudit(env, {
    secretId: keyId,
    tenantId: ctx.tenantId,
    userId: ctx.uid,
    eventType: 'revoked',
    triggeredBy: 'dashboard_ui',
    notes: llmRevokeNotes,
    closeAuditTrail: true,
    resolvedNotes: llmRevokeNotes,
  });
  return vaultJson({ ok: true, revoked: true, source: 'iam_user_llm_keys_legacy' });
}

export async function handleVaultApi(request, urlIn, env, _ctx) {
  if (!isVaultConfigured(env)) {
    return vaultErr(`Vault encryption not configured. Run: ${VAULT_SETUP_HINT}`, 500);
  }
  const url = urlIn instanceof URL ? urlIn : new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (path === '/api/vault/store' && method === 'POST') return vaultStoreUserKey(request, env);
  if (path === '/api/vault/llm-keys' && method === 'GET') return vaultListUserLlmKeys(request, env);
  const llmDel = path.match(/^\/api\/vault\/llm-keys\/([^/]+)$/);
  if (llmDel && method === 'DELETE') return vaultDeleteUserLlmKey(request, env, llmDel[1]);

  if (path === '/api/vault/registry' && method === 'GET') return vaultRegistry();

  const vaultAuthUser = await getAuthUser(request, env);
  if (path === '/api/vault/projects' && method === 'GET') return vaultListProjects(env, vaultAuthUser);
  if (path === '/api/vault/audit' && method === 'GET') return vaultFullAudit(request, env, vaultAuthUser);

  if (path === '/api/vault/secrets') {
    if (method === 'GET') return vaultListSecrets(request, env, vaultAuthUser);
    if (method === 'POST') return vaultCreateSecret(request, env, vaultAuthUser);
  }

  const secretMatch = path.match(/^\/api\/vault\/secrets\/([^/]+)(\/(.+))?$/);
  if (secretMatch) {
    const id = secretMatch[1];
    const action = secretMatch[3];
    if (action === 'reveal' && method === 'POST') return vaultRevealSecret(id, 'viewed', request, env, vaultAuthUser);
    if (action === 'copy' && method === 'POST') return vaultRevealSecret(id, 'copied', request, env, vaultAuthUser);
    if (action === 'rotate' && method === 'POST') return vaultRotateSecret(id, request, env, vaultAuthUser);
    if (action === 'audit' && method === 'GET') return vaultGetSecretAudit(id, env, vaultAuthUser);
    if (!action && method === 'GET') return vaultGetSecret(id, env, vaultAuthUser);
    if (!action && method === 'PUT') return vaultEditSecret(id, request, env, vaultAuthUser);
    if (!action && method === 'DELETE') return vaultRevokeSecret(id, env, request, vaultAuthUser);
  }

  return vaultErr('Not found', 404);
}
