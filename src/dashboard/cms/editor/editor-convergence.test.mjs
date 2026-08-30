import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const canonical = read('packages/client-cms-editor/frontend/src/CmsEditor.tsx');
const model = read('packages/client-cms-editor/backend/src/model.ts');
const client = read('packages/client-cms-editor/backend/src/api/client.ts');
const bridge = read('packages/client-cms-editor/backend/src/preview/bridge.ts');
const legacyApi = read('app/pages/cms/studio/iamApi.ts');
const studioMain = read('app/studio-cms/main.tsx');

assert.match(legacyApi, /@inneranimalmedia\/client-cms-editor\/backend/);
assert.match(studioMain, /@inneranimalmedia\/client-cms-editor\/frontend/);
assert.match(studioMain, /mountClientCmsEditor/);
assert.doesNotMatch(studioMain, /src\/dashboard\/cms\/editor\/CmsEditor/);

assert.match(model, /components_by_section/);
assert.match(model, /mapCmsEditorBlock/);
assert.match(client, /\/api\/cms\/blocks/);
assert.match(canonical, /id: "blocks", label: "Blocks"/);
assert.match(canonical, /createCmsEditorBlock/);
assert.match(canonical, /saveCmsEditorBlock/);
assert.match(canonical, /BlockInspector/);
assert.match(bridge, /cms:section-click/);
assert.match(bridge, /block_id/);

for (const forbidden of [
  'Inner Animal Media',
  'Fuel & Free Time',
  'Companions of CPAS',
  'Sam Primeaux',
  'Avery Cole',
  '2 others editing',
  '3 media files uploaded',
  'Template applied',
  'Page order updated',
]) {
  assert.ok(!canonical.includes(forbidden), `canonical editor must not contain ${forbidden}`);
}

assert.match(canonical, /Media upload is not connected yet/);
assert.match(canonical, /Apply template/);
assert.match(canonical, /applyCmsEditorTemplate/);
assert.match(canonical, /Scheduling is not connected yet/);
assert.doesNotMatch(canonical, /Template application is not connected/);
console.log('cms-editor convergence tests: OK');
