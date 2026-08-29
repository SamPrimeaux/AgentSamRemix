/**
 * POST /api/agent/attachments — stage raw bytes → att_* (SESSION_CACHE ± R2).
 * GET  /api/agent/attachments?id=att_* — peek meta (no consume).
 * DELETE /api/agent/attachments?id=att_* — discard stage.
 *
 * Auth: session identity (dashboard) or internal secret + X-IAM-* headers (MCP proxy).
 */

import { jsonResponse } from '../shared.js';
import { verifyBridgeKey } from '../../../auth/bridge-key-auth.js';
import {
  peekAgentAttachment,
  stageAgentAttachment,
  takeAgentAttachment,
  AGENT_ATTACHMENT_MAX_BYTES,
} from '../../../agentsam/attachments/stage.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function isInternalAuthorized(request, env) {
  if (verifyBridgeKey(request, env)) return true;
  const auth = request.headers.get('Authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const bridge = env?.AGENTSAM_BRIDGE_KEY != null ? String(env.AGENTSAM_BRIDGE_KEY).trim() : '';
  if (bridge && bearer === bridge) return true;
  const header = (request.headers.get('X-Internal-Secret') || '').trim();
  if (bridge && header === bridge) return true;
  return false;
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {{ userId: string, workspaceId: string|null, tenantId?: string|null } | null} identity
 */
export async function handleAgentAttachmentsApi(request, env, identity) {
  const method = request.method.toUpperCase();
  const url = new URL(request.url);

  if (!identity?.userId) {
    return jsonResponse({ ok: false, error: 'unauthenticated' }, 401);
  }
  if (!identity.workspaceId) {
    return jsonResponse({ ok: false, error: 'no_workspace', redirect: '/onboarding' }, 403);
  }

  if (method === 'GET') {
    const id = trim(url.searchParams.get('id') || url.searchParams.get('attachment_id'));
    if (!id) return jsonResponse({ ok: false, error: 'attachment_id_required' }, 400);
    const peek = await peekAgentAttachment(env, id, { workspaceId: identity.workspaceId });
    if (!peek.ok) return jsonResponse(peek, peek.error === 'attachment_not_found' ? 404 : 400);
    return jsonResponse({ ok: true, ...peek });
  }

  if (method === 'DELETE') {
    const id = trim(url.searchParams.get('id') || url.searchParams.get('attachment_id'));
    if (!id) return jsonResponse({ ok: false, error: 'attachment_id_required' }, 400);
    const taken = await takeAgentAttachment(env, id, {
      workspaceId: identity.workspaceId,
      consume: true,
    });
    if (!taken.ok && taken.error !== 'attachment_not_found') {
      return jsonResponse(taken, 400);
    }
    return jsonResponse({ ok: true, deleted: id });
  }

  if (method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  }

  const contentType = request.headers.get('content-type') || '';
  let file = null;
  let filename = null;
  let mime = null;

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    file =
      form.get('file') ||
      form.get('files') ||
      form.get('attachment') ||
      form.get('image') ||
      null;
    if (Array.isArray(file)) file = file[0];
    if (file && typeof file === 'object' && typeof file.arrayBuffer === 'function') {
      filename = trim(file.name) || trim(form.get('filename')) || null;
      mime = trim(file.type) || trim(form.get('content_type')) || null;
    } else {
      file = null;
    }
  } else if (contentType.includes('application/json')) {
    const body = await request.json().catch(() => ({}));
    const b64 = body.content_base64 ?? body.data_base64 ?? body.data;
    if (b64 == null || !String(b64).trim()) {
      return jsonResponse({ ok: false, error: 'content_base64_required' }, 400);
    }
    const { decodeInlineBase64Content } = await import('../../../agentsam/attachments/stage.js');
    const decoded = decodeInlineBase64Content(String(b64));
    if (!decoded?.bytes?.byteLength) {
      return jsonResponse({ ok: false, error: 'content_base64_invalid' }, 400);
    }
    filename = trim(body.filename) || null;
    mime = trim(body.content_type || body.contentType) || decoded.contentType || null;
    const staged = await stageAgentAttachment(env, decoded.bytes, {
      contentType: mime || 'application/octet-stream',
      filename,
      workspaceId: identity.workspaceId,
      userId: identity.userId,
      ttlSec: body.ttl_sec != null ? Number(body.ttl_sec) : undefined,
    });
    if (!staged.ok) {
      const status = staged.error === 'file_too_large' ? 413 : 400;
      return jsonResponse({ ...staged, max_bytes: AGENT_ATTACHMENT_MAX_BYTES }, status);
    }
    return jsonResponse({
      ok: true,
      attachment_id: staged.attachment_id,
      size: staged.size,
      content_type: staged.content_type,
      filename: staged.filename,
      storage: staged.storage,
      expires_in_sec: 3600,
      hint: 'Pass attachment_id to agentsam_r2_put (bucket, key, purpose). Durable gallery: /dashboard/images/storage or /dashboard/artifacts after put.',
    });
  } else {
    // Raw body
    const ab = await request.arrayBuffer();
    if (!ab.byteLength) return jsonResponse({ ok: false, error: 'empty_body' }, 400);
    filename = trim(url.searchParams.get('filename')) || null;
    mime = trim(request.headers.get('content-type')) || 'application/octet-stream';
    const staged = await stageAgentAttachment(env, new Uint8Array(ab), {
      contentType: mime,
      filename,
      workspaceId: identity.workspaceId,
      userId: identity.userId,
    });
    if (!staged.ok) {
      const status = staged.error === 'file_too_large' ? 413 : 400;
      return jsonResponse({ ...staged, max_bytes: AGENT_ATTACHMENT_MAX_BYTES }, status);
    }
    return jsonResponse({
      ok: true,
      attachment_id: staged.attachment_id,
      size: staged.size,
      content_type: staged.content_type,
      filename: staged.filename,
      storage: staged.storage,
      expires_in_sec: 3600,
      hint: 'Pass attachment_id to agentsam_r2_put (bucket, key, purpose). Durable gallery: /dashboard/images/storage or /dashboard/artifacts after put.',
    });
  }

  if (!file) {
    return jsonResponse({ ok: false, error: 'file_required', hint: 'multipart field: file' }, 400);
  }

  const ab = await file.arrayBuffer();
  const staged = await stageAgentAttachment(env, new Uint8Array(ab), {
    contentType: mime || 'application/octet-stream',
    filename: filename || 'upload.bin',
    workspaceId: identity.workspaceId,
    userId: identity.userId,
  });
  if (!staged.ok) {
    const status = staged.error === 'file_too_large' ? 413 : 400;
    return jsonResponse({ ...staged, max_bytes: AGENT_ATTACHMENT_MAX_BYTES }, status);
  }
  return jsonResponse({
    ok: true,
    attachment_id: staged.attachment_id,
    size: staged.size,
    content_type: staged.content_type,
    filename: staged.filename,
    storage: staged.storage,
    expires_in_sec: 3600,
    hint: 'Pass attachment_id to agentsam_r2_put (bucket, key, purpose). Durable gallery: /dashboard/images/storage or /dashboard/artifacts after put.',
  });
}

/**
 * POST /api/internal/agent/attachments — MCP / automation proxy.
 * Auth: AGENTSAM_BRIDGE_KEY (Bearer or X-Internal-Secret).
 * Identity: X-IAM-User-Id, X-IAM-Workspace-Id, optional X-IAM-Tenant-Id.
 */
export async function handleInternalAgentAttachments(request, env) {
  if (!isInternalAuthorized(request, env)) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }
  const userId = trim(
    request.headers.get('X-IAM-User-Id') || request.headers.get('x-iam-user-id'),
  );
  const workspaceId = trim(
    request.headers.get('X-IAM-Workspace-Id') || request.headers.get('x-iam-workspace-id'),
  );
  const tenantId = trim(
    request.headers.get('X-IAM-Tenant-Id') || request.headers.get('x-iam-tenant-id'),
  );
  if (!userId || !workspaceId) {
    return jsonResponse({ ok: false, error: 'identity_headers_required' }, 400);
  }
  return handleAgentAttachmentsApi(request, env, {
    userId,
    workspaceId,
    tenantId: tenantId || null,
  });
}
