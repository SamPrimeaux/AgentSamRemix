import assert from 'node:assert/strict';
import {
  createCmsSection,
  getCmsSection,
  listCmsSections,
  removeCmsSection,
  reorderCmsSections,
  sectionToLegacyRow,
  setCmsSectionVisibility,
  updateCmsSection,
} from './index.js';
import * as canonicalFields from './fields.js';
import * as legacyFields from '../../../cms-section-fields.js';

const scope = {
  authTenantId: 'tenant-1',
  workspaceId: 'ws-1',
  registryMode: false,
  allowedSlugs: new Set(['site-a']),
  sites: [],
};

const pages = new Map([
  ['p1', { id: 'p1', project_id: 'site-a', project_slug: 'site-a', tenant_id: 'tenant-1', workspace_id: 'ws-1', slug: 'home', route_path: '/', page_type: 'home', status: 'draft' }],
]);
const pageStore = {
  async list() { return [...pages.values()]; },
  async getById(id) { return pages.get(id) || null; },
  async routeExists() { return false; },
  async insert(row) { pages.set(row.id, { ...row }); },
  async updateMetadata(id, row) { pages.set(id, { ...pages.get(id), ...row }); },
  async archive(id) { pages.set(id, { ...pages.get(id), status: 'archived' }); },
  async restore(id) { pages.set(id, { ...pages.get(id), status: 'draft' }); },
};

const rows = new Map();
const sectionStore = {
  async listByPage(pageId) { return [...rows.values()].filter((r) => r.page_id === pageId).sort((a,b) => a.sort_order-b.sort_order); },
  async getById(id) { return rows.get(id) || null; },
  async insert(s) { rows.set(s.id, { id:s.id, page_id:s.page_id, section_type:s.type, section_name:s.name, section_data:JSON.stringify(s.data||{}), sort_order:s.sort_order, is_visible:s.visible?1:0, css_classes:s.css_classes||'', custom_css:s.custom_css||'', updated_at:null }); },
  async update(id, p) {
    const r = { ...rows.get(id) };
    if ('data' in p) r.section_data = typeof p.data === 'string' ? p.data : JSON.stringify(p.data || {});
    if ('name' in p) r.section_name = p.name;
    if ('type' in p) r.section_type = p.type;
    if ('sort_order' in p) r.sort_order = p.sort_order;
    if ('visible' in p) r.is_visible = p.visible ? 1 : 0;
    if ('css_classes' in p) r.css_classes = p.css_classes;
    if ('custom_css' in p) r.custom_css = p.custom_css;
    rows.set(id, r);
  },
  async setVisibility(id, v) { rows.set(id, { ...rows.get(id), is_visible: v ? 1 : 0 }); },
  async reorder(id, n) { rows.set(id, { ...rows.get(id), sort_order: n }); },
  async remove(id) { rows.delete(id); },
};

const created = await createCmsSection(scope, {
  id: 's1', page_id: 'p1', section_type: 'hero', section_name: 'Hero', section_data: { headline: 'Hello' }, sort_order: 20,
}, pageStore, sectionStore);
assert.equal(created.ok, true);
assert.deepEqual(created.section.data, { headline: 'Hello' });
assert.equal(created.section.visible, true);
assert.equal(sectionToLegacyRow(created.section).section_type, 'hero');

const metadataOnly = await updateCmsSection(scope, 's1', { section_name: 'Primary Hero', sort_order: 10 }, pageStore, sectionStore);
assert.equal(metadataOnly.ok, true);
assert.equal(metadataOnly.section.name, 'Primary Hero');
assert.deepEqual(metadataOnly.section.data, { headline: 'Hello' });

const dataUpdate = await updateCmsSection(scope, 's1', { section_data: { headline: 'Updated', nested: { a: 1 } }, css_classes: 'hero-xl' }, pageStore, sectionStore);
assert.equal(dataUpdate.section.data.headline, 'Updated');
assert.equal(dataUpdate.section.css_classes, 'hero-xl');

assert.equal((await setCmsSectionVisibility(scope, 's1', false, pageStore, sectionStore)).section.visible, false);
assert.equal((await reorderCmsSections(scope, [{ id: 's1', sort_order: 3 }], pageStore, sectionStore)).updated, 1);
assert.equal((await getCmsSection(scope, 's1', pageStore, sectionStore)).section.sort_order, 3);
assert.equal((await listCmsSections(scope, 'p1', pageStore, sectionStore)).sections.length, 1);

for (const key of ['flattenSectionDataForEditor','applyEditorFieldValues','extractCmsFieldMarkersFromHtml','applyCmsFieldValuesToHtml','normalizeSectionDataForWrite']) {
  assert.equal(legacyFields[key], canonicalFields[key], `legacy field facade drifted for ${key}`);
}

assert.equal((await removeCmsSection(scope, 's1', pageStore, sectionStore)).removed, true);
assert.equal((await listCmsSections(scope, 'p1', pageStore, sectionStore)).sections.length, 0);
console.log('cms-sections tests: OK');
