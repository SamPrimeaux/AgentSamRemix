export function createD1CmsBlockStore(db){if(!db?.prepare)throw new TypeError('D1 database binding required');return{
 async listBySection(sectionId){const {results}=await db.prepare(`SELECT id,section_id,component_type,component_data,sort_order,is_visible,updated_at FROM cms_section_components WHERE section_id=? ORDER BY sort_order`).bind(sectionId).all().catch(()=>({results:[]}));return results||[]},
 async getById(id){return db.prepare(`SELECT id,section_id,component_type,component_data,sort_order,is_visible,updated_at FROM cms_section_components WHERE id=? LIMIT 1`).bind(id).first().catch(()=>null)},
 async insert(b){await db.prepare(`INSERT INTO cms_section_components (id,section_id,component_type,component_data,sort_order,is_visible) VALUES(?,?,?,?,?,?)`).bind(b.id,b.section_id,b.type,JSON.stringify(b.data||{}),b.sort_order,b.visible?1:0).run()},
 async update(id,p){const sets=[],bind=[];if('data'in p){sets.push('component_data=?');bind.push(typeof p.data==='string'?p.data:JSON.stringify(p.data||{}))}if('type'in p){sets.push('component_type=?');bind.push(p.type)}if('sort_order'in p){sets.push('sort_order=?');bind.push(p.sort_order)}if('visible'in p){sets.push('is_visible=?');bind.push(p.visible?1:0)}if(!sets.length)return;sets.push(`updated_at=datetime('now')`);await db.prepare(`UPDATE cms_section_components SET ${sets.join(',')} WHERE id=?`).bind(...bind,id).run()},
 async setVisibility(id,v){await db.prepare(`UPDATE cms_section_components SET is_visible=?,updated_at=datetime('now') WHERE id=?`).bind(v?1:0,id).run()},
 async reorder(id,n){await db.prepare(`UPDATE cms_section_components SET sort_order=?,updated_at=datetime('now') WHERE id=?`).bind(n,id).run()},
 async remove(id){await db.prepare(`DELETE FROM cms_section_components WHERE id=?`).bind(id).run()},
 async removeBySection(sectionId){await db.prepare(`DELETE FROM cms_section_components WHERE section_id=?`).bind(sectionId).run().catch(()=>{})}
}}
