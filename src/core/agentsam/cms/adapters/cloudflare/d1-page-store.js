function trim(v) { return v == null ? '' : String(v).trim(); }
function scopeSlugs(scope, projectSlug) {
  return projectSlug ? [trim(projectSlug)] : [...(scope?.allowedSlugs || [])].map(trim).filter(Boolean);
}

export function createD1CmsPageStore(db) {
  if (!db?.prepare) throw new TypeError('D1 database binding required');
  return {
    async list(scope, { projectSlug = null, includeArchived = false } = {}) {
      const slugs = scopeSlugs(scope, projectSlug);
      if (!slugs.length) return [];
      const ph = slugs.map(() => '?').join(',');
      const archived = includeArchived ? '' : ` AND status != 'archived'`;
      const ownership = scope.registryMode ? 'workspace_id = ?' : 'tenant_id = ?';
      const owner = scope.registryMode ? scope.workspaceId : scope.authTenantId;
      const { results } = await db.prepare(
        `SELECT * FROM cms_pages WHERE ${ownership} AND project_slug IN (${ph})${archived} ORDER BY created_at DESC`,
      ).bind(owner, ...slugs).all();
      return results || [];
    },
    async getById(id) {
      return db.prepare(`SELECT * FROM cms_pages WHERE id = ? LIMIT 1`).bind(String(id)).first().catch(() => null);
    },
    async routeExists(scope, projectSlug, routePath, excludeId = null) {
      const ownership = scope.registryMode ? 'workspace_id = ?' : 'tenant_id = ?';
      const owner = scope.registryMode ? scope.workspaceId : scope.authTenantId;
      const binds = [owner, projectSlug, routePath];
      let extra = '';
      if (excludeId) { extra = ' AND id != ?'; binds.push(excludeId); }
      const row = await db.prepare(
        `SELECT id FROM cms_pages WHERE ${ownership} AND project_slug = ? AND route_path = ? AND status != 'archived'${extra} LIMIT 1`,
      ).bind(...binds).first().catch(() => null);
      return Boolean(row?.id);
    },
    async insert(page) {
      await db.prepare(`INSERT INTO cms_pages (
        id, project_id, project_slug, slug, title, status, route_path, path, page_type,
        tenant_id, workspace_id, person_uuid, created_by, updated_by,
        r2_key, r2_bucket, content_type, content_size_bytes, metadata_json,
        seo_title, meta_description, robots, sort_order,
        created_at, updated_at, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(page.id,page.project_id,page.project_slug,page.slug,page.title,page.status,page.route_path,page.path,page.page_type,
          page.tenant_id,page.workspace_id,page.person_uuid,page.created_by,page.updated_by,page.r2_key,page.r2_bucket,page.content_type,
          page.content_size_bytes,page.metadata_json || '{}',page.seo_title,page.meta_description,page.robots,page.sort_order,page.created_at,page.updated_at,page.published_at)
        .run();
    },
    async updateMetadata(id, page, meta) {
      await db.prepare(`UPDATE cms_pages SET title=?, seo_title=?, meta_description=?, robots=?, page_type=?, sort_order=?, route_path=?, path=?, slug=?, updated_at=?, updated_by=? WHERE id=?`)
        .bind(page.title,page.seo_title,page.meta_description,page.robots,page.page_type,page.sort_order,page.route_path,page.route_path,page.slug,meta.now,meta.userId,id).run();
    },
    async archive(id, meta) {
      await db.prepare(`UPDATE cms_pages SET status='archived', archived_at=?, updated_at=?, updated_by=? WHERE id=?`).bind(meta.now,meta.now,meta.userId,id).run();
    },
    async restore(id, meta) {
      await db.prepare(`UPDATE cms_pages SET status='draft', archived_at=NULL, updated_at=?, updated_by=? WHERE id=?`).bind(meta.now,meta.userId,id).run();
    },
  };
}
