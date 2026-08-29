/**
 * Tool cache write path — store deterministic results (inline D1 or R2 pointer).
 */

import {
  isToolCacheEnabled,
  normalizeCacheScopeIds,
  resolveToolCachePolicyFromRow,
} from './contract.js';
import {
  buildToolCacheKeyHash,
  hashToolResult,
  normalizeSemanticToolInput,
} from './key.js';

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

function reportCacheWriteFailure(env, opts, reason, error = null) {
  const tenantId = trim(opts?.tenantId);
  const workspaceId = trim(opts?.workspaceId);
  if (!env?.DB || !tenantId || !workspaceId) return;
  void (async () => {
    try {
      const { writeAgentsamErrorLog } = await import('../../telemetry/error-log.js');
      await writeAgentsamErrorLog(env, {
        workspaceId,
        tenantId,
        sessionId: opts?.sessionId ?? null,
        errorCode: 'tool_cache_write_failed',
        errorType: trim(reason) || 'unknown',
        errorMessage: String(error?.message ?? error ?? reason ?? 'tool cache write failed').slice(0, 2000),
        source: 'agentsam_tool_cache',
        sourceId: opts?.agentRunId ?? null,
        contextJson: JSON.stringify({
          tool_key: trim(opts?.toolRow?.tool_key || opts?.toolRow?.tool_name) || null,
        }),
      });
    } catch (reportError) {
      console.warn('[agentsam_tool_cache] error_log_failed', reportError?.message ?? reportError);
    }
  })();
}

function cacheId() {
  return `atc_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/**
 * @param {any} env
 * @param {unknown} result
 * @param {number} maxInlineBytes
 */
async function storeResultPayload(env, result, maxInlineBytes) {
  const json = JSON.stringify(result ?? null);
  const bytes = json.length;
  if (bytes <= maxInlineBytes) {
    return { result_inline_json: json, result_r2_key: null, result_bytes: bytes };
  }
  const r2Key = `tool-cache/v${1}/${await hashToolResult(result)}.json`;
  if (env?.R2) {
    try {
      await env.R2.put(r2Key, json, {
        httpMetadata: { contentType: 'application/json' },
      });
      return { result_inline_json: null, result_r2_key: r2Key, result_bytes: bytes };
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
 *   result: unknown,
 *   tenantId?: string|null,
 *   workspaceId?: string|null,
 *   userId?: string|null,
 *   sessionId?: string|null,
 *   sourceVersion?: string|null,
 *   sourceEtag?: string|null,
 *   varyHash?: string|null,
 *   originDurationMs?: number,
 *   originCostUsd?: number,
 *   agentRunId?: string|null,
 * }} opts
 */
export async function writeToolCacheResult(env, opts) {
  if (!env?.DB) return { ok: false, error: 'db_unavailable' };

  const toolKey = trim(opts.toolRow?.tool_key || opts.toolRow?.tool_name);
  const policy = resolveToolCachePolicyFromRow(opts.toolRow);
  if (!isToolCacheEnabled(policy, toolKey)) return { ok: false, error: 'cache_disabled' };

  if (!(await toolCacheTableReady(env.DB))) {
    reportCacheWriteFailure(env, opts, 'schema_not_migrated');
    return { ok: false, error: 'schema_not_migrated' };
  }

  const normalizedInput = normalizeSemanticToolInput(opts.toolInput);
  let scopeIds;
  try {
    scopeIds = normalizeCacheScopeIds(policy, opts);
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }

  const { cacheKeyHash, normalizedInputHash } = await buildToolCacheKeyHash({
    toolKey,
    toolRevision: opts.toolRow?.updated_at_unix ?? opts.toolRow?.id ?? null,
    policy,
    scopeContext: { ...opts, ...scopeIds },
    normalizedInput,
    sourceVersion: opts.sourceVersion,
    varyHash: opts.varyHash,
  });

  const stored = await storeResultPayload(env, opts.result, policy.max_inline_bytes);
  if (!stored) {
    reportCacheWriteFailure(env, opts, 'payload_too_large_or_r2_failed');
    return { ok: false, error: 'payload_too_large_or_r2_failed' };
  }

  const resultHash = await hashToolResult(opts.result);
  const now = nowUnix();
  const ttl = policy.ttl_sec > 0 ? policy.ttl_sec : 300;
  const stale = policy.stale_sec > 0 ? policy.stale_sec : ttl * 4;
  const freshUntil =
    policy.strategy === 'immutable' || policy.strategy === 'versioned'
      ? now + stale
      : now + ttl;
  const staleUntil = now + stale;

  try {
    await env.DB.prepare(
      `INSERT INTO agentsam_tool_cache (
         id, tenant_id, workspace_id, user_id, session_id,
         tool_id, tool_key, tool_revision,
         cache_key_hash, normalized_input_hash, vary_hash,
         source_version, source_etag,
         result_hash, result_inline_json, result_r2_key, result_bytes,
         strategy, status,
         fresh_until_unix, stale_until_unix,
         hit_count, miss_count,
         created_at_unix, updated_at_unix,
         origin_duration_ms, origin_cost_usd,
         saved_duration_ms, saved_cost_usd,
         created_by_run_id
       ) VALUES (
         ?,?,?,?,?,
         ?,?,?,
         ?,?,?,
         ?,?,
         ?,?,?,?,
         ?,?,
         ?,?,
         ?,?,
         ?,?,
         ?,?,
         ?,?,
         ?,?
       )
       ON CONFLICT(tenant_id, workspace_id, tool_key, cache_key_hash) DO UPDATE SET
         result_hash = excluded.result_hash,
         result_inline_json = excluded.result_inline_json,
         result_r2_key = excluded.result_r2_key,
         result_bytes = excluded.result_bytes,
         source_version = excluded.source_version,
         source_etag = excluded.source_etag,
         strategy = excluded.strategy,
         status = 'fresh',
         fresh_until_unix = excluded.fresh_until_unix,
         stale_until_unix = excluded.stale_until_unix,
         origin_duration_ms = excluded.origin_duration_ms,
         origin_cost_usd = excluded.origin_cost_usd,
         miss_count = agentsam_tool_cache.miss_count + 1,
         updated_at_unix = excluded.updated_at_unix,
         created_by_run_id = excluded.created_by_run_id`,
    )
      .bind(
        cacheId(),
        scopeIds.tenantId,
        scopeIds.workspaceId,
        trim(opts.userId) || null,
        trim(opts.sessionId) || null,
        trim(opts.toolRow?.id) || null,
        toolKey,
        trim(opts.toolRow?.updated_at_unix ?? opts.toolRow?.id) || null,
        cacheKeyHash,
        normalizedInputHash,
        trim(opts.varyHash) || null,
        trim(opts.sourceVersion) || null,
        trim(opts.sourceEtag) || null,
        resultHash,
        stored.result_inline_json,
        stored.result_r2_key,
        stored.result_bytes,
        policy.strategy,
        'fresh',
        freshUntil,
        staleUntil,
        0,
        1,
        now,
        now,
        Math.max(0, Math.floor(Number(opts.originDurationMs) || 0)),
        Math.max(0, Number(opts.originCostUsd) || 0),
        0,
        0,
        trim(opts.agentRunId) || null,
      )
      .run();

    return { ok: true, cacheKeyHash };
  } catch (e) {
    reportCacheWriteFailure(env, opts, 'd1_write_failed', e);
    return { ok: false, error: String(e?.message ?? e) };
  }
}
