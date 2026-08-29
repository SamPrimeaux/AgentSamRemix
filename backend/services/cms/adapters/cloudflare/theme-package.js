/** Cloudflare R2 publication for portable CMS theme packages. */
import { mergeCmsThemePackageMeta } from '../../packages/registry.js';
import {
  readCmsThemeTokensJson,
  updateCmsThemeR2Meta,
  writeCmsThemePackageMeta,
} from '../../theme/repository.js';

export const CMS_THEME_ASSET_ORIGIN = 'https://assets.inneranimalmedia.com';
export const CMS_THEME_R2_BUCKET = 'inneranimalmedia';

export async function putPortableCmsThemePackage(env, slug, pkg) {
  const bucket = env?.ASSETS;
  if (!bucket || typeof bucket.put !== 'function') throw new Error('R2 ASSETS binding unavailable');
  const value = String(slug || '').trim();
  const files = [
    ['theme.css', pkg.theme_css, 'text/css; charset=utf-8'],
    ['theme.json', pkg.theme_json, 'application/json; charset=utf-8'],
    ['monaco.json', pkg.monaco_json, 'application/json; charset=utf-8'],
    ['manifest.json', pkg.manifest_json, 'application/json; charset=utf-8'],
    ['preview.html', pkg.preview_html, 'text/html; charset=utf-8'],
    ['README.md', pkg.readme_md, 'text/markdown; charset=utf-8'],
  ];
  const versionPrefix = String(pkg.version_prefix || '').trim();
  for (const [filename, body, contentType] of files) {
    await bucket.put(`cms/themes/${value}/${filename}`, body, { httpMetadata: { contentType } });
    if (versionPrefix) {
      await bucket.put(`${versionPrefix}/${filename}`, body, { httpMetadata: { contentType } });
    }
  }
}

export async function persistPortableCmsThemePackage(env, { themeId, slug, pkg }) {
  await putPortableCmsThemePackage(env, slug, pkg);
  try {
    await updateCmsThemeR2Meta(env, themeId, {
      css_r2_key: pkg.css_r2_key,
      css_url: pkg.css_url,
      compiled_css_hash: pkg.compiled_css_hash,
      css_r2_bucket: pkg.css_r2_bucket,
    });
  } catch (error) {
    console.warn('[cms-theme-package] R2 metadata update skipped', error?.message || error);
  }
  try {
    const currentTokens = await readCmsThemeTokensJson(env, themeId);
    const merged = mergeCmsThemePackageMeta(currentTokens, {
      source_hash: pkg.source_hash,
      css_hash: pkg.compiled_css_hash,
      package_hash: pkg.package_hash,
      manifest_r2_key: `cms/themes/${slug}/manifest.json`,
      manifest_url: `${CMS_THEME_ASSET_ORIGIN}/cms/themes/${slug}/manifest.json`,
      preview_html_url: `${CMS_THEME_ASSET_ORIGIN}/cms/themes/${slug}/preview.html`,
      versioned_r2_prefix: `${pkg.version_prefix}/`,
      generated_at: new Date().toISOString(),
      file_hashes: pkg.file_hashes,
    });
    await writeCmsThemePackageMeta(env, themeId, merged);
  } catch (error) {
    console.warn('[cms-theme-package] metadata persist skipped', error?.message || error);
  }
}

export function cmsThemePackageFiles(pkg) {
  return {
    'theme.css': pkg.theme_css,
    'theme.json': pkg.theme_json,
    'monaco.json': pkg.monaco_json,
    'manifest.json': pkg.manifest_json,
    'preview.html': pkg.preview_html,
    'README.md': pkg.readme_md,
  };
}

export function cmsThemePackageMeta(pkg) {
  return {
    source_hash: pkg.source_hash,
    css_hash: pkg.compiled_css_hash,
    package_hash: pkg.package_hash,
    file_hashes: pkg.file_hashes,
  };
}
