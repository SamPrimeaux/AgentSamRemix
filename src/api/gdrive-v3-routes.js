/**
 * Extended Google Drive API v3 routes (files ops, changes, watch, comments, approvals, labels).
 */

import {
  approveDriveApprovalV3,
  cancelDriveApprovalV3,
  commentDriveApprovalV3,
  copyDriveFileV3,
  createDriveCommentV3,
  createDriveMetadataV3,
  declineDriveApprovalV3,
  deleteDriveCommentV3,
  deleteDriveFileV3,
  emptyDriveTrashV3,
  getDriveApprovalV3,
  getDriveCommentV3,
  getDriveStartPageTokenV3,
  listDriveApprovalsV3,
  listDriveChangesV3,
  listDriveCommentsV3,
  listDriveLabelsV3,
  modifyDriveLabelsV3,
  reassignDriveApprovalV3,
  startDriveApprovalV3,
  stopDriveChannelV3,
  trashDriveFileV3,
  untrashDriveFileV3,
  updateDriveCommentV3,
  updateDriveFileV3,
  uploadDriveFileV3,
  watchDriveChangesV3,
  watchDriveFileV3,
} from '../integrations/gdrive-v3-ops.js';

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/**
 * @param {Request} request
 * @param {string} pathLower
 * @param {string} method
 * @param {URL} url
 * @param {() => Promise<{ ok: boolean, token?: string, error?: string, status?: number }>} driveAuth
 */
export async function handleGdriveV3ExtendedRoutes(request, pathLower, method, url, driveAuth) {
  // Webhook receiver for Drive push notifications (no auth — verified via channel token in production)
  if (method === 'POST' && pathLower === '/api/integrations/gdrive/webhook') {
    const channelId = request.headers.get('X-Goog-Channel-ID');
    const resourceState = request.headers.get('X-Goog-Resource-State');
    const messageNumber = request.headers.get('X-Goog-Message-Number');
    return jsonResponse({ ok: true, channelId, resourceState, messageNumber });
  }

  const auth = await driveAuth();
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status || 400);

  const v3 = (payload, status = 200) => jsonResponse({ ...payload, apiVersion: 3 }, status);
  const err = (out, fallback = 502) => jsonResponse({ error: out.error || 'request_failed', apiVersion: 3 }, out.status || fallback);

  // ── Changes ────────────────────────────────────────────────────────────────
  if (method === 'GET' && pathLower === '/api/integrations/gdrive/changes/startpagetoken') {
    const out = await getDriveStartPageTokenV3(auth.token, { driveId: url.searchParams.get('driveId') || undefined });
    return out.ok ? v3({ startPageToken: out.startPageToken }) : err(out);
  }

  if (method === 'GET' && pathLower === '/api/integrations/gdrive/changes') {
    const out = await listDriveChangesV3(auth.token, {
      pageToken: url.searchParams.get('pageToken') || '',
      driveId: url.searchParams.get('driveId') || undefined,
      pageSize: Number(url.searchParams.get('pageSize')) || 100,
    });
    return out.ok ? v3(out) : err(out);
  }

  if (method === 'POST' && pathLower === '/api/integrations/gdrive/changes/watch') {
    const body = (await readJson(request)) || {};
    const out = await watchDriveChangesV3(auth.token, body);
    return out.ok ? v3({ channel: out.channel }) : err(out);
  }

  if (method === 'POST' && pathLower === '/api/integrations/gdrive/channels/stop') {
    const body = (await readJson(request)) || {};
    const out = await stopDriveChannelV3(auth.token, body);
    return out.ok ? v3({ ok: true }) : err(out);
  }

  // ── Trash (empty) ──────────────────────────────────────────────────────────
  if (method === 'DELETE' && pathLower === '/api/integrations/gdrive/trash') {
    const out = await emptyDriveTrashV3(auth.token);
    return out.ok ? v3({ ok: true }) : err(out);
  }

  // ── Create file/folder or upload ───────────────────────────────────────────
  if (method === 'POST' && pathLower === '/api/integrations/gdrive/files') {
    const contentType = request.headers.get('Content-Type') || '';
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      const name = String(form.get('name') || (file instanceof File ? file.name : '') || '').trim();
      const parentId = String(form.get('parentId') || form.get('folderId') || 'root').trim();
      const parents = parentId && parentId !== 'root' ? [parentId] : undefined;
      if (!(file instanceof File)) return jsonResponse({ error: 'file required in multipart body' }, 400);
      const buf = await file.arrayBuffer();
      const out = await uploadDriveFileV3(auth.token, {
        name,
        content: buf,
        contentType: file.type || 'application/octet-stream',
        parents,
      });
      return out.ok ? v3({ file: out.file }) : err(out);
    }

    const body = (await readJson(request)) || {};
    if (body.content != null) {
      const out = await uploadDriveFileV3(auth.token, {
        name: body.name,
        content: typeof body.content === 'string' ? body.content : body.content,
        contentType: body.mimeType || body.contentType,
        parents: body.parents || (body.parentId ? [body.parentId] : undefined),
      });
      return out.ok ? v3({ file: out.file }) : err(out);
    }

    const out = await createDriveMetadataV3(auth.token, {
      name: body.name,
      mimeType: body.mimeType,
      parents: body.parents || (body.parentId ? [body.parentId] : undefined),
    });
    return out.ok ? v3({ file: out.file }) : err(out);
  }

  // File-scoped sub-routes: /api/integrations/gdrive/files/:fileId/...
  const fileMatch = pathLower.match(/^\/api\/integrations\/gdrive\/files\/([^/]+)(?:\/(.+))?$/);
  if (fileMatch) {
    const fileId = decodeURIComponent(fileMatch[1] || '');
    const sub = fileMatch[2] || '';

    if (method === 'PATCH' && !sub) {
      const body = (await readJson(request)) || {};
      const out = await updateDriveFileV3(auth.token, fileId, body);
      return out.ok ? v3({ file: out.file }) : err(out);
    }

    if (method === 'DELETE' && !sub) {
      const out = await deleteDriveFileV3(auth.token, fileId);
      return out.ok ? v3({ ok: true }) : err(out);
    }

    if (method === 'POST' && sub === 'copy') {
      const body = (await readJson(request)) || {};
      const out = await copyDriveFileV3(auth.token, fileId, body);
      return out.ok ? v3({ file: out.file }) : err(out);
    }

    if (method === 'POST' && sub === 'trash') {
      const out = await trashDriveFileV3(auth.token, fileId);
      return out.ok ? v3({ file: out.file }) : err(out);
    }

    if (method === 'POST' && sub === 'untrash') {
      const out = await untrashDriveFileV3(auth.token, fileId);
      return out.ok ? v3({ file: out.file }) : err(out);
    }

    if (method === 'POST' && sub === 'watch') {
      const body = (await readJson(request)) || {};
      const out = await watchDriveFileV3(auth.token, fileId, body);
      return out.ok ? v3({ channel: out.channel }) : err(out);
    }

    // Comments
    if (sub === 'comments') {
      if (method === 'GET') {
        const out = await listDriveCommentsV3(auth.token, fileId);
        return out.ok ? v3({ comments: out.comments }) : err(out);
      }
      if (method === 'POST') {
        const body = (await readJson(request)) || {};
        const out = await createDriveCommentV3(auth.token, fileId, body.content || '');
        return out.ok ? v3({ comment: out.comment }) : err(out);
      }
    }

    const commentMatch = sub.match(/^comments\/([^/]+)$/);
    if (commentMatch) {
      const commentId = decodeURIComponent(commentMatch[1]);
      if (method === 'GET') {
        const out = await getDriveCommentV3(auth.token, fileId, commentId);
        return out.ok ? v3({ comment: out.comment }) : err(out);
      }
      if (method === 'PATCH') {
        const body = (await readJson(request)) || {};
        const out = await updateDriveCommentV3(auth.token, fileId, commentId, body.content || '');
        return out.ok ? v3({ comment: out.comment }) : err(out);
      }
      if (method === 'DELETE') {
        const out = await deleteDriveCommentV3(auth.token, fileId, commentId);
        return out.ok ? v3({ ok: true }) : err(out);
      }
    }

    // Labels
    if (sub === 'labels' && method === 'GET') {
      const out = await listDriveLabelsV3(auth.token, fileId);
      return out.ok ? v3({ labels: out.labels }) : err(out);
    }
    if (sub === 'labels' && method === 'POST') {
      const body = (await readJson(request)) || {};
      const out = await modifyDriveLabelsV3(auth.token, fileId, body);
      return out.ok ? v3({ result: out.result }) : err(out);
    }

    // Approvals
    if (sub === 'approvals' && method === 'GET') {
      const out = await listDriveApprovalsV3(auth.token, fileId);
      return out.ok ? v3({ approvals: out.approvals }) : err(out);
    }
    if (sub === 'approvals/start' && method === 'POST') {
      const body = (await readJson(request)) || {};
      const out = await startDriveApprovalV3(auth.token, fileId, body);
      return out.ok ? v3({ approval: out.approval }) : err(out);
    }

    const approvalGet = sub.match(/^approvals\/([^/]+)$/);
    if (approvalGet && method === 'GET') {
      const out = await getDriveApprovalV3(auth.token, fileId, decodeURIComponent(approvalGet[1]));
      return out.ok ? v3({ approval: out.approval }) : err(out);
    }

    const approvalAction = sub.match(/^approvals\/([^/]+)\/(approve|decline|cancel|comment|reassign)$/);
    if (approvalAction && method === 'POST') {
      const approvalId = decodeURIComponent(approvalAction[1]);
      const action = approvalAction[2];
      const body = (await readJson(request)) || {};
      const handlers = {
        approve: approveDriveApprovalV3,
        decline: declineDriveApprovalV3,
        cancel: cancelDriveApprovalV3,
        comment: commentDriveApprovalV3,
        reassign: reassignDriveApprovalV3,
      };
      const fn = handlers[action];
      const out = await fn(auth.token, fileId, approvalId, body);
      return out.ok ? v3({ approval: out.approval }) : err(out);
    }
  }

  return null;
}
