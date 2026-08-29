/**
 * Settings section: Storage status (project storage, user storage prefs).
 * - GET /api/settings/storage/status
 * Deconstructed from src/api/settings-sections.js (Sections peel SEC5, no
 * behavior change).
 */
import { jsonResponse } from '../core/auth.js';
import { tableExists, safeQueryAll, safeFirst, stripSecretFields, envelope } from './settings-sections-shared.js';

// ─── Section: Storage status ─────────────────────────────────────────────────
async function getStorageStatus(env, authUser, workspaceId) {
  const warnings = [];
  const cache = new Map();
  const db = env.DB;
  const wsId = workspaceId || '';
  const userId = String(authUser?.id || '').trim();

  const r2Buckets = await safeQueryAll(
    db,
    'r2_buckets',
    `SELECT name, region, created_at FROM r2_buckets ORDER BY name LIMIT 100`,
    [],
    warnings,
    cache,
  );

  const r2Summary = await safeQueryAll(
    db,
    'r2_bucket_summary',
    `SELECT bucket_name, object_count, total_size_bytes, updated_at FROM r2_bucket_summary ORDER BY total_size_bytes DESC LIMIT 50`,
    [],
    warnings,
    cache,
  );

  const policies = await safeQueryAll(
    db,
    'storage_policies',
    `SELECT id, scope, scope_id, policy_kind, value, updated_at FROM storage_policies ORDER BY updated_at DESC LIMIT 50`,
    [],
    warnings,
    cache,
  );

  const userPrefs = await safeFirst(
    db,
    'user_storage_preferences',
    `SELECT user_id, default_provider, ui_preferences_json, updated_at FROM user_storage_preferences WHERE user_id = ? LIMIT 1`,
    [userId],
    warnings,
    cache,
  );

  const projectStorage = await safeQueryAll(
    db,
    'project_storage',
    wsId
      ? `SELECT project_id, provider, resource_label, size_bytes, updated_at FROM project_storage WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 50`
      : `SELECT project_id, provider, resource_label, size_bytes, updated_at FROM project_storage ORDER BY updated_at DESC LIMIT 50`,
    wsId ? [wsId] : [],
    warnings,
    cache,
  );

  const vectorIndexes = await safeQueryAll(
    db,
    'vectorize_index_registry',
    `SELECT display_name, binding_name, dimensions, metric, is_active,
            stored_vectors, last_indexed_at
     FROM vectorize_index_registry
     ORDER BY display_name LIMIT 50`,
    [],
    warnings,
    cache,
  );

  // Provider connection states
  const cloudflareConnected = r2Buckets.length > 0 || r2Summary.length > 0;
  const cloudflareProvider = {
    provider: 'cloudflare',
    status: cloudflareConnected ? 'connected' : 'unknown',
    accountLabel: env.CF_ACCOUNT_LABEL || null,
    resourceLabel: r2Buckets.length ? `${r2Buckets.length} R2 buckets` : null,
    lastCheckedAt: r2Summary[0]?.updated_at || null,
    capabilities: ['r2', 'kv', 'd1', 'workers_ai', 'vectorize'],
    warnings: [],
  };

  const supabaseProvider = {
    provider: 'supabase',
    status: env.SUPABASE_URL ? 'connected' : 'not_connected',
    accountLabel: null,
    resourceLabel: env.SUPABASE_URL ? 'documents / codebase_* tables' : null,
    lastCheckedAt: null,
    capabilities: ['postgres', 'rag', 'auth', 'storage'],
    warnings: env.SUPABASE_URL
      ? []
      : [
          {
            code: 'SUPABASE_URL_MISSING',
            message: 'SUPABASE_URL is not set in this environment.',
            severity: 'warn',
          },
        ],
  };

  const oauthRows = await safeQueryAll(
    db,
    'user_oauth_tokens',
    `SELECT provider, account_label, updated_at FROM user_oauth_tokens WHERE user_id = ? AND provider IN ('google','google_drive','github')`,
    [userId],
    warnings,
    cache,
  );
  const driveRow = oauthRows.find((r) =>
    ['google_drive', 'google'].includes(String(r.provider || '').toLowerCase()),
  );
  const githubRow = oauthRows.find((r) => String(r.provider || '').toLowerCase() === 'github');

  const driveProvider = {
    provider: 'google_drive',
    status: driveRow ? 'connected' : 'not_connected',
    accountLabel: driveRow?.account_label || null,
    lastCheckedAt: driveRow?.updated_at || null,
    capabilities: ['files:read'],
    warnings: [],
  };

  const githubProvider = {
    provider: 'github',
    status: githubRow ? 'connected' : 'not_connected',
    accountLabel: githubRow?.account_label || null,
    lastCheckedAt: githubRow?.updated_at || null,
    capabilities: ['repo:read'],
    warnings: [],
  };

  return envelope('storage', {
    summary: {
      r2_bucket_count: r2Buckets.length,
      r2_object_count_total: r2Summary.reduce((acc, r) => acc + Number(r.object_count || 0), 0),
      r2_size_bytes_total: r2Summary.reduce((acc, r) => acc + Number(r.total_size_bytes || 0), 0),
      vector_index_count: vectorIndexes.length,
      project_storage_rows: projectStorage.length,
      default_provider: userPrefs?.default_provider || null,
    },
    rows: r2Summary,
    warnings,
    providers: [cloudflareProvider, supabaseProvider, driveProvider, githubProvider],
    actions: [
      {
        key: 'refresh_inventory',
        label: 'Refresh inventory',
        enabled: false,
        reasonDisabled:
          'Refresh inventory is disabled because no safe refresh-inventory endpoint is wired here yet.',
      },
      {
        key: 'cleanup_review',
        label: 'Open cleanup review',
        enabled: true,
      },
    ],
    extra: {
      buckets: r2Buckets,
      policies,
      vector_indexes: vectorIndexes,
      project_storage: projectStorage,
      user_prefs: userPrefs,
    },
  });
}


export { getStorageStatus };
