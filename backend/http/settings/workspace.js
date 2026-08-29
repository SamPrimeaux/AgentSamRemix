/**
 * Workspace-scoped settings APIs:
 * - GET    /api/settings/workspace
 * - GET    /api/settings/workspace/members
 * - POST   /api/settings/workspace/members/invite
 * - PATCH  /api/settings/workspace/members/:member_id
 * - DELETE /api/settings/workspace/members/:member_id
 * - PATCH  /api/settings/workspace/modules
 */

import { jsonResponse } from '../agentsam/shared.js';
import { fetchAuthUserTenantId } from '../../identity/users/tenant.js';
const WORKSPACE_CONTEXT_MISSING = 'WORKSPACE_CONTEXT_MISSING';
import { readAgentsamWorkspace, resolveWorkspaceOwnerUserId } from '../../identity/workspace/access.js';
import { sendResendEmail } from '../../services/email/resend.js';
import { resolveIdentity } from '../../identity/index.js';

const MODULES_TENANT_TABLE = ['tenant', 'modules'].join('_');

function trimOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

async function resolveAuthTenantId(env, authUser) {
  if (authUser?.tenant_id != null && String(authUser.tenant_id).trim() !== '') {
    return String(authUser.tenant_id).trim();
  }
  if (authUser?.id && env?.DB) {
    const tid = await fetchAuthUserTenantId(env, authUser.id).catch(() => null);
    if (tid) return tid;
  }
  if (authUser?.email && env?.DB) {
    const tid = await fetchAuthUserTenantId(env, authUser.email).catch(() => null);
    if (tid) return tid;
  }
  return null;
}
async function callerWorkspaceRole(env, workspaceId, userId) {
  if (!env?.DB || !workspaceId || !userId) return null;
  try {
    const ownerUserId = await resolveWorkspaceOwnerUserId(env, workspaceId);
    if (ownerUserId && ownerUserId === String(userId)) return 'owner';
  } catch (_) {}

  try {
    const row = await env.DB
      .prepare(
        `SELECT role FROM workspace_members
         WHERE workspace_id = ? AND user_id = ?
           AND COALESCE(is_active, 1) = 1
         LIMIT 1`,
      )
      .bind(workspaceId, userId)
      .first();
    return row?.role != null && String(row.role).trim() ? String(row.role).trim() : null;
  } catch (_) {
    return null;
  }
}

function roleCanAdminWorkspace(role) {
  return role === 'owner' || role === 'admin';
}

function envTenantModuleAllowlist(env) {
  const raw =
    (env?.TENANT_MODULE_ALLOWLIST && String(env.TENANT_MODULE_ALLOWLIST)) ||
    (env?.ALLOWED_TENANT_MODULE_KEYS && String(env.ALLOWED_TENANT_MODULE_KEYS)) ||
    '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function moduleKeyAllowed(env, moduleKey) {
  const k = String(moduleKey || '').trim();
  if (!k) return false;
  const allow = envTenantModuleAllowlist(env);
  if (allow.size) return allow.has(k);
  return [
    'agentsam',
    'cms',
    'learn',
    'billing',
    'integrations',
    'terminal',
    'rag',
    'studio',
  ].includes(k);
}

async function tableExists(db, tableName) {
  if (!db || !tableName) return false;
  try {
    const row = await db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
      .bind(String(tableName))
      .first();
    return !!row;
  } catch {
    return false;
  }
}

async function insertWorkspaceAudit(env, payload) {
  if (!env?.DB) return;
  const db = env.DB;
  const ok = await tableExists(db, 'workspace_audit_log');
  if (!ok) return;
  const id = `wal_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const created_at = Math.floor(Date.now() / 1000);
  const {
    workspace_id,
    actor_user_id,
    actor_email = null,
    action,
    entity_type = 'workspace',
    entity_id = null,
    metadata = null,
    severity = 'info',
    tenant_id = null,
  } = payload || {};

  const after_json = metadata != null ? JSON.stringify(metadata) : null;

  try {
    await db
      .prepare(
        `INSERT INTO workspace_audit_log (
          id, workspace_id, actor_type, actor_id, actor_email, action,
          entity_type, entity_id, before_json, after_json, severity, created_at
        ) VALUES (?, ?, 'user', ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      )
      .bind(
        id,
        workspace_id,
        actor_user_id,
        actor_email,
        action,
        entity_type,
        entity_id,
        after_json,
        severity,
        created_at,
      )
      .run();
  } catch (e) {
    console.warn('[settings-workspace audit insert failed]', e?.message ?? e);
  }
}

function normalizeEmail(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return s;
}

function memberStatusFromRow(r) {
  if (Number(r?.is_active) === 0) return 'removed';
  if (!r?.user_id) return 'invited';
  return 'active';
}

function computeMemberPermissions({ callerRole, callerUserId, row }) {
  const status = memberStatusFromRow(row);
  const is_self = !!(row?.user_id && callerUserId && String(row.user_id) === String(callerUserId));
  const is_admin = roleCanAdminWorkspace(callerRole);
  const is_owner = String(row?.role || '') === 'owner';

  const can_edit =
    is_admin &&
    !is_self &&
    !is_owner; // cannot change owner role

  const can_remove =
    is_admin &&
    !is_self &&
    !is_owner &&
    status !== 'removed';

  return { status, is_self, can_edit, can_remove };
}

async function assertNotLastActiveOwner(env, workspaceId, targetMemberId) {
  if (!env?.DB) return { ok: true };
  const db = env.DB;
  const target = await db
    .prepare(`SELECT id, role, user_id, is_active FROM workspace_members WHERE workspace_id = ? AND id = ? LIMIT 1`)
    .bind(workspaceId, targetMemberId)
    .first()
    .catch(() => null);

  if (!target) return { ok: true };
  const isOwner = String(target.role || '') === 'owner';
  const isActive = Number(target.is_active) !== 0;
  const hasUser = !!target.user_id;
  if (!isOwner || !isActive || !hasUser) return { ok: true };

  const row = await db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM workspace_members
       WHERE workspace_id = ?
         AND role = 'owner'
         AND COALESCE(is_active, 1) = 1
         AND user_id IS NOT NULL`,
    )
    .bind(workspaceId)
    .first()
    .catch(() => null);

  const c = Number(row?.c || 0);
  if (c <= 1) return { ok: false, error: 'Cannot modify last active owner' };
  return { ok: true };
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {any} ctx
 * @param {{ authUser: any, url: URL, pathLower: string, method: string, sessionUserId: string }} authContext
 * @returns {Promise<Response|null>}
 */
export async function handleSettingsWorkspaceRoutes(request, env, ctx, authContext) {
  void ctx;
  const { authUser, pathLower, method } = authContext || {};
  if (!authUser) return null;

  const isWorkspacePath =
    pathLower === '/api/settings/workspace' ||
    pathLower.startsWith('/api/settings/workspace/');

  if (!isWorkspacePath) return null;

  let identity;
  try {
    identity = await resolveIdentity(request, env);
  } catch (error) {
    const status = Number(error?.status);
    return jsonResponse(
      { error: error?.code || error?.message || 'Identity resolution failed' },
      status >= 400 && status < 600 ? status : 500,
    );
  }
  const resolvedWorkspaceId = identity.workspace?.id || null;

  // GET /api/settings/workspace
  if (pathLower === '/api/settings/workspace' && method === 'GET') {
    if (!env?.DB) return jsonResponse({ workspace: null, workspace_limits: null, tenant_modules: [] });

    const workspaceId = resolvedWorkspaceId;
    if (!workspaceId) return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING || 'WORKSPACE_CONTEXT_MISSING' }, 400);

    const aw = await readAgentsamWorkspace(env, workspaceId);
    if (!aw) return jsonResponse({ error: 'Workspace not found' }, 404);
    const ui = await env.DB.prepare(`SELECT settings_json, theme_id, user_id FROM workspaces WHERE id = ? LIMIT 1`)
      .bind(workspaceId)
      .first()
      .catch(() => null);
    const workspace = { ...aw, ...(ui || {}), slug: aw.workspace_slug, handle: aw.workspace_slug };

    const hasLimits = await tableExists(env.DB, 'workspace_limits');
    const workspace_limits = hasLimits
      ? await env.DB
          .prepare(`SELECT * FROM workspace_limits WHERE workspace_id = ? LIMIT 1`)
          .bind(workspaceId)
          .first()
          .catch(() => null)
      : null;

    const hasModules = await tableExists(env.DB, MODULES_TENANT_TABLE);
    let workspace_modules = [];
    if (hasModules) {
      const tenantIdForModules =
        workspace?.tenant_id != null && String(workspace.tenant_id).trim() !== ''
          ? String(workspace.tenant_id).trim()
          : await resolveAuthTenantId(env, authUser);

      if (tenantIdForModules) {
        workspace_modules = await env.DB
          .prepare(
            `SELECT module_key, is_enabled, updated_at
             FROM ${MODULES_TENANT_TABLE}
             WHERE tenant_id = ?
             ORDER BY module_key ASC`,
          )
          .bind(tenantIdForModules)
          .all()
          .then((r) => r.results || [])
          .catch(() => []);
      }
    }

    return jsonResponse({ workspace, workspace_limits, tenant_modules: workspace_modules });
  }

  // GET /api/settings/workspace/members
  if (pathLower === '/api/settings/workspace/members' && method === 'GET') {
    if (!env?.DB) return jsonResponse({ members: [] });

    const workspaceId = resolvedWorkspaceId;
    if (!workspaceId) return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING || 'WORKSPACE_CONTEXT_MISSING' }, 400);

    const callerId = String(authUser.id || '').trim();
    const callerRole = await callerWorkspaceRole(env, workspaceId, callerId);

    const { results } = await env.DB
      .prepare(
        `SELECT
          wm.id AS member_id,
          wm.user_id,
          COALESCE(u.email, au.email, wm.email) AS email,
          COALESCE(u.display_name, au.display_name, au.name, wm.display_name) AS display_name,
          wm.role,
          wm.is_active,
          wm.joined_at,
          wm.created_at
        FROM workspace_members wm
        LEFT JOIN users u ON u.auth_id = wm.user_id
        LEFT JOIN auth_users au ON au.id = wm.user_id
        WHERE wm.workspace_id = ?
        ORDER BY wm.created_at ASC`,
      )
      .bind(workspaceId)
      .all()
      .catch(() => ({ results: [] }));

    const members = (results || []).map((r) => {
      const perms = computeMemberPermissions({ callerRole, callerUserId: callerId, row: r });
      return {
        member_id: r?.member_id ?? null,
        user_id: r?.user_id ?? null,
        email: r?.email ?? null,
        display_name: r?.display_name ?? null,
        role: r?.role ?? 'member',
        status: perms.status,
        joined_at: r?.joined_at ?? r?.created_at ?? null,
        is_self: perms.is_self,
        can_edit: perms.can_edit,
        can_remove: perms.can_remove,
      };
    });

    return jsonResponse({ members });
  }

  // POST /api/settings/workspace/members/invite
  if (pathLower === '/api/settings/workspace/members/invite' && method === 'POST') {
    if (!env?.DB) return jsonResponse({ error: 'DB not configured' }, 503);

    const workspaceId = resolvedWorkspaceId;
    if (!workspaceId) return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING || 'WORKSPACE_CONTEXT_MISSING' }, 400);

    const callerId = String(authUser.id || '').trim();
    const callerRole = await callerWorkspaceRole(env, workspaceId, callerId);
    if (!roleCanAdminWorkspace(callerRole)) return jsonResponse({ error: 'Forbidden' }, 403);

    const hasMembers = await tableExists(env.DB, 'workspace_members');
    if (!hasMembers) return jsonResponse({ error: 'workspace_members table missing' }, 503);

    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body.email);
    const role = typeof body.role === 'string' ? body.role.trim().toLowerCase() : 'member';
    if (!email) return jsonResponse({ error: 'email required' }, 400);
    if (!['admin', 'member', 'viewer', 'billing'].includes(role)) return jsonResponse({ error: 'invalid role' }, 400);

    // Determine if this email maps to an existing auth user
    const au = await env.DB
      .prepare(`SELECT id FROM auth_users WHERE LOWER(email) = LOWER(?) LIMIT 1`)
      .bind(email)
      .first()
      .catch(() => null);
    const targetAuthUserId = au?.id != null && String(au.id).trim() !== '' ? String(au.id).trim() : null;

    // Duplicate handling
    const existing = await env.DB
      .prepare(
        `SELECT id, user_id, email, role, is_active
         FROM workspace_members
         WHERE workspace_id = ?
           AND (
             (user_id IS NOT NULL AND ? IS NOT NULL AND user_id = ?)
             OR (LOWER(COALESCE(email,'')) = LOWER(?))
           )
         LIMIT 1`,
      )
      .bind(workspaceId, targetAuthUserId, targetAuthUserId, email)
      .first()
      .catch(() => null);

    if (existing) {
      const status = memberStatusFromRow(existing);
      if (status === 'active') return jsonResponse({ error: 'already_member' }, 409);
      if (status === 'invited') return jsonResponse({ error: 'already_invited', member_id: existing.id }, 409);
      return jsonResponse({ error: 'member_removed_exists', member_id: existing.id }, 409);
    }

    const member_id = `wsm_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const ws = await readAgentsamWorkspace(env, workspaceId);
    const tenant_id = ws?.tenant_id != null && String(ws.tenant_id).trim() !== '' ? String(ws.tenant_id).trim() : (await resolveAuthTenantId(env, authUser));

    await env.DB
      .prepare(
        `INSERT INTO workspace_members (
          id, workspace_id, tenant_id, user_id, member_type, email, display_name,
          role, is_active, joined_at, created_at, updated_at
        ) VALUES (?, ?, ?, NULL, 'user', ?, NULL, ?, 1, NULL, unixepoch(), unixepoch())`,
      )
      .bind(member_id, workspaceId, tenant_id || null, email, role)
      .run();

    const wsName =
      ws?.display_name != null && String(ws.display_name).trim()
        ? String(ws.display_name).trim()
        : ws?.name != null && String(ws.name).trim()
          ? String(ws.name).trim()
          : workspaceId;

    const base =
      (env.ASSETS_BASE_URL && String(env.ASSETS_BASE_URL).trim()) ||
      (env.PUBLIC_APP_URL && String(env.PUBLIC_APP_URL).trim()) ||
      '';
    const inviteUrl = base ? `${base.replace(/\/$/, '')}/auth/login` : null;

    const emailResult = await sendResendEmail(env, {
      to: email,
      subject: `You’ve been invited to ${wsName}`,
      text:
        `You’ve been invited to join the workspace "${wsName}".\n` +
        (inviteUrl ? `Open: ${inviteUrl}\n` : '') +
        `\nIf you weren’t expecting this, you can ignore this email.`,
      tags: [{ name: 'type', value: 'workspace_invite' }],
    });

    if (emailResult?.error) {
      // rollback: do not leave a dead invite row
      await env.DB.prepare(`DELETE FROM workspace_members WHERE id = ? AND workspace_id = ?`).bind(member_id, workspaceId).run().catch(() => null);
      return jsonResponse({ error: 'invite_email_failed' }, 502);
    }

    await insertWorkspaceAudit(env, {
      workspace_id: workspaceId,
      tenant_id,
      actor_user_id: callerId,
      actor_email: authUser.email ?? null,
      action: 'member.invited',
      entity_type: 'member',
      entity_id: member_id,
      metadata: { email, role, invited: true },
    });

    return jsonResponse({ ok: true, member_id, status: 'invited', user_id: null, email, role }, 201);
  }

  // POST /api/settings/workspace/invites/:member_id/resend
  {
    const m = pathLower.match(/^\/api\/settings\/workspace\/invites\/([^/]+)\/resend$/);
    if (m && method === 'POST') {
      if (!env?.DB) return jsonResponse({ error: 'DB not configured' }, 503);

      const workspaceId = resolvedWorkspaceId;
      if (!workspaceId) return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING || 'WORKSPACE_CONTEXT_MISSING' }, 400);

      const callerId = String(authUser.id || '').trim();
      const callerRole = await callerWorkspaceRole(env, workspaceId, callerId);
      if (!roleCanAdminWorkspace(callerRole)) return jsonResponse({ error: 'Forbidden' }, 403);

      const memberId = decodeURIComponent(m[1] || '').trim();
      if (!memberId) return jsonResponse({ error: 'member_id required' }, 400);

      const invite = await env.DB
        .prepare(
          `SELECT id, email, role, user_id, is_active
           FROM workspace_members
           WHERE workspace_id = ? AND id = ?
           LIMIT 1`,
        )
        .bind(workspaceId, memberId)
        .first()
        .catch(() => null);
      if (!invite) return jsonResponse({ error: 'Not found' }, 404);

      if (Number(invite.is_active) === 0) return jsonResponse({ error: 'invite_removed' }, 400);
      if (invite.user_id != null && String(invite.user_id).trim() !== '') {
        return jsonResponse({ error: 'not_an_invite' }, 400);
      }

      const email = normalizeEmail(invite.email);
      if (!email) return jsonResponse({ error: 'invite_missing_email' }, 400);

      const ws = await readAgentsamWorkspace(env, workspaceId);
      const tenant_id =
        ws?.tenant_id != null && String(ws.tenant_id).trim() !== ''
          ? String(ws.tenant_id).trim()
          : await resolveAuthTenantId(env, authUser);

      const wsName =
        ws?.display_name != null && String(ws.display_name).trim()
          ? String(ws.display_name).trim()
          : ws?.name != null && String(ws.name).trim()
            ? String(ws.name).trim()
            : workspaceId;

      const base =
        (env.ASSETS_BASE_URL && String(env.ASSETS_BASE_URL).trim()) ||
        (env.PUBLIC_APP_URL && String(env.PUBLIC_APP_URL).trim()) ||
        '';
      const inviteUrl = base ? `${base.replace(/\/$/, '')}/auth/login` : null;

      const emailResult = await sendResendEmail(env, {
        to: email,
        subject: `You’ve been invited to ${wsName}`,
        text:
          `You’ve been invited to join the workspace "${wsName}".\n` +
          (inviteUrl ? `Open: ${inviteUrl}\n` : '') +
          `\nIf you weren’t expecting this, you can ignore this email.`,
        tags: [{ name: 'type', value: 'workspace_invite' }],
      });
      if (emailResult?.error) return jsonResponse({ error: 'invite_email_failed' }, 502);

      await insertWorkspaceAudit(env, {
        workspace_id: workspaceId,
        tenant_id,
        actor_user_id: callerId,
        actor_email: authUser.email ?? null,
        action: 'member.invite_resent',
        entity_type: 'member',
        entity_id: memberId,
        metadata: { email, role: invite.role ?? null, invited: true },
      });

      return jsonResponse({ ok: true, member_id: memberId });
    }
  }

  // PATCH/DELETE /api/settings/workspace/members/:member_id
  {
    const m = pathLower.match(/^\/api\/settings\/workspace\/members\/([^/]+)$/);
    if (m && (method === 'PATCH' || method === 'DELETE')) {
      if (!env?.DB) return jsonResponse({ error: 'DB not configured' }, 503);

      const workspaceId = resolvedWorkspaceId;
      if (!workspaceId) return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING || 'WORKSPACE_CONTEXT_MISSING' }, 400);

      const callerId = String(authUser.id || '').trim();
      const callerRole = await callerWorkspaceRole(env, workspaceId, callerId);
      if (!roleCanAdminWorkspace(callerRole)) return jsonResponse({ error: 'Forbidden' }, 403);

      const memberId = decodeURIComponent(m[1] || '').trim();
      if (!memberId) return jsonResponse({ error: 'member_id required' }, 400);

      const target = await env.DB
        .prepare(`SELECT * FROM workspace_members WHERE workspace_id = ? AND id = ? LIMIT 1`)
        .bind(workspaceId, memberId)
        .first()
        .catch(() => null);
      if (!target) return jsonResponse({ error: 'Not found' }, 404);

      const targetUserId = target?.user_id != null ? String(target.user_id).trim() : null;
      if (targetUserId && targetUserId === callerId) {
        if (method === 'DELETE') return jsonResponse({ error: 'Cannot remove self' }, 400);
      }

      if (String(target.role || '') === 'owner') {
        // Owner invariants:
        // - cannot demote/remove any owner
        // - cannot remove last active owner (extra safety)
        const lastOwnerCheck = await assertNotLastActiveOwner(env, workspaceId, memberId);
        if (!lastOwnerCheck.ok) return jsonResponse({ error: lastOwnerCheck.error }, 400);
        return jsonResponse({ error: 'Cannot modify owner' }, 400);
      }

      if (method === 'PATCH') {
        const body = await request.json().catch(() => ({}));
        const nextRole = typeof body.role === 'string' ? body.role.trim().toLowerCase() : '';
        if (!nextRole) return jsonResponse({ error: 'role required' }, 400);
        if (!['admin', 'member', 'viewer', 'billing'].includes(nextRole)) {
          return jsonResponse({ error: 'invalid role' }, 400);
        }
        if (targetUserId && targetUserId === callerId) return jsonResponse({ error: 'Cannot change own role' }, 400);

        await env.DB
          .prepare(`UPDATE workspace_members SET role = ?, updated_at = unixepoch() WHERE workspace_id = ? AND id = ?`)
          .bind(nextRole, workspaceId, memberId)
          .run();

        await insertWorkspaceAudit(env, {
          workspace_id: workspaceId,
          tenant_id: (await resolveAuthTenantId(env, authUser)) || null,
          actor_user_id: callerId,
          actor_email: authUser.email ?? null,
          action: 'member.role_updated',
          entity_type: 'member',
          entity_id: memberId,
          metadata: { target_user_id: targetUserId, role: nextRole, status: memberStatusFromRow(target) },
        });

        return jsonResponse({ ok: true });
      }

      if (method === 'DELETE') {
        if (targetUserId && targetUserId === callerId) return jsonResponse({ error: 'Cannot remove self' }, 400);

        await env.DB
          .prepare(`UPDATE workspace_members SET is_active = 0, updated_at = unixepoch() WHERE workspace_id = ? AND id = ?`)
          .bind(workspaceId, memberId)
          .run();

        await insertWorkspaceAudit(env, {
          workspace_id: workspaceId,
          tenant_id: (await resolveAuthTenantId(env, authUser)) || null,
          actor_user_id: callerId,
          actor_email: authUser.email ?? null,
          action: 'member.removed',
          entity_type: 'member',
          entity_id: memberId,
          metadata: { target_user_id: targetUserId, status: 'removed' },
        });

        return jsonResponse({ ok: true, status: 'removed' });
      }
    }
  }

  // PATCH /api/settings/workspace/modules
  if (pathLower === '/api/settings/workspace/modules' && method === 'PATCH') {
    if (!env?.DB) return jsonResponse({ error: 'DB not configured' }, 503);

    const workspaceId = resolvedWorkspaceId;
    if (!workspaceId) return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING || 'WORKSPACE_CONTEXT_MISSING' }, 400);

    const callerId = String(authUser.id || '').trim();
    const callerRole = await callerWorkspaceRole(env, workspaceId, callerId);
    if (!roleCanAdminWorkspace(callerRole)) return jsonResponse({ error: 'Forbidden' }, 403);

    if (!(await tableExists(env.DB, MODULES_TENANT_TABLE))) {
      return jsonResponse({ error: 'workspace modules table missing' }, 503);
    }

    const body = await request.json().catch(() => ({}));
    const module_key = typeof body.module_key === 'string' ? body.module_key.trim() : '';
    if (!module_key) return jsonResponse({ error: 'module_key required' }, 400);
    if (!moduleKeyAllowed(env, module_key)) return jsonResponse({ error: 'module_key not allowed' }, 400);
    const is_enabled = body.is_enabled === true || body.is_enabled === 1 || body.is_enabled === '1' ? 1 : 0;

    const ws = await readAgentsamWorkspace(env, workspaceId);
    const tenantId =
      ws?.tenant_id != null && String(ws.tenant_id).trim() !== ''
        ? String(ws.tenant_id).trim()
        : await resolveAuthTenantId(env, authUser);
    if (!tenantId) return jsonResponse({ error: 'Tenant required' }, 403);

    await env.DB
      .prepare(
        `INSERT INTO ${MODULES_TENANT_TABLE} (tenant_id, module_key, is_enabled, updated_at)
         VALUES (?, ?, ?, unixepoch())
         ON CONFLICT(tenant_id, module_key) DO UPDATE SET
           is_enabled = excluded.is_enabled,
           updated_at = excluded.updated_at`,
      )
      .bind(tenantId, module_key, is_enabled)
      .run();

    await insertWorkspaceAudit(env, {
      workspace_id: workspaceId,
      tenant_id: tenantId,
      actor_user_id: callerId,
      actor_email: authUser.email ?? null,
      action: is_enabled ? 'module.enabled' : 'module.disabled',
      entity_type: 'module',
      entity_id: module_key,
      metadata: { module_key, is_enabled: !!is_enabled },
    });

    return jsonResponse({ ok: true, module_key, is_enabled: !!is_enabled });
  }

  return null;
}
