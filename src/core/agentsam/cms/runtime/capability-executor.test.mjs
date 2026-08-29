import assert from 'node:assert/strict';
import test from 'node:test';
import { createCmsCapabilityExecutor } from './capability-executor.js';

test('capability executor routes page.create and rejects mega unknown ops', async () => {
  const pages = [];
  const pageStore = {
    async list() { return pages; },
    async getById(id) { return pages.find((p) => p.id === id) || null; },
    async routeExists() { return false; },
    async insert(record) { pages.push(record); },
    async updateMetadata() {},
    async archive() {},
    async restore() {},
  };
  const sectionStore = {
    async listByPage() { return []; },
    async getById() { return null; },
    async insert() {},
    async update() {},
    async setVisibility() {},
    async reorder() {},
    async remove() {},
  };
  const blockStore = {
    async listBySection() { return []; },
    async getById() { return null; },
    async insert() {},
    async update() {},
    async setVisibility() {},
    async reorder() {},
    async remove() {},
  };
  const executor = createCmsCapabilityExecutor({
    cmsScope: {
      ok: true,
      authTenantId: 'tenant_x',
      workspaceId: 'ws_x',
      allowedSlugs: new Set(['demo']),
      sites: [],
    },
    actor: { tenantId: 'tenant_x', userId: 'au_x', workspaceId: 'ws_x' },
    pageStore,
    sectionStore,
    blockStore,
  });

  const created = await executor.execute({
    capability: 'page.create',
    input: {
      project_slug: 'demo',
      slug: 'about',
      title: 'About',
      route_path: '/about',
    },
  });
  assert.equal(created.ok, true);
  assert.equal(created.page.slug, 'about');
  assert.equal(pages.length, 1);

  const bad = await executor.execute({ capability: 'site.scaffold_and_publish', input: {} });
  assert.equal(bad.ok, false);
  assert.match(String(bad.error), /cms_capability_unsupported/);
});
