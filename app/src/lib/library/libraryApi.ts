import {
  oauthConnectReturnTo,
  openIntegrationOAuthPopup,
  type OAuthPopupResult,
} from '../integrationOAuthPopup';
import { pickR2DisplayBuckets, type R2BucketsApiResponse } from '../r2Buckets';
import { partitionR2Listing, type R2ObjectRow } from '../r2Listing';
import type { DriveView } from './types';

export type DriveApiFile = {
  id: string;
  name: string;
  mimeType?: string;
  thumbnailLink?: string;
  webViewLink?: string;
  modifiedTime?: string;
  size?: string;
  driveId?: string;
  shared?: boolean;
  starred?: boolean;
  trashed?: boolean;
  owners?: Array<{ displayName?: string; emailAddress?: string }>;
};

export type DriveConnectionStatus = {
  connected: boolean;
  email?: string | null;
  displayName?: string | null;
  scope?: string | null;
  apiVersion?: number;
  error?: string;
};

const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

export function isDriveFolder(file: Pick<DriveApiFile, 'mimeType'>) {
  return file.mimeType === DRIVE_FOLDER_MIME;
}

export async function fetchGoogleIntegrationReady(signal?: AbortSignal): Promise<boolean> {
  try {
    const st = await fetchDriveConnectionStatus(signal);
    return st.connected;
  } catch {
    return false;
  }
}

export async function fetchDriveConnectionStatus(signal?: AbortSignal): Promise<DriveConnectionStatus> {
  try {
    const res = await fetch('/api/integrations/gdrive/status', { credentials: 'same-origin', signal });
    const data = await res.json().catch(() => ({}));
    if (res.status === 400 || res.status === 401) {
      return { connected: false, error: typeof data.error === 'string' ? data.error : 'not_connected' };
    }
    if (!res.ok) {
      return { connected: false, error: `Drive status failed (${res.status})` };
    }
    return {
      connected: true,
      email: data.email ?? null,
      displayName: data.displayName ?? null,
      scope: data.scope ?? null,
      apiVersion: data.apiVersion ?? 3,
    };
  } catch (e) {
    return {
      connected: false,
      error: e instanceof Error ? e.message : 'Drive status failed',
    };
  }
}

export async function fetchDriveListing(
  opts: {
    view: DriveView;
    folderId: string;
    sharedDriveId?: string | null;
    signal?: AbortSignal;
  },
): Promise<{ ok: boolean; files: DriveApiFile[]; error?: string; unauthorized?: boolean }> {
  try {
    const qs = new URLSearchParams({
      view: opts.view,
      folderId: opts.folderId || 'root',
    });
    if (opts.sharedDriveId) qs.set('driveId', opts.sharedDriveId);
    const res = await fetch(`/api/integrations/gdrive/files?${qs}`, {
      credentials: 'same-origin',
      signal: opts.signal,
    });
    if (res.status === 401 || res.status === 400) {
      const data = await res.json().catch(() => ({}));
      const err = typeof data.error === 'string' ? data.error : 'Google Drive not connected';
      return { ok: false, files: [], unauthorized: true, error: err };
    }
    if (!res.ok) {
      return { ok: false, files: [], error: `Drive list failed (${res.status})` };
    }
    const data = await res.json();
    const files = Array.isArray(data.files) ? (data.files as DriveApiFile[]) : [];
    return { ok: true, files };
  } catch (e) {
    return {
      ok: false,
      files: [],
      error: e instanceof Error ? e.message : 'Drive list failed',
    };
  }
}

export async function searchDriveFiles(
  query: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; files: DriveApiFile[]; error?: string }> {
  const raw = query.trim();
  if (raw.length < 2) return { ok: true, files: [] };
  const escaped = raw.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const driveQ = `name contains '${escaped}' and trashed=false`;
  try {
    const res = await fetch(`/api/integrations/gdrive/search?q=${encodeURIComponent(driveQ)}`, {
      credentials: 'same-origin',
      signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        files: [],
        error: typeof data.error === 'string' ? data.error : 'Drive search failed',
      };
    }
    return { ok: true, files: Array.isArray(data.files) ? data.files : [] };
  } catch (e) {
    return {
      ok: false,
      files: [],
      error: e instanceof Error ? e.message : 'Drive search failed',
    };
  }
}

export async function disconnectGoogleDrive(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/integrations/google-drive/disconnect', {
      method: 'POST',
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: typeof data.error === 'string' ? data.error : 'Disconnect failed' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Disconnect failed' };
  }
}

export async function fetchR2BucketNames(signal?: AbortSignal): Promise<string[]> {
  try {
    // Prefer account-wide catalog (platform owners); 403 falls back to scoped list.
    let res = await fetch('/api/r2/buckets?all=true', { credentials: 'same-origin', signal });
    if (res.status === 403) {
      res = await fetch('/api/r2/buckets', { credentials: 'same-origin', signal });
    }
    if (!res.ok) {
      const listRes = await fetch('/api/r2/list?buckets=true&all=true', {
        credentials: 'same-origin',
        signal,
      });
      if (!listRes.ok) {
        const scoped = await fetch('/api/r2/list?buckets=true', {
          credentials: 'same-origin',
          signal,
        });
        if (!scoped.ok) return [];
        return pickR2DisplayBuckets((await scoped.json()) as R2BucketsApiResponse);
      }
      return pickR2DisplayBuckets((await listRes.json()) as R2BucketsApiResponse);
    }
    const data = (await res.json()) as R2BucketsApiResponse;
    return pickR2DisplayBuckets(data);
  } catch {
    return [];
  }
}

export type R2ListResponse = {
  ok: boolean;
  folders: string[];
  files: R2ObjectRow[];
  error?: string;
  cursor?: string | null;
  truncated?: boolean;
};

export async function fetchR2Listing(
  bucket: string,
  prefix: string,
  signal?: AbortSignal,
): Promise<R2ListResponse> {
  try {
    const qs = new URLSearchParams({ bucket, prefix });
    const res = await fetch(`/api/r2/list?${qs}`, { credentials: 'same-origin', signal });
    const data = await res.json();
    if (!res.ok) {
      return {
        ok: false,
        folders: [],
        files: [],
        error: typeof data.error === 'string' ? data.error : `R2 list failed (${res.status})`,
      };
    }
    const rows = (Array.isArray(data.objects) ? data.objects : []) as R2ObjectRow[];
    const prefs = Array.isArray(data.prefixes) ? data.prefixes : [];
    const { folders, files } = partitionR2Listing(rows, prefs, prefix);
    return {
      ok: true,
      folders,
      files,
      cursor: typeof data.cursor === 'string' ? data.cursor : null,
      truncated: !!data.truncated,
    };
  } catch (e) {
    return {
      ok: false,
      folders: [],
      files: [],
      error: e instanceof Error ? e.message : 'R2 list failed',
    };
  }
}

export async function fetchR2StorageLabel(bucket: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(`/api/r2/stats?bucket=${encodeURIComponent(bucket)}`, {
      credentials: 'same-origin',
      signal,
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    const bytes = Number(data.total_bytes ?? data.bytes ?? data.size ?? 0);
    if (!Number.isFinite(bytes) || bytes <= 0) return null;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB used`;
    return `${(bytes / 1024 ** 3).toFixed(2)} GB used`;
  } catch {
    return null;
  }
}

const GOOGLE_DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const GOOGLE_DRIVE_MANAGE_SCOPE = 'https://www.googleapis.com/auth/drive';

function driveConnectUrl(returnTo: string, extraParams?: URLSearchParams) {
  const params = new URLSearchParams({
    return_to: returnTo,
    // Forces google_drive token upsert (not Google sign-in).
    connectDrive: '1',
  });
  if (extraParams) {
    for (const [k, v] of extraParams.entries()) params.set(k, v);
  }
  return `/api/integrations/google_drive/connect?${params.toString()}`;
}

/** Unified Drive OAuth — same spine as Integrations catalog + popup postMessage. */
export function connectGoogleDrive(returnTo?: string): Promise<OAuthPopupResult> {
  const rt = returnTo || oauthConnectReturnTo();
  return openIntegrationOAuthPopup(driveConnectUrl(rt), 'google_drive');
}

/** Reconnect with readonly + full drive scope for shared drive create/manage. */
export function connectGoogleDriveForManage(returnTo?: string): Promise<OAuthPopupResult> {
  const rt = returnTo || oauthConnectReturnTo();
  const scopes = new URLSearchParams({
    scope: [GOOGLE_DRIVE_READONLY_SCOPE, GOOGLE_DRIVE_MANAGE_SCOPE].join(' '),
  });
  return openIntegrationOAuthPopup(driveConnectUrl(rt, scopes), 'google_drive');
}