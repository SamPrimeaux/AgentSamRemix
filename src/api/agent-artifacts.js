/**
 * Agent Sam artifact library — D1 agentsam_artifacts + agentsam_artifact_skills + agentsam_skill
 *
 * P0 data isolation audit 2026-05-23 — unscoped SELECT lines (grep -v WHERE user_id|workspace_id|tenant_id):
 * Full log: artifacts/p0-data-isolation-audit-20260523.txt
 * (agent-artifacts.js: tenant-only scope fixed — all reads require user_id + workspace_id.)
 */
import { jsonResponse } from '../core/responses.js';
import { getAuthUser, fetchAuthUserTenantId } from '../core/auth.js'; import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js';
import { resolveAgentDataScope } from '../../backend/http/agentsam/routes/scope.js';
import { purgeWorkspaceArtifacts, PURGE_CONFIRM } from '../core/artifact-purge.js';

const ARTIFACT_COLS = `a.id, a.user_id, a.tenant_id, a.workspace_id, a.workspace_slug, a.project_key,
  a.name, a.description, a.artifact_type, a.artifact_status, a.validation_status, a.visibility,
  a.r2_key, a.public_url, a.preview_r2_key, a.preview_url, a.thumbnail_r2_key, a.thumbnail_url,
  a.source, a.source_skill_id, a.source_run_id, a.source_session_id, a.source_message_id,
  a.source_workflow_id, a.source_tool_key, a.source_model_key, a.tags, a.metadata_json,
  a.file_size_bytes, a.is_public, a.created_at, a.updated_at`;

const UPDATED_AT_ORDER = `CASE
  WHEN typeof(a.updated_at) = 'integer' THEN a.updated_at
  WHEN CAST(a.updated_at AS TEXT) GLOB '[0-9]*' THEN CAST(a.updated_at AS INTEGER)
  ELSE COALESCE(unixepoch(a.updated_at), 0)
END`;

const PATCHABLE = new Set([
  'name',
  'description',
  'artifact_status',
  'validation_status',
  'visibility',
  'tags',
  'metadata_json',
  'preview_url',
  'thumbnail_url',
  'source_skill_id',
]);

/** @param {unknown} raw */
function normalizeTimestamp(raw) {
  if (raw == null) {
    return { unix: null, iso: null, display: null };
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const u = Math.floor(raw);
    const d = new Date(u * 1000);
    const iso = Number.isNaN(d.getTime()) ? null : d.toISOString();
    return { unix: u, iso, display: iso ? iso.replace('T', ' ').replace('Z', ' UTC') : String(raw) };
  }
  const s = String(raw).trim();
  if (/^\d{9,12}$/.test(s)) {
    const u = parseInt(s, 10);
    const d = new Date(u * 1000);
    const iso = Number.isNaN(d.getTime()) ? null : d.toISOString();
    return { unix: u, iso, display: iso ? iso.replace('T', ' ').replace('Z', ' UTC') : s };
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const iso = new Date(t).toISOString();
    const unix = Math.floor(t / 1000);
    return { unix, iso, display: iso.replace('T', ' ').replace('Z', ' UTC') };
  }
  return { unix: null, iso: s, display: s };
}

/** @param {Record<string, unknown>} row */
function mapArtifactRow(row) {
  const ca = normalizeTimestamp(row.created_at);
  const ua = normalizeTimestamp(row.updated_at);
  let tags = row.tags;
  if (typeof tags === 'string') {
    try {
      tags = JSON.parse(tags);
    } catch {
      tags = [];
    }
  }
  let metadata_json = row.metadata_json;
  if (metadata_json != null && typeof metadata_json === 'string') {
    try {
      metadata_json = JSON.parse(metadata_json);
    } catch {
      /* keep string */
    }
  }
  return {
    id: row.id != null ? String(row.id) : null,
    user_id: row.user_id != null ? String(row.user_id) : null,
    tenant_id: row.tenant_id != null ? String(row.tenant_id) : null,
    workspace_id: row.workspace_id != null ? String(row.workspace_id) : null,
    workspace_slug: row.workspace_slug != null ? String(row.workspace_slug) : null,
    project_key: row.project_key != null ? String(row.project_key) : null,
    name: row.name != null ? String(row.name) : '',
    description: row.description != null ? String(row.description) : null,
    artifact_type: row.artifact_type != null ? String(row.artifact_type) : 'html',
    artifact_status: row.artifact_status != null ? String(row.artifact_status) : null,
    validation_status: row.validation_status != null ? String(row.validation_status) : null,
    visibility: row.visibility != null ? String(row.visibility) : null,
    r2_key: row.r2_key != null ? String(row.r2_key) : '',
    public_url: row.public_url != null ? String(row.public_url) : null,
    preview_r2_key: row.preview_r2_key != null ? String(row.preview_r2_key) : null,
    preview_url: row.preview_url != null ? String(row.preview_url) : null,
    thumbnail_r2_key: row.thumbnail_r2_key != null ? String(row.thumbnail_r2_key) : null,
    thumbnail_url: row.thumbnail_url != null ? String(row.thumbnail_url) : null,
    source: row.source != null ? String(row.source) : '',
    source_skill_id: row.source_skill_id != null ? String(row.source_skill_id) : null,
    source_run_id: row.source_run_id != null ? String(row.source_run_id) : null,
    source_session_id: row.source_session_id != null ? String(row.source_session_id) : null,
    source_message_id: row.source_message_id != null ? String(row.source_message_id) : null,
    source_workflow_id: row.source_workflow_id != null ? String(row.source_workflow_id) : null,
    source_tool_key: row.source_tool_key != null ? String(row.source_tool_key) : null,
    source_model_key: row.source_model_key != null ? String(row.source_model_key) : null,
    tags: Array.isArray(tags) ? tags : [],
    metadata_json: metadata_json ?? null,
    file_size_bytes: row.file_size_bytes != null ? Number(row.file_size_bytes) : null,
    is_public: Number(row.is_public) === 1,
    created_at: ca.iso ?? (ca.unix != null ? new Date(ca.unix * 1000).toISOString() : null),
    updated_at: ua.iso ?? (ua.unix != null ? new Date(ua.unix * 1000).toISOString() : null),
    created_at_display: ca.display,
    updated_at_display: ua.display,
    linked_skills: [],
  };
}

/**
 * @param {any} env
 * @param {unknown} authUser
 */
async function resolveTenantScope(env, authUser, request) {
  const dataScope = await resolveAgentDataScope(env, authUser, request, {});
  let tenantId = dataScope.tenantId;
  if (!tenantId && authUser?.id) {
    tenantId = await fetchAuthUserTenantId(env, String(authUser.id)).catch(() => null);
  }
  return {
    isSa: false,
    tenantId,
    userId: dataScope.userId,
    workspaceId: dataScope.workspaceId,
  };
}

/**
 * @param {URL} url
 * @param {{ isSa: boolean, tenantId: string | null, userId?: string | null, workspaceId?: string | null }} scope
 */
function buildListFilters(url, scope) {
  const sp = url.searchParams;
  const limit = Math.min(200, Math.max(1, Number(sp.get('limit') || 50) || 50));
  const offset = Math.max(0, Number(sp.get('offset') || 0) || 0);
  const q = (sp.get('q') || '').trim();
  const type = (sp.get('type') || '').trim();
  const status = (sp.get('status') || '').trim();
  const validation = (sp.get('validation') || '').trim();
  const visibility = (sp.get('visibility') || '').trim();
  const source = (sp.get('source') || '').trim();
  const workspace_id = (sp.get('workspace_id') || '').trim();
  const project_key = (sp.get('project_key') || '').trim();
  const session_id = (sp.get('session_id') || '').trim();
  // Ops-only: tenant-wide list. Default My artifacts stays user-scoped even for superadmin.
  const tenantWide = scope.isSa && (sp.get('scope') === 'tenant' || sp.get('all') === '1');

  const where = [];
  const binds = [];

  if (tenantWide) {
    if (scope.tenantId) {
      where.push('a.tenant_id = ?');
      binds.push(scope.tenantId);
    }
  } else if (!scope.userId) {
    where.push('1 = 0');
  } else {
    // Own artifacts OR shared via project membership (collaborator / owner).
    where.push(`(
      a.user_id = ?
      OR (
        a.project_key IS NOT NULL
        AND TRIM(a.project_key) != ''
        AND (
          EXISTS (
            SELECT 1 FROM project_collaborators pc
            WHERE pc.project_id = a.project_key AND pc.user_id = ?
          )
          OR EXISTS (
            SELECT 1 FROM projects p
            WHERE p.id = a.project_key AND p.owner_user_id = ?
          )
        )
      )
    )`);
    binds.push(scope.userId, scope.userId, scope.userId);
  }

  if (workspace_id) {
    where.push('a.workspace_id = ?');
    binds.push(workspace_id);
  }
  if (project_key) {
    where.push('a.project_key = ?');
    binds.push(project_key);
  }
  if (session_id) {
    if (scope.userId) {
      where.push(
        `(a.source_session_id = ? OR a.source_run_id IN (
          SELECT r.id FROM agentsam_agent_run r
          WHERE r.conversation_id = ? AND r.user_id = ?
        ))`,
      );
      binds.push(session_id, session_id, scope.userId);
    } else {
      where.push('a.source_session_id = ?');
      binds.push(session_id);
    }
  }
  if (type) {
    where.push('a.artifact_type = ?');
    binds.push(type);
  }
  if (status) {
    where.push('a.artifact_status = ?');
    binds.push(status);
  }
  if (validation) {
    where.push('a.validation_status = ?');
    binds.push(validation);
  }
  if (visibility) {
    where.push('a.visibility = ?');
    binds.push(visibility);
  }
  if (source) {
    where.push('a.source = ?');
    binds.push(source);
  }
  if (q) {
    const like = `%${q.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
    binds.push(like, like, like, like);
    where.push(
      `(a.name LIKE ? ESCAPE '\\' OR a.artifact_type LIKE ? ESCAPE '\\' OR a.source LIKE ? ESCAPE '\\' OR a.r2_key LIKE ? ESCAPE '\\')`,
    );
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return {
    limit,
    offset,
    whereSql,
    binds,
    filters: {
      limit,
      offset,
      q,
      type,
      status,
      validation,
      visibility,
      source,
      workspace_id,
      project_key,
      session_id,
      scope: tenantWide ? 'tenant' : 'user',
    },
  };
}

/** KPI scope: user-owned (+ shared project) by default; optional workspace/project filters */
function buildKpiScope(url, scope) {
  const sp = url.searchParams;
  const workspace_id = (sp.get('workspace_id') || '').trim();
  const project_key = (sp.get('project_key') || '').trim();
  const tenantWide = scope.isSa && (sp.get('scope') === 'tenant' || sp.get('all') === '1');
  const where = [];
  const binds = [];
  if (tenantWide) {
    if (scope.tenantId) {
      where.push('tenant_id = ?');
      binds.push(scope.tenantId);
    }
  } else if (!scope.userId) {
    where.push('1 = 0');
  } else {
    where.push(`(
      user_id = ?
      OR (
        project_key IS NOT NULL
        AND TRIM(project_key) != ''
        AND (
          EXISTS (
            SELECT 1 FROM project_collaborators pc
            WHERE pc.project_id = project_key AND pc.user_id = ?
          )
          OR EXISTS (
            SELECT 1 FROM projects p
            WHERE p.id = project_key AND p.owner_user_id = ?
          )
        )
      )
    )`);
    binds.push(scope.userId, scope.userId, scope.userId);
  }
  if (workspace_id) {
    where.push('workspace_id = ?');
    binds.push(workspace_id);
  }
  if (project_key) {
    where.push('project_key = ?');
    binds.push(project_key);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return { whereSql, binds };
}

/**
 * @param {any} env
 * @param {string} artifactId
 * @param {{ isSa: boolean, tenantId: string | null, userId?: string | null }} scope
 * @param {{ mutate?: boolean }} [opts] mutate=true requires owner (CRUD); read may allow shared project
 */
async function assertArtifactAccess(env, artifactId, scope, opts = {}) {
  const mutate = opts.mutate === true;
  const row = await env.DB.prepare(
    `SELECT id, tenant_id, user_id, project_key, visibility, is_public FROM agentsam_artifacts WHERE id = ?`,
  )
    .bind(artifactId)
    .first();
  if (!row) return { ok: false, status: 404, error: 'Not found' };

  const ownerId = String(row.user_id || '');
  const callerId = scope.userId != null ? String(scope.userId) : '';

  if (scope.isSa && !mutate && !callerId) {
    return { ok: true, row };
  }

  if (!callerId) return { ok: false, status: 403, error: 'Forbidden' };

  if (ownerId === callerId) {
    if (scope.tenantId && String(row.tenant_id || '') !== String(scope.tenantId) && !scope.isSa) {
      return { ok: false, status: 403, error: 'Forbidden' };
    }
    return { ok: true, row };
  }

  // Non-owners: never mutate. Read only when shared via project membership.
  if (mutate) return { ok: false, status: 403, error: 'Forbidden' };

  const projectKey = row.project_key != null ? String(row.project_key).trim() : '';
  if (projectKey) {
    const collab = await env.DB.prepare(
      `SELECT 1 AS ok FROM project_collaborators WHERE project_id = ? AND user_id = ? LIMIT 1`,
    )
      .bind(projectKey, callerId)
      .first()
      .catch(() => null);
    if (collab) return { ok: true, row };
    const owner = await env.DB.prepare(
      `SELECT 1 AS ok FROM projects WHERE id = ? AND owner_user_id = ? LIMIT 1`,
    )
      .bind(projectKey, callerId)
      .first()
      .catch(() => null);
    if (owner) return { ok: true, row };
  }

  return { ok: false, status: 403, error: 'Forbidden' };
}

/**
 * @param {Request} request
 * @param {URL} url
 * @param {any} env
 * @returns {Promise<Response | null>}
 */
export async function handleAgentArtifactsApi(request, url, env) {
  const pathLower = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
  const method = request.method.toUpperCase();

  if (!pathLower.startsWith('/api/agent/artifact')) {
    return null;
  }

  if (!env.DB) {
    return jsonResponse({ ok: false, error: 'Database not configured' }, 503);
  }

  const purgePath = pathLower === '/api/agent/artifacts/purge' && method === 'POST';
  const internalAutomation = purgePath && verifyBridgeKey(request, env);

  let scope;
  if (internalAutomation) {
    scope = { isSa: true, tenantId: null, userId: null, workspaceId: null };
  } else {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
    scope = await resolveTenantScope(env, authUser, request);
  }

  try {
    if (pathLower === '/api/agent/artifact-filters' && method === 'GET') {
      const { whereSql, binds } = buildKpiScope(url, scope);
      const tRows =
        (
          await env.DB.prepare(
            `SELECT artifact_type AS value, COUNT(*) AS n FROM agentsam_artifacts ${whereSql} GROUP BY artifact_type ORDER BY n DESC`,
          )
            .bind(...binds)
            .all()
        ).results || [];
      const stRows =
        (
          await env.DB.prepare(
            `SELECT artifact_status AS value, COUNT(*) AS n FROM agentsam_artifacts ${whereSql} GROUP BY artifact_status ORDER BY n DESC`,
          )
            .bind(...binds)
            .all()
        ).results || [];
      const valRows =
        (
          await env.DB.prepare(
            `SELECT validation_status AS value, COUNT(*) AS n FROM agentsam_artifacts ${whereSql} GROUP BY validation_status ORDER BY n DESC`,
          )
            .bind(...binds)
            .all()
        ).results || [];
      const visRows =
        (
          await env.DB.prepare(
            `SELECT visibility AS value, COUNT(*) AS n FROM agentsam_artifacts ${whereSql} GROUP BY visibility ORDER BY n DESC`,
          )
            .bind(...binds)
            .all()
        ).results || [];
      const srcRows =
        (
          await env.DB.prepare(
            `SELECT source AS value, COUNT(*) AS n FROM agentsam_artifacts ${whereSql} GROUP BY source ORDER BY n DESC LIMIT 80`,
          )
            .bind(...binds)
            .all()
        ).results || [];

      return jsonResponse({
        ok: true,
        filters: {
          artifact_type: (tRows || []).map((r) => ({ value: r.value, count: Number(r.n) || 0 })),
          artifact_status: (stRows || []).map((r) => ({ value: r.value, count: Number(r.n) || 0 })),
          validation_status: (valRows || []).map((r) => ({ value: r.value, count: Number(r.n) || 0 })),
          visibility: (visRows || []).map((r) => ({ value: r.value, count: Number(r.n) || 0 })),
          source: (srcRows || []).map((r) => ({ value: r.value, count: Number(r.n) || 0 })),
        },
      });
    }

    if (pathLower === '/api/agent/artifacts/purge' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      if (String(body?.confirm || '') !== PURGE_CONFIRM) {
        return jsonResponse({ ok: false, error: 'confirm_required', expected: PURGE_CONFIRM }, 400);
      }
      if (!internalAutomation && !scope.isSa) {
        return jsonResponse({ ok: false, error: 'Forbidden — superadmin or internal secret required' }, 403);
      }
      const workspaceId = String(body?.workspace_id || scope.workspaceId || '').trim() || null;
      const out = await purgeWorkspaceArtifacts(env, scope, {
        workspaceId,
        dryRun: !!body?.dry_run,
        deleteR2: body?.delete_r2 !== false,
      });
      if (!out.ok) return jsonResponse({ ok: false, ...out }, 400);
      return jsonResponse({ ok: true, ...out });
    }

    if (pathLower === '/api/agent/artifacts' && method === 'GET') {
      const { limit, offset, whereSql, binds, filters } = buildListFilters(url, scope);

      const countRow = await env.DB.prepare(`SELECT COUNT(*) AS c FROM agentsam_artifacts a ${whereSql}`)
        .bind(...binds)
        .first();
      const total = Number(countRow?.c ?? 0) || 0;

      const { whereSql: kWhere, binds: kBinds } = buildKpiScope(url, scope);
      const kpiRow = await env.DB.prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN LOWER(COALESCE(artifact_status,'')) = 'draft' THEN 1 ELSE 0 END) AS draft,
           SUM(CASE WHEN LOWER(COALESCE(artifact_status,'')) IN ('approved','published','deployed') THEN 1 ELSE 0 END) AS approved_line,
           SUM(CASE WHEN LOWER(COALESCE(validation_status,'')) IN ('passed','pass') THEN 1 ELSE 0 END) AS passed_val,
           SUM(CASE
             WHEN validation_status IS NULL THEN 1
             WHEN LOWER(COALESCE(validation_status,'')) IN ('untested','failed','fail','') THEN 1
             ELSE 0
           END) AS untested_or_failed
         FROM agentsam_artifacts ${kWhere}`,
      )
        .bind(...kBinds)
        .first()
        .catch(() => ({}));

      const listBinds = [...binds, limit, offset];
      const { results: rawRows } = await env.DB.prepare(
        `SELECT ${ARTIFACT_COLS}
         FROM agentsam_artifacts a
         ${whereSql}
         ORDER BY ${UPDATED_AT_ORDER} DESC
         LIMIT ? OFFSET ?`,
      )
        .bind(...listBinds)
        .all();

      const ids = (rawRows || []).map((r) => r.id).filter(Boolean);
      const skillsByArt = new Map();
      // D1 max bound parameters is 100 — chunk IN lists (list limit can be 200).
      const D1_IN_CHUNK = 80;
      if (ids.length) {
        for (let i = 0; i < ids.length; i += D1_IN_CHUNK) {
          const chunk = ids.slice(i, i + D1_IN_CHUNK);
          const placeholders = chunk.map(() => '?').join(',');
          const { results: skillRows } = await env.DB.prepare(
            `SELECT ask.artifact_id, ask.role, s.id AS skill_id, s.name AS skill_name
             FROM agentsam_artifact_skills ask
             INNER JOIN agentsam_skill s ON s.id = ask.skill_id
             WHERE ask.artifact_id IN (${placeholders})`,
          )
            .bind(...chunk)
            .all();
          for (const sr of skillRows || []) {
            const aid = String(sr.artifact_id);
            if (!skillsByArt.has(aid)) skillsByArt.set(aid, []);
            skillsByArt.get(aid).push({
              id: sr.skill_id != null ? String(sr.skill_id) : null,
              name: sr.skill_name != null ? String(sr.skill_name) : '',
              role: sr.role != null ? String(sr.role) : null,
            });
          }
        }
      }

      const artifacts = (rawRows || []).map((r) => {
        const o = mapArtifactRow(r);
        o.linked_skills = skillsByArt.get(String(r.id)) || [];
        return o;
      });

      // Artifacts are intentionally durable outputs. Generated-image drafts are
      // ephemeral evidence/creation state and belong to Images until explicitly saved.
      const merged = artifacts;
      const mergedTotal = total;

      return jsonResponse({
        ok: true,
        artifacts: merged,
        total: mergedTotal,
        filters,
        kpis: {
          total_artifacts: Number(kpiRow?.total ?? total) || total,
          draft: Number(kpiRow?.draft ?? 0) || 0,
          approved_published_deployed: Number(kpiRow?.approved_line ?? 0) || 0,
          passed_validation: Number(kpiRow?.passed_val ?? 0) || 0,
          untested_or_failed: Number(kpiRow?.untested_or_failed ?? 0) || 0,
        },
      });
    }

    const oneMatch = pathLower.match(/^\/api\/agent\/artifacts\/([^/]+)$/);
    if (oneMatch && method === 'GET') {
      const id = oneMatch[1];
      const gate = await assertArtifactAccess(env, id, scope);
      if (!gate.ok) return jsonResponse({ ok: false, error: gate.error }, gate.status);

      const row = await env.DB.prepare(`SELECT ${ARTIFACT_COLS} FROM agentsam_artifacts a WHERE a.id = ?`)
        .bind(id)
        .first();
      if (!row) return jsonResponse({ ok: false, error: 'Not found' }, 404);

      const { results: skillRows } = await env.DB.prepare(
        `SELECT s.id AS skill_id, s.name AS skill_name, ask.role
         FROM agentsam_artifact_skills ask
         INNER JOIN agentsam_skill s ON s.id = ask.skill_id
         WHERE ask.artifact_id = ?`,
      )
        .bind(id)
        .all();
      const artifact = mapArtifactRow(row);
      artifact.linked_skills = (skillRows || []).map((sr) => ({
        id: sr.skill_id != null ? String(sr.skill_id) : null,
        name: sr.skill_name != null ? String(sr.skill_name) : '',
        role: sr.role != null ? String(sr.role) : null,
      }));
      return jsonResponse({ ok: true, artifact });
    }

    if (oneMatch && method === 'PATCH') {
      const id = oneMatch[1];
      const gate = await assertArtifactAccess(env, id, scope, { mutate: true });
      if (!gate.ok) return jsonResponse({ ok: false, error: gate.error }, gate.status);

      const body = await request.json().catch(() => ({}));
      const sets = [];
      const pb = [];

      for (const key of PATCHABLE) {
        if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
        let v = body[key];
        if (key === 'tags') {
          v = typeof v === 'string' ? v : JSON.stringify(v ?? []);
        } else if (key === 'metadata_json') {
          v = typeof v === 'string' ? v : JSON.stringify(v ?? {});
        } else if (v != null) {
          v = String(v);
        }
        sets.push(`${key} = ?`);
        pb.push(v);
      }
      if (!sets.length) {
        return jsonResponse({ ok: false, error: 'No allowed fields to update' }, 400);
      }
      sets.push('updated_at = unixepoch()');
      const sql = `UPDATE agentsam_artifacts SET ${sets.join(', ')} WHERE id = ?`;
      pb.push(id);
      await env.DB.prepare(sql)
        .bind(...pb)
        .run();

      const row = await env.DB.prepare(`SELECT ${ARTIFACT_COLS} FROM agentsam_artifacts a WHERE a.id = ?`)
        .bind(id)
        .first();
      const { results: skillRows } = await env.DB.prepare(
        `SELECT s.id AS skill_id, s.name AS skill_name, ask.role
         FROM agentsam_artifact_skills ask
         INNER JOIN agentsam_skill s ON s.id = ask.skill_id
         WHERE ask.artifact_id = ?`,
      )
        .bind(id)
        .all();
      const artifact = mapArtifactRow(row);
      artifact.linked_skills = (skillRows || []).map((sr) => ({
        id: sr.skill_id != null ? String(sr.skill_id) : null,
        name: sr.skill_name != null ? String(sr.skill_name) : '',
        role: sr.role != null ? String(sr.role) : null,
      }));
      return jsonResponse({ ok: true, artifact });
    }

    if (oneMatch && method === 'DELETE') {
      const id = oneMatch[1];
      const gate = await assertArtifactAccess(env, id, scope, { mutate: true });
      if (!gate.ok) return jsonResponse({ ok: false, error: gate.error }, gate.status);

      const row = await env.DB.prepare(
        `SELECT id, r2_key, r2_bucket, preview_r2_key, thumbnail_r2_key FROM agentsam_artifacts WHERE id = ?`,
      )
        .bind(id)
        .first();
      if (!row) return jsonResponse({ ok: false, error: 'Not found' }, 404);

      const { resolveArtifactR2Binding } = await import('../core/artifact-key.js');
      const bucketName = row.r2_bucket != null ? String(row.r2_bucket).trim() : '';
      const binding = resolveArtifactR2Binding(env, bucketName || undefined);
      const keys = [row.r2_key, row.preview_r2_key, row.thumbnail_r2_key]
        .map((k) => (k != null ? String(k).trim() : ''))
        .filter(Boolean);
      if (binding) {
        for (const key of keys) {
          try {
            await binding.delete(key);
          } catch {
            /* best-effort */
          }
        }
      }

      await env.DB.prepare(`DELETE FROM agentsam_artifact_skills WHERE artifact_id = ?`)
        .bind(id)
        .run()
        .catch(() => {});
      await env.DB.prepare(`DELETE FROM agentsam_artifacts WHERE id = ?`).bind(id).run();

      return jsonResponse({ ok: true, deleted: true, id });
    }
  } catch (e) {
    console.warn('[agent-artifacts]', e?.message ?? e);
    return jsonResponse({ ok: false, error: e?.message ?? String(e) }, 500);
  }

  return null;
}
