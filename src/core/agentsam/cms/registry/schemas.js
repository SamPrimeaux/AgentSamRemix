/**
 * Unified CMS schema lookup (field / section / block definitions).
 */

import { getCmsFieldType, listCmsFieldTypes } from './fields.js';
import { getCmsBlock, listCmsBlocks, cmsBlockSchemaKey } from './blocks.js';
import { getCmsSection, listCmsSections, cmsSectionSchemaKey } from './sections.js';

/**
 * @param {'section'|'block'|'field'} kind
 * @param {string} type
 * @param {number} [version]
 */
export function getCmsSchema(kind, type, version = 1) {
  const k = String(kind || '').trim();
  if (k === 'field') return getCmsFieldType(type);
  if (k === 'block') return getCmsBlock(type, version);
  if (k === 'section') return getCmsSection(type, version);
  throw new TypeError(`Unknown CMS schema kind: ${kind}`);
}

/**
 * @param {'section'|'block'} kind
 * @param {string} type
 * @param {number} [version]
 */
export function cmsSchemaKey(kind, type, version = 1) {
  if (kind === 'block') return cmsBlockSchemaKey(type, version);
  if (kind === 'section') return cmsSectionSchemaKey(type, version);
  throw new TypeError(`cmsSchemaKey supports section|block only: ${kind}`);
}

/** Manifest of every registered content-model schema (no host identity). */
export function buildCmsSchemaManifest() {
  return Object.freeze({
    protocol_version: 1,
    fields: listCmsFieldTypes(),
    sections: listCmsSections(),
    blocks: listCmsBlocks(),
  });
}

export function listCmsSchemas() {
  return [
    ...listCmsFieldTypes().map((row) => ({ kind: 'field', id: row.id, schema: row })),
    ...listCmsSections().map((row) => ({ kind: 'section', id: row.key, schema: row })),
    ...listCmsBlocks().map((row) => ({ kind: 'block', id: row.key, schema: row })),
  ];
}
