/**
 * Canonical CMS editable-field registry.
 *
 * The registry owns portable field vocabulary and value coercion only. It must
 * not know about D1, R2, React, customer sites, or section HTML fragments.
 */

export const CMS_FIELD_KINDS = Object.freeze([
  'text',
  'textarea',
  'richtext',
  'number',
  'boolean',
  'json',
  'asset',
  'link',
  'select',
]);

const FIELD_KIND_SET = new Set(CMS_FIELD_KINDS);

/** @type {Map<string, Readonly<Record<string, unknown>>>} */
const fieldTypes = new Map();

function assertFieldTypeId(id) {
  const value = String(id || '').trim();
  if (!value) throw new TypeError('CMS field type id is required');
  return value;
}

/**
 * Register a portable field type.
 * @param {string} id
 * @param {{ kind?: string, label?: string, coerce?: (value: unknown, current?: unknown) => unknown, [key: string]: unknown }} definition
 */
export function registerCmsFieldType(id, definition = {}) {
  const fieldType = assertFieldTypeId(id);
  const kind = String(definition.kind || fieldType);
  if (!FIELD_KIND_SET.has(kind)) throw new TypeError(`Unsupported CMS field kind: ${kind}`);
  if (fieldTypes.has(fieldType)) throw new Error(`CMS field type already registered: ${fieldType}`);
  const frozen = Object.freeze({ id: fieldType, ...definition, kind });
  fieldTypes.set(fieldType, frozen);
  return frozen;
}

/** @param {string} id */
export function getCmsFieldType(id) {
  return fieldTypes.get(String(id || '').trim()) || null;
}

export function listCmsFieldTypes() {
  return Array.from(fieldTypes.values());
}

/**
 * Infer a portable editor field kind from a stored value.
 * @param {unknown} value
 */
export function inferCmsFieldKind(value) {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value) || (value && typeof value === 'object')) return 'json';
  return 'text';
}

/**
 * Coerce a string/editor value while preserving the current stored type.
 * @param {unknown} raw
 * @param {unknown} current
 */
export function coerceCmsFieldValue(raw, current) {
  if (typeof current === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    const normalized = String(raw ?? '').trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off' || normalized === '') return false;
    return Boolean(raw);
  }
  if (typeof current === 'number') {
    const number = Number(raw);
    return Number.isFinite(number) ? number : raw;
  }
  if (Array.isArray(current) || (current && typeof current === 'object')) {
    if (typeof raw !== 'string') return raw;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw == null ? '' : String(raw);
}

/**
 * Convert a nested data object into editor rows.
 * @param {unknown} data
 * @param {{ maxDepth?: number, omitKeys?: Set<string> }} [opts]
 * @returns {Array<{ path: string, label: string, value: string, kind: string }>}
 */
export function flattenCmsFields(data, opts = {}) {
  const maxDepth = Number(opts.maxDepth ?? 3);
  const omitKeys = opts.omitKeys || new Set();
  const rows = [];
  const root = data && typeof data === 'object' ? data : {};

  /** @param {Record<string, unknown>} obj @param {string} prefix @param {number} depth */
  const walk = (obj, prefix, depth) => {
    for (const [key, value] of Object.entries(obj)) {
      if (omitKeys.has(key) || value == null) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      const label = path.replace(/\./g, ' · ').replace(/_/g, ' ');
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        rows.push({ path, label, value: String(value), kind: inferCmsFieldKind(value) });
        continue;
      }
      if (Array.isArray(value)) {
        rows.push({ path, label, value: JSON.stringify(value, null, 2), kind: 'json' });
        continue;
      }
      if (typeof value === 'object' && depth < maxDepth) {
        walk(/** @type {Record<string, unknown>} */ (value), path, depth + 1);
      }
    }
  };

  walk(/** @type {Record<string, unknown>} */ (root), '', 0);
  return rows;
}

/**
 * Apply path-based editor values to a nested object while preserving existing types.
 * @param {Record<string, unknown>} base
 * @param {Record<string, unknown>} edits
 */
export function applyCmsFieldValues(base, edits) {
  const out = JSON.parse(JSON.stringify(base || {}));
  for (const [path, raw] of Object.entries(edits || {})) {
    if (!path) continue;
    const parts = path.split('.');
    let cursor = out;
    for (let index = 0; index < parts.length - 1; index++) {
      const part = parts[index];
      if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) cursor[part] = {};
      cursor = cursor[part];
    }
    const leaf = parts[parts.length - 1];
    cursor[leaf] = coerceCmsFieldValue(raw, cursor[leaf]);
  }
  return out;
}

for (const kind of CMS_FIELD_KINDS) {
  registerCmsFieldType(kind, { kind, label: kind.replace(/_/g, ' ') });
}
