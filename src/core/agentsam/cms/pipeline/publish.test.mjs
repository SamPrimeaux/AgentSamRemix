import assert from 'node:assert/strict';
import { runCmsPublishPipeline } from './publish.js';
const order=[];
const steps={
  async ensureDraft(){order.push('ensure');return{ok:true}},
  async verify(){order.push('verify');return{passed:true}},
  async acquireLock(){order.push('lock');return{acquired:true}},
  async loadDraft(){order.push('load');return{data:{x:1}}},
  async snapshotCurrent(){order.push('snapshot');return{revision:{id:'r1'}}},
  async promoteStructuredDraft(){order.push('structured');return[{id:'o1'}]},
  async promoteArtifact(){order.push('artifact');return{r2_key:'pub'}},
  async commitPublished(){order.push('commit');return{status:'published'}},
  async invalidate(){order.push('invalidate')},
  async clearDraft(){order.push('clear')},
  async releaseLock(){order.push('release')},
};
const result=await runCmsPublishPipeline({},steps);
assert.equal(result.ok,true); assert.equal(result.revision.id,'r1');
assert.deepEqual(order,['ensure','verify','lock','load','snapshot','structured','artifact','commit','invalidate','clear','release']);
const blocked=await runCmsPublishPipeline({}, {...steps,async verify(){return{passed:false,error:'publish_gate_blocked'}}});
assert.equal(blocked.ok,false); assert.equal(blocked.error,'publish_gate_blocked');
let released=false;
await assert.rejects(()=>runCmsPublishPipeline({}, {...steps,async loadDraft(){throw new Error('boom')},async releaseLock(){released=true}}),/boom/);
assert.equal(released,true);
console.log('cms-publish-pipeline tests: OK');
