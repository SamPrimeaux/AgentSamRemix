import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCmsEditorPagePreviewUrl,
  cmsEditorSectionEmbedKey,
} from '../../../../packages/client-cms-editor/backend/src/preview/urls.ts';

test('cmsEditorSectionEmbedKey matches assemble slugSeg', () => {
  assert.equal(cmsEditorSectionEmbedKey({ name: 'header-hero' }), 'header-hero');
  assert.equal(cmsEditorSectionEmbedKey({ name: 'Agent Sam Platform Services' }), 'agent-sam-platform-services');
});

test('buildCmsEditorPagePreviewUrl requires a domain and marks draft cms embed', () => {
  assert.equal(buildCmsEditorPagePreviewUrl({ domain: null, routePath: '/' }), null);
  const url = buildCmsEditorPagePreviewUrl({
    domain: 'inneranimalmedia.com',
    routePath: '/',
    pageId: 'page_home',
    mode: 'draft',
    revision: 3,
  });
  assert.ok(url);
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://inneranimalmedia.com');
  assert.equal(parsed.pathname, '/');
  assert.equal(parsed.searchParams.get('preview'), 'draft');
  assert.equal(parsed.searchParams.get('cms'), '1');
  assert.equal(parsed.searchParams.get('page_id'), 'page_home');
  assert.equal(parsed.searchParams.get('_r'), '3');
});
