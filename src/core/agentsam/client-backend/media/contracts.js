export const MEDIA_ASSET_SCHEMA = 'iam.media.asset.v1';
export const MEDIA_ASSET_USAGE_SCHEMA = 'iam.media.asset-usage.v1';

function text(value) {
  return value == null ? '' : String(value).trim();
}

function nullable(value) {
  const valueText = text(value);
  return valueText || null;
}

function nonNegativeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function positiveInteger(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function tags(value) {
  const seen = new Set();
  const out = [];
  for (const raw of list(value)) {
    const tag = text(raw).toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

function extension(value) {
  const ext = text(value).toLowerCase().replace(/^\./, '');
  return ext || null;
}

function normalizeSha256(value) {
  const hash = text(value).toLowerCase();
  return /^[a-f0-9]{64}$/.test(hash) ? hash : null;
}

function resolveAspectRatio(width, height, supplied) {
  const explicit = nonNegativeNumber(supplied);
  if (explicit && explicit > 0) return explicit;
  if (width && height) return width / height;
  return null;
}

/**
 * Canonical physical/logical media asset descriptor.
 * Persistence adapters may map this to the existing media_assets table.
 * A repeated use of the asset belongs in AssetUsage, never as another asset row.
 */
export function normalizeMediaAsset(input = {}, scope = {}) {
  const storage = object(input.storage);
  const source = object(input.source);
  const file = object(input.file);
  const width = positiveInteger(input.width ?? file.width);
  const height = positiveInteger(input.height ?? file.height);
  const sourceUri = nullable(input.source_uri ?? input.source_url ?? source.url);
  const normalizedSourceUri = nullable(
    input.normalized_source_uri ?? input.normalized_source_url ?? source.normalized_url,
  );
  const checksum = normalizeSha256(
    input.checksum_sha256 ?? input.sha256 ?? file.checksum_sha256 ?? file.sha256,
  );

  return {
    schema: MEDIA_ASSET_SCHEMA,
    id: nullable(input.id),
    tenant_id: nullable(scope.tenantId ?? scope.tenant_id ?? input.tenant_id),
    workspace_id: nullable(scope.workspaceId ?? scope.workspace_id ?? input.workspace_id),
    project_id: nullable(scope.projectId ?? scope.project_id ?? input.project_id),
    site_id: nullable(scope.siteId ?? scope.site_id ?? input.site_id),
    source_kind: nullable(input.source_kind ?? source.kind) || 'website',
    source_uri: sourceUri,
    normalized_source_uri: normalizedSourceUri,
    canonical_source_id: nullable(
      input.canonical_source_id ?? input.canonical_source_asset_identity ?? source.canonical_id,
    ),
    source_domain: nullable(input.source_domain ?? source.domain),
    bucket: nullable(input.bucket ?? input.r2_bucket ?? storage.bucket),
    object_key: nullable(input.object_key ?? input.r2_key ?? storage.key),
    filename: nullable(input.filename ?? input.original_filename ?? file.name),
    content_type: nullable(input.content_type ?? input.mime_type ?? file.mime_type),
    media_kind: nullable(input.media_kind ?? input.kind ?? file.kind) || 'unknown',
    size_bytes: nonNegativeNumber(input.size_bytes ?? input.bytes ?? file.bytes),
    width,
    height,
    aspect_ratio: resolveAspectRatio(width, height, input.aspect_ratio ?? file.aspect_ratio),
    orientation: nullable(input.orientation ?? file.orientation),
    original_extension: extension(input.original_extension ?? file.original_extension),
    optimized_extension: extension(input.optimized_extension ?? file.optimized_extension),
    checksum_sha256: checksum,
    etag: nullable(input.etag ?? file.etag),
    exif: Object.keys(object(input.exif ?? file.exif)).length ? object(input.exif ?? file.exif) : null,
    delivery_url: nullable(input.delivery_url ?? input.public_url),
    tags: tags(input.tags),
    metadata: object(input.metadata ?? input.metadata_json),
    imported_at: input.imported_at ?? null,
    created_at: input.created_at ?? null,
    updated_at: input.updated_at ?? null,
  };
}

/**
 * A contextual occurrence of an asset. One Asset can have many AssetUsage records.
 */
export function normalizeMediaAssetUsage(input = {}, scope = {}) {
  return {
    schema: MEDIA_ASSET_USAGE_SCHEMA,
    id: nullable(input.id),
    asset_id: nullable(input.asset_id),
    tenant_id: nullable(scope.tenantId ?? scope.tenant_id ?? input.tenant_id),
    workspace_id: nullable(scope.workspaceId ?? scope.workspace_id ?? input.workspace_id),
    project_id: nullable(scope.projectId ?? scope.project_id ?? input.project_id),
    site_id: nullable(scope.siteId ?? scope.site_id ?? input.site_id),
    page_id: nullable(input.page_id),
    page_url: nullable(input.page_url),
    section_id: nullable(input.section_id),
    source_url: nullable(input.source_url ?? input.occurrence_url),
    normalized_source_url: nullable(input.normalized_source_url),
    discovery_kind: nullable(input.discovery_kind),
    source_attribute: nullable(input.source_attribute ?? input.source_attr),
    alt_text: nullable(input.alt_text ?? input.alt),
    title: nullable(input.title),
    caption: nullable(input.caption),
    context: nullable(input.context),
    occurrence_index: nonNegativeNumber(input.occurrence_index),
    metadata: object(input.metadata ?? input.metadata_json),
    first_seen_at: input.first_seen_at ?? input.created_at ?? null,
  };
}

export function validateMediaAsset(asset) {
  const value = normalizeMediaAsset(asset);
  const errors = [];
  if (!value.tenant_id) errors.push('tenant_id_required');
  if (!value.workspace_id) errors.push('workspace_id_required');
  if (!value.bucket) errors.push('bucket_required');
  if (!value.object_key) errors.push('object_key_required');
  if (!value.content_type) errors.push('content_type_required');
  return { ok: errors.length === 0, errors, asset: value };
}

export function validateMediaAssetUsage(usage) {
  const value = normalizeMediaAssetUsage(usage);
  const errors = [];
  if (!value.asset_id) errors.push('asset_id_required');
  if (!value.tenant_id) errors.push('tenant_id_required');
  if (!value.workspace_id) errors.push('workspace_id_required');
  if (!value.page_id && !value.page_url && !value.project_id && !value.section_id) {
    errors.push('usage_context_required');
  }
  return { ok: errors.length === 0, errors, usage: value };
}
