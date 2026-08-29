import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCmsHostContext } from './build-host-context.js';

const PLATFORM_SITE = {
  cms_hosting: 'platform',
  cms_shell: 'iam_unified',
  r2_bucket: 'inneranimalmedia',
  project_slug: 'inneranimalmedia',
};

test('buildCmsHostContext binds site config to pageCreateProvision', () => {
  const host = buildCmsHostContext({
    env: {},
    workspaceId: 'ws_test',
    siteConfig: PLATFORM_SITE,
  });

  const provision = host.pageCreateProvision({
    workspaceId: 'ws_test',
    projectSlug: 'inneranimalmedia',
    slug: 'about',
    status: 'draft',
  });

  assert.equal(provision.layout, 'platform_storefront');
  assert.equal(provision.publishedR2Key, 'pages/about/index.html');
});

test('buildCmsHostContext resolvePageArtifact uses workspace-scoped keys', () => {
  const host = buildCmsHostContext({
    env: {},
    workspaceId: 'ws_abc',
    siteConfig: { cms_hosting: 'client_worker', cms_shell: 'client_worker_legacy' },
  });

  const artifact = host.resolvePageArtifact({
    slug: 'home',
    project_slug: 'client-site',
    route_path: '/home',
    r2_bucket: 'iam-cms',
  });

  assert.equal(artifact.bucket, 'iam-cms');
  assert.ok(artifact.publishedKey.includes('ws_abc'));
  assert.ok(artifact.publishedKey.includes('home'));
});

test('buildCmsHostContext usesLegacyWholePageAssembler for pilot routes only', () => {
  const host = buildCmsHostContext({
    env: {},
    workspaceId: 'ws_test',
    siteConfig: PLATFORM_SITE,
  });

  assert.equal(host.usesLegacyWholePageAssembler({ route_path: '/agentsam' }), true);
  assert.equal(host.usesLegacyWholePageAssembler({ route_path: '/' }), false);
  assert.equal(host.usesLegacyWholePageAssembler({ route_path: '/about' }), false);
});

test('buildCmsHostContext syncDraftPageArtifact passes siteConfig through', async () => {
  const host = buildCmsHostContext({
    env: {},
    workspaceId: 'ws_test',
    siteConfig: PLATFORM_SITE,
  });

  const result = await host.syncDraftPageArtifact({
    workspaceId: 'ws_test',
    page: null,
    userId: 'au_test',
    draftData: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'page_required');
});
