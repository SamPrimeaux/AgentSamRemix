import assert from 'node:assert/strict';
import { createCloudflareCmsLifecycleStore } from './lifecycle-store.js';
const objects=new Map([['published.html',{body:new TextEncoder().encode('old').buffer,etag:'etag1',contentType:'text/html'}]]);
const binding={
 async get(k){const x=objects.get(k);return x?{arrayBuffer:async()=>x.body,httpMetadata:{contentType:x.contentType}}:null},
 async head(k){const x=objects.get(k);return x?{etag:x.etag,size:x.body.byteLength}:null},
 async put(k,v,o){objects.set(k,{body:v instanceof ArrayBuffer?v:v.buffer||v,etag:'new',contentType:o?.httpMetadata?.contentType})},
};
const rows={rollbacks:new Map(),overrides:new Map()};
const db={prepare(sql){let binds=[];return{bind(...a){binds=a;return this},async run(){
 if(sql.includes('INSERT INTO cms_live_rollbacks')) rows.rollbacks.set(binds[0],{id:binds[0],page_id:binds[1],project_id:binds[2],slug:binds[3],previous_r2_key:binds[4],deployed_html_hash:binds[5],created_at:binds[6]});
 if(sql.includes("UPDATE cms_pages SET r2_key")) rows.page={r2_key:binds[0],status:'published'};
 return{}},async first(){
 if(sql.includes('cms_live_rollbacks')) return rows.rollbacks.get(binds[0])||null;
 return null},async all(){return{results:[...rows.rollbacks.values()]}}}}};
const env={DB:db,CMS_BUCKET:binding,SESSION_CACHE:{async get(){return null},async put(){},async delete(){}}};
const store=createCloudflareCmsLifecycleStore(env);
const rev=await store.createArtifactRevision({id:'r1',workspaceId:'ws',createdAt:100,page:{id:'p1',project_id:'site',slug:'home',r2_key:'published.html',r2_bucket:'cms'}});
assert.equal(rev.id,'r1'); assert.match(rev.previous_r2_key,/100-r1\.html$/); assert.equal(objects.has(rev.previous_r2_key),true);
const restored=await store.restoreArtifactRevision({page:{id:'p1',r2_bucket:'cms'},revisionId:'r1',publishedKey:'published2.html',now:101});
assert.equal(restored.ok,true); assert.equal(restored.r2_restored,true); assert.equal(objects.has('published2.html'),true);
console.log('cms-lifecycle-store tests: OK');

// Lifecycle page metadata writes remain adapter-owned.
const metadataCalls=[];
const db2={prepare(sql){let binds=[];return{bind(...a){binds=a;return this},async run(){metadataCalls.push({sql,binds});return{}},async first(){return sql.includes('cms_tenants')?{domain:'example.com'}:null},async all(){return{results:[]}}}}};
const store2=createCloudflareCmsLifecycleStore({DB:db2,SESSION_CACHE:{async get(){return null},async put(){},async delete(){}}});
const meta=await store2.ensurePagePublishMetadata('p2',{title:'Title',slug:'slug'},'site');
assert.equal(meta.seo_title,'Title');
assert.match(meta.meta_description,/Title/);
await store2.commitPublishedPage({pageId:'p2',userId:'u',now:10,r2Key:'published',byteLength:20});
await store2.commitContentDraftMetadata({pageId:'p2',userId:'u',now:11,title:'Draft',r2Key:'draft',byteLength:21,status:'draft'});
assert.equal(await store2.getTenantDomain('site'),'example.com');
assert.ok(metadataCalls.some((c)=>c.sql.includes("status='published'")));
assert.ok(metadataCalls.some((c)=>c.sql.includes('content_size_bytes')));
