export function createCloudflareCmsConversionStore(env) {
  const db = env?.DB;
  if (!db?.prepare) throw new TypeError('D1 database binding required');
  return {
    async list(tenantId, limit = 30) {
      const safeLimit = Math.max(1, Math.min(100, Number(limit) || 30));
      const { results: conversions = [] } = await db.prepare(
        `SELECT id, asset_id, tenant_id, source_format, target_format, status,
                output_url, error_message, started_at, completed_at, created_at
         FROM cms_conversions WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?`,
      ).bind(tenantId, safeLimit).all();
      const jobsResult = await db.prepare(
        `SELECT id, asset_id, service, status, input_format, output_format, job_id, result_url, error, created_at
         FROM cms_conversion_jobs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?`,
      ).bind(tenantId, safeLimit).all().catch(() => ({ results: [] }));
      return { conversions, jobs: jobsResult.results || [] };
    },
    async create({ tenantId, assetId, sourceFormat, targetFormat, now = Math.floor(Date.now() / 1000) }) {
      const conversionId = `cnv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const jobId = `cjob_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const assetKey = assetId || conversionId;
      await db.prepare(
        `INSERT INTO cms_conversions
         (id, asset_id, tenant_id, source_format, target_format, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      ).bind(conversionId, assetKey, tenantId, sourceFormat, targetFormat, now).run();
      await db.prepare(
        `INSERT INTO cms_conversion_jobs
         (id, tenant_id, asset_id, service, status, input_format, output_format, created_at)
         VALUES (?, ?, ?, 'cms_import_wizard', 'pending', ?, ?, datetime('now'))`,
      ).bind(jobId, tenantId, assetKey, sourceFormat, targetFormat).run();
      return { conversionId, jobId, assetId: assetKey };
    },
  };
}
