import { useCallback, useState } from 'react';
import type { VideosSourceTab } from './videosRegistry';

export type VideosToast = { id: number; msg: string; type: 'ok' | 'err' };

export function useVideosToast() {
  const [toasts, setToasts] = useState<VideosToast[]>([]);
  const add = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    const id = Date.now();
    setToasts((p) => [...p, { id, msg, type }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3200);
  }, []);
  return { toasts, add };
}

export type StreamVideoListItem = {
  uid: string;
  name?: string;
  duration_sec?: number | null;
  size_bytes?: number | null;
  ready?: boolean;
  require_signed_urls?: boolean;
  thumbnail?: string | null;
  hls?: string | null;
  dash?: string | null;
  watch_url?: string | null;
  iframe_url?: string | null;
  customer_subdomain?: string | null;
  created?: string | null;
  status?: string | null;
  url_error?: string | null;
  source?: 'stream';
};

export type StreamVideoDetail = StreamVideoListItem & {
  size_bytes?: number | null;
  modified?: string | null;
  allowed_origins?: string[];
  thumbnail_timestamp_pct?: number | null;
  tags?: string[];
  resource_tags?: Record<string, string>;
  resource_tags_error?: string | null;
  public_details?: Record<string, unknown>;
  embed?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  playback?: Record<string, unknown>;
  customer_subdomain?: string | null;
  watch_url?: string | null;
  iframe_url?: string | null;
  dash?: string | null;
  url_error?: string | null;
  account_id?: string | null;
};

export type MediaAssetRow = {
  id: string;
  filename?: string | null;
  object_key?: string | null;
  bucket?: string | null;
  content_type?: string | null;
  media_kind?: string | null;
  size_bytes?: number | null;
  status?: string | null;
  metadata_json?: string | null;
  updated_at?: number | string | null;
  created_at?: number | string | null;
  source?: 'r2' | 'drive';
};

export type VideosListRow =
  | (StreamVideoListItem & { source: 'stream'; rowKey: string })
  | (MediaAssetRow & { source: 'r2' | 'drive'; rowKey: string; name: string });

async function parseJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export async function fetchStreamVideos(limit = 100): Promise<{
  ok: boolean;
  videos: StreamVideoListItem[];
  total: number;
  account_id?: string | null;
  customer_subdomain?: string | null;
  error?: string;
  reconnect_required?: boolean;
  account_selection_required?: boolean;
  accounts?: Array<{ id: string; name: string }>;
}> {
  const r = await fetch(`/api/stream/videos?limit=${Math.min(limit, 100)}`, {
    credentials: 'same-origin',
  });
  const d = await parseJson(r);
  if (!r.ok || d.ok === false) {
    return {
      ok: false,
      videos: [],
      total: 0,
      error: d.error || d.message || `HTTP ${r.status}`,
      reconnect_required: !!d.reconnect_required,
      account_selection_required: !!d.account_selection_required,
      accounts: Array.isArray(d.accounts) ? d.accounts : undefined,
    };
  }
  const videos: StreamVideoListItem[] = (d.videos || []).map((v: StreamVideoListItem) => ({
    ...v,
    source: 'stream' as const,
  }));
  return {
    ok: true,
    videos,
    total: typeof d.total === 'number' ? d.total : videos.length,
    account_id: d.account_id || null,
    customer_subdomain: d.customer_subdomain || null,
  };
}

export type StreamCapabilities = {
  connected: boolean;
  account_id?: string | null;
  credential_source?: string | null;
  can_read?: boolean;
  can_write?: boolean;
  reconnect_required?: boolean;
  account_selection_required?: boolean;
  accounts?: Array<{ id: string; name: string }>;
  platform_owned?: boolean;
  error?: string | null;
  message?: string | null;
  account_video_count?: number;
  /** @deprecated alias of account_video_count (ownership is Cloudflare account, not workspace) */
  workspace_video_count?: number;
};

export async function fetchStreamCapabilities(): Promise<StreamCapabilities> {
  const r = await fetch('/api/stream/capabilities', { credentials: 'same-origin' });
  const d = await parseJson(r);
  if (!r.ok) {
    return {
      connected: false,
      reconnect_required: true,
      error: d.error || `HTTP ${r.status}`,
    };
  }
  const accountCount =
    typeof d.account_video_count === 'number'
      ? d.account_video_count
      : typeof d.workspace_video_count === 'number'
        ? d.workspace_video_count
        : 0;
  return {
    connected: !!d.connected,
    account_id: d.account_id || null,
    credential_source: d.credential_source || null,
    can_read: !!d.can_read,
    can_write: !!d.can_write,
    reconnect_required: !!d.reconnect_required,
    account_selection_required: !!d.account_selection_required,
    accounts: Array.isArray(d.accounts) ? d.accounts : [],
    platform_owned: !!d.platform_owned,
    error: d.error || null,
    message: d.message || null,
    account_video_count: accountCount,
    workspace_video_count: accountCount,
  };
}

export async function fetchVideoMediaAssets(workspaceId?: string | null): Promise<{
  ok: boolean;
  assets: MediaAssetRow[];
  error?: string;
}> {
  const params = new URLSearchParams();
  params.set('media_kind', 'video');
  const ws = workspaceId?.trim();
  if (ws) params.set('workspace_id', ws);
  const r = await fetch(`/api/media/assets?${params.toString()}`, { credentials: 'same-origin' });
  const d = await parseJson(r);
  if (!r.ok || d.error) {
    return { ok: false, assets: [], error: d.error || `HTTP ${r.status}` };
  }
  return { ok: true, assets: (d.assets || []) as MediaAssetRow[] };
}

function assetLooksLikeDrive(row: MediaAssetRow): boolean {
  const meta = String(row.metadata_json || '').toLowerCase();
  const key = String(row.object_key || '').toLowerCase();
  const bucket = String(row.bucket || '').toLowerCase();
  return (
    meta.includes('drive') ||
    meta.includes('google') ||
    key.includes('drive/') ||
    bucket.includes('drive')
  );
}

/** Merge Stream + media_assets for overview source filters. */
export async function fetchVideosOverview(
  source: VideosSourceTab,
  workspaceId?: string | null,
): Promise<{
  ok: boolean;
  rows: VideosListRow[];
  account_id?: string | null;
  customer_subdomain?: string | null;
  error?: string;
}> {
  const errors: string[] = [];
  let stream: StreamVideoListItem[] = [];
  let assets: MediaAssetRow[] = [];
  let account_id: string | null = null;
  let customer_subdomain: string | null = null;

  if (source === 'all' || source === 'stream') {
    const s = await fetchStreamVideos(100);
    if (!s.ok) errors.push(s.error || 'Stream list failed');
    else {
      stream = s.videos;
      account_id = s.account_id || null;
      customer_subdomain = s.customer_subdomain || null;
    }
  }

  if (source === 'all' || source === 'r2' || source === 'drive') {
    const a = await fetchVideoMediaAssets(workspaceId);
    if (!a.ok) errors.push(a.error || 'media_assets list failed');
    else assets = a.assets;
  }

  const streamRows: VideosListRow[] = stream.map((v) => ({
    ...v,
    source: 'stream' as const,
    rowKey: `stream:${v.uid}`,
  }));

  const assetRows: VideosListRow[] = assets
    .map((row) => {
      const drive = assetLooksLikeDrive(row);
      const src: 'r2' | 'drive' = drive ? 'drive' : 'r2';
      if (source === 'r2' && src !== 'r2') return null;
      if (source === 'drive' && src !== 'drive') return null;
      return {
        ...row,
        source: src,
        rowKey: `${src}:${row.id}`,
        name: String(row.filename || row.object_key || row.id),
      };
    })
    .filter(Boolean) as VideosListRow[];

  const rows =
    source === 'stream' ? streamRows : source === 'r2' || source === 'drive' ? assetRows : [...streamRows, ...assetRows];

  if (!customer_subdomain) {
    customer_subdomain = stream.find((v) => v.customer_subdomain)?.customer_subdomain || null;
  }

  return {
    ok: errors.length === 0 || rows.length > 0,
    rows,
    account_id,
    customer_subdomain,
    error: errors.length ? errors.join('; ') : undefined,
  };
}

export function streamVideoUrl(uid: string, sub?: string) {
  const base = `/api/stream/videos/${encodeURIComponent(uid)}`;
  return sub ? `${base}/${sub}` : base;
}

export async function mintStreamPlaybackToken(
  uid: string,
  expiresInSeconds = 3600,
): Promise<{ ok: boolean; token?: string; expires_at?: number; error?: string }> {
  const r = await fetch(streamVideoUrl(uid, 'playback-token'), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expires_in_seconds: expiresInSeconds }),
  });
  const d = await parseJson(r);
  if (!r.ok || d.ok === false) return { ok: false, error: d.error || `HTTP ${r.status}` };
  return { ok: true, token: d.token, expires_at: d.expires_at };
}

export async function getStreamVideo(uid: string): Promise<{
  ok: boolean;
  video?: StreamVideoDetail;
  error?: string;
}> {
  const r = await fetch(streamVideoUrl(uid), { credentials: 'same-origin' });
  const d = await parseJson(r);
  if (!r.ok || d.ok === false) return { ok: false, error: d.error || `HTTP ${r.status}` };
  return { ok: true, video: d.video as StreamVideoDetail };
}

export async function patchStreamVideo(
  uid: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; video?: StreamVideoDetail; error?: string }> {
  const r = await fetch(streamVideoUrl(uid), {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await parseJson(r);
  if (!r.ok || d.ok === false) return { ok: false, error: d.error || `HTTP ${r.status}` };
  return { ok: true, video: d.video as StreamVideoDetail };
}

export async function deleteStreamVideo(uid: string): Promise<{ ok: boolean; error?: string }> {
  const r = await fetch(streamVideoUrl(uid), { method: 'DELETE', credentials: 'same-origin' });
  const d = await parseJson(r);
  if (!r.ok || d.ok === false) return { ok: false, error: d.error || `HTTP ${r.status}` };
  return { ok: true };
}

export async function streamJsonGet(uid: string, sub: string) {
  const r = await fetch(streamVideoUrl(uid, sub), { credentials: 'same-origin' });
  const d = await parseJson(r);
  return { ok: r.ok && d.ok !== false, status: r.status, data: d };
}

export async function streamJsonMutate(
  uid: string,
  sub: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: Record<string, unknown>,
) {
  const r = await fetch(streamVideoUrl(uid, sub), {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await parseJson(r);
  return { ok: r.ok && d.ok !== false, status: r.status, data: d };
}

export async function copyStreamFromUrl(input: {
  url: string;
  name?: string;
}): Promise<{ ok: boolean; video?: StreamVideoDetail; error?: string }> {
  const r = await fetch('/api/stream/from-url', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const d = await parseJson(r);
  if (!r.ok || d.ok === false) return { ok: false, error: d.error || `HTTP ${r.status}` };
  return { ok: true, video: d.video as StreamVideoDetail };
}

export async function createStreamDirectUpload(input?: {
  name?: string;
  max_duration_seconds?: number;
}): Promise<{ ok: boolean; upload_url?: string; uid?: string; error?: string }> {
  const r = await fetch('/api/stream/direct-upload', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input || {}),
  });
  const d = await parseJson(r);
  if (!r.ok || d.ok === false) return { ok: false, error: d.error || `HTTP ${r.status}` };
  return { ok: true, upload_url: d.upload_url, uid: d.uid };
}

export function formatDuration(sec?: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function formatBytes(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
