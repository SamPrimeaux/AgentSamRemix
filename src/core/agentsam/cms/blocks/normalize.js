function parseJson(v){ if(v==null)return {}; if(typeof v==='object')return v; try{return JSON.parse(String(v));}catch{return {raw:String(v)}} }
export function normalizeCmsBlockRow(row){ if(!row||typeof row!=='object')return null; return { id:String(row.id||''), section_id:String(row.section_id||''), type:String(row.component_type||row.type||'custom'), data:parseJson(row.component_data??row.data), sort_order:Number(row.sort_order||0), visible:row.is_visible===true||row.is_visible===1, updated_at:row.updated_at??null }; }
export function blockToLegacyRow(block){ return block?{id:block.id,section_id:block.section_id,component_type:block.type,component_data:block.data,sort_order:block.sort_order,is_visible:block.visible?1:0,updated_at:block.updated_at??null}:null; }

export function normalizeCmsBlockInput(input = {}) {
  const sectionId = String(input.section_id || '').trim();
  const type = String(input.type || input.block_type || input.component_type || '').trim();
  if (!sectionId) return { ok: false, error: 'section_id_required' };
  if (!type) return { ok: false, error: 'block_type_required' };
  return { ok: true, block: {
    id: String(input.id || '').trim() || `blk_${crypto.randomUUID()}`,
    section_id: sectionId,
    type,
    data: (() => {
      const value = input.data ?? input.block_data ?? input.component_data ?? {};
      if (typeof value === 'object' && value != null) return value;
      try { return JSON.parse(String(value)); } catch { return { raw: String(value) }; }
    })(),
    sort_order: Number.isFinite(Number(input.sort_order)) ? Number(input.sort_order) : 50,
    visible: input.visible === false || input.is_visible === false || input.is_visible === 0 ? false : true,
  }};
}
