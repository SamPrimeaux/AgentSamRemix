import { jsonResponse } from '../../core/auth.js';
import { cmsAssetToLegacyRow, listCmsAssets } from '../../core/agentsam/cms/assets/index.js';

export async function handleCmsAssetRoutes(state) {
  const { path, method, url, assetScope, assetStore } = state;
  if (path !== '/api/cms/assets' || method !== 'GET') return null;
  const category = url.searchParams.get('category') || null;
  const context = url.searchParams.get('context') || null;
  try {
    const result = await listCmsAssets(assetScope, { category, context, limit: 100 }, assetStore);
    return jsonResponse({ assets: result.assets.map(cmsAssetToLegacyRow) });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}
