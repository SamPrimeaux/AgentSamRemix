import { jsonResponse } from '../../core/auth.js';
import { createCloudflareCmsConversionStore } from '../../core/agentsam/cms/adapters/cloudflare/conversion-store.js';
import { cmsExceedsSpawnThreshold, maybeSpawnCmsHeavyJob } from '../../core/cms-spawn-bridge.js';

export async function handleCmsConversionRoutes(state) {
  const { path, method, request, env, ctx, authUser, tenantId, workspaceId } = state;
  if (path !== '/api/cms/conversions') return null;
  const store = createCloudflareCmsConversionStore(env);
  if (method === 'GET') {
    try { return jsonResponse(await store.list(tenantId, 30)); }
    catch (e) { return jsonResponse({ error: e.message }, 500); }
  }
  if (method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch { return jsonResponse({ error: 'invalid JSON' }, 400); }
    const sourceFormat = String(body.source_format || body.sourceFormat || 'liquid').trim();
    const targetFormat = String(body.target_format || body.targetFormat || 'sections').trim();
    const assetId = String(body.asset_id || body.assetId || '').trim() || null;
    const importName = String(body.import_name || body.importName || 'cms_import').trim();
    try {
      const created = await store.create({ tenantId, assetId, sourceFormat, targetFormat });
      const spawnHint = cmsExceedsSpawnThreshold({ importName });
      let spawnMeta = null;
      if (spawnHint.spawn) {
        spawnMeta = await maybeSpawnCmsHeavyJob(env, ctx, {
          userId: authUser.id,
          workspaceId,
          tenantId,
          masterRunId: `cms_cnv_${created.conversionId}`,
          taskDescription: `CMS conversion import ${importName} (${sourceFormat} → ${targetFormat})`,
          chunkCount: 1,
        });
      }
      if (env.MY_QUEUE) {
        ctx.waitUntil(env.MY_QUEUE.send({
          type: 'cms_liquid_import',
          conversion_id: created.conversionId,
          import_name: importName,
          tenant_id: tenantId,
          workspace_id: workspaceId,
        }).catch(() => {}));
      }
      return jsonResponse({ success: true, conversion_id: created.conversionId, job_id: created.jobId, status: 'pending', spawn: spawnMeta });
    } catch (e) { return jsonResponse({ error: e.message }, 500); }
  }
  return null;
}
