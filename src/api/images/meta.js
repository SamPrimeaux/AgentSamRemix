import { normalizeTags } from '../../core/r2-image-metadata.js';

const CF_META_MAX_BYTES = 1024;

export function metaSidecarKey(imageKey) {
  return `${imageKey}.iammeta.json`;
}

export function parseTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim()).filter(Boolean);
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p.map((t) => String(t).trim()).filter(Boolean) : [];
  } catch {
    return String(raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
}

export function parseMetadata(raw) {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const p = JSON.parse(String(raw));
    return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
  } catch {
    return {};
  }
}

/**
 * Builds the *custom* metadata object for an image — only fields the user
 * actually set. Previously this always returned a full 7-key skeleton
 * (label/is_live/preferred_bg/notes/tenant_slug/category/project_slug) with
 * empty-string/false fallbacks for anything unset, which made every image
 * look like it had metadata even when CF's own record for it is `{}`. That's
 * a Detail-page UI concern (duplicating fields already shown elsewhere) —
 * the Metadata panel should honor CF's own convention: empty when empty.
 */
export function buildMetaFromRow(row) {
  const metaObj = parseMetadata(row.metadata);
  const out = {};
  // `label` intentionally excludes the filename fallback — a label is only
  // "real" if the user explicitly set one; otherwise it's not metadata,
  // it's just the filename, which already has its own field in the UI.
  if (metaObj.label) out.label = metaObj.label;
  if (metaObj.is_live) out.is_live = true;
  if (metaObj.preferred_bg) out.preferred_bg = metaObj.preferred_bg;
  const notes = metaObj.notes || metaObj.description || row.description || '';
  if (notes) out.notes = notes;
  if (metaObj.tenant_slug) out.tenant_slug = metaObj.tenant_slug;
  if (metaObj.category) out.category = metaObj.category;
  if (metaObj.project_slug) out.project_slug = metaObj.project_slug;
  return out;
}

/** CF Images meta payload — must stay under 1024 bytes (JSON string). */
export function buildCfImagesMetaPayload({ tags, meta, scope, alt_text, filename }) {
  const normalized = normalizeTags(tags);
  /** @type {Record<string, string>} */
  const cfMeta = {
    userId: String(scope.userId || '').slice(0, 64),
    workspaceId: String(scope.workspaceId || '').slice(0, 64),
    tenantId: String(scope.tenantId || '').slice(0, 64),
    filename: String(filename || meta?.label || '').slice(0, 120),
  };
  if (normalized.length) cfMeta.iam_tags = normalized.join(',').slice(0, 400);
  if (meta?.label) cfMeta.iam_label = String(meta.label).slice(0, 120);
  if (meta?.category) cfMeta.iam_category = String(meta.category).slice(0, 64);
  if (meta?.project_slug) cfMeta.iam_project_slug = String(meta.project_slug).slice(0, 64);
  if (meta?.tenant_slug) cfMeta.iam_tenant_slug = String(meta.tenant_slug).slice(0, 64);
  if (meta?.preferred_bg) cfMeta.iam_preferred_bg = String(meta.preferred_bg).slice(0, 16);
  if (meta?.is_live) cfMeta.iam_is_live = '1';
  if (alt_text) cfMeta.iam_alt_text = String(alt_text).slice(0, 160);
  if (meta?.notes) cfMeta.iam_notes = String(meta.notes).slice(0, 240);

  let json = JSON.stringify(cfMeta);
  while (json.length > CF_META_MAX_BYTES && cfMeta.iam_notes) {
    cfMeta.iam_notes = cfMeta.iam_notes.slice(0, Math.max(0, cfMeta.iam_notes.length - 32));
    if (!cfMeta.iam_notes) delete cfMeta.iam_notes;
    json = JSON.stringify(cfMeta);
  }
  while (json.length > CF_META_MAX_BYTES && cfMeta.iam_tags) {
    const parts = cfMeta.iam_tags.split(',');
    parts.pop();
    if (parts.length) cfMeta.iam_tags = parts.join(',');
    else delete cfMeta.iam_tags;
    json = JSON.stringify(cfMeta);
  }
  return cfMeta;
}

export function buildR2SidecarPayload({ tags, meta, alt_text, scope, resource_tags }) {
  const payload = {
    tags: normalizeTags(tags),
    meta: meta || {},
    alt_text: alt_text || null,
    workspace_id: scope?.workspaceId || null,
    user_id: scope?.userId || null,
    tenant_id: scope?.tenantId || null,
    synced_at: new Date().toISOString(),
  };
  if (resource_tags && typeof resource_tags === 'object' && !Array.isArray(resource_tags)) {
    payload.resource_tags = resource_tags;
  }
  return payload;
}

/** CF Resource Tagging key→value map → IAM string tags (`key=value`) for R2 customMetadata. */
export function resourceTagsMapToIamTags(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return [];
  const out = [];
  for (const [k, v] of Object.entries(map)) {
    const key = String(k || '').trim();
    if (!key) continue;
    out.push(`${key}=${String(v ?? '').trim()}`);
  }
  return normalizeTags(out);
}

/** IAM tag list → key→value map for ImageTagPicker (parses `key=value` entries). */
export function iamTagsToResourceTagsMap(tags) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const t of normalizeTags(tags)) {
    const i = t.indexOf('=');
    if (i > 0) out[t.slice(0, i)] = t.slice(i + 1);
    else if (t) out[t] = '';
  }
  return out;
}

export function sanitizeResourceTagsMap(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = String(k || '').trim();
    if (!key) continue;
    out[key] = String(v ?? '').trim();
  }
  return out;
}
