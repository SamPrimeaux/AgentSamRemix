import assert from 'node:assert/strict';
import { getCmsTemplate, listCmsTemplates, patchCmsTemplate, upsertCmsTemplate } from './index.js';
const rows=new Map();
const store={
  async list({category}){return [...rows.values()].filter((r)=>!category||r.category===category)},
  async getById(id){return rows.get(id)||null},
  async upsert(row){rows.set(row.id,{...row})},
  async patch(id,patch){rows.set(id,{...rows.get(id),...patch})},
};
const created=await upsertCmsTemplate(store,{id:'tpl1',template_name:'Hero',category:'Marketing',template_data:{title:'Hi'}});
assert.equal(created.ok,true);assert.equal(created.template.template_data,'{"title":"Hi"}');
assert.equal((await getCmsTemplate(store,'tpl1')).template.template_name,'Hero');
assert.equal((await listCmsTemplates(store,{category:'Marketing'})).total,1);
const patched=await patchCmsTemplate(store,'tpl1',{iam_tags:['hero','featured'],iam_label:'Primary'});
assert.equal(patched.ok,true);assert.equal(patched.template.iam_tags,'["hero","featured"]');
assert.equal((await patchCmsTemplate(store,'missing',{iam_label:'x'})).status,404);
console.log('cms-templates tests: OK');
