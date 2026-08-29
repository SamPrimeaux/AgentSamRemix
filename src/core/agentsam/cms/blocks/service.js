import { getCmsSection } from '../sections/index.js';
import { normalizeCmsBlockInput, normalizeCmsBlockRow } from './normalize.js';
function requireStore(s){for(const m of ['listBySection','getById','insert','update','setVisibility','reorder','remove'])if(typeof s?.[m]!=='function')throw new TypeError(`CMS block store missing ${m}()`)}
export async function listCmsBlocks(scope, sectionId, pageStore, sectionStore, blockStore){requireStore(blockStore);const sec=await getCmsSection(scope,sectionId,pageStore,sectionStore);if(!sec.ok)return sec;return{ok:true,page:sec.page,section:sec.section,blocks:(await blockStore.listBySection(sectionId)).map(normalizeCmsBlockRow).filter(Boolean)}}
export async function getCmsBlock(scope, blockId, pageStore, sectionStore, blockStore){requireStore(blockStore);const row=await blockStore.getById(blockId);if(!row)return{ok:false,error:'Block not found',status:404};const sec=await getCmsSection(scope,row.section_id,pageStore,sectionStore);if(!sec.ok)return{ok:false,error:'Block not found',status:404};return{ok:true,page:sec.page,section:sec.section,block:normalizeCmsBlockRow(row)}}

export async function createCmsBlock(scope, input, pageStore, sectionStore, blockStore){
  requireStore(blockStore);
  const normalized=normalizeCmsBlockInput(input);
  if(!normalized.ok)return{...normalized,status:400};
  const sec=await getCmsSection(scope,normalized.block.section_id,pageStore,sectionStore);
  if(!sec.ok)return sec;
  await blockStore.insert(normalized.block);
  return{ok:true,page:sec.page,section:sec.section,block:normalizeCmsBlockRow(await blockStore.getById(normalized.block.id))};
}
export async function updateCmsBlock(scope, blockId, input, pageStore, sectionStore, blockStore){const cur=await getCmsBlock(scope,blockId,pageStore,sectionStore,blockStore);if(!cur.ok)return cur;const patch={};if('block_data'in input||'component_data'in input||'componentData'in input||'data'in input)patch.data=input.block_data??input.component_data??input.componentData??input.data;if('type'in input||'component_type'in input)patch.type=String(input.type??input.component_type??'').trim();if('sort_order'in input)patch.sort_order=Number(input.sort_order);if('visible'in input||'is_visible'in input)patch.visible=input.visible===true||input.is_visible===true||input.is_visible===1;if(!Object.keys(patch).length)return{ok:false,error:'no_valid_fields',status:400};await blockStore.update(blockId,patch);return{...cur,block:normalizeCmsBlockRow(await blockStore.getById(blockId))}}
export async function setCmsBlockVisibility(scope,id,v,pageStore,sectionStore,blockStore){const cur=await getCmsBlock(scope,id,pageStore,sectionStore,blockStore);if(!cur.ok)return cur;await blockStore.setVisibility(id,!!v);return{...cur,block:normalizeCmsBlockRow(await blockStore.getById(id))}}
export async function reorderCmsBlocks(scope,order,pageStore,sectionStore,blockStore){if(!Array.isArray(order))return{ok:false,error:'order_array_required',status:400};let updated=0;for(const item of order){if(!item?.id||!Number.isFinite(Number(item.sort_order)))continue;const cur=await getCmsBlock(scope,item.id,pageStore,sectionStore,blockStore);if(!cur.ok)continue;await blockStore.reorder(item.id,Number(item.sort_order));updated++;}return{ok:true,updated}}
export async function removeCmsBlock(scope,id,pageStore,sectionStore,blockStore){const cur=await getCmsBlock(scope,id,pageStore,sectionStore,blockStore);if(!cur.ok)return cur;await blockStore.remove(id);return{ok:true,...cur,removed:true}}
