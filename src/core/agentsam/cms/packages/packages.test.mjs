import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildThemePackageManifest,
  categorizeThemePaths,
  parseShopifyTemplateJson,
} from './index.js';
import { buildFullThemePackage } from '../../../../../backend/services/cms/packages/theme-package.js';
import { computeCmsThemePackageHash, sha256Hex } from '../../../../../backend/services/cms/packages/hashing.js';
import * as legacyArchive from '../../../cms-theme-archive.js';
import * as legacyInventory from '../../../cms-theme-inventory.js';

assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
assert.equal(
  await computeCmsThemePackageHash({ slug: 'x', source_hash: 'abc', package_version: 1, file_hashes: { b: '2', a: '1' } }),
  await computeCmsThemePackageHash({ slug: 'x', source_hash: 'abc', package_version: 1, file_hashes: { a: '1', b: '2' } }),
);
const template = parseShopifyTemplateJson(JSON.stringify({ sections: { hero: { type: 'hero', settings: { x: 1 } } }, order: ['hero'] }));
assert.equal(template.order[0].section_type, 'hero');
assert.equal(categorizeThemePaths([{ path: 'sections/hero.liquid' }, { path: 'assets/app.css' }]).counts.sections, 1);
const manifest = buildThemePackageManifest({ importId: 'i1', stagingPrefix: 'stage', archiveR2Key: 'archive', entries: [], liquidSections: [{ section_key: 'hero' }] });
assert.deepEqual(manifest.default_section_keys, ['hero']);

const pkg = await buildFullThemePackage({
  row: { id: 't1', slug: 'portable', name: 'Portable', theme_family: 'dark', config: '{}', css_vars_json: '{}', tokens_json: '{}', components_json: '{}' },
  publicAssetOrigin: 'https://cdn.example.com',
  bucket: 'themes',
  preview_model: {},
});
assert.equal(pkg.css_url, 'https://cdn.example.com/cms/themes/portable/theme.css');
assert.equal(pkg.css_r2_bucket, 'themes');
assert.doesNotMatch(pkg.readme_md, /inneranimalmedia|companions|cpas/i);

assert.equal(legacyInventory.buildThemePackageManifest, buildThemePackageManifest);
assert.equal(typeof legacyArchive.extractThemeArchive, 'function');

const dir = path.dirname(fileURLToPath(import.meta.url));
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
  const source = fs.readFileSync(path.join(dir, file), 'utf8');
  assert.doesNotMatch(source, /inneranimalmedia|companions|cpas|IAM_COLLAB|SESSION_CACHE|CMS_BUCKET|CMS_PIPELINE/i, `${file} leaked host identity`);
}
console.log('cms-packages tests: OK');
