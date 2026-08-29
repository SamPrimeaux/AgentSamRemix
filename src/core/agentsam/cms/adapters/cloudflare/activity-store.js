export function createCloudflareCmsActivityStore(env) {
  const db = env?.DB;
  if (!db?.prepare) throw new TypeError('D1 database binding required');
  return {
    async list({ tenantId, projectSlug = '', pageId = '', limit = 50 }) {
      let q = `SELECT id, user_id, action, resource_type, resource_id, details, created_at
               FROM cms_activity_log WHERE tenant_id = ?`;
      const binds = [String(tenantId || '').trim()];
      const slug = String(projectSlug || '').trim();
      const pid = String(pageId || '').trim();
      if (slug) {
        q += ` AND (
          resource_id IN (SELECT id FROM cms_pages WHERE project_slug = ? OR project_id = ?)
          OR resource_id IN (
            SELECT s.id FROM cms_page_sections s
            INNER JOIN cms_pages p ON p.id = s.page_id
            WHERE p.project_slug = ? OR p.project_id = ?
          )
        )`;
        binds.push(slug, slug, slug, slug);
      }
      if (pid) {
        q += ` AND (resource_id = ? OR resource_id IN (SELECT id FROM cms_page_sections WHERE page_id = ?))`;
        binds.push(pid, pid);
      }
      q += ` ORDER BY created_at DESC LIMIT ?`;
      binds.push(Math.max(1, Math.min(200, Number(limit) || 50)));
      const { results = [] } = await db.prepare(q).bind(...binds).all();
      return results;
    },
  };
}
