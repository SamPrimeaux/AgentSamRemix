/**
 * Deterministic SHA-256 helpers for CMS theme packages (Workers + Node).
 */

/** @param {unknown} v */
export function sortedStringify(v) {
  return JSON.stringify(sortDeep(v));
}

/** @param {unknown} x */
function sortDeep(x) {
  if (x === null || typeof x !== "object") return x;
  if (Array.isArray(x)) return x.map(sortDeep);
  const out = {};
  for (const k of Object.keys(x).sort()) {
    out[k] = sortDeep(x[k]);
  }
  return out;
}

/**
 * SHA-256 hex for UTF-8 string or Uint8Array (Web Crypto preferred).
 * @param {string | Uint8Array} input
 */
export async function sha256Hex(input) {
  const buf = typeof input === "string" ? new TextEncoder().encode(input) : input;
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("Web Crypto SHA-256 unavailable");
  }
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Canonical source payload for source_hash (exclude timestamps / metadata).
 * @param {Record<string, unknown>} row — cms_themes row
 */
export function buildSourcePayloadFromRow(row) {
  const cfg = normalizeJsonField(row?.config);
  const cssVars =
    cfg && typeof cfg === "object" && cfg.cssVars && typeof cfg.cssVars === "object"
      ? /** @type {Record<string, unknown>} */ (cfg.cssVars)
      : {};

  const pick = (k) => (row?.[k] != null ? String(row[k]) : "");

  const tok = normalizeJsonField(row?.tokens_json);
  const tokensSansMeta = stripPackageMetaFromTokens(tok);

  return {
    config: cfg && typeof cfg === "object" ? stripTransientFromConfig(cfg) : {},
    cssVars,
    tokens_json: tokensSansMeta,
    css_vars_json: normalizeJsonField(row?.css_vars_json),
    brand_json: normalizeJsonField(row?.brand_json),
    layout_json: normalizeJsonField(row?.layout_json),
    typography_json: normalizeJsonField(row?.typography_json),
    components_json: normalizeJsonField(row?.components_json),
    motion_json: normalizeJsonField(row?.motion_json),
    monaco_theme_data: normalizeJsonField(row?.monaco_theme_data),
    slug: pick("slug"),
    id: pick("id"),
  };
}

/** @param {unknown} raw */
function normalizeJsonField(raw) {
  if (raw == null) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

/** @param {Record<string, unknown>} cfg */
function stripTransientFromConfig(cfg) {
  const { package_meta, ...rest } = cfg;
  void package_meta;
  return rest;
}

/** Remove volatile package_meta from tokens_json before source_hash. */
function stripPackageMetaFromTokens(tok) {
  if (tok == null) return null;
  if (typeof tok !== "object" || Array.isArray(tok)) return tok;
  const { package_meta, ...rest } = /** @type {Record<string, unknown>} */ (tok);
  void package_meta;
  return rest;
}

/**
 * @param {Record<string, unknown>} row
 */
export async function computeSourceHash(row) {
  const payload = buildSourcePayloadFromRow(row);
  return sha256Hex(sortedStringify(payload));
}

/**
 * Deterministic package fingerprint (no timestamps).
 * @param {{
 *   slug: string,
 *   source_hash: string,
 *   package_version: number,
 *   file_hashes: Record<string, string>,
 * }} p
 */
export async function computePackageHash(p) {
  const body = {
    slug: String(p.slug || "").trim(),
    source_hash: p.source_hash,
    package_version: p.package_version,
    files: sortDeep(p.file_hashes),
  };
  return sha256Hex(sortedStringify(body));
}
