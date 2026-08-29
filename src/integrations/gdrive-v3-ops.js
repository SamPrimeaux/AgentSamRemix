/** Google Drive API v3 — files, changes, watch, comments, approvals, labels, trash. */

import { DRIVE_FILE_FIELDS, DRIVE_FOLDER_MIME } from './gdrive-v3.js';

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

function applySharedDriveParams(url) {
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('includeItemsFromAllDrives', 'true');
}

async function parseDriveError(res) {
  const data = await res.json().catch(() => ({}));
  return data?.error?.message || res.statusText || 'Drive request failed';
}

/** @param {string} token @param {string} method @param {string} path @param {{ query?: object, body?: object, sharedDrive?: boolean, raw?: boolean }} opts */
async function driveApiRequest(token, method, path, opts = {}) {
  const url = new URL(`https://www.googleapis.com/drive/v3${path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v != null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  if (opts.sharedDrive) applySharedDriveParams(url);

  const init = { method, headers: { ...authHeaders(token) } };
  if (opts.body != null) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }

  const res = await fetch(url.toString(), init);
  if (res.status === 204) return { ok: true, data: null, status: 204 };
  if (opts.raw) {
    if (!res.ok) return { ok: false, error: await parseDriveError(res), status: res.status };
    return { ok: true, body: res.body, contentType: res.headers.get('Content-Type'), status: res.status };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data?.error?.message || res.statusText || 'Drive request failed', status: res.status };
  }
  return { ok: true, data, status: res.status };
}

// ── Files: create / copy / update / delete / trash ───────────────────────────

/** @param {string} token @param {{ name: string, mimeType?: string, parents?: string[] }} meta */
export async function createDriveMetadataV3(token, meta) {
  const body = {
    name: String(meta.name || '').trim(),
    mimeType: meta.mimeType || DRIVE_FOLDER_MIME,
    parents: meta.parents?.length ? meta.parents : undefined,
  };
  if (!body.name) return { ok: false, error: 'name required' };
  const out = await driveApiRequest(token, 'POST', '/files', {
    query: { fields: DRIVE_FILE_FIELDS },
    body,
    sharedDrive: true,
  });
  return out.ok ? { ok: true, file: out.data } : out;
}

/** @param {string} token @param {{ name: string, mimeType?: string, parents?: string[], content: ArrayBuffer|Uint8Array|string, contentType?: string }} opts */
export async function uploadDriveFileV3(token, opts) {
  const name = String(opts.name || '').trim();
  if (!name) return { ok: false, error: 'name required' };
  const mimeType = opts.contentType || opts.mimeType || 'application/octet-stream';
  const metadata = {
    name,
    mimeType,
    parents: opts.parents?.length ? opts.parents : undefined,
  };

  const boundary = `iam_drive_${crypto.randomUUID()}`;
  const metaPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
  const content =
    typeof opts.content === 'string'
      ? new TextEncoder().encode(opts.content)
      : opts.content instanceof Uint8Array
        ? opts.content
        : new Uint8Array(opts.content);
  const header = `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const footer = `\r\n--${boundary}--`;
  const metaBytes = new TextEncoder().encode(metaPart);
  const headerBytes = new TextEncoder().encode(header);
  const footerBytes = new TextEncoder().encode(footer);
  const body = new Uint8Array(metaBytes.length + headerBytes.length + content.length + footerBytes.length);
  body.set(metaBytes, 0);
  body.set(headerBytes, metaBytes.length);
  body.set(content, metaBytes.length + headerBytes.length);
  body.set(footerBytes, metaBytes.length + headerBytes.length + content.length);

  const url = new URL('https://www.googleapis.com/upload/drive/v3/files');
  url.searchParams.set('uploadType', 'multipart');
  url.searchParams.set('fields', DRIVE_FILE_FIELDS);
  url.searchParams.set('supportsAllDrives', 'true');

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data?.error?.message || res.statusText || 'Upload failed' };
  return { ok: true, file: data };
}

/** @param {string} token @param {string} fileId @param {{ name?: string, parents?: string[] }} opts */
export async function copyDriveFileV3(token, fileId, opts = {}) {
  const body = {};
  if (opts.name) body.name = opts.name;
  if (opts.parents?.length) body.parents = opts.parents;
  const out = await driveApiRequest(token, 'POST', `/files/${encodeURIComponent(fileId)}/copy`, {
    query: { fields: DRIVE_FILE_FIELDS },
    body,
    sharedDrive: true,
  });
  return out.ok ? { ok: true, file: out.data } : out;
}

/** @param {string} token @param {string} fileId @param {object} patch */
export async function updateDriveFileV3(token, fileId, patch) {
  const out = await driveApiRequest(token, 'PATCH', `/files/${encodeURIComponent(fileId)}`, {
    query: { fields: DRIVE_FILE_FIELDS },
    body: patch,
    sharedDrive: true,
  });
  return out.ok ? { ok: true, file: out.data } : out;
}

/** @param {string} token @param {string} fileId */
export async function trashDriveFileV3(token, fileId) {
  return updateDriveFileV3(token, fileId, { trashed: true });
}

/** @param {string} token @param {string} fileId */
export async function untrashDriveFileV3(token, fileId) {
  return updateDriveFileV3(token, fileId, { trashed: false });
}

/** @param {string} token @param {string} fileId */
export async function deleteDriveFileV3(token, fileId) {
  const out = await driveApiRequest(token, 'DELETE', `/files/${encodeURIComponent(fileId)}`, { sharedDrive: true });
  return out.ok ? { ok: true } : out;
}

/** @param {string} token */
export async function emptyDriveTrashV3(token) {
  const out = await driveApiRequest(token, 'DELETE', '/files/trash', { sharedDrive: true });
  return out.ok ? { ok: true } : out;
}

// ── Changes & watch ──────────────────────────────────────────────────────────

/** @param {string} token @param {{ driveId?: string }} opts */
export async function getDriveStartPageTokenV3(token, opts = {}) {
  const query = { supportsAllDrives: 'true' };
  if (opts.driveId) query.driveId = opts.driveId;
  const out = await driveApiRequest(token, 'GET', '/changes/startPageToken', { query });
  return out.ok ? { ok: true, startPageToken: out.data?.startPageToken } : out;
}

/** @param {string} token @param {{ pageToken: string, driveId?: string, pageSize?: number }} opts */
export async function listDriveChangesV3(token, opts) {
  const pageToken = String(opts.pageToken || '').trim();
  if (!pageToken) return { ok: false, error: 'pageToken required' };
  const query = {
    pageToken,
    fields: 'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,trashed))',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    pageSize: String(opts.pageSize || 100),
  };
  if (opts.driveId) query.driveId = opts.driveId;
  const out = await driveApiRequest(token, 'GET', '/changes', { query });
  return out.ok ? { ok: true, ...out.data } : out;
}

/** @param {string} token @param {{ id: string, address: string, type?: string, token?: string, expiration?: number, pageToken: string, driveId?: string }} channel */
export async function watchDriveChangesV3(token, channel) {
  const pageToken = String(channel.pageToken || '').trim();
  if (!pageToken) return { ok: false, error: 'pageToken required' };
  if (!channel.id || !channel.address) return { ok: false, error: 'channel id and address required' };
  const query = { pageToken, supportsAllDrives: 'true' };
  if (channel.driveId) query.driveId = channel.driveId;
  const body = {
    id: channel.id,
    type: channel.type || 'web_hook',
    address: channel.address,
    token: channel.token,
    expiration: channel.expiration,
  };
  const out = await driveApiRequest(token, 'POST', '/changes/watch', { query, body });
  return out.ok ? { ok: true, channel: out.data } : out;
}

/** @param {string} token @param {string} fileId @param {{ id: string, address: string, type?: string, token?: string, expiration?: number }} channel */
export async function watchDriveFileV3(token, fileId, channel) {
  if (!channel.id || !channel.address) return { ok: false, error: 'channel id and address required' };
  const body = {
    id: channel.id,
    type: channel.type || 'web_hook',
    address: channel.address,
    token: channel.token,
    expiration: channel.expiration,
  };
  const out = await driveApiRequest(token, 'POST', `/files/${encodeURIComponent(fileId)}/watch`, {
    query: { supportsAllDrives: 'true' },
    body,
  });
  return out.ok ? { ok: true, channel: out.data } : out;
}

/** @param {string} token @param {{ id: string, resourceId: string }} channel */
export async function stopDriveChannelV3(token, channel) {
  if (!channel.id || !channel.resourceId) return { ok: false, error: 'id and resourceId required' };
  const out = await driveApiRequest(token, 'POST', '/channels/stop', { body: channel });
  return out.ok ? { ok: true } : out;
}

// ── Comments ─────────────────────────────────────────────────────────────────

const COMMENT_FIELDS = 'comments(id,content,createdTime,modifiedTime,author(displayName,emailAddress),deleted,resolved)';

/** @param {string} token @param {string} fileId */
export async function listDriveCommentsV3(token, fileId) {
  const out = await driveApiRequest(token, 'GET', `/files/${encodeURIComponent(fileId)}/comments`, {
    query: { fields: COMMENT_FIELDS, pageSize: '100' },
    sharedDrive: true,
  });
  return out.ok ? { ok: true, comments: out.data?.comments || [] } : out;
}

/** @param {string} token @param {string} fileId @param {string} commentId */
export async function getDriveCommentV3(token, fileId, commentId) {
  const out = await driveApiRequest(token, 'GET', `/files/${encodeURIComponent(fileId)}/comments/${encodeURIComponent(commentId)}`, {
    query: { fields: COMMENT_FIELDS },
    sharedDrive: true,
  });
  return out.ok ? { ok: true, comment: out.data } : out;
}

/** @param {string} token @param {string} fileId @param {string} content */
export async function createDriveCommentV3(token, fileId, content) {
  const out = await driveApiRequest(token, 'POST', `/files/${encodeURIComponent(fileId)}/comments`, {
    query: { fields: COMMENT_FIELDS },
    body: { content: String(content || '') },
    sharedDrive: true,
  });
  return out.ok ? { ok: true, comment: out.data } : out;
}

/** @param {string} token @param {string} fileId @param {string} commentId @param {string} content */
export async function updateDriveCommentV3(token, fileId, commentId, content) {
  const out = await driveApiRequest(token, 'PATCH', `/files/${encodeURIComponent(fileId)}/comments/${encodeURIComponent(commentId)}`, {
    query: { fields: COMMENT_FIELDS },
    body: { content: String(content || '') },
    sharedDrive: true,
  });
  return out.ok ? { ok: true, comment: out.data } : out;
}

/** @param {string} token @param {string} fileId @param {string} commentId */
export async function deleteDriveCommentV3(token, fileId, commentId) {
  const out = await driveApiRequest(token, 'DELETE', `/files/${encodeURIComponent(fileId)}/comments/${encodeURIComponent(commentId)}`, {
    sharedDrive: true,
  });
  return out.ok ? { ok: true } : out;
}

// ── Approvals ────────────────────────────────────────────────────────────────

const APPROVAL_FIELDS = 'id,state,createTime,updateTime,reviewers,requestedAction';

/** @param {string} token @param {string} fileId */
export async function listDriveApprovalsV3(token, fileId) {
  const out = await driveApiRequest(token, 'GET', `/files/${encodeURIComponent(fileId)}/approvals`, {
    query: { fields: `approvals(${APPROVAL_FIELDS})` },
    sharedDrive: true,
  });
  return out.ok ? { ok: true, approvals: out.data?.approvals || [] } : out;
}

/** @param {string} token @param {string} fileId @param {string} approvalId */
export async function getDriveApprovalV3(token, fileId, approvalId) {
  const out = await driveApiRequest(token, 'GET', `/files/${encodeURIComponent(fileId)}/approvals/${encodeURIComponent(approvalId)}`, {
    query: { fields: APPROVAL_FIELDS },
    sharedDrive: true,
  });
  return out.ok ? { ok: true, approval: out.data } : out;
}

/** @param {string} token @param {string} fileId @param {object} body */
export async function startDriveApprovalV3(token, fileId, body = {}) {
  const out = await driveApiRequest(token, 'POST', `/files/${encodeURIComponent(fileId)}/approvals:start`, {
    query: { fields: APPROVAL_FIELDS },
    body,
    sharedDrive: true,
  });
  return out.ok ? { ok: true, approval: out.data } : out;
}

/** @param {string} token @param {string} fileId @param {string} approvalId @param {object} body */
async function driveApprovalActionV3(token, fileId, approvalId, action, body = {}) {
  const out = await driveApiRequest(
    token,
    'POST',
    `/files/${encodeURIComponent(fileId)}/approvals/${encodeURIComponent(approvalId)}:${action}`,
    { query: { fields: APPROVAL_FIELDS }, body, sharedDrive: true },
  );
  return out.ok ? { ok: true, approval: out.data } : out;
}

export const approveDriveApprovalV3 = (t, f, a, b) => driveApprovalActionV3(t, f, a, 'approve', b);
export const declineDriveApprovalV3 = (t, f, a, b) => driveApprovalActionV3(t, f, a, 'decline', b);
export const cancelDriveApprovalV3 = (t, f, a, b) => driveApprovalActionV3(t, f, a, 'cancel', b);
export const commentDriveApprovalV3 = (t, f, a, b) => driveApprovalActionV3(t, f, a, 'comment', b);
export const reassignDriveApprovalV3 = (t, f, a, b) => driveApprovalActionV3(t, f, a, 'reassign', b);

// ── Labels ───────────────────────────────────────────────────────────────────

/** @param {string} token @param {string} fileId */
export async function listDriveLabelsV3(token, fileId) {
  const out = await driveApiRequest(token, 'GET', `/files/${encodeURIComponent(fileId)}/listLabels`, {
    sharedDrive: true,
  });
  return out.ok ? { ok: true, labels: out.data?.labels || out.data || [] } : out;
}

/** @param {string} token @param {string} fileId @param {object} body modifyLabels request */
export async function modifyDriveLabelsV3(token, fileId, body) {
  const out = await driveApiRequest(token, 'POST', `/files/${encodeURIComponent(fileId)}/modifyLabels`, {
    body,
    sharedDrive: true,
  });
  return out.ok ? { ok: true, result: out.data } : out;
}
