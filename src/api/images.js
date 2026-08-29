/**
 * Unified dashboard images API — D1 registry + Cloudflare Images + Google Drive.
 *
 * P0 data isolation audit 2026-05-23 — unscoped SELECT lines (grep -v WHERE user_id|workspace_id|tenant_id):
 * Full log: artifacts/p0-data-isolation-audit-20260523.txt
 * images list: WHERE user_id = ? AND workspace_id = ? (see listD1Images).
 *
 * GET    /api/images?source=all|r2|cf_images|drive&page=1&per_page=50 (max 100)
 * POST   /api/images/upload  (multipart) — also POST /api/images (multipart or JSON url)
 * POST   /api/images/import/drive  { drive_file_id } — R2 + D1 only (never auto-hosts on CF Images)
 * GET    /api/images/drive/:fileId/preview|thumbnail — OAuth-proxied preview (browse only; no R2)
 * GET    /api/images/capabilities — CF / R2 / Drive connection summary for Storage sidebar
 * DELETE /api/images/:id
 * POST   /api/images/generate  { persist: false default — draft until commit }
 * POST   /api/images/save     { generation_id, category?, tags?, project_id? } — save draft to library
 * POST   /api/images/discard  { generation_id } — delete draft
 * POST   /api/images/rate     { generation_id, rating: 1|-1 } — thumbs → Thompson
 * POST   /api/images/:id/project { project_id | null } — attach/detach project
 * POST   /api/images/edit | /api/images/:id/meta  (legacy compat)
 * GET    /api/images/tags?workspace_id=
 * GET    /api/images/resource-tags/keys — CF Resource Tagging account keys
 * GET    /api/images/resource-tags/values/:key — values for a key (type=image)
 * GET    /api/images/:id/resource-tags — tags on one CF Image id
 * PATCH  /api/images/:id  { tags, resource_tags, label, notes, alt_text, category, project_slug, is_live, preferred_bg }
 *   — CF Images: resource_tags → Cloudflare Resource Tagging (resource_type=image)
 *   — R2 browse (r2obj_*): resource_tags → IAM iam_tags + {key}.iammeta.json (no CF per-object R2 tags)
 *
 * Storage lanes (do not dilute):
 * - `images.r2_key` = R2 object path only (NULL when CF-hosted-only)
 * - `images.cloudflare_image_id` = CF Images UUID only (NULL when R2-only)
 * - Drive browse = no D1 row until Import (Import ≠ Host on CF Images)
 */

import { jsonResponse } from '../core/responses.js';
import { getR2Binding, listR2BucketsForCatalog, listBoundR2BucketNames, listR2ObjectsForCatalog } from './r2-api.js';
import {
  assertDashboardR2BucketAccess,
  applyWorkspaceR2Transport,
} from '../core/r2-storage-scope.js';
import { mergeR2S3EnvFromUserStorage } from '../core/user-storage-r2-credentials.js';
import { r2PutViaBindingOrS3, r2HeadViaBindingOrS3 } from '../core/r2.js';
import { getOAuthToken } from '../../backend/identity/oauth/user-token.js';
import { canAccessMediaObjectKey } from '../core/media-r2-access.js';
import { rateImageGeneration, runImageGenerationForTool } from '../../backend/agentsam/tools/image_generation.js';
import {
  saveImageDraft,
  setImageProject,
  discardImageDraft,
  imageGenerationShouldPersist,
  IMAGE_SAVE_CATEGORY_PRESETS,
} from '../core/image-draft-store.js';
import {
  enrichItemsFromR2CustomMetadata,
  normalizeTags,
  parseIamMetaFromStorage,
  putR2ImageWithCustomMetadata,
  syncR2ObjectCustomMetadata,
} from '../core/r2-image-metadata.js';
import {
  getResourceTags,
  listAccountTagKeys,
  listValuesForKey,
  mergeResourceTag,
  removeResourceTag,
  syncImageResourceTags,
} from '../core/cf-resource-tags.js';
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
} from '../core/cf-images-transform.js';
import {
  BUCKET,
  decodeR2BrowseId,
  encodeR2BrowseId,
  extFromMime,
  mediaIdToKey,
  mimeFromKey,
  safeFilename,
} from './images/ids.js';
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
} from './images/meta.js';
import {
  cfDeliveryUrl,
  mapCfApiImage,
  mapD1RowToItem,
  mapDriveFile,
  mapR2BrowseObject,
  proxyR2Url,
} from './images/map.js';
import { resolveScope } from './images/scope.js';

import { handleDriveMedia } from './images/storage.js';
import { handleDelete, handleDriveImport, handleGetImages, handleUpload } from './images/list-upload.js';
import { getImageRowForPatch, handleCreateVariant, handleListTags, handleVariantsCatalog } from './images/cf.js';
import { handleLegacyD1Meta, handleLegacyMeta, handlePatchImage } from './images/patch.js';
import { handleGetImageDetail, handlePreviewUrl, handleTransformCommit } from './images/detail-transform.js';
import { handleBatchDelete, handleBatchMigrate, handleBatchTags, handleImagesCapabilities } from './images/batch.js';

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

export async function handleImagesApi(request, url, env, authUser, identity) {
  if (!authUser?.id) return jsonResponse({ error: 'Unauthorized' }, 401);

  const path = url.pathname.replace(/\/$/, '') || '/';
  const pathLower = path.toLowerCase();
  const method = request.method.toUpperCase();
  const wsHint = url.searchParams.get('workspace_id')?.trim() || identity?.workspaceId || '';

  if (pathLower === '/api/images/capabilities' && method === 'GET') {
    return handleImagesCapabilities(url, env, authUser, identity);
  }

  if (pathLower === '/api/images/tags' && method === 'GET') {
    return handleListTags(url, env, authUser, identity);
  }

  if (pathLower === '/api/images/variants/catalog' && method === 'GET') {
    return handleVariantsCatalog(env);
  }

  if (pathLower === '/api/images/variants' && method === 'POST') {
    return handleCreateVariant(request, env);
  }

  if (pathLower === '/api/images/resource-tags/keys' && method === 'GET') {
    const listed = await listAccountTagKeys(env);
    if (!listed.ok) return jsonResponse({ ok: false, error: listed.error, keys: [] }, listed.status || 502);
    return jsonResponse({ ok: true, keys: listed.keys });
  }

  const resourceTagValuesMatch = path.match(/^\/api\/images\/resource-tags\/values\/([^/]+)$/i);
  if (resourceTagValuesMatch && method === 'GET') {
    const listed = await listValuesForKey(env, decodeURIComponent(resourceTagValuesMatch[1]));
    if (!listed.ok) {
      return jsonResponse(
        { ok: false, error: listed.error, values: [], key: listed.key || null },
        listed.status || 502,
      );
    }
    return jsonResponse({ ok: true, key: listed.key, values: listed.values });
  }

  if (pathLower === '/api/images/resource-tags/catalog' && method === 'GET') {
    const keysRes = await listAccountTagKeys(env);
    if (!keysRes.ok) {
      return jsonResponse({ ok: false, error: keysRes.error, keys: [], groups: {} }, keysRes.status || 502);
    }
    const groups = {};
    for (const key of keysRes.keys.slice(0, 40)) {
      const vals = await listValuesForKey(env, key);
      groups[key] = vals.ok ? vals.values : [];
    }
    return jsonResponse({ ok: true, keys: keysRes.keys, groups });
  }

  if (pathLower === '/api/images' && method === 'GET') {
    return handleGetImages(request, url, env, authUser, identity);
  }

  if ((pathLower === '/api/images/upload' || pathLower === '/api/images') && method === 'POST') {
    return handleUpload(request, url, env, authUser, identity);
  }

  if (pathLower === '/api/images/import/drive' && method === 'POST') {
    return handleDriveImport(request, url, env, authUser, identity);
  }

  const driveMediaMatch = path.match(/^\/api\/images\/drive\/([^/]+)\/(preview|thumbnail)$/i);
  if (driveMediaMatch && method === 'GET') {
    return handleDriveMedia(env, authUser, driveMediaMatch[1], driveMediaMatch[2].toLowerCase());
  }

  if (pathLower === '/api/images/generate' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const prompt = String(body.prompt || body.description || '').trim();
    if (!prompt) return jsonResponse({ error: 'prompt required' }, 400);
    const persist = imageGenerationShouldPersist(body);
    try {
      const out = await runImageGenerationForTool(env, 'imgx_generate_image', body, {
        authUser,
        workspaceId: wsHint || identity?.workspaceId || null,
        tenantId: identity?.tenantId || null,
        userId: authUser?.id || null,
        origin: url.origin,
      });
      return jsonResponse({
        ok: true,
        generation_id: out.generation_id,
        status: out.status || (persist ? 'saved' : 'draft'),
        preview_url: out.preview_url || out.image_url,
        expires_at: out.expires_at,
        image_url: out.image_url,
        provider: out.provider,
        model: out.model,
        persist,
        source: 'image_gen',
      });
    } catch (e) {
      return jsonResponse({ error: e?.message || 'generate failed' }, 500);
    }
  }

  if (pathLower === '/api/images/save' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const generationId = String(body.generation_id || '').trim();
    if (!generationId) return jsonResponse({ error: 'generation_id required' }, 400);
    try {
      const out = await saveImageDraft(
        env,
        {
          authUser,
          workspaceId: wsHint || identity?.workspaceId || body.workspace_id || null,
          tenantId: identity?.tenantId || null,
          origin: url.origin,
        },
        body,
      );
      return jsonResponse({ ...out, category_presets: IMAGE_SAVE_CATEGORY_PRESETS });
    } catch (e) {
      const msg = e?.message != null ? String(e.message) : 'save failed';
      const status =
        msg === 'draft_not_found' || msg === 'draft_expired'
          ? 404
          : msg === 'project_not_found'
            ? 404
            : 500;
      return jsonResponse({ error: msg }, status);
    }
  }

  if (pathLower === '/api/images/discard' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const generationId = String(body.generation_id || '').trim();
    if (!generationId) return jsonResponse({ error: 'generation_id required' }, 400);
    try {
      const out = await discardImageDraft(env, generationId, authUser.id);
      return jsonResponse(out);
    } catch (e) {
      const msg = e?.message != null ? String(e.message) : 'discard failed';
      return jsonResponse({ error: msg }, msg === 'draft_not_found' ? 404 : 500);
    }
  }

  if (pathLower === '/api/images/rate' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const generationId = String(body.generation_id || '').trim();
    const ratingRaw = Number(body.rating);
    if (!generationId) return jsonResponse({ error: 'generation_id required' }, 400);
    if (ratingRaw !== 1 && ratingRaw !== -1) {
      return jsonResponse({ error: 'rating must be 1 (up) or -1 (down)' }, 400);
    }
    try {
      const out = await rateImageGeneration(env, {
        generationId,
        userId: authUser.id,
        workspaceId: wsHint || identity?.workspaceId || body.workspace_id || null,
        tenantId: identity?.tenantId || authUser?.tenant_id || authUser?.active_tenant_id || null,
        rating: /** @type {1 | -1} */ (ratingRaw),
      });
      return jsonResponse(out);
    } catch (e) {
      const msg = e?.message != null ? String(e.message) : 'rate failed';
      const status =
        msg === 'draft_not_found' ? 404 : msg === 'forbidden' ? 403 : msg.includes('required') ? 400 : 500;
      return jsonResponse({ error: msg }, status);
    }
  }

  if (pathLower === '/api/images/edit' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const prompt = String(body.prompt || '').trim();
    const imageUrl = String(body.image_url || body.image || '').trim();
    if (!prompt) return jsonResponse({ error: 'prompt required' }, 400);
    if (!imageUrl) return jsonResponse({ error: 'image_url required' }, 400);
    try {
      const out = await runImageGenerationForTool(env, 'imgx_edit_image', body, {
        authUser,
        workspaceId: wsHint || identity?.workspaceId || null,
        tenantId: identity?.tenantId || null,
        userId: authUser?.id || null,
        origin: url.origin,
      });
      return jsonResponse({
        ok: true,
        generation_id: out.generation_id,
        status: out.status || 'draft',
        preview_url: out.preview_url || out.image_url,
        expires_at: out.expires_at,
        image_url: out.image_url,
        provider: out.provider,
        model: out.model,
        persist: out.persist ?? false,
        source: 'image_gen',
      });
    } catch (e) {
      return jsonResponse({ error: e?.message || 'edit failed' }, 500);
    }
  }

  const projectMatch = path.match(/^\/api\/images\/([^/]+)\/project$/i);
  if (projectMatch && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const scope = await resolveScope(env, authUser, identity, wsHint || body.workspace_id);
    if (scope.error) return jsonResponse({ error: scope.error }, scope.status);
    try {
      const out = await setImageProject(env, {
        imageId: projectMatch[1],
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        projectId: body.project_id === null || body.project_id === '' ? null : body.project_id,
      });
      return jsonResponse(out);
    } catch (e) {
      const msg = e?.message != null ? String(e.message) : 'project attach failed';
      const status =
        msg === 'image_not_found' || msg === 'project_not_found'
          ? 404
          : msg === 'forbidden'
            ? 403
            : 500;
      return jsonResponse({ error: msg }, status);
    }
  }

  const metaMatch = path.match(/^\/api\/images\/([^/]+)\/meta$/i);
  if (metaMatch && (method === 'POST' || method === 'PATCH')) {
    const imageId = metaMatch[1];
    const payload = await request.json().catch(() => ({}));
    if (mediaIdToKey(imageId)) return handleLegacyMeta(request, env, authUser, imageId);
    if (env?.DB) return handleLegacyD1Meta(env, authUser, identity, request, url, imageId, payload);
    return jsonResponse({ error: 'Not found' }, 404);
  }

  if (pathLower === '/api/images/batch/tags' && method === 'POST') {
    return handleBatchTags(request, url, env, authUser, identity);
  }

  if (pathLower === '/api/images/batch/delete' && method === 'POST') {
    return handleBatchDelete(request, url, env, authUser, identity);
  }

  if (pathLower === '/api/images/batch/migrate' && method === 'POST') {
    return handleBatchMigrate(request, url, env, authUser, identity);
  }

  const transformMatch = path.match(/^\/api\/images\/([^/]+)\/transform$/i);
  if (transformMatch && method === 'POST') {
    return handleTransformCommit(request, url, env, authUser, identity, transformMatch[1]);
  }

  const previewMatch = path.match(/^\/api\/images\/([^/]+)\/preview-url$/i);
  if (previewMatch && method === 'GET') {
    return handlePreviewUrl(url, env, authUser, identity, previewMatch[1]);
  }

  const resourceTagsMatch = path.match(/^\/api\/images\/([^/]+)\/resource-tags$/i);
  if (resourceTagsMatch && method === 'GET') {
    const imageId = resourceTagsMatch[1];
    const scope = await resolveScope(
      env,
      authUser,
      identity,
      url.searchParams.get('workspace_id')?.trim(),
    );
    if (scope.error) return jsonResponse({ error: scope.error }, scope.status);
    const rowOrErr = await getImageRowForPatch(env, imageId, scope, authUser, url.origin);
    if (!rowOrErr) return jsonResponse({ error: 'Not found' }, 404);
    if (rowOrErr.forbidden) return jsonResponse({ error: 'Forbidden' }, 403);
    const cfId = String(rowOrErr.cloudflare_image_id || '').trim();
    if (!cfId) {
      return jsonResponse({
        ok: true,
        tags: {},
        skipped: true,
        error: 'Image is not hosted on Cloudflare Images — Resource Tagging applies to image resources only',
      });
    }
    const tagRes = await getResourceTags(env, cfId);
    return jsonResponse({
      ok: tagRes.ok,
      tags: tagRes.tags || {},
      beta_untagged: !!tagRes.beta_untagged,
      error: tagRes.ok ? undefined : tagRes.error,
      cloudflare_image_id: cfId,
    }, tagRes.ok ? 200 : tagRes.status || 502);
  }

  if (resourceTagsMatch && method === 'PUT') {
    const imageId = resourceTagsMatch[1];
    const body = await request.json().catch(() => ({}));
    return handlePatchImage(request, url, env, authUser, identity, imageId, {
      resource_tags: body.tags || body.resource_tags || {},
    });
  }

  const patchMatch = path.match(/^\/api\/images\/([^/]+)$/i);
  if (patchMatch && method === 'PATCH') {
    return handlePatchImage(request, url, env, authUser, identity, patchMatch[1]);
  }

  const delMatch = path.match(/^\/api\/images\/([^/]+)$/i);
  if (delMatch && method === 'DELETE') {
    return handleDelete(delMatch[1], request, url, env, authUser, identity);
  }

  const detailMatch = path.match(/^\/api\/images\/([^/]+)$/i);
  if (detailMatch && method === 'GET') {
    return handleGetImageDetail(url, env, authUser, identity, detailMatch[1]);
  }

  return jsonResponse({ error: 'Not found' }, 404);
}

/** @deprecated alias */
export const handleImagesWorkspaceApi = handleImagesApi;
