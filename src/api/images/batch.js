/** Images API: batch operations and capability reporting. */

import { jsonResponse } from '../../core/responses.js';
import { getR2Binding, listR2BucketsForCatalog, listBoundR2BucketNames, listR2ObjectsForCatalog } from '../r2-api.js';
import {
  assertDashboardR2BucketAccess,
  applyWorkspaceR2Transport,
} from '../../core/r2-storage-scope.js';
import { mergeR2S3EnvFromUserStorage } from '../../core/user-storage-r2-credentials.js';
import { r2PutViaBindingOrS3, r2HeadViaBindingOrS3 } from '../../core/r2.js';
import { getOAuthToken } from '../../../backend/identity/oauth/user-token.js';
import { canAccessMediaObjectKey } from '../../core/media-r2-access.js';
import { rateImageGeneration, runImageGenerationForTool } from '../../../backend/agentsam/tools/image_generation.js';
import {
  saveImageDraft,
  setImageProject,
  discardImageDraft,
  imageGenerationShouldPersist,
  IMAGE_SAVE_CATEGORY_PRESETS,
} from '../../core/image-draft-store.js';
import {
  enrichItemsFromR2CustomMetadata,
  normalizeTags,
  parseIamMetaFromStorage,
  putR2ImageWithCustomMetadata,
  syncR2ObjectCustomMetadata,
} from '../../core/r2-image-metadata.js';
import {
  getResourceTags,
  listAccountTagKeys,
  listValuesForKey,
  mergeResourceTag,
  removeResourceTag,
  syncImageResourceTags,
} from '../../core/cf-resource-tags.js';
import {
  ALLOWED_TRANSFORM_OPS,
  LimitExceededError,
  TransformValidationError,
  applyBindingPipeline,
  assertTransformableMime,
  assertWithinBindingInputLimit,
  assertWithinHostedUploadLimit,
  batchDeleteFromCfImages,
  batchPatchCfImageMeta,
  batchUploadToCfImages,
  buildFlexibleDeliveryUrl,
  createCfImageVariant,
  listCfImageVariants,
  runCfImagesBatch,
} from '../../core/cf-images-transform.js';
import {
  BUCKET,
  decodeR2BrowseId,
  encodeR2BrowseId,
  extFromMime,
  mediaIdToKey,
  mimeFromKey,
  safeFilename,
} from './ids.js';
import {
  buildCfImagesMetaPayload,
  buildMetaFromRow,
  buildR2SidecarPayload,
  iamTagsToResourceTagsMap,
  metaSidecarKey,
  parseMetadata,
  parseTags,
  resourceTagsMapToIamTags,
  sanitizeResourceTagsMap,
} from './meta.js';
import {
  cfDeliveryUrl,
  mapCfApiImage,
  mapD1RowToItem,
  mapDriveFile,
  mapR2BrowseObject,
  proxyR2Url,
} from './map.js';
import { resolveScope } from './scope.js';

import { deleteCfImage, driveAccountSummary, syncR2ImageMeta } from './storage.js';
import { getImageRowForPatch } from './cf.js';

const MAX_BYTES = 15 * 1024 * 1024;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
/** CF Images hosted upload (non-Enterprise). AVIF input is Enterprise-only — treat as unsupported here. */
const CF_IMAGES_INPUT_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/heic',
  'image/heif',
]);
const CF_IMAGES_INPUT_LABEL = 'JPEG, PNG, WebP, GIF, HEIC, or SVG';

export async function handleBatchTags(request, url, env, authUser, identity) {
  const scope = await resolveScope(
    env,
    authUser,
    identity,
    url.searchParams.get('workspace_id')?.trim(),
  );
  if (scope.error) return jsonResponse({ error: scope.error }, scope.status);
  if (!env?.DB) return jsonResponse({ error: 'DB not configured' }, 503);

  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
  const add = normalizeTags(body.add);
  const remove = new Set(normalizeTags(body.remove));
  if (!ids.length) return jsonResponse({ error: 'ids required' }, 400);
  if (!add.length && !remove.size) return jsonResponse({ error: 'add or remove required' }, 400);

  const results = [];
  const cfPatchQueue = [];

  for (const id of ids) {
    const rowOrErr = await getImageRowForPatch(env, id, scope, authUser, url.origin);
    if (!rowOrErr || rowOrErr.forbidden) {
      results.push({ id, ok: false, error: !rowOrErr ? 'not_found' : 'forbidden' });
      continue;
    }
    const row = rowOrErr;
    const current = normalizeTags(parseTags(row.tags));
    const merged = normalizeTags([...current.filter((t) => !remove.has(t)), ...add]);
    await env.DB.prepare(`UPDATE images SET tags = ?, updated_at = unixepoch() WHERE id = ?`)
      .bind(JSON.stringify(merged), row.id)
      .run();
    if (row.cloudflare_image_id) {
      cfPatchQueue.push({ row, merged });
    } else if (row.r2_key) {
      const sidecar = buildR2SidecarPayload({
        tags: merged,
        meta: buildMetaFromRow(row),
        alt_text: row.alt_text,
        scope,
      });
      await syncR2ImageMeta(env, row.r2_key, sidecar, merged, scope, row.size);
    }
    results.push({ id, ok: true, tags: merged });
  }

  // CF-side meta patches route through the batch API once there's more than a couple of
  // hosted images involved (QC-13) — keeps multi-select tagging off the global CF API rate limit.
  if (cfPatchQueue.length) {
    const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
    const apiToken = String(env.CLOUDFLARE_IMAGES_TOKEN || env.CLOUDFLARE_IMAGES_API_TOKEN || '').trim();
    if (accountId && apiToken) {
      try {
        await runCfImagesBatch(accountId, apiToken, cfPatchQueue, async ({ row, merged }, batchToken) => {
          const payload = buildCfImagesMetaPayload({
            tags: merged,
            meta: buildMetaFromRow(row),
            scope,
            alt_text: row.alt_text,
            filename: row.filename,
          });
          return batchPatchCfImageMeta(batchToken, row.cloudflare_image_id, payload);
        });
      } catch {
        // best-effort — D1 tags are already the SSOT; CF meta mirror can lag and self-heal on next PATCH.
      }
    }
  }

  return jsonResponse({ ok: true, results });
}

export async function handleBatchDelete(request, url, env, authUser, identity) {
  const scope = await resolveScope(
    env,
    authUser,
    identity,
    url.searchParams.get('workspace_id')?.trim(),
  );
  if (scope.error) return jsonResponse({ error: scope.error }, scope.status);
  if (!env?.DB) return jsonResponse({ error: 'DB not configured' }, 503);

  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
  if (!ids.length) return jsonResponse({ error: 'ids required' }, 400);

  const results = [];
  const cfDeleteQueue = [];

  for (const id of ids) {
    if (String(id).startsWith('drive_')) {
      results.push({ id, ok: false, error: 'drive items are browse-only' });
      continue;
    }
    if (String(id).startsWith('cf_live_')) {
      cfDeleteQueue.push({ id, cfId: String(id).slice('cf_live_'.length), r2Key: null });
      continue;
    }
    const row = await env.DB.prepare(`SELECT * FROM images WHERE id = ? LIMIT 1`).bind(id).first();
    if (!row) {
      results.push({ id, ok: false, error: 'not_found' });
      continue;
    }
    if (String(row.user_id) !== String(authUser.id) || String(row.workspace_id) !== String(scope.workspaceId)) {
      results.push({ id, ok: false, error: 'forbidden' });
      continue;
    }
    if (row.cloudflare_image_id) {
      cfDeleteQueue.push({ id, cfId: row.cloudflare_image_id, r2Key: row.r2_key });
      continue;
    }
    if (row.r2_key) {
      const binding = getR2Binding(env, BUCKET);
      await binding?.delete?.(row.r2_key).catch(() => {});
      await binding?.delete?.(metaSidecarKey(row.r2_key)).catch(() => {});
    }
    await env.DB.prepare(`UPDATE images SET status = 'deleted', updated_at = unixepoch() WHERE id = ?`)
      .bind(id)
      .run();
    results.push({ id, ok: true });
  }

  if (cfDeleteQueue.length) {
    const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
    const apiToken = String(env.CLOUDFLARE_IMAGES_TOKEN || env.CLOUDFLARE_IMAGES_API_TOKEN || '').trim();
    const useBatch = accountId && apiToken && cfDeleteQueue.length > 2;

    const finalizeOne = async (entry) => {
      if (entry.r2Key) {
        const binding = getR2Binding(env, BUCKET);
        await binding?.delete?.(entry.r2Key).catch(() => {});
        await binding?.delete?.(metaSidecarKey(entry.r2Key)).catch(() => {});
      }
      if (!String(entry.id).startsWith('cf_live_')) {
        await env.DB.prepare(`UPDATE images SET status = 'deleted', updated_at = unixepoch() WHERE id = ?`)
          .bind(entry.id)
          .run();
      }
    };

    if (useBatch) {
      try {
        await runCfImagesBatch(accountId, apiToken, cfDeleteQueue, async (entry, batchToken) => {
          await batchDeleteFromCfImages(batchToken, entry.cfId);
          await finalizeOne(entry);
          return true;
        });
        for (const entry of cfDeleteQueue) results.push({ id: entry.id, ok: true });
      } catch {
        for (const entry of cfDeleteQueue) {
          await deleteCfImage(env, entry.cfId);
          await finalizeOne(entry);
          results.push({ id: entry.id, ok: true });
        }
      }
    } else {
      for (const entry of cfDeleteQueue) {
        await deleteCfImage(env, entry.cfId);
        await finalizeOne(entry);
        results.push({ id: entry.id, ok: true });
      }
    }
  }

  return jsonResponse({ ok: true, results });
}

export async function handleBatchMigrate(request, url, env, authUser, identity) {
  const scope = await resolveScope(
    env,
    authUser,
    identity,
    url.searchParams.get('workspace_id')?.trim(),
  );
  if (scope.error) return jsonResponse({ error: scope.error }, scope.status);
  if (!env?.DB) return jsonResponse({ error: 'DB not configured' }, 503);

  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
  const target = body.target === 'r2' ? 'r2' : 'cf_images';
  if (!ids.length) return jsonResponse({ error: 'ids required' }, 400);
  if (target !== 'cf_images') {
    return jsonResponse(
      { error: 'migrate target=r2 not supported: iam-uploaded assets already keep an R2 original; use Export instead.' },
      400,
    );
  }

  const { resolveCfImagesUploadContext } = await import('../../core/cf-oauth-images.js');
  const cfCtx = await resolveCfImagesUploadContext(env, {
    userId: scope.userId,
    workspaceId: scope.workspaceId,
  });
  if (!cfCtx.ok) {
    return jsonResponse({ error: cfCtx.error, detail: cfCtx.detail, accounts: cfCtx.accounts }, 403);
  }

  const rows = [];
  for (const id of ids) {
    const row = await env.DB.prepare(
      `SELECT * FROM images WHERE id = ? AND COALESCE(status,'active')='active' LIMIT 1`,
    )
      .bind(id)
      .first();
    if (!row) continue;
    if (String(row.user_id) !== String(authUser.id) || String(row.workspace_id) !== String(scope.workspaceId)) continue;
    if (row.cloudflare_image_id) continue; // already hosted
    if (!row.r2_key) continue;
    rows.push(row);
  }
  if (!rows.length) return jsonResponse({ ok: true, results: [], note: 'no eligible R2-only images found' });

  const binding = getR2Binding(env, BUCKET);
  const accountHash = cfCtx.accountHash || String(env.CLOUDFLARE_IMAGES_ACCOUNT_HASH || '').trim();

  const batchOutcomes = await runCfImagesBatch(cfCtx.accountId, cfCtx.token, rows, async (row, batchToken) => {
    const obj = await binding?.get?.(row.r2_key);
    if (!obj?.body) throw new Error('R2 object missing');
    const buf = await new Response(obj.body).arrayBuffer();
    assertWithinHostedUploadLimit(buf.byteLength);
    const meta = buildMetaFromRow(row);
    const cfMetaPayload = buildCfImagesMetaPayload({
      tags: parseTags(row.tags),
      meta,
      scope,
      alt_text: row.alt_text,
      filename: row.filename,
    });
    const file = new File([buf], row.filename || 'image.jpg', { type: row.mime_type || 'image/jpeg' });
    const result = await batchUploadToCfImages(batchToken, file, cfMetaPayload);
    const publicUrl = accountHash ? cfDeliveryUrl(accountHash, result.id, 'public') : row.url;
    const thumbUrl = accountHash ? cfDeliveryUrl(accountHash, result.id, 'thumbnail') : publicUrl;
    await env.DB.prepare(
      `UPDATE images SET cloudflare_image_id = ?, url = ?, thumbnail_url = ?, updated_at = unixepoch() WHERE id = ?`,
    )
      .bind(result.id, publicUrl, thumbUrl, row.id)
      .run();
    return { cloudflare_image_id: result.id };
  });

  const results = batchOutcomes.map((o) => ({
    id: o.item.id,
    ok: o.ok,
    cloudflare_image_id: o.ok ? o.result?.cloudflare_image_id : null,
    error: o.ok ? undefined : o.error,
  }));

  return jsonResponse({ ok: true, target, results });
}

/**
 * @param {Request} request
 * @param {URL} url
 * @param {unknown} env
 * @param {unknown} authUser
 * @param {{ workspaceId?: string, tenantId?: string } | null | undefined} identity
 */
export async function handleImagesCapabilities(url, env, authUser, identity) {
  const scope = await resolveScope(
    env,
    authUser,
    identity,
    url.searchParams.get('workspace_id')?.trim(),
  );
  if (scope.error) return jsonResponse({ error: scope.error }, scope.status);

  const { resolveCloudflareOAuthToken } = await import('../../../backend/identity/oauth/user-token.js');
  const { resolveCfImagesUploadContext } = await import('../../core/cf-oauth-images.js');

  const cfTok = await resolveCloudflareOAuthToken(env, scope.userId, { nearExpirySeconds: 300 });
  const cfCtx = await resolveCfImagesUploadContext(env, {
    userId: scope.userId,
    workspaceId: scope.workspaceId,
  }).catch(() => null);
  const drive = await driveAccountSummary(env, scope.userId);

  // Full catalog: Worker bindings + OAuth/S3 account buckets (BYOK customer path).
  // Do not stop at listBoundR2BucketNames — that is bindings-only.
  let r2Buckets = [];
  let r2Bound = [];
  let r2Via = null;
  try {
    r2Bound = listBoundR2BucketNames(env) || [];
  } catch {
    r2Bound = [];
  }
  try {
    const cat = await listR2BucketsForCatalog(env, {
      authUser,
      workspaceId: scope.workspaceId,
    });
    r2Buckets = (cat?.buckets || [])
      .map((b) => (typeof b === 'string' ? b : b?.name || b?.bucket_name || ''))
      .filter(Boolean);
    r2Via = cat?.via || cat?.source || null;
  } catch {
    r2Buckets = [];
  }
  if (!r2Buckets.length && r2Bound.length) r2Buckets = [...r2Bound];

  return jsonResponse({
    ok: true,
    cf_images: !!(cfCtx && cfCtx.ok),
    cf_oauth: !!(cfTok && cfTok.ok),
    cf_oauth_refreshed: !!(cfTok && cfTok.refreshed),
    cf_expires_at: cfTok?.expiresAt ?? null,
    account_hash: cfCtx?.accountHash || env.CLOUDFLARE_IMAGES_ACCOUNT_HASH || null,
    accountHash: cfCtx?.accountHash || env.CLOUDFLARE_IMAGES_ACCOUNT_HASH || null,
    account_id: cfCtx?.accountId || cfTok?.accountId || null,
    source: cfCtx?.source || null,
    r2: r2Buckets.length > 0,
    r2_buckets: r2Buckets,
    r2_bound_buckets: r2Bound,
    r2_catalog_via: r2Via,
    drive: !!drive.connected,
    drive_connected: !!drive.connected,
    drive_account_email: drive.account_email || null,
    drive_expires_at: drive.expires_at ?? null,
    drive_has_refresh: drive.has_refresh ?? null,
    images_transformed: null,
  });
}
