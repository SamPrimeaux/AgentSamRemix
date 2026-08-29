/**
 * Durable prompt-pattern economics observations (agentsam_prompt_cache_keys).
 */

import { computePromptCacheInputEconomics } from './pricing.js';
import {
  recordRunPromptPatternStats,
  resolveDominantPromptPatternHash,
} from '../manifest.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function patternRowId(tenantId, patternHash, provider, modelKey) {
  const t = trim(tenantId) || 'global';
  const h = trim(patternHash).slice(0, 16);
  const p = trim(provider).slice(0, 12);
  const m = trim(modelKey).slice(0, 24);
  return `pck_${t}_${h}_${p}_${m}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 120);
}

/**
 * @param {any} env
 * @param {{
 *   manifest: Record<string, unknown>,
 *   tenantId: string,
 *   workspaceId?: string|null,
 *   provider: string,
 *   modelKey: string,
 *   totalInputTokens?: number,
 *   cacheReadTokens?: number,
 *   cacheCreationTokens?: number,
 *   cacheWriteTtl?: string,
 *   agentRunId?: string|null,
 *   runPatternStats?: Record<string, unknown>|null,
 * }} obs
 */
export async function recordPromptCacheObservation(env, obs) {
  if (!env?.DB) return { ok: false, error: 'db_unavailable' };

  const manifest = obs?.manifest;
  const patternHash = trim(manifest?.pattern_hash);
  if (!patternHash) return { ok: false, error: 'pattern_hash_required' };

  const tenantId = trim(obs.tenantId) || 'global';
  const workspaceId = trim(obs.workspaceId) || null;
  const provider = trim(obs.provider) || 'unknown';
  const modelKey = trim(obs.modelKey) || 'unknown';
  const cacheReadTokens = Math.max(0, Math.floor(Number(obs.cacheReadTokens) || 0));
  const cacheCreationTokens = Math.max(0, Math.floor(Number(obs.cacheCreationTokens) || 0));
  const totalInputTokens = Math.max(0, Math.floor(Number(obs.totalInputTokens) || 0));

  if (cacheReadTokens <= 0 && cacheCreationTokens <= 0) {
    return { ok: false, error: 'no_cache_tokens' };
  }

  const econ = await computePromptCacheInputEconomics(env.DB, {
    modelKey,
    provider,
    totalInputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    cacheWriteTtl: obs.cacheWriteTtl,
  });

  const now = Math.floor(Date.now() / 1000);
  const id = patternRowId(tenantId, patternHash, provider, modelKey);
  const layerKeysJson = JSON.stringify(manifest.layer_keys_json || []);
  const fragmentHashesJson = JSON.stringify(manifest.fragment_hashes_json || []);
  const promptVersionIdsJson = JSON.stringify(manifest.prompt_version_ids_json || []);

  try {
    const existing = await env.DB.prepare(
      `SELECT id, status FROM agentsam_prompt_cache_keys
        WHERE tenant_id = ? AND pattern_hash = ? AND provider = ? AND model_key = ?
        LIMIT 1`,
    )
      .bind(tenantId, patternHash, provider, modelKey)
      .first();

    if (existing?.id) {
      await env.DB.prepare(
        `UPDATE agentsam_prompt_cache_keys
            SET observation_count = observation_count + 1,
                cache_write_count = cache_write_count + ?,
                cache_read_count = cache_read_count + ?,
                cache_creation_tokens_total = cache_creation_tokens_total + ?,
                cache_read_tokens_total = cache_read_tokens_total + ?,
                baseline_input_cost_usd = baseline_input_cost_usd + ?,
                actual_input_cost_usd = actual_input_cost_usd + ?,
                cache_creation_cost_usd = cache_creation_cost_usd + ?,
                cache_read_cost_usd = cache_read_cost_usd + ?,
                total_cache_savings_usd = total_cache_savings_usd + ?,
                prefix_token_count = CASE WHEN prefix_token_count < ? THEN ? ELSE prefix_token_count END,
                cacheable_token_count = CASE WHEN cacheable_token_count < ? THEN ? ELSE cacheable_token_count END,
                workspace_id = COALESCE(?, workspace_id),
                route_key = COALESCE(?, route_key),
                task_type = COALESCE(?, task_type),
                mode = COALESCE(?, mode),
                layer_keys_json = ?,
                fragment_hashes_json = ?,
                prompt_version_ids_json = ?,
                provider_cache_last_hit_at_unix = CASE WHEN ? > 0 THEN ? ELSE provider_cache_last_hit_at_unix END,
                last_seen_at_unix = ?,
                updated_at_unix = ?
          WHERE id = ?`,
      )
        .bind(
          cacheCreationTokens > 0 ? 1 : 0,
          cacheReadTokens > 0 ? 1 : 0,
          cacheCreationTokens,
          cacheReadTokens,
          econ.baseline_input_cost_usd,
          econ.actual_input_cost_usd,
          econ.cache_creation_cost_usd,
          econ.cache_read_cost_usd,
          econ.total_cache_savings_usd,
          manifest.prefix_tokens || 0,
          manifest.prefix_tokens || 0,
          manifest.cacheable_tokens || 0,
          manifest.cacheable_tokens || 0,
          workspaceId,
          manifest.route_key || null,
          manifest.task_type || null,
          manifest.mode || null,
          layerKeysJson,
          fragmentHashesJson,
          promptVersionIdsJson,
          cacheReadTokens,
          now,
          now,
          now,
          existing.id,
        )
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO agentsam_prompt_cache_keys (
           id, tenant_id, workspace_id, pattern_hash, pattern_contract_version,
           route_key, task_type, mode,
           layer_keys_json, fragment_hashes_json, prompt_version_ids_json,
           prefix_token_count, cacheable_token_count,
           provider, model_key, cache_strategy,
           observation_count, cache_write_count, cache_read_count,
           cache_creation_tokens_total, cache_read_tokens_total,
           baseline_input_cost_usd, actual_input_cost_usd,
           cache_creation_cost_usd, cache_read_cost_usd, total_cache_savings_usd,
           provider_cache_last_hit_at_unix,
           status, first_seen_at_unix, last_seen_at_unix, created_at_unix, updated_at_unix
         ) VALUES (
           ?,?,?,?,?,
           ?,?,?,
           ?,?,?,
           ?,?,
           ?,?,?,
           ?,?,?,?,
           ?,?,
           ?,?,?,?,
           ?,
           'candidate',?,?,?,?
         )`,
      )
        .bind(
          id,
          tenantId,
          workspaceId,
          patternHash,
          Number(manifest.contract_version) || 1,
          manifest.route_key || null,
          manifest.task_type || null,
          manifest.mode || null,
          layerKeysJson,
          fragmentHashesJson,
          promptVersionIdsJson,
          manifest.prefix_tokens || 0,
          manifest.cacheable_tokens || 0,
          provider,
          modelKey,
          'implicit',
          1,
          cacheCreationTokens > 0 ? 1 : 0,
          cacheReadTokens > 0 ? 1 : 0,
          cacheCreationTokens,
          cacheReadTokens,
          econ.baseline_input_cost_usd,
          econ.actual_input_cost_usd,
          econ.cache_creation_cost_usd,
          econ.cache_read_cost_usd,
          econ.total_cache_savings_usd,
          cacheReadTokens > 0 ? now : null,
          now,
          now,
          now,
          now,
        )
        .run();
    }
  } catch (e) {
    console.warn('[prompt-pattern-economics] record_failed', e?.message ?? e);
    return { ok: false, error: String(e?.message ?? e) };
  }

  if (obs.runPatternStats && typeof obs.runPatternStats === 'object') {
    recordRunPromptPatternStats(obs.runPatternStats, patternHash, {
      cacheReadTokens,
      savingsUsd: econ.total_cache_savings_usd,
    });
  }

  return {
    ok: true,
    pattern_hash: patternHash,
    savings_usd: econ.total_cache_savings_usd,
    dominant_pattern_hash: resolveDominantPromptPatternHash(obs.runPatternStats),
  };
}

/** Compaction feedback — credit read when known pattern already exists. */
export async function bumpPromptCacheOnCompaction(env, opts) {
  const patternHash = trim(opts?.patternHash || opts?.cacheKeyHash);
  if (!env?.DB || !patternHash) return;
  const tenantId = trim(opts.tenantId) || 'global';
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `UPDATE agentsam_prompt_cache_keys
        SET cache_read_count = cache_read_count + 1,
            provider_cache_last_hit_at_unix = ?,
            last_seen_at_unix = ?,
            updated_at_unix = ?
      WHERE tenant_id = ? AND pattern_hash = ?
      LIMIT 1`,
  )
    .bind(now, now, now, tenantId, patternHash)
    .run()
    .catch((e) => console.warn('[prompt-pattern-economics] compaction bump', e?.message ?? e));
}

export { resolveDominantPromptPatternHash, recordRunPromptPatternStats };
