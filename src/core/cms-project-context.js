/**
 * Per-site agentsam_project_context rows for CMS project_slug values.
 * Invoked from GET /api/cms/bootstrap (idempotent upsert).
 * v2: summary + architecture_json (single worker per repo).
 */
import { cmsBootstrapKey, cmsPublishLockKey } from './cms-kv-cache.js';
import {
  buildCmsArchitectureJson,
  mergeRelationshipsJson,
} from './cms-project-context-v2.js';

/**
 * @param {string} projectSlug
 */
export function cmsProjectContextRowId(projectSlug) {
  const safe = String(projectSlug || 'unknown')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 80);
  return `ctx_cms_${safe}`;
}

/**
 * @param {any} env
 * @param {{
 *   tenantId: string,
 *   workspaceId: string,
 *   projectSlug: string,
 *   pageCount?: number,
 *   workerName?: string,
 *   r2Bucket?: string,
 * }} opts
 */
export async function upsertCmsSiteProjectContext(env, opts) {
  const tenantId = String(opts?.tenantId || '').trim();
  const workspaceId = String(opts?.workspaceId || '').trim();
  const projectSlug = String(opts?.projectSlug || '').trim();
  if (!env?.DB || !tenantId || !workspaceId || !projectSlug) return;

  const id = cmsProjectContextRowId(projectSlug);
  const bootstrapKey = cmsBootstrapKey(workspaceId, projectSlug);
  const publishLockKey = cmsPublishLockKey(workspaceId, projectSlug);
  const pageCount = Number(opts?.pageCount) || 0;
  const workerName = String(opts?.workerName || 'inneranimalmedia').trim() || 'inneranimalmedia';
  const r2Bucket = String(opts?.r2Bucket || 'inneranimalmedia').trim() || 'inneranimalmedia';

  const summary = [
    `CMS site project \`${projectSlug}\` on workspace ${workspaceId}.`,
    `D1: cms_pages (${pageCount} active), sections, themes, drafts.`,
    `R2 (ASSETS): published HTML, draft artifacts, theme CSS, snapshot rollback keys.`,
    `KV (SESSION_CACHE): ${bootstrapKey}, cms:live-session:{page_id}:{user_id}, cms:draft:{page_id}:{user_id}, ${publishLockKey}.`,
    `DO (IAM_COLLAB): live edit presence room cms:{page_id}.`,
  ].join(' ');

  const architectureJson = buildCmsArchitectureJson({ workerName, r2Bucket });
  const stateJson = JSON.stringify({
    source: 'cms_bootstrap',
    bootstrap_key: bootstrapKey,
    publish_lock_key: publishLockKey,
    note: 'Auto-upsert from cms bootstrap. KV+DO+ASSETS lanes active.',
  });
  const contextDocument = JSON.stringify({
    schema_version: 2,
    mission: summary,
    cms_site: true,
  });

  await env.DB.prepare(
    `INSERT INTO agentsam_project_context (
       id, tenant_id, workspace_id, project_key, project_name, project_type,
       ownership_type, maturity_stage,
       status, priority, summary,
       context_document, state_json, architecture_json,
       goals_json, constraints_json, blockers_json, relationships_json,
       created_at, updated_at
     ) VALUES (
       ?, ?, ?, ?, ?, 'cms_site',
       'internal', 'beta',
       'active', 75, ?,
       ?, ?, ?,
       '[]', '[]', '[]', '{}',
       unixepoch(), unixepoch()
     )
     ON CONFLICT(tenant_id, workspace_id, project_key) DO UPDATE SET
       project_name = excluded.project_name,
       summary = excluded.summary,
       context_document = excluded.context_document,
       state_json = excluded.state_json,
       architecture_json = excluded.architecture_json,
       status = 'active',
       updated_at = unixepoch()`,
  )
    .bind(
      id,
      tenantId,
      workspaceId,
      projectSlug,
      `CMS · ${projectSlug}`,
      summary,
      contextDocument,
      stateJson,
      architectureJson,
    )
    .run()
    .catch((e) => console.warn('[cms-project-context] upsert', e?.message ?? e));
}

/**
 * @param {any} env
 * @param {string} workspaceId
 * @param {string} projectSlug
 * @param {string} planId
 */
export async function linkCmsProjectPlan(env, workspaceId, projectSlug, planId) {
  const ws = String(workspaceId || '').trim();
  const slug = String(projectSlug || '').trim();
  const pid = String(planId || '').trim();
  if (!env?.DB || !ws || !slug || !pid) return;

  const row = await env.DB.prepare(
    `SELECT relationships_json FROM agentsam_project_context
     WHERE workspace_id = ? AND project_key = ? LIMIT 1`,
  )
    .bind(ws, slug)
    .first()
    .catch(() => null);

  const relationshipsJson = mergeRelationshipsJson(pid, row?.relationships_json);
  await env.DB.prepare(
    `UPDATE agentsam_project_context
        SET relationships_json = ?, updated_at = unixepoch()
      WHERE workspace_id = ? AND project_key = ?`,
  )
    .bind(relationshipsJson, ws, slug)
    .run()
    .catch(() => {});
}
