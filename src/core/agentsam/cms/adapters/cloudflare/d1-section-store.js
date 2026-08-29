import { assertSectionDataD1Writable } from '../../sections/fields.js';
import { hydrateCmsSectionRow, hydrateCmsSectionRows, writeCmsSectionDraftArtifact } from './section-artifacts.js';

const SELECT = `id,page_id,section_type,section_name,section_data,sort_order,is_visible,css_classes,custom_css,updated_at,draft_r2_key,published_r2_key,r2_bucket,content_hash,published_hash,schema_version`;

export function createD1CmsSectionStore(envOrDb) {
  const env = envOrDb?.DB ? envOrDb : { DB: envOrDb };
  const db = env.DB;
  if (!db?.prepare) throw new TypeError('D1 database binding required');
  return {
    async listByPage(pageId) {
      const { results = [] } = await db.prepare(`SELECT ${SELECT} FROM cms_page_sections WHERE page_id=? ORDER BY sort_order ASC,section_name ASC`).bind(pageId).all();
      return hydrateCmsSectionRows(env, results);
    },
    async getById(id) {
      const row = await db.prepare(`SELECT ${SELECT} FROM cms_page_sections WHERE id=? LIMIT 1`).bind(id).first().catch(() => null);
      return hydrateCmsSectionRow(env, row);
    },
    async insert(s) {
      const data = assertSectionDataD1Writable(s.data || {});
      const artifact = await writeCmsSectionDraftArtifact(env, { pageId: s.page_id, sectionId: s.id, data });
      await db.prepare(`INSERT INTO cms_page_sections (id,page_id,section_type,section_name,section_data,sort_order,is_visible,css_classes,custom_css,created_at_unix,draft_r2_key,r2_bucket,content_hash,schema_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1)`)
        .bind(s.id,s.page_id,s.type,s.name,'{}',s.sort_order,s.visible?1:0,s.css_classes||'',s.custom_css||'',Math.floor(Date.now()/1000),artifact.r2_key,artifact.r2_bucket,artifact.content_hash).run();
    },
    async update(id,p) {
      const sets=[], bind=[];
      if ('data' in p) {
        const current = await db.prepare(`SELECT page_id,draft_r2_key FROM cms_page_sections WHERE id=? LIMIT 1`).bind(id).first();
        if (!current?.page_id) throw new Error('Section not found');
        const data = assertSectionDataD1Writable(p.data || {});
        const artifact = await writeCmsSectionDraftArtifact(env, { pageId: current.page_id, sectionId: id, data, key: current.draft_r2_key || null });
        sets.push('section_data=?','draft_r2_key=?','r2_bucket=?','content_hash=?');
        bind.push('{}',artifact.r2_key,artifact.r2_bucket,artifact.content_hash);
      }
      if('name'in p){sets.push('section_name=?');bind.push(p.name)}
      if('type'in p){sets.push('section_type=?');bind.push(p.type)}
      if('sort_order'in p){sets.push('sort_order=?');bind.push(p.sort_order)}
      if('visible'in p){sets.push('is_visible=?');bind.push(p.visible?1:0)}
      if('css_classes'in p){sets.push('css_classes=?');bind.push(p.css_classes)}
      if('custom_css'in p){sets.push('custom_css=?');bind.push(p.custom_css)}
      if(!sets.length)return;
      sets.push(`updated_at=datetime('now')`);
      await db.prepare(`UPDATE cms_page_sections SET ${sets.join(',')} WHERE id=?`).bind(...bind,id).run();
    },
    async setVisibility(id,v){await db.prepare(`UPDATE cms_page_sections SET is_visible=?,updated_at=datetime('now') WHERE id=?`).bind(v?1:0,id).run()},
    async reorder(id,n){await db.prepare(`UPDATE cms_page_sections SET sort_order=?,updated_at=datetime('now') WHERE id=?`).bind(n,id).run()},
    async remove(id){await db.prepare(`DELETE FROM cms_page_sections WHERE id=?`).bind(id).run()}
  };
}
