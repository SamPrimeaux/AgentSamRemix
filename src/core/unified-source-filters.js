/**
 * Whitelisted `public.documents.source` facets for unified-search (SQL fragments are static — no user text).
 * Ingest prefixes today include: docs:*, d1:*, tenant course prefixes, manual_*, etc.
 */

/** @type {readonly string[]} */
export const ALLOWED_SOURCE_FILTERS = Object.freeze([
  'all',
  'docs',
  'd1',
  'commands',
  'rules',
  'guardrails',
  'memory',
  'codebase',
  'scripts',
  /** Cmd+K structural facets (handled in unified-search.js, not pgvector source paths). */
  'workspace',
  'branch',
  'repo',
]);

/**
 * @param {unknown} input
 * @returns {string[]} normalized ids (empty = no extra source clause = search all sources)
 */
export function normalizeSourceFilters(input) {
  const raw = Array.isArray(input) ? input : [];
  const set = new Set(
    raw
      .map((x) => String(x || '').toLowerCase().trim())
      .filter((x) => ALLOWED_SOURCE_FILTERS.includes(x)),
  );
  if (set.has('all') || set.size === 0) return [];
  set.delete('all');
  return [...set];
}

/**
 * Returns a static SQL fragment AND (...) or empty string.
 * Only ORs together chosen facets; each facet maps to fixed LIKE patterns on `source`.
 *
 * @param {string[]} normalizedIds from normalizeSourceFilters
 */
export function documentsSourceFilterSql(normalizedIds) {
  if (!normalizedIds.length) return '';

  const ors = [];

  for (const id of normalizedIds) {
    switch (id) {
      case 'docs':
        ors.push("(source LIKE 'docs:%')");
        break;
      case 'd1':
        ors.push("(source LIKE 'd1:%')");
        break;
      case 'commands':
        ors.push("(source ILIKE 'd1:commands%')");
        break;
      case 'rules':
        ors.push("(source ILIKE 'd1:%rule%' OR source ILIKE '%agent_rules%')");
        break;
      case 'guardrails':
        ors.push("(source ILIKE '%guardrails%' OR source ILIKE 'd1:guardrails%')");
        break;
      case 'memory':
        ors.push("(source ILIKE '%project_memory%' OR source ILIKE 'd1:project_memory%')");
        break;
      case 'codebase':
        ors.push("(source ILIKE 'codebase:%' OR source ILIKE 'repo:%' OR source ILIKE 'git:%')");
        break;
      case 'scripts':
        ors.push("(source LIKE 'connor%' OR source LIKE 'manual_%')");
        break;
      default:
        break;
    }
  }

  if (!ors.length) return '';
  return ` AND (${ors.join(' OR ')})`;
}
