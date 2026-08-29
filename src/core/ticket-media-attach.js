/**
 * Attach durable media (R2 / CF Images / URL) to agentsam_tickets via media_assets
 * + agentsam_ticket_events (event_type=attachment). No columns on agentsam_tickets.
 */

import { addTicketEvent, getTicket } from './agentsam-tickets.js';
import {
  buildMediaAssetMetadataJson,
  resolveMediaKind,
  resolveMediaPurpose,
  resolveMediaSource,
  resolveMediaSourceFromContext,
} from './media-asset-meta.js';

/**
 * @param {Record<string, unknown>} params
 * @returns {boolean}
 */
export function paramsHaveTicketAttachment(params = {}) {
  if (params.media_asset_id != null && String(params.media_asset_id).trim()) return true;
  if (params.attachment_id != null && String(params.attachment_id).trim()) return true;
  if (params.cf_images_id != null && String(params.cf_images_id).trim()) return true;
  if (params.image_url != null && String(params.image_url).trim()) return true;
  const bucket = String(params.bucket || '').trim();
  const key = String(params.object_key || params.key || '').trim();
  return Boolean(bucket && key);
}

/**
 * @param {Record<string, unknown>} runContext
 * @returns {{ workspaceId: string, tenantId: string, userId: string|null }}
 */
function scopeFromContext(runContext = {}) {
  const workspaceId = String(
    runContext.workspaceId ?? runContext.workspace_id ?? '',
  ).trim();
  const tenantId = String(runContext.tenantId ?? runContext.tenant_id ?? '').trim();
  const userId =
    runContext.userId != null
      ? String(runContext.userId)
      : runContext.user_id != null
        ? String(runContext.user_id)
        : null;
  return { workspaceId, tenantId, userId };
}

/**
 * @param {string} s
 */
async function sha256HexShort(s) {
  const data = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 40);
}

/**
 * Register or reuse media_assets row and write attachment event on the ticket.
 *
 * @param {any} env
 * @param {string} ticketId
 * @param {Record<string, unknown>} params
 * @param {Record<string, unknown>} runContext
 * @param {{ actor_type?: string, actor_id?: string|null }} actor
 */
export async function attachMediaToTicket(env, ticketId, params = {}, runContext = {}, actor = {}) {
  if (!env?.DB) {
    return { ok: false, error: 'database_not_configured' };
  }
  const tid = String(ticketId || '').trim();
  if (!tid) return { ok: false, error: 'ticket_id_required' };

  const ticket = await getTicket(env, tid);
  if (!ticket) return { ok: false, error: 'ticket_not_found' };

  const { workspaceId, tenantId, userId } = scopeFromContext(runContext);
  if (!workspaceId || !tenantId) {
    return {
      ok: false,
      error: 'scope_required',
      user_message:
        'Attachment requires authenticated workspace + tenant from the caller session (not tool args).',
    };
  }

  const purpose = resolveMediaPurpose(params.purpose, 'ticket_proof');
  const source =
    params.source != null
      ? resolveMediaSource(params.source, resolveMediaSourceFromContext(runContext))
      : resolveMediaSourceFromContext(runContext);

  let mediaAssetId =
    params.media_asset_id != null ? String(params.media_asset_id).trim() : '';
  let bucket = String(params.bucket || '').trim();
  let objectKey = String(params.object_key || params.key || '').trim();
  let contentType =
    params.content_type != null
      ? String(params.content_type).trim()
      : params.contentType != null
        ? String(params.contentType).trim()
        : '';
  let filename =
    params.label != null
      ? String(params.label).trim()
      : params.filename != null
        ? String(params.filename).trim()
        : '';
  let sourceKind = 'r2';
  let sourceUri = null;
  const cfImagesId =
    params.cf_images_id != null && String(params.cf_images_id).trim()
      ? String(params.cf_images_id).trim()
      : null;
  const imageUrl =
    params.image_url != null && String(params.image_url).trim()
      ? String(params.image_url).trim()
      : null;

  if (mediaAssetId) {
    const existing = await env.DB.prepare(
      `SELECT id, bucket, object_key, content_type, filename, workspace_id
       FROM media_assets WHERE id = ? AND workspace_id = ? LIMIT 1`,
    )
      .bind(mediaAssetId, workspaceId)
      .first();
    if (!existing?.id) {
      return { ok: false, error: 'media_asset_not_found_in_workspace' };
    }
    bucket = String(existing.bucket);
    objectKey = String(existing.object_key);
    contentType = contentType || String(existing.content_type || '');
    filename = filename || String(existing.filename || '');
  } else if (cfImagesId) {
    sourceKind = 'cf_images';
    bucket = 'cloudflare-images';
    objectKey = cfImagesId;
    sourceUri = imageUrl;
    contentType = contentType || 'image/jpeg';
    filename = filename || cfImagesId;
  } else if (imageUrl) {
    sourceKind = 'url';
    bucket = 'external-url';
    objectKey = await sha256HexShort(imageUrl);
    sourceUri = imageUrl;
    contentType = contentType || 'image/jpeg';
    filename = filename || imageUrl.split('/').pop()?.slice(0, 120) || objectKey;
  } else if (bucket && objectKey) {
    sourceKind = 'r2';
    filename = filename || objectKey.split('/').pop() || objectKey;
    contentType = contentType || 'application/octet-stream';
  } else if (params.attachment_id != null && String(params.attachment_id).trim()) {
    return {
      ok: false,
      error: 'attachment_id_use_r2_put_first',
      user_message:
        'Pass attachment_id to agentsam_r2_put (writes R2 + media_assets), then attach with media_asset_id or bucket+object_key. Or pass bucket+object_key / image_url / cf_images_id here.',
    };
  } else {
    return {
      ok: false,
      error: 'attachment_ref_required',
      user_message:
        'Provide media_asset_id, bucket+object_key (R2), image_url, or cf_images_id.',
    };
  }

  let metadata;
  try {
    metadata = buildMediaAssetMetadataJson({
      ticket_id: tid,
      purpose,
      source,
      tags: params.tags ?? ['ticket-proof'],
      cf_images_id: cfImagesId,
      label: filename,
      require_ticket_id: true,
    });
  } catch (e) {
    return {
      ok: false,
      error: e?.code || e?.message || 'metadata_invalid',
      user_message: String(e?.message || e),
    };
  }

  const mediaKind = resolveMediaKind(contentType, filename);
  const assetId = mediaAssetId || `asset_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

  if (!mediaAssetId) {
    await env.DB.prepare(
      `INSERT INTO media_assets (
         id, tenant_id, workspace_id, project_id, source_kind, source_uri,
         bucket, object_key, filename, content_type, media_kind, status,
         metadata_json, created_by_user_id, created_from_workspace_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'registered', ?, ?, ?)
       ON CONFLICT(workspace_id, bucket, object_key) DO UPDATE SET
         metadata_json = excluded.metadata_json,
         content_type = COALESCE(excluded.content_type, media_assets.content_type),
         filename = COALESCE(excluded.filename, media_assets.filename),
         media_kind = excluded.media_kind,
         source_kind = excluded.source_kind,
         source_uri = COALESCE(excluded.source_uri, media_assets.source_uri),
         updated_at = datetime('now')`,
    )
      .bind(
        assetId,
        tenantId,
        workspaceId,
        params.project_id != null ? String(params.project_id).slice(0, 120) : null,
        sourceKind,
        sourceUri,
        bucket,
        objectKey,
        filename ? filename.slice(0, 240) : null,
        contentType || null,
        mediaKind,
        JSON.stringify(metadata),
        userId,
        workspaceId,
      )
      .run();

    const row = await env.DB.prepare(
      `SELECT id FROM media_assets WHERE workspace_id = ? AND bucket = ? AND object_key = ? LIMIT 1`,
    )
      .bind(workspaceId, bucket, objectKey)
      .first();
    mediaAssetId = row?.id ? String(row.id) : assetId;
  } else {
    await env.DB.prepare(
      `UPDATE media_assets SET metadata_json = ?, updated_at = datetime('now')
       WHERE id = ? AND workspace_id = ?`,
    )
      .bind(JSON.stringify(metadata), mediaAssetId, workspaceId)
      .run();
  }

  const label = filename || objectKey;
  const eventOut = await addTicketEvent(env, tid, {
    event_type: 'attachment',
    detail: JSON.stringify({
      media_asset_id: mediaAssetId,
      purpose,
      mime: contentType || null,
      label,
      bucket,
      object_key: objectKey,
      source_kind: sourceKind,
    }),
    actor_type: actor.actor_type ?? null,
    actor_id: actor.actor_id ?? null,
  });

  return {
    ok: true,
    ticket_id: tid,
    media_asset_id: mediaAssetId,
    event_id: eventOut.event_id,
    bucket,
    object_key: objectKey,
    purpose,
    content_type: contentType || null,
  };
}
