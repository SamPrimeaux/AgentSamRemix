/**
 * MovieMode project registry — ensures FK-safe rows in moviemode_projects.
 */
import { buildMoviemodeR2Prefix } from '../api/moviemode-api.js';

/**
 * @param {unknown} env
 * @param {{ tenantId: string, workspaceId: string, projectId: string, slug?: string, title?: string }} scope
 */
export async function ensureMoviemodeProject(env, scope) {
  const tenantId = String(scope.tenantId || '').trim();
  const workspaceId = String(scope.workspaceId || '').trim();
  const projectId = String(scope.projectId || '').trim();
  if (!env?.DB || !tenantId || !workspaceId || !projectId) return projectId;

  const existing = await env.DB.prepare(
    `SELECT id FROM moviemode_projects WHERE id = ? AND workspace_id = ? LIMIT 1`,
  )
    .bind(projectId, workspaceId)
    .first()
    .catch(() => null);
  if (existing?.id) return String(existing.id);

  const slug =
    String(scope.slug || '').trim() ||
    `proj-${projectId.slice(0, 24).replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`;
  const title = String(scope.title || '').trim() || 'MovieMode Project';

  await env.DB.prepare(
    `INSERT OR IGNORE INTO moviemode_projects
       (id, tenant_id, workspace_id, slug, title, r2_prefix, status, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)`,
  )
    .bind(
      projectId,
      tenantId,
      workspaceId,
      slug,
      title,
      buildMoviemodeR2Prefix(workspaceId, slug),
      JSON.stringify({ source: 'ensure_moviemode_project' }),
    )
    .run()
    .catch((e) => console.warn('[moviemode] ensure project', e?.message ?? e));

  return projectId;
}

/**
 * Default export sink project per workspace (FK-safe).
 * @param {unknown} env
 * @param {{ tenantId: string, workspaceId: string }} scope
 */
export async function ensureMoviemodeExportProject(env, scope) {
  const workspaceId = String(scope.workspaceId || '').trim();
  const projectId = `mmproj_export_${workspaceId.slice(0, 12)}`;
  await ensureMoviemodeProject(env, {
    tenantId: scope.tenantId,
    workspaceId,
    projectId,
    slug: 'exports',
    title: 'MovieMode Exports',
  });
  return projectId;
}
