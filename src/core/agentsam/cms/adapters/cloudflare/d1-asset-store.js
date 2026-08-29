function namesFromInfo(rows) {
  return new Set((rows || []).map((row) => String(row.name || '')).filter(Boolean));
}

import { CMS_DEFAULT_R2_BUCKET, cmsR2PublicObjectUrl } from './storage.js';

export function createD1CmsAssetStore(db) {
  if (!db?.prepare) throw new TypeError('D1 database binding required');
  let columnsPromise = null;
  const columns = async () => {
    if (!columnsPromise) {
      columnsPromise = db.prepare('PRAGMA table_info(cms_assets)').all()
        .then(({ results }) => namesFromInfo(results))
        .catch(() => new Set());
    }
    return columnsPromise;
  };

  async function selectList(prefix = '') {
    const cols = await columns();
    const names = [
      'id','tenant_id','workspace_id','project_slug','filename','original_filename','file_name','path','size','size_bytes',
      'mime_type','category','tags','r2_key','r2_bucket','public_url','cdn_url','thumbnail_url','metadata','metadata_json',
      'created_by','created_at','created_at_unix','updated_at','is_live','alt_text','usage_context','asset_key','label','title',
    ];
    return names.map((name) => cols.has(name) ? `${prefix}${name}` : `NULL AS ${name}`).join(', ');
  }

  function scopedWhere(cols, scope, binds) {
    const where = [];
    if (scope.tenantId && cols.has('tenant_id')) { where.push('tenant_id = ?'); binds.push(scope.tenantId); }
    if (scope.workspaceId && cols.has('workspace_id')) { where.push('workspace_id = ?'); binds.push(scope.workspaceId); }
    if (scope.projectSlug && cols.has('project_slug')) { where.push('project_slug = ?'); binds.push(scope.projectSlug); }
    return where;
  }

  return {
    async list(scope = {}, opts = {}) {
      const cols = await columns();
      const binds = [];
      const where = scopedWhere(cols, scope, binds);
      const order = cols.has('created_at') ? 'created_at' : cols.has('created_at_unix') ? 'created_at_unix' : 'id';
      const limit = Math.min(500, Math.max(1, Number(opts.limit || 100) || 100));
      const sql = `SELECT ${await selectList()} FROM cms_assets${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order} DESC LIMIT ${limit}`;
      const { results } = await db.prepare(sql).bind(...binds).all();
      return results || [];
    },

    async getById(id, scope = {}) {
      const cols = await columns();
      const binds = [id];
      const where = ['id = ?', ...scopedWhere(cols, scope, binds)];
      return db.prepare(`SELECT ${await selectList()} FROM cms_assets WHERE ${where.join(' AND ')} LIMIT 1`).bind(...binds).first().catch(() => null);
    },

    async insert(asset) {
      const cols = await columns();
      const values = {
        id: asset.id,
        tenant_id: asset.tenant_id,
        workspace_id: asset.workspace_id,
        project_slug: asset.project_slug,
        filename: asset.name,
        original_filename: asset.original_name || asset.name,
        file_name: asset.name,
        path: asset.path || asset.storage?.key || '',
        size: asset.size_bytes || 0,
        size_bytes: asset.size_bytes || 0,
        mime_type: asset.mime_type || 'application/octet-stream',
        category: asset.category || asset.kind || 'asset',
        tags: JSON.stringify(asset.tags || []),
        r2_key: asset.storage?.key || '',
        r2_bucket: asset.storage?.bucket || CMS_DEFAULT_R2_BUCKET,
        public_url: asset.urls?.public || cmsR2PublicObjectUrl(asset.storage?.bucket || CMS_DEFAULT_R2_BUCKET, asset.storage?.key) || '',
        thumbnail_url: asset.urls?.thumbnail,
        metadata: JSON.stringify({ ...(asset.metadata || {}), usage_context: asset.usage_context, asset_key: asset.asset_key, label: asset.label }),
        metadata_json: JSON.stringify({ ...(asset.metadata || {}), usage_context: asset.usage_context, asset_key: asset.asset_key, label: asset.label }),
        is_live: asset.is_live ? 1 : 0,
        alt_text: asset.alt_text,
        usage_context: asset.usage_context,
        asset_key: asset.asset_key,
        label: asset.label,
      };
      const keys = Object.keys(values).filter((key) => cols.has(key) && values[key] !== undefined);
      if (!keys.includes('id') || !keys.includes('r2_key')) throw new Error('cms_assets schema missing required id/r2_key');
      await db.prepare(`INSERT INTO cms_assets (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).bind(...keys.map((key) => values[key])).run();
    },

    async update(id, patch) {
      const cols = await columns();
      const direct = {
        alt_text: patch.alt_text,
        category: patch.category,
        usage_context: patch.usage_context,
        label: patch.label,
        asset_key: patch.asset_key,
        is_live: patch.is_live === undefined ? undefined : patch.is_live ? 1 : 0,
        public_url: patch.public_url,
        thumbnail_url: patch.thumbnail_url,
      };
      const metadataPatch = patch.metadata && typeof patch.metadata === 'object' ? { ...patch.metadata } : {};
      for (const [key, value] of Object.entries(direct)) {
        if (value !== undefined && !cols.has(key)) metadataPatch[key] = value;
      }

      const map = { ...direct };
      if (Object.keys(metadataPatch).length && (cols.has('metadata') || cols.has('metadata_json'))) {
        const metadataColumn = cols.has('metadata_json') ? 'metadata_json' : 'metadata';
        const current = await db.prepare(`SELECT ${metadataColumn} AS metadata_value FROM cms_assets WHERE id = ? LIMIT 1`).bind(id).first().catch(() => null);
        let base = {};
        try { base = current?.metadata_value ? JSON.parse(String(current.metadata_value)) : {}; } catch { base = {}; }
        const value = JSON.stringify({ ...base, ...metadataPatch });
        if (cols.has('metadata')) map.metadata = value;
        if (cols.has('metadata_json')) map.metadata_json = value;
      }
      const keys = Object.keys(map).filter((key) => cols.has(key) && map[key] !== undefined);
      if (!keys.length) return;
      const assignments = keys.map((key) => `${key} = ?`);
      const binds = keys.map((key) => map[key]);
      if (cols.has('updated_at')) assignments.push(`updated_at = datetime('now')`);
      await db.prepare(`UPDATE cms_assets SET ${assignments.join(', ')} WHERE id = ?`).bind(...binds, id).run();
    },

    async remove(id, scope = {}) {
      const cols = await columns();
      const binds = [id];
      const where = ['id = ?', ...scopedWhere(cols, scope, binds)];
      await db.prepare(`DELETE FROM cms_assets WHERE ${where.join(' AND ')}`).bind(...binds).run();
    },

    async listCollection(scope = {}, collectionId = null, opts = {}) {
      const cols = await columns();
      const binds = [];
      const where = scopedWhere(cols, scope, binds).map((item) => `a.${item}`);
      if (collectionId) { where.push('ca.collection_id = ?'); binds.push(collectionId); }
      const limit = Math.min(500, Math.max(1, Number(opts.limit || 100) || 100));
      const select = await selectList('a.');
      const sql = `SELECT ca.collection_id, ca.asset_id, ca.order_index, ca.added_at, ${select}
        FROM cms_collection_assets ca JOIN cms_assets a ON a.id = ca.asset_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY ca.order_index ASC, ca.added_at DESC LIMIT ${limit}`;
      const { results } = await db.prepare(sql).bind(...binds).all();
      return results || [];
    },
  };
}
