/**
 * D1 `projects` → Supabase `agentsam.agentsam_projects` mirror (Hyperdrive).
 * D1 remains SSOT for /api/projects; every POST/PATCH/DELETE must mirror here.
 */

import { isHyperdriveUsable, runHyperdriveQuery } from '../../backend/services/database/hyperdrive.js';

export const AGENTSAM_PROJECTS_TABLE = 'agentsam_projects';

function parseMetadataObject(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return { ...raw };
  try {
    const o = JSON.parse(String(raw));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

function safeJsonArray(raw, fallback = []) {
  try {
    const v = JSON.parse(String(raw || 'null'));
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function isoFromD1Time(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (Number.isFinite(n)) {
    const ms = n < 1e12 ? n * 1000 : n;
    return new Date(ms).toISOString();
  }
  const ms = Date.parse(String(v));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function slugifyBase(name) {
  return (
    String(name || 'project')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'project'
  );
}

/** @param {number|string|null|undefined} n */
export function d1PriorityToAgentsamLabel(n) {
  const p = Number(n) || 0;
  if (p >= 80) return 'P0';
  if (p >= 60) return 'P1';
  if (p >= 40) return 'P2';
  return 'P3';
}

/** @param {string|null|undefined} d1Status */
export function mapD1ProjectStatusToMirror(d1Status) {
  const s = String(d1Status || '').trim().toLowerCase();
  if (s === 'archived') return 'archived';
  if (s === 'discovery' || s === 'design') return 'planning';
  if (s === 'production' || s === 'development' || s === 'staging' || s === 'qa' || s === 'maintenance') {
    return 'active';
  }
  return s || 'active';
}

function buildStackFromRow(row, meta) {
  const stack = [];
  const tech = row?.tech_stack != null ? String(row.tech_stack).trim() : '';
  if (tech) stack.push(tech);
  if (row?.worker_id) stack.push(`worker:${row.worker_id}`);
  if (row?.d1_databases) stack.push(`d1:${row.d1_databases}`);
  if (Array.isArray(meta.stack)) return meta.stack;
  if (Array.isArray(meta.software_stack)) return meta.software_stack;
  return stack.filter(Boolean);
}

function buildInfraFromRow(row, meta) {
  return {
    d1_status: row?.status ?? null,
    worker_id: row?.worker_id ?? null,
    d1_databases: row?.d1_databases ?? null,
    r2_buckets: row?.r2_buckets ?? null,
    domain: row?.domain ?? null,
    hyperdrive_id: row?.hyperdrive_id ?? null,
    r2_urls: row?.r2_urls ?? null,
    theme_set: row?.theme_set ?? null,
    client_id: row?.client_id ?? null,
    client_app_id: row?.client_app_id ?? null,
    mcp_service_id: row?.mcp_service_id ?? null,
    ...(meta.infra && typeof meta.infra === 'object' ? meta.infra : {}),
  };
}

/**
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {Record<string, unknown>} row
 */
async function resolveTenantIdForProjectRow(db, row) {
  const existing = row?.tenant_id != null ? String(row.tenant_id).trim() : '';
  if (existing) return existing;
  const wsId = row?.workspace_id != null ? String(row.workspace_id).trim() : '';
  if (!db || !wsId) return null;
  try {
    const ws = await db
      .prepare(`SELECT owner_tenant_id, default_tenant_id FROM workspaces WHERE id = ? LIMIT 1`)
      .bind(wsId)
      .first();
    const tid = ws?.owner_tenant_id || ws?.default_tenant_id;
    return tid != null ? String(tid).trim() : null;
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, unknown>} row D1 projects row
 * @param {{ slug?: string|null, updatedBy?: string|null, workspaceProject?: Record<string, unknown>|null }} [opts]
 */
export function mapD1ProjectToSupabaseRow(row, opts = {}) {
  const tenantId =
    row?.tenant_id != null && String(row.tenant_id).trim()
      ? String(row.tenant_id).trim()
      : opts.resolvedTenantId != null
        ? String(opts.resolvedTenantId).trim()
        : null;
  if (!row?.id || !row?.workspace_id || !tenantId) return null;

  const meta = parseMetadataObject(row.metadata_json);
  const tags = safeJsonArray(row.tags_json, []);
  const slug =
    (opts.slug != null && String(opts.slug).trim()) ||
    (meta.slug != null && String(meta.slug).trim()) ||
    (opts.workspaceProject?.slug != null && String(opts.workspaceProject.slug).trim()) ||
    slugifyBase(row.name);

  const mirrorStatus = mapD1ProjectStatusToMirror(row.status);
  const archivedAt =
    mirrorStatus === 'archived' ? isoFromD1Time(row.updated_at) || new Date().toISOString() : null;

  const stack = buildStackFromRow(row, meta);
  const infra = buildInfraFromRow(row, meta);
  const designMeta =
    meta.design_meta && typeof meta.design_meta === 'object'
      ? meta.design_meta
      : {
          design_system_version: row.design_system_version ?? null,
          performance_budget: row.performance_budget ?? null,
          accessibility_target: row.accessibility_target ?? null,
        };

  const summaryParts = [
    String(row.name || '').trim(),
    String(row.description || '').trim(),
    String(row.project_type || '').trim(),
    String(row.status || '').trim(),
  ].filter(Boolean);
  const summary = summaryParts.join(' — ').slice(0, 4000);

  const liveUrl =
    (meta.live_url != null && String(meta.live_url).trim()) ||
    (row.domain ? `https://${String(row.domain).replace(/^https?:\/\//, '')}` : null);

  return {
    id: String(row.id),
    workspace_id: String(row.workspace_id),
    tenant_id: tenantId,
    parent_id:
      row.parent_id != null && String(row.parent_id).trim()
        ? String(row.parent_id).trim()
        : meta.parent_id != null
          ? String(meta.parent_id)
          : null,
    name: String(row.name || 'Untitled'),
    slug,
    description: row.description != null ? String(row.description) : null,
    status: mirrorStatus,
    project_type: String(row.project_type || meta.project_type || 'internal-tool'),
    client_name: row.client_name != null ? String(row.client_name) : null,
    client_contact: meta.client_contact != null ? String(meta.client_contact) : null,
    repo_url: meta.repo_url != null ? String(meta.repo_url) : null,
    live_url: liveUrl,
    stack,
    integrations: Array.isArray(meta.integrations) ? meta.integrations : [],
    infra,
    design_meta: designMeta,
    priority: d1PriorityToAgentsamLabel(row.priority),
    phase: meta.phase != null ? String(meta.phase) : null,
    is_pinned: meta.is_pinned === true || tags.includes('pinned'),
    billing_type: meta.billing_type != null ? String(meta.billing_type) : null,
    monthly_value:
      meta.monthly_value != null && Number.isFinite(Number(meta.monthly_value))
        ? Number(meta.monthly_value)
        : null,
    updated_by: opts.updatedBy != null ? String(opts.updatedBy) : row.owner_user_id != null ? String(row.owner_user_id) : null,
    last_activity: meta.last_activity != null ? String(meta.last_activity) : null,
    activity_log: Array.isArray(meta.activity_log) ? meta.activity_log : [],
    embedding_dirty: true,
    started_at: isoFromD1Time(meta.started_at || row.created_at),
    target_date: row.estimated_completion_date
      ? isoFromD1Time(row.estimated_completion_date)
      : row.launch_date
        ? isoFromD1Time(row.launch_date)
        : null,
    shipped_at: mirrorStatus === 'active' && String(row.status || '').toLowerCase() === 'production'
      ? isoFromD1Time(row.completion_date || row.updated_at)
      : null,
    archived_at: archivedAt,
    created_at: isoFromD1Time(row.created_at) || new Date().toISOString(),
    updated_at: isoFromD1Time(row.updated_at) || new Date().toISOString(),
    summary,
    embedding_model: meta.embedding_model != null ? String(meta.embedding_model).trim() || null : null,
  };
}

/** @param {import('@cloudflare/workers-types').D1Database} db */
async function pragmaProjectsColumns(db) {
  try {
    const { results } = await db.prepare(`PRAGMA table_info(projects)`).all();
    return new Set((results || []).map((r) => String(r.name || '').toLowerCase()));
  } catch {
    return new Set();
  }
}

/**
 * @param {any} env
 * @param {string} projectId
 * @param {{ ok: boolean, error?: string|null }} outcome
 */
export async function patchD1ProjectSupabaseMirrorState(env, projectId, outcome) {
  const db = env?.DB;
  const pid = String(projectId || '').trim();
  if (!db || !pid) return;

  const cols = await pragmaProjectsColumns(db);
  const fragments = [];
  const binds = [];

  if (cols.has('updated_at')) fragments.push(`updated_at = datetime('now')`);

  if (outcome.ok) {
    if (cols.has('supabase_sync_status')) fragments.push(`supabase_sync_status = 'synced'`);
    if (cols.has('supabase_sync_error')) fragments.push(`supabase_sync_error = NULL`);
    if (cols.has('supabase_synced_at')) fragments.push(`supabase_synced_at = datetime('now')`);
  } else {
    const msg = String(outcome.error || 'supabase_sync_failed').slice(0, 8000);
    if (cols.has('supabase_sync_status')) fragments.push(`supabase_sync_status = 'failed'`);
    if (cols.has('supabase_sync_error')) {
      fragments.push(`supabase_sync_error = ?`);
      binds.push(msg);
    }
  }

  if (cols.has('supabase_sync_attempts')) {
    fragments.push(`supabase_sync_attempts = COALESCE(supabase_sync_attempts, 0) + 1`);
  }

  if (!fragments.length) return;
  binds.push(pid);
  try {
    await db.prepare(`UPDATE projects SET ${fragments.join(', ')} WHERE id = ?`).bind(...binds).run();
  } catch (e) {
    console.warn('[agentsam-projects-supabase-sync] patchD1ProjectSupabaseMirrorState', e?.message ?? e);
  }
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} mirrorRow
 */
async function hyperdriveUpsertProject(env, mirrorRow) {
  const sql = `
    INSERT INTO agentsam.${AGENTSAM_PROJECTS_TABLE} (
      id, workspace_id, tenant_id, parent_id,
      name, slug, description, status, project_type,
      client_name, client_contact, repo_url, live_url,
      stack, integrations, infra, design_meta,
      priority, phase, is_pinned,
      billing_type, monthly_value,
      updated_by, last_activity, activity_log, embedding_dirty,
      started_at, target_date, shipped_at, archived_at,
      created_at, updated_at,
      summary, embedding_model
    ) VALUES (
      $1,$2,$3,$4,
      $5,$6,$7,$8,$9,
      $10,$11,$12,$13,
      $14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,
      $18,$19,$20,
      $21,$22,
      $23,$24,$25::jsonb,$26,
      $27::timestamptz,$28::timestamptz,$29::timestamptz,$30::timestamptz,
      $31::timestamptz,$32::timestamptz,
      $33,$34
    )
    ON CONFLICT (id) DO UPDATE SET
      workspace_id = EXCLUDED.workspace_id,
      tenant_id = EXCLUDED.tenant_id,
      parent_id = EXCLUDED.parent_id,
      name = EXCLUDED.name,
      slug = EXCLUDED.slug,
      description = EXCLUDED.description,
      status = EXCLUDED.status,
      project_type = EXCLUDED.project_type,
      client_name = EXCLUDED.client_name,
      client_contact = EXCLUDED.client_contact,
      repo_url = EXCLUDED.repo_url,
      live_url = EXCLUDED.live_url,
      stack = EXCLUDED.stack,
      integrations = EXCLUDED.integrations,
      infra = EXCLUDED.infra,
      design_meta = EXCLUDED.design_meta,
      priority = EXCLUDED.priority,
      phase = EXCLUDED.phase,
      is_pinned = EXCLUDED.is_pinned,
      billing_type = EXCLUDED.billing_type,
      monthly_value = EXCLUDED.monthly_value,
      updated_by = EXCLUDED.updated_by,
      last_activity = EXCLUDED.last_activity,
      activity_log = EXCLUDED.activity_log,
      embedding_dirty = EXCLUDED.embedding_dirty,
      started_at = EXCLUDED.started_at,
      target_date = EXCLUDED.target_date,
      shipped_at = EXCLUDED.shipped_at,
      archived_at = EXCLUDED.archived_at,
      updated_at = EXCLUDED.updated_at,
      summary = EXCLUDED.summary,
      embedding_model = EXCLUDED.embedding_model`;

  const params = [
    mirrorRow.id,
    mirrorRow.workspace_id,
    mirrorRow.tenant_id,
    mirrorRow.parent_id,
    mirrorRow.name,
    mirrorRow.slug,
    mirrorRow.description,
    mirrorRow.status,
    mirrorRow.project_type,
    mirrorRow.client_name,
    mirrorRow.client_contact,
    mirrorRow.repo_url,
    mirrorRow.live_url,
    JSON.stringify(mirrorRow.stack ?? []),
    JSON.stringify(mirrorRow.integrations ?? []),
    JSON.stringify(mirrorRow.infra ?? {}),
    JSON.stringify(mirrorRow.design_meta ?? {}),
    mirrorRow.priority,
    mirrorRow.phase,
    mirrorRow.is_pinned === true,
    mirrorRow.billing_type,
    mirrorRow.monthly_value,
    mirrorRow.updated_by,
    mirrorRow.last_activity,
    JSON.stringify(mirrorRow.activity_log ?? []),
    mirrorRow.embedding_dirty !== false,
    mirrorRow.started_at,
    mirrorRow.target_date,
    mirrorRow.shipped_at,
    mirrorRow.archived_at,
    mirrorRow.created_at,
    mirrorRow.updated_at,
    mirrorRow.summary,
    mirrorRow.embedding_model,
  ];

  return runHyperdriveQuery(env, sql, params);
}

/**
 * @param {any} env
 * @param {string} projectId
 */
async function hyperdriveDeleteProject(env, projectId) {
  return runHyperdriveQuery(
    env,
    `DELETE FROM agentsam.${AGENTSAM_PROJECTS_TABLE} WHERE id = $1`,
    [String(projectId)],
  );
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} row D1 projects row
 * @param {{ updatedBy?: string|null, hardDelete?: boolean }} [opts]
 */
export async function syncProjectToSupabase(env, row, opts = {}) {
  const pid = row?.id != null ? String(row.id).trim() : '';
  if (!pid || !env?.DB) return { ok: false, error: 'missing_project_row' };

  if (!isHyperdriveUsable(env)) {
    await patchD1ProjectSupabaseMirrorState(env, pid, { ok: false, error: 'hyperdrive_unavailable' });
    return { ok: false, error: 'hyperdrive_unavailable' };
  }

  if (opts.hardDelete) {
    const del = await hyperdriveDeleteProject(env, pid);
    if (!del.ok) {
      await patchD1ProjectSupabaseMirrorState(env, pid, { ok: false, error: del.error || 'delete_failed' });
      return { ok: false, error: del.error || 'delete_failed' };
    }
    await patchD1ProjectSupabaseMirrorState(env, pid, { ok: true });
    return { ok: true, deleted: true };
  }

  let workspaceProject = null;
  try {
    workspaceProject = await env.DB.prepare(
      `SELECT id, slug, metadata_json FROM workspace_projects
       WHERE json_extract(metadata_json, '$.projects_table_id') = ?
       LIMIT 1`,
    )
      .bind(pid)
      .first();
  } catch {
    /* optional */
  }

  const resolvedTenantId = await resolveTenantIdForProjectRow(env.DB, row);
  const mirrorRow = mapD1ProjectToSupabaseRow(row, {
    slug: workspaceProject?.slug,
    workspaceProject,
    updatedBy: opts.updatedBy ?? null,
    resolvedTenantId,
  });

  if (!mirrorRow) {
    await patchD1ProjectSupabaseMirrorState(env, pid, { ok: false, error: 'map_failed' });
    return { ok: false, error: 'map_failed' };
  }

  const upsert = await hyperdriveUpsertProject(env, mirrorRow);
  if (!upsert.ok) {
    await patchD1ProjectSupabaseMirrorState(env, pid, { ok: false, error: upsert.error || 'upsert_failed' });
    return { ok: false, error: upsert.error || 'upsert_failed' };
  }

  await patchD1ProjectSupabaseMirrorState(env, pid, { ok: true });
  return { ok: true, id: pid };
}

/**
 * Mandatory mirror after D1 project mutation — awaited on write paths.
 * @param {any} env
 * @param {any} ctx
 * @param {Record<string, unknown>} row
 * @param {{ updatedBy?: string|null, hardDelete?: boolean, awaitSync?: boolean }} [opts]
 */
export function scheduleSyncProjectToSupabase(env, ctx, row, opts = {}) {
  const run = syncProjectToSupabase(env, row, opts).catch((e) => {
    console.warn('[scheduleSyncProjectToSupabase]', e?.message ?? e);
    return { ok: false, error: e?.message ?? String(e) };
  });

  if (opts.awaitSync === true) return run;

  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(run);
  else void run;
  return Promise.resolve({ ok: true, scheduled: true });
}
