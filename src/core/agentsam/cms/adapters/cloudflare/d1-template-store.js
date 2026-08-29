const SELECT_FIELDS = `id, template_name, template_type, category, preview_image_url,
  template_data, is_system, slug, r2_key, source_html_r2_key, source_liquid_file,
  iam_tags, iam_build, iam_project_slug, iam_category, iam_label, iam_status,
  iam_workspace_id, sort_order, usage_count, last_used_at, is_featured, featured_collection`;

export function createD1CmsTemplateStore(db) {
  if (!db?.prepare) throw new TypeError('D1 database binding required');
  return {
    async list({ category = null, limit = 5000 } = {}) {
      const safeLimit = Math.max(1, Math.min(5000, Number(limit) || 5000));
      if (category) {
        const { results = [] } = await db.prepare(`SELECT ${SELECT_FIELDS} FROM cms_component_templates WHERE category = ? ORDER BY sort_order ASC, category, template_name LIMIT ?`).bind(category, safeLimit).all();
        return results;
      }
      const { results = [] } = await db.prepare(`SELECT ${SELECT_FIELDS} FROM cms_component_templates ORDER BY sort_order ASC, category, template_name LIMIT ?`).bind(safeLimit).all();
      return results;
    },
    async getById(id) {
      return db.prepare(`SELECT ${SELECT_FIELDS} FROM cms_component_templates WHERE id = ? LIMIT 1`).bind(String(id)).first().catch(() => null);
    },
    async upsert(t) {
      await db.prepare(`INSERT INTO cms_component_templates
        (id, template_name, template_type, category, is_system, slug, r2_key, source_html_r2_key, template_data, preview_image_url, source_liquid_file)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET template_name=excluded.template_name, template_type=excluded.template_type,
          category=excluded.category, is_system=excluded.is_system, slug=excluded.slug, r2_key=excluded.r2_key,
          source_html_r2_key=excluded.source_html_r2_key, template_data=excluded.template_data,
          preview_image_url=excluded.preview_image_url, source_liquid_file=excluded.source_liquid_file, updated_at=datetime('now')`)
        .bind(t.id,t.template_name,t.template_type,t.category,t.is_system,t.slug,t.r2_key,t.source_html_r2_key,t.template_data,t.preview_image_url,t.source_liquid_file).run();
    },
    async patch(id, patch) {
      const allowed = ['iam_tags','iam_build','iam_category','iam_label'];
      const entries = Object.entries(patch || {}).filter(([key]) => allowed.includes(key));
      if (!entries.length) return;
      await db.prepare(`UPDATE cms_component_templates SET ${entries.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ?`).bind(...entries.map(([,value]) => value), String(id)).run();
    },
  };
}
