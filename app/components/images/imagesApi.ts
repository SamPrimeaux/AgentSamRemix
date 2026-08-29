import { useCallback, useState } from 'react';

export type ImagesSourceTab = 'all' | 'r2' | 'cf_images' | 'drive';

export type ImagesToast = { id: number; msg: string; type: 'ok' | 'err' };

/** Local toast hook for Images surfaces (not a shared package import). */
export function useImagesToast() {
  const [toasts, setToasts] = useState<ImagesToast[]>([]);
  const add = useCallback((msg: string, type: 'ok' | 'err' = 'ok', ms = 4200) => {
    const id = Date.now();
    setToasts((p) => [...p, { id, msg, type }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), ms);
  }, []);
  return { toasts, add };
}

export function imagesListUrl(
  workspaceId: string | null | undefined,
  source: ImagesSourceTab,
  page: number,
  perPage: number,
  tag?: string,
  q?: string,
  r2Bucket?: string,
  r2Prefix?: string,
) {
  const params = new URLSearchParams();
  params.set('source', source);
  params.set('page', String(page));
  params.set('per_page', String(perPage));
  const ws = workspaceId?.trim();
  if (ws) params.set('workspace_id', ws);
  if (tag?.trim()) params.set('tag', tag.trim());
  if (q?.trim()) params.set('q', q.trim());
  if (source === 'r2' && r2Bucket?.trim()) {
    params.set('r2_bucket', r2Bucket.trim());
    params.set('r2_prefix', r2Prefix ?? '');
  }
  return `/api/images?${params.toString()}`;
}

export function imagesTagsUrl(workspaceId?: string | null) {
  const params = new URLSearchParams();
  const ws = workspaceId?.trim();
  if (ws) params.set('workspace_id', ws);
  const qs = params.toString();
  return qs ? `/api/images/tags?${qs}` : '/api/images/tags';
}

/** CF Resource Tagging account catalog (keys + values grouped). */
export function imagesResourceTagsCatalogUrl() {
  return '/api/images/resource-tags/catalog';
}

/**
 * Real, account-configured named Variant dimensions from Cloudflare Images —
 * NOT the same as app/dashboard/components/images/imagesRegistry.ts's
 * NAMED_VARIANTS constant, which is a hardcoded client-side fallback only.
 * Named variants are account-specific (e.g. "public" and "large" can be
 * configured to any dimensions) — always prefer this real catalog when it's
 * available.
 */
export function imagesVariantsCatalogUrl() {
  return '/api/images/variants/catalog';
}

export function imagesVariantsCreateUrl() {
  return '/api/images/variants';
}

export type CfVariantDef = {
  id: string;
  width: number | null;
  height: number | null;
  fit: string | null;
};

export type CreateVariantBody = {
  id: string;
  width?: number;
  height?: number;
  fit?: string;
  metadata?: string;
  neverRequireSignedURLs?: boolean;
};

/** Creates an account-level named variant via CF Images API (proxied). */
export async function createNamedVariant(
  body: CreateVariantBody,
): Promise<{ ok: boolean; variant?: CfVariantDef; error?: string }> {
  try {
    const r = await fetch(imagesVariantsCreateUrl(), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok || d.error || !d.ok) {
      return { ok: false, error: d.error || `Create failed (${r.status})` };
    }
    return { ok: true, variant: d.variant };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}

/**
 * Fetches the real variant catalog. Returns null (not an empty array) on
 * failure so callers can distinguish "CF returned zero variants" from
 * "the fetch failed, fall back to the static guesses."
 */
export async function fetchRealVariantsCatalog(): Promise<CfVariantDef[] | null> {
  try {
    const r = await fetch(imagesVariantsCatalogUrl(), { credentials: 'same-origin' });
    if (!r.ok) return null;
    const d = await r.json();
    if (!d?.ok || !Array.isArray(d.variants)) return null;
    return d.variants;
  } catch {
    return null;
  }
}

export function imagesResourceTagsUrl(imageId: string, workspaceId?: string | null) {
  const ws = workspaceId?.trim();
  const base = `/api/images/${encodeURIComponent(imageId)}/resource-tags`;
  return ws ? `${base}?workspace_id=${encodeURIComponent(ws)}` : base;
}

export function imagesDetailUrl(
  imageId: string,
  workspaceId?: string | null,
  opts?: { r2Bucket?: string | null; r2Key?: string | null },
) {
  const params = new URLSearchParams();
  const ws = workspaceId?.trim();
  if (ws) params.set('workspace_id', ws);
  if (opts?.r2Bucket?.trim()) params.set('r2_bucket', opts.r2Bucket.trim());
  if (opts?.r2Key?.trim()) params.set('r2_key', opts.r2Key.trim());
  const qs = params.toString();
  return qs
    ? `/api/images/${encodeURIComponent(imageId)}?${qs}`
    : `/api/images/${encodeURIComponent(imageId)}`;
}

/** Client route for an images grid item (R2 browse passes bucket+key query). */
export function imagesDetailPath(
  img: { id: string; source?: string; r2_bucket?: string | null; r2_key?: string | null },
) {
  const base = `/dashboard/images/${encodeURIComponent(img.id)}`;
  if (img.source === 'r2' && img.r2_bucket?.trim() && img.r2_key?.trim()) {
    const qs = new URLSearchParams({
      r2_bucket: img.r2_bucket.trim(),
      r2_key: img.r2_key.trim(),
    });
    return `${base}?${qs.toString()}`;
  }
  return base;
}

export function imagesPatchUrl(imageId: string, workspaceId?: string | null) {
  return imagesDetailUrl(imageId, workspaceId);
}

export function imagesUploadUrl(
  workspaceId?: string | null,
  opts?: { destination?: 'r2' | 'cf_images'; r2Bucket?: string },
) {
  const params = new URLSearchParams();
  const ws = workspaceId?.trim();
  if (ws) params.set('workspace_id', ws);
  if (opts?.destination === 'r2') {
    params.set('destination', 'r2');
    if (opts.r2Bucket?.trim()) params.set('r2_bucket', opts.r2Bucket.trim());
  }
  const qs = params.toString();
  return qs ? `/api/images/upload?${qs}` : '/api/images/upload';
}

/** localStorage key for last-selected Images Storage R2 bucket (per workspace). */
export function imagesR2BucketStorageKey(workspaceId?: string | null) {
  const ws = workspaceId?.trim() || 'default';
  return `iam_images_r2_bucket_${ws}`;
}

/** sessionStorage: last Storage grid browse context (source + bucket + page). */
export type ImagesStorageBrowseState = {
  source: ImagesSourceTab;
  r2Bucket?: string;
  page?: number;
};

export function imagesStorageBrowseKey(workspaceId?: string | null) {
  const ws = workspaceId?.trim() || 'default';
  return `iam_images_storage_browse_${ws}`;
}

export function saveImagesStorageBrowse(
  workspaceId: string | null | undefined,
  state: ImagesStorageBrowseState,
) {
  try {
    sessionStorage.setItem(imagesStorageBrowseKey(workspaceId), JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function loadImagesStorageBrowse(
  workspaceId?: string | null,
): ImagesStorageBrowseState | null {
  try {
    const raw = sessionStorage.getItem(imagesStorageBrowseKey(workspaceId));
    if (!raw) return null;
    const p = JSON.parse(raw) as ImagesStorageBrowseState;
    if (!p || typeof p !== 'object') return null;
    const source = p.source;
    if (source !== 'all' && source !== 'r2' && source !== 'cf_images' && source !== 'drive') {
      return null;
    }
    return {
      source,
      r2Bucket: typeof p.r2Bucket === 'string' ? p.r2Bucket : undefined,
      page: typeof p.page === 'number' && p.page >= 1 ? p.page : 1,
    };
  } catch {
    return null;
  }
}

/** Client route back to Storage with source/bucket/page preserved. */
export function imagesStoragePath(opts?: {
  source?: ImagesSourceTab;
  r2Bucket?: string | null;
  page?: number;
  workspaceId?: string | null;
}) {
  let source = opts?.source;
  let r2Bucket = opts?.r2Bucket?.trim() || '';
  let page = opts?.page && opts.page > 1 ? opts.page : 1;
  if (!source) {
    const saved = loadImagesStorageBrowse(opts?.workspaceId);
    if (saved) {
      source = saved.source;
      if (!r2Bucket && saved.r2Bucket) r2Bucket = saved.r2Bucket;
      if (page === 1 && saved.page && saved.page > 1) page = saved.page;
    }
  }
  const params = new URLSearchParams();
  if (source && source !== 'all') params.set('source', source);
  if (source === 'r2' && r2Bucket) params.set('r2_bucket', r2Bucket);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `/dashboard/images/storage?${qs}` : '/dashboard/images/storage';
}

export function imagesShareUrl(imageId: string, workspaceId?: string | null) {
  const ws = workspaceId?.trim();
  const base = `/api/images/${encodeURIComponent(imageId)}/share`;
  return ws ? `${base}?workspace_id=${encodeURIComponent(ws)}` : base;
}

export function imagesTransformUrl(imageId: string, workspaceId?: string | null) {
  const ws = workspaceId?.trim();
  const base = `/api/images/${encodeURIComponent(imageId)}/transform`;
  return ws ? `${base}?workspace_id=${encodeURIComponent(ws)}` : base;
}

export function imagesPreviewUrl(
  imageId: string,
  ops: Record<string, string | number | boolean | undefined | null>,
  workspaceId?: string | null,
) {
  const params = new URLSearchParams();
  const ws = workspaceId?.trim();
  if (ws) params.set('workspace_id', ws);
  for (const [k, v] of Object.entries(ops)) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return `/api/images/${encodeURIComponent(imageId)}/preview-url${qs ? `?${qs}` : ''}`;
}

export function imagesCapabilitiesUrl(workspaceId?: string | null) {
  const ws = workspaceId?.trim();
  return ws
    ? `/api/images/capabilities?workspace_id=${encodeURIComponent(ws)}`
    : '/api/images/capabilities';
}

export function imagesBatchDeleteUrl(workspaceId?: string | null) {
  const ws = workspaceId?.trim();
  return ws
    ? `/api/images/batch/delete?workspace_id=${encodeURIComponent(ws)}`
    : '/api/images/batch/delete';
}

export function imagesBatchExportUrl(workspaceId?: string | null) {
  const ws = workspaceId?.trim();
  return ws
    ? `/api/images/batch/export?workspace_id=${encodeURIComponent(ws)}`
    : '/api/images/batch/export';
}

export function cfDeliveryBase(accountHash: string) {
  return `https://imagedelivery.net/${accountHash}`;
}

export function buildCfImageUrl(accountHash: string, id: string, variant = 'public') {
  return `${cfDeliveryBase(accountHash)}/${id}/${variant}`;
}

export type ImagesCapabilities = {
  cf_images?: boolean;
  cf_oauth?: boolean;
  cf_oauth_refreshed?: boolean;
  cf_expires_at?: number | null;
  r2?: boolean;
  r2_buckets?: string[];
  drive?: boolean;
  drive_connected?: boolean;
  drive_account_email?: string | null;
  account_hash?: string;
  accountHash?: string;
  account_id?: string | null;
  images_transformed?: number | string | null;
  source?: string | null;
};

export async function fetchImagesCapabilities(
  workspaceId?: string | null,
): Promise<ImagesCapabilities | null> {
  try {
    const r = await fetch(imagesCapabilitiesUrl(workspaceId), { credentials: 'same-origin' });
    if (!r.ok) return null;
    return (await r.json()) as ImagesCapabilities;
  } catch {
    return null;
  }
}
