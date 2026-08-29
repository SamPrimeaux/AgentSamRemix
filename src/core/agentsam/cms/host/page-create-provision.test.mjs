import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveCmsPageCreateProvision,
  usesPlatformStorefrontPageLayout,
} from '../host/page-create-provision.js';

test('usesPlatformStorefrontPageLayout from site config not project slug', () => {
  assert.equal(
    usesPlatformStorefrontPageLayout({ cms_hosting: 'platform', cms_shell: 'iam_unified' }),
    true,
  );
  assert.equal(
    usesPlatformStorefrontPageLayout({ cms_hosting: 'client_worker', cms_shell: 'client_worker_legacy' }),
    false,
  );
});

test('resolveCmsPageCreateProvision platform layout uses marketing R2 keys', () => {
  const provision = resolveCmsPageCreateProvision(
    { cms_hosting: 'platform', cms_shell: 'iam_unified', r2_bucket: 'inneranimalmedia' },
    { workspaceId: 'ws_test', projectSlug: 'any-site-slug', slug: 'about', status: 'draft' },
  );
  assert.equal(provision.layout, 'platform_storefront');
  assert.equal(provision.r2Bucket, 'inneranimalmedia');
  assert.equal(provision.publishedR2Key, 'pages/about/index.html');
  assert.equal(provision.draftR2Key, 'pages/.draft/about/index.html');
  assert.equal(provision.scaffoldHtmlFromSections, true);
  assert.ok(provision.defaultSections.length > 0);
});

test('resolveCmsPageCreateProvision workspace layout uses cms workspace keys', () => {
  const provision = resolveCmsPageCreateProvision(
    { cms_hosting: 'client_worker', cms_shell: 'client_worker_legacy' },
    { workspaceId: 'ws_abc', projectSlug: 'client-site', slug: 'home', status: 'published' },
  );
  assert.equal(provision.layout, 'workspace_cms');
  assert.equal(provision.r2Key, 'cms/ws_abc/client-site/home/published.html');
  assert.equal(provision.defaultSections.length, 0);
  assert.equal(provision.scaffoldHtmlFromSections, false);
});
