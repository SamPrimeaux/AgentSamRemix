/**
 * R2 image organization via customMetadata (S3-style x-amz-meta-* on Workers put/head).
 *
 * R2 has no native tag API — use compact string key/value pairs on the object.
 * Budget: 2048 bytes total (S3 user-metadata limit). Full notes live in `{key}.iammeta.json` sidecar.
 *
 * Keys mirror CF Images iam_* fields so dashboard + MCP tools share one vocabulary.
 */

/** @typedef {{ userId?: string, workspaceId?: string, tenantId?: string }} IamScope */

export const R2_CUSTOM_META_MAX_BYTES = 2048;

export const IAM_R2_META_KEYS = {
  tags: 'iam_tags',
  label: 'iam_label',
  category: 'iam_category',
  projectSlug: 'iam_project_slug',
  tenantSlug: 'iam_tenant_slug',
  tenantId: 'iam_tenant_id',
  altText: 'iam_alt_text',
  notes: 'iam_notes',
  isLive: 'iam_is_live',
  preferredBg: 'iam_preferred_bg',
  userId: 'iam_user_id',
  workspaceId: 'iam_workspace_id',
  description: 'iam_description',
};

function parseTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim()).filter(Boolean);
  try {
    const p = JSON.parse(String(raw));
    return Array.isArray(p) ? p.map((t) => String(t).trim()).filter(Boolean) : [];
  } catch {
    return String(raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
}

export function normalizeTags(raw) {
  if (raw == null) return [];
  const list = Array.isArray(raw) ? raw : parseTags(raw);
  const seen = new Set();
  const out = [];
  for (const t of list) {
    const tag = String(t || '').trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/**
 * Parse IAM fields from R2 customMetadata or CF Images meta (shared key names).
 * @param {Record<string, string> | null | undefined} raw
 */
export function parseIamMetaFromStorage(raw) {
  const m = raw && typeof raw === 'object' ? raw : {};
  const tagRaw = m[IAM_R2_META_KEYS.tags] ?? m.iam_tags ?? m.tags;
  const tags = normalizeTags(tagRaw);
  return {
    tags,
    alt_text: m[IAM_R2_META_KEYS.altText] ? String(m[IAM_R2_META_KEYS.altText]) : null,
    description: m[IAM_R2_META_KEYS.description] ? String(m[IAM_R2_META_KEYS.description]) : null,
    meta: {
      label: String(m[IAM_R2_META_KEYS.label] || m.filename || m.name || '').trim(),
      is_live:
        m[IAM_R2_META_KEYS.isLive] === '1'
        || m[IAM_R2_META_KEYS.isLive] === 1
        || m[IAM_R2_META_KEYS.isLive] === true
        || m[IAM_R2_META_KEYS.isLive] === 'true',
      preferred_bg: String(m[IAM_R2_META_KEYS.preferredBg] || '').trim(),
      notes: String(m[IAM_R2_META_KEYS.notes] || '').trim(),
      tenant_slug: String(m[IAM_R2_META_KEYS.tenantSlug] || '').trim(),
      category: String(m[IAM_R2_META_KEYS.category] || '').trim(),
      project_slug: String(m[IAM_R2_META_KEYS.projectSlug] || '').trim(),
    },
  };
}

/**
 * Build compact customMetadata map for R2 put/head (all values are strings).
 * @param {{ tags?: unknown, meta?: Record<string, unknown>, scope?: IamScope, alt_text?: string | null, description?: string | null }} input
 * @returns {Record<string, string>}
 */
export function buildR2CustomMetadata(input) {
  const { tags, meta, scope, alt_text, description } = input || {};
  const normalized = normalizeTags(tags);
  /** @type {Record<string, string>} */
  const out = {};

  if (scope?.userId) out[IAM_R2_META_KEYS.userId] = String(scope.userId).slice(0, 64);
  if (scope?.workspaceId) out[IAM_R2_META_KEYS.workspaceId] = String(scope.workspaceId).slice(0, 64);
  if (scope?.tenantId) out[IAM_R2_META_KEYS.tenantId] = String(scope.tenantId).slice(0, 64);

  if (normalized.length) out[IAM_R2_META_KEYS.tags] = normalized.join(',').slice(0, 400);
  if (meta?.label) out[IAM_R2_META_KEYS.label] = String(meta.label).slice(0, 120);
  if (meta?.category) out[IAM_R2_META_KEYS.category] = String(meta.category).slice(0, 64);
  if (meta?.project_slug) out[IAM_R2_META_KEYS.projectSlug] = String(meta.project_slug).slice(0, 64);
  if (meta?.tenant_slug) out[IAM_R2_META_KEYS.tenantSlug] = String(meta.tenant_slug).slice(0, 64);
  if (meta?.preferred_bg) out[IAM_R2_META_KEYS.preferredBg] = String(meta.preferred_bg).slice(0, 16);
  if (meta?.is_live) out[IAM_R2_META_KEYS.isLive] = '1';
  if (meta?.notes) out[IAM_R2_META_KEYS.notes] = String(meta.notes).slice(0, 240);
  if (alt_text) out[IAM_R2_META_KEYS.altText] = String(alt_text).slice(0, 160);
  if (description) out[IAM_R2_META_KEYS.description] = String(description).slice(0, 160);

  return trimR2CustomMetadata(out);
}

/**
 * Enforce S3/R2 ~2KB user-metadata budget by trimming notes then tags.
 * @param {Record<string, string>} meta
 * @returns {Record<string, string>}
 */
export function trimR2CustomMetadata(meta) {
  const out = { ...meta };
  let size = metadataByteSize(out);

  while (size > R2_CUSTOM_META_MAX_BYTES && out[IAM_R2_META_KEYS.notes]) {
    const notes = out[IAM_R2_META_KEYS.notes];
    out[IAM_R2_META_KEYS.notes] = notes.slice(0, Math.max(0, notes.length - 48));
    if (!out[IAM_R2_META_KEYS.notes]) delete out[IAM_R2_META_KEYS.notes];
    size = metadataByteSize(out);
  }

  while (size > R2_CUSTOM_META_MAX_BYTES && out[IAM_R2_META_KEYS.description]) {
    const d = out[IAM_R2_META_KEYS.description];
    out[IAM_R2_META_KEYS.description] = d.slice(0, Math.max(0, d.length - 48));
    if (!out[IAM_R2_META_KEYS.description]) delete out[IAM_R2_META_KEYS.description];
    size = metadataByteSize(out);
  }

  while (size > R2_CUSTOM_META_MAX_BYTES && out[IAM_R2_META_KEYS.tags]) {
    const parts = out[IAM_R2_META_KEYS.tags].split(',');
    parts.pop();
    if (parts.length) out[IAM_R2_META_KEYS.tags] = parts.join(',');
    else delete out[IAM_R2_META_KEYS.tags];
    size = metadataByteSize(out);
  }

  return out;
}

function metadataByteSize(meta) {
  return new TextEncoder().encode(JSON.stringify(meta)).byteLength;
}

/**
 * @param {import('@cloudflare/workers-types').R2Bucket | null | undefined} binding
 * @param {string} r2Key
 */
export async function headR2ImageIamMeta(binding, r2Key) {
  if (!binding?.head || !r2Key) return null;
  const head = await binding.head(r2Key).catch(() => null);
  if (!head?.customMetadata || typeof head.customMetadata !== 'object') return null;
  return parseIamMetaFromStorage(head.customMetadata);
}

/**
 * Put object bytes with IAM customMetadata on the R2 object.
 * @param {import('@cloudflare/workers-types').R2Bucket} binding
 * @param {string} r2Key
 * @param {ArrayBuffer | ArrayBufferView | ReadableStream | Blob | string | null} body
 * @param {{ contentType?: string, tags?: unknown, meta?: Record<string, unknown>, scope?: IamScope, alt_text?: string | null, description?: string | null, extra?: Record<string, string> }} opts
 */
export async function putR2ImageWithCustomMetadata(binding, r2Key, body, opts = {}) {
  const customMetadata = trimR2CustomMetadata({
    ...buildR2CustomMetadata(opts),
    ...(opts.extra || {}),
  });
  const contentType = opts.contentType || 'application/octet-stream';
  await binding.put(r2Key, body, {
    httpMetadata: { contentType },
    customMetadata,
  });
  return customMetadata;
}

/**
 * Re-put existing object to refresh customMetadata (R2 has no metadata-only PATCH).
 * @param {import('@cloudflare/workers-types').R2Bucket} binding
 * @param {string} r2Key
 * @param {{ tags?: unknown, meta?: Record<string, unknown>, scope?: IamScope, alt_text?: string | null, description?: string | null, sizeBytes?: number, maxBytes?: number }} opts
 */
export async function syncR2ObjectCustomMetadata(binding, r2Key, opts = {}) {
  if (!binding?.put || !r2Key) return { ok: false, error: 'R2 not configured' };

  const maxBytes = opts.maxBytes ?? 15 * 1024 * 1024;
  const byteSize = Number(opts.sizeBytes) || 0;
  const customMetadata = buildR2CustomMetadata(opts);

  if (byteSize <= 0 || byteSize > maxBytes || !binding.get) {
    return { ok: true, customMetadata, object_updated: false };
  }

  const obj = await binding.get(r2Key).catch(() => null);
  if (!obj?.body) {
    return { ok: true, customMetadata, object_updated: false };
  }

  const buf = obj.body instanceof ArrayBuffer
    ? obj.body
    : await new Response(obj.body).arrayBuffer();

  await binding.put(r2Key, buf, {
    httpMetadata: obj.httpMetadata || { contentType: 'application/octet-stream' },
    customMetadata,
  });

  return { ok: true, customMetadata, object_updated: true };
}

export function mergeTagLists(...lists) {
  return normalizeTags(lists.flat().filter(Boolean));
}

/**
 * Merge R2 head metadata into dashboard list items when D1 fields are empty (legacy objects).
 * @template T
 * @param {import('@cloudflare/workers-types').R2Bucket | null | undefined} binding
 * @param {T[]} items
 * @param {{ maxLookups?: number }} [opts]
 * @returns {Promise<T[]>}
 */
export async function enrichItemsFromR2CustomMetadata(binding, items, opts = {}) {
  if (!binding?.head || !items?.length) return items;

  const maxLookups = opts.maxLookups ?? 48;
  const candidates = items.filter(
    (item) =>
      item.r2_key
      && (
        !item.tags?.length
        || !item.meta?.category
        || !item.meta?.project_slug
        || !item.alt_text
      ),
  );
  if (!candidates.length) return items;

  /** @type {Map<string, ReturnType<typeof parseIamMetaFromStorage>>} */
  const byKey = new Map();

  await Promise.all(
    candidates.slice(0, maxLookups).map(async (item) => {
      const parsed = await headR2ImageIamMeta(binding, item.r2_key);
      if (parsed) byKey.set(item.r2_key, parsed);
    }),
  );

  if (!byKey.size) return items;

  return items.map((item) => {
    const r2 = item.r2_key ? byKey.get(item.r2_key) : null;
    if (!r2) return item;
    return {
      ...item,
      tags: mergeTagLists(item.tags, r2.tags),
      alt_text: item.alt_text || r2.alt_text || null,
      description: item.description || r2.description || null,
      meta: {
        ...(item.meta || {}),
        label: item.meta?.label || r2.meta.label || item.filename,
        category: item.meta?.category || r2.meta.category || '',
        project_slug: item.meta?.project_slug || r2.meta.project_slug || '',
        tenant_slug: item.meta?.tenant_slug || r2.meta.tenant_slug || '',
        notes: item.meta?.notes || r2.meta.notes || '',
        is_live: item.meta?.is_live || r2.meta.is_live || false,
        preferred_bg: item.meta?.preferred_bg || r2.meta.preferred_bg || '',
      },
    };
  });
}
