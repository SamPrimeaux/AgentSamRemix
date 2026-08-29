import assert from 'node:assert/strict';
import { buildCmsRuntimeDescriptor, formatCmsRuntimeDescriptorForPrompt } from './index.js';
import * as legacySpine from '../../../cms-site-spine.js';
import * as legacyClientApp from '../../../cms-client-app-resolve.js';
import * as clientApp from './client-app.js';

const descriptor = buildCmsRuntimeDescriptor({
  app_key: 'example-site',
  project_slug: 'example-site',
  cms_hosting: 'client_worker',
  api_profile: 'fragment',
  worker_name: 'site-worker',
  public_domain: 'example.com',
  r2_bucket: 'site-assets',
  d1_database_id: 'db-example',
  inventory_source: 'client_apps',
}, { page_id: 'page-1', route_path: '/about' });

assert.equal(descriptor.app_key, 'example-site');
assert.equal(descriptor.r2_bucket, 'site-assets');
assert.equal(descriptor.page_id, 'page-1');
assert.equal(descriptor.cms_mode, 'client_worker');
assert.match(formatCmsRuntimeDescriptorForPrompt(descriptor), /example-site/);
assert.equal(legacySpine.getCmsCodeSpine('anything'), null);
assert.deepEqual(legacySpine.buildAgentSiteContext('example-site', descriptor), buildCmsRuntimeDescriptor(descriptor));
assert.equal(legacyClientApp.resolveClientAppByProjectSlug, clientApp.resolveClientAppByProjectSlug);
assert.equal(legacyClientApp.normalizeR2Buckets, clientApp.normalizeR2Buckets);
console.log('cms-runtime tests: OK');
