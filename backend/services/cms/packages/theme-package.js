/**
 * Portable CMS theme package generation: deterministic files, per-file SHA-256,
 * source_hash / package_hash, enriched manifest.json.
 */

import { variablesFromCmsThemeConfig, parseCmsThemeConfig, mergeAgentDashboardIdeTokens } from "../theme/active.js";
import { computeCmsThemeSourceHash, computeCmsThemePackageHash, sha256Hex } from "./hashing.js";
import { buildCanonicalThemeTokens } from "../theme/tokens.js";

/** @param {Record<string, unknown>} row */
export function computeThemeVariablesFromRow(row) {
  const cfg = parseCmsThemeConfig(row?.config);
  const base = variablesFromCmsThemeConfig(cfg);
  return mergeAgentDashboardIdeTokens(base, cfg);
}

/**
 * @param {string} slug
 * @param {Record<string, string>} variables
 */
export function buildCompiledCss(slug, variables) {
  const keys = Object.keys(variables).sort((a, b) => a.localeCompare(b));
  const decls = keys.map((k) => `  ${k}: ${variables[k]};`).join("\n");
  return `:root[data-cms-theme="${slug}"] {\n${decls}\n}\n\n:root[data-cms-theme="${slug}"] body {\n  background: var(--bg-canvas);\n  color: var(--color-text);\n}\n`;
}

/**
 * @param {Record<string, unknown>} row
 * @param {Record<string, string>} variables
 */
export function buildMonacoJsonString(row, variables) {
  const raw = row.monaco_theme_data;
  if (raw != null && String(raw).trim() !== "") {
    try {
      const obj = JSON.parse(String(raw));
      return `${JSON.stringify(obj, null, 2)}\n`;
    } catch {
      /* fall through */
    }
  }
  const fg = variables["--color-text"] || variables["--text-primary"] || "#e2e8f0";
  return `${JSON.stringify(
    {
      base: row.theme_family === "light" ? "vs" : "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": row.monaco_bg || "#1e293b",
        "editor.foreground": fg,
      },
    },
    null,
    2,
  )}\n`;
}

/**
 * @param {{ slug: string, name?: string, preview_model?: Record<string, unknown>, themeCssAbsoluteUrl: string }} meta
 */
export function buildPreviewHtml(meta) {
  const slug = String(meta.slug || "theme").trim();
  const name = String(meta.name || slug).trim();
  const cssHref = String(meta.themeCssAbsoluteUrl || "").trim();
  const pm = meta.preview_model && typeof meta.preview_model === "object" ? meta.preview_model : {};
  const canvas = String(pm.canvas || "#f8fafc");
  const nav = String(pm.nav || pm.shell || canvas);
  const panel = String(pm.panel || pm.surface || "#fff");
  const text = String(pm.text || "#0f172a");
  const muted = String(pm.muted || pm.textSecondary || "#64748b");
  const primary = String(pm.primary || "#0ea5e9");
  const monacoBg = String(pm.monacoBg || "#182433");
  const monacoText = String(pm.monacoText || "#e2e8f0");

  const linkTag =
    cssHref !== ""
      ? `<link rel="stylesheet" href="${escapeHtml(cssHref)}" />`
      : "";

  return `<!DOCTYPE html>
<html lang="en" data-cms-theme="${escapeHtml(slug)}">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(name)} — preview</title>
  ${linkTag}
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, sans-serif; background: var(--bg-canvas, ${canvas}); color: var(--text-primary, ${text}); }
    .nav { height: 36px; background: var(--bg-nav, ${nav}); border-bottom: 1px solid rgba(0,0,0,.08); display:flex; align-items:center; padding: 0 12px; font-size: 12px; color: var(--text-muted, ${muted}); }
    .main { display: grid; grid-template-columns: 1fr 220px; min-height: 220px; }
    .editor { background: ${monacoBg}; color: ${monacoText}; padding: 12px; font-family: ui-monospace, monospace; font-size: 11px; line-height: 1.5; }
    .panel { background: var(--bg-panel, ${panel}); padding: 12px; border-left: 1px solid rgba(0,0,0,.08); }
    .btn { display:inline-block; margin-top:8px; padding:6px 12px; background: var(--color-primary, ${primary}); color:#fff; border-radius:6px; font-size:12px; text-decoration:none; }
    .sw { display:flex; gap:4px; margin-top:8px; flex-wrap:wrap; }
    .sw span { width:18px; height:18px; border-radius:4px; border:1px solid rgba(0,0,0,.12); }
    h1 { font-size: 14px; margin: 0 0 8px; color: var(--text-primary, ${text}); }
    p { margin: 0; font-size: 12px; color: var(--text-muted, ${muted}); }
  </style>
</head>
<body>
  <div class="nav">${escapeHtml(name)} · ${escapeHtml(slug)}</div>
  <div class="main">
    <div class="editor">// Monaco preview<br/>const theme = '${escapeHtml(slug)}';</div>
    <div class="panel">
      <h1>Surface</h1>
      <p>Portable preview — loads theme.css when hosted on R2/CDN.</p>
      <a class="btn" href="#">Primary</a>
      <div class="sw">
        ${["canvas", "surface", "primary", "monacoBg", "nav", "text"]
          .map((k) => {
            const c = pm[k];
            return typeof c === "string"
              ? `<span title="${escapeHtml(k)}" style="background:${escapeHtml(c)}"></span>`
              : "";
          })
          .join("")}
      </div>
    </div>
  </div>
</body>
</html>
`;
}

/** @param {string} s */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {{ slug: string, name?: string, cssUrl?: string | null }} meta
 */
export function buildReadmeMarkdown(meta) {
  const slug = String(meta.slug || "theme").trim();
  const name = String(meta.name || slug).trim();
  const cssUrl = meta.cssUrl ? String(meta.cssUrl) : `cms/themes/${slug}/theme.css`;
  const manifestUrl = cssUrl.replace(/theme\.css$/, "manifest.json");
  return `# ${name}

Portable CMS theme package (\`${slug}\`).

## Contents

| File | Purpose |
|------|---------|
| \`theme.css\` | Compiled CSS variables + selectors |
| \`theme.json\` | Metadata + **tokens** (palette, shell, editor, …) |
| \`monaco.json\` | Monaco \`IStandaloneThemeData\` |
| \`manifest.json\` | File map, SHA-256, \`package_hash\` |
| \`preview.html\` | Preview (links \`theme.css\` when hosted) |

## Live dashboard

Realtime theming uses **D1** (\`cms_themes\`) via \`GET /api/themes/active\`.

## Static embed

\`\`\`html
<link rel="stylesheet" href="${cssUrl}" />
\`\`\`

Manifest: \`${manifestUrl}\`

## Apply

\`\`\`json
POST /api/themes/apply
{ "theme_slug": "${slug}", "scope": "workspace", "workspace_id": "<id>" }
\`\`\`
`;
}

const PACKAGE_VERSION = 1;

/**
 * @param {{
 *   row: Record<string, unknown>,
 *   publicAssetOrigin?: string,
 *   bucket?: string | null,
 *   preview_model?: Record<string, unknown>,
 * }} opts
 */
export async function buildFullThemePackage(opts) {
  const row = opts.row;
  const slug = String(row.slug || "").trim();
  const variables = computeThemeVariablesFromRow(row);
  const theme_css = buildCompiledCss(slug, variables);

  const css_hash = await sha256Hex(theme_css);
  const source_hash = await computeCmsThemeSourceHash(row);

  const bucket = opts.bucket != null ? String(opts.bucket) : null;
  const assetOrigin = String(opts.publicAssetOrigin || "").replace(/\/$/, "");
  const css_r2_key = `cms/themes/${slug}/theme.css`;
  const css_url = assetOrigin ? `${assetOrigin}/${css_r2_key}` : css_r2_key;
  const public_base = assetOrigin ? `${assetOrigin}/cms/themes/${slug}/` : `cms/themes/${slug}/`;

  const preview_model =
    opts.preview_model && typeof opts.preview_model === "object"
      ? opts.preview_model
      : {};

  const tokens = buildCanonicalThemeTokens(row, variables, preview_model);
  const monaco_json = buildMonacoJsonString(row, variables);
  const preview_html = buildPreviewHtml({
    slug,
    name: row.name != null ? String(row.name) : slug,
    preview_model,
    themeCssAbsoluteUrl: css_url,
  });
  const readme_md = buildReadmeMarkdown({
    slug,
    name: row.name != null ? String(row.name) : slug,
    cssUrl: css_url,
  });

  const h_monaco = await sha256Hex(monaco_json);
  const h_preview = await sha256Hex(preview_html);
  const h_readme = await sha256Hex(readme_md);

  /** package_hash excludes theme.json + manifest.json to avoid circular metadata */
  const package_hash = await computeCmsThemePackageHash({
    slug,
    source_hash,
    package_version: PACKAGE_VERSION,
    file_hashes: {
      "theme.css": css_hash,
      "monaco.json": h_monaco,
      "preview.html": h_preview,
      "README.md": h_readme,
    },
  });

  const themeJsonBody = {
    id: row.id,
    name: row.name,
    slug: row.slug,
    theme_family: row.theme_family,
    sort_order: row.sort_order,
    status: row.status,
    visibility: row.visibility,
    monaco_theme: row.monaco_theme,
    monaco_bg: row.monaco_bg,
    tokens,
    hashes: {
      source_hash,
      css_hash,
      package_hash,
    },
    r2: {
      css_r2_bucket: bucket,
      css_r2_key,
      css_url,
    },
    schema_version: 1,
  };

  const theme_json = `${JSON.stringify(themeJsonBody, null, 2)}\n`;
  const h_theme_json = await sha256Hex(theme_json);

  /** @type {Record<string, string>} */
  const file_hashes = {
    "theme.css": css_hash,
    "theme.json": h_theme_json,
    "monaco.json": h_monaco,
    "preview.html": h_preview,
    "README.md": h_readme,
  };

  const fileMeta = (fname, body, contentType) => {
    const key = `cms/themes/${slug}/${fname}`;
    return {
      r2_key: key,
      url: assetOrigin ? `${assetOrigin}/${key}` : key,
      content_type: contentType,
      sha256: file_hashes[fname] || "",
      bytes: byteLengthUtf8(body),
    };
  };

  const manifest_obj = {
    id: row.id,
    slug,
    name: row.name || slug,
    version: PACKAGE_VERSION,
    generated_at: new Date().toISOString(),
    source_hash,
    css_hash,
    package_hash,
    r2_prefix: `cms/themes/${slug}/`,
    public_base,
    files: {
      "theme.css": fileMeta("theme.css", theme_css, "text/css"),
      "theme.json": fileMeta("theme.json", theme_json, "application/json"),
      "monaco.json": fileMeta("monaco.json", monaco_json, "application/json"),
      "preview.html": fileMeta("preview.html", preview_html, "text/html"),
      "README.md": fileMeta("README.md", readme_md, "text/markdown"),
    },
  };

  const manifest_json = `${JSON.stringify(manifest_obj, null, 2)}\n`;
  const manifest_hash = await sha256Hex(manifest_json);

  return {
    theme_css,
    theme_json,
    monaco_json,
    manifest_json,
    preview_html,
    readme_md,
    css_r2_key,
    css_url,
    compiled_css_hash: css_hash,
    css_r2_bucket: bucket,
    source_hash,
    package_hash,
    file_hashes: {
      ...file_hashes,
      "manifest.json": manifest_hash,
    },
    manifest_obj,
    preview_model,
    public_base,
    version_prefix: `cms/themes/${slug}/versions/${source_hash}`,
  };
}

/** @param {string} s */
function byteLengthUtf8(s) {
  return new TextEncoder().encode(s).length;
}
