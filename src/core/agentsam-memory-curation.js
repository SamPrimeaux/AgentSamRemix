/**
 * Shared memory curation constants — noise sources are not curated recall.
 * SSOT: tkt_agentsam_memory_curation_2026_07
 */

export const MEMORY_NOISE_SOURCES = Object.freeze([
  'post_deploy_hook',
  'daily_memory_pipeline',
]);

/**
 * SQL fragment: exclude deploy/digest automation from default recall.
 * @param {string} [column='source']
 */
export function memoryExcludeNoiseSourcesSql(column = 'source') {
  const col = String(column || 'source').replace(/[^a-zA-Z0-9_.]/g, '') || 'source';
  return `(${col} IS NULL OR ${col} NOT IN ('post_deploy_hook','daily_memory_pipeline'))`;
}

/**
 * @param {Record<string, unknown>} args
 */
export function wantsMemoryNoiseSources(args = {}) {
  return (
    args.include_deploy_noise === true ||
    args.include_noise_sources === true ||
    String(args.include_deploy_noise || '').trim() === '1' ||
    String(args.include_noise_sources || '').trim() === '1'
  );
}
