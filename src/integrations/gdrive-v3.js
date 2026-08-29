/** Google Drive API v3 helpers (shared by integrations routes + agent tools). */

import {
  extensionForExportMime,
  isGoogleAppsMime,
  resolveGoogleAppsExportMime,
  textExportMimeForFetch,
} from './drive-mime.js';

export {
  GOOGLE_APPS_MIME,
  googleAppsLabel,
  isGoogleAppsExportable,
  isGoogleAppsMime,
} from './drive-mime.js';

export const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

export const DRIVE_FILE_FIELDS =
  'files(id,name,mimeType,size,modifiedTime,thumbnailLink,webViewLink,owners(displayName,emailAddress),driveId,shared,starred,trashed)';

export const DRIVE_LIST_PAGE_SIZE = 100;

export const DRIVE_RESOURCE_FIELDS =
  'id,name,createdTime,hidden,capabilities(canAddChildren,canDeleteDrive,canRenameDrive,canShare,canChangeDriveMembersOnlyRestriction,canChangeDownloadRestriction,canComment,canCopy,canDownload),restrictions(copyRequiresWriterPermission,downloadRestriction(restrictedForReaders,restrictedForWriters))';

export const DRIVE_PERMISSION_FIELDS =
  'permissions(id,type,role,emailAddress,displayName,deleted,permissionDetails)';

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

function applySharedDriveParams(url) {
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('includeItemsFromAllDrives', 'true');
}

/**
 * @param {string} token
 * @param {{ view?: string, folderId?: string, driveId?: string, pageSize?: number }} opts
 */
export async function listDriveFilesV3(token, opts = {}) {
  const view = String(opts.view || 'my-drive').trim();
  const folderId = String(opts.folderId || 'root').trim() || 'root';
  const driveId = String(opts.driveId || '').trim();
  const pageSize = Number(opts.pageSize) > 0 ? Number(opts.pageSize) : DRIVE_LIST_PAGE_SIZE;

  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('pageSize', String(pageSize));
  url.searchParams.set('fields', `nextPageToken,${DRIVE_FILE_FIELDS}`);
  url.searchParams.set('orderBy', 'folder,name');

  if (view === 'shared-with-me') {
    if (folderId === 'root') {
      url.searchParams.set('q', 'sharedWithMe=true and trashed=false');
    } else {
      url.searchParams.set('q', `'${folderId.replace(/'/g, "\\'")}' in parents and trashed=false`);
      applySharedDriveParams(url);
    }
  } else if (view === 'trash') {
    url.searchParams.set('q', 'trashed=true');
    applySharedDriveParams(url);
  } else if (view === 'starred') {
    url.searchParams.set('q', 'starred=true and trashed=false');
    applySharedDriveParams(url);
  } else if (view === 'shared-drive') {
    if (!driveId) {
      return { ok: false, files: [], error: 'driveId required for shared-drive view' };
    }
    url.searchParams.set('corpora', 'drive');
    url.searchParams.set('driveId', driveId);
    applySharedDriveParams(url);
    const parent = folderId === 'root' ? driveId : folderId;
    url.searchParams.set('q', `'${parent.replace(/'/g, "\\'")}' in parents and trashed=false`);
  } else {
    url.searchParams.set('q', `'${folderId.replace(/'/g, "\\'")}' in parents and trashed=false`);
  }

  const res = await fetch(url.toString(), { headers: authHeaders(token) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      files: [],
      error: data?.error?.message || res.statusText || 'Drive list failed',
    };
  }
  return { ok: true, files: Array.isArray(data.files) ? data.files : [] };
}

/** @param {string} token */
export async function listSharedDrivesV3(token, opts = {}) {
  const pageSize = Number(opts.pageSize) > 0 ? Number(opts.pageSize) : DRIVE_LIST_PAGE_SIZE;
  const url = new URL('https://www.googleapis.com/drive/v3/drives');
  url.searchParams.set('pageSize', String(pageSize));
  url.searchParams.set('fields', `nextPageToken,drives(${DRIVE_RESOURCE_FIELDS})`);
  if (opts.q) url.searchParams.set('q', String(opts.q));
  if (opts.pageToken) url.searchParams.set('pageToken', String(opts.pageToken));

  const res = await fetch(url.toString(), { headers: authHeaders(token) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      drives: [],
      error: data?.error?.message || res.statusText || 'Shared drives list failed',
    };
  }
  const drives = Array.isArray(data.drives) ? data.drives : [];
  const files = drives.map((d) => ({
    id: d.id,
    name: d.name || 'Shared drive',
    mimeType: DRIVE_FOLDER_MIME,
    modifiedTime: d.createdTime,
    driveId: d.id,
    shared: true,
    hidden: d.hidden,
    capabilities: d.capabilities,
  }));
  return { ok: true, drives, files, nextPageToken: data.nextPageToken || null };
}

/** @param {string} token @param {string} driveId */
export async function getSharedDriveV3(token, driveId) {
  const url = new URL(`https://www.googleapis.com/drive/v3/drives/${encodeURIComponent(driveId)}`);
  url.searchParams.set('fields', DRIVE_RESOURCE_FIELDS);
  const res = await fetch(url.toString(), { headers: authHeaders(token) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data?.error?.message || res.statusText || 'Shared drive not found' };
  }
  return { ok: true, drive: data };
}

/** @param {string} token @param {{ name: string, requestId?: string }} opts */
export async function createSharedDriveV3(token, opts) {
  const name = String(opts.name || '').trim();
  if (!name) return { ok: false, error: 'name required' };
  const requestId = String(opts.requestId || crypto.randomUUID());
  const url = new URL('https://www.googleapis.com/drive/v3/drives');
  url.searchParams.set('requestId', requestId);
  url.searchParams.set('fields', DRIVE_RESOURCE_FIELDS);
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data?.error?.message || res.statusText || 'Create shared drive failed' };
  }
  return { ok: true, drive: data };
}

/** @param {string} token @param {string} driveId @param {object} patch */
export async function updateSharedDriveV3(token, driveId, patch) {
  const url = new URL(`https://www.googleapis.com/drive/v3/drives/${encodeURIComponent(driveId)}`);
  url.searchParams.set('fields', DRIVE_RESOURCE_FIELDS);
  const res = await fetch(url.toString(), {
    method: 'PATCH',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data?.error?.message || res.statusText || 'Update shared drive failed' };
  }
  return { ok: true, drive: data };
}

/** @param {string} token @param {string} driveId */
export async function hideSharedDriveV3(token, driveId) {
  const url = `https://www.googleapis.com/drive/v3/drives/${encodeURIComponent(driveId)}/hide`;
  const res = await fetch(url, { method: 'POST', headers: authHeaders(token) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data?.error?.message || res.statusText || 'Hide shared drive failed' };
  }
  return { ok: true, drive: data };
}

/** @param {string} token @param {string} driveId */
export async function unhideSharedDriveV3(token, driveId) {
  const url = `https://www.googleapis.com/drive/v3/drives/${encodeURIComponent(driveId)}/unhide`;
  const res = await fetch(url, { method: 'POST', headers: authHeaders(token) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data?.error?.message || res.statusText || 'Unhide shared drive failed' };
  }
  return { ok: true, drive: data };
}

/** @param {string} token @param {string} driveId */
export async function deleteSharedDriveV3(token, driveId) {
  const url = `https://www.googleapis.com/drive/v3/drives/${encodeURIComponent(driveId)}`;
  const res = await fetch(url, { method: 'DELETE', headers: authHeaders(token) });
  if (res.status === 204) return { ok: true };
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data?.error?.message || res.statusText || 'Delete shared drive failed' };
  }
  return { ok: true };
}

/** @param {string} token @param {string} driveId */
export async function listSharedDrivePermissionsV3(token, driveId) {
  const url = new URL(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}/permissions`,
  );
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('fields', DRIVE_PERMISSION_FIELDS);
  url.searchParams.set('pageSize', '100');
  const res = await fetch(url.toString(), { headers: authHeaders(token) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data?.error?.message || res.statusText || 'List members failed' };
  }
  return { ok: true, permissions: Array.isArray(data.permissions) ? data.permissions : [] };
}

/** @param {string} token @param {string} driveId @param {{ email: string, role: string }} member */
export async function addSharedDrivePermissionV3(token, driveId, member) {
  const email = String(member.email || '').trim();
  const role = String(member.role || 'reader').trim();
  if (!email) return { ok: false, error: 'email required' };
  const url = new URL(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}/permissions`,
  );
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('sendNotificationEmail', 'true');
  url.searchParams.set('fields', 'id,type,role,emailAddress,displayName');
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'user', role, emailAddress: email }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data?.error?.message || res.statusText || 'Add member failed' };
  }
  return { ok: true, permission: data };
}

/** @param {string} token @param {string} driveId @param {string} permissionId */
export async function removeSharedDrivePermissionV3(token, driveId, permissionId) {
  const url = new URL(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}/permissions/${encodeURIComponent(permissionId)}`,
  );
  url.searchParams.set('supportsAllDrives', 'true');
  const res = await fetch(url.toString(), { method: 'DELETE', headers: authHeaders(token) });
  if (res.status === 204) return { ok: true };
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data?.error?.message || res.statusText || 'Remove member failed' };
  }
  return { ok: true };
}

/** @param {string} token @param {string} q Drive query (v3 q syntax) */
export async function searchDriveFilesV3(token, q) {
  const query = String(q || '').trim();
  if (!query) return { ok: true, files: [] };

  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('pageSize', String(DRIVE_LIST_PAGE_SIZE));
  url.searchParams.set('fields', DRIVE_FILE_FIELDS);
  url.searchParams.set('q', query);
  applySharedDriveParams(url);

  const res = await fetch(url.toString(), { headers: authHeaders(token) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      files: [],
      error: data?.error?.message || res.statusText || 'Drive search failed',
    };
  }
  return { ok: true, files: Array.isArray(data.files) ? data.files : [] };
}

/** @param {string} token @param {string} fileId @param {string} [fields] */
export async function getDriveFileV3(token, fileId, fields = DRIVE_FILE_FIELDS) {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set('fields', fields);
  applySharedDriveParams(url);
  const res = await fetch(url.toString(), { headers: authHeaders(token) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data?.error?.message || res.statusText || 'File metadata failed' };
  }
  return { ok: true, file: data };
}

/** @param {string} token @param {string} fileId @param {string} exportMime */
export async function exportDriveFileV3(token, fileId, exportMime) {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export`);
  url.searchParams.set('mimeType', exportMime);
  const res = await fetch(url.toString(), { headers: authHeaders(token) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return {
      ok: false,
      error: data?.error?.message || res.statusText || 'Export failed',
      status: res.status,
    };
  }
  return {
    ok: true,
    body: res.body,
    contentType: res.headers.get('Content-Type') || exportMime,
    exportMime,
    extension: extensionForExportMime(exportMime),
  };
}

/** @param {string} token */
export async function getDriveAboutV3(token) {
  const url = new URL('https://www.googleapis.com/drive/v3/about');
  url.searchParams.set(
    'fields',
    'user(displayName,emailAddress,photoLink),storageQuota(limit,usage,usageInDrive),exportFormats',
  );

  const res = await fetch(url.toString(), { headers: authHeaders(token) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: data?.error?.message || res.statusText || 'Drive status failed',
    };
  }
  return { ok: true, about: data };
}

/** @param {string} token @param {string} fileId @param {{ format?: string }} [opts] */
export async function fetchDriveFileTextV3(token, fileId, opts = {}) {
  const metaOut = await getDriveFileV3(token, fileId, 'id,name,mimeType,size,webViewLink,exportLinks');
  if (!metaOut.ok) return metaOut;
  const meta = metaOut.file;

  const mime = String(meta.mimeType || '');
  if (isGoogleAppsMime(mime)) {
    const exportMime = resolveGoogleAppsExportMime(mime, opts.format || textExportMimeForFetch(mime));
    const exportOut = await exportDriveFileV3(token, fileId, exportMime);
    if (!exportOut.ok) return exportOut;
    const content = await new Response(exportOut.body).text();
    return { ok: true, content, file: meta, exportMime };
  }

  const mediaUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  mediaUrl.searchParams.set('alt', 'media');
  applySharedDriveParams(mediaUrl);
  const mediaRes = await fetch(mediaUrl.toString(), { headers: authHeaders(token) });
  if (!mediaRes.ok) {
    return { ok: false, error: mediaRes.statusText || 'Download failed' };
  }
  return { ok: true, content: await mediaRes.text(), file: meta };
}

/** Resolve token + standard not-connected errors for route handlers. */
export async function resolveDriveTokenForUser(env, userId, getIntegrationToken, resolveOAuthAccessToken) {
  const tokenRow = await getIntegrationToken(env, userId, 'google_drive', '');
  if (!tokenRow) {
    return { ok: false, status: 400, error: 'not_connected', token: null, tokenRow: null };
  }
  const token = await resolveOAuthAccessToken(env, tokenRow);
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: 'Google Drive token unavailable — please reconnect',
      token: null,
      tokenRow,
    };
  }
  return { ok: true, token, tokenRow };
}
