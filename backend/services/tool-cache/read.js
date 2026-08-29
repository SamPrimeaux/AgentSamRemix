/**
 * Tool cache read path — fresh/stale lookup + hit accounting.
 */

import {
  isToolCacheEnabled,
  normalizeCacheScopeIds,
  resolveToolCachePolicyFromRow,
} from './contract.js';
import { buildToolCacheKeyHash, normalizeSemanticToolInput } from './key.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

async function toolCacheTableReady(db) {
  if (!db) return false;
  try {
    await db.prepare('SELECT cache_key_hash FROM agentsam_tool_cache LIMIT 0').run();
    return true;
  } catch {
    return false;
  }
}

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

/**
 * @param {Record<string, unknown>} row
 */
function parseCachedBody(row) {
  if (row?.result_inline_json) {
    try {
      return JSON.parse(String(row.result_inline_json));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * @param {any} env
 * @param {{
 *   toolRow: Record<string, unknown>,
 *   toolInput: unknown,
 *   tenantId?: string|null,
 *   workspaceId?: string|null,
 *   userId?: string|null,
 *   sessionId?: string|null,
 *   sourceVersion?: string|null,
 *   sourceEtag?: string|null,
 *   varyHash?: string|null,
 * }} opts
 */
export async function lookupToolCache(env, opts) {
  const lookupStarted = Date.now();
  const lookupDurationMs = () => Math.max(0, Date.now() - lookupStarted);

  if (!env?.DB) return { hit: false, reason: 'db_unavailable', lookupDurationMs: lookupDurationMs() };

  const toolKey = trim(opts.toolRow?.tool_key || opts.toolRow?.tool_name);
  const policy = resolveToolCachePolicyFromRow(opts.toolRow);
  if (!isToolCacheEnabled(policy, toolKey)) {
    return { hit: false, reason: 'cache_disabled', lookupDurationMs: lookupDurationMs() };
  }

  if (!(await toolCacheTableReady(env.DB))) {
    return { hit: false, reason: 'schema_not_migrated', lookupDurationMs: lookupDurationMs() };
  }

  let scopeIds;
  try {
    scopeIds = normalizeCacheScopeIds(policy, opts);
  } catch (e) {
    return {
      hit: false,
      reason: String(e?.message || 'scope_invalid'),
      lookupDurationMs: lookupDurationMs(),
    };
  }

  const normalizedInput = normalizeSemanticToolInput(opts.toolInput);
  const { cacheKeyHash } = await buildToolCacheKeyHash({
    toolKey,
    toolRevision: opts.toolRow?.updated_at_unix ?? opts.toolRow?.id ?? null,
    policy,
    scopeContext: { ...opts, ...scopeIds },
    normalizedInput,
    sourceVersion: opts.sourceVersion,
    varyHash: opts.varyHash,
  });

  try {
    const row = await env.DB.prepare(
      `SELECT id, result_inline_json, result_r2_key, result_hash, status,
              fresh_until_unix, stale_until_unix, origin_duration_ms, origin_cost_usd,
              source_version, source_etag, hit_count
         FROM agentsam_tool_cache
        WHERE tenant_id = ?
          AND workspace_id = ?
          AND tool_key = ?
          AND cache_key_hash = ?
          AND status != 'invalidated'
        LIMIT 1`,
    )
      .bind(scopeIds.tenantId, scopeIds.workspaceId, toolKey, cacheKeyHash)
      .first();

    if (!row?.id) {
      return { hit: false, reason: 'miss', cacheKeyHash, lookupDurationMs: lookupDurationMs() };
    }

    const now = nowUnix();
    const freshUntil = Number(row.fresh_until_unix) || 0;
    const staleUntil = Number(row.stale_until_unix) || 0;

    if (policy.strategy === 'versioned' || policy.strategy === 'immutable') {
      const wantVer = trim(opts.sourceVersion);
      const haveVer = trim(row.source_version);
      if (wantVer && haveVer && wantVer !== haveVer) {
        return { hit: false, reason: 'version_mismatch', cacheKeyHash, lookupDurationMs: lookupDurationMs() };
      }
      const wantEtag = trim(opts.sourceEtag);
      const haveEtag = trim(row.source_etag);
      if (wantEtag && haveEtag && wantEtag !== haveEtag) {
        return { hit: false, reason: 'etag_mismatch', cacheKeyHash, lookupDurationMs: lookupDurationMs() };
      }
    }

    if (freshUntil > 0 && now > freshUntil) {
      if (staleUntil > 0 && now > staleUntil) {
        return { hit: false, reason: 'expired', cacheKeyHash, lookupDurationMs: lookupDurationMs() };
      }
    }

    let body = parseCachedBody(row);
    if (!body && row.result_r2_key && env?.R2) {
      try {
        const obj = await env.R2.get(String(row.result_r2_key));
        if (obj) {
          const text = await obj.text();
          body = JSON.parse(text);
        }
      } catch {
        body = null;
      }
    }
    if (body == null) {
      return { hit: false, reason: 'empty_result', cacheKeyHash, lookupDurationMs: lookupDurationMs() };
    }

    const savedMs = Math.max(0, Math.floor(Number(row.origin_duration_ms) || 0));
    const savedCost = Math.max(0, Number(row.origin_cost_usd) || 0);
    await env.DB.prepare(
      `UPDATE agentsam_tool_cache
          SET hit_count = hit_count + 1,
              saved_duration_ms = saved_duration_ms + ?,
              saved_cost_usd = saved_cost_usd + ?,
              last_hit_at_unix = ?,
              updated_at_unix = ?
        WHERE id = ?`,
    )
      .bind(savedMs, savedCost, now, now, row.id)
      .run();

    return {
      hit: true,
      body,
      cacheKeyHash,
      cacheId: row.id,
      savedDurationMs: savedMs,
      savedCostUsd: savedCost,
      lookupDurationMs: lookupDurationMs(),
    };
  } catch (e) {
    return {
      hit: false,
      reason: 'lookup_error',
      error: String(e?.message ?? e),
      lookupDurationMs: lookupDurationMs(),
    };
  }
}

export { resolveToolCachePolicyFromRow, isToolCacheEnabled };
