/**
 * Validate CMS content data against a registered section/block schema.
 */

import { getCmsBlock } from './blocks.js';
import { getCmsSection } from './sections.js';

/**
 * @param {'section'|'block'} kind
 * @param {string} type
 * @param {unknown} data
 * @param {{
 *   version?: number,
 *   strict?: boolean,
 *   blockTypes?: string[],
 * }} [opts]
 * @returns {{ ok: true, data: Record<string, unknown>, schema: object } | { ok: false, error: string, issues: Array<{ path: string, code: string, message: string }> }}
 */
export function validateCmsContent(kind, type, data, opts = {}) {
  const version = Number.isInteger(Number(opts.version)) ? Number(opts.version) : 1;
  const strict = opts.strict !== false;
  const schema = kind === 'block' ? getCmsBlock(type, version) : getCmsSection(type, version);
  if (!schema) {
    return {
      ok: false,
      error: 'schema_not_found',
      issues: [{ path: '', code: 'schema_not_found', message: `No ${kind} schema for ${type}@${version}` }],
    };
  }

  const value = data && typeof data === 'object' && !Array.isArray(data)
    ? /** @type {Record<string, unknown>} */ (data)
    : {};
  /** @type {Array<{ path: string, code: string, message: string }>} */
  const issues = [];
  const fieldDefs = /** @type {Record<string, { type: string, required?: boolean }>} */ (schema.fields || {});

  for (const [name, def] of Object.entries(fieldDefs)) {
    const present = Object.prototype.hasOwnProperty.call(value, name);
    const raw = value[name];
    if (def.required && (!present || raw == null || raw === '')) {
      issues.push({ path: name, code: 'required', message: `Field ${name} is required` });
      continue;
    }
    if (!present || raw == null) continue;
    const typeIssue = checkFieldValue(name, def.type, raw);
    if (typeIssue) issues.push(typeIssue);
  }

  if (strict) {
    for (const name of Object.keys(value)) {
      if (!Object.prototype.hasOwnProperty.call(fieldDefs, name)) {
        issues.push({ path: name, code: 'unknown_field', message: `Unknown field ${name}` });
      }
    }
  }

  if (kind === 'section' && Array.isArray(opts.blockTypes)) {
    const allowed = new Set(/** @type {string[]} */ (schema.allowedBlocks || []));
    for (const [index, blockType] of opts.blockTypes.entries()) {
      const bt = String(blockType || '').trim();
      if (!bt) {
        issues.push({ path: `blocks[${index}]`, code: 'block_type_required', message: 'Block type is required' });
        continue;
      }
      if (allowed.size > 0 && !allowed.has(bt)) {
        issues.push({
          path: `blocks[${index}]`,
          code: 'block_not_allowed',
          message: `Block type ${bt} is not allowed on section ${schema.type}`,
        });
      }
    }
  }

  if (issues.length) {
    return { ok: false, error: 'validation_failed', issues };
  }
  return { ok: true, data: value, schema };
}

/**
 * @param {string} path
 * @param {string} fieldType
 * @param {unknown} raw
 */
function checkFieldValue(path, fieldType, raw) {
  switch (fieldType) {
    case 'text':
    case 'textarea':
    case 'richtext':
    case 'select':
      if (typeof raw !== 'string') {
        return { path, code: 'type_mismatch', message: `${path} must be a string (${fieldType})` };
      }
      return null;
    case 'number':
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return { path, code: 'type_mismatch', message: `${path} must be a finite number` };
      }
      return null;
    case 'boolean':
      if (typeof raw !== 'boolean') {
        return { path, code: 'type_mismatch', message: `${path} must be a boolean` };
      }
      return null;
    case 'link':
      if (typeof raw === 'string') return null;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) return null;
      return { path, code: 'type_mismatch', message: `${path} must be a string or link object` };
    case 'asset':
      if (typeof raw === 'string') return null;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) return null;
      return { path, code: 'type_mismatch', message: `${path} must be a string or asset object` };
    case 'json':
      return null;
    default:
      return { path, code: 'unknown_field_type', message: `Unsupported field type ${fieldType}` };
  }
}
