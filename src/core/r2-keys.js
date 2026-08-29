/**
 * R2 object key normalization and upload policy guards.
 */

const TRAVERSAL = /(?:^|\/)\.\.(?:\/|$)|^\//;
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

/** Allowed upload prefixes for dashboard media (workspace-scoped when possible). */
export const DASHBOARD_UPLOAD_PREFIXES = [
  'workspaces/',
  'workspace-media/',
  'uploads/',
  'media/',
  'captures/',
  'cms/themes/',
  'cms/pages/',
  'moviemode/',
  'users/',
  'projects/',
  /** Project brand kit uploads (resolveProjectStorageScope → brand/{projectId}/) */
  'brand/',
];

const MAX_OBJECT_BYTES = 5 * 1024 * 1024 * 1024; // 5 GiB R2 limit guard

/**
 * Normalize and validate an object key. Returns { ok, key, error }.
 * @param {string} rawKey
 * @param {{ workspaceId?: string, allowAnyPrefix?: boolean }} [opts]
 */
export function normalizeR2ObjectKey(rawKey, opts = {}) {
  let key = String(rawKey || '').trim();
  if (!key) return { ok: false, error: 'empty_key' };

  try {
    key = decodeURIComponent(key);
  } catch {
    /* keep raw */
  }

  key = key.replace(/\\/g, '/').replace(/^\/+/, '');
  while (key.includes('//')) key = key.replace('//', '/');

  if (TRAVERSAL.test(key) || CONTROL_CHARS.test(key)) {
    return { ok: false, error: 'invalid_key_path' };
  }

  if (!opts.allowAnyPrefix) {
    const allowed = DASHBOARD_UPLOAD_PREFIXES.some((p) => key.startsWith(p));
    if (!allowed) {
      if (opts.workspaceId) {
        const wsPrefix = `workspaces/${opts.workspaceId}/`;
        if (!key.startsWith(wsPrefix)) {
          return { ok: false, error: 'key_prefix_not_allowed' };
        }
      } else {
        return { ok: false, error: 'key_prefix_not_allowed' };
      }
    }
  }

  return { ok: true, key };
}

export function assertUploadSize(byteLength) {
  const n = Number(byteLength) || 0;
  if (n <= 0) return { ok: false, error: 'empty_body' };
  if (n > MAX_OBJECT_BYTES) return { ok: false, error: 'object_too_large' };
  return { ok: true, bytes: n };
}

export const MULTIPART_THRESHOLD_BYTES = 100 * 1024 * 1024;
export const RECOMMENDED_PART_SIZE = 8 * 1024 * 1024;
export const MIN_PART_SIZE = 5 * 1024 * 1024;
