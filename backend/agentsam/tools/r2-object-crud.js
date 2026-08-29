/**
 * Agent Sam R2 catalog ops — get / put / delete only (no wrangler `r2 object list`).
 * Platform Worker bindings (owner) OR per-user S3 keys from user_storage_access_keys.
 * Put path writes IAM customMetadata (non-fatal) and optionally registers media_assets.
 */
import {
  r2FetchObjectViaBindingOrS3,
  r2PutViaBindingOrS3,
  r2DeleteViaBindingOrS3,
  r2HeadViaBindingOrS3,
} from '../../../src/core/r2.js';
import {
  getR2Binding,
  listR2BucketsForCatalog,
  listR2ObjectsForCatalog,
} from '../../../src/api/r2-api.js';
import { detectFileKind } from '../../../src/core/file-kind.js';
import { buildR2CustomMetadata } from '../../../src/core/r2-image-metadata.js';
import {
  decodeInlineBase64Content,
  takeAgentAttachment,
} from '../attachments/stage.js';
import {
  buildMediaAssetMetadataJson,
  resolveMediaKind,
  resolveMediaPurpose,
  resolveMediaSource,
  resolveMediaSourceFromContext,
} from '../../../src/core/media-asset-meta.js';

/**
 * @param {string} operation
 */
export function normalizeR2CatalogOperation(operation) {
  const raw = String(operation || '').toLowerCase();
  if (raw.startsWith('r2.')) return raw.slice(3);
  return raw;
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} params
 * @param {Record<string, unknown>} config
 * @param {'buckets'|'objects'} mode
 */
export async function executeR2ListCatalogOperation(env, params, config, mode) {
  if (mode === 'buckets') {
    // Internal/platform binding inventory only — account-wide listing is agentsam_cf_r2_buckets.
    const out = await listR2BucketsForCatalog(env, { all: true });
    return {
      ok: true,
      mode: 'buckets',
      ...out,
      hint: 'Account bucket inventory for agents: agentsam_cf_r2_buckets. Object listing: agentsam_r2_list with bucket.',
    };
  }

  const bucket = String(
    params.bucket || config.bucket || config.binding || config.default_bucket || '',
  ).trim();
  const prefix = params.prefix != null ? String(params.prefix) : '';
  const limit = Math.min(1000, Math.max(1, Number(params.limit) || 100));
  const recursive = params.recursive === true || params.recursive === 1;
  const cursor =
    params.cursor != null
      ? String(params.cursor).trim()
      : params.continuation_token != null
        ? String(params.continuation_token).trim()
        : '';
  return listR2ObjectsForCatalog(env, {
    bucket,
    prefix,
    limit,
    recursive,
    cursor: cursor || undefined,
  });
}

/**
 * @param {any} env
 * @param {string} bucketOrBinding
 */
function resolveBucketAndBinding(env, bucketOrBinding) {
  const bucketName = String(bucketOrBinding || '').trim();
  const binding = bucketName ? getR2Binding(env, bucketName) : null;
  return { bucketName, binding };
}

/**
 * @param {Record<string, unknown>} [runContext]
 */
function scopeFromRunContext(runContext = {}) {
  return {
    workspaceId: String(runContext.workspaceId ?? runContext.workspace_id ?? '').trim(),
    tenantId: String(runContext.tenantId ?? runContext.tenant_id ?? '').trim(),
    userId:
      runContext.userId != null
        ? String(runContext.userId)
        : runContext.user_id != null
          ? String(runContext.user_id)
          : null,
  };
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} params
 * @param {Record<string, unknown>} config
 * @param {string} operation read|write|delete|get|put
 * @param {Record<string, unknown>} [runContext]
 */
export async function executeR2CatalogOperation(env, params, config, operation, runContext = {}) {
  const op = String(operation || 'read').toLowerCase();
  const bucket = String(params.bucket || config.bucket || config.binding || '').trim();
  const key = String(params.key || params.object_key || params.path || '').trim();
  const { bucketName, binding } = resolveBucketAndBinding(env, bucket);

  if (!bucketName) {
    return {
      ok: false,
      error: 'bucket_required',
      user_message: 'R2 operation requires bucket and key.',
    };
  }

  if (!env.R2_ACCESS_KEY_ID && !binding) {
    return {
      ok: false,
      error: 'customer_r2_not_connected',
      user_message:
        'Connect your Cloudflare R2 API keys in Settings → Storage (Access Key + Secret). IAM platform R2 bindings are not available for your account.',
    };
  }

  if (op === 'read' || op === 'get') {
    if (!key) {
      return {
        ok: false,
        error: 'key_required',
        user_message: 'r2_read requires bucket and key (object path). Listing is not supported — use an explicit key.',
      };
    }
    const meta = await r2HeadViaBindingOrS3(env, binding, bucketName, key);
    if (!meta) return { ok: false, error: 'not_found', bucket: bucketName, key };
    const fetched = await r2FetchObjectViaBindingOrS3(env, binding, bucketName, key);
    if (!fetched) return { ok: false, error: 'read_failed', bucket: bucketName, key };
    const kind = detectFileKind({ key, contentType: fetched.contentType, size: fetched.body?.byteLength });
    const isText = kind === 'text' || (fetched.contentType || '').startsWith('text/');
    return {
      ok: true,
      bucket: bucketName,
      key,
      contentType: fetched.contentType,
      size: fetched.body?.byteLength ?? meta.size,
      fileKind: kind,
      content: isText ? new TextDecoder().decode(fetched.body) : null,
      binary: !isText,
      customMetadata: meta.customMetadata || {},
      hint: isText ? null : 'Binary object — use signed URL or dashboard preview; content omitted.',
    };
  }

  if (op === 'write' || op === 'put') {
    if (!key) {
      return {
        ok: false,
        error: 'key_required',
        user_message: 'r2_write requires bucket, key, and content or attachment_id.',
      };
    }

    const scope = scopeFromRunContext(runContext);
    let payload = null;
    let contentType =
      params.content_type != null
        ? String(params.content_type)
        : params.contentType != null
          ? String(params.contentType)
          : 'application/octet-stream';

    const attachmentId =
      params.attachment_id != null ? String(params.attachment_id).trim() : '';
    if (attachmentId) {
      const taken = await takeAgentAttachment(env, attachmentId, {
        workspaceId: scope.workspaceId || null,
        consume: true,
      });
      if (!taken.ok) {
        return {
          ok: false,
          error: taken.error || 'attachment_not_found',
          user_message: 'attachment_id not found or expired — stage bytes first.',
        };
      }
      payload = taken.bytes;
      if (!params.content_type && !params.contentType && taken.contentType) {
        contentType = taken.contentType;
      }
    } else if (params.content_base64 != null && String(params.content_base64).trim()) {
      // Practical MCP binary path (optional); preferred long-term is attachment_id.
      const decoded = decodeInlineBase64Content(String(params.content_base64));
      if (!decoded?.bytes?.byteLength) {
        return { ok: false, error: 'content_base64_invalid' };
      }
      payload = decoded.bytes;
      if (decoded.contentType && contentType === 'application/octet-stream') {
        contentType = decoded.contentType;
      }
    } else {
      const content = params.content ?? params.body ?? params.data;
      if (content == null) {
        return {
          ok: false,
          error: 'content_required',
          user_message: 'Provide content (UTF-8 text), content_base64, or attachment_id.',
        };
      }
      payload =
        typeof content === 'string'
          ? new TextEncoder().encode(content)
          : content instanceof ArrayBuffer
            ? new Uint8Array(content)
            : content;
    }

    const purpose = resolveMediaPurpose(params.purpose, 'general');
    const source =
      params.source != null
        ? resolveMediaSource(params.source, resolveMediaSourceFromContext(runContext))
        : resolveMediaSourceFromContext(runContext);

    let customMetadata = {};
    let metadataOk = true;
    try {
      customMetadata = buildR2CustomMetadata({
        tags: params.tags,
        meta: {
          label: params.label != null ? String(params.label) : key.split('/').pop(),
          category: purpose,
          notes: purpose === 'ticket_proof' ? 'ticket_proof' : undefined,
        },
        scope: {
          userId: scope.userId || undefined,
          workspaceId: scope.workspaceId || undefined,
          tenantId: scope.tenantId || undefined,
        },
      });
      if (purpose) customMetadata.iam_purpose = String(purpose).slice(0, 64);
      if (source) customMetadata.iam_source = String(source).slice(0, 64);
    } catch (e) {
      metadataOk = false;
      console.warn('[r2_put] customMetadata build failed (non-fatal)', e?.message || e);
      customMetadata = {};
    }

    let written = false;
    try {
      written = await r2PutViaBindingOrS3(
        env,
        binding,
        bucketName,
        key,
        payload,
        contentType,
        customMetadata,
      );
    } catch (e) {
      // Retry once without metadata if put failed due to metadata
      console.warn('[r2_put] put with metadata threw; retry bare', e?.message || e);
      metadataOk = false;
      try {
        written = await r2PutViaBindingOrS3(
          env,
          binding,
          bucketName,
          key,
          payload,
          contentType,
          {},
        );
      } catch (e2) {
        return {
          ok: false,
          error: 'put_failed',
          bucket: bucketName,
          key,
          written: false,
          metadata_ok: false,
          user_message: String(e2?.message || e2),
        };
      }
    }

    if (!written) {
      return {
        ok: false,
        error: 'put_failed',
        bucket: bucketName,
        key,
        written: false,
        metadata_ok: false,
      };
    }

    // Confirm metadata via HEAD when we attempted to write it
    let headMeta = customMetadata;
    if (Object.keys(customMetadata).length) {
      try {
        const head = await r2HeadViaBindingOrS3(env, binding, bucketName, key);
        if (head?.customMetadata && Object.keys(head.customMetadata).length) {
          headMeta = head.customMetadata;
        } else {
          metadataOk = false;
        }
      } catch {
        metadataOk = false;
      }
    }

    let mediaAssetId = null;
    const register =
      params.register_media_asset !== false &&
      params.registerMediaAsset !== false;
    if (register && scope.workspaceId && scope.tenantId && env.DB) {
      try {
        const filename =
          params.label != null
            ? String(params.label).trim().slice(0, 240)
            : key.split('/').pop() || key;
        const metadataJson = buildMediaAssetMetadataJson({
          purpose,
          source,
          tags: params.tags,
          label: filename,
          ticket_id: null,
        });
        const assetId = `asset_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
        const mediaKind = resolveMediaKind(contentType, filename);
        await env.DB.prepare(
          `INSERT INTO media_assets (
             id, tenant_id, workspace_id, source_kind, bucket, object_key, filename,
             content_type, media_kind, size_bytes, status, metadata_json,
             created_by_user_id, created_from_workspace_id
           ) VALUES (?, ?, ?, 'r2', ?, ?, ?, ?, ?, ?, 'uploaded', ?, ?, ?)
           ON CONFLICT(workspace_id, bucket, object_key) DO UPDATE SET
             metadata_json = excluded.metadata_json,
             content_type = excluded.content_type,
             size_bytes = excluded.size_bytes,
             media_kind = excluded.media_kind,
             status = 'uploaded',
             updated_at = datetime('now')`,
        )
          .bind(
            assetId,
            scope.tenantId,
            scope.workspaceId,
            bucketName,
            key,
            filename,
            contentType,
            mediaKind,
            payload?.byteLength ?? null,
            JSON.stringify(metadataJson),
            scope.userId,
            scope.workspaceId,
          )
          .run();
        const row = await env.DB.prepare(
          `SELECT id FROM media_assets WHERE workspace_id = ? AND bucket = ? AND object_key = ? LIMIT 1`,
        )
          .bind(scope.workspaceId, bucketName, key)
          .first();
        mediaAssetId = row?.id ? String(row.id) : assetId;
      } catch (e) {
        console.warn('[r2_put] media_assets register non-fatal', e?.message || e);
      }
    }

    return {
      ok: true,
      bucket: bucketName,
      key,
      written: true,
      content_type: contentType,
      custom_metadata: headMeta,
      metadata_ok: metadataOk,
      media_asset_id: mediaAssetId,
    };
  }

  if (op === 'delete') {
    if (!key) {
      return {
        ok: false,
        error: 'key_required',
        user_message: 'r2_delete requires bucket and key.',
      };
    }
    const ok = await r2DeleteViaBindingOrS3(env, binding, bucketName, key);
    return ok
      ? { ok: true, bucket: bucketName, key, deleted: true }
      : { ok: false, error: 'delete_failed', bucket: bucketName, key };
  }

  return {
    ok: false,
    error: 'unsupported_r2_operation',
    user_message:
      'Supported R2 operations: read (get), write (put), delete. Use explicit object keys — not directory listing.',
    operation: op,
  };
}

/**
 * @param {string} operation
 */
export function isR2ListLikeOperation(operation) {
  const op = normalizeR2CatalogOperation(operation);
  return op === 'list' || op === 'search' || op === 'bucket_summary';
}
