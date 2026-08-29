/**
 * Canonical CMS block-definition registry.
 *
 * Portable content-model vocabulary only — no D1, R2, React, or host identity.
 */

import { getCmsFieldType } from './fields.js';

/** @type {Map<string, Readonly<Record<string, unknown>>>} */
const blocks = new Map();

/**
 * @param {string} type
 * @param {number} [version]
 */
export function cmsBlockSchemaKey(type, version = 1) {
  const t = String(type || '').trim();
  if (!t) throw new TypeError('CMS block type is required');
  const v = Number(version);
  if (!Number.isInteger(v) || v < 1) throw new TypeError(`CMS block version must be a positive integer: ${version}`);
  return `${t}@${v}`;
}

/**
 * @param {{
 *   type: string,
 *   version?: number,
 *   label?: string,
 *   fields?: Record<string, { type: string, required?: boolean, label?: string, [key: string]: unknown }>,
 *   defaults?: Record<string, unknown>,
 *   capabilities?: { editable?: boolean, reorderable?: boolean, duplicable?: boolean, [key: string]: unknown },
 *   [key: string]: unknown,
 * }} definition
 */
export function registerCmsBlock(definition = {}) {
  const type = String(definition.type || '').trim();
  if (!type) throw new TypeError('CMS block type is required');
  const version = Number.isInteger(Number(definition.version)) ? Number(definition.version) : 1;
  if (version < 1) throw new TypeError(`CMS block version must be >= 1: ${version}`);
  const key = cmsBlockSchemaKey(type, version);
  if (blocks.has(key)) throw new Error(`CMS block already registered: ${key}`);

  const fields = freezeFieldMap(definition.fields || {});
  const defaults = Object.freeze({ ...(definition.defaults || {}) });
  const capabilities = Object.freeze({
    editable: definition.capabilities?.editable !== false,
    reorderable: definition.capabilities?.reorderable !== false,
    duplicable: definition.capabilities?.duplicable !== false,
    ...(definition.capabilities || {}),
  });

  const frozen = Object.freeze({
    kind: 'block',
    key,
    type,
    version,
    label: String(definition.label || type),
    fields,
    defaults,
    capabilities,
  });
  blocks.set(key, frozen);
  return frozen;
}

/** @param {string} type @param {number} [version] */
export function getCmsBlock(type, version = 1) {
  return blocks.get(cmsBlockSchemaKey(type, version)) || null;
}

/** @param {string} type */
export function listCmsBlockVersions(type) {
  const prefix = `${String(type || '').trim()}@`;
  return Array.from(blocks.values())
    .filter((row) => row.type === String(type || '').trim() || String(row.key).startsWith(prefix))
    .sort((a, b) => a.version - b.version);
}

export function listCmsBlocks() {
  return Array.from(blocks.values()).sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

/** @param {Record<string, { type: string, [key: string]: unknown }>} fields */
function freezeFieldMap(fields) {
  /** @type {Record<string, Readonly<Record<string, unknown>>>} */
  const out = {};
  for (const [name, def] of Object.entries(fields || {})) {
    const fieldName = String(name || '').trim();
    if (!fieldName) throw new TypeError('CMS block field name is required');
    const fieldType = String(def?.type || '').trim();
    if (!fieldType) throw new TypeError(`CMS block field type required for ${fieldName}`);
    if (!getCmsFieldType(fieldType)) {
      throw new TypeError(`Unknown CMS field type in block field ${fieldName}: ${fieldType}`);
    }
    out[fieldName] = Object.freeze({ ...def, type: fieldType, required: def.required === true });
  }
  return Object.freeze(out);
}
