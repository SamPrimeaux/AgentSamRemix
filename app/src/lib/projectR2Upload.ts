import { uploadDashboardImage } from '../../client-api/uploadImage';
import type { ProjectStorageScope } from '../../pages/projects/projectDetailMeta';
import { r2ObjectUrl } from '../../pages/projects/projectDetailMeta';

/** Platform ASSETS bucket — non-image project files only. */
const PLATFORM_ASSETS_BUCKET = 'inneranimalmedia';

export type ProjectStorageUploadOpts = {
  bucket?: string;
  keyPrefix?: string;
  workspaceId?: string | null;
  /** When true, always write to R2 (skip Cloudflare Images). */
  forceR2?: boolean;
};

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

/** Upload project cover or image file to Cloudflare Images (fast CDN delivery). */
export async function uploadProjectCoverImage(
  file: File,
  workspaceId?: string | null,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (!isImageFile(file)) {
    return { ok: false, error: 'Choose an image file' };
  }
  return uploadDashboardImage(file, workspaceId);
}

async function uploadR2Object(
  bucket: string,
  key: string,
  file: File,
): Promise<{ ok: boolean; url?: string; key?: string; error?: string }> {
  const fd = new FormData();
  fd.append('bucket', bucket);
  fd.append('key', key);
  fd.append('file', file);

  try {
    const res = await fetch('/api/r2/upload', { method: 'POST', body: fd, credentials: 'same-origin' });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      url?: string;
      key?: string;
      bucket?: string;
      error?: string;
    };
    if (!res.ok) return { ok: false, error: String(data.error || `Upload failed (${res.status})`) };
    const resolvedBucket = data.bucket || bucket;
    const resolvedKey = data.key || key;
    const resolvedUrl = data.url || r2ObjectUrl(resolvedBucket, resolvedKey);
    return { ok: true, url: resolvedUrl, key: resolvedKey };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Upload failed' };
  }
}

export async function uploadProjectBrandAsset(
  file: File,
  scope: ProjectStorageScope,
): Promise<{ ok: boolean; url?: string; key?: string; error?: string }> {
  const safeName = file.name.replace(/[^\w.\-()+ ]+/g, '_').slice(0, 120) || 'upload';
  const key = `${scope.prefix}${Date.now()}-${safeName}`;
  return uploadR2Object(scope.bucket, key, file);
}

export async function uploadProjectR2File(
  projectId: string,
  file: File,
  subpath: 'files' | 'cover' = 'files',
  workspaceId?: string | null,
  opts?: ProjectStorageUploadOpts,
): Promise<{ ok: boolean; url?: string; key?: string; error?: string }> {
  const bucket = opts?.bucket?.trim() || PLATFORM_ASSETS_BUCKET;
  const useClientBucket = bucket !== PLATFORM_ASSETS_BUCKET || opts?.forceR2;

  // Images → CF Images for platform lane only. Client buckets always use R2.
  if (isImageFile(file) && !useClientBucket && !opts?.forceR2) {
    const cf = await uploadProjectCoverImage(file, workspaceId ?? opts?.workspaceId);
    if (!cf.ok) return cf;
    return { ok: true, url: cf.url };
  }

  const safeName = file.name.replace(/[^\w.\-()+ ]+/g, '_').slice(0, 120) || 'upload';
  const keyPrefix = opts?.keyPrefix?.replace(/^\/*/, '').replace(/\/?$/, '/');
  const key = keyPrefix
    ? `${keyPrefix}${Date.now()}-${safeName}`
    : subpath === 'cover'
      ? `projects/${projectId}/cover/${Date.now()}-${safeName}`
      : `projects/${projectId}/files/${Date.now()}-${safeName}`;

  return uploadR2Object(bucket, key, file);
}

export async function uploadProjectTextFile(
  projectId: string,
  title: string,
  content: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const safeTitle = title.trim().replace(/[^\w.\- ]+/g, '_').slice(0, 80) || 'note';
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const file = new File([blob], `${safeTitle}.txt`, { type: 'text/plain' });
  return uploadProjectR2File(projectId, file, 'files');
}
