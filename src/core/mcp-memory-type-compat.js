/**
 * Managed memory type normalization — canonical policy/state + temporary connector compat.
 */

import { MANAGED_MEMORY_TYPES as CONTRACT_MANAGED_TYPES } from './agentsam-memory-contract.js';

/** @deprecated import from agentsam-memory-contract.js — re-export for compat */
export const MANAGED_MEMORY_TYPES = CONTRACT_MANAGED_TYPES;

const LEGACY_MANAGED_TYPES = new Set([
  'fact',
  'preference',
  'project',
  'skill',
  'error',
  'decision',
]);

/**
 * @param {unknown} raw
 * @returns {string}
 */
function normType(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase();
}

/**
 * @param {unknown} tags
 * @returns {string[]}
 */
export function normalizeMemoryTags(tags) {
  if (Array.isArray(tags)) {
    return [...new Set(tags.map((t) => String(t).trim()).filter(Boolean))];
  }
  if (typeof tags === 'string') {
    try {
      const parsed = JSON.parse(tags);
      if (Array.isArray(parsed)) return normalizeMemoryTags(parsed);
    } catch {
      return tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    }
  }
  return [];
}

/**
 * Resolve memory_type for private managed memory writes.
 *
 * - Canonical: policy, state, fact, …
 * - Compat IN: decision + tag "policy" → policy; project + tag "state" → state
 * - Compat OUT (legacySchemaOnly): policy → decision + tag policy; state → project + tag state
 *
 * @param {Record<string, unknown>} input
 * @param {{ legacySchemaOnly?: boolean }} [opts]
 */
export function resolveManagedMemoryType(input = {}, opts = {}) {
  const legacySchemaOnly = Boolean(opts.legacySchemaOnly);
  let memoryType = normType(input.memory_type ?? input.memoryType ?? 'fact');
  let tags = normalizeMemoryTags(input.tags);

  if (!memoryType || memoryType === 'fact') {
    if (tags.includes('policy')) memoryType = 'policy';
    else if (tags.includes('state')) memoryType = 'state';
  }

  if (memoryType === 'decision' && tags.includes('policy')) {
    memoryType = 'policy';
    tags = tags.filter((t) => t !== 'policy');
  }
  if (memoryType === 'project' && tags.includes('state')) {
    memoryType = 'state';
    tags = tags.filter((t) => t !== 'state');
  }

  let compatMapped = false;

  if (legacySchemaOnly && (memoryType === 'policy' || memoryType === 'state')) {
    if (memoryType === 'policy') {
      memoryType = 'decision';
      if (!tags.includes('policy')) tags.push('policy');
    } else {
      memoryType = 'project';
      if (!tags.includes('state')) tags.push('state');
    }
    compatMapped = true;
  }

  if (!MANAGED_MEMORY_TYPES.includes(memoryType)) {
    memoryType = 'fact';
  }

  return { memory_type: memoryType, tags, compat_mapped: compatMapped };
}

/**
 * @param {string} memoryType
 */
export function isLegacyManagedMemoryType(memoryType) {
  return LEGACY_MANAGED_TYPES.has(normType(memoryType));
}
