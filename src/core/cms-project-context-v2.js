/**
 * v2 agentsam_project_context helpers — architecture in JSON, one worker per repo.
 */

export const CMS_ARCHITECTURE_TABLES = [
  'cms_pages',
  'cms_page_sections',
  'cms_section_components',
  'cms_themes',
  'cms_component_templates',
  'cms_page_drafts',
  'cms_page_overrides',
  'cms_live_edit_sessions',
];

export const CMS_ARCHITECTURE_ROUTES = [
  'cms_edit',
  'cms_live_editor.*',
  '/dashboard/cms/*',
  '/api/cms/bootstrap',
  '/api/cms/live-session/join',
  '/api/cms/live-session/heartbeat',
  '/api/cms/live-session/leave',
  '/api/cms/pages/*/draft',
  '/api/cms/overrides',
  '/api/cms/rollback',
];

const PROVISION_TABLES = [
  'cms_pages',
  'cms_page_sections',
  'cms_themes',
  'cms_page_drafts',
];

const PROVISION_ROUTES = [
  'cms_edit',
  '/dashboard/cms/*',
  '/api/cms/bootstrap',
  '/api/cms/projects/create',
];

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * One deployable worker per project/repo (e.g. legendary-os — not IAM hub + client).
 * @param {{ workerName: string, r2Bucket?: string|null, tables?: string[], routes?: string[], repo?: string|null }} opts
 */
export function buildCmsArchitectureJson(opts) {
  const worker = trim(opts.workerName) || 'inneranimalmedia';
  const r2 = trim(opts.r2Bucket);
  return JSON.stringify({
    tables: opts.tables?.length ? opts.tables : CMS_ARCHITECTURE_TABLES,
    routes: opts.routes?.length ? opts.routes : CMS_ARCHITECTURE_ROUTES,
    workers: [worker],
    worker_count: 1,
    r2_buckets: r2 ? [r2] : [],
    repo: trim(opts.repo) || null,
  });
}

export function buildProvisionArchitectureJson(workerName, r2Bucket) {
  return buildCmsArchitectureJson({
    workerName,
    r2Bucket,
    tables: PROVISION_TABLES,
    routes: PROVISION_ROUTES,
  });
}

/**
 * @param {string} planId
 * @param {Record<string, unknown>|null} [existing]
 */
export function mergeRelationshipsJson(planId, existing = null) {
  let base = {};
  if (existing && typeof existing === 'object') base = { ...existing };
  else if (typeof existing === 'string' && existing.trim()) {
    try {
      base = JSON.parse(existing) || {};
    } catch {
      base = {};
    }
  }
  if (planId) base.linked_plan_id = planId;
  return JSON.stringify(base);
}
