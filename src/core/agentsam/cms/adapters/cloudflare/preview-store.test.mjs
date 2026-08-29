import assert from 'node:assert/strict';
import { createCloudflareCmsPreviewStore } from './preview-store.js';

const calls=[];
const db={prepare(sql){const state={sql,binds:[]};calls.push(state);return{bind(...args){state.binds=args;return this},async first(){if(sql.includes('cms_page_drafts')) return {draft_data:'{"sections":{"s1":{"title":"D1"}}}'};return {id:'p1',route_path:'/',slug:'home',status:'published'}},async all(){if(sql.includes('cms_page_sections'))return{results:[{id:'s1',page_id:'p1'}]};if(sql.includes('cms_section_components'))return{results:[{id:'b1',section_id:'s1'}]};return{results:[{id:'p1',route_path:'/',status:'published'}]}}}}};
const kv={async get(key){assert.equal(key,'cms:draft:p1:u1');return '{"draft_data":{"sections":{"s1":{"title":"KV"}}}}';}};
const store=createCloudflareCmsPreviewStore({DB:db,SESSION_CACHE:kv});
assert.equal((await store.getPageById('p1')).id,'p1');
assert.equal((await store.findPageByRoute('/')).id,'p1');
assert.equal((await store.listSections('p1'))[0].id,'s1');
assert.equal((await store.listBlocks('s1'))[0].id,'b1');
assert.equal((await store.listBlocksForSections(['s1'])).s1[0].id,'b1');
assert.equal((await store.getDraft('p1','u1')).sections.s1.title,'KV');
assert.ok(calls.some(c=>c.sql.includes('cms_pages')));
console.log('cms-preview-store tests: OK');
