import assert from 'node:assert/strict';
import {
  canCmsLifecycleTransition,
  clearCmsDraft,
  cmsLifecyclePurgePolicy,
  normalizeCmsLifecycleState,
  normalizeCmsRevision,
  persistCmsDraft,
  promoteCmsDraftOverrides,
  stageCmsDraft,
} from './index.js';

assert.equal(normalizeCmsLifecycleState('PUBLISHED'),'published');
assert.equal(canCmsLifecycleTransition('archived','published'),false);
assert.equal(canCmsLifecycleTransition('archived','draft'),true);
assert.equal(cmsLifecyclePurgePolicy({status:'published'}).reason,'archive_required');
assert.equal(cmsLifecyclePurgePolicy({status:'archived',archived_at:100},{now:200,retentionSeconds:50}).allowed,true);

let hot=null,durable=null,cleared=false;
const draftStore={
  async putHotDraft(_p,_u,v){hot=v}, async getHotDraft(){return hot}, async deleteHotDraft(){hot=null;cleared=true},
  async putDurableDraft(_p,_u,v){durable=v}, async deleteDurableDraft(){durable=null},
};
await stageCmsDraft(draftStore,{pageId:'p',userId:'u',draftData:'hello'});
assert.deepEqual(hot,{content:'hello'});
assert.equal((await persistCmsDraft(draftStore,{pageId:'p',userId:'u'})).ok,true);
assert.deepEqual(durable,{content:'hello'});
await clearCmsDraft(draftStore,{pageId:'p',userId:'u'}); assert.equal(cleared,true);

assert.deepEqual(normalizeCmsRevision({id:'r1',page_id:'p',previous_r2_key:'x',created_at:1}),{
  id:'r1',source:'artifact',page_id:'p',override_id:null,version:null,artifact_key:'x',content_hash:null,status:'published',created_by:null,created_at:1,metadata:{}
});
let publishedArgs=null;
const overrideStore={
  async upsertOverrideDraft(){return {id:'ov1',isNew:true}},
  async publishOverrideRevision(id,actor){publishedArgs={id,actor};return {ok:true,version_id:'v1',version:1}},
};
const chain=await promoteCmsDraftOverrides(overrideStore,{page:{project_slug:'site',route_path:'/'},draftData:{sections:{hero:{title:'x'}}},userId:'u'});
assert.equal(chain[0].version_id,'v1');
assert.equal(publishedArgs.actor.useCurrentVersion,true);
console.log('cms-lifecycle tests: OK');
