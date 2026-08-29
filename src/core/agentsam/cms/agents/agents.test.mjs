import assert from 'node:assert/strict';
import {
  CMS_SPAWN_PAYLOAD_BYTES,
  CMS_SPAWN_SECTION_THRESHOLD,
  CMS_SPAWN_SESSION_TURN_THRESHOLD,
  buildCmsAgentProtocol,
  cmsDraftPayloadBytes,
  cmsDraftSectionCount,
  cmsExceedsSpawnThreshold,
  cmsShouldHandoffSession,
  createCmsAgentService,
  normalizeCmsAgentProposal,
  normalizeCmsAgentTask,
} from './index.js';

const protocol = buildCmsAgentProtocol();
assert.equal(protocol.model, 'Site → Page → Section → Block');
for (const key of ['page.read', 'section.update', 'block.update', 'asset.list', 'theme.update', 'preview.read', 'publish.page']) {
  assert.ok(protocol.capabilities.some((item) => item.key === key), `missing ${key}`);
}

const task = normalizeCmsAgentTask({ goal: 'Update hero copy', page_id: 'p1', capabilities: ['section.update'] });
assert.equal(task.scope.page_id, 'p1');
assert.deepEqual(task.capabilities, ['section.update']);
assert.throws(() => normalizeCmsAgentTask({ goal: 'x', capabilities: ['sql.raw'] }), /cms_agent_capability_invalid/);

const proposal = normalizeCmsAgentProposal({
  summary: 'Update and publish',
  operations: [
    { capability: 'section.update', target: { section_id: 's1' }, input: { data: { title: 'New' } } },
    { capability: 'publish.page', target: { page_id: 'p1' } },
  ],
});
assert.equal(proposal.operations[0].requires_approval, false);
assert.equal(proposal.operations[1].requires_approval, true);

const ai = {
  async propose() {
    return { operations: [{ capability: 'section.update', target: { section_id: 's1' }, input: { data: { title: 'New' } } }] };
  },
};
const executed = [];
const service = createCmsAgentService({ ai, capabilities: { async execute(op) { executed.push(op.capability); return { ok: true }; } } });
const allowedProposal = await service.propose({ goal: 'Update', capabilities: ['section.update'] });
assert.equal(allowedProposal.operations.length, 1);
await assert.rejects(
  createCmsAgentService({ ai: { async propose() { return { operations: [{ capability: 'theme.update' }] }; } } }).propose({ goal: 'Update', capabilities: ['section.update'] }),
  /cms_agent_capability_not_requested/,
);
const run = await service.execute({ operations: [{ capability: 'section.update' }, { capability: 'publish.page' }] });
assert.equal(run.results[0].status, 'completed');
assert.equal(run.results[1].status, 'approval_required');
assert.deepEqual(executed, ['section.update']);

const draft = { sections: Object.fromEntries(Array.from({ length: CMS_SPAWN_SECTION_THRESHOLD }, (_, i) => [`s${i}`, {}])) };
assert.equal(cmsDraftSectionCount(draft), CMS_SPAWN_SECTION_THRESHOLD);
assert.ok(cmsDraftPayloadBytes({ text: 'x'.repeat(CMS_SPAWN_PAYLOAD_BYTES) }) >= CMS_SPAWN_PAYLOAD_BYTES);
assert.equal(cmsExceedsSpawnThreshold({ sectionCount: CMS_SPAWN_SECTION_THRESHOLD }).spawn, true);
assert.equal(cmsExceedsSpawnThreshold({ payloadBytes: CMS_SPAWN_PAYLOAD_BYTES }).spawn, true);
assert.equal(cmsExceedsSpawnThreshold({ importName: 'theme' }).reason, 'template_import');
assert.equal(cmsShouldHandoffSession(CMS_SPAWN_SESSION_TURN_THRESHOLD - 1).spawn, false);
assert.equal(cmsShouldHandoffSession(CMS_SPAWN_SESSION_TURN_THRESHOLD).spawn, true);

console.log('cms-agents tests: OK');
