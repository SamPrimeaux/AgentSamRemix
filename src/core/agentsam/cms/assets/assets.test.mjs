import assert from 'node:assert/strict';
import {
  cmsAssetToLegacyRow,
  createCmsAsset,
  getCmsAsset,
  listCmsAssets,
  listCmsCollectionAssets,
  normalizeCmsAssetRow,
  removeCmsAsset,
  resolveCmsAssetKind,
  updateCmsAsset,
} from './index.js';

assert.equal(resolveCmsAssetKind('image/png', 'x.bin'), 'image');
assert.equal(resolveCmsAssetKind('', 'scene.glb'), 'model');
assert.equal(resolveCmsAssetKind('application/pdf', 'x'), 'document');

const expanded = normalizeCmsAssetRow({
  id: 'a1', tenant_id: 't1', filename: 'hero.webp', original_filename: 'Hero.webp', path: 'cms/a/hero.webp',
  size: 1200, mime_type: 'image/webp', category: 'image', tags: '["hero","homepage"]', r2_key: 'cms/a/hero.webp',
  r2_bucket: 'cms', public_url: 'https://cms.example/hero.webp', thumbnail_url: 'https://thumb', metadata: '{"source":"upload"}',
  is_live: 1, alt_text: 'Hero image', usage_context: 'hero', asset_key: 'hero-main', label: 'Hero',
});
assert.equal(expanded.name, 'Hero.webp');
assert.equal(expanded.kind, 'image');
assert.equal(expanded.size_bytes, 1200);
assert.deepEqual(expanded.tags, ['hero', 'homepage']);
assert.equal(expanded.storage.key, 'cms/a/hero.webp');
assert.equal(expanded.usage_context, 'hero');
assert.equal(expanded.is_live, true);

const compact = normalizeCmsAssetRow({
  id: 'a2', tenant_id: 't1', workspace_id: 'w1', project_slug: 'site-a', file_name: 'logo.svg', r2_bucket: 'cms',
  r2_key: 'cms/site-a/logo.svg', mime_type: 'image/svg+xml', size_bytes: 42, alt_text: 'Logo',
  metadata_json: JSON.stringify({ category: 'brand', usage_context: 'header', label: 'Primary logo', asset_key: 'logo', public_url: 'https://cdn/logo.svg', is_live: true }),
});
assert.equal(compact.name, 'logo.svg');
assert.equal(compact.category, 'brand');
assert.equal(compact.usage_context, 'header');
assert.equal(compact.label, 'Primary logo');
assert.equal(compact.urls.public, 'https://cdn/logo.svg');
assert.equal(compact.is_live, true);

const rows = new Map();
const store = {
  async list() { return [...rows.values()]; },
  async getById(id) { return rows.get(id) || null; },
  async insert(asset) {
    rows.set(asset.id, {
      id: asset.id, tenant_id: asset.tenant_id, workspace_id: asset.workspace_id, project_slug: asset.project_slug,
      file_name: asset.name, r2_bucket: asset.storage.bucket, r2_key: asset.storage.key, mime_type: asset.mime_type,
      size_bytes: asset.size_bytes, alt_text: asset.alt_text,
      metadata_json: JSON.stringify({ ...asset.metadata, category: asset.category, usage_context: asset.usage_context, label: asset.label, asset_key: asset.asset_key }),
    });
  },
  async update(id, patch) {
    const current = rows.get(id);
    let meta = {};
    try { meta = JSON.parse(current.metadata_json || '{}'); } catch {}
    for (const key of ['category','usage_context','label','asset_key','public_url','thumbnail_url','is_live']) if (key in patch) meta[key] = patch[key];
    if (patch.metadata) meta = { ...meta, ...patch.metadata };
    rows.set(id, { ...current, alt_text: 'alt_text' in patch ? patch.alt_text : current.alt_text, metadata_json: JSON.stringify(meta) });
  },
  async remove(id) { rows.delete(id); },
  async listCollection(_scope, collectionId) {
    return [...rows.values()].map((row, index) => ({ collection_id: collectionId || 'all', asset_id: row.id, order_index: index, added_at: 1, ...row }));
  },
};

const scope = { tenantId: 't1', workspaceId: 'w1', projectSlug: 'site-a' };
const created = await createCmsAsset(scope, { id: 'a3', filename: 'photo.jpg', r2_key: 'cms/site-a/photo.jpg', r2_bucket: 'cms', mime_type: 'image/jpeg', size: 500, category: 'photo', usage_context: 'gallery' }, store);
assert.equal(created.ok, true);
assert.equal(created.asset.kind, 'image');
assert.equal((await listCmsAssets(scope, { category: 'photo' }, store)).assets.length, 1);
assert.equal((await listCmsAssets(scope, { category: 'video' }, store)).assets.length, 0);
const updated = await updateCmsAsset(scope, 'a3', { alt_text: 'A photo', label: 'Gallery photo', usage_context: 'hero' }, store);
assert.equal(updated.asset.alt_text, 'A photo');
assert.equal(updated.asset.label, 'Gallery photo');
assert.equal(updated.asset.usage_context, 'hero');
assert.equal((await getCmsAsset(scope, 'a3', store)).ok, true);
assert.equal((await listCmsCollectionAssets(scope, 'home', store)).assets[0].asset.id, 'a3');
const legacy = cmsAssetToLegacyRow(updated.asset);
assert.equal(legacy.filename, 'photo.jpg');
assert.equal(legacy.content_size_bytes, 500);
assert.equal((await removeCmsAsset(scope, 'a3', store)).removed, true);
assert.equal((await getCmsAsset(scope, 'a3', store)).status, 404);
console.log('cms-assets tests: OK');
