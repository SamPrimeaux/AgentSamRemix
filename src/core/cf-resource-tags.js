/**
 * Cloudflare Resource Tagging — account-level key→value tags.
 *
 * Public beta 2026-04-27. This is NOT Images/Stream `metadata` / `iam_tags` — it is the
 * standalone Resource Tagging product that powers the CF dashboard "+ Add tag" UI.
 *
 * Supported types we use:
 * - `image` — Cloudflare Images
 * - `stream_video` — Cloudflare Stream VOD (same API as Images; different resource_type)
 *
 * Docs:
 * - Overview: https://developers.cloudflare.com/resource-tagging/
 * - Manage tags (GET / merge / PUT): https://developers.cloudflare.com/resource-tagging/how-to/manage-tags/
 * - Resource types: https://developers.cloudflare.com/resource-tagging/reference/resource-types/
 * - Changelog / beta quirks: https://developers.cloudflare.com/changelog/post/2026-04-27-resource-tagging-public-beta/
 *
 * Token: prefer `CLOUDFLARE_TAGGING_TOKEN` (Account Owned Token + Tag Admin).
 * Falls back to `CLOUDFLARE_IMAGES_TOKEN` / `CLOUDFLARE_API_TOKEN` only if that
 * token already has Tag Admin (or Super Admin / Workers Admin).
 */

export const RESOURCE_TYPE_IMAGE = 'image';
export const RESOURCE_TYPE_STREAM_VIDEO = 'stream_video';

/** @param {{ resourceType?: string, resource_type?: string }} [opts] */
function resolveResourceType(opts = {}) {
  const t = trim(opts.resourceType || opts.resource_type);
  return t || RESOURCE_TYPE_IMAGE;
}
const MAX_KEY_LEN = 256;
const MAX_VALUE_LEN = 1024;
const MAX_FILTERS = 20;
const MAX_OR_VALUES = 10;
const QUERY_PAGE_SIZE = 100;

/** Tag key: Unicode letters/digits/_/./- only — CF error code 1014 on reject. */
const TAG_KEY_RE = /^[\p{L}\p{N}_.-]+$/u;

export class ResourceTagValidationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ResourceTagValidationError';
    this.code = code || null;
  }
}

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * Resolve account + bearer for Resource Tagging.
 * Prefer dedicated AOT (`CLOUDFLARE_TAGGING_TOKEN`); do not invent a second refresh path.
 * @param {Record<string, unknown>} env
 * @param {{ accountId?: string, token?: string }} [override]
 */
export function resolveResourceTaggingCreds(env, override = {}) {
  const accountId =
    trim(override.accountId) || trim(env?.CLOUDFLARE_ACCOUNT_ID);
  const token =
    trim(override.token) ||
    trim(env?.CLOUDFLARE_TAGGING_TOKEN) ||
    trim(env?.CLOUDFLARE_IMAGES_TOKEN) ||
    trim(env?.CLOUDFLARE_IMAGES_API_TOKEN) ||
    trim(env?.CLOUDFLARE_API_TOKEN);
  if (!accountId || !token) {
    return {
      ok: false,
      error:
        'Resource Tagging not configured — set CLOUDFLARE_TAGGING_TOKEN (Tag Admin AOT) + CLOUDFLARE_ACCOUNT_ID',
    };
  }
  return {
    ok: true,
    accountId,
    token,
    source: trim(override.token)
      ? 'override'
      : trim(env?.CLOUDFLARE_TAGGING_TOKEN)
        ? 'CLOUDFLARE_TAGGING_TOKEN'
        : trim(env?.CLOUDFLARE_IMAGES_TOKEN || env?.CLOUDFLARE_IMAGES_API_TOKEN)
          ? 'CLOUDFLARE_IMAGES_TOKEN'
          : 'CLOUDFLARE_API_TOKEN',
  };
}

/** @param {string} key */
export function assertValidTagKey(key) {
  const k = trim(key);
  if (!k) {
    throw new ResourceTagValidationError('Tag key is required (CF error code 1014)', 1014);
  }
  if (k.length > MAX_KEY_LEN) {
    throw new ResourceTagValidationError(
      `Tag key exceeds ${MAX_KEY_LEN} chars (CF error code 1014)`,
      1014,
    );
  }
  if (!TAG_KEY_RE.test(k) || /\s/.test(k)) {
    throw new ResourceTagValidationError(
      'Tag key allows only letters, digits, underscore, period, hyphen — no spaces (CF error code 1014)',
      1014,
    );
  }
  return k;
}

/** @param {string} value */
export function assertValidTagValue(value) {
  const v = value == null ? '' : String(value);
  if (v.length > MAX_VALUE_LEN) {
    throw new ResourceTagValidationError(
      `Tag value exceeds ${MAX_VALUE_LEN} chars (CF error code 1012)`,
      1012,
    );
  }
  return v;
}

/** @param {Record<string, string>} tagsObject */
export function assertValidTagsObject(tagsObject) {
  const out = {};
  if (!tagsObject || typeof tagsObject !== 'object' || Array.isArray(tagsObject)) {
    throw new ResourceTagValidationError('tags must be a key→value object');
  }
  for (const [rawKey, rawVal] of Object.entries(tagsObject)) {
    const key = assertValidTagKey(rawKey);
    out[key] = assertValidTagValue(rawVal);
  }
  return out;
}

function tagsBase(accountId) {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/tags`;
}

async function cfJson(res) {
  return res.json().catch(() => ({}));
}

function firstCfError(data) {
  return data?.errors?.[0]?.message || data?.messages?.[0]?.message || null;
}

/**
 * GET tags for one image.
 * Beta quirk: never-tagged resources return **500**, not 404 — treat as empty {}.
 * @see https://developers.cloudflare.com/changelog/post/2026-04-27-resource-tagging-public-beta/
 */
export async function getResourceTags(env, resourceId, opts = {}) {
  const creds = resolveResourceTaggingCreds(env, opts);
  if (!creds.ok) return { ok: false, error: creds.error, tags: {} };
  const id = trim(resourceId);
  if (!id) return { ok: false, error: 'resource_id required', tags: {} };

  const qs = new URLSearchParams({
    resource_type: resolveResourceType(opts),
    resource_id: id,
  });
  const res = await fetch(`${tagsBase(creds.accountId)}?${qs}`, {
    headers: { Authorization: `Bearer ${creds.token}` },
  });
  const data = await cfJson(res);

  // Known beta: never-tagged → 500
  if (res.status === 500) {
    return { ok: true, tags: {}, empty: true, beta_untagged: true };
  }
  if (res.status === 404) {
    return { ok: true, tags: {}, empty: true };
  }
  if (!res.ok || data?.success === false) {
    return {
      ok: false,
      error: firstCfError(data) || `Resource Tagging GET failed (${res.status})`,
      status: res.status,
      tags: {},
    };
  }

  const result = data?.result;
  let tags = {};
  if (result && typeof result === 'object') {
    if (result.tags && typeof result.tags === 'object' && !Array.isArray(result.tags)) {
      tags = { ...result.tags };
    } else if (!Array.isArray(result) && result.resource_id == null) {
      tags = { ...result };
    }
  }
  return { ok: true, tags, result };
}

/**
 * PUT replaces ALL tags on the image — not a merge.
 * @see https://developers.cloudflare.com/resource-tagging/how-to/manage-tags/
 */
export async function setResourceTags(env, resourceId, tagsObject, opts = {}) {
  const creds = resolveResourceTaggingCreds(env, opts);
  if (!creds.ok) return { ok: false, error: creds.error };
  const id = trim(resourceId);
  if (!id) return { ok: false, error: 'resource_id required' };

  let tags;
  try {
    tags = assertValidTagsObject(tagsObject || {});
  } catch (e) {
    return { ok: false, error: e.message, code: e.code || null, status: 400 };
  }

  const res = await fetch(tagsBase(creds.accountId), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      resource_type: resolveResourceType(opts),
      resource_id: id,
      tags,
    }),
  });
  const data = await cfJson(res);
  if (!res.ok || data?.success === false) {
    return {
      ok: false,
      error: firstCfError(data) || `Resource Tagging PUT failed (${res.status})`,
      status: res.status,
    };
  }
  return { ok: true, tags, result: data?.result };
}

/**
 * GET → merge one key → PUT full set (common "+ Add tag" path).
 * @see https://developers.cloudflare.com/resource-tagging/how-to/manage-tags/#add-a-single-tag
 */
export async function mergeResourceTag(env, resourceId, key, value, opts = {}) {
  let k;
  let v;
  try {
    k = assertValidTagKey(key);
    v = assertValidTagValue(value);
  } catch (e) {
    return { ok: false, error: e.message, code: e.code || null, status: 400 };
  }
  const current = await getResourceTags(env, resourceId, opts);
  if (!current.ok && !current.beta_untagged) {
    // Still try PUT with single tag if GET hard-failed for other reasons? Prefer fail.
    if (!current.empty) return current;
  }
  const next = { ...(current.tags || {}), [k]: v };
  return setResourceTags(env, resourceId, next, opts);
}

/**
 * GET → omit key → PUT remaining (no single-key DELETE in the API).
 */
export async function removeResourceTag(env, resourceId, key, opts = {}) {
  let k;
  try {
    k = assertValidTagKey(key);
  } catch (e) {
    return { ok: false, error: e.message, code: e.code || null, status: 400 };
  }
  const current = await getResourceTags(env, resourceId, opts);
  if (!current.ok && !current.empty && !current.beta_untagged) return current;
  const next = { ...(current.tags || {}) };
  delete next[k];
  return setResourceTags(env, resourceId, next, opts);
}

/** GET /accounts/{account_id}/tags/keys */
export async function listAccountTagKeys(env, opts = {}) {
  const creds = resolveResourceTaggingCreds(env, opts);
  if (!creds.ok) return { ok: false, error: creds.error, keys: [] };

  const res = await fetch(`${tagsBase(creds.accountId)}/keys`, {
    headers: { Authorization: `Bearer ${creds.token}` },
  });
  const data = await cfJson(res);
  if (!res.ok || data?.success === false) {
    return {
      ok: false,
      error: firstCfError(data) || `list keys failed (${res.status})`,
      status: res.status,
      keys: [],
    };
  }
  const raw = data?.result;
  const keys = Array.isArray(raw)
    ? raw.map((x) => (typeof x === 'string' ? x : trim(x?.key || x?.name || x?.tag_key))).filter(Boolean)
    : Array.isArray(raw?.keys)
      ? raw.keys.map((x) => String(x)).filter(Boolean)
      : [];
  return { ok: true, keys, result: raw };
}

/** GET /accounts/{account_id}/tags/values/{tag_key}?type=image */
export async function listValuesForKey(env, key, opts = {}) {
  const creds = resolveResourceTaggingCreds(env, opts);
  if (!creds.ok) return { ok: false, error: creds.error, values: [] };
  let k;
  try {
    k = assertValidTagKey(key);
  } catch (e) {
    return { ok: false, error: e.message, code: e.code || null, values: [], status: 400 };
  }

  const qs = new URLSearchParams({ type: resolveResourceType(opts) });
  const res = await fetch(
    `${tagsBase(creds.accountId)}/values/${encodeURIComponent(k)}?${qs}`,
    { headers: { Authorization: `Bearer ${creds.token}` } },
  );
  const data = await cfJson(res);
  if (!res.ok || data?.success === false) {
    return {
      ok: false,
      error: firstCfError(data) || `list values failed (${res.status})`,
      status: res.status,
      values: [],
    };
  }
  const raw = data?.result;
  const values = Array.isArray(raw)
    ? raw.map((x) => (typeof x === 'string' ? x : trim(x?.value || x?.name))).filter((v) => v !== '')
    : Array.isArray(raw?.values)
      ? raw.values.map((x) => String(x))
      : [];
  return { ok: true, key: k, values, result: raw };
}

/**
 * Build `tag=` query params from filters.
 * @param {Array<{ key: string, value?: string, values?: string[], negate?: boolean }>} filters
 */
export function buildTagQueryParams(filters) {
  if (!Array.isArray(filters)) {
    throw new ResourceTagValidationError('filters must be an array');
  }
  if (filters.length > MAX_FILTERS) {
    throw new ResourceTagValidationError(`Max ${MAX_FILTERS} filters per query`);
  }
  const params = new URLSearchParams();
  for (const f of filters) {
    const key = assertValidTagKey(f.key);
    const negate = !!f.negate;
    if (Array.isArray(f.values) && f.values.length) {
      if (f.values.length > MAX_OR_VALUES) {
        throw new ResourceTagValidationError(`Max ${MAX_OR_VALUES} OR values per key`);
      }
      const vals = f.values.map((v) => assertValidTagValue(v));
      params.append('tag', negate ? `${key}!=${vals.join(',')}` : `${key}=${vals.join(',')}`);
      continue;
    }
    if (f.value != null && String(f.value) !== '') {
      const val = assertValidTagValue(f.value);
      params.append('tag', negate ? `${key}!=${val}` : `${key}=${val}`);
      continue;
    }
    params.append('tag', negate ? `!${key}` : key);
  }
  return params;
}

/**
 * GET /accounts/{account_id}/tags/resources?tag=...
 * Cursor pagination via result_info.cursor; page size 100.
 */
export async function queryResourcesByTag(env, filters, opts = {}) {
  const creds = resolveResourceTaggingCreds(env, opts);
  if (!creds.ok) return { ok: false, error: creds.error, resources: [] };

  let params;
  try {
    params = buildTagQueryParams(filters || []);
  } catch (e) {
    return { ok: false, error: e.message, resources: [], status: 400 };
  }
  params.set('per_page', String(QUERY_PAGE_SIZE));
  if (opts.cursor) params.set('cursor', String(opts.cursor));
  if (opts.resource_type) params.set('resource_type', String(opts.resource_type));
  else params.set('resource_type', RESOURCE_TYPE_IMAGE);

  const res = await fetch(`${tagsBase(creds.accountId)}/resources?${params}`, {
    headers: { Authorization: `Bearer ${creds.token}` },
  });
  const data = await cfJson(res);
  if (!res.ok || data?.success === false) {
    return {
      ok: false,
      error: firstCfError(data) || `query resources failed (${res.status})`,
      status: res.status,
      resources: [],
    };
  }
  const resources = Array.isArray(data?.result)
    ? data.result
    : Array.isArray(data?.result?.resources)
      ? data.result.resources
      : [];
  return {
    ok: true,
    resources,
    result_info: data?.result_info || null,
    cursor: data?.result_info?.cursor || null,
  };
}

/**
 * Best-effort sync of a full tags object onto a CF Image id.
 * Failures do not throw — callers log and continue (beta).
 */
export async function syncImageResourceTags(env, cloudflareImageId, tagsObject, opts = {}) {
  const id = trim(cloudflareImageId);
  if (!id) return { ok: false, skipped: true, error: 'no cloudflare_image_id' };
  try {
    return await setResourceTags(env, id, tagsObject || {}, opts);
  } catch (e) {
    return { ok: false, error: e?.message || 'syncImageResourceTags failed' };
  }
}
