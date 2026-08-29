function parseJson(value, fallback = {}) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function parseTags(value, metadata) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    const parsed = parseJson(value, null);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  const metaTags = metadata?.tags ?? metadata?.iam_tags;
  return Array.isArray(metaTags) ? metaTags.map(String).filter(Boolean) : [];
}

export function resolveCmsAssetKind(mimeType, filename = '') {
  const mime = String(mimeType || '').trim().toLowerCase();
  const name = String(filename || '').trim().toLowerCase();
  if (mime.startsWith('image/') || /\.(avif|webp|jpe?g|png|gif|svg)$/.test(name)) return 'image';
  if (mime.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/.test(name)) return 'video';
  if (mime.startsWith('audio/') || /\.(mp3|wav|m4a|ogg)$/.test(name)) return 'audio';
  if (mime.includes('font') || /\.(woff2?|ttf|otf)$/.test(name)) return 'font';
  if (mime === 'application/pdf' || /\.pdf$/.test(name)) return 'document';
  if (mime.startsWith('text/') || /\.(txt|md|html|css|js|json|xml|csv)$/.test(name)) return 'document';
  if (/\.(glb|gltf|obj|stl|fbx)$/.test(name)) return 'model';
  return mime ? 'binary' : 'unknown';
}

export function normalizeCmsAssetRow(row) {
  if (!row || typeof row !== 'object') return null;
  const metadata = parseJson(row.metadata_json ?? row.metadata, {});
  const name = String(
    row.original_filename || row.filename || row.file_name || row.title || row.label || row.id || '',
  ).trim();
  const r2Key = String(row.r2_key || metadata.r2_key || row.path || '').trim();
  const r2Bucket = String(row.r2_bucket || metadata.r2_bucket || '').trim() || null;
  const publicUrl = String(row.public_url || metadata.public_url || '').trim() || null;
  const thumbnailUrl = String(row.thumbnail_url || metadata.thumbnail_url || '').trim() || null;
  const cdnUrl = String(row.cdn_url || metadata.cdn_url || '').trim() || null;
  const mimeType = String(row.mime_type || metadata.mime_type || '').trim() || null;
  const sizeBytes = Number(row.size_bytes ?? row.size ?? metadata.size_bytes ?? 0) || 0;
  const category = String(row.category || metadata.category || '').trim() || null;
  const usageContext = String(row.usage_context || metadata.usage_context || '').trim() || null;
  const label = String(row.label || metadata.label || '').trim() || null;
  const assetKey = String(row.asset_key || metadata.asset_key || '').trim() || null;

  return {
    id: String(row.id || ''),
    tenant_id: row.tenant_id != null ? String(row.tenant_id) : null,
    workspace_id: row.workspace_id != null ? String(row.workspace_id) : null,
    project_slug: row.project_slug != null ? String(row.project_slug) : null,
    name,
    original_name: String(row.original_filename || row.file_name || row.filename || name).trim(),
    path: String(row.path || metadata.path || r2Key).trim() || null,
    mime_type: mimeType,
    kind: resolveCmsAssetKind(mimeType, name),
    size_bytes: sizeBytes,
    alt_text: String(row.alt_text || metadata.alt_text || '').trim() || null,
    category,
    usage_context: usageContext,
    label,
    asset_key: assetKey,
    tags: parseTags(row.tags, metadata),
    storage: r2Key ? { provider: 'r2', bucket: r2Bucket, key: r2Key } : null,
    urls: {
      public: publicUrl,
      cdn: cdnUrl,
      thumbnail: thumbnailUrl,
    },
    metadata,
    is_live: row.is_live === true || row.is_live === 1 || metadata.is_live === true || metadata.is_live === 1,
    created_at: row.created_at ?? row.created_at_unix ?? null,
    updated_at: row.updated_at ?? null,
  };
}

export function cmsAssetToLegacyRow(asset) {
  if (!asset) return null;
  return {
    id: asset.id,
    filename: asset.name,
    original_filename: asset.original_name || asset.name,
    file_name: asset.name,
    path: asset.path || asset.storage?.key || '',
    r2_key: asset.storage?.key || '',
    r2_bucket: asset.storage?.bucket || null,
    public_url: asset.urls?.public || null,
    cdn_url: asset.urls?.cdn || null,
    thumbnail_url: asset.urls?.thumbnail || null,
    alt_text: asset.alt_text,
    mime_type: asset.mime_type,
    category: asset.category,
    usage_context: asset.usage_context,
    label: asset.label,
    asset_key: asset.asset_key,
    content_size_bytes: asset.size_bytes,
    size: asset.size_bytes,
    tags: asset.tags,
    metadata: asset.metadata,
    created_at: asset.created_at,
    updated_at: asset.updated_at,
  };
}

export function normalizeCmsAssetInput(input = {}, scope = {}) {
  const name = String(input.name || input.original_name || input.original_filename || input.filename || input.file_name || '').trim();
  const key = String(input.r2_key || input.storage?.key || input.path || '').trim();
  const mimeType = String(input.mime_type || '').trim();
  if (!name) return { ok: false, error: 'asset_name_required' };
  if (!key) return { ok: false, error: 'r2_key_required' };
  if (!mimeType) return { ok: false, error: 'mime_type_required' };
  const metadata = input.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {};
  const category = String(input.category || metadata.category || resolveCmsAssetKind(mimeType, name)).trim();
  return {
    ok: true,
    asset: {
      id: String(input.id || '').trim() || `asset_${crypto.randomUUID()}`,
      tenant_id: String(scope.tenantId || scope.authTenantId || input.tenant_id || '').trim() || null,
      workspace_id: String(scope.workspaceId || input.workspace_id || '').trim() || null,
      project_slug: String(scope.projectSlug || input.project_slug || '').trim() || null,
      name,
      original_name: String(input.original_name || input.original_filename || name).trim(),
      path: String(input.path || key).trim(),
      mime_type: mimeType,
      kind: resolveCmsAssetKind(mimeType, name),
      size_bytes: Math.max(0, Number(input.size_bytes ?? input.size ?? 0) || 0),
      alt_text: String(input.alt_text || '').trim() || null,
      category: category || null,
      usage_context: String(input.usage_context || input.context || metadata.usage_context || '').trim() || null,
      label: String(input.label || metadata.label || '').trim() || null,
      asset_key: String(input.asset_key || metadata.asset_key || '').trim() || null,
      tags: parseTags(input.tags, metadata),
      storage: { provider: 'r2', bucket: String(input.r2_bucket || input.storage?.bucket || '').trim() || null, key },
      urls: {
        public: String(input.public_url || input.urls?.public || '').trim() || null,
        cdn: String(input.cdn_url || input.urls?.cdn || '').trim() || null,
        thumbnail: String(input.thumbnail_url || input.urls?.thumbnail || '').trim() || null,
      },
      metadata,
      is_live: input.is_live === true || input.is_live === 1,
    },
  };
}
