/**
 * Pure helpers for POST /api/themes/create — builds cms_themes columns from request palette/tokens.
 */

/**
 * @param {string | undefined} raw
 */
export function normalizeThemeSlug(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return s || "theme";
}

/**
 * @param {Record<string, unknown>} palette
 * @param {string} theme_family
 */
export function buildConfigFromPalette(palette, theme_family) {
  const p = palette && typeof palette === "object" ? palette : {};
  const isDark =
    typeof p.is_dark === "boolean"
      ? p.is_dark
      : theme_family === "dark" ||
        (typeof p.theme_family === "string" && String(p.theme_family).toLowerCase() === "dark");

  const canvas = pickStr(p, ["canvas", "bg", "base"], "#f1f5f9");
  const surface = pickStr(p, ["surface", "panel"], "#ffffff");
  const text = pickStr(p, ["text", "foreground"], isDark ? "#f8fafc" : "#0f172a");
  const textSecondary = pickStr(p, ["textSecondary", "muted"], isDark ? "#94a3b8" : "#64748b");
  const border = pickStr(p, ["border"], isDark ? "#334155" : "#e2e8f0");
  const primary = pickStr(p, ["primary", "accent"], "#0ea5e9");
  const primaryHover = pickStr(p, ["primaryHover", "accentHover"], primary);
  const radius = pickStr(p, ["radius"], "8px");
  const nav = pickStr(p, ["nav", "shell"], canvas);
  const monacoBg = pickStr(p, ["monacoBg", "monaco_bg", "editorBackground"], isDark ? "#2C4259" : "#f8fafc");

  const cssVars =
    p.cssVars && typeof p.cssVars === "object"
      ? /** @type {Record<string, string>} */ (p.cssVars)
      : {};

  return {
    bg: canvas,
    surface,
    nav,
    text,
    textSecondary,
    border,
    primary,
    primaryHover,
    radius,
    monaco_bg: monacoBg,
    is_dark: isDark,
    cssVars,
  };
}

/**
 * @param {Record<string, unknown>} obj
 * @param {string[]} keys
 * @param {string} fallback
 */
function pickStr(obj, keys, fallback) {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return fallback;
}

/**
 * @param {{
 *   palette?: Record<string, unknown>,
 *   tokens?: Record<string, unknown>,
 *   monaco?: Record<string, unknown>,
 *   theme_family?: string,
 *   slug: string,
 * }} args
 */
export function buildMonacoThemeDataJson(args) {
  const fam = String(args.theme_family || "light").toLowerCase();
  const p = args.palette && typeof args.palette === "object" ? args.palette : {};
  const monaco = args.monaco && typeof args.monaco === "object" ? args.monaco : {};
  const cfg = buildConfigFromPalette(p, fam);

  const base =
    typeof monaco.base === "string"
      ? monaco.base
      : fam === "light" || cfg.is_dark === false
        ? "vs"
        : "vs-dark";

  const editorBg =
    (monaco.colors && typeof monaco.colors === "object" && monaco.colors["editor.background"]) ||
    monaco.editorBackground ||
    cfg.monaco_bg;

  const editorFg =
    (monaco.colors && typeof monaco.colors === "object" && monaco.colors["editor.foreground"]) ||
    monaco.foreground ||
    cfg.text;

  const colors = {
    "editor.background": String(editorBg),
    "editor.foreground": String(editorFg),
    ...(typeof monaco.colors === "object" && monaco.colors ? monaco.colors : {}),
  };

  const out = {
    base,
    inherit: monaco.inherit !== false,
    rules: Array.isArray(monaco.rules) ? monaco.rules : [],
    colors,
  };
  return JSON.stringify(out);
}

/**
 * Default JSON column payloads for cms_themes.
 * @param {Record<string, unknown> | undefined} tokens
 */
export function buildThemeSidecarJson(tokens) {
  const t = tokens && typeof tokens === "object" ? tokens : {};
  const tokens_json = JSON.stringify(t.tokens ?? t.palette ?? {});
  const css_vars_json = JSON.stringify(t.css_vars ?? t.cssVars ?? {});
  const brand_json = JSON.stringify(t.brand ?? {});
  const layout_json = JSON.stringify(t.layout ?? {});
  const typography_json = JSON.stringify(t.typography ?? {});
  const components_json = JSON.stringify(t.components ?? {});
  const motion_json = JSON.stringify(t.motion ?? {});
  return { tokens_json, css_vars_json, brand_json, layout_json, typography_json, components_json, motion_json };
}

/**
 * @param {string} slug
 */
export function expectedMonacoEditorThemeId(slug) {
  const s = String(slug || "").trim();
  return s ? `${s}-monaco` : "vs-dark";
}
