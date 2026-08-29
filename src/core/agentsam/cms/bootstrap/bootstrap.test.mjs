import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCmsBootstrapAdapters, normalizeJsonObject } from './bootstrap-contract.js';
import { CMS_BOOTSTRAP_TTL_SEC, cmsBootstrapKey } from './cache-key.js';
import { buildCmsSiteManifest } from './site-manifest.js';
import { resolveBootstrapProjectContextLanes } from './build-bootstrap.js';

assert.equal(CMS_BOOTSTRAP_TTL_SEC, 300);
assert.equal(cmsBootstrapKey(' ws-a ', ' site-a '), 'cms:bootstrap:v2:ws-a:site-a');
assert.deepEqual(normalizeJsonObject('{"accent":"blue"}'), { accent: 'blue' });
assert.deepEqual(normalizeJsonObject('broken'), {});

assert.throws(
  () => assertCmsBootstrapAdapters({}),
  /CMS_BOOTSTRAP_ADAPTERS_MISSING/,
);

const manifest = buildCmsSiteManifest({
  projectSlug: 'site-a',
  siteConfig: {
    cms_hosting: 'platform',
    worker_name: 'worker-a',
    worker_base_url: 'https://worker.example',
    studio_url: 'https://studio.example',
  },
  tenant: { slug: 'site-a', name: 'Site A', domain: 'tenant.example' },
  domainResolved: { domain: 'public.example', source: 'registry' },
  pages: [{ id: 'page-home', route_path: '/', page_type: 'home' }],
  homePage: {
    id: 'page-home',
    slug: 'home',
    title: 'Home',
    route_path: '/',
    status: 'published',
    r2_key: 'pages/home/index.html',
  },
  cacheKey: 'cms:bootstrap:v2:ws-a:site-a',
  defaultR2Bucket: 'site-assets',
  storageBindings: { kv: 'CACHE_BINDING', collaboration: 'COLLAB_BINDING' },
});

assert.equal(manifest.public_domain, 'public.example');
assert.equal(manifest.domain_source, 'registry');
assert.equal(manifest.home_page.id, 'page-home');
assert.equal(manifest.storage.r2_bucket, 'site-assets');
assert.equal(manifest.storage.kv_binding, 'CACHE_BINDING');
assert.equal(manifest.storage.do_binding, 'COLLAB_BINDING');

assert.deepEqual(
  resolveBootstrapProjectContextLanes(
    { cms_hosting: 'client_worker', worker_name: 'legendary-os', r2_bucket: 'legendary-os' },
    'cms',
  ),
  { workerName: 'legendary-os', r2Bucket: 'legendary-os' },
);
assert.deepEqual(
  resolveBootstrapProjectContextLanes(
    { cms_hosting: 'platform', worker_name: 'legendary-os', r2_bucket: 'legendary-os' },
    'cms',
  ),
  { workerName: 'legendary-os', r2Bucket: 'legendary-os' },
);
assert.deepEqual(
  resolveBootstrapProjectContextLanes({ cms_hosting: 'platform' }, 'cms'),
  { workerName: 'inneranimalmedia', r2Bucket: 'cms' },
);

const bootstrapDir = path.dirname(fileURLToPath(import.meta.url));
for (const file of fs.readdirSync(bootstrapDir).filter((name) => name.endsWith('.js'))) {
  const source = fs.readFileSync(path.join(bootstrapDir, file), 'utf8');
  const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
  for (const specifier of imports) {
    assert.doesNotMatch(specifier, /(?:^|\/)cms-[^/]+\.js$/, `${file} imports legacy CMS helper ${specifier}`);
    assert.doesNotMatch(specifier, /src\/api\/cms|dashboard|studio-cms-editor/, `${file} imports forbidden CMS implementation ${specifier}`);
  }
}

console.log('cms-bootstrap tests: OK');
