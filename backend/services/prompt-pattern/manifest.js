/**
 * PromptManifest — stable-prefix identity for provider cache economics.
 * pattern_hash hashes ordered stable fragments only (never tenant/model/task/mode).
 */

import { PROMPT_PATTERN_CONTRACT_VERSION } from './contract.js';

export { PROMPT_PATTERN_CONTRACT_VERSION, VOLATILE_PROMPT_LAYER_KEYS } from './contract.js';

/**
 * @param {string} text
 */
export async function hashPromptContent(text) {
  const raw = String(text || '');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * @param {Array<{ layer_key?: string, prompt_version_id?: string|null, prompt_hash?: string|null, content_hash?: string|null }>} stableFragments
 */
export async function computePromptPatternHash(stableFragments) {
  const parts = (stableFragments || [])
    .map((f) => {
      const layer = String(f.layer_key || '').trim();
      const vid = String(f.prompt_version_id || '').trim();
      const ph = String(f.prompt_hash || f.content_hash || '').trim();
      if (!layer || !ph) return '';
      if (vid) return `${layer}:${vid}:${ph}`;
      return `${layer}:${ph}`;
    })
    .filter(Boolean);
  const payload = `${PROMPT_PATTERN_CONTRACT_VERSION}|${parts.join('|')}`;
  return hashPromptContent(payload);
}

/**
 * @param {{
 *   routeKey?: string|null,
 *   taskType?: string|null,
 *   mode?: string|null,
 *   stableFragments?: Array<Record<string, unknown>>,
 *   volatileFragments?: Array<Record<string, unknown>>,
 *   prefixTokens?: number,
 *   cacheableTokens?: number,
 * }} input
 */
export async function compilePromptManifest(input = {}) {
  const stable_prefix = Array.isArray(input.stableFragments) ? input.stableFragments : [];
  const volatile_suffix = Array.isArray(input.volatileFragments) ? input.volatileFragments : [];
  const pattern_hash = await computePromptPatternHash(stable_prefix);

  return {
    contract_version: PROMPT_PATTERN_CONTRACT_VERSION,
    route_key: input.routeKey != null ? String(input.routeKey).trim() || null : null,
    task_type: input.taskType != null ? String(input.taskType).trim() || null : null,
    mode: input.mode != null ? String(input.mode).trim() || null : null,
    stable_prefix,
    volatile_suffix,
    pattern_hash,
    layer_keys_json: stable_prefix.map((f) => String(f.layer_key || '').trim()).filter(Boolean),
    fragment_hashes_json: stable_prefix
      .map((f) => String(f.prompt_hash || f.content_hash || '').trim())
      .filter(Boolean),
    prompt_version_ids_json: stable_prefix
      .map((f) => String(f.prompt_version_id || '').trim())
      .filter(Boolean),
    prefix_tokens: Math.max(0, Math.floor(Number(input.prefixTokens) || 0)),
    cacheable_tokens: Math.max(0, Math.floor(Number(input.cacheableTokens) || 0)),
  };
}

/**
 * @param {Record<string, unknown>} manifest
 * @param {Array<{ layer_key: string, content?: string|null, content_hash?: string|null }>} blocks
 */
export async function augmentPromptManifestVolatile(manifest, blocks = []) {
  if (!manifest || typeof manifest !== 'object') return manifest;
  const volatile_suffix = Array.isArray(manifest.volatile_suffix) ? [...manifest.volatile_suffix] : [];
  for (const block of blocks || []) {
    const layer_key = String(block.layer_key || '').trim();
    if (!layer_key) continue;
    let content_hash = block.content_hash != null ? String(block.content_hash).trim() : '';
    if (!content_hash && block.content) {
      content_hash = await hashPromptContent(String(block.content));
    }
    if (!content_hash) continue;
    volatile_suffix.push({ layer_key, content_hash, volatile: true });
  }
  return { ...manifest, volatile_suffix };
}

/**
 * @param {Record<string, { cacheReadTokens?: number, savingsUsd?: number, observations?: number }>} stats
 * @param {string} patternHash
 * @param {{ cacheReadTokens?: number, savingsUsd?: number }} delta
 */
export function recordRunPromptPatternStats(stats, patternHash, delta = {}) {
  const hash = String(patternHash || '').trim();
  if (!hash) return stats;
  const prev = stats[hash] || { cacheReadTokens: 0, savingsUsd: 0, observations: 0 };
  stats[hash] = {
    cacheReadTokens: prev.cacheReadTokens + Math.max(0, Math.floor(Number(delta.cacheReadTokens) || 0)),
    savingsUsd: prev.savingsUsd + Math.max(0, Number(delta.savingsUsd) || 0),
    observations: prev.observations + 1,
  };
  return stats;
}

/**
 * @param {Record<string, { cacheReadTokens?: number, savingsUsd?: number }>} stats
 */
export function resolveDominantPromptPatternHash(stats) {
  let best = '';
  let bestRead = -1;
  let bestSave = -1;
  for (const [hash, row] of Object.entries(stats || {})) {
    const reads = Math.max(0, Math.floor(Number(row.cacheReadTokens) || 0));
    const save = Math.max(0, Number(row.savingsUsd) || 0);
    if (reads > bestRead || (reads === bestRead && save > bestSave)) {
      best = hash;
      bestRead = reads;
      bestSave = save;
    }
  }
  return best || null;
}
