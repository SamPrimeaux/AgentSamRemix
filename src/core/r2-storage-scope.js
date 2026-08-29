/**
 * R2 storage scope — platform Worker bindings vs customer BYOK.
 *
 * Platform buckets (ASSETS, AUTORAG_BUCKET, …) are introspected from env only.
 * Never hardcode dropped bindings (R2/iam-platform, DOCS_BUCKET, EMAIL, …).
 *
 * HTTP (/api/r2/*, /api/storage/*) and dashboard must use these helpers so
 * non-owner users never get platform bindings or Wrangler S3 secrets.
 *
 * Audit hotspots (still may reference bucket strings for IAM-owned paths):
 *   src/api/r2-api.js          — R2 HTTP API (gate with assertDashboardR2BucketAccess)
 *   src/api/storage.js         — Storage dashboard (tenant project_storage + superadmin live scan)
 *   src/core/platform-owner-r2-access.js — Agent tool catalog (auth_source=platform)
 *   src/core/user-storage-r2-credentials.js — mergeR2S3EnvFromUserStorage (BYOK vs superadmin)
 *   src/core/bootstrap-scoped-context.js — platform_r2_visible, tenant_buckets
 *   app/dashboard/components/StoragePage.tsx — /api/storage/*
 *   app/dashboard/components/LocalExplorer.tsx — /api/r2/* placeholders
 */

import { ApiError } from './api-error.js';
import { getAgentsamWorkspace, resolveWorkspaceR2Bucket } from '../../backend/identity/workspace/agentsam-workspace.js';
import { resolveWorkspaceD1Catalog } from './workspace-d1-access.js';
import {
  loadUserCloudflareR2Credentials,
  mergeR2S3EnvFromUserStorage,
} from './user-storage-r2-credentials.js';
import { userCanAccessWorkspace } from './workspace-access.js';

/**
 * Block authenticated tenants from writing to platform Worker R2 bindings (ASSETS, AUTORAG, …).
 * Superadmin only until BYOK write paths exist for feature routes.
 * @param {Record<string, unknown>|null|undefined} authUser
 */
export function assertPlatformR2WriteAccess(_authUser) {
  throw new ApiError(
    403,
    'platform_r2_write_denied',
    'Platform R2 writes are app-internal. Connect BYOK credentials in Settings → Storage.',
  );
}

/**
 * @param {Record<string, unknown>|null|undefined} authUser
 * @returns {Response|null} JSON 403 when denied; null when allowed
 */
export function platformR2WriteGateResponse(authUser) {
  try {
    assertPlatformR2WriteAccess(authUser);
    return null;
  } catch (e) {
    if (e instanceof ApiError) return e.toJsonResponse();
    throw e;
  }
}

/** Live Worker bindings only — bucket_name must match wrangler [[r2_buckets]] for each bindingKey. */
export const WORKER_R2_BINDING_SPECS = [
  {
    bindingKey: 'ASSETS',
    bucketName: 'inneranimalmedia',
    labels: ['ASSETS', 'DASHBOARD'],
    aliases: ['dashboard', 'inneranimalmedia-sandbox-cicd'],
  },
  {
    bindingKey: 'AUTORAG_BUCKET',
    bucketName: 'inneranimalmedia-autorag',
    labels: ['AUTORAG_BUCKET'],
    aliases: ['autorag'],
    /** R2 custom domain — not a wrangler [vars] entry */
    publicUrl: 'https://autorag.inneranimalmedia.com',
  },
  {
    bindingKey: 'CMS_BUCKET',
    bucketName: 'cms',
    labels: ['CMS_BUCKET'],
    aliases: ['cms'],
    publicUrl: 'https://cms.inneranimalmedia.com',
  },
  {
    bindingKey: 'ARTIFACTS',
    bucketName: 'artifacts',
    labels: ['ARTIFACTS'],
    aliases: ['artifacts'],
    publicUrl: 'https://artifacts.inneranimalmedia.com',
  },
];

/**
 * Physical bucket name for a live Worker R2 binding (wrangler [[r2_buckets]] bucket_name).
 * @param {any} env
 * @param {string} bindingKey e.g. AUTORAG_BUCKET, ASSETS, ARTIFACTS
 * @returns {string}
 */
export function resolveWorkerR2BucketName(env, bindingKey) {
  const key = String(bindingKey || '').trim();
  if (!key || !env?.[key]) return '';
  for (const spec of WORKER_R2_BINDING_SPECS) {
    if (spec.bindingKey === key) return spec.bucketName;
  }
  return '';
}

/** @param {any} env */
export function resolveAutoragBucketName(env) {
  return resolveWorkerR2BucketName(env, 'AUTORAG_BUCKET');
}

/**
 * Public URL for a bound bucket (R2 custom domain), when configured on the spec.
 * @param {any} env
 * @param {string} bindingKey
 */
export function resolveWorkerR2PublicUrl(env, bindingKey) {
  const key = String(bindingKey || '').trim();
  if (!key || !env?.[key]) return null;
  for (const spec of WORKER_R2_BINDING_SPECS) {
    if (spec.bindingKey === key && spec.publicUrl) return String(spec.publicUrl);
  }
  return null;
}

/**
 * Rows for storage dashboard / superadmin sync — only bindings present on this Worker.
 * @param {any} env
 */
export function listWorkerR2BindingCatalog(env) {
  /** @type {Array<{ binding: string, bucket_name: string, storage_name: string, storage_id: string, storage_type: string, public: boolean, url?: string }>} */
  const rows = [];
  for (const spec of WORKER_R2_BINDING_SPECS) {
    if (!env?.[spec.bindingKey]) continue;
    rows.push({
      binding: spec.bindingKey,
      bucket_name: spec.bucketName,
      storage_name: spec.bucketName,
      storage_id: spec.bucketName,
      storage_type: 'r2_bucket',
      public: !!(spec.publicUrl),
      ...(spec.publicUrl ? { url: spec.publicUrl } : {}),
    });
  }
  return rows;
}

/**
 * @param {any} env
 * @param {string} raw
 * @returns {string}
 */
export function normalizeR2BucketParam(env, raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const upper = trimmed.toUpperCase();
  for (const spec of WORKER_R2_BINDING_SPECS) {
    if (!env?.[spec.bindingKey]) continue;
    if (spec.labels.includes(upper)) return spec.bucketName;
  }
  return trimmed;
}

/** Resolve a live Worker R2 binding from a bucket name, label, or alias. */
export function getR2Binding(env, bucketName) {
  return getPlatformWorkerR2Binding(env, normalizeR2BucketParam(env, bucketName));
}

const BINDING_LABEL_TO_BUCKET = Object.fromEntries(
  WORKER_R2_BINDING_SPECS.flatMap((spec) =>
    spec.labels.map((label) => [label, spec.bucketName]),
  ),
);

/** Dashboard/catalog bucket normalization without importing the HTTP R2 router. */
export function resolveR2BucketName(env, bucketOrBinding) {
  const raw = String(bucketOrBinding || '').trim();
  if (!raw) return '';
  const mapped = BINDING_LABEL_TO_BUCKET[raw.toUpperCase()];
  if (mapped) return mapped;
  if (getR2Binding(env, raw)) return raw;
  return raw;
}

/**
 * True when the param resolves to a platform Worker-bound bucket on this deployment.
 * @param {any} env
 * @param {string} bucketOrLabel
 */
export function isPlatformWorkerBoundBucket(env, bucketOrLabel) {
  const normalized = normalizeR2BucketParam(env, bucketOrLabel).toLowerCase();
  if (!normalized) return false;
  for (const spec of WORKER_R2_BINDING_SPECS) {
    if (!env?.[spec.bindingKey]) continue;
    if (normalized === spec.bucketName.toLowerCase()) return true;
    for (const alias of spec.aliases) {
      if (normalized === alias.toLowerCase()) return true;
    }
  }
  return false;
}

/**
 * Workspace buckets granted via active membership (collab lane — e.g. fuelnfreetime).
 * Never includes platform Worker bindings (inneranimalmedia, artifacts, autorag).
 * @param {any} env
 * @param {Record<string, unknown>|null|undefined} authUser
 * @returns {Promise<Array<{ bucket: string, workspace_id: string, workspace_name?: string|null }>>}
 */
export async function listWorkspaceMemberR2Buckets(env, authUser) {
  const userId = authUser?.id != null ? String(authUser.id).trim() : '';
  if (!userId || !env?.DB) return [];

  try {
    const { results } = await env.DB.prepare(
      `SELECT DISTINCT
         aw.id AS workspace_id,
         aw.display_name AS workspace_name,
         aw.r2_bucket,
         aw.metadata_json
       FROM workspace_members wm
       INNER JOIN agentsam_workspace aw ON aw.id = wm.workspace_id
       WHERE wm.user_id = ?
         AND COALESCE(wm.is_active, 1) = 1
         AND COALESCE(aw.status, 'active') != 'archived'`,
    )
      .bind(userId)
      .all();

    /** @type {Array<{ bucket: string, workspace_id: string, workspace_name?: string|null }>} */
    const grants = [];
    const seen = new Set();

    for (const row of results || []) {
      const workspaceId = String(row.workspace_id || '').trim();
      if (!workspaceId) continue;
      if (!(await userCanAccessWorkspace(env, authUser, workspaceId))) continue;

      const bucketName = resolveWorkspaceR2Bucket(row);
      if (!bucketName) continue;
      if (isPlatformWorkerBoundBucket(env, bucketName)) continue;

      const key = bucketName.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      grants.push({
        bucket: bucketName,
        workspace_id: workspaceId,
        workspace_name: row.workspace_name != null ? String(row.workspace_name) : null,
      });
    }

    return grants.sort((a, b) => a.bucket.localeCompare(b.bucket));
  } catch {
    return [];
  }
}

/**
 * @param {any} env
 * @param {Record<string, unknown>|null|undefined} authUser
 * @param {string} bucketOrLabel
 */
export async function findWorkspaceMemberR2Grant(env, authUser, bucketOrLabel) {
  const bucket = normalizeR2BucketParam(env, bucketOrLabel);
  if (!bucket) return null;
  const normalized = bucket.toLowerCase();
  const grants = await listWorkspaceMemberR2Buckets(env, authUser);
  return grants.find((g) => g.bucket.toLowerCase() === normalized) || null;
}

/**
 * Use platform Worker R2 S3 secrets for a workspace-granted bucket (members only).
 * @param {any} userEnv
 * @param {any} platformEnv
 * @param {{ via?: string }|null|undefined} access
 */
export function applyWorkspaceR2Transport(userEnv, platformEnv, access) {
  if (access?.via !== 'workspace_membership') return userEnv;
  if (!platformEnv?.R2_ACCESS_KEY_ID || !platformEnv?.R2_SECRET_ACCESS_KEY) return userEnv;
  return {
    ...userEnv,
    R2_ACCESS_KEY_ID: platformEnv.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: platformEnv.R2_SECRET_ACCESS_KEY,
    CLOUDFLARE_ACCOUNT_ID: platformEnv.CLOUDFLARE_ACCOUNT_ID || userEnv.CLOUDFLARE_ACCOUNT_ID,
  };
}

export function getPlatformWorkerR2Binding(env, bucketName) {
  const normalized = String(bucketName || '').trim().toLowerCase();
  if (!normalized) return null;
  for (const spec of WORKER_R2_BINDING_SPECS) {
    const handle = env?.[spec.bindingKey];
    if (!handle) continue;
    if (normalized === spec.bucketName.toLowerCase()) return handle;
    for (const alias of spec.aliases) {
      if (normalized === alias.toLowerCase()) return handle;
    }
  }
  return null;
}

/**
 * @param {any} env
 * @param {Record<string, unknown>|null|undefined} authUser
 * @param {string} bucketOrLabel
 */
export async function assertDashboardR2BucketAccess(env, authUser, bucketOrLabel) {
  if (!authUser) {
    return {
      ok: false,
      status: 401,
      error: 'unauthenticated',
      user_message: 'Sign in to access storage.',
    };
  }

  const bucket = normalizeR2BucketParam(env, bucketOrLabel);

  if (isPlatformWorkerBoundBucket(env, bucket)) {
    return {
      ok: false,
      status: 403,
      error: 'platform_r2_owner_only',
      bucket,
      user_message:
        'IAM platform R2 is app-internal. Connect your Cloudflare R2 API keys in Settings → Storage to use your buckets.',
    };
  }

  const workspaceGrant = await findWorkspaceMemberR2Grant(env, authUser, bucket);
  if (workspaceGrant) {
    return {
      ok: true,
      bucket,
      via: 'workspace_membership',
      workspace_id: workspaceGrant.workspace_id,
    };
  }

  const userCreds = authUser?.id ? await loadUserCloudflareR2Credentials(env, authUser.id) : null;
  if (!userCreds?.accessKeyId || !userCreds?.secretAccessKey) {
    return {
      ok: false,
      status: 403,
      error: 'customer_r2_not_connected',
      bucket,
      user_message:
        'Connect your Cloudflare R2 access key + secret in Settings → Storage before using this bucket.',
    };
  }

  return { ok: true, bucket, via: 'customer_s3' };
}

function trimScope(v) {
  return v == null ? '' : String(v).trim();
}

function isPlatformWorkspaceSlug(slug) {
  const s = trimScope(slug).toLowerCase();
  return s === 'inneranimalmedia' || s === 'inneranimalmedia-mcp';
}

/**
 * Collab-lane bucket for an active workspace (fuelnfreetime, companionscpas, …).
 * @param {any} env
 * @param {string} workspaceId
 */
export async function resolveCollabWorkspaceR2Bucket(env, workspaceId) {
  const ws = trimScope(workspaceId);
  if (!ws || !env?.DB) return null;
  const row = await getAgentsamWorkspace(env, ws);
  if (!row) return null;
  const slug = trimScope(row.workspace_slug || row.slug || ws.replace(/^ws_/, ''));
  const catalog = resolveWorkspaceD1Catalog(row);
  const wsBucket = resolveWorkspaceR2Bucket(row);
  if (isPlatformWorkspaceSlug(slug) && !catalog.length && !wsBucket) return null;
  if (wsBucket && !isPlatformWorkerBoundBucket(env, wsBucket)) return wsBucket;
  if (catalog.length > 0 && slug && !isPlatformWorkspaceSlug(slug)) return slug;
  return null;
}

/**
 * Buckets visible in dashboard R2 picker / catalog.
 * @param {any} env
 * @param {Record<string, unknown>|null|undefined} authUser
 * @param {{ all?: boolean, listAccountViaS3?: (e: any) => Promise<string[]|null>, workspaceId?: string|null }} [opts]
 */
export async function listDashboardVisibleR2Buckets(env, authUser, opts = {}) {
  const workspaceId = trimScope(opts.workspaceId);
  if (workspaceId && authUser) {
    const collabBucket = await resolveCollabWorkspaceR2Bucket(env, workspaceId);
    if (collabBucket) {
      return {
        buckets: [collabBucket],
        bound: [collabBucket],
        source: 'workspace_collab',
        count: 1,
        platform_r2_visible: false,
        workspace_id: workspaceId,
      };
    }
  }

  const workspaceGrants = await listWorkspaceMemberR2Buckets(env, authUser);
  const workspaceBucketNames = workspaceGrants.map((g) => g.bucket);

  const userEnv = await mergeR2S3EnvFromUserStorage(env, authUser);
  let byokNames = [];
  const byokConnected = !!(userEnv.R2_ACCESS_KEY_ID && userEnv.R2_SECRET_ACCESS_KEY);
  if (byokConnected && typeof opts.listAccountViaS3 === 'function') {
    const account = await opts.listAccountViaS3(userEnv);
    byokNames = account || [];
  }

  const merged = [];
  const seen = new Set();
  for (const name of [...workspaceBucketNames, ...byokNames]) {
    const n = String(name || '').trim();
    if (!n || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    merged.push(n);
  }

  if (merged.length) {
    return {
      buckets: merged,
      bound: merged,
      workspace_buckets: workspaceBucketNames,
      source: workspaceBucketNames.length && byokNames.length
        ? 'workspace_membership+customer_s3'
        : workspaceBucketNames.length
          ? 'workspace_membership'
          : 'customer_s3',
      count: merged.length,
      platform_r2_visible: false,
      r2_byok_connected: byokConnected,
    };
  }

  return {
    buckets: [],
    bound: [],
    workspace_buckets: [],
    source: byokConnected ? 'customer_s3_empty' : 'customer_disconnected',
    count: 0,
    platform_r2_visible: false,
    r2_byok_connected: byokConnected,
    user_message: byokConnected
      ? 'No R2 buckets in your account yet. Workspace-shared buckets appear when you join a collab workspace.'
      : 'Connect your Cloudflare R2 access key + secret in Settings → Storage to browse your buckets.',
  };
}
