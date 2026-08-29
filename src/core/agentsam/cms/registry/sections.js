/**
 * Canonical CMS section-definition registry.
 *
 * Portable content-model vocabulary only — no D1, R2, React, or host identity.
 */

import { getCmsFieldType } from './fields.js';
import { getCmsBlock } from './blocks.js';

/** @type {Map<string, Readonly<Record<string, unknown>>>} */
const sections = new Map();

/**
 * @param {string} type
 * @param {number} [version]
 */
export function cmsSectionSchemaKey(type, version = 1) {
  const t = String(type || '').trim();
  if (!t) throw new TypeError('CMS section type is required');
  const v = Number(version);
  if (!Number.isInteger(v) || v < 1) throw new TypeError(`CMS section version must be a positive integer: ${version}`);
  return `${t}@${v}`;
}

/**
 * @param {{
 *   type: string,
 *   version?: number,
 *   label?: string,
 *   fields?: Record<string, { type: string, required?: boolean, label?: string, [key: string]: unknown }>,
 *   allowedBlocks?: string[],
 *   defaults?: Record<string, unknown>,
 *   capabilities?: { editable?: boolean, reorderable?: boolean, duplicable?: boolean, [key: string]: unknown },
 *   [key: string]: unknown,
 * }} definition
 */
export function registerCmsSection(definition = {}) {
  const type = String(definition.type || '').trim();
  if (!type) throw new TypeError('CMS section type is required');
  const version = Number.isInteger(Number(definition.version)) ? Number(definition.version) : 1;
  if (version < 1) throw new TypeError(`CMS section version must be >= 1: ${version}`);
  const key = cmsSectionSchemaKey(type, version);
  if (sections.has(key)) throw new Error(`CMS section already registered: ${key}`);

  const fields = freezeFieldMap(definition.fields || {});
  const allowedBlocks = Object.freeze(
    (Array.isArray(definition.allowedBlocks) ? definition.allowedBlocks : []).map((id) => {
      const blockType = String(id || '').trim();
      if (!blockType) throw new TypeError(`CMS section ${type} has empty allowedBlocks entry`);
      return blockType;
    }),
  );
  for (const blockType of allowedBlocks) {
    if (!getCmsBlock(blockType, 1)) {
      throw new TypeError(`CMS section ${type} references unregistered block type: ${blockType}`);
    }
  }

  const defaults = Object.freeze({ ...(definition.defaults || {}) });
  const capabilities = Object.freeze({
    editable: definition.capabilities?.editable !== false,
    reorderable: definition.capabilities?.reorderable !== false,
    duplicable: definition.capabilities?.duplicable !== false,
    ...(definition.capabilities || {}),
  });

  const frozen = Object.freeze({
    kind: 'section',
    key,
    type,
    version,
    label: String(definition.label || type),
    fields,
    allowedBlocks,
    defaults,
    capabilities,
  });
  sections.set(key, frozen);
  return frozen;
}

/** @param {string} type @param {number} [version] */
export function getCmsSection(type, version = 1) {
  return sections.get(cmsSectionSchemaKey(type, version)) || null;
}

/** @param {string} type */
export function listCmsSectionVersions(type) {
  const want = String(type || '').trim();
  return Array.from(sections.values())
    .filter((row) => row.type === want)
    .sort((a, b) => a.version - b.version);
}

export function listCmsSections() {
  return Array.from(sections.values()).sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

/** @param {Record<string, { type: string, [key: string]: unknown }>} fields */
function freezeFieldMap(fields) {
  /** @type {Record<string, Readonly<Record<string, unknown>>>} */
  const out = {};
  for (const [name, def] of Object.entries(fields || {})) {
    const fieldName = String(name || '').trim();
    if (!fieldName) throw new TypeError('CMS section field name is required');
    const fieldType = String(def?.type || '').trim();
    if (!fieldType) throw new TypeError(`CMS section field type required for ${fieldName}`);
    if (!getCmsFieldType(fieldType)) {
      throw new TypeError(`Unknown CMS field type in section field ${fieldName}: ${fieldType}`);
    }
    out[fieldName] = Object.freeze({ ...def, type: fieldType, required: def.required === true });
  }
  return Object.freeze(out);
}
