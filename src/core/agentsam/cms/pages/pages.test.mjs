import assert from 'node:assert/strict';
import {
  archiveCmsPage,
  createCmsPage,
  listCmsPages,
  normalizeCmsPageCreateInput,
  normalizeCmsPageRow,
  restoreCmsPage,
  updateCmsPage,
} from './index.js';

const scope = {
  authTenantId: 'tenant-1', workspaceId: 'ws-1', registryMode: false,
  allowedSlugs: new Set(['site-a']), sites: [],
};
const rows = new Map();
const store = {
  async list(_scope, { projectSlug, includeArchived }) {
    return [...rows.values()].filter((r) => (!projectSlug || r.project_slug === projectSlug) && (includeArchived || r.status !== 'archived'));
  },
  async getById(id) { return rows.get(id) || null; },
  async routeExists(_scope, projectSlug, routePath, excludeId) {
    return [...rows.values()].some((r) => r.project_slug === projectSlug && r.route_path === routePath && r.status !== 'archived' && r.id !== excludeId);
  },
  async insert(page) { rows.set(page.id, { ...page }); },
  async updateMetadata(id, page, meta) { rows.set(id, { ...rows.get(id), ...page, updated_at: meta.now, updated_by: meta.userId }); },
  async archive(id, meta) { rows.set(id, { ...rows.get(id), status: 'archived', archived_at: meta.now }); },
  async restore(id) { rows.set(id, { ...rows.get(id), status: 'draft', archived_at: null }); },
};

const homeInput = normalizeCmsPageCreateInput({ project_id: 'site-a', slug: 'home', title: 'Home', route_path: '/', page_type: 'landing' });
assert.equal(homeInput.page.route_path, '/');
assert.equal(homeInput.page.page_type, 'home');
assert.equal('is_homepage' in homeInput.page, false);

const created = await createCmsPage(scope, { id: 'p1', project_id: 'site-a', slug: 'home', title: 'Home', route_path: '/' }, { tenantId: 'tenant-1', workspaceId: 'ws-1', userId: 'u1' }, store);
assert.equal(created.ok, true);
assert.equal(created.page.page_type, 'home');
assert.equal('is_homepage' in created.page, false);

const conflict = await createCmsPage(scope, { id: 'p2', project_id: 'site-a', slug: 'other-home', title: 'Other', route_path: '/' }, { tenantId: 'tenant-1', workspaceId: 'ws-1', userId: 'u1' }, store);
assert.equal(conflict.error, 'route_exists');

const updated = await updateCmsPage(scope, 'p1', { route_path: '/welcome', page_type: 'home', slug: 'welcome' }, { userId: 'u2' }, store);
assert.equal(updated.page.route_path, '/welcome');
assert.equal(updated.page.page_type, 'standard');

const listed = await listCmsPages(scope, { projectSlug: 'site-a' }, store);
assert.equal(listed.pages.length, 1);
assert.equal('is_homepage' in normalizeCmsPageRow({ ...listed.pages[0], is_homepage: 1 }), false);

assert.equal((await archiveCmsPage(scope, 'p1', { userId: 'u2' }, store)).page.status, 'archived');
assert.equal((await listCmsPages(scope, { projectSlug: 'site-a' }, store)).pages.length, 0);
assert.equal((await restoreCmsPage(scope, 'p1', { userId: 'u2' }, store)).page.status, 'draft');
console.log('cms-pages tests: OK');
