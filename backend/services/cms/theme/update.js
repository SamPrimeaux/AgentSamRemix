/**
 * Merge theme tweak payloads into cms_themes row columns (config + sidecars).
 */
import { parseCmsThemeConfig, mergeAgentDashboardIdeTokens, variablesFromCmsThemeConfig } from './active.js';
import { mergeAgentHomeCms } from './agent-home.js';
import {
  buildConfigFromPalette,
  buildMonacoThemeDataJson,
  buildThemeSidecarJson,
  expectedMonacoEditorThemeId,
  normalizeThemeSlug,
} from './create.js';

function parseJsonSafe(raw, fallback = {}) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

/**
 * @param {Record<string, unknown>|null|undefined} row
 * @param {Record<string, unknown>} body
 */
export function buildThemeRowUpdateFromBody(row, body) {
  const existingCfg = parseCmsThemeConfig(row?.config);
  const existingCssVars =
    existingCfg?.cssVars && typeof existingCfg.cssVars === 'object'
      ? { ...existingCfg.cssVars }
      : {};

  const paletteIn = body.palette && typeof body.palette === 'object' ? body.palette : {};
  const cssVarsIn = body.cssVars && typeof body.cssVars === 'object' ? body.cssVars : {};
  const mergedCssVars = { ...existingCssVars, ...cssVarsIn };

  const themeFamily =
    body.theme_family != null && String(body.theme_family).trim() !== ''
      ? String(body.theme_family).trim().toLowerCase()
      : String(row?.theme_family || 'light').toLowerCase();

  const palette = {
    canvas: pick(paletteIn, ['canvas', 'bg'], mergedCssVars['--bg-canvas'] || existingCfg.bg),
    surface: pick(paletteIn, ['surface', 'panel'], mergedCssVars['--bg-panel'] || existingCfg.surface),
    nav: pick(paletteIn, ['nav'], mergedCssVars['--bg-nav'] || existingCfg.nav),
    shell: pick(paletteIn, ['shell'], mergedCssVars['--bg-shell'] || mergedCssVars['--bg-nav']),
    text: pick(paletteIn, ['text'], mergedCssVars['--text-main'] || existingCfg.text),
    textSecondary: pick(paletteIn, ['textSecondary', 'muted'], mergedCssVars['--text-muted'] || existingCfg.textSecondary),
    border: pick(paletteIn, ['border'], mergedCssVars['--border'] || existingCfg.border),
    primary: pick(paletteIn, ['primary', 'accent'], mergedCssVars['--color-primary'] || existingCfg.primary),
    primaryHover: pick(paletteIn, ['primaryHover'], mergedCssVars['--accent-hover'] || existingCfg.primaryHover),
    monacoBg: pick(paletteIn, ['monacoBg', 'monaco_bg'], mergedCssVars['--editor-bg'] || existingCfg.monaco_bg),
    is_dark: paletteIn.is_dark ?? existingCfg.is_dark ?? themeFamily === 'dark',
    cssVars: mergedCssVars,
  };

  if (body.sync_nav_shell === true || body.sync_nav_shell === 1) {
    const navColor = palette.nav || palette.shell;
    if (navColor) {
      palette.nav = navColor;
      palette.shell = navColor;
      mergedCssVars['--bg-nav'] = navColor;
      mergedCssVars['--bg-shell'] = navColor;
    }
  }

  const cfgObj = buildConfigFromPalette(palette, themeFamily);
  cfgObj.cssVars = { ...(cfgObj.cssVars || {}), ...mergedCssVars };

  const vars = mergeAgentDashboardIdeTokens(variablesFromCmsThemeConfig(cfgObj), cfgObj);
  for (const [k, v] of Object.entries(vars)) {
    if (v != null && String(v).trim() !== '') cfgObj.cssVars[k] = String(v);
  }

  const slug =
    body.slug != null && String(body.slug).trim() !== ''
      ? normalizeThemeSlug(String(body.slug))
      : String(row?.slug || '').trim();
  const name =
    body.name != null && String(body.name).trim() !== ''
      ? String(body.name).trim()
      : String(row?.name || slug);

  const monacoThemeDataJson = buildMonacoThemeDataJson({
    palette,
    tokens: body.tokens,
    monaco: body.monaco,
    theme_family: themeFamily,
    slug,
  });

  const existingComponents = parseJsonSafe(row?.components_json, {});
  const nextComponents = { ...existingComponents };
  if (body.agent_home && typeof body.agent_home === 'object') {
    nextComponents.agent_home = mergeAgentHomeCms(existingComponents.agent_home, body.agent_home);
  }

  const sidecars = buildThemeSidecarJson({
    palette: {
      canvas: palette.canvas,
      panel: palette.surface,
      shell: palette.shell,
      nav: palette.nav,
      accent: palette.primary,
      accentSoft: palette.primaryHover,
    },
    css_vars: cfgObj.cssVars,
    components: nextComponents,
    ...(body.tokens && typeof body.tokens === 'object' ? body.tokens : {}),
  });

  const sortOrder =
    typeof body.sort_order === 'number' && Number.isFinite(body.sort_order)
      ? Math.floor(body.sort_order)
      : Number(row?.sort_order) || 500;

  /** Explicit body key allows clearing cover (empty string → null). Omitted key preserves row. */
  let previewImageUrl;
  if (Object.prototype.hasOwnProperty.call(body, 'preview_image_url')) {
    previewImageUrl =
      body.preview_image_url != null && String(body.preview_image_url).trim() !== ''
        ? String(body.preview_image_url).trim()
        : null;
  } else {
    previewImageUrl =
      row?.preview_image_url != null && String(row.preview_image_url).trim() !== ''
        ? String(row.preview_image_url).trim()
        : null;
  }

  return {
    name,
    slug,
    themeFamily,
    configJson: JSON.stringify(cfgObj),
    monacoBg: palette.monacoBg || cfgObj.monaco_bg || '#2C4259',
    monacoTheme: expectedMonacoEditorThemeId(slug),
    monacoThemeDataJson,
    sidecars,
    sortOrder,
    previewImageUrl,
    previewImageUrlExplicit: Object.prototype.hasOwnProperty.call(body, 'preview_image_url'),
  };
}

/**
 * @param {Record<string, unknown>} obj
 * @param {string[]} keys
 * @param {unknown} fallback
 */
function pick(obj, keys, fallback) {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  if (fallback != null && String(fallback).trim() !== '') return String(fallback).trim();
  return undefined;
}
