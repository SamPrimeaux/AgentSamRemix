import { assertCmsAssetStore } from './contracts.js';
import { normalizeCmsAssetInput, normalizeCmsAssetRow } from './normalize.js';

function scopeForStore(scope = {}) {
  return {
    tenantId: String(scope.tenantId || scope.authTenantId || '').trim() || null,
    workspaceId: String(scope.workspaceId || '').trim() || null,
    projectSlug: String(scope.projectSlug || '').trim() || null,
  };
}

function matchesFilters(asset, filters = {}) {
  const category = String(filters.category || '').trim();
  const context = String(filters.context || filters.usage_context || '').trim();
  if (category && asset.category !== category) return false;
  if (context && asset.usage_context !== context) return false;
  return true;
}

export async function listCmsAssets(scope, filters, store) {
  assertCmsAssetStore(store);
  const limit = Math.min(250, Math.max(1, Number(filters?.limit || 100) || 100));
  const rows = await store.list(scopeForStore(scope), { limit: Math.max(limit, 100) });
  const assets = rows.map(normalizeCmsAssetRow).filter(Boolean).filter((asset) => matchesFilters(asset, filters)).slice(0, limit);
  return { ok: true, assets };
}

export async function getCmsAsset(scope, assetId, store) {
  assertCmsAssetStore(store);
  const row = await store.getById(String(assetId || '').trim(), scopeForStore(scope));
  if (!row) return { ok: false, error: 'Asset not found', status: 404 };
  return { ok: true, asset: normalizeCmsAssetRow(row) };
}

export async function createCmsAsset(scope, input, store) {
  assertCmsAssetStore(store);
  const normalized = normalizeCmsAssetInput(input, scopeForStore(scope));
  if (!normalized.ok) return { ...normalized, status: 400 };
  await store.insert(normalized.asset);
  return getCmsAsset(scope, normalized.asset.id, store);
}

export async function updateCmsAsset(scope, assetId, input, store) {
  const current = await getCmsAsset(scope, assetId, store);
  if (!current.ok) return current;
  const patch = {};
  for (const key of ['alt_text', 'category', 'usage_context', 'label', 'asset_key']) {
    if (key in input) patch[key] = input[key] == null ? null : String(input[key]).trim();
  }
  if ('metadata' in input && input.metadata && typeof input.metadata === 'object') patch.metadata = input.metadata;
  if ('is_live' in input) patch.is_live = input.is_live === true || input.is_live === 1;
  if ('public_url' in input) patch.public_url = String(input.public_url || '').trim() || null;
  if ('thumbnail_url' in input) patch.thumbnail_url = String(input.thumbnail_url || '').trim() || null;
  if (!Object.keys(patch).length) return { ok: false, error: 'no_valid_fields', status: 400 };
  await store.update(String(assetId), patch);
  return getCmsAsset(scope, assetId, store);
}

export async function removeCmsAsset(scope, assetId, store) {
  const current = await getCmsAsset(scope, assetId, store);
  if (!current.ok) return current;
  await store.remove(String(assetId), scopeForStore(scope));
  return { ok: true, id: String(assetId), asset: current.asset, removed: true };
}

export async function listCmsCollectionAssets(scope, collectionId, store) {
  assertCmsAssetStore(store);
  const rows = await store.listCollection(scopeForStore(scope), String(collectionId || '').trim() || null, { limit: 100 });
  return {
    ok: true,
    assets: rows.map((row) => ({
      collection_id: row.collection_id,
      asset_id: row.asset_id,
      order_index: Number(row.order_index || 0),
      added_at: row.added_at ?? null,
      asset: normalizeCmsAssetRow(row),
    })),
  };
}
