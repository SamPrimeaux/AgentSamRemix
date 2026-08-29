export const BUCKET = 'inneranimalmedia';

export function mediaKeyToId(key) {
  return Buffer.from(String(key), 'utf8').toString('base64url');
}

export function mediaIdToKey(id) {
  try {
    const k = Buffer.from(String(id), 'base64url').toString('utf8');
    return k || null;
  } catch {
    return null;
  }
}

/** Stable browse-only id: r2obj_<base64url(bucket\\0key)> — no D1 row required. */
export function encodeR2BrowseId(bucket, key) {
  const b = String(bucket || '').trim();
  const k = String(key || '').trim();
  if (!b || !k) return '';
  return `r2obj_${Buffer.from(`${b}\0${k}`, 'utf8').toString('base64url')}`;
}

export function decodeR2BrowseId(id) {
  const rawId = String(id || '').trim();
  if (!rawId.startsWith('r2obj_')) return null;
  try {
    const raw = Buffer.from(rawId.slice('r2obj_'.length), 'base64url').toString('utf8');
    const i = raw.indexOf('\0');
    if (i <= 0) return null;
    const bucket = raw.slice(0, i).trim();
    const key = raw.slice(i + 1).trim();
    if (!bucket || !key) return null;
    return { bucket, key };
  } catch {
    return null;
  }
}

export function mimeFromKey(key) {
  const ext = String(key || '').split('.').pop()?.toLowerCase() || '';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'avif') return 'image/avif';
  return 'application/octet-stream';
}

export function extFromMime(mime) {
  const ct = String(mime || '').split(';')[0].trim().toLowerCase();
  if (ct === 'image/jpeg') return 'jpg';
  if (ct === 'image/png') return 'png';
  if (ct === 'image/webp') return 'webp';
  if (ct === 'image/gif') return 'gif';
  if (ct === 'image/svg+xml') return 'svg';
  if (ct === 'image/avif') return 'avif';
  return 'jpg';
}

export function safeFilename(name) {
  return String(name || 'upload')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 120);
}

export function createdAtIso(unix) {
  const n = Number(unix);
  if (!Number.isFinite(n) || n <= 0) return new Date().toISOString();
  return new Date(n * 1000).toISOString();
}
