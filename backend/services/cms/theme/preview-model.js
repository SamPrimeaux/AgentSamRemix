/**
 * Derives a stable preview_model for theme browser cards from cms_themes rows.
 * Safe against malformed JSON — never throws.
 */

import { parseCmsThemeConfig } from "./active.js";

/** @param {unknown} raw */
function parseJsonSafe(raw) {
  if (raw == null) return { ok: true, value: null, error: null };
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { ok: true, value: v, error: null };
  } catch (e) {
    return { ok: false, value: null, error: e?.message ? String(e.message) : "parse_error" };
  }
}

/** @param {Record<string, string>} map */
function pickVar(map, keys, fallback = "") {
  for (const k of keys) {
    const v = map[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return fallback;
}

/**
 * @param {Record<string, unknown>} monacoData
 * @param {string} monacoBgFallback
 */
function monacoColorsFromThemeData(monacoData, monacoBgFallback) {
  const colors =
    monacoData && typeof monacoData === "object" && monacoData.colors && typeof monacoData.colors === "object"
      ? /** @type {Record<string, string>} */ (monacoData.colors)
      : {};
  return {
    bg: colors["editor.background"]?.trim() || monacoBgFallback,
    text: colors["editor.foreground"]?.trim() || "",
    muted: colors["editorLineNumber.foreground"]?.trim() || colors["editorWhitespace.foreground"]?.trim() || "",
    accent: colors["editorCursor.foreground"]?.trim() || colors["focusBorder"]?.trim() || "",
  };
}

/**
 * Parse all JSON-ish cms_themes columns for API responses.
 * @param {Record<string, unknown>} row
 */
export function parseAllThemeJsonFields(row) {
  /** @type {Record<string, string | null>} */
  const errors = {};

  const track = (key, raw) => {
    const r = parseJsonSafe(raw);
    if (!r.ok) errors[key] = r.error;
    return r.value;
  };

  const configRaw = row?.config;
  const configObj = parseCmsThemeConfig(configRaw);

  const tokens_json = track("tokens_json", row?.tokens_json);
  const css_vars_json = track("css_vars_json", row?.css_vars_json);
  const brand_json = track("brand_json", row?.brand_json);
  const layout_json = track("layout_json", row?.layout_json);
  const typography_json = track("typography_json", row?.typography_json);
  const components_json = track("components_json", row?.components_json);
  const motion_json = track("motion_json", row?.motion_json);
  const monaco_theme_data = track("monaco_theme_data", row?.monaco_theme_data);

  const cssVarsFromConfig =
    configObj && typeof configObj === "object" && configObj.cssVars && typeof configObj.cssVars === "object"
      ? /** @type {Record<string, string>} */ (configObj.cssVars)
      : {};

  const cssVarsFlat = { ...cssVarsFromConfig };
  if (css_vars_json && typeof css_vars_json === "object") {
    for (const [k, v] of Object.entries(css_vars_json)) {
      if (v != null) cssVarsFlat[k.startsWith("--") ? k : `--${k.replace(/^-+/, "")}`] = String(v);
    }
  }

  return {
    parsed: {
      config: configObj && typeof configObj === "object" ? configObj : {},
      tokens_json,
      css_vars_json,
      brand_json,
      layout_json,
      typography_json,
      components_json,
      motion_json,
      monaco_theme_data,
      cssVarsMerged: cssVarsFlat,
    },
    parse_errors: Object.keys(errors).length ? errors : undefined,
  };
}

/**
 * @param {Record<string, unknown>} row
 * @param {{ parsed: ReturnType<typeof parseAllThemeJsonFields>["parsed"], parse_errors?: Record<string, string | null> }} parsedBundle
 */
export function buildPreviewModel(row, parsedBundle) {
  const { parsed } = parsedBundle;
  const cfg = parsed.config && typeof parsed.config === "object" ? parsed.config : {};
  const cv = parsed.cssVarsMerged || {};

  const monacoRaw = parsed.monaco_theme_data;
  const monacoData =
    monacoRaw && typeof monacoRaw === "object"
      ? monacoRaw
      : monacoRaw && typeof monacoRaw === "string"
        ? parseJsonSafe(monacoRaw).value
        : null;

  const monacoBgRow =
    row?.monaco_bg != null && String(row.monaco_bg).trim() !== "" ? String(row.monaco_bg).trim() : "";
  const monacoBg =
    pickVar(cv, ["--editor-bg", "--editor-panel"]) ||
    monacoBgRow ||
    (cfg.monaco_bg != null ? String(cfg.monaco_bg) : "") ||
    "#1e293b";

  const mdCols = monacoColorsFromThemeData(
    monacoData && typeof monacoData === "object" ? monacoData : {},
    monacoBg,
  );

  const tokensRoot = parsed.tokens_json;
  const tokPalette =
    tokensRoot &&
    typeof tokensRoot === "object" &&
    tokensRoot.palette &&
    typeof tokensRoot.palette === "object"
      ? /** @type {Record<string, unknown>} */ (tokensRoot.palette)
      : null;

  const canvas =
    (tokPalette?.canvas != null ? String(tokPalette.canvas).trim() : "") ||
    pickVar(cv, ["--bg-canvas", "--bg-app"]) ||
    (cfg.bg != null ? String(cfg.bg) : "") ||
    "#f8fafc";
  const surface =
    (tokPalette?.panelAlt != null ? String(tokPalette.panelAlt).trim() : "") ||
    pickVar(cv, ["--bg-surface", "--bg-secondary"]) ||
    (cfg.surface != null ? String(cfg.surface) : "") ||
    "#ffffff";
  const panel =
    (tokPalette?.panel != null ? String(tokPalette.panel).trim() : "") ||
    pickVar(cv, ["--bg-panel", "--bg-elevated"]) ||
    (cfg.surface != null ? String(cfg.surface) : "") ||
    surface;
  const elevated = pickVar(cv, ["--bg-elevated"]) || panel;
  const nav =
    (tokPalette?.nav != null ? String(tokPalette.nav).trim() : "") ||
    pickVar(cv, ["--bg-nav", "--bg-shell"]) ||
    (cfg.nav != null ? String(cfg.nav) : "") ||
    canvas;
  const shell =
    (tokPalette?.shell != null ? String(tokPalette.shell).trim() : "") || pickVar(cv, ["--bg-shell"]) || nav;

  const text =
    pickVar(cv, ["--text-primary", "--color-text"]) || (cfg.text != null ? String(cfg.text) : "") || "#0f172a";
  const textSecondary =
    pickVar(cv, ["--text-secondary"]) ||
    (cfg.textSecondary != null ? String(cfg.textSecondary) : "") ||
    "#475569";
  const muted =
    pickVar(cv, ["--text-muted"]) ||
    (cfg.textSecondary != null ? String(cfg.textSecondary) : "") ||
    "#64748b";

  const border =
    pickVar(cv, ["--color-border", "--border"]) || (cfg.border != null ? String(cfg.border) : "") || "#e2e8f0";

  const primary =
    (tokPalette?.accent != null ? String(tokPalette.accent).trim() : "") ||
    pickVar(cv, ["--color-primary", "--accent"]) ||
    (cfg.primary != null ? String(cfg.primary) : "") ||
    "#0ea5e9";
  const primaryHover =
    (tokPalette?.accentSoft != null ? String(tokPalette.accentSoft).trim() : "") ||
    pickVar(cv, ["--primary-hover", "--accent-hover"]) ||
    (cfg.primaryHover != null ? String(cfg.primaryHover) : "") ||
    primary;

  const focus =
    pickVar(cv, ["--focus", "--border-focus"]) ||
    primary;

  const radius =
    pickVar(cv, ["--border-radius"]) || (cfg.radius != null ? String(cfg.radius) : "") || "8px";

  const monacoText =
    mdCols.text ||
    pickVar(cv, ["--editor-text"]) ||
    (cfg.text != null ? String(cfg.text) : "") ||
    "#e2e8f0";
  const monacoMuted =
    mdCols.muted ||
    pickVar(cv, ["--editor-muted"]) ||
    muted;
  const monacoAccent =
    mdCols.accent ||
    pickVar(cv, ["--editor-accent"]) ||
    primary;

  const swatchSet = new Set();
  const pushSw = (c) => {
    const s = c?.trim();
    if (s && /^#|^rgb|^hsl/i.test(s)) swatchSet.add(s);
  };
  [canvas, surface, primary, monacoBg, nav, text].forEach(pushSw);
  const swatches = [...swatchSet].slice(0, 8);

  return {
    canvas,
    surface,
    panel,
    elevated,
    nav,
    shell,
    text,
    textSecondary,
    muted,
    border,
    primary,
    primaryHover,
    focus,
    radius,
    monacoBg,
    monacoText,
    monacoMuted,
    monacoAccent,
    swatches,
  };
}

/**
 * Full normalization for one cms_themes row (for GET /api/themes).
 * @param {Record<string, unknown>} row
 */
export function normalizeCatalogThemeRow(row) {
  const parsedBundle = parseAllThemeJsonFields(row);
  const preview_model = buildPreviewModel(row, parsedBundle);
  return {
    ...row,
    parsed: parsedBundle.parsed,
    parse_errors: parsedBundle.parse_errors,
    preview_model,
  };
}
