import { flattenCmsFields } from '../registry/index.js';

/**
 * CMS section_data editor helpers — D1 typed fields only; markup lives on R2.
 *
 * Generic field discovery lives in ../registry. This module preserves the
 * section/R2 compatibility contract used by existing API and editor callers.
 */

export const CMS_SECTION_INJECT_META_KEYS = new Set([
  'r2_key',
  'r2_bucket',
  'public_url',
  'html_source',
  'inject_position',
  'content_sha256',
  'updated_at',
  'full_page_document',
  'zone',
  'raw',
  'role',
]);

const BLOB_KEYS = new Set(['html', 'css', 'js', 'body_html', 'content_html']);
const OMIT_EDITOR_KEYS = new Set([...CMS_SECTION_INJECT_META_KEYS, ...BLOB_KEYS]);

/** Max JSON bytes for typed section_data pointers kept alongside R2 draft artifacts (Outcome 3a). */
export const CMS_SECTION_D1_MAX_BYTES = 4096;

export class CmsSectionDataGuardError extends Error {
  /**
   * @param {string} code
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, details = {}) {
    super(code);
    this.name = 'CmsSectionDataGuardError';
    this.code = code;
    this.details = details;
  }
}

/**
 * @param {unknown} data
 * @param {{ maxDepth?: number }} [opts]
 * @returns {Array<{ path: string, label: string, value: string, kind: 'scalar' | 'json' }>}
 */
export function flattenSectionDataForEditor(data, opts = {}) {
  return flattenCmsFields(data, { maxDepth: opts.maxDepth, omitKeys: OMIT_EDITOR_KEYS }).map((row) => ({
    path: row.path,
    label: row.label,
    value: row.value,
    kind: row.kind === 'json' ? 'json' : 'scalar',
  }));
}

/**
 * Existing section compatibility writer. Canonical registry writers preserve
 * primitive types, while this function intentionally retains the historical
 * section editor contract until the HTTP/editor migration is complete.
 * @param {Record<string, unknown>} base
 * @param {Record<string, string>} edits path → value
 */
export function applyEditorFieldValues(base, edits) {
  const out = JSON.parse(JSON.stringify(base || {}));
  for (const [path, raw] of Object.entries(edits || {})) {
    if (!path) continue;
    const parts = path.split('.');
    let cursor = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!cursor[p] || typeof cursor[p] !== 'object' || Array.isArray(cursor[p])) {
        cursor[p] = {};
      }
      cursor = cursor[p];
    }
    const leaf = parts[parts.length - 1];
    const existing = cursor[leaf];
    if (Array.isArray(existing) || (existing && typeof existing === 'object')) {
      try {
        cursor[leaf] = JSON.parse(raw);
      } catch {
        cursor[leaf] = raw;
      }
    } else {
      cursor[leaf] = raw;
    }
  }
  return out;
}

/**
 * Extract editable copy markers from R2 fragment HTML.
 * @param {string} html
 * @returns {Array<{ path: string, label: string, value: string, kind: 'fragment' }>}
 */
export function extractCmsFieldMarkersFromHtml(html) {
  const raw = String(html || '');
  if (!raw.trim()) return [];
  const rows = [];
  const seen = new Set();
  const re =
    /<([a-z][a-z0-9]*)[^>]*\sdata-cms-(?:field|editable)=["']([^"']+)["'][^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(raw))) {
    const path = String(m[2] || '').trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const value = String(m[3] || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    rows.push({
      path: `fragment.${path}`,
      label: `Fragment · ${path.replace(/_/g, ' ')}`,
      value,
      kind: 'fragment',
    });
  }
  return rows;
}

/**
 * Apply fragment field edits back into HTML (data-cms-field markers).
 * @param {string} html
 * @param {Record<string, string>} fragmentEdits keys without fragment. prefix
 */
export function applyCmsFieldValuesToHtml(html, fragmentEdits) {
  let out = String(html || '');
  for (const [field, value] of Object.entries(fragmentEdits || {})) {
    if (!field) continue;
    const esc = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
      `(<[a-z][a-z0-9]*[^>]*\\sdata-cms-(?:field|editable)=["']${esc}["'][^>]*>)([\\s\\S]*?)(</[a-z][a-z0-9]*>)`,
      'i',
    );
    out = out.replace(re, `$1${String(value ?? '')}$3`);
  }
  return out;
}

/**
 * Strip markup blobs from section_data before D1 write.
 * @param {Record<string, unknown>} data
 */
export function normalizeSectionDataForWrite(data) {
  const out = { ...(data || {}) };
  for (const k of BLOB_KEYS) delete out[k];
  return out;
}

/**
 * Fail loud when section_data would violate the D1 pointer contract (Outcome 3a).
 * Markup belongs in R2 draft artifacts; D1 rows store `{}` plus R2 key columns.
 *
 * @param {Record<string, unknown>} data
 * @returns {Record<string, unknown>}
 */
export function assertSectionDataD1Writable(data) {
  const input = data && typeof data === 'object' ? data : {};
  for (const key of BLOB_KEYS) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      throw new CmsSectionDataGuardError('section_data_blob_forbidden', {
        key,
        hint: 'Store markup in R2 section draft artifacts only',
      });
    }
  }
  const normalized = normalizeSectionDataForWrite(input);
  const bytes = new TextEncoder().encode(JSON.stringify(normalized)).length;
  if (bytes > CMS_SECTION_D1_MAX_BYTES) {
    throw new CmsSectionDataGuardError('section_data_exceeds_d1_ceiling', {
      bytes,
      max_bytes: CMS_SECTION_D1_MAX_BYTES,
      hint: 'Typed section fields exceed D1 ceiling — use R2 section draft artifacts',
    });
  }
  return normalized;
}
