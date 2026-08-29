import { getCmsPage } from '../pages/index.js';
import { CmsSectionDataGuardError, assertSectionDataD1Writable } from './fields.js';
import { normalizeCmsSectionInput, normalizeCmsSectionRow } from './normalize.js';
function requireStore(store) { for (const m of ['listByPage','getById','insert','update','setVisibility','reorder','remove']) if (typeof store?.[m] !== 'function') throw new TypeError(`CMS section store missing ${m}()`); }
function sectionDataGuardFailure(err) {
  if (err instanceof CmsSectionDataGuardError) {
    return { ok: false, error: err.code, status: 422, ...err.details };
  }
  throw err;
}
export async function listCmsSections(scope, pageId, pageStore, sectionStore) {
  requireStore(sectionStore);
  const pageResult = await getCmsPage(scope, pageId, pageStore);
  if (!pageResult.ok) return pageResult;
  return { ok: true, page: pageResult.page, sections: (await sectionStore.listByPage(pageId)).map(normalizeCmsSectionRow).filter(Boolean) };
}
export async function getCmsSection(scope, sectionId, pageStore, sectionStore) {
  requireStore(sectionStore);
  const row = await sectionStore.getById(sectionId);
  if (!row) return { ok: false, error: 'Section not found', status: 404 };
  const pageResult = await getCmsPage(scope, row.page_id, pageStore);
  if (!pageResult.ok) return { ok: false, error: 'Section not found', status: 404 };
  return { ok: true, page: pageResult.page, section: normalizeCmsSectionRow(row), raw: row };
}
export async function createCmsSection(scope, input, pageStore, sectionStore) {
  const normalized = normalizeCmsSectionInput(input); if (!normalized.ok) return { ...normalized, status: 400 };
  const page = await getCmsPage(scope, normalized.section.page_id, pageStore); if (!page.ok) return page;
  try {
    normalized.section.data = assertSectionDataD1Writable(normalized.section.data);
  } catch (err) {
    return sectionDataGuardFailure(err);
  }
  await sectionStore.insert(normalized.section); return { ok: true, page: page.page, section: normalizeCmsSectionRow(await sectionStore.getById(normalized.section.id)) };
}
export async function updateCmsSection(scope, sectionId, input, pageStore, sectionStore) {
  const current = await getCmsSection(scope, sectionId, pageStore, sectionStore); if (!current.ok) return current;
  const patch = {};
  if ('section_data' in input || 'sectionData' in input || 'data' in input) patch.data = input.section_data ?? input.sectionData ?? input.data;
  if ('section_name' in input || 'name' in input) patch.name = String(input.section_name ?? input.name ?? '').trim();
  if ('section_type' in input || 'type' in input) patch.type = String(input.section_type ?? input.type ?? '').trim();
  if ('sort_order' in input) patch.sort_order = Number(input.sort_order);
  if ('is_visible' in input || 'visible' in input) patch.visible = input.is_visible === true || input.is_visible === 1 || input.visible === true;
  if ('css_classes' in input) patch.css_classes = String(input.css_classes || '');
  if ('custom_css' in input) patch.custom_css = String(input.custom_css || '');
  if (!Object.keys(patch).length) return { ok: false, error: 'no_valid_fields', status: 400 };
  if ('data' in patch) {
    try {
      patch.data = assertSectionDataD1Writable(patch.data);
    } catch (err) {
      return sectionDataGuardFailure(err);
    }
  }
  await sectionStore.update(sectionId, patch);
  return { ok: true, page: current.page, section: normalizeCmsSectionRow(await sectionStore.getById(sectionId)) };
}
export async function setCmsSectionVisibility(scope, sectionId, visible, pageStore, sectionStore) { const current = await getCmsSection(scope, sectionId, pageStore, sectionStore); if (!current.ok) return current; await sectionStore.setVisibility(sectionId, !!visible); return { ok: true, page: current.page, section: normalizeCmsSectionRow(await sectionStore.getById(sectionId)) }; }
export async function reorderCmsSections(scope, order, pageStore, sectionStore) { if (!Array.isArray(order)) return { ok:false,error:'order_array_required',status:400 }; let updated=0; for (const item of order) { if (!item?.id || !Number.isFinite(Number(item.sort_order))) continue; const current=await getCmsSection(scope,item.id,pageStore,sectionStore); if (!current.ok) continue; await sectionStore.reorder(item.id,Number(item.sort_order)); updated++; } return {ok:true,updated}; }
export async function removeCmsSection(scope, sectionId, pageStore, sectionStore, blockStore=null) { const current=await getCmsSection(scope,sectionId,pageStore,sectionStore); if(!current.ok)return current; if(blockStore?.removeBySection) await blockStore.removeBySection(sectionId); await sectionStore.remove(sectionId); return {ok:true,page:current.page,id:sectionId,removed:true}; }
