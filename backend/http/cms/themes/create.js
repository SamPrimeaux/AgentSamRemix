import { httpJsonResponse as jsonResponse } from '../../responses.js';
import {
  buildConfigFromPalette,
  buildMonacoThemeDataJson,
  buildThemeSidecarJson,
  expectedMonacoEditorThemeId,
  normalizeThemeSlug,
} from '../../../services/cms/theme/create.js';
import { buildThemeRowUpdateFromBody } from '../../../services/cms/theme/update.js';
import { normalizeCatalogThemeRow } from '../../../services/cms/theme/preview-model.js';
import { resolveDashboardThemePayload, resolveDashboardThemeTenantId } from '../../../services/cms/theme/payload.js';
import { setDashboardUserThemePreference } from '../../../services/cms/theme/preferences.js';
import { invalidateCachedActiveThemePayload } from '../../../services/cms/theme/cache.js';
import {
  findCmsThemeSlugConflict,
  insertTenantCmsTheme,
  readCmsThemeById,
} from '../../../services/cms/theme/repository.js';
import { buildFullThemePackage } from '../../../services/cms/packages/theme-package.js';
import {
  CMS_THEME_ASSET_ORIGIN,
  CMS_THEME_R2_BUCKET,
  cmsThemePackageFiles,
  cmsThemePackageMeta,
  persistPortableCmsThemePackage,
} from '../../../services/cms/adapters/cloudflare/theme-package.js';
import {
  canUsePlatformAssetsR2Upload,
  hydrateCmsThemeCssVarsFromR2,
} from '../../../services/cms/adapters/cloudflare/theme.js';

export async function handleCmsThemeCreateRoute({ pathLower, request, env, authUser }) {
  if (pathLower !== '/api/themes/create' || request.method.toUpperCase() !== 'POST') return null;

  const body = await request.json().catch(() => ({}));
  const tenantId = await resolveDashboardThemeTenantId(env, authUser);
  const tid = String(tenantId || '').trim();
  if (!tid) return jsonResponse({ error: 'Tenant required' }, 400);

  const slug = normalizeThemeSlug(body.slug != null ? String(body.slug) : '');
  if (!slug) return jsonResponse({ error: 'slug required' }, 400);
  const conflict = await findCmsThemeSlugConflict(env, slug);
  if (conflict?.id) return jsonResponse({ error: `Theme slug "${slug}" is already in use` }, 409);

  const name = body.name != null && String(body.name).trim() !== '' ? String(body.name).trim() : slug;
  const themeFamily =
    body.theme_family != null && String(body.theme_family).trim() !== ''
      ? String(body.theme_family).trim().toLowerCase()
      : 'light';
  const paletteObj = body.palette && typeof body.palette === 'object' ? body.palette : {};
  const useTweaksPayload = body.cssVars && typeof body.cssVars === 'object';

  let configJson;
  let monacoBg;
  let monacoThemeDataJson;
  let sidecars;
  let previewImageUrl = null;
  if (useTweaksPayload) {
    const patch = buildThemeRowUpdateFromBody(
      { slug, name, theme_family: themeFamily, config: '{}' },
      body,
    );
    configJson = patch.configJson;
    monacoBg = patch.monacoBg;
    monacoThemeDataJson = patch.monacoThemeDataJson;
    sidecars = patch.sidecars;
    previewImageUrl = patch.previewImageUrl;
  } else {
    const config = buildConfigFromPalette(paletteObj, themeFamily);
    configJson = JSON.stringify(config);
    monacoBg =
      config.monaco_bg != null && String(config.monaco_bg).trim() !== ''
        ? String(config.monaco_bg).trim()
        : '#2C4259';
    monacoThemeDataJson = buildMonacoThemeDataJson({
      palette: paletteObj,
      tokens: body.tokens,
      monaco: body.monaco,
      theme_family: themeFamily,
    });
    sidecars = buildThemeSidecarJson(
      body.tokens && typeof body.tokens === 'object' ? body.tokens : { palette: paletteObj },
    );
    previewImageUrl =
      body.preview_image_url != null && String(body.preview_image_url).trim() !== ''
        ? String(body.preview_image_url).trim()
        : null;
  }

  const rowId = `theme-${crypto.randomUUID()}`;
  const sortOrder =
    typeof body.sort_order === 'number' && Number.isFinite(body.sort_order)
      ? Math.floor(body.sort_order)
      : 500;

  let fullRow = await insertTenantCmsTheme(env, {
    id: rowId,
    tenantId: tid,
    name,
    slug,
    configJson,
    themeFamily,
    sortOrder,
    monacoTheme: expectedMonacoEditorThemeId(slug),
    monacoBg,
    monacoThemeDataJson,
    sidecars,
    previewImageUrl,
  });
  if (!fullRow) return jsonResponse({ error: 'Theme persist failed' }, 500);

  let normalized = normalizeCatalogThemeRow(fullRow);
  const explicitMode = body.output_mode != null ? String(body.output_mode).trim() : '';
  const platformR2 = await canUsePlatformAssetsR2Upload(env, null, tid);
  const outputMode = explicitMode || (platformR2 ? 'r2_and_d1' : 'export_bundle');
  const pkg = await buildFullThemePackage({
    row: fullRow,
    publicAssetOrigin: CMS_THEME_ASSET_ORIGIN,
    bucket: CMS_THEME_R2_BUCKET,
    preview_model: normalized.preview_model,
  });

  const out = { theme: normalized, output_mode: outputMode };
  const shouldUpload = env.ASSETS && platformR2 && outputMode !== 'export_bundle' && outputMode !== 'd1_only';
  if (shouldUpload) {
    try {
      await persistPortableCmsThemePackage(env, { themeId: rowId, slug, pkg });
      fullRow = (await readCmsThemeById(env, rowId)) || fullRow;
      normalized = normalizeCatalogThemeRow(fullRow);
      out.theme = normalized;
      out.package_meta = cmsThemePackageMeta(pkg);
    } catch (error) {
      out.r2_upload_error = error?.message ? String(error.message) : String(error);
    }
  }

  if (!shouldUpload || out.r2_upload_error) {
    if (outputMode === 'r2_and_d1' && !platformR2) {
      out.storage_notice =
        'Platform R2 theme publishing is not enabled for this account; the theme is still saved in D1.';
    }
    out.output_mode_options = ['r2_and_d1', 'export_bundle'];
    out.package_files = cmsThemePackageFiles(pkg);
    out.package_meta = cmsThemePackageMeta(pkg);
  }

  const applyFlag = body.apply_to_user === true || body.apply_to_user === 1 || body.apply_to_user === '1';
  if (applyFlag) {
    const uid = String(authUser.id || '').trim();
    await setDashboardUserThemePreference(env, {
      tenantId: tid,
      userId: uid,
      themeSlug: slug,
      themeCmsRowId: rowId,
    });
    await invalidateCachedActiveThemePayload(env, null, uid);
    const { payload } = await resolveDashboardThemePayload(env, authUser, {
      cache: true,
      hydrateCssVars: hydrateCmsThemeCssVarsFromR2,
    });
    out.active_theme = payload;
  }

  return jsonResponse(out);
}
