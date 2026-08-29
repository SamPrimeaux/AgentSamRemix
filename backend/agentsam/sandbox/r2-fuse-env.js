/**
 * Default R2 FUSE for MY_CONTAINER sandbox — durable cwd/assets at /mnt/r2/{prefix}/{zone_slug}/…
 * Maps worker R2 S3 secrets into container env (not optional for production sandbox exec).
 * @see docs/platform/sandbox-r2-fuse-default.md
 * @see https://developers.cloudflare.com/containers/examples/r2-fuse-mount/
 */

function trim(v) {
  return v != null ? String(v).trim() : '';
}

function resolveContainerPoolId(env) {
  return trim(env?.CONTAINER_POOL_ID) || 'inneranimalmedia';
}

/** @param {string} raw */
export function normalizeR2Prefix(raw) {
  return trim(raw).replace(/^\/+|\/+$/g, '');
}

/**
 * True when platform worker has R2 S3 credentials for container FUSE (secrets, not bindings).
 * @param {any} env
 */
export function sandboxR2FuseConfigured(env) {
  if (trim(env?.IAM_SANDBOX_R2_FUSE) === '0') return false;
  return !!(
    trim(env?.R2_ACCESS_KEY_ID) &&
    trim(env?.R2_SECRET_ACCESS_KEY) &&
    trim(env?.CLOUDFLARE_ACCOUNT_ID)
  );
}

/**
 * Env vars passed to MyContainer at start (no secrets in API responses — use redact helper).
 * @param {any} env
 * @param {{ r2Prefix?: string, workspaceId?: string }} [opts]
 */
export function buildSandboxR2FuseEnvVars(env, opts = {}) {
  const poolId = resolveContainerPoolId(env);
  /** @type {Record<string, string>} */
  const base = {
    CONTAINER_POOL_ID: poolId,
    IAM_IMAGE_TAG: 'sandbox-go-v3',
    IAM_SANDBOX_R2_FUSE: trim(env?.IAM_SANDBOX_R2_FUSE) || '1',
    IAM_R2_FUSE_READONLY: trim(env?.IAM_R2_FUSE_READONLY) || '0',
    WRANGLER_SEND_METRICS: 'false',
  };

  if (!sandboxR2FuseConfigured(env)) {
    return base;
  }

  const accessKey = trim(env.R2_ACCESS_KEY_ID);
  const secretKey = trim(env.R2_SECRET_ACCESS_KEY);
  const accountId = trim(env.CLOUDFLARE_ACCOUNT_ID);
  const bucket = trim(env.SANDBOX_R2_BUCKET_NAME || env.IAM_SANDBOX_R2_BUCKET || 'inneranimalmedia');
  const prefix = normalizeR2Prefix(opts.r2Prefix || env.SANDBOX_R2_BUCKET_PREFIX || '');

  return {
    ...base,
    AWS_ACCESS_KEY_ID: accessKey,
    AWS_SECRET_ACCESS_KEY: secretKey,
    R2_ACCESS_KEY_ID: accessKey,
    R2_SECRET_ACCESS_KEY: secretKey,
    R2_ACCOUNT_ID: accountId,
    CLOUDFLARE_ACCOUNT_ID: accountId,
    R2_BUCKET_NAME: bucket,
    R2_ENDPOINT: `https://${accountId}.r2.cloudflarestorage.com`,
    ...(prefix ? { R2_BUCKET_PREFIX: prefix } : {}),
  };
}

/**
 * @param {any} env
 * @param {string|null|undefined} workspaceId
 */
export async function resolveWorkspaceR2Prefix(env, workspaceId) {
  const ws = trim(workspaceId);
  if (!ws || !env?.DB) return '';
  try {
    const row = await env.DB.prepare('SELECT r2_prefix FROM workspaces WHERE id = ? LIMIT 1')
      .bind(ws)
      .first();
    return normalizeR2Prefix(row?.r2_prefix);
  } catch {
    return '';
  }
}

/** Container workspace root — entrypoint symlinks this to R2 FUSE or /tmp/r2. */
export const SANDBOX_WORKSPACE_MOUNT = '/mnt/workspace';

/**
 * Sandbox exec cwd — always writable under /tmp/{zone_slug}.
 * R2 persistence uses S3 API (R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY), not FUSE mount paths.
 * @param {any} _env
 * @param {{ workspaceId?: string|null, zoneSlug?: string, innerPath?: string|null }} opts
 */
export async function resolveSandboxContainerCwd(_env, opts = {}) {
  const zoneSlug = trim(opts.zoneSlug) || 'default';
  const innerPath = trim(opts.innerPath).replace(/^\//, '');
  const parts = [`/tmp/${zoneSlug}`];
  if (innerPath) parts.push(innerPath);
  return parts.join('/');
}

/**
 * Shell prefix for sandbox exec — mkdir /tmp zone scratch only; never depends on FUSE.
 * @param {any} _env
 * @param {string} execCwd
 * @param {string} zoneSlug
 */
export function buildSandboxExecShellPreamble(_env, execCwd, zoneSlug) {
  const cwd = shellQuote(execCwd || `/tmp/${zoneSlug || 'default'}`);
  return `mkdir -p ${cwd} && cd ${cwd}`;
}

/** @param {string} raw */
function shellQuote(raw) {
  const s = String(raw || '');
  if (!/[\s'"$`\\]/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Public summary for health/status (never includes keys).
 * @param {any} env
 * @param {Record<string, unknown>|null|undefined} mountsPayload
 */
export function sandboxR2FusePublicSummary(env, mountsPayload) {
  const configured = sandboxR2FuseConfigured(env);
  const bucket = trim(env?.SANDBOX_R2_BUCKET_NAME || env?.IAM_SANDBOX_R2_BUCKET || 'inneranimalmedia');
  const mounts = Array.isArray(mountsPayload?.mounts) ? mountsPayload.mounts : [];
  const workspaceMount = mounts.find((m) => m && m.name === 'workspace');
  const r2Mount = mounts.find((m) => m && m.name === 'r2');
  return {
    configured,
    enabled: configured && trim(env?.IAM_SANDBOX_R2_FUSE) !== '0',
    bucket: configured ? bucket : null,
    readonly: trim(env?.IAM_R2_FUSE_READONLY) !== '0',
    mounted: Boolean(r2Mount?.mounted || workspaceMount?.mounted),
    mount_root: workspaceMount?.path || '/mnt/workspace',
    prefix: trim(env?.SANDBOX_R2_BUCKET_PREFIX || '') || null,
  };
}
