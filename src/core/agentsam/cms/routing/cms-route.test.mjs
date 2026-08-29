import assert from 'node:assert/strict';
import {
  buildCmsHubPath,
  buildCmsPath,
  parseCmsRoute,
  isCmsEditorFullscreenRoute,
  isCmsStudioEditorRoute,
} from './cms-route.js';

const sp = (value = '') => new URLSearchParams(value);

assert.deepEqual(parseCmsRoute('/dashboard/cms', sp()), {
  view: 'sites', siteSlug: null, pageId: null, panel: 'pages', legacy: false, legacyTarget: null,
});
assert.equal(parseCmsRoute('/dashboard/cms', sp('site=site-a')).view, 'hub');
assert.equal(parseCmsRoute('/dashboard/cms/theme-editor', sp('site=site-a')).panel, 'theme-editor');
assert.equal(parseCmsRoute('/dashboard/cms/pages/page-1', sp('site=site-a')).pageId, 'page-1');
assert.equal(buildCmsHubPath('site-a'), '/dashboard/cms?site=site-a');
assert.equal(buildCmsPath({ panel: 'theme-editor', siteSlug: 'site-a' }), '/dashboard/cms/theme-editor?site=site-a');
assert.equal(
  buildCmsPath({ panel: 'pages', pageId: 'about', siteSlug: 'site-a' }, { basePath: '/cms' }),
  '/cms/pages/about?site=site-a',
);
assert.deepEqual(parseCmsRoute('/cms/pages/about', sp('site=site-a'), { basePath: '/cms' }), {
  view: 'pages', siteSlug: 'site-a', pageId: 'about', panel: 'pages', legacy: false, legacyTarget: null,
});
assert.equal(parseCmsRoute('/dashboard/cms/editor', sp('project=site-a&page=home')).legacyTarget, '/dashboard/cms/pages/home?site=site-a');
assert.equal(parseCmsRoute('/dashboard/cms/site-a/pages/about', sp()).legacyTarget, '/dashboard/cms/pages/about?site=site-a');
assert.equal(isCmsStudioEditorRoute('/dashboard/cms/theme-editor', sp()), true);
assert.equal(isCmsStudioEditorRoute('/dashboard/cms', sp()), false);
assert.equal(isCmsEditorFullscreenRoute('/dashboard/cms', sp('site=site-a')), true);

console.log('cms-route tests: OK');
