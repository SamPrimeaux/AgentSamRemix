import assert from 'node:assert/strict';
import { CMS_CAPABILITY_KEYS, cmsCapabilityRequiresApproval, getCmsCapability } from './index.js';

assert.ok(CMS_CAPABILITY_KEYS.length >= 20);
assert.equal(getCmsCapability('block.update').resource, 'block');
assert.equal(getCmsCapability('section.update').risk, 'write');
assert.equal(cmsCapabilityRequiresApproval('publish.page'), true);
assert.equal(cmsCapabilityRequiresApproval('page.archive'), true);
assert.equal(cmsCapabilityRequiresApproval('page.read'), false);
assert.equal(getCmsCapability('sql.raw'), null);
console.log('cms-contracts tests: OK');
