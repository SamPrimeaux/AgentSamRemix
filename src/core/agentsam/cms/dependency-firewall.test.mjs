import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyDependency,
  extractImportSpecifiers,
  runCmsDependencyFirewall,
} from '../../../../scripts/guard-cms-dependency-firewall.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const policy = (await import('./dependency-policy.json', { with: { type: 'json' } })).default;
const cmsRoot = path.resolve(repoRoot, policy.cms_root);

assert.deepEqual(
  extractImportSpecifiers(`
    // import x from 'ignored-comment';
    import { a } from './a.js';
    export * from './b.js';
    const c = await import('./c.js');
    /** @type {import('@anthropic-ai/sdk')} */
  `).sort(),
  ['./a.js', './b.js', './c.js'],
);

const classify = (importerPath, specifier) =>
  classifyDependency({ importerPath, specifier, repoRoot, cmsRoot, policy });

assert.equal(classify('src/core/agentsam/cms/theme/active.js', './agent-home.js').classification, 'canonical-cms');
assert.equal(classify('src/core/agentsam/cms/theme/resolve.js', '../../../auth.js').classification, 'generic-platform');
assert.equal(classify('src/core/agentsam/cms/theme/resolve.js', '../../../cms-theme-active.js').classification, 'forbidden-legacy-cms');
assert.equal(classify('src/core/agentsam/cms/theme/resolve.js', '../../../../api/cms.js').classification, 'forbidden-host-ui');
assert.equal(classify('src/core/agentsam/cms/theme/resolve.js', '@anthropic-ai/sdk').classification, 'forbidden-package');

const result = runCmsDependencyFirewall({ repoRoot });
assert.ok(result.policy.temporary_legacy_dependencies.length >= 1);
assert.deepEqual(result.violations, []);

const outwardPlatform = result.rows.filter((row) => row.classification === 'generic-platform');
assert.deepEqual(
  [...new Set(outwardPlatform.map((row) => row.target))].sort(),
  [
    'src/core/bootstrap-scoped-context.js',
    'backend/identity/bootstrap.js',
    'src/core/workspace-access.js',
  ],
);

const facadePath = path.join(cmsRoot, 'index.js');
const facadeSource = fs.readFileSync(facadePath, 'utf8');
const facadeSpecifiers = extractImportSpecifiers(facadeSource);
const forbiddenFacadeSpecifiers = facadeSpecifiers.filter((specifier) =>
  /(?:^|\/)(?:adapters|normalize\.js|cache-key\.js|bootstrap-contract\.js|archive\.js|hashing\.js|payload\.js)$/.test(
    specifier,
  ) || specifier.includes('/adapters/') || specifier.endsWith('/normalize.js') || specifier.endsWith('/cache.js'),
);
assert.deepEqual(forbiddenFacadeSpecifiers, []);

const facade = await import('./index.js');
const expectedNamespaces = [
  'pages', 'sections', 'blocks', 'assets', 'routing', 'context', 'bootstrap',
  'runtime', 'preview', 'lifecycle', 'pipeline', 'templates',
  'packages', 'contracts', 'agents', 'ai', 'tools',
];
assert.deepEqual(Object.keys(facade).sort(), [...expectedNamespaces].sort());

function flattenExportNames(mod, prefix = '') {
  const names = [];
  for (const [key, value] of Object.entries(mod)) {
    if (key === 'default' || key === 'module.exports') continue;
    const pathName = prefix ? `${prefix}.${key}` : key;
    names.push(pathName);
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Set) && !(value instanceof Map)) {
      names.push(...flattenExportNames(value, pathName));
    }
  }
  return names;
}

const facadeNames = flattenExportNames(facade);
const forbiddenNamePattern = /(?:ToLegacy|createD1|createR2|internalPublish|gunzipArrayBuffer|extractTarEntries|extractZipEntries|cmsThemeActiveKey|assertCms\w+Store|assertCmsBootstrapAdapters|assertCmsRuntimeAdapter|buildCmsPagesListQuery|cmsOverrideProjectId|normalizeCms(?:Page|Section|Block|Asset|Draft|Revision|Lifecycle)|cmsAssetToLegacyRow)/;
const leaked = facadeNames.filter((name) => forbiddenNamePattern.test(name));
assert.deepEqual(leaked, []);

assert.equal(typeof facade.tools.handlers, 'object');
assert.equal(typeof facade.tools.handlers.agentsam_cms_read, 'function');
assert.equal(typeof facade.pages.getCmsPage, 'function');
assert.equal(typeof facade.sections.createCmsSection, 'function');
assert.equal(typeof facade.blocks.updateCmsBlock, 'function');
assert.equal(typeof facade.preview.loadCmsPreviewByPageId, 'function');
assert.equal(typeof facade.lifecycle.stageCmsDraft, 'function');
assert.equal(typeof facade.pipeline.runCmsPublishPipeline, 'function');
assert.equal('createD1CmsPageStore' in facade, false);
assert.equal('normalizeCmsPageRow' in facade.pages, false);

console.log('cms-dependency-firewall tests: OK');
