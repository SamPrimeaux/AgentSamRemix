import { parseIamMetaFromStorage } from '../../core/r2-image-metadata.js';
import {
  BUCKET,
  createdAtIso,
  encodeR2BrowseId,
  mediaKeyToId,
  mimeFromKey,
} from './ids.js';
import { buildMetaFromRow, parseMetadata, parseTags } from './meta.js';

export function cfDeliveryUrl(accountHash, imageId, variant = 'public') {
  if (!accountHash || !imageId) return '';
  return `https://imagedelivery.net/${accountHash}/${imageId}/${variant}`;
}

export function proxyR2Url(origin, key, bucket = BUCKET) {
  const b = bucket || BUCKET;
  return `${origin}/api/r2/buckets/${encodeURIComponent(b)}/object/${encodeURIComponent(key)}`;
}

export function mapR2BrowseObject(obj, bucketName, origin, authUserId) {
  const key = obj.key;
  const id = encodeR2BrowseId(bucketName, key) || mediaKeyToId(key);
  const url = proxyR2Url(origin, key, bucketName);
  return {
    id,
    source: 'r2',
    filename: key.split('/').pop() || key,
    url,
    thumbnail_url: url,
    mime_type: mimeFromKey(key),
    size: Number(obj.size) || 0,
    width: null,
    height: null,
    created_at: obj.last_modified || new Date().toISOString(),
    user_id: authUserId,
    workspace_id: null,
    r2_key: key,
    r2_bucket: bucketName,
    cloudflare_image_id: null,
    alt_text: null,
    description: null,
    tags: [],
    meta: { label: key.split('/').pop() || key },
    _r2_browse_only: true,
    browse_only: true,
  };
}

export function rowSource(row) {
  if (row.cloudflare_image_id) return 'cf_images';
  return 'r2';
}

export function mapD1RowToItem(row, { origin, accountHash }) {
  const source = rowSource(row);
  const metaObj = parseMetadata(row.metadata);
  const r2Bucket = String(metaObj.r2_bucket || metaObj.bucket || '').trim() || BUCKET;
  let url = row.url || '';
  let thumbnail_url = row.thumbnail_url || '';
  if (!url && row.cloudflare_image_id && accountHash) {
    url = cfDeliveryUrl(accountHash, row.cloudflare_image_id, 'public');
  }
  if (!url && row.r2_key && origin) {
    url = proxyR2Url(origin, row.r2_key, r2Bucket);
  }
  if (!thumbnail_url) {
    thumbnail_url =
      (row.cloudflare_image_id && accountHash
        ? cfDeliveryUrl(accountHash, row.cloudflare_image_id, 'thumbnail')
        : '') || url;
  }
  return {
    id: row.id,
    source,
    filename: row.filename || row.original_filename || 'image',
    url,
    thumbnail_url,
    mime_type: row.mime_type || 'image/jpeg',
    size: Number(row.size) || 0,
    width: row.width != null ? Number(row.width) : null,
    height: row.height != null ? Number(row.height) : null,
    created_at: createdAtIso(row.created_at),
    user_id: row.user_id,
    workspace_id: row.workspace_id,
    project_id: row.project_id || null,
    r2_key: row.r2_key || null,
    r2_bucket: r2Bucket,
    cloudflare_image_id: row.cloudflare_image_id || null,
    alt_text: row.alt_text || null,
    description: row.description || null,
    tags: parseTags(row.tags),
    meta: buildMetaFromRow(row),
  };
}

export function mapCfApiImage(img, accountHash, authUserId) {
  const meta = img.metadata || img.meta || {};
  const userMeta = meta.userId || meta.user_id || meta.userid;
  if (userMeta && String(userMeta) !== String(authUserId)) return null;
  const parsed = parseIamMetaFromStorage(meta);
  const id = img.id;
  const url = cfDeliveryUrl(accountHash, id, 'public');
  return {
    id: `cf_live_${id}`,
    source: 'cf_images',
    filename: parsed.meta.label || meta.filename || meta.name || id,
    url,
    thumbnail_url: cfDeliveryUrl(accountHash, id, 'thumbnail') || url,
    mime_type: meta.mime || 'image/jpeg',
    size: Number(img.size) || 0,
    width: img.width != null ? Number(img.width) : null,
    height: img.height != null ? Number(img.height) : null,
    created_at: img.uploaded || img.created || new Date().toISOString(),
    user_id: authUserId,
    workspace_id: meta.workspaceId || meta.workspace_id || null,
    r2_key: null,
    cloudflare_image_id: id,
    alt_text: parsed.alt_text,
    tags: parsed.tags,
    meta: {
      ...parsed.meta,
      label: parsed.meta.label || meta.filename || meta.name || id,
    },
    _cf_only: true,
  };
}

export function driveProxyPath(origin, fileId, variant = 'preview') {
  const id = String(fileId || '').trim();
  if (!id || !origin) return '';
  return `${origin}/api/images/drive/${encodeURIComponent(id)}/${variant}`;
}

export function mapDriveFile(file, authUserId, origin) {
  const fileId = file.id;
  return {
    id: `drive_${fileId}`,
    source: 'drive',
    filename: file.name || fileId,
    url: driveProxyPath(origin, fileId, 'preview'),
    thumbnail_url: driveProxyPath(origin, fileId, 'thumbnail'),
    web_view_link: file.webViewLink || file.webContentLink || '',
    mime_type: file.mimeType || 'image/jpeg',
    size: Number(file.size) || 0,
    width: null,
    height: null,
    created_at: file.createdTime || new Date().toISOString(),
    user_id: authUserId,
    workspace_id: null,
    r2_key: null,
    cloudflare_image_id: null,
    drive_file_id: fileId,
    alt_text: null,
    tags: [],
    _drive_only: true,
  };
}
