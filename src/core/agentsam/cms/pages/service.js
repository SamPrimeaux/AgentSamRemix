import { cmsPageInScope } from '../context/access.js';
import { assertCmsPageStore } from './contracts.js';
import { normalizeCmsPageCreateInput, normalizeCmsPageRow, normalizeCmsPageUpdateInput } from './normalize.js';

function trim(v) { return v == null ? '' : String(v).trim(); }
function allowedProject(scope, slug) { return Boolean(slug && scope?.allowedSlugs?.has?.(slug)); }

export async function listCmsPages(scope, options, store) {
  assertCmsPageStore(store);
  const projectSlug = trim(options?.projectSlug);
  if (projectSlug && !allowedProject(scope, projectSlug)) return { ok: false, error: 'CMS_SITE_NOT_ALLOWED', status: 403 };
  const rows = await store.list(scope, { projectSlug: projectSlug || null, includeArchived: options?.includeArchived === true });
  return { ok: true, pages: (rows || []).map(normalizeCmsPageRow).filter(Boolean) };
}

export async function getCmsPage(scope, pageId, store, projectSlug = null) {
  assertCmsPageStore(store);
  const row = await store.getById(pageId);
  if (!row || !cmsPageInScope(row, scope)) return { ok: false, error: 'Page not found', status: 404 };
  const expected = trim(projectSlug);
  if (expected && trim(row.project_slug || row.project_id) !== expected) return { ok: false, error: 'Page not found', status: 404 };
  return { ok: true, page: normalizeCmsPageRow(row), raw: row };
}

export async function createCmsPage(scope, input, actor, store) {
  assertCmsPageStore(store);
  const normalized = normalizeCmsPageCreateInput(input);
  if (!normalized.ok) return { ...normalized, status: 400 };
  const page = normalized.page;
  if (!allowedProject(scope, page.project_slug)) return { ok: false, error: 'CMS_SITE_NOT_ALLOWED', status: 403 };
  if (await store.routeExists(scope, page.project_slug, page.route_path, null)) return { ok: false, error: 'route_exists', status: 409 };
  const now = Math.floor(Date.now() / 1000);
  const record = {
    ...page,
    id: input?.id || crypto.randomUUID(),
    tenant_id: actor?.tenantId || scope.authTenantId || null,
    workspace_id: actor?.workspaceId || scope.workspaceId || null,
    person_uuid: actor?.personUuid || actor?.userId || null,
    created_by: actor?.userId || null,
    updated_by: actor?.userId || null,
    r2_key: input?.r2_key || null,
    r2_bucket: input?.r2_bucket || null,
    content_type: input?.content_type || 'text/html',
    content_size_bytes: Number(input?.content_size_bytes) || 0,
    metadata_json:
      typeof input?.metadata_json === 'string'
        ? input.metadata_json
        : JSON.stringify(input?.metadata_json ?? input?.metadata ?? {}),
    created_at: now,
    updated_at: now,
    published_at: page.status === 'published' ? now : null,
  };
  await store.insert(record);
  return { ok: true, page: normalizeCmsPageRow(record) };
}

export async function updateCmsPage(scope, pageId, input, actor, store) {
  const currentResult = await getCmsPage(scope, pageId, store);
  if (!currentResult.ok) return currentResult;
  const normalized = normalizeCmsPageUpdateInput(currentResult.page, input);
  if (!normalized.ok) return { ...normalized, status: 400 };
  const next = normalized.page;
  if (await store.routeExists(scope, next.project_slug, next.route_path, pageId)) return { ok: false, error: 'route_exists', status: 409 };
  await store.updateMetadata(pageId, next, { userId: actor?.userId || null, now: Math.floor(Date.now() / 1000) });
  const refreshed = await store.getById(pageId);
  return { ok: true, page: normalizeCmsPageRow(refreshed || next) };
}

export async function archiveCmsPage(scope, pageId, actor, store) {
  const current = await getCmsPage(scope, pageId, store);
  if (!current.ok) return current;
  await store.archive(pageId, { userId: actor?.userId || null, now: Math.floor(Date.now() / 1000) });
  return { ok: true, page: normalizeCmsPageRow({ ...current.page, status: 'archived' }) };
}

export async function restoreCmsPage(scope, pageId, actor, store) {
  const row = await store.getById(pageId);
  if (!row || !cmsPageInScope(row, scope)) return { ok: false, error: 'Page not found', status: 404 };
  const page = normalizeCmsPageRow(row);
  if (await store.routeExists(scope, page.project_slug, page.route_path, pageId)) return { ok: false, error: 'route_exists', status: 409 };
  await store.restore(pageId, { userId: actor?.userId || null, now: Math.floor(Date.now() / 1000) });
  return { ok: true, page: normalizeCmsPageRow({ ...page, status: 'draft', archived_at: null }) };
}
