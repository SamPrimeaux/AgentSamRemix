/**
 * Storage dashboard API — tenant-scoped via session (getAuthUser).
 * R2 bindings, analytics, Vectorize / AutoRAG, S3-compatible config, D1 preferences & access-key registry.
 */
import {
  getAuthUser,
  jsonResponse,
  fetchAuthUserTenantId,
} from '../core/auth.js';
import { getR2Binding, listBoundR2BucketNames, r2LiveBucketStats } from './r2-api.js';
import { listWorkerR2BindingCatalog } from '../core/r2-storage-scope.js';
import {
  upsertUserCloudflareR2Keys,
  loadUserCloudflareR2Credentials,
  getUserCloudflareR2KeySummary,
  markUserCloudflareR2Validated,
} from '../core/user-storage-r2-credentials.js';
import {
  buildStorageVectorsPayload,
  upsertTenantVectorConnection,
  deactivateTenantVectorConnection,
} from '../core/storage-vectors-surface.js';
import { validateR2ByokCredentials } from '../core/storage-byok-test.js';
import { getDefaultWorkspaceDataBinding } from '../core/workspace-data-bindings.js';
import { resolveIdentity } from '../../backend/identity/index.js';

function knownLiveStorage(env) {
  return listWorkerR2BindingCatalog(env).map((row) => ({
    binding: row.binding,
    storage_name: row.storage_name,
    storage_id: row.storage_id,
    storage_type: row.storage_type,
    public: row.public,
    url: row.url,
    region: 'auto',
  }));
}

/** Resolve tenant for row scoping (prefs, keys). */
async function resolveTenantId(env, authUser) {
  if (authUser.tenant_id != null && String(authUser.tenant_id).trim() !== '') {
    return String(authUser.tenant_id).trim();
  }
  let tid = await fetchAuthUserTenantId(env, authUser.id);
  if (tid) return tid;
  if (authUser.email) {
    tid = await fetchAuthUserTenantId(env, authUser.email);
    if (tid) return tid;
  }
  return `user:${String(authUser.id || authUser.email || 'unknown').trim()}`;
}

function r2S3PublicEndpoint(env) {
  const id = env.CLOUDFLARE_ACCOUNT_ID;
  if (!id || String(id).trim() === '') return '';
  return `https://${String(id).trim()}.r2.cloudflarestorage.com`;
}

function rows(result) {
  return Array.isArray(result?.results) ? result.results : (Array.isArray(result) ? result : []);
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function cachedStorageResponse(env, endpoint, tenantId, producer) {
  const cacheKey = `storage_${endpoint}_${tenantId}`;
  if (env.SESSION_CACHE) {
    try {
      const cached = await env.SESSION_CACHE.get(cacheKey, 'json');
      if (cached) return jsonResponse(cached);
    } catch (_) { }
  }
  const failed = new Set();
  const payload = await producer(failed);
  const out = {
    source: payload.source || 'd1_registry',
    data_quality: payload.data_quality || (failed.size ? 'partial' : 'healthy'),
    last_synced_at: payload.last_synced_at ?? null,
    ...payload,
    ...(failed.size ? { failed: [...failed] } : {}),
  };
  if (env.SESSION_CACHE) {
    env.SESSION_CACHE.put(cacheKey, JSON.stringify(out), { expirationTtl: 300 }).catch(() => { });
  }
  return jsonResponse(out);
}

async function q(env, failed, table, sql, binds = [], mode = 'all') {
  try {
    const stmt = env.DB.prepare(sql).bind(...binds);
    return mode === 'first' ? await stmt.first() : rows(await stmt.all());
  } catch (e) {
    failed?.add?.(table);
    console.warn(`[storage:${table}]`, e?.message ?? e);
    return mode === 'first' ? null : [];
  }
}

function mergeContentTypes(bucketRows) {
  const merged = {};
  for (const b of bucketRows) {
    const obj = parseJsonObject(b.by_content_type_json);
    for (const [k, v] of Object.entries(obj)) merged[k] = num(merged[k]) + num(v);
  }
  return merged;
}

function cleanupBreakdown(bucketRows) {
  return bucketRows.reduce((acc, b) => {
    const k = String(b.cleanup_status || 'unreviewed');
    acc[k] = num(acc[k]) + 1;
    return acc;
  }, { unreviewed: 0, reviewed: 0, archived: 0 });
}

async function requireStoragePlatformOperator(env, authUser, workspaceId) {
  const { userMayUseWorkspaceCredentials } = await import('../../backend/identity/workspace/grants.js');
  return userMayUseWorkspaceCredentials(env, authUser, workspaceId);
}

/** Dedupe stats when multiple logical names map to the same R2 binding (e.g. inneranimalmedia + tools → DASHBOARD). */
function bindingIdentity(env, logicalName) {
  const b = getR2Binding(env, logicalName);
  if (!b) return logicalName;
  for (const row of listWorkerR2BindingCatalog(env)) {
    if (env?.[row.binding] === b) return row.binding;
  }
  return logicalName;
}

function randomSecret(len = 40) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}

import { getUserR2Summary } from '../../backend/credentials/cloudflare/r2-credentials.js';

async function listAccessKeysForTenant(env, tenantId, userId) {
  if (!env.DB) return [];
  try {
    const r2 = await getUserR2Summary(env, userId);
    if (!r2?.id) return [];
    return [
      {
        accessKeyId: r2.r2_access_key_id_preview || 'r2_s3_credentials',
        id: r2.id,
        created_at: r2.created_at,
        createdAt: r2.created_at,
        status: r2.status ?? 'active',
      },
    ];
  } catch (e) {
    console.warn('[storage] listAccessKeysForTenant', e?.message ?? e);
    return [];
  }
}

/**
 * Main router for /api/storage/*
 */
export async function handleStorageApi(request, url, env) {
  const path = url.pathname.replace(/\/$/, '') || '/';
  const pathLower = path.toLowerCase();
  const method = (request.method || 'GET').toUpperCase();

  const authUser = await getAuthUser(request, env);
  if (!authUser) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  const identity = await resolveIdentity(request, env);
  const workspaceId = identity.workspace?.id || null;

  const tenantId = await resolveTenantId(env, authUser);
  const userId = String(authUser.id || authUser.email || '').trim();
  if (!userId) {
    return jsonResponse({ error: 'Invalid session user' }, 401);
  }

  const baseMeta = { tenant_id: tenantId, user_id: userId };

  // ── DELETE /api/storage/policies/:id ────────────────────────────────────
  const policyIdMatch = path.match(/^\/api\/storage\/policies\/([^/]+)$/i);
  if (policyIdMatch && method === 'DELETE') {
    if (!env.DB) return jsonResponse({ error: 'Database not configured', ...baseMeta }, 503);
    const policyId = decodeURIComponent(policyIdMatch[1] || '').trim();
    if (!policyId) return jsonResponse({ error: 'id required' }, 400);
    try {
      const del = await env.DB.prepare(
        `DELETE FROM storage_policies WHERE id = ? AND tenant_id = ? AND user_id = ?`,
      )
        .bind(policyId, tenantId, userId)
        .run();
      if (!(del.meta?.changes ?? 0)) {
        return jsonResponse({ error: 'Not found' }, 404);
      }
      return jsonResponse({ ok: true, ...baseMeta });
    } catch (e) {
      const msg = String(e?.message || e);
      if (msg.includes('no such table')) {
        return jsonResponse(
          {
            error: 'storage_policies table missing',
            hint: 'Apply migrations/234_storage_policies.sql',
            ...baseMeta,
          },
          503,
        );
      }
      return jsonResponse({ error: msg, ...baseMeta }, 500);
    }
  }

  // ── GET / POST /api/storage/policies ─────────────────────────────────────
  if (pathLower === '/api/storage/policies') {
    if (method === 'GET') {
      if (!env.DB) return jsonResponse({ policies: [], ...baseMeta });
      try {
        const { results } = await env.DB.prepare(
          `SELECT p.*, s.storage_name, s.storage_type, s.storage_id, s.status AS storage_status
           FROM storage_policies p
           LEFT JOIN project_storage s
             ON s.tenant_id = p.tenant_id AND s.storage_name = p.bucket_name
           WHERE p.tenant_id = ? AND p.user_id = ?
           ORDER BY p.created_at DESC`,
        )
          .bind(tenantId, userId)
          .all();
        return jsonResponse({
          source: 'd1_registry',
          data_quality: 'healthy',
          last_synced_at: null,
          policies: results || [],
          ...baseMeta,
        });
      } catch (e) {
        const msg = String(e?.message || e);
        if (msg.includes('no such table')) {
          return jsonResponse(
            {
              source: 'd1_registry',
              data_quality: 'partial',
              last_synced_at: null,
              policies: [],
              error: 'storage_policies table missing',
              hint: 'Apply migrations/234_storage_policies.sql',
              ...baseMeta,
            },
            503,
          );
        }
        return jsonResponse({ error: msg, ...baseMeta }, 500);
      }
    }

    if (method === 'POST') {
      if (!env.DB) {
        return jsonResponse({ error: 'Database not configured', ...baseMeta }, 503);
      }
      let body = {};
      try {
        body = await request.json();
      } catch {
        body = {};
      }
      const effect = String(body.effect || '').toLowerCase().trim();
      if (effect !== 'allow' && effect !== 'deny') {
        return jsonResponse({ error: 'effect must be allow or deny' }, 400);
      }
      const bucket_name =
        typeof body.bucket_name === 'string' ? body.bucket_name.trim() : '';
      if (!bucket_name) return jsonResponse({ error: 'bucket_name required' }, 400);

      let actionsArr = body.actions;
      if (typeof actionsArr === 'string') {
        try {
          actionsArr = JSON.parse(actionsArr);
        } catch {
          actionsArr = null;
        }
      }
      if (!Array.isArray(actionsArr) || actionsArr.length === 0) {
        return jsonResponse({ error: 'actions must be a non-empty JSON array' }, 400);
      }
      const actionsStr = JSON.stringify(actionsArr);
      const resource =
        typeof body.resource === 'string' && body.resource.trim()
          ? body.resource.trim()
          : '*';
      const id = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      try {
        await env.DB.prepare(
          `INSERT INTO storage_policies (
            id, tenant_id, user_id, bucket_name, effect, actions, resource, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            id,
            tenantId,
            userId,
            bucket_name,
            effect,
            actionsStr,
            resource,
            now,
            now,
          )
          .run();
      } catch (e) {
        const msg = String(e?.message || e);
        if (msg.includes('no such table')) {
          return jsonResponse(
            {
              error: 'storage_policies table missing',
              hint: 'Apply migrations/234_storage_policies.sql',
              ...baseMeta,
            },
            503,
          );
        }
        return jsonResponse({ error: msg, ...baseMeta }, 500);
      }
      const policy = await env.DB.prepare(
        `SELECT * FROM storage_policies WHERE id = ? LIMIT 1`,
      )
        .bind(id)
        .first();
      return jsonResponse({ policy, ...baseMeta }, 201);
    }

    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  // ── Buckets (bindings) ─────────────────────────────────────────
  if (pathLower === '/api/storage/buckets' && method === 'GET') {
    if (!env.DB) {
      return jsonResponse({
        source: 'd1_registry',
        data_quality: 'partial',
        last_synced_at: null,
        buckets: [],
        missing_registry_rows: [],
        total_objects: 0,
        total_mb: 0,
        failed: ['DB'],
        ...baseMeta,
      });
    }
    return cachedStorageResponse(env, 'buckets', tenantId, async (failed) => {
      const [bucketRows, syncRow] = await Promise.all([
        q(env, failed, 'project_storage', `
          SELECT ps.id, ps.tenant_id, ps.storage_type, ps.storage_name, ps.storage_id, ps.storage_url,
                 ps.region, ps.status, ps.metadata_json, ps.created_at, ps.updated_at,
                 rs.object_count, rs.total_bytes, rs.total_mb, rs.by_content_type_json,
                 rs.prefix_breakdown_json, rs.is_live_connected, rs.priority,
                 rs.last_inventoried_at, rs.cleanup_status, rs.cleanup_notes, rs.owner, rs.project_ref
          FROM project_storage ps
          LEFT JOIN r2_bucket_summary rs ON rs.bucket_name = ps.storage_name
          WHERE ps.tenant_id = ? AND ps.status = 'active'
          ORDER BY COALESCE(rs.priority, 999), ps.storage_name
        `, [tenantId]),
        q(env, failed, 'r2_bucket_summary', `SELECT MAX(last_inventoried_at) AS last_synced_at FROM r2_bucket_summary`, [], 'first'),
      ]);
      const names = new Set(bucketRows.map((b) => b.storage_name));
      const live = [];
      const missing = live
        .filter((b) => !names.has(b.storage_name))
        .map((b) => ({ ...b, registry_status: 'missing_from_project_storage' }));
      const buckets = bucketRows.map((b) => ({
        ...b,
        name: b.storage_name,
        bucket_name: b.storage_name,
        object_count: num(b.object_count),
        total_bytes: num(b.total_bytes),
        total_mb: num(b.total_mb),
        registry_status: 'registered',
      }));
      return {
        source: 'd1_registry',
        data_quality: buckets.length ? 'healthy' : 'fallback_live_scan',
        last_synced_at: syncRow?.last_synced_at ?? null,
        buckets: [...buckets, ...missing],
        missing_registry_rows: missing,
        total_objects: buckets.reduce((s, b) => s + num(b.object_count), 0),
        total_mb: buckets.reduce((s, b) => s + num(b.total_mb), 0),
        ...baseMeta,
      };
    });
  }

  // ── Analytics (D1 inventory + worker analytics) ──────────────────
  if (pathLower === '/api/storage/analytics' && method === 'GET') {
    if (!env.DB) return jsonResponse({ source: 'd1_registry', data_quality: 'partial', last_synced_at: null, failed: ['DB'], ...baseMeta });
    return cachedStorageResponse(env, 'analytics', tenantId, async (failed) => {
      const summarySql = `SELECT rs.* FROM r2_bucket_summary rs
           INNER JOIN project_storage ps ON ps.storage_name = rs.bucket_name
          WHERE ps.tenant_id = ? AND COALESCE(ps.status, 'active') = 'active'
          ORDER BY COALESCE(rs.priority,999), rs.bucket_name`;
      const summaryBinds = [tenantId];
      const [summaries, syncRow, trends, errors, usageFiltered] = await Promise.all([
        q(env, failed, 'r2_bucket_summary', summarySql, summaryBinds),
        q(
          env,
          failed,
          'r2_bucket_summary',
          `SELECT MAX(rs.last_inventoried_at) AS last_synced_at
                 FROM r2_bucket_summary rs
                 INNER JOIN project_storage ps ON ps.storage_name = rs.bucket_name
                WHERE ps.tenant_id = ? AND COALESCE(ps.status, 'active') = 'active'`,
          [tenantId],
          'first',
        ),
        q(env, failed, 'worker_analytics_hourly', `
          SELECT hour_timestamp AS hour, total_requests, failed_requests, avg_duration_ms, p95_duration_ms
          FROM worker_analytics_hourly
          WHERE datetime(hour_timestamp) >= datetime('now','-24 hours')
          ORDER BY hour_timestamp ASC
        `),
        q(env, failed, 'worker_analytics_errors', `
          SELECT event_id, worker_name, environment, timestamp, error_message, path, method, status_code, resolved
          FROM worker_analytics_errors
          WHERE COALESCE(resolved,0) = 0
          ORDER BY timestamp DESC LIMIT 20
        `),
        workspaceId
          ? q(env, failed, 'workspace_usage_metrics', `
          SELECT metric_date, storage_used_mb, api_calls_used, mcp_calls, deployments_count
          FROM workspace_usage_metrics
          WHERE workspace_id = ?
          ORDER BY metric_date DESC LIMIT 30
        `, [workspaceId])
          : Promise.resolve([]),
      ]);
      let usage = usageFiltered;
      if (!workspaceId) failed.add('workspace_id');
      const totalObjects = summaries.reduce((s, b) => s + num(b.object_count), 0);
      const totalBytes = summaries.reduce((s, b) => s + num(b.total_bytes), 0);
      const totalMb = summaries.reduce((s, b) => s + num(b.total_mb), 0);
      return {
        source: 'd1_registry',
        data_quality: trends.length ? 'healthy' : 'fallback_live_scan',
        last_synced_at: syncRow?.last_synced_at ?? null,
        total_objects: totalObjects,
        total_bytes: totalBytes,
        by_bucket: summaries.map((b) => ({ bucket: b.bucket_name, bucket_name: b.bucket_name, object_count: num(b.object_count), total_bytes: num(b.total_bytes), total_mb: num(b.total_mb) })),
        summary: { object_count: totalObjects, size_bytes: totalBytes },
        storage_inventory: {
          total_objects: totalObjects,
          total_bytes: totalBytes,
          total_mb: totalMb,
          bucket_count: summaries.length,
          storage_by_bucket: summaries.map((b) => ({ bucket_name: b.bucket_name, total_mb: num(b.total_mb), object_count: num(b.object_count) })),
          by_content_type: mergeContentTypes(summaries),
          cleanup_breakdown: cleanupBreakdown(summaries),
        },
        request_trends: trends,
        recent_errors: errors,
        workspace_usage: usage.reverse(),
        ...baseMeta,
      };
    });
  }

  if (pathLower === '/api/storage/code-index/queue' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    if (!workspaceId) return jsonResponse({ error: 'workspace_id required' }, 400);
    const requestedWorkspaceId = String(body.workspace_id || '').trim();
    if (requestedWorkspaceId && requestedWorkspaceId !== workspaceId) {
      return jsonResponse({ error: 'workspace_id_mismatch' }, 403);
    }
    const { queueCodeIndexJobAfterDeploy } = await import(
      '../../backend/agentsam/codebase/deploy-code-index-queue.js'
    );
    const result = await queueCodeIndexJobAfterDeploy(env, {
      workspaceId,
      triggeredBy: body.binding_name ? `storage:${String(body.binding_name).trim()}` : 'storage_reindex',
    });
    if (!result.ok && !result.skipped) {
      return jsonResponse({ error: result.error || 'queue_failed', ...baseMeta }, 500);
    }
    return jsonResponse({ ok: true, queued: true, ...result, ...baseMeta });
  }

  // ── Vectors: platform operator CF/pgvector vs tenant workspace lanes ──
  if (pathLower === '/api/storage/vectors' && method === 'GET') {
    if (!env.DB) {
      return jsonResponse({
        source: 'd1_registry',
        data_quality: 'partial',
        last_synced_at: null,
        indexes: [],
        can_view_platform: false,
        failed: ['DB'],
        ...baseMeta,
      });
    }
    return cachedStorageResponse(env, `vectors_u_${userId}`, tenantId, async (failed) => {
      const query = (sql, binds = [], mode = 'all') => q(env, failed, 'vectors_surface', sql, binds, mode);
      const payload = await buildStorageVectorsPayload(
        env,
        authUser,
        url,
        tenantId,
        userId,
        query,
        workspaceId,
      );
      const hasData =
        payload.platform_cf_indexes?.length ||
        payload.platform_pgvector_lanes?.length ||
        payload.workspace_pgvector_lanes?.length ||
        payload.tenant_connections?.length;
      return {
        source: 'd1_registry',
        data_quality: hasData ? 'healthy' : 'empty',
        ...payload,
        ...baseMeta,
      };
    });
  }

  if (pathLower === '/api/storage/vector-connections' && method === 'POST') {
    if (!env.DB) return jsonResponse({ error: 'Database not configured', ...baseMeta }, 503);
    const body = await request.json().catch(() => ({}));
    const requestedWorkspaceId = String(body.workspace_id || '').trim();
    if (requestedWorkspaceId && requestedWorkspaceId !== workspaceId) {
      return jsonResponse({ error: 'workspace_id_mismatch' }, 403);
    }
    try {
      const id = await upsertTenantVectorConnection(env, tenantId, userId, body, workspaceId);
      if (env.SESSION_CACHE?.delete) {
        await env.SESSION_CACHE.delete(`storage_vectors_u_${userId}_${tenantId}`).catch(() => {});
      }
      return jsonResponse({ ok: true, id, ...baseMeta });
    } catch (e) {
      const msg = String(e?.message || e);
      const code = msg.includes('not_found') ? 404 : msg.includes('required') || msg.includes('invalid') ? 400 : 500;
      return jsonResponse({ error: msg }, code);
    }
  }

  const vectorConnMatch = path.match(/^\/api\/storage\/vector-connections\/([^/]+)$/i);
  if (vectorConnMatch && method === 'DELETE') {
    if (!env.DB) return jsonResponse({ error: 'Database not configured', ...baseMeta }, 503);
    const connectionId = decodeURIComponent(vectorConnMatch[1] || '').trim();
    try {
      await deactivateTenantVectorConnection(env, tenantId, userId, connectionId);
      if (env.SESSION_CACHE?.delete) {
        await env.SESSION_CACHE.delete(`storage_vectors_u_${userId}_${tenantId}`).catch(() => {});
      }
      return jsonResponse({ ok: true, id: connectionId, ...baseMeta });
    } catch (e) {
      const msg = String(e?.message || e);
      return jsonResponse({ error: msg }, msg.includes('not_found') ? 404 : 500);
    }
  }

  const cleanupMatch = path.match(/^\/api\/storage\/buckets\/([^/]+)\/cleanup$/i);
  if (cleanupMatch && method === 'PATCH') {
    if (!env.DB) return jsonResponse({ error: 'Database not configured', ...baseMeta }, 503);
    const bucketName = decodeURIComponent(cleanupMatch[1] || '').trim();
    const body = await request.json().catch(() => ({}));
    const status = String(body.status || '').trim();
    if (!['reviewed', 'archived', 'unreviewed'].includes(status)) {
      return jsonResponse({ error: 'status must be reviewed, archived, or unreviewed' }, 400);
    }
    await env.DB.prepare(
      `UPDATE r2_bucket_summary SET cleanup_status = ?, cleanup_notes = COALESCE(?, cleanup_notes) WHERE bucket_name = ?`,
    ).bind(status, body.notes != null ? String(body.notes).slice(0, 1000) : null, bucketName).run();
    if (env.SESSION_CACHE?.delete) {
      await Promise.all([
        env.SESSION_CACHE.delete(`storage_buckets_${tenantId}`).catch(() => { }),
        env.SESSION_CACHE.delete(`storage_analytics_${tenantId}`).catch(() => { }),
      ]);
    }
    return jsonResponse({ ok: true, bucket_name: bucketName, cleanup_status: status, ...baseMeta });
  }

  const errorMatch = path.match(/^\/api\/storage\/errors\/([^/]+)$/i);
  if (errorMatch && method === 'PATCH') {
    if (!env.DB) return jsonResponse({ error: 'Database not configured', ...baseMeta }, 503);
    const eventId = decodeURIComponent(errorMatch[1] || '').trim();
    await env.DB.prepare(
      `UPDATE worker_analytics_errors SET resolved = 1 WHERE event_id = ?`,
    ).bind(eventId).run();
    if (env.SESSION_CACHE?.delete) await env.SESSION_CACHE.delete(`storage_analytics_${tenantId}`).catch(() => { });
    return jsonResponse({ ok: true, event_id: eventId, resolved: 1, ...baseMeta });
  }

  if (pathLower === '/api/storage/activity' && method === 'GET') {
    if (!env.DB) return jsonResponse({ source: 'd1_registry', data_quality: 'partial', last_synced_at: null, events: [], failed: ['DB'], ...baseMeta });
    return cachedStorageResponse(env, 'activity', tenantId, async (failed) => {
      const worker = (url.searchParams.get('worker_name') || '').trim();
      const outcome = (url.searchParams.get('outcome') || '').trim();
      const start = (url.searchParams.get('start') || '').trim();
      const end = (url.searchParams.get('end') || '').trim();
      const where = [];
      const binds = [];
      if (worker) { where.push('worker_name = ?'); binds.push(worker); }
      if (outcome) { where.push('outcome = ?'); binds.push(outcome); }
      if (start) { where.push('datetime(timestamp) >= datetime(?)'); binds.push(start); }
      if (end) { where.push('datetime(timestamp) <= datetime(?)'); binds.push(end); }
      const events = await q(env, failed, 'worker_analytics_events', `
        SELECT id, event_id, worker_name, environment, timestamp, outcome, status, method, url, duration_ms, cpu_time_ms
        FROM worker_analytics_events
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY timestamp DESC LIMIT 50
      `, binds);
      const syncRow = await q(env, failed, 'worker_analytics_events', `SELECT MAX(timestamp) AS last_synced_at FROM worker_analytics_events`, [], 'first');
      return { source: 'd1_registry', data_quality: 'healthy', last_synced_at: syncRow?.last_synced_at ?? null, events, ...baseMeta };
    });
  }

  if (pathLower.startsWith('/api/storage/jobs/') && method === 'POST') {
    if (!env.DB) return jsonResponse({ error: 'Database not configured', ...baseMeta }, 503);
    if (!(await requireStoragePlatformOperator(env, authUser, workspaceId))) return jsonResponse({ error: 'Forbidden' }, 403);

    if (pathLower === '/api/storage/jobs/sync-project-storage') {
      let upserted = 0;
      let already_current = 0;
      const errors = [];
      await Promise.all(knownLiveStorage(env).map(async (b) => {
        try {
          const existing = await env.DB.prepare(
            `SELECT id FROM project_storage WHERE tenant_id = ? AND storage_name = ? LIMIT 1`,
          ).bind(tenantId, b.storage_name).first();
          if (existing) {
            await env.DB.prepare(
              `UPDATE project_storage SET status = 'active', storage_type = 'r2_bucket', storage_id = ?, metadata_json = ?, updated_at = unixepoch() WHERE tenant_id = ? AND storage_name = ?`,
            ).bind(b.storage_id, JSON.stringify({ binding: b.binding, public: b.public, url: b.url || null }), tenantId, b.storage_name).run();
            already_current += 1;
          } else {
            await env.DB.prepare(
              `INSERT INTO project_storage (id, tenant_id, storage_type, storage_name, storage_id, region, status, metadata_json, created_at, updated_at)
               VALUES (?, ?, 'r2_bucket', ?, ?, 'auto', 'active', ?, unixepoch(), unixepoch())`,
            ).bind(`ps_${b.storage_name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`, tenantId, b.storage_name, b.storage_id, JSON.stringify({ binding: b.binding, public: b.public, url: b.url || null })).run();
            upserted += 1;
          }
        } catch (e) {
          errors.push({ storage_name: b.storage_name, error: String(e?.message || e) });
        }
      }));
      return jsonResponse({ upserted, already_current, errors, ...baseMeta });
    }

    if (pathLower === '/api/storage/jobs/rollup-bucket-summary') {
      const bucketRows = await q(env, new Set(), 'r2_objects', `SELECT DISTINCT bucket_id FROM r2_objects WHERE tenant_id = ? AND COALESCE(is_active,1) = 1`, [tenantId]);
      let buckets_updated = 0;
      let total_objects = 0;
      let total_mb = 0;
      await Promise.all(bucketRows.map(async (b) => {
        const bucketId = b.bucket_id;
        const [sumRow, typeRows] = await Promise.all([
          env.DB.prepare(`SELECT COUNT(*) AS object_count, COALESCE(SUM(file_size),0) AS total_bytes, COALESCE(SUM(file_size),0)/1048576.0 AS total_mb FROM r2_objects WHERE bucket_id = ? AND tenant_id = ? AND COALESCE(is_active,1) = 1`).bind(bucketId, tenantId).first(),
          env.DB.prepare(`SELECT COALESCE(content_type,'unknown') AS content_type, COUNT(*) AS cnt FROM r2_objects WHERE bucket_id = ? AND tenant_id = ? AND COALESCE(is_active,1) = 1 GROUP BY COALESCE(content_type,'unknown')`).bind(bucketId, tenantId).all(),
        ]);
        const contentTypes = {};
        rows(typeRows).forEach((r) => { contentTypes[r.content_type] = num(r.cnt); });
        await env.DB.prepare(
          `INSERT INTO r2_bucket_summary (bucket_name, object_count, total_bytes, total_mb, by_content_type_json, is_live_connected, last_inventoried_at, cleanup_status)
           VALUES (?, ?, ?, ?, ?, 1, datetime('now'), 'unreviewed')
           ON CONFLICT(bucket_name) DO UPDATE SET object_count = excluded.object_count, total_bytes = excluded.total_bytes, total_mb = excluded.total_mb, by_content_type_json = excluded.by_content_type_json, last_inventoried_at = excluded.last_inventoried_at`,
        ).bind(bucketId, num(sumRow?.object_count), num(sumRow?.total_bytes), num(sumRow?.total_mb), JSON.stringify(contentTypes)).run();
        buckets_updated += 1;
        total_objects += num(sumRow?.object_count);
        total_mb += num(sumRow?.total_mb);
      }));
      return jsonResponse({ buckets_updated, total_objects, total_mb, ...baseMeta });
    }

    if (pathLower === '/api/storage/jobs/rollup-worker-analytics') {
      const { rollupWorkerAnalytics } = await import('../../backend/telemetry/worker-analytics-rollup.js');
      const out = await rollupWorkerAnalytics(env);
      return jsonResponse({ ...out, ...baseMeta });
    }

    return jsonResponse({ error: 'Storage job not found', path: pathLower }, 404);
  }

  // ── S3-compatible config + keys (tenant-scoped key list) ───────
  async function s3BundleResponse() {
    const endpoint = r2S3PublicEndpoint(env);
    const region = env.R2_REGION || 'auto';
    const [accessKeys, sourceBuckets, policies] = await Promise.all([
      listAccessKeysForTenant(env, tenantId, userId),
      env.DB
        ? q(env, new Set(), 'project_storage', `SELECT storage_name, storage_id, storage_type, status FROM project_storage WHERE tenant_id = ? AND status = 'active' ORDER BY storage_name`, [tenantId])
        : Promise.resolve([]),
      env.DB
        ? q(env, new Set(), 'storage_policies', `SELECT bucket_name, actions FROM storage_policies WHERE tenant_id = ? AND user_id = ? AND effect = 'allow'`, [tenantId, userId])
        : Promise.resolve([]),
    ]);
    const allowedBuckets = [...new Set(policies.map((p) => p.bucket_name).filter(Boolean))];
    let hyperdrive =
      'Hyperdrive binding HYPERDRIVE is configured for Postgres/regional acceleration; connection strings are not exposed via this API.';
    if (!env.HYPERDRIVE) {
      hyperdrive = 'No Hyperdrive binding in this Worker.';
    }

    return jsonResponse({
      source: 'd1_registry',
      data_quality: 'healthy',
      last_synced_at: null,
      ...baseMeta,
      endpoint,
      region,
      accessKeys,
      keys: accessKeys,
      source_buckets: sourceBuckets,
      allowed_buckets_json: JSON.stringify(allowedBuckets),
      hyperdrive,
      hyperdriveInfo: hyperdrive,
    });
  }

  if (
    (pathLower === '/api/storage/s3-config' || pathLower === '/api/storage/s3') &&
    method === 'GET'
  ) {
    return s3BundleResponse();
  }

  // ── Create access key (registry + one-time secret) ─────────────
  if (
    (pathLower === '/api/storage/access-keys' || pathLower === '/api/storage/s3/keys') &&
    method === 'POST'
  ) {
    if (!env.DB) {
      return jsonResponse({ error: 'Database not configured', ...baseMeta }, 503);
    }

    const accessKeyId = `iam_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const secretAccessKey = `sec_${randomSecret(40)}`;
    const created_at = Math.floor(Date.now() / 1000);

    let stored;
    try {
      stored = await upsertUserCloudflareR2Keys(env, {
        userId,
        tenantId,
        cfAccountId: env.CLOUDFLARE_ACCOUNT_ID || '',
        r2AccessKeyId: accessKeyId,
        r2SecretAccessKey: secretAccessKey,
        personUuid: authUser?.person_uuid ?? null,
      });
    } catch (e) {
      console.error('[storage] access-keys insert', e);
      return jsonResponse(
        {
          error: 'Failed to store access key',
          detail: String(e?.message || e),
          hint: 'Apply D1 migration migrations/233_storage_preferences_and_keys.sql',
          ...baseMeta,
        },
        503,
      );
    }

    return jsonResponse({
      ...baseMeta,
      id: stored.id,
      accessKeyId,
      secretAccessKey,
      secret: secretAccessKey,
      rawSecret: secretAccessKey,
      created_at,
      warning: 'Store the secret now; it cannot be retrieved again.',
    });
  }

  // ── Preferences (D1) ────────────────────────────────────────────
  async function savePreferences(body) {
    if (!env.DB) {
      return jsonResponse({ error: 'Database not configured', ...baseMeta }, 503);
    }
    const prefs =
      body && typeof body === 'object'
        ? body
        : {};
    const prefs_json = JSON.stringify(prefs);
    const updated_at = Math.floor(Date.now() / 1000);
    try {
      await env.DB.prepare(
        `INSERT INTO user_storage_preferences (tenant_id, user_id, prefs_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(tenant_id, user_id) DO UPDATE SET prefs_json = excluded.prefs_json, updated_at = excluded.updated_at`
      )
        .bind(tenantId, userId, prefs_json, updated_at)
        .run();
    } catch (e) {
      console.error('[storage] preferences', e);
      return jsonResponse(
        {
          error: 'Failed to save preferences',
          detail: String(e?.message || e),
          hint: 'Apply D1 migration migrations/233_storage_preferences_and_keys.sql',
          ...baseMeta,
        },
        503,
      );
    }
    return jsonResponse({ ok: true, ...baseMeta, prefs });
  }

  if (pathLower === '/api/storage/preferences' && method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch (_) {
      body = {};
    }
    return savePreferences(body);
  }

  // Dashboard UI uses PATCH /api/storage/settings — same as preferences
  if (pathLower === '/api/storage/settings' && method === 'PATCH') {
    let body = {};
    try {
      body = await request.json();
    } catch (_) {
      body = {};
    }
    return savePreferences(body);
  }

  if (pathLower === '/api/storage/preferences' && method === 'GET') {
    if (!env.DB) {
      return jsonResponse({ prefs: {}, ...baseMeta });
    }
    try {
      const row = await env.DB.prepare(
        `SELECT prefs_json, updated_at FROM user_storage_preferences WHERE tenant_id = ? AND user_id = ? LIMIT 1`
      )
        .bind(tenantId, userId)
        .first();
      let prefs = {};
      if (row?.prefs_json) {
        try {
          prefs = JSON.parse(row.prefs_json);
        } catch (_) {
          prefs = {};
        }
      }
      return jsonResponse({ ...baseMeta, prefs, updated_at: row?.updated_at ?? null });
    } catch (e) {
      return jsonResponse({ prefs: {}, ...baseMeta, error: String(e?.message || e) }, 200);
    }
  }

  // ── BYOK R2 status + test (Keys page) ───────────────────────────────────
  if (pathLower === '/api/storage/byok/status' && method === 'GET') {
    const summary = await getUserCloudflareR2KeySummary(env, userId);
    let byok_r2_bucket = null;
    if (workspaceId) {
      const binding = await getDefaultWorkspaceDataBinding(env, workspaceId, 'cloudflare_r2');
      byok_r2_bucket = binding?.byok_r2_bucket ?? binding?.r2_bucket ?? null;
    }
    const worker_bindings = listWorkerR2BindingCatalog(env).map((row) => ({
      binding: row.binding,
      bucket_name: row.bucket_name,
      storage_id: row.storage_id,
      public: row.public,
      url: row.url ?? null,
    }));
    return jsonResponse({
      ok: true,
      ...baseMeta,
      connected: !!(summary?.configured),
      summary,
      byok_r2_bucket,
      workspace_id: workspaceId || null,
      worker_bindings,
      s3_byok: summary?.configured
        ? {
            mode: 'account_s3_api',
            note: 'R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY — all buckets your token can ListBuckets',
          }
        : null,
    });
  }

  if (pathLower === '/api/storage/byok/test' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    let cfAccountId = body?.cloudflare_account_id != null ? String(body.cloudflare_account_id).trim() : '';
    let accessKeyId =
      body?.r2_access_key_id != null
        ? String(body.r2_access_key_id).trim()
        : body?.access_key_id != null
          ? String(body.access_key_id).trim()
          : '';
    let secretAccessKey =
      body?.r2_secret_access_key != null
        ? String(body.r2_secret_access_key).trim()
        : body?.secret_access_key != null
          ? String(body.secret_access_key).trim()
          : body?.api_key != null
            ? String(body.api_key).trim()
            : '';
    const bucketName =
      body?.byok_r2_bucket != null
        ? String(body.byok_r2_bucket).trim()
        : body?.bucket != null
          ? String(body.bucket).trim()
          : body?.default_bucket != null
            ? String(body.default_bucket).trim()
            : '';

    if (!accessKeyId || !secretAccessKey) {
      const stored = await loadUserCloudflareR2Credentials(env, userId);
      if (stored) {
        accessKeyId = accessKeyId || stored.accessKeyId;
        secretAccessKey = secretAccessKey || stored.secretAccessKey;
        cfAccountId = cfAccountId || stored.cfAccountId;
      }
    }

    const result = await validateR2ByokCredentials({
      cfAccountId,
      accessKeyId,
      secretAccessKey,
      bucketName: bucketName || null,
    });

    if (accessKeyId && secretAccessKey && cfAccountId) {
      await markUserCloudflareR2Validated(env, userId, {
        ok: result.ok,
        checks: result.checks,
      });
    }

    return jsonResponse({ ...result, ...baseMeta, s3_bucket_count: result.buckets?.length ?? null });
  }

  return jsonResponse({ error: 'Storage route not found', path: pathLower }, 404);
}
