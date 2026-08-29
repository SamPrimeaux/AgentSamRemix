/**
 * Projects API — peeled from monolithic projects.js (mechanical).
 */
import { jsonResponse } from '../../core/auth.js';
import { withD1Retry } from '../../core/d1-retry.js';
import { scheduleSyncProjectToSupabase } from '../../core/agentsam-projects-supabase-sync.js';
import { userCanAccessWorkspace } from '../../core/workspace-access.js';
import {
  normalizeGithubRepoFullName,
  readProjectGithubRepoFromRow,
} from '../../../backend/agentsam/codebase/project-github-repo.js';
import { PRODUCT_SOURCE_TYPE_SQL_IN } from '../../../backend/agentsam/codebase/codebase-full-index.js';

export const PROJECTS_LIST_CACHE = 'private, max-age=30, stale-while-revalidate=120';
export const PROJECTS_OVERVIEW_CACHE = 'private, max-age=15, stale-while-revalidate=300';

/** POST /api/projects/:id/runtime-contract/sync — machine lane (AGENTSAM_BRIDGE_KEY). */
export function isProjectRuntimeContractSyncPath(pathname, method = 'POST') {
  if (String(method || 'POST').toUpperCase() !== 'POST') return false;
  const p = String(pathname || '/').toLowerCase().replace(/\/$/, '') || '/';
  return /^\/api\/projects\/[^/]+\/runtime-contract\/sync$/.test(p);
}

/**
 * One round-trip: attach active full-index progress to project list rows.
 * Match by project metadata github_repo + execution workspace — never workspace alone.
 * @param {any} env
 * @param {Array<Record<string, unknown>>} projects
 */
export function parseJobSummaryObject(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function codeIndexTruthLabel({ stage, fileDone, fileTotal, skippedUnchanged, pct }) {
  const stageKey = String(stage || '').toLowerCase();
  if (stageKey === 'embed_symbols') {
    return `idx symbols · ${pct}%`;
  }
  if (stageKey === 'verify') {
    return `idx verify · ${pct}%`;
  }
  if (fileTotal > 0) {
    const skip =
      skippedUnchanged > 0 ? ` · ${skippedUnchanged} skip` : '';
    return `${fileDone}/${fileTotal}${skip}`;
  }
  return `idx ${pct}%`;
}

export async function attachCodeIndexProgressToProjects(env, projects) {
  if (!env?.DB || !Array.isArray(projects) || !projects.length) return projects;

  const annotated = projects.map((p) => {
    const githubRepo = readProjectGithubRepoFromRow(p);
    const workspaceId =
      p.workspace_id != null && String(p.workspace_id).trim()
        ? String(p.workspace_id).trim()
        : null;
    return { project: p, githubRepo, workspaceId };
  });

  const workspaceIds = [
    ...new Set(annotated.map((a) => a.workspaceId).filter(Boolean)),
  ];
  if (!workspaceIds.length) {
    return projects.map((p) => ({
      ...p,
      code_index: null,
      progress: Number(p.progress) || 0,
    }));
  }

  const ph = workspaceIds.map(() => '?').join(',');
  let jobs = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, workspace_id, repo_full_name, status, progress_percent,
              indexed_file_count, file_count, updated_at, symbol_summary
         FROM agentsam_code_index_job
        WHERE workspace_id IN (${ph})
          AND source_type IN ${PRODUCT_SOURCE_TYPE_SQL_IN}
          AND status IN ('idle', 'running')
        ORDER BY rowid DESC`,
    )
      .bind(...workspaceIds)
      .all();
    jobs = results || [];
  } catch {
    return projects.map((p) => ({
      ...p,
      code_index: null,
    }));
  }

  /** @type {Map<string, Record<string, unknown>>} */
  const jobByWsRepo = new Map();
  for (const job of jobs) {
    const ws = job.workspace_id != null ? String(job.workspace_id).trim() : '';
    const repo = normalizeGithubRepoFullName(job.repo_full_name);
    if (!ws || !repo) continue;
    const key = `${ws}::${repo}`;
    if (!jobByWsRepo.has(key)) jobByWsRepo.set(key, job);
  }

  return annotated.map(({ project: p, githubRepo, workspaceId }) => {
    if (!githubRepo || !workspaceId) {
      return { ...p, code_index: null };
    }
    const job = jobByWsRepo.get(`${workspaceId}::${githubRepo}`) || null;
    if (!job) return { ...p, code_index: null };

    const summary = parseJobSummaryObject(job.symbol_summary);
    const stage = String(summary.stage || 'parse_chunks');
    const skippedUnchanged = Math.max(
      0,
      Number(summary.stages?.parse_chunks?.skipped_unchanged) || 0,
    );
    const fileTotal = Math.max(0, Number(job.file_count) || 0);
    const fileDone = Math.max(0, Number(job.indexed_file_count) || 0);
    let pct = Math.max(0, Math.min(100, Number(job.progress_percent) || 0));
    if (fileTotal > 0 && (stage === 'parse_chunks' || stage === 'queued' || stage === 'crawl')) {
      pct = Math.max(1, Math.min(99, Math.ceil((fileDone / fileTotal) * 100)));
    } else if (pct <= 0) {
      pct = 1;
    }

    const label = codeIndexTruthLabel({
      stage,
      fileDone,
      fileTotal,
      skippedUnchanged,
      pct,
    });

    const codeIndex = {
      run_id: String(job.id),
      status: String(job.status || 'running'),
      progress_percent: pct,
      github_repo: githubRepo,
      indexed_file_count: fileDone,
      file_count: fileTotal,
      stage,
      skipped_unchanged: skippedUnchanged,
      label,
      updated_at: job.updated_at ?? null,
    };

    // When indexing, surface index % on the existing card bar.
    return {
      ...p,
      code_index: codeIndex,
      progress: pct,
      progress_source: 'code_index',
    };
  });
}

export function projectsJsonResponse(body, status = 200, cacheControl = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (cacheControl) headers['Cache-Control'] = cacheControl;
  return new Response(JSON.stringify(body), { status: Number(status) || 200, headers });
}

export function safeJsonArray(text, fallback = []) {
  try {
    const v = JSON.parse(String(text || 'null'));
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export function parseMetadataObject(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object') return raw;
  try {
    const o = JSON.parse(String(raw));
    return typeof o === 'object' && o !== null ? o : {};
  } catch {
    return {};
  }
}

export function extractCoverImageUrl(row, meta) {
  const m =
    meta != null && typeof meta === 'object'
      ? meta
      : parseMetadataObject(row?.metadata_json);
  const candidates = [
    m.cover_image_url,
    m.cover_url,
    m.hero_image_url,
    m.card_image_url,
  ];
  for (const c of candidates) {
    const u = c != null ? String(c).trim() : '';
    if (u) return u;
  }
  const tags = safeJsonArray(row?.tags_json, []);
  for (const t of tags) {
    if (typeof t === 'string' && t.startsWith('cover:')) {
      const u = t.slice(6).trim();
      if (u) return u;
    }
  }
  return null;
}

export function slugifyBase(name) {
  return String(name || 'project')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'project';
}

export function priorityToLabel(n) {
  const p = Number(n) || 0;
  if (p >= 80) return 'P0';
  if (p >= 60) return 'P1';
  if (p >= 40) return 'P2';
  return 'P3';
}

// projects.project_type / projects.status are both CHECK-constrained against
// exact lowercase-hyphenated enums in D1. The dashboard's New Project form
// sends human-readable casing (e.g. "E-Commerce"), which fails the exact
// string match and previously surfaced as a raw, unhandled D1_ERROR/500.
// Normalize + validate here so the UI can send whatever casing it wants.
export const VALID_PROJECT_TYPES = ['dashboard', 'landing-page', 'saas-product', 'e-commerce', 'internal-tool', 'template'];
export const VALID_PROJECT_STATUSES = ['discovery', 'design', 'development', 'qa', 'staging', 'production', 'maintenance', 'archived'];
export const VALID_WORKSPACE_PROJECT_TYPES = ['website', 'mpa', 'spa', 'api', 'mobile', 'cms', 'ecommerce', 'brand', 'internal', 'other'];
export const VALID_WORKSPACE_PROJECT_STATUSES = ['active', 'on_hold', 'done', 'archived'];

export function normalizeEnum(value, allowed, fallback) {
  const v = String(value || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/-+/g, '-');
  if (allowed.includes(v)) return v;
  // Dashboard / agent chat often says "saas" — map to canonical enum.
  if (v === 'saas' || v === 'saas-platform') return 'saas-product';
  return fallback;
}

/** workspace_projects uses a legacy enum — map canonical projects.project_type. */
export function mapWorkspaceProjectType(projectType) {
  const t = String(projectType || '').trim().toLowerCase();
  const map = {
    'landing-page': 'website',
    'saas-product': 'api',
    'e-commerce': 'ecommerce',
    'internal-tool': 'internal',
    template: 'other',
    dashboard: 'internal',
    website: 'website',
    mpa: 'mpa',
    spa: 'spa',
    api: 'api',
    mobile: 'mobile',
    cms: 'cms',
    ecommerce: 'ecommerce',
    brand: 'brand',
    internal: 'internal',
    other: 'other',
  };
  return map[t] || 'other';
}

export function mapDbStatusToUi(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'blocked' || s === 'maintenance') return 'blocked';
  if (s === 'complete' || s === 'archived') return 'complete';
  if (s === 'review' || s === 'staging') return 'review';
  if (s === 'planning' || s === 'discovery') return 'planning';
  if (s === 'development' || s === 'active' || s === 'production') return 'active';
  return 'planning';
}

export async function mirrorProjectWrite(env, ctx, row, opts = {}) {
  if (!row?.id) return { ok: false, error: 'missing_project_row' };
  return scheduleSyncProjectToSupabase(env, ctx, row, {
    ...opts,
    awaitSync: true,
    updatedBy: opts.updatedBy ?? null,
  });
}

export async function assertWorkspaceAllowed(env, workspaceId, userId) {
  const { authorizeWorkspaceAccess } = await import('../../core/workspace-access.js');
  return !!(await authorizeWorkspaceAccess(env, userId, workspaceId));
}

export function buildProjectWhereClause(workspaceId, tenantId) {
  if (!tenantId) return { sql: '1=0', binds: [] };
  if (!workspaceId) {
    return { sql: 'p.tenant_id = ?', binds: [tenantId] };
  }
  return {
    sql: `p.tenant_id = ?
      AND (p.workspace_id = ? OR p.workspace_id IS NULL OR p.workspace_id = '')`,
    binds: [tenantId, workspaceId],
  };
}

export async function fetchPlanTasksForTenant(db, tenantId, workspaceId) {
  try {
    if (workspaceId) {
      const { results } = await db
        .prepare(
          `SELECT t.id, t.plan_id, t.status, t.title, t.priority, t.actual_minutes, t.completed_at,
                  t.created_at, pl.linked_project_keys, pl.workspace_id AS plan_workspace_id
           FROM agentsam_plan_tasks t
           INNER JOIN agentsam_plans pl ON pl.id = t.plan_id
           WHERE pl.tenant_id = ?
             AND (pl.workspace_id = ? OR pl.workspace_id IS NULL OR pl.workspace_id = '')`,
        )
        .bind(tenantId, workspaceId)
        .all();
      return results || [];
    }
    const { results } = await db
      .prepare(
        `SELECT t.id, t.plan_id, t.status, t.title, t.priority, t.actual_minutes, t.completed_at,
                t.created_at, pl.linked_project_keys, pl.workspace_id AS plan_workspace_id
         FROM agentsam_plan_tasks t
         INNER JOIN agentsam_plans pl ON pl.id = t.plan_id
         WHERE pl.tenant_id = ?`,
      )
      .bind(tenantId)
      .all();
    return results || [];
  } catch {
    return [];
  }
}

export function indexTasksByProject(planTaskRows) {
  /** @type {Record<string, { total: number, done: number, blocked: number, open: number }>} */
  const by = {};
  for (const row of planTaskRows) {
    const keys = safeJsonArray(row.linked_project_keys, []);
    const targets = keys.length ? keys : [null];
    for (const pid of targets) {
      if (!pid) continue;
      if (!by[pid]) by[pid] = { total: 0, done: 0, blocked: 0, open: 0 };
      const st = String(row.status || '').toLowerCase();
      by[pid].total += 1;
      if (st === 'done' || st === 'complete') by[pid].done += 1;
      else if (st === 'blocked') by[pid].blocked += 1;
      else by[pid].open += 1;
    }
  }
  return by;
}

export async function fetchQualityByProject(db, projectIds) {
  if (!projectIds.length) return {};
  /** @type {Record<string, number>} */
  const out = {};
  try {
    const placeholders = projectIds.map(() => '?').join(',');
    const { results } = await db
      .prepare(`SELECT project_id, pass_rate FROM project_quality_summary WHERE project_id IN (${placeholders})`)
      .bind(...projectIds)
      .all();
    for (const r of results || []) {
      if (r.project_id != null) out[String(r.project_id)] = Number(r.pass_rate) || 0;
    }
  } catch {
    /* view missing or sqlite error */
  }
  return out;
}

export async function fetchOpenIssuesByProject(db, projectIds) {
  if (!projectIds.length) return {};
  /** @type {Record<string, number>} */
  const out = {};
  try {
    const placeholders = projectIds.map(() => '?').join(',');
    const { results } = await db
      .prepare(
        `SELECT project_id, COUNT(*) as c FROM project_issues
         WHERE project_id IN (${placeholders}) AND LOWER(COALESCE(status,'')) IN ('open','in_progress','new')
         GROUP BY project_id`,
      )
      .bind(...projectIds)
      .all();
    for (const r of results || []) {
      if (r.project_id != null) out[String(r.project_id)] = Number(r.c) || 0;
    }
  } catch {
    /* table drift */
  }
  return out;
}

export function computeHealth({ passRate, blockedCount, openIssueCount, estDate, status }) {
  if (passRate > 0) return Math.max(0, Math.min(100, Math.round(passRate)));
  let h = 100;
  h -= Math.min(40, (Number(blockedCount) || 0) * 8);
  h -= Math.min(30, (Number(openIssueCount) || 0) * 5);
  const st = String(status || '').toLowerCase();
  if (st === 'blocked' || st === 'maintenance') h -= 15;
  if (estDate) {
    const ts = typeof estDate === 'number' ? estDate * 1000 : Date.parse(String(estDate));
    if (!Number.isNaN(ts) && ts < Date.now() && st !== 'complete' && st !== 'archived') h -= 12;
  }
  return Math.max(0, Math.min(100, Math.round(h)));
}

export async function claimProjectCollaborator(env, projectId, authUser) {
  const email = authUser?.email ? String(authUser.email).trim().toLowerCase() : '';
  const userId = authUser?.id != null ? String(authUser.id) : null;
  if (!email || !userId || !env?.DB) return;
  try {
    await env.DB.prepare(
      `UPDATE project_collaborators
       SET user_id = ?, updated_at = unixepoch()
       WHERE project_id = ?
         AND LOWER(email) = ?
         AND (user_id IS NULL OR TRIM(user_id) = '')`,
    )
      .bind(userId, String(projectId), email)
      .run();
  } catch {
    /* optional table */
  }
}

export async function isProjectCollaborator(env, projectId, authUser) {
  const email = authUser?.email ? String(authUser.email).trim().toLowerCase() : '';
  const userId = authUser?.id != null ? String(authUser.id) : '';
  if (!email && !userId) return false;
  try {
    const clauses = [];
    const binds = [String(projectId)];
    if (email) {
      clauses.push('LOWER(c.email) = ?');
      binds.push(email);
    }
    if (userId) {
      clauses.push('c.user_id = ?');
      binds.push(userId);
    }
    const row = await env.DB.prepare(
      `SELECT c.id FROM project_collaborators c
       WHERE c.project_id = ? AND (${clauses.join(' OR ')})
       LIMIT 1`,
    )
      .bind(...binds)
      .first();
    return !!row;
  } catch {
    return false;
  }
}

export async function fetchCollaboratorProjectRows(env, authUser) {
  const email = authUser?.email ? String(authUser.email).trim().toLowerCase() : '';
  const userId = authUser?.id != null ? String(authUser.id) : '';
  if (!email && !userId) return [];
  try {
    const clauses = [];
    const binds = [];
    if (email) {
      clauses.push('LOWER(c.email) = ?');
      binds.push(email);
    }
    if (userId) {
      clauses.push('c.user_id = ?');
      binds.push(userId);
    }
    const { results } = await env.DB.prepare(
      `SELECT DISTINCT p.* FROM projects p
       INNER JOIN project_collaborators c ON c.project_id = p.id
       WHERE (${clauses.join(' OR ')})
       ORDER BY COALESCE(p.priority, 0) DESC, p.name ASC`,
    )
      .bind(...binds)
      .all();
    return results || [];
  } catch {
    return [];
  }
}

export function mergeProjectRowsById(primary, extra) {
  const map = new Map();
  for (const row of primary || []) map.set(String(row.id), row);
  for (const row of extra || []) {
    const id = String(row.id);
    if (!map.has(id)) map.set(id, row);
  }
  return [...map.values()];
}

export async function assertProjectAccess(env, authUser, row) {
  if (!row) return { ok: false, error: 'not_found', status: 404 };

  const collaborator = await isProjectCollaborator(env, String(row.id), authUser);
  if (collaborator) {
    await claimProjectCollaborator(env, String(row.id), authUser);
    return { ok: true, row, collaborator: true };
  }

  const projectWs = row.workspace_id != null ? String(row.workspace_id).trim() : '';
  if (projectWs && authUser?.id) {
    const { authorizeWorkspaceAccess } = await import('../../core/workspace-access.js');
    const ok = await authorizeWorkspaceAccess(env, authUser.id, projectWs);
    if (ok) return { ok: true, row };
  }

  if (
    authUser.tenant_id &&
    row.tenant_id &&
    String(row.tenant_id) !== String(authUser.tenant_id)
  ) {
    return { ok: false, error: 'forbidden', status: 403 };
  }
  // Same-tenant project without a valid registry workspace still allowed for list/edit,
  // but chat will refuse phantom workspace_id via authorizeWorkspaceAccess.
  return { ok: true, row };
}
