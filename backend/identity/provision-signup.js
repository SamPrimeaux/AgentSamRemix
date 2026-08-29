/**
 * Atomic identity-plane provisioning (migration 299).
 * Single env.DB.batch — accounts, identities, tenants-as-orgs, workspaces, memberships,
 * plus dual-write to auth_users / workspace_members / tenant_workspaces / user_settings.
 */
import { generateAppUserId } from './ensure-app-user.js';
import { workspaceSlugFromTenantId } from './workspace/slug.js';
import { buildDefaultShieldRuleStatements } from './shield-rules.js';
import { upsertAuthUserEmail } from './users/index.js';

function trimOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function defaultPersonalWorkspaceId(userKey) {
  const normalized = String(userKey || '').trim().toLowerCase();
  const safe = normalized.replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
  return safe ? `ws_${safe}` : null;
}

async function pragmaTableInfo(db, tableName) {
  if (!db || !tableName) return new Set();
  const safe = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(String(tableName)) ? String(tableName) : '';
  if (!safe) return new Set();
  try {
    const { results } = await db.prepare(`PRAGMA table_info(${safe})`).all();
    return new Set((results || []).map((r) => String(r.name || '').toLowerCase()));
  } catch {
    return new Set();
  }
}

function normalizeTenantIdFromEmail(email) {
  const em = trimOrNull(email);
  const local = em && em.includes('@') ? em.split('@')[0] : em;
  const base = String(local || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20);
  return `tenant_${base}_${crypto.randomUUID().slice(0, 8)}`;
}

function userKeyFromEmail(email) {
  const em = trimOrNull(email);
  const local = em && em.includes('@') ? em.split('@')[0] : em;
  return (
    String(local || 'user')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32) || `user_${crypto.randomUUID().slice(0, 8)}`
  );
}

function tenantSlugFromId(tenantId) {
  const tid = trimOrNull(tenantId) || 'unknown';
  return tid.replace(/^tenant_/, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 63) || 'org';
}

function membershipId() {
  return `mbr_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/** Map auth_users.status → accounts.status CHECK (invited → pending). */
export function mapAccountStatusFromAuthUser(authStatus) {
  const s = (trimOrNull(authStatus) || 'active').toLowerCase();
  if (s === 'invited') return 'pending';
  if (s === 'active' || s === 'suspended' || s === 'pending' || s === 'deleted') return s;
  return 'active';
}

function tenantWorkspaceLinkId() {
  return `tws_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/**
 * @param {*} env
 * @param {{
 *   authUserId?: string|null,
 *   email: string,
 *   name?: string|null,
 *   passwordHash?: string|null,
 *   salt?: string|null,
 *   supabaseUserId?: string|null,
 *   provider?: string|null,
 *   providerSubject?: string|null,
 *   source?: string|null,
 *   accountType?: 'human'|'agent'|'system',
 *   allowCreateAuthUser?: boolean,
 * }} identity
 */
export async function provisionIdentitySignup(env, identity) {
  const email = String(identity.email || '')
    .toLowerCase()
    .trim();
  const name = trimOrNull(identity.name) || email.split('@')[0] || 'User';
  const accountType = identity.accountType === 'agent' || identity.accountType === 'system'
    ? identity.accountType
    : 'human';

  if (!env?.DB || !email) {
    return { ok: false, reason: 'no_db_or_email', authUserId: null, tenantId: null, workspaceId: null };
  }

  let authUserId = trimOrNull(identity.authUserId);
  let existingRow = null;

  if (authUserId) {
    existingRow = await env.DB.prepare(`SELECT * FROM auth_users WHERE id = ? LIMIT 1`)
      .bind(authUserId)
      .first()
      .catch(() => null);
  }
  if (!existingRow) {
    existingRow = await env.DB.prepare(`SELECT * FROM auth_users WHERE LOWER(email) = ? LIMIT 1`)
      .bind(email)
      .first()
      .catch(() => null);
    if (existingRow?.id) authUserId = String(existingRow.id);
  }

  const allowCreate = identity.allowCreateAuthUser !== false;
  if (!authUserId && allowCreate) {
    authUserId = generateAppUserId();
  }
  if (!authUserId) {
    return { ok: false, reason: 'no_auth_user', authUserId: null, tenantId: null, workspaceId: null };
  }

  const userKey =
    trimOrNull(existingRow?.user_key) || userKeyFromEmail(email);
  let tenantId =
    trimOrNull(existingRow?.active_tenant_id) ||
    trimOrNull(existingRow?.tenant_id) ||
    null;
  if (!tenantId) tenantId = normalizeTenantIdFromEmail(email);

  let workspaceId =
    trimOrNull(existingRow?.active_workspace_id) ||
    trimOrNull(existingRow?.default_workspace_id) ||
    defaultPersonalWorkspaceId(userKey);
  if (!workspaceId || !workspaceId.startsWith('ws_')) {
    workspaceId = defaultPersonalWorkspaceId(userKey) || workspaceSlugFromTenantId(tenantId);
  }

  const passwordHash =
    identity.passwordHash !== undefined && identity.passwordHash !== null
      ? identity.passwordHash
      : trimOrNull(existingRow?.password_hash) || 'oauth';
  const salt =
    identity.salt !== undefined && identity.salt !== null
      ? identity.salt
      : trimOrNull(existingRow?.salt) || 'oauth';
  const supabaseUserId = trimOrNull(identity.supabaseUserId);
  const provider = trimOrNull(identity.provider) || trimOrNull(identity.source) || 'email';
  const providerSubject =
    trimOrNull(identity.providerSubject) ||
    (provider === 'email' ? email : `${authUserId}:${provider}`);
  const tenantSlug = tenantSlugFromId(tenantId);
  const orgId = tenantId;
  const ptyPath = null;
  const nowSec = Math.floor(Date.now() / 1000);
  const membershipRowId = membershipId();
  const twsId = tenantWorkspaceLinkId();
  const wsHandle = workspaceId.replace(/^ws_/, '').slice(0, 60);
  const wsDisplayName = `${name} Workspace`;
  const accountStatus = mapAccountStatusFromAuthUser(existingRow?.status);

  const [tenantCols, wsCols, mCols] = await Promise.all([
    pragmaTableInfo(env.DB, 'tenants'),
    pragmaTableInfo(env.DB, 'workspaces'),
    pragmaTableInfo(env.DB, 'memberships'),
  ]);

  const batch = [];

  batch.push(
    env.DB.prepare(
      `INSERT OR IGNORE INTO auth_users (
         id, email, name, password_hash, salt, supabase_user_id, tenant_id,
         user_key, default_workspace_id, display_name, timezone, status,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'America/Chicago', 'active', datetime('now'), datetime('now'))`,
    ).bind(
      authUserId,
      email,
      name,
      passwordHash,
      salt,
      supabaseUserId,
      tenantId,
      userKey,
      workspaceId,
      name,
    ),
  );

  batch.push(
    env.DB.prepare(
      `INSERT OR IGNORE INTO accounts (
         id, type, email, display_name, password_hash, status, plan, timezone,
         meta_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'free', 'America/Chicago', '{}', ?, ?)`,
    ).bind(authUserId, accountType, email, name, passwordHash, accountStatus, nowSec, nowSec),
  );

  batch.push(
    env.DB.prepare(
      `UPDATE accounts SET
         email = COALESCE(NULLIF(TRIM(email), ''), ?),
         display_name = COALESCE(NULLIF(TRIM(display_name), ''), ?),
         status = ?,
         updated_at = ?
       WHERE id = ?`,
    ).bind(email, name, accountStatus, nowSec, authUserId),
  );

  if (tenantCols.has('slug')) {
    const tenantFields = ['id', 'name', 'slug', 'created_at', 'updated_at'];
    const tenantVals = ['?', '?', '?', 'unixepoch()', 'unixepoch()'];
    const tenantBinds = [tenantId, email || tenantId, tenantSlug];
    if (tenantCols.has('owner_account_id')) {
      tenantFields.push('owner_account_id');
      tenantVals.push('?');
      tenantBinds.push(authUserId);
    }
    if (tenantCols.has('meta_json')) {
      tenantFields.push('meta_json');
      tenantVals.push('?');
      tenantBinds.push('{}');
    }
    if (tenantCols.has('is_active')) {
      tenantFields.push('is_active');
      tenantVals.push('?');
      tenantBinds.push(1);
    }
    batch.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO tenants (${tenantFields.join(', ')}) VALUES (${tenantVals.join(', ')})`,
      ).bind(...tenantBinds),
    );
  } else {
    batch.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO tenants (id, name, created_at, updated_at) VALUES (?, ?, unixepoch(), unixepoch())`,
      ).bind(tenantId, email || tenantId),
    );
  }

  if (tenantCols.has('owner_account_id')) {
    batch.push(
      env.DB.prepare(
        `UPDATE tenants SET owner_account_id = ? WHERE id = ? AND (owner_account_id IS NULL OR TRIM(owner_account_id) = '')`,
      ).bind(authUserId, tenantId),
    );
  }

  const wsFields = ['id', 'name', 'handle', 'status', 'category', 'created_at'];
  const wsVals = ['?', '?', '?', "'active'", "'personal'", 'unixepoch()'];
  const wsBinds = [workspaceId, wsDisplayName, wsHandle];
  if (wsCols.has('tenant_id')) {
    wsFields.push('tenant_id');
    wsVals.push('?');
    wsBinds.push(tenantId);
  }
  if (wsCols.has('org_id')) {
    wsFields.push('org_id');
    wsVals.push('?');
    wsBinds.push(orgId);
  }
  if (wsCols.has('pty_path')) {
    wsFields.push('pty_path');
    wsVals.push('?');
    wsBinds.push(ptyPath);
  }
  if (wsCols.has('settings_json')) {
    wsFields.push('settings_json');
    wsVals.push('?');
    wsBinds.push('{}');
  }
  if (wsCols.has('display_name')) {
    wsFields.push('display_name');
    wsVals.push('?');
    wsBinds.push(wsDisplayName);
  }
  batch.push(
    env.DB.prepare(
      `INSERT OR IGNORE INTO workspaces (${wsFields.join(', ')}) VALUES (${wsVals.join(', ')})`,
    ).bind(...wsBinds),
  );

  if (wsCols.has('org_id') || wsCols.has('tenant_id') || wsCols.has('pty_path')) {
    const sets = [];
    const binds = [];
    if (wsCols.has('org_id')) {
      sets.push('org_id = COALESCE(NULLIF(TRIM(org_id), \'\'), ?)');
      binds.push(orgId);
    }
    if (wsCols.has('tenant_id')) {
      sets.push('tenant_id = COALESCE(NULLIF(TRIM(tenant_id), \'\'), ?)');
      binds.push(tenantId);
    }
    if (wsCols.has('pty_path')) {
      sets.push('pty_path = COALESCE(NULLIF(TRIM(pty_path), \'\'), ?)');
      binds.push(ptyPath);
    }
    if (sets.length) {
      binds.push(workspaceId);
      batch.push(
        env.DB.prepare(`UPDATE workspaces SET ${sets.join(', ')} WHERE id = ?`).bind(...binds),
      );
    }
  }

  if (mCols.size > 0) {
    batch.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO memberships (
           id, workspace_id, account_id, org_id, role,
           can_run_pty, can_run_mcp, can_deploy, joined_at, created_at
         ) VALUES (?, ?, ?, ?, 'owner', 1, 1, 0, unixepoch(), unixepoch())`,
      ).bind(membershipRowId, workspaceId, authUserId, orgId),
    );
  }

  const wsmId = `wsm_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  batch.push(
    env.DB.prepare(
      `INSERT OR IGNORE INTO workspace_members (id, workspace_id, user_id, tenant_id, role, email, display_name, is_active, joined_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'owner', ?, ?, 1, unixepoch(), unixepoch(), unixepoch())`,
    ).bind(wsmId, workspaceId, authUserId, tenantId, email, name),
  );

  batch.push(
    env.DB.prepare(
      `INSERT OR IGNORE INTO tenant_workspaces (id, tenant_id, workspace_id, role, is_default, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 'owner', 1, 1, unixepoch(), unixepoch())`,
    ).bind(twsId, tenantId, workspaceId),
  );

  batch.push(
    env.DB.prepare(
      `INSERT OR IGNORE INTO user_settings (user_id, theme, default_workspace_id, updated_at)
       VALUES (?, 'meaux-storm-gray', ?, unixepoch())`,
    ).bind(authUserId, workspaceId),
  );

  if (provider && providerSubject) {
    const aid = `aid_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    batch.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO account_identities (
           id, account_id, provider, provider_subject, email, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())`,
      ).bind(aid, authUserId, provider, providerSubject, email),
    );
  }

  batch.push(
    env.DB.prepare(
      `UPDATE auth_users SET
         tenant_id = COALESCE(NULLIF(TRIM(tenant_id), ''), ?),
         active_tenant_id = COALESCE(NULLIF(TRIM(active_tenant_id), ''), ?),
         active_workspace_id = COALESCE(NULLIF(TRIM(active_workspace_id), ''), ?),
         default_workspace_id = COALESCE(NULLIF(TRIM(default_workspace_id), ''), ?),
         user_key = COALESCE(NULLIF(TRIM(user_key), ''), ?),
         updated_at = datetime('now')
       WHERE id = ?`,
    ).bind(tenantId, tenantId, workspaceId, workspaceId, userKey, authUserId),
  );

  if (supabaseUserId) {
    batch.push(
      env.DB.prepare(
        `UPDATE auth_users SET supabase_user_id = COALESCE(supabase_user_id, ?), updated_at = datetime('now') WHERE id = ?`,
      ).bind(supabaseUserId, authUserId),
    );
  }

  for (const stmt of buildDefaultShieldRuleStatements(env, tenantId)) {
    batch.push(stmt);
  }

  try {
    await env.DB.batch(batch);
  } catch (e) {
    console.warn('[provisionIdentitySignup] batch failed', e?.message ?? e);
    return {
      ok: false,
      reason: 'batch_failed',
      authUserId,
      tenantId,
      workspaceId,
      error: String(e?.message || e),
    };
  }

  try {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO agentsam_workspace (id, tenant_id, display_name, created_at, updated_at)
       VALUES (?, ?, ?, unixepoch(), unixepoch())`,
    )
      .bind(workspaceId, tenantId, wsDisplayName)
      .run();
  } catch {
    /* schema variant — non-fatal */
  }

  try {
    const personRow = await env.DB.prepare(`SELECT person_uuid FROM auth_users WHERE id = ? LIMIT 1`)
      .bind(authUserId)
      .first();
    await upsertAuthUserEmail(env, {
      authUserId,
      email,
      personUuid: personRow?.person_uuid,
      tenantId,
      kind: 'primary',
    });
  } catch (e) {
    console.warn('[provisionIdentitySignup] auth_user_emails upsert:', e?.message ?? e);
  }

  return {
    ok: true,
    authUserId,
    tenantId,
    workspaceId,
    provisioned: !existingRow,
  };
}
