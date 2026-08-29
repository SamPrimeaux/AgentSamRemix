import { httpJsonResponse as jsonResponse } from '../../responses.js';
import { normalizeCatalogThemeRow } from '../../../services/cms/theme/preview-model.js';
import { resolveDashboardThemeTenantId } from '../../../services/cms/theme/payload.js';
import { tenantCanMutateCmsTheme, tenantCanReadCmsTheme } from '../../../services/cms/theme/ownership.js';
import { readCmsThemeById, readCmsThemeBySlug } from '../../../services/cms/theme/repository.js';
import { buildFullThemePackage } from '../../../services/cms/packages/theme-package.js';
import { canUsePlatformAssetsR2Upload } from '../../../services/cms/adapters/cloudflare/theme.js';
import {
  CMS_THEME_ASSET_ORIGIN,
  CMS_THEME_R2_BUCKET,
  cmsThemePackageFiles,
  cmsThemePackageMeta,
  persistPortableCmsThemePackage,
} from '../../../services/cms/adapters/cloudflare/theme-package.js';

export async function handleCmsThemePackageRoute({ pathLower, request, env, authUser }) {
  if (pathLower !== '/api/themes/package' || request.method.toUpperCase() !== 'POST') return null;

  const body = await request.json().catch(() => ({}));
  const tid = String((await resolveDashboardThemeTenantId(env, authUser)) || '').trim();
  const slug = body.slug != null ? String(body.slug).trim() : '';
  const themeId = body.theme_id != null ? String(body.theme_id).trim() : '';

  let fullRow = themeId ? await readCmsThemeById(env, themeId) : null;
  if (!fullRow && slug) fullRow = await readCmsThemeBySlug(env, slug);
  if (!fullRow?.slug) return jsonResponse({ error: 'Theme not found' }, 404);
  if (!tenantCanReadCmsTheme(fullRow, tid)) return jsonResponse({ error: 'Forbidden' }, 403);
  if (!tenantCanMutateCmsTheme(fullRow, tid)) {
    return jsonResponse({ error: 'Save a custom copy before regenerating this shared theme' }, 409);
  }

  const normalizedSlug = String(fullRow.slug).trim();
  let normalized = normalizeCatalogThemeRow(fullRow);
  const pkg = await buildFullThemePackage({
    row: fullRow,
    publicAssetOrigin: CMS_THEME_ASSET_ORIGIN,
    bucket: CMS_THEME_R2_BUCKET,
    preview_model: normalized.preview_model,
  });

  const explicitMode = body.output_mode != null ? String(body.output_mode).trim() : '';
  const platformR2 = await canUsePlatformAssetsR2Upload(env, null, tid);
  const allowIamR2Upload = Boolean(env.ASSETS && platformR2);
  const out = {
    theme: normalized,
    output_mode: allowIamR2Upload && explicitMode !== 'export_bundle' ? 'r2_and_d1' : 'export_bundle',
  };

  if (allowIamR2Upload && explicitMode !== 'export_bundle') {
    try {
      await persistPortableCmsThemePackage(env, {
        themeId: String(fullRow.id),
        slug: normalizedSlug,
        pkg,
      });
      const refreshed = await readCmsThemeById(env, String(fullRow.id));
      normalized = normalizeCatalogThemeRow(refreshed || fullRow);
      out.theme = normalized;
      out.package_meta = cmsThemePackageMeta(pkg);
    } catch (error) {
      out.r2_upload_error = error?.message ? String(error.message) : String(error);
    }
  }

  if (!allowIamR2Upload || out.r2_upload_error || explicitMode === 'export_bundle') {
    out.package_files = cmsThemePackageFiles(pkg);
    out.output_mode_options = ['r2_and_d1', 'export_bundle'];
    out.package_meta = cmsThemePackageMeta(pkg);
  }

  return jsonResponse(out);
}
