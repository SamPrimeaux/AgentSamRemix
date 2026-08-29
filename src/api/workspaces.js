/**
 * Workspaces API — SSOT reads/writes use `agentsam_workspace`; `workspaces` holds UI compat
 * (settings_json, state_json, theme_id, user_id) until fully retired.
 *
 * Multi-tenant: env.R2, env.AI, env.DB are this Worker’s bindings. Other tenants’ Cloudflare
 * credentials belong in workspace_secrets (encrypted_value BLOB), not env bindings.
 */
import { jsonResponse, fetchAuthUserTenantId } from '../core/auth.js';
import {
  agentsamWorkspaceExists,
  AGENTSAM_WORKSPACE_BINDING_PATCH_KEYS,
  getWorkspaceOwnerUserId,
  insertAgentsamWorkspaceRow,
  patchAgentsamWorkspaceFromApiCol,
} from '../../backend/identity/workspace/agentsam-workspace.js';
import { userCanAccessWorkspace, workspaceMemberUserCandidates } from '../core/workspace-access.js';
import { listAccessibleWorkspaces } from '../../backend/identity/workspace/access.js';

/** @param {any} env */
async function resolveAuthTenantId(env, authUser) {
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

function slugify(name) {
  const s = String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return s || 'workspace';
}

function parseJsonSafe(str, fallback = {}) {
  if (str == null || str === '') return { ...fallback };
  try {
    const o = typeof str === 'string' ? JSON.parse(str) : str;
    return typeof o === 'object' && o !== null ? o : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

/** @param {import('@cloudflare/workers-types').D1Database} db */
async function fetchUserDisplayName(db, userId) {
  if (!db || !userId) return null;
  try {
    const row = await db.prepare(`SELECT display_name, name FROM auth_users WHERE id = ? LIMIT 1`).bind(userId).first();
    const dn = row?.display_name ?? row?.name;
    return dn != null && String(dn).trim() ? String(dn).trim() : null;
  } catch {
    return null;
  }
}

/**
 * Upsert daily usage counters (internal — call from other handlers).
 * @param {any} env
 * @param {string} workspaceId
 * @param {string|null} tenantId
 * @param {string} userId
 * @param {number} tokensDelta
 * @param {number} costCentsDelta
 */
export async function trackWorkspaceUsage(env, workspaceId, tenantId, userId, tokensDelta, costCentsDelta) {
  if (!env?.DB || !workspaceId || !userId) return;
  const tid = tenantId != null ? String(tenantId).trim() : '';
  const uid = String(userId).trim();
  const tk = Number(tokensDelta) || 0;
  const cc = Number(costCentsDelta) || 0;
  const id = `wum_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const now = Math.floor(Date.now() / 1000);
  try {
    await env.DB.prepare(
      `INSERT INTO workspace_usage_metrics (
        id, workspace_id, tenant_id, user_id, metric_date,
        api_calls_used, tokens_used, cost_estimate_cents, created_at, updated_at
      ) VALUES (?, ?, ?, ?, date('now'), 1, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, metric_date) DO UPDATE SET
        api_calls_used = workspace_usage_metrics.api_calls_used + 1,
        tokens_used = workspace_usage_metrics.tokens_used + excluded.tokens_used,
        cost_estimate_cents = workspace_usage_metrics.cost_estimate_cents + excluded.cost_estimate_cents,
        updated_at = excluded.updated_at`,
    )
      .bind(id, workspaceId, tid || null, uid, tk, cc, now, now)
      .run();
  } catch (e) {
    console.warn('[trackWorkspaceUsage]', e?.message ?? e);
  }
}

/** @param {import('@cloudflare/workers-types').D1Database} db */
async function insertAuditLog(db, params) {
  const id = `wal_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const {
    workspace_id,
    actor_type = 'user',
    actor_id,
    actor_email = null,
    action,
    entity_type = 'workspace',
    entity_id,
    before_json = null,
    after_json = null,
    severity = 'info',
  } = params;
  const created_at = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO workspace_audit_log (
        id, workspace_id, actor_type, actor_id, actor_email, action,
        entity_type, entity_id, before_json, after_json, severity, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      workspace_id,
      actor_type,
      actor_id,
      actor_email,
      action,
      entity_type,
      entity_id,
      before_json,
      after_json,
      severity,
      created_at,
    )
    .run();
}

/** @param {import('@cloudflare/workers-types').D1Database} db */
async function upsertConnectivity(db, workspaceId, service, status, latencyMs, detailObj) {
  const detail_json = JSON.stringify(detailObj ?? {});
  const nowSec = Math.floor(Date.now() / 1000);
  const lastHealthyIns = status === 'healthy' ? nowSec : null;
  await db
    .prepare(
      `INSERT INTO workspace_connectivity_status (
        workspace_id, service, status, last_checked_at, last_healthy_at, latency_ms, detail_json
      ) VALUES (?, ?, ?, unixepoch(), ?, ?, ?)
      ON CONFLICT(workspace_id, service) DO UPDATE SET
        status = excluded.status,
        last_checked_at = excluded.last_checked_at,
        last_healthy_at = CASE
          WHEN excluded.status = 'healthy' THEN excluded.last_healthy_at
          ELSE workspace_connectivity_status.last_healthy_at
        END,
        latency_ms = excluded.latency_ms,
        detail_json = excluded.detail_json`,
    )
    .bind(workspaceId, service, status, lastHealthyIns, latencyMs, detail_json)
    .run();
}

/**
 * Caller can administer workspace (creator, tenant owner row, or member owner/admin).
 * @param {import('@cloudflare/workers-types').D1Database} db
 */
async function callerCanAdminWorkspace(db, workspaceId, userId, tenantId) {
  const env = { DB: db };
  if (!(await agentsamWorkspaceExists(env, workspaceId))) return false;
  const ownerUserId = await getWorkspaceOwnerUserId(env, workspaceId);
  if (ownerUserId && ownerUserId === userId) return true;
  const m = await db
    .prepare(
      `SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ? AND COALESCE(is_active, 1) = 1`,
    )
    .bind(workspaceId, userId)
    .first();
  return !!(m && (m.role === 'owner' || m.role === 'admin'));
}

/** Member or workspace owner — never tenant-wide without membership. */
async function callerCanViewWorkspace(db, workspaceId, authUser) {
  const env = { DB: db };
  const candidates = await workspaceMemberUserCandidates(env, authUser);
  if (!(await agentsamWorkspaceExists(env, workspaceId))) return false;
  const ownerUserId = await getWorkspaceOwnerUserId(env, workspaceId);
  if (ownerUserId && candidates.some((c) => ownerUserId === c)) return true;
  if (!candidates.length) return false;
  const ph = candidates.map(() => '?').join(', ');
  const m = await db
    .prepare(
      `SELECT 1 AS ok FROM workspace_members WHERE workspace_id = ? AND user_id IN (${ph}) AND COALESCE(is_active, 1) = 1 LIMIT 1`,
    )
    .bind(workspaceId, ...candidates)
    .first();
  return !!m;
}

const ALLOWED_WORKSPACE_TYPES = new Set([
  'project',
  'ide',
  'scratch',
  'client',
  'entity',
  'template',
]);

/** Relative label for notifications */
export function formatRelativeCheckedAgo(seconds) {
  const sec = Number(seconds) || 0;
  const now = Math.floor(Date.now() / 1000);
  const d = Math.max(0, now - sec);
  if (d < 60) return `${d} seconds ago`;
  if (d < 3600) return `${Math.floor(d / 60)} minutes ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} hours ago`;
  return `${Math.floor(d / 86400)} days ago`;
}

export function toUnixSeconds(v) {
  if (v == null) return 0;
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v > 1e12 ? Math.floor(v / 1000) : Math.floor(v);
  }
  const n = Number(v);
  if (Number.isFinite(n) && n > 1e12) return Math.floor(n / 1000);
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

/**
 * @param {Request} request
 * @param {URL} url
 * @param {any} env
 * @param {any} ctx
 * @param {any} authUser
 * @returns {Promise<Response|null>}
 */
export async function handleAgentsamWorkspacesApi(request, url, env, ctx, authUser) {
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);

  let tenantId = await resolveAuthTenantId(env, authUser);
  if (!tenantId && authUser.tenant_id != null && String(authUser.tenant_id).trim() !== '') {
    tenantId = String(authUser.tenant_id).trim();
  }
  if (!tenantId) return jsonResponse({ error: 'Tenant required' }, 403);

  const pathLower = url.pathname.replace(/\/$/, '').toLowerCase() || '/';
  const method = request.method.toUpperCase();
  const userId = String(authUser.id || '').trim();
  if (!userId) return jsonResponse({ error: 'Invalid user' }, 401);

  const db = env.DB;

  // ── GET /api/workspaces/list ────────────────────────────────────────────
  if (pathLower === '/api/workspaces/list' && method === 'GET') {
    try {
      const results = await listAccessibleWorkspaces(db, env, authUser);
      return jsonResponse({ workspaces: results || [] });
    } catch (e) {
      return jsonResponse({ error: e?.message ?? String(e) }, 500);
    }
  }

  // ── POST /api/workspaces ────────────────────────────────────────────────
  if (pathLower === '/api/workspaces' && method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const display_name =
      typeof body.display_name === 'string'
        ? body.display_name.trim()
        : typeof body.name === 'string'
          ? body.name.trim()
          : '';
    if (!display_name) return jsonResponse({ error: 'display_name required' }, 400);

    const workspace_type =
      typeof body.workspace_type === 'string' ? body.workspace_type.trim() : 'project';
    if (!ALLOWED_WORKSPACE_TYPES.has(workspace_type)) {
      return jsonResponse({ error: 'invalid workspace_type' }, 400);
    }

    let slug =
      typeof body.slug === 'string' && body.slug.trim()
        ? body.slug.trim()
        : slugify(display_name);

    const r2_prefix =
      body.r2_prefix != null && String(body.r2_prefix).trim() !== ''
        ? String(body.r2_prefix).trim()
        : null;
    const github_repo =
      body.github_repo != null && String(body.github_repo).trim() !== ''
        ? String(body.github_repo).trim()
        : null;
    const description =
      typeof body.description === 'string' && body.description.trim()
        ? body.description.trim()
        : null;

    const iso = new Date().toISOString();
    let baseId = `ws_${slugify(display_name)}`;
    let id = baseId;
    for (let i = 0; i < 12; i++) {
      const exists = await agentsamWorkspaceExists({ DB: db }, id);
      if (!exists) break;
      id = `${baseId}_${crypto.randomUUID().slice(0, 8)}`;
    }

    const tenantForRow = tenantId ?? null;
    const dn = (await fetchUserDisplayName(db, userId)) || authUser.email || '';

    try {
      await db
        .prepare(
          `INSERT INTO workspaces (
            id, name, display_name, slug, handle, category, workspace_type,
            tenant_id, owner_tenant_id, user_id, status, is_archived,
            r2_prefix, github_repo, description, settings_json,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?, '{}', ?, ?)`,
        )
        .bind(
          id,
          display_name,
          display_name,
          slug,
          slug,
          workspace_type,
          workspace_type,
          tenantForRow,
          tenantForRow,
          userId,
          r2_prefix,
          github_repo,
          description,
          iso,
          iso,
        )
        .run();

      await insertAgentsamWorkspaceRow(env, {
        id,
        workspaceSlug: slug,
        tenantId: tenantForRow,
        name: display_name,
        displayName: display_name,
        githubRepo: github_repo,
        r2Prefix: r2_prefix,
        description,
      });

      const memId = `wsm_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
      await db
        .prepare(
          `INSERT INTO workspace_members (
            id, workspace_id, member_type, member_id, user_id,
            email, display_name, role, is_active, created_at, updated_at
          ) VALUES (?, ?, 'user', ?, ?, ?, ?, 'owner', 1, unixepoch(), unixepoch())`,
        )
        .bind(memId, id, userId, userId, authUser.email || '', dn)
        .run();

      await insertAuditLog(db, {
        workspace_id: id,
        actor_type: 'user',
        actor_id: userId,
        actor_email: authUser.email ?? null,
        action: 'workspace.created',
        entity_type: 'workspace',
        entity_id: id,
        severity: 'info',
      });

      const row = await db.prepare(`SELECT * FROM workspaces WHERE id = ?`).bind(id).first();
      return jsonResponse({ workspace: row }, 201);
    } catch (e) {
      return jsonResponse({ error: e?.message ?? String(e) }, 500);
    }
  }

  // ── Members: /api/workspaces/:id/members ─────────────────────────────────
  const membersListMatch = pathLower.match(/^\/api\/workspaces\/([^/]+)\/members$/);
  if (membersListMatch && (method === 'GET' || method === 'POST')) {
    const workspaceId = decodeURIComponent(membersListMatch[1]);
    if (workspaceId === 'list' || workspaceId === 'current') return null;

    const canView = await callerCanViewWorkspace(db, workspaceId, authUser);
    if (!canView) return jsonResponse({ error: 'Forbidden' }, 403);

    if (method === 'GET') {
      try {
        const { results } = await db
          .prepare(
            `SELECT id, workspace_id, member_type, user_id, email,
              display_name, role, is_active, created_at
             FROM workspace_members WHERE workspace_id = ?
             ORDER BY CASE role WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'member' THEN 2 ELSE 1 END DESC,
               created_at ASC`,
          )
          .bind(workspaceId)
          .all();
        return jsonResponse({ members: results || [] });
      } catch (e) {
        return jsonResponse({ error: e?.message ?? String(e) }, 500);
      }
    }

    if (method === 'POST') {
      const admin = await callerCanAdminWorkspace(db, workspaceId, userId, tenantId ?? '');
      if (!admin) return jsonResponse({ error: 'Forbidden' }, 403);

      let body = {};
      try {
        body = await request.json();
      } catch {
        body = {};
      }
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const role = typeof body.role === 'string' ? body.role.trim().toLowerCase() : 'member';
      if (!email) return jsonResponse({ error: 'email required' }, 400);
      if (!['admin', 'member', 'viewer', 'billing'].includes(role)) {
        return jsonResponse({ error: 'invalid role' }, 400);
      }

      const dup = await db
        .prepare(
          `SELECT id FROM workspace_members WHERE workspace_id = ? AND LOWER(email) = ? AND COALESCE(is_active, 1) = 1`,
        )
        .bind(workspaceId, email)
        .first();
      if (dup) return jsonResponse({ error: 'Member already invited' }, 409);

      const mid = `wsm_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
      try {
        await db
          .prepare(
            `INSERT INTO workspace_members (
              id, workspace_id, member_type, email, role,
              member_id, user_id, is_active, created_at, updated_at
            ) VALUES (?, ?, 'user', ?, ?, NULL, NULL, 1, unixepoch(), unixepoch())`,
          )
          .bind(mid, workspaceId, email, role)
          .run();

        await insertAuditLog(db, {
          workspace_id: workspaceId,
          actor_type: 'user',
          actor_id: userId,
          actor_email: authUser.email ?? null,
          action: 'workspace.member_invited',
          entity_type: 'member',
          entity_id: mid,
          severity: 'info',
        });

        const row = await db.prepare(`SELECT * FROM workspace_members WHERE id = ?`).bind(mid).first();
        return jsonResponse({ member: row }, 201);
      } catch (e) {
        return jsonResponse({ error: e?.message ?? String(e) }, 500);
      }
    }
  }

  const memberIdMatch = pathLower.match(/^\/api\/workspaces\/([^/]+)\/members\/([^/]+)$/);
  if (memberIdMatch && (method === 'PATCH' || method === 'DELETE')) {
    const workspaceId = decodeURIComponent(memberIdMatch[1]);
    const memberRowId = decodeURIComponent(memberIdMatch[2]);

    const admin = await callerCanAdminWorkspace(db, workspaceId, userId, tenantId ?? '');
    if (!admin) return jsonResponse({ error: 'Forbidden' }, 403);

    const target = await db
      .prepare(`SELECT * FROM workspace_members WHERE id = ? AND workspace_id = ?`)
      .bind(memberRowId, workspaceId)
      .first();
    if (!target) return jsonResponse({ error: 'Not found' }, 404);

    if (method === 'PATCH') {
      let body = {};
      try {
        body = await request.json();
      } catch {
        body = {};
      }
      if (target.role === 'owner' && body.role !== undefined) {
        return jsonResponse({ error: 'Cannot change owner role' }, 400);
      }
      const nextRole =
        body.role != null && typeof body.role === 'string' ? body.role.trim().toLowerCase() : null;
      const nextActive =
        body.is_active === undefined ? null : body.is_active === true || body.is_active === 1 ? 1 : 0;

      const sets = [];
      const binds = [];
      if (nextRole != null) {
        if (nextRole === 'owner') return jsonResponse({ error: 'cannot set owner via patch' }, 400);
        sets.push('role = ?');
        binds.push(nextRole);
      }
      if (nextActive != null) {
        sets.push('is_active = ?');
        binds.push(nextActive);
      }
      if (sets.length === 0) return jsonResponse(target);
      sets.push('updated_at = unixepoch()');
      binds.push(memberRowId, workspaceId);

      await db
        .prepare(`UPDATE workspace_members SET ${sets.join(', ')} WHERE id = ? AND workspace_id = ?`)
        .bind(...binds)
        .run();

      await insertAuditLog(db, {
        workspace_id: workspaceId,
        actor_type: 'user',
        actor_id: userId,
        actor_email: authUser.email ?? null,
        action: 'workspace.member_updated',
        entity_type: 'member',
        entity_id: memberRowId,
        before_json: JSON.stringify(target),
        severity: 'info',
      });

      const row = await db.prepare(`SELECT * FROM workspace_members WHERE id = ?`).bind(memberRowId).first();
      return jsonResponse(row);
    }

    if (method === 'DELETE') {
      if (target.role === 'owner') {
        return jsonResponse({ error: 'Cannot remove owner' }, 400);
      }
      await db
        .prepare(
          `UPDATE workspace_members SET is_active = 0, updated_at = unixepoch() WHERE id = ? AND workspace_id = ?`,
        )
        .bind(memberRowId, workspaceId)
        .run();

      await insertAuditLog(db, {
        workspace_id: workspaceId,
        actor_type: 'user',
        actor_id: userId,
        actor_email: authUser.email ?? null,
        action: 'workspace.member_removed',
        entity_type: 'member',
        entity_id: memberRowId,
        severity: 'info',
      });

      return jsonResponse({ success: true });
    }
  }

  // ── GET /api/workspaces/:id/health ───────────────────────────────────────
  const healthMatch = pathLower.match(/^\/api\/workspaces\/([^/]+)\/health$/);
  if (healthMatch && method === 'GET') {
    const workspaceId = decodeURIComponent(healthMatch[1]);
    const canView = await callerCanViewWorkspace(db, workspaceId, authUser);
    if (!canView) return jsonResponse({ error: 'Forbidden' }, 403);

    const wsRow = await db.prepare(`SELECT settings_json, r2_prefix FROM workspaces WHERE id = ?`).bind(workspaceId).first();
    const sj = parseJsonSafe(wsRow?.settings_json, {});
    const terminalWs =
      sj.terminal_ws_url ||
      sj.terminalWsUrl ||
      sj.TERMINAL_WS_URL ||
      null;

    // R2 — list({ limit: 1 }) when available
    let r2Status = 'unknown';
    let r2Latency = null;
    const tR0 = Date.now();
    try {
      if (env.R2 && typeof env.R2.list === 'function') {
        const wsR2Prefix =
          wsRow?.r2_prefix != null && String(wsRow.r2_prefix).trim() !== ''
            ? String(wsRow.r2_prefix).trim().replace(/\/$/, '')
            : '';
        const probePrefix = wsR2Prefix ? `${wsR2Prefix}_probe/` : '_probe/';
        await env.R2.list({ prefix: probePrefix, limit: 1 });
        r2Status = 'healthy';
      } else if (env.R2) {
        await env.R2.head(`health-check-probe-${Date.now()}`);
        r2Status = 'healthy';
      } else {
        r2Status = 'unknown';
      }
      r2Latency = Date.now() - tR0;
    } catch (e) {
      r2Status = 'down';
      r2Latency = Date.now() - tR0;
    }
    await upsertConnectivity(db, workspaceId, 'r2', r2Status, r2Latency, {
      source: env.R2 ? 'env.R2' : 'none',
    });

    // D1
    let d1Status = 'unknown';
    let d1Latency = null;
    const tD0 = Date.now();
    try {
      await db.prepare(`SELECT 1 AS ok`).first();
      d1Status = 'healthy';
      d1Latency = Date.now() - tD0;
    } catch (e) {
      d1Status = 'down';
      d1Latency = Date.now() - tD0;
    }
    await upsertConnectivity(db, workspaceId, 'd1', d1Status, d1Latency, {});

    // AI
    const aiOk = !!env.AI;
    const aiStatus = aiOk ? 'healthy' : 'down';
    await upsertConnectivity(db, workspaceId, 'ai', aiStatus, null, { configured: aiOk });

    // PTY / terminal URL
    let ptyStatus = 'unknown';
    let ptyLatency = null;
    if (terminalWs && typeof terminalWs === 'string') {
      const base = terminalWs.replace(/\/$/, '');
      const healthUrl = `${base}/health`;
      // 500ms was false-degrading under tunnel/VM load (public health often 130–700ms).
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 5000);
      const tP0 = Date.now();
      try {
        const res = await fetch(healthUrl, { method: 'GET', signal: ac.signal });
        ptyLatency = Date.now() - tP0;
        if (res.ok) ptyStatus = 'healthy';
        else if (res.status >= 500) ptyStatus = 'down';
        else ptyStatus = 'degraded';
      } catch {
        ptyStatus = 'down';
        ptyLatency = Date.now() - tP0;
      } finally {
        clearTimeout(timer);
      }
    } else {
      ptyStatus = 'unknown';
    }
    await upsertConnectivity(db, workspaceId, 'pty', ptyStatus, ptyLatency, { url: terminalWs || null });

    // MCP tools count
    let mcpStatus = 'unknown';
    try {
      const row = await db
        .prepare(
          `SELECT COUNT(*) AS c FROM agentsam_tools
           WHERE COALESCE(is_active, 1) = 1
             AND COALESCE(is_degraded, 0) = 0
             AND (
               COALESCE(is_global, 1) = 1
               OR workspace_scope IS NULL OR trim(workspace_scope) IN ('', '[]')
               OR workspace_scope LIKE '%"*"%'
               OR (? != '' AND instr(COALESCE(workspace_scope, ''), ?) > 0)
             )`,
        )
        .bind(workspaceId, workspaceId)
        .first();
      const c = Number(row?.c || 0);
      mcpStatus = c > 0 ? 'healthy' : 'unknown';
    } catch {
      mcpStatus = 'unknown';
    }
    await upsertConnectivity(db, workspaceId, 'mcp', mcpStatus, null, {});

    const { results: rows } = await db
      .prepare(`SELECT * FROM workspace_connectivity_status WHERE workspace_id = ?`)
      .bind(workspaceId)
      .all();

    const services = (rows || []).map((r) => ({
      service: r.service,
      status: r.status,
      latency_ms: r.latency_ms,
      last_checked_at: r.last_checked_at,
    }));

    let overall = 'healthy';
    for (const s of services) {
      if (s.status === 'down') {
        overall = 'down';
        break;
      }
    }
    if (overall !== 'down') {
      for (const s of services) {
        if (s.status === 'degraded' || s.status === 'unknown') {
          overall = 'degraded';
          break;
        }
      }
    }

    return jsonResponse({ workspace_id: workspaceId, services, overall });
  }

  // ── GET /api/workspaces/:id/audit ───────────────────────────────────────
  const auditMatch = pathLower.match(/^\/api\/workspaces\/([^/]+)\/audit$/);
  if (auditMatch && method === 'GET') {
    const workspaceId = decodeURIComponent(auditMatch[1]);
    const canView = await callerCanViewWorkspace(db, workspaceId, authUser);
    if (!canView) return jsonResponse({ error: 'Forbidden' }, 403);

    try {
      const { results } = await db
        .prepare(
          `SELECT * FROM workspace_audit_log WHERE workspace_id = ?
           ORDER BY created_at DESC LIMIT 100`,
        )
        .bind(workspaceId)
        .all();
      return jsonResponse({ events: results || [] });
    } catch (e) {
      return jsonResponse({ error: e?.message ?? String(e) }, 500);
    }
  }

  // ── GET / POST /api/workspaces/:id/usage ────────────────────────────────
  const usageMatch = pathLower.match(/^\/api\/workspaces\/([^/]+)\/usage$/);
  if (usageMatch && (method === 'GET' || method === 'POST')) {
    const workspaceId = decodeURIComponent(usageMatch[1]);
    const canView = await callerCanViewWorkspace(db, workspaceId, authUser);
    if (!canView) return jsonResponse({ error: 'Forbidden' }, 403);

    if (method === 'GET') {
      try {
        const { results } = await db
          .prepare(
            `SELECT metric_date, api_calls_used, tokens_used, storage_used_mb, cost_estimate_cents
             FROM workspace_usage_metrics
             WHERE workspace_id = ?
             ORDER BY metric_date DESC
             LIMIT 30`,
          )
          .bind(workspaceId)
          .all();
        return jsonResponse({ metrics: results || [], workspace_id: workspaceId });
      } catch (e) {
        return jsonResponse({ error: e?.message ?? String(e) }, 500);
      }
    }

    if (method === 'POST') {
      let body = {};
      try {
        body = await request.json();
      } catch {
        body = {};
      }
      const tokens = Number(body.tokens_used ?? body.tokens ?? 0) || 0;
      const cost = Number(body.cost_estimate_cents ?? body.cost_cents ?? 0) || 0;
      await trackWorkspaceUsage(env, workspaceId, tenantId ?? null, userId, tokens, cost);
      return jsonResponse({ ok: true });
    }
  }

  // ── GET / PATCH / DELETE /api/workspaces/:id ─────────────────────────────
  const idMatch = pathLower.match(/^\/api\/workspaces\/([^/]+)$/);
  if (idMatch) {
    const workspaceId = decodeURIComponent(idMatch[1]);
    if (workspaceId === 'list' || workspaceId === 'current') return null;

    if (method === 'GET') {
      try {
        const allowed = await userCanAccessWorkspace(env, authUser, workspaceId);
        if (!allowed) return jsonResponse({ error: 'Forbidden' }, 403);

        const row = await db
          .prepare(
            `SELECT w.*, ws.settings_json AS workspace_settings,
              ws.timezone, ws.locale
             FROM workspaces w
             LEFT JOIN workspace_settings ws ON ws.workspace_id = w.id
             WHERE w.id = ?`,
          )
          .bind(workspaceId)
          .first();

        if (!row) return jsonResponse({ error: 'Not found' }, 404);
        return jsonResponse(row);
      } catch (e) {
        return jsonResponse({ error: e?.message ?? String(e) }, 500);
      }
    }

    if (method === 'PATCH') {
      let body = {};
      try {
        body = await request.json();
      } catch {
        body = {};
      }

      const canPatch =
        (await userCanAccessWorkspace(env, authUser, workspaceId)) &&
        (await callerCanAdminWorkspace(db, workspaceId, userId, tenantId ?? ''));

      if (!canPatch) return jsonResponse({ error: 'Forbidden' }, 403);

      const oldRow = await db.prepare(`SELECT * FROM workspaces WHERE id = ?`).bind(workspaceId).first();
      if (!oldRow) return jsonResponse({ error: 'Not found' }, 404);

      const col = {};
      if (typeof body.display_name === 'string') {
        const v = body.display_name.trim();
        col.display_name = v;
        col.name = v;
      }
      if (typeof body.slug === 'string') {
        const v = body.slug.trim();
        col.slug = v;
        col.handle = v;
      }
      if (typeof body.workspace_type === 'string') {
        const v = body.workspace_type.trim();
        col.workspace_type = v;
        col.category = v;
      }
      if (body.r2_prefix !== undefined) {
        col.r2_prefix =
          body.r2_prefix != null && String(body.r2_prefix).trim() !== ''
            ? String(body.r2_prefix).trim()
            : null;
      }
      if (body.github_repo !== undefined) {
        col.github_repo =
          body.github_repo != null && String(body.github_repo).trim() !== ''
            ? String(body.github_repo).trim()
            : null;
      }
      if (typeof body.description === 'string') col.description = body.description.trim();
      if (body.default_model_id !== undefined) {
        col.default_model_id =
          body.default_model_id != null && String(body.default_model_id).trim() !== ''
            ? String(body.default_model_id).trim()
            : null;
      }
      if (typeof body.settings_json === 'object' && body.settings_json !== null) {
        col.settings_json = JSON.stringify(body.settings_json);
      }
      if (typeof body.status === 'string') col.status = body.status.trim();

      const keys = Object.keys(col);
      if (keys.length === 0) return jsonResponse(oldRow);

      const agentsamCol = {};
      const workspacesCol = {};
      for (const [k, v] of Object.entries(col)) {
        if (AGENTSAM_WORKSPACE_BINDING_PATCH_KEYS.has(k)) agentsamCol[k] = v;
        else workspacesCol[k] = v;
      }
      // github_repo lives on agentsam_workspace but must mirror workspaces compat row.
      if (col.github_repo !== undefined) {
        workspacesCol.github_repo = col.github_repo;
      }

      if (Object.keys(agentsamCol).length) {
        await patchAgentsamWorkspaceFromApiCol(env, workspaceId, agentsamCol);
      }

      if (Object.keys(workspacesCol).length) {
        const sets = Object.keys(workspacesCol).map((k) => `${k} = ?`);
        const binds = Object.keys(workspacesCol).map((k) => workspacesCol[k]);
        sets.push(`updated_at = datetime('now')`);
        binds.push(workspaceId);
        await db.prepare(`UPDATE workspaces SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
      }

      await patchAgentsamWorkspaceFromApiCol(env, workspaceId, workspacesCol);

      const newRow = await db.prepare(`SELECT * FROM workspaces WHERE id = ?`).bind(workspaceId).first();

      await insertAuditLog(db, {
        workspace_id: workspaceId,
        actor_type: 'user',
        actor_id: userId,
        actor_email: authUser.email ?? null,
        action: 'workspace.updated',
        entity_type: 'workspace',
        entity_id: workspaceId,
        before_json: JSON.stringify(oldRow),
        after_json: JSON.stringify(newRow),
        severity: 'info',
      });

      return jsonResponse(newRow);
    }

    if (method === 'DELETE') {
      const ws = await db.prepare(`SELECT * FROM workspaces WHERE id = ?`).bind(workspaceId).first();
      if (!ws) return jsonResponse({ error: 'Not found' }, 404);

      const mem = await db
        .prepare(
          `SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ? AND COALESCE(is_active, 1) = 1`,
        )
        .bind(workspaceId, userId)
        .first();

      const tenantMatches =
        tenantId != null && String(ws.tenant_id || '') === String(tenantId);
      const ownerMember = mem?.role === 'owner';
      const creator = String(ws.user_id || '') === userId;

      let allowed = false;
      if (tenantMatches && ownerMember) allowed = true;
      else if (tenantMatches && creator && !mem) allowed = true;

      if (!allowed) return jsonResponse({ error: 'Forbidden' }, 403);

      await db
        .prepare(
          `UPDATE workspaces SET status = 'archived', is_archived = 1, updated_at = datetime('now') WHERE id = ?`,
        )
        .bind(workspaceId)
        .run();

      const after = await db.prepare(`SELECT * FROM workspaces WHERE id = ?`).bind(workspaceId).first();

      await insertAuditLog(db, {
        workspace_id: workspaceId,
        actor_type: 'user',
        actor_id: userId,
        actor_email: authUser.email ?? null,
        action: 'workspace.archived',
        entity_type: 'workspace',
        entity_id: workspaceId,
        before_json: JSON.stringify(ws),
        after_json: JSON.stringify(after),
        severity: 'info',
      });

      return jsonResponse({ success: true });
    }
  }

  return null;
}
