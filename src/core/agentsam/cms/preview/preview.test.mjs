import assert from 'node:assert/strict';
import {
  buildCmsPageUrls,
  cmsPreviewBridgeTarget,
  buildCmsPreviewModel,
  cmsPreviewCacheControl,
  cmsPreviewModelToLegacy,
  isPublicCmsPreviewRequest,
  loadCmsPreviewByPageId,
  loadCmsPreviewByRoute,
  normalizeCmsInspectorTarget,
  normalizeCmsPreviewBridgeMessage,
  normalizeCmsPreviewMode,
  parseCmsPreviewRequest,
  resolveEffectiveCmsPreviewMode,
  selectCmsPreviewPage,
} from './index.js';

assert.equal(normalizeCmsPreviewMode('1'), 'draft');
assert.equal(normalizeCmsPreviewMode('live'), 'published');
assert.equal(resolveEffectiveCmsPreviewMode({ previewMode:'draft', userId:null }), 'published');
assert.equal(resolveEffectiveCmsPreviewMode({ cmsEmbed:true, userId:'u1' }), 'draft');
assert.equal(cmsPreviewCacheControl('draft'), 'private, no-store, max-age=0');

const req = new URL('https://example.com/about?preview=draft&cms=1&page_id=p1');
assert.deepEqual(parseCmsPreviewRequest(req), { cmsEmbed:true, previewMode:'draft', pageId:'p1' });
assert.equal(isPublicCmsPreviewRequest(req, 'GET'), true);
assert.equal(isPublicCmsPreviewRequest(req, 'POST'), false);

const pages = [
  {id:'home',route_path:'/',slug:'home',status:'published',page_type:'home'},
  {id:'old-home',route_path:'/home',slug:'old-home',status:'published',page_type:'standard'},
  {id:'draft-about',route_path:'/about',slug:'about',status:'draft',page_type:'standard'},
];
assert.equal(selectCmsPreviewPage(pages, { routePath:'/home' }).id, 'old-home');
assert.equal(selectCmsPreviewPage(pages, { routePath:'/' }).id, 'home');
assert.equal(selectCmsPreviewPage(pages, { routePath:'/about', includeDraft:true }).id, 'draft-about');

const sections = [
  {id:'s2',page_id:'home',section_type:'copy',section_name:'Second',section_data:{title:'Base'},sort_order:20,is_visible:1},
  {id:'s1',page_id:'home',section_type:'hero',section_name:'Hero',section_data:{headline:'Hello'},sort_order:10,is_visible:1},
  {id:'hidden',page_id:'home',section_type:'copy',section_name:'Hidden',section_data:{title:'Nope'},sort_order:30,is_visible:0},
];
const blocks = {
  s1:[{id:'b2',section_id:'s1',component_type:'text',component_data:{label:'Two'},sort_order:20,is_visible:1},{id:'b1',section_id:'s1',component_type:'text',component_data:{label:'One'},sort_order:10,is_visible:0}],
};
const published = buildCmsPreviewModel({ page:pages[0], sections, blocksBySection:blocks, previewMode:'published' });
assert.deepEqual(published.sections.map(s=>s.id), ['s1','s2']);
assert.deepEqual(published.blocks_by_section.s1.map(b=>b.id), ['b2']);
const draft = buildCmsPreviewModel({ page:pages[0], sections, blocksBySection:blocks, draftData:{sections:{s1:{headline:'Draft hello'}}}, previewMode:'draft', userId:'u1' });
assert.equal(draft.sections.find(s=>s.id==='s1').data.headline, 'Draft hello');
assert.equal(draft.sections.some(s=>s.id==='hidden'), true);
assert.deepEqual(draft.blocks_by_section.s1.map(b=>b.id), ['b1','b2']);
const legacy = cmsPreviewModelToLegacy(draft);
assert.equal(legacy.sections[0].section_type, 'hero');
assert.equal(legacy.componentsBySection.s1[0].component_type, 'text');

const urls = buildCmsPageUrls({id:'p1',route_path:'/about',slug:'about'}, {domain:'HTTPS://Example.COM/path'});
assert.equal(urls.live_url, 'https://example.com/about');
assert.match(urls.preview_draft_url, /preview=draft/);
assert.match(urls.preview_draft_url, /page_id=p1/);
assert.deepEqual(normalizeCmsInspectorTarget({pageId:'p1',sectionId:'s1',component_id:'b1',fieldPath:'data.title'}), {kind:'block',page_id:'p1',section_id:'s1',block_id:'b1',field_path:'data.title'});
assert.deepEqual(normalizeCmsPreviewBridgeMessage({type:'cms:section-click',sectionId:'s1'}), {type:'cms:section-click',section_id:'s1'});
assert.deepEqual(cmsPreviewBridgeTarget({type:'cms:highlight',pageId:'p1',sectionId:'s1'}), {page_id:'p1',section_id:'s1',block_id:null});

const store = {
  async getPageById(id){ return pages.find(p=>p.id===id) || null; },
  async findPageByRoute(routePath,{explicitPageId=null,includeDraft=false}={}){ return selectCmsPreviewPage(pages,{routePath,explicitPageId,includeDraft}); },
  async listSections(id){ return id==='home' ? sections : []; },
  async listBlocks(id){ return blocks[id] || []; },
  async getDraft(){ return {sections:{s1:{headline:'Stored draft'}}}; },
};
const byId = await loadCmsPreviewByPageId('home',{previewMode:'draft',userId:'u1'},store);
assert.equal(byId.sections[0].data.headline,'Stored draft');
const byRoute = await loadCmsPreviewByRoute('/',{previewMode:'published'},store);
assert.equal(byRoute.page.id,'home');
console.log('cms-preview tests: OK');
