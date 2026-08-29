import assert from 'node:assert/strict';
import {
  blockToLegacyRow,
  createCmsBlock,
  getCmsBlock,
  listCmsBlocks,
  removeCmsBlock,
  reorderCmsBlocks,
  setCmsBlockVisibility,
  updateCmsBlock,
} from './index.js';

const scope = { authTenantId:'tenant-1', workspaceId:'ws-1', registryMode:false, allowedSlugs:new Set(['site-a']), sites:[] };
const pages = new Map([['p1',{id:'p1',project_id:'site-a',project_slug:'site-a',tenant_id:'tenant-1',workspace_id:'ws-1',slug:'home',route_path:'/',page_type:'home',status:'draft'}]]);
const pageStore = {
  async list(){return [...pages.values()]}, async getById(id){return pages.get(id)||null}, async routeExists(){return false},
  async insert(r){pages.set(r.id,{...r})}, async updateMetadata(id,r){pages.set(id,{...pages.get(id),...r})}, async archive(){}, async restore(){},
};
const sections = new Map([['s1',{id:'s1',page_id:'p1',section_type:'hero',section_name:'Hero',section_data:'{}',sort_order:10,is_visible:1}]]);
const sectionStore = {
  async listByPage(pid){return [...sections.values()].filter(s=>s.page_id===pid)}, async getById(id){return sections.get(id)||null},
  async insert(){}, async update(){}, async setVisibility(){}, async reorder(){}, async remove(){},
};
const blocks = new Map();
const blockStore = {
  async listBySection(sid){return [...blocks.values()].filter(b=>b.section_id===sid).sort((a,b)=>a.sort_order-b.sort_order)},
  async getById(id){return blocks.get(id)||null},
  async insert(b){blocks.set(b.id,{id:b.id,section_id:b.section_id,component_type:b.type,component_data:JSON.stringify(b.data||{}),sort_order:b.sort_order,is_visible:b.visible?1:0})},
  async update(id,p){const b={...blocks.get(id)};if('data'in p)b.component_data=JSON.stringify(p.data||{});if('type'in p)b.component_type=p.type;if('sort_order'in p)b.sort_order=p.sort_order;if('visible'in p)b.is_visible=p.visible?1:0;blocks.set(id,b)},
  async setVisibility(id,v){blocks.set(id,{...blocks.get(id),is_visible:v?1:0})},
  async reorder(id,n){blocks.set(id,{...blocks.get(id),sort_order:n})},
  async remove(id){blocks.delete(id)}, async removeBySection(sid){for(const [id,b] of blocks)if(b.section_id===sid)blocks.delete(id)},
};

const created = await createCmsBlock(scope,{id:'b1',section_id:'s1',component_type:'button',component_data:{label:'Go'},sort_order:20},pageStore,sectionStore,blockStore);
assert.equal(created.ok,true);
assert.equal(created.block.type,'button');
assert.deepEqual(created.block.data,{label:'Go'});
const legacy=blockToLegacyRow(created.block);
assert.equal(legacy.component_type,'button');
assert.deepEqual(legacy.component_data,{label:'Go'});

const updated=await updateCmsBlock(scope,'b1',{data:{label:'Updated'},component_type:'cta'},pageStore,sectionStore,blockStore);
assert.equal(updated.block.type,'cta');
assert.equal(updated.block.data.label,'Updated');
assert.equal((await setCmsBlockVisibility(scope,'b1',false,pageStore,sectionStore,blockStore)).block.visible,false);
assert.equal((await reorderCmsBlocks(scope,[{id:'b1',sort_order:2}],pageStore,sectionStore,blockStore)).updated,1);
assert.equal((await getCmsBlock(scope,'b1',pageStore,sectionStore,blockStore)).block.sort_order,2);
assert.equal((await listCmsBlocks(scope,'s1',pageStore,sectionStore,blockStore)).blocks.length,1);
assert.equal((await removeCmsBlock(scope,'b1',pageStore,sectionStore,blockStore)).removed,true);
assert.equal((await listCmsBlocks(scope,'s1',pageStore,sectionStore,blockStore)).blocks.length,0);
console.log('cms-blocks tests: OK');
