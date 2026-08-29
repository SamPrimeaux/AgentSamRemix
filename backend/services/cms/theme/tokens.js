/**
 * Canonical portable token buckets for theme.json + preview (lightweight D1).
 */

import { parseCmsThemeConfig } from "./active.js";

/**
 * @param {Record<string, unknown>} row
 * @param {Record<string, string>} variables — merged canonical theme CSS vars
 * @param {Record<string, unknown> | undefined} preview_model
 */
export function buildCanonicalThemeTokens(row, variables, preview_model) {
  const cfg = parseCmsThemeConfig(row?.config);
  const pm = preview_model && typeof preview_model === "object" ? preview_model : {};

  const getVar = (keys, fb = "") => {
    for (const k of keys) {
      const v = variables[k];
      if (v != null && String(v).trim() !== "") return String(v).trim();
    }
    return fb;
  };

  const palette = {
    canvas: String(pm.canvas ?? cfg.bg ?? getVar(["--bg-canvas"], "#f8fafc")),
    surface: String(pm.surface ?? pm.panel ?? cfg.surface ?? getVar(["--bg-panel", "--bg-surface"], "#ffffff")),
    elevated: String(pm.elevated ?? getVar(["--bg-elevated"], "")),
    nav: String(pm.nav ?? cfg.nav ?? getVar(["--bg-nav"], "")),
    shell: String(pm.shell ?? getVar(["--bg-shell"], "")),
    primary: String(pm.primary ?? cfg.primary ?? getVar(["--color-primary"], "#0ea5e9")),
    accent: String(pm.primary ?? cfg.primary ?? getVar(["--accent"], "#0ea5e9")),
    accentSoft: String(pm.primaryHover ?? cfg.primaryHover ?? ""),
    border: String(pm.border ?? cfg.border ?? getVar(["--border", "--color-border"], "#e2e8f0")),
  };

  const shell = {
    nav: palette.nav || palette.canvas,
    shell: palette.shell || palette.nav,
    statusBar: cfg.statusBar != null ? String(cfg.statusBar) : "",
  };

  const surface = {
    panel: palette.surface,
    elevated: palette.elevated || palette.surface,
    overlay: cfg.bg != null ? String(cfg.bg) : palette.canvas,
  };

  const text = {
    primary: String(pm.text ?? cfg.text ?? getVar(["--text-primary"], "#0f172a")),
    secondary: String(pm.textSecondary ?? cfg.textSecondary ?? getVar(["--text-secondary"], "#475569")),
    muted: String(pm.muted ?? cfg.textSecondary ?? getVar(["--text-muted"], "#64748b")),
    heading: String(pm.text ?? cfg.text ?? ""),
  };

  const border = {
    default: palette.border,
    subtle: getVar(["--border-subtle"], ""),
    focus: String(pm.focus ?? getVar(["--border-focus"], palette.primary)),
  };

  const accent = {
    primary: palette.primary,
    hover: palette.accentSoft || palette.primary,
    muted: String(pm.monacoMuted ?? ""),
  };

  const editor = {
    monaco_bg: row?.monaco_bg != null ? String(row.monaco_bg) : String(pm.monacoBg ?? "#182433"),
    monaco_text: String(pm.monacoText ?? "#e2e8f0"),
    monaco_muted: String(pm.monacoMuted ?? ""),
    monaco_accent: String(pm.monacoAccent ?? palette.primary),
    editor_background_var: getVar(["--editor-bg"], ""),
  };

  const typography = {
    fontFamily: cfg.fontFamily != null ? String(cfg.fontFamily) : "",
    radius: String(pm.radius ?? cfg.radius ?? getVar(["--border-radius"], "8px")),
  };

  const motion = {
    transition:
      typeof cfg.transition === "string" ? cfg.transition : "all 0.2s ease",
  };

  const preview = {
    ...extractPreviewFromPm(pm),
  };

  return {
    palette,
    shell,
    surface,
    text,
    border,
    accent,
    editor,
    typography,
    motion,
    preview,
  };
}

/** @param {Record<string, unknown>} pm */
function extractPreviewFromPm(pm) {
  return {
    canvas: pm.canvas,
    nav: pm.nav,
    panel: pm.panel,
    primary: pm.primary,
    monacoBg: pm.monacoBg,
    swatches: Array.isArray(pm.swatches) ? pm.swatches : [],
  };
}
