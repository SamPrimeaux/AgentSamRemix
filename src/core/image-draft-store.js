/**
 * Image generation drafts — AI creates drafts. Users create canon.
 *
 * Draft objects live under drafts/images/{user_id}/{generation_id}.webp (TTL in D1).
 * Commit copies to permanent upload prefix + images row (+ optional cms_assets).
 */

import { getR2Binding } from '../api/r2-api.js';
import { resolvePrimaryUploadPrefix } from './media-r2-access.js';
import { putR2ImageWithCustomMetadata } from './r2-image-metadata.js';

const BUCKET = 'inneranimalmedia';
const CMS_ASSETS = 'cms_assets';
export const IMAGE_DRAFT_TTL_SEC = Number(process.env.IMAGE_DRAFT_TTL_SEC || 72 * 3600);

/** @param {string} userId @param {string} generationId @param {string} ext */
export function draftImageR2Key(userId, generationId, ext = 'webp') {
  const uid = String(userId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  const gid = String(generationId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
  const e = String(ext || 'webp').replace(/^\./, '').slice(0, 8);
  return `drafts/images/${uid}/${gid}.${e}`;
}

/** @param {string} origin @param {string} key */
export function assetUrlFromR2Key(origin, key) {
  const k = String(key || '').trim().replace(/^\/+/, '');
  if (!k) return '';
  const base = String(origin || 'https://inneranimalmedia.com').replace(/\/$/, '');
  return `${base}/assets/${k}`;
}

/**
 * @param {string} contentType
 */
function extFromContentType(contentType) {
  const ct = String(contentType || 'image/png').toLowerCase();
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif')) return 'gif';
  return 'png';
}

/**
 * @param {unknown} env
 * @param {Uint8Array | ArrayBuffer} bytes
 * @param {string} contentType
 */
export async function maybeConvertDraftToWebp(bytes, contentType) {
  const ct = String(contentType || 'image/png').toLowerCase();
  if (ct.includes('webp')) {
    return { bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), contentType: 'image/webp' };
  }
  // Store as-is for v1 — webp conversion would need sharp/wasm; png is fine for drafts.
  return { bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), contentType: ct || 'image/png' };
}

/**
 * @param {unknown} env
 * @param {{
 *   userId: string;
 *   workspaceId?: string | null;
 *   tenantId?: string | null;
 *   generationId?: string;
 *   bytes: Uint8Array | ArrayBuffer;
 *   contentType: string;
 *   purpose?: string | null;
 *   prompt?: string | null;
 *   provider?: string | null;
 *   model?: string | null;
 *   width?: number | null;
 *   height?: number | null;
 *   origin?: string;
 *   contentTier?: string | null;
 *   costUsd?: number | null;
 *   routingArmId?: string | null;
 *   sessionId?: string | null;
 *   conversationId?: string | null;
 * }} p
 */
export async function persistImageDraft(env, p) {
  if (!env?.DB) throw new Error('Database not configured');
  const binding = getR2Binding(env, BUCKET);
  if (!binding?.put) throw new Error('R2 bucket inneranimalmedia not configured');

  const userId = String(p.userId || '').trim();
  if (!userId) throw new Error('user_id required');

  const generationId =
    String(p.generationId || '').trim() ||
    `igen_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

  const packed = await maybeConvertDraftToWebp(p.bytes, p.contentType);
  const ext = extFromContentType(packed.contentType);
  const r2Key = draftImageR2Key(userId, generationId, ext);
  const buf = packed.bytes instanceof Uint8Array ? packed.bytes : new Uint8Array(packed.bytes);

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + IMAGE_DRAFT_TTL_SEC;
  const origin = String(p.origin || env.IAM_ORIGIN || 'https://inneranimalmedia.com').replace(/\/$/, '');
  const previewUrl = assetUrlFromR2Key(origin, r2Key);
  const contentTier =
    p.contentTier != null && String(p.contentTier).trim()
      ? String(p.contentTier).trim().slice(0, 64)
      : null;
  const costUsd = Number(p.costUsd);
  const costBind = Number.isFinite(costUsd) && costUsd >= 0 ? costUsd : null;
  const routingArmId =
    p.routingArmId != null && String(p.routingArmId).trim()
      ? String(p.routingArmId).trim().slice(0, 120)
      : null;

  await binding.put(r2Key, buf, {
    httpMetadata: { contentType: packed.contentType },
    customMetadata: {
      iam_draft: '1',
      iam_user_id: userId,
      expires_at: String(expiresAt),
    },
  });

  await env.DB.prepare(
    `INSERT INTO image_generation_drafts (
       id, user_id, workspace_id, tenant_id, status, r2_key, r2_bucket, preview_url,
       purpose, prompt, provider, model, width, height, expires_at, created_at, updated_at,
       content_tier, cost_usd, routing_arm_id
     ) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = 'draft',
       r2_key = excluded.r2_key,
       preview_url = excluded.preview_url,
       purpose = excluded.purpose,
       prompt = excluded.prompt,
       provider = excluded.provider,
       model = excluded.model,
       width = excluded.width,
       height = excluded.height,
       expires_at = excluded.expires_at,
       updated_at = excluded.updated_at,
       content_tier = COALESCE(excluded.content_tier, image_generation_drafts.content_tier),
       cost_usd = COALESCE(excluded.cost_usd, image_generation_drafts.cost_usd),
       routing_arm_id = COALESCE(excluded.routing_arm_id, image_generation_drafts.routing_arm_id)`,
  )
    .bind(
      generationId,
      userId,
      p.workspaceId != null ? String(p.workspaceId).trim() || null : null,
      p.tenantId != null ? String(p.tenantId).trim() || null : null,
      r2Key,
      BUCKET,
      previewUrl,
      p.purpose != null ? String(p.purpose).slice(0, 64) : null,
      p.prompt != null ? String(p.prompt).slice(0, 2000) : null,
      p.provider != null ? String(p.provider).slice(0, 64) : null,
      p.model != null ? String(p.model).slice(0, 128) : null,
      p.width != null ? Number(p.width) || null : null,
      p.height != null ? Number(p.height) || null : null,
      expiresAt,
      now,
      now,
      contentTier,
      costBind,
      routingArmId,
    )
    .run();

  // Generated images remain ephemeral drafts until the user explicitly saves them.
  // Do not auto-register drafts as durable Artifacts; Images owns this lifecycle.
  const artifactId = null;

  return {
    id: generationId,
    generation_id: generationId,
    status: 'draft',
    preview_url: previewUrl,
    image_url: previewUrl,
    r2_key: r2Key,
    r2_bucket: BUCKET,
    artifact_id: artifactId,
    expires_at: new Date(expiresAt * 1000).toISOString(),
    expires_at_unix: expiresAt,
    content_tier: contentTier,
    cost_usd: costBind,
    routing_arm_id: routingArmId,
  };
}

/**
 * @param {unknown} env
 * @param {string} generationId
 * @param {string} userId
 */
export async function getImageDraftForUser(env, generationId, userId) {
  if (!env?.DB) return null;
  const id = String(generationId || '').trim();
  const uid = String(userId || '').trim();
  if (!id || !uid) return null;
  const row = await env.DB.prepare(
    `SELECT * FROM image_generation_drafts WHERE id = ? AND user_id = ? LIMIT 1`,
  )
    .bind(id, uid)
    .first();
  if (!row) return null;
  const now = Math.floor(Date.now() / 1000);
  if (String(row.status) === 'draft' && Number(row.expires_at) < now) {
    return { ...row, status: 'expired', expired: true };
  }
  return row;
}

const DRAFT_ASSET_URL_RE =
  /https?:\/\/[^\s"'<>]+\/assets\/drafts\/images\/([^/\s"'<>]+)\/(igen_[a-zA-Z0-9]+)(?:\.(jpg|jpeg|png|webp))?/i;

/**
 * Load draft image bytes from R2 (never via public HTTP — Worker→origin fetches can 522).
 * @param {unknown} env
 * @param {{ generationId?: string|null, userId?: string|null, previewUrl?: string|null }} opts
 * @returns {Promise<{ bytes: Uint8Array, contentType: string, generationId: string|null, r2Key: string|null }|null>}
 */
export async function loadDraftImageBytesFromR2(env, opts = {}) {
  if (!env?.DB) return null;
  let generationId = opts.generationId != null ? String(opts.generationId).trim() : '';
  const userId = opts.userId != null ? String(opts.userId).trim() : '';
  const previewUrl = opts.previewUrl != null ? String(opts.previewUrl).trim() : '';

  if (!generationId && previewUrl) {
    const m = previewUrl.match(DRAFT_ASSET_URL_RE);
    if (m) generationId = m[2];
  }
  if (!generationId) return null;

  let row = null;
  try {
    if (userId) {
      row = await getImageDraftForUser(env, generationId, userId);
    } else {
      row = await env.DB.prepare(
        `SELECT * FROM image_generation_drafts WHERE id = ? LIMIT 1`,
      )
        .bind(generationId)
        .first();
    }
  } catch (e) {
    console.warn('[image-draft] r2_lookup_failed', e?.message ?? e);
    return null;
  }
  if (!row || row.expired) return null;
  const r2Key = row.r2_key != null ? String(row.r2_key).trim() : '';
  if (!r2Key) return null;

  try {
    const binding = getR2Binding(env, String(row.r2_bucket || BUCKET).trim() || BUCKET);
    if (!binding?.get) return null;
    const obj = await binding.get(r2Key);
    if (!obj) {
      console.warn('[image-draft] r2_object_missing', { generationId, r2Key });
      return null;
    }
    const ab = await obj.arrayBuffer();
    const ct =
      (obj.httpMetadata?.contentType || 'image/jpeg').split(';')[0].trim() || 'image/jpeg';
    return {
      bytes: new Uint8Array(ab),
      contentType: ct,
      generationId,
      r2Key,
    };
  } catch (e) {
    console.warn('[image-draft] r2_get_failed', e?.message ?? e);
    return null;
  }
}

/**
 * Resolve the most recent draft image URL for a same-thread revision.
 * Prefer conversation assistant messages; fall back to latest user draft (2h).
 * @param {unknown} env
 * @param {{
 *   userId: string,
 *   conversationId?: string|null,
 * }} opts
 * @returns {Promise<{ previewUrl: string, generationId: string|null }|null>}
 */
export async function resolvePriorDraftPreviewUrl(env, opts) {
  const userId = String(opts.userId || '').trim();
  if (!userId || !env?.DB) return null;
  const conversationId =
    opts.conversationId != null ? String(opts.conversationId).trim() : '';

  if (conversationId) {
    try {
      const { getChatMessages } = await import('../../backend/agentsam/sessions/chat-do-client.js');
      const messages = await getChatMessages(env, conversationId);
      const list = Array.isArray(messages) ? messages : [];
      for (let i = list.length - 1; i >= 0; i--) {
        const msg = list[i];
        if (!msg || String(msg.role || '') !== 'assistant') continue;
        const content =
          typeof msg.content === 'string'
            ? msg.content
            : msg.content != null
              ? JSON.stringify(msg.content)
              : '';
        const match = content.match(DRAFT_ASSET_URL_RE);
        if (!match) continue;
        const generationId = match[2];
        const draft = await getImageDraftForUser(env, generationId, userId);
        if (draft?.expired) continue;
        const previewUrl =
          (draft?.preview_url != null && String(draft.preview_url).trim()) ||
          String(match[0]).trim();
        if (previewUrl) {
          return { previewUrl, generationId };
        }
      }
    } catch (e) {
      console.warn('[image-draft] prior_from_chat_failed', e?.message ?? e);
    }
  }

  try {
    const row = await env.DB.prepare(
      `SELECT id, preview_url FROM image_generation_drafts
       WHERE user_id = ?
         AND status = 'draft'
         AND expires_at > unixepoch()
         AND created_at >= unixepoch() - 7200
         AND preview_url IS NOT NULL
         AND TRIM(preview_url) != ''
       ORDER BY created_at DESC
       LIMIT 1`,
    )
      .bind(userId)
      .first();
    if (row?.preview_url) {
      return {
        previewUrl: String(row.preview_url).trim(),
        generationId: row.id != null ? String(row.id) : null,
      };
    }
  } catch (e) {
    console.warn('[image-draft] prior_from_d1_failed', e?.message ?? e);
  }
  return null;
}

/**
 * @param {unknown} env
 * @param {string} generationId
 * @param {string} userId
 */
export async function discardImageDraft(env, generationId, userId) {
  const row = await getImageDraftForUser(env, generationId, userId);
  if (!row) throw new Error('draft_not_found');
  if (String(row.status) === 'committed') throw new Error('draft_already_committed');

  const binding = getR2Binding(env, BUCKET);
  if (binding?.delete && row.r2_key) {
    await binding.delete(String(row.r2_key)).catch(() => null);
  }

  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `UPDATE image_generation_drafts SET status = 'discarded', updated_at = ? WHERE id = ? AND user_id = ?`,
  )
    .bind(now, String(generationId), String(userId))
    .run();

  try {
    const { discardImageDraftArtifact } = await import('./image-draft-artifact.js');
    await discardImageDraftArtifact(env, { userId: String(userId), generationId: String(generationId) });
  } catch (e) {
    console.warn('[image-draft] artifact_discard_failed', e?.message ?? e);
  }

  return { ok: true, generation_id: generationId, status: 'discarded' };
}


/**
 * Promote a draft into the library (canon). AI creates drafts; users save.
 * @param {unknown} env
 * @param {{
 *   authUser: { id: string; tenant_id?: string | null };
 *   workspaceId?: string | null;
 *   tenantId?: string | null;
 *   origin?: string;
 * }} ctx
 * @param {{
 *   generation_id: string;
 *   label?: string;
 *   category?: string;
 *   tags?: string[] | string;
 *   project_id?: string | null;
 *   register_cms_asset?: boolean;
 * }} body
 */
export async function saveImageDraft(env, ctx, body) {
  if (!env?.DB) throw new Error('Database not configured');
  const userId = String(ctx.authUser?.id || '').trim();
  if (!userId) throw new Error('Unauthorized');

  const generationId = String(body.generation_id || '').trim();
  if (!generationId) throw new Error('generation_id required');

  const row = await getImageDraftForUser(env, generationId, userId);
  if (!row) throw new Error('draft_not_found');
  if (row.expired) throw new Error('draft_expired');
  if (String(row.status) === 'committed') {
    const w = row.width != null ? Number(row.width) : null;
    const h = row.height != null ? Number(row.height) : null;
    return {
      ok: true,
      status: 'saved',
      generation_id: generationId,
      asset_id: row.committed_asset_id || row.committed_image_id,
      image_id: row.committed_image_id,
      url: assetUrlFromR2Key(ctx.origin, row.committed_r2_key),
      r2_key: row.committed_r2_key,
      already_saved: true,
      width: w,
      height: h,
      size_label: w && h ? `${w}×${h}` : null,
    };
  }
  if (String(row.status) !== 'draft') throw new Error('draft_not_savable');

  const binding = getR2Binding(env, BUCKET);
  if (!binding?.get || !binding?.put) throw new Error('R2 not configured');

  const draftKey = String(row.r2_key || '').trim();
  const obj = await binding.get(draftKey);
  if (!obj) throw new Error('draft_file_missing');

  const workspaceId =
    ctx.workspaceId != null && String(ctx.workspaceId).trim()
      ? String(ctx.workspaceId).trim()
      : row.workspace_id != null
        ? String(row.workspace_id).trim()
        : '';
  const tenantId =
    ctx.tenantId != null && String(ctx.tenantId).trim()
      ? String(ctx.tenantId).trim()
      : row.tenant_id != null
        ? String(row.tenant_id).trim()
        : String(ctx.authUser?.tenant_id || '').trim() || 'system';

  const uploadPack = await resolvePrimaryUploadPrefix(env, ctx.authUser, workspaceId || null);
  if (uploadPack.error) throw new Error(uploadPack.error);

  const label = String(body.label || row.prompt || 'Generated image').trim().slice(0, 120);
  const category = String(body.category || 'image_gen').trim().slice(0, 64).toLowerCase();
  const tagList = normalizeSaveTags(body.tags, category);
  const width = row.width != null ? Number(row.width) || null : null;
  const height = row.height != null ? Number(row.height) || null : null;
  const sizeLabel = width && height ? `${width}×${height}` : null;

  let projectId = body.project_id != null ? String(body.project_id).trim() || null : null;
  let projectSlug = '';
  if (projectId) {
    const resolved = await resolveProjectForImage(env, projectId, workspaceId);
    if (!resolved) throw new Error('project_not_found');
    projectId = resolved.id;
    projectSlug = resolved.slug || '';
  }

  const contentType = obj.httpMetadata?.contentType || 'image/png';
  const ext = extFromContentType(contentType);
  const committedKey = `${uploadPack.prefix}saved-${generationId.replace(/[^a-z0-9]/gi, '').slice(0, 20)}.${ext}`;
  const buf = await obj.arrayBuffer();
  const sizeBytes = buf.byteLength;

  await putR2ImageWithCustomMetadata(binding, committedKey, buf, {
    contentType,
    tags: tagList,
    meta: {
      label,
      category,
      project_slug: projectSlug,
      notes: '',
      tenant_slug: '',
      is_live: false,
      preferred_bg: '',
      width,
      height,
      size_bytes: sizeBytes,
      size_label: sizeLabel,
    },
    scope: { userId, workspaceId: workspaceId || '', tenantId },
    alt_text: label,
    description: row.prompt ? String(row.prompt).slice(0, 160) : null,
    extra: { iam_generation_id: generationId },
  });
  await binding.delete(draftKey).catch(() => null);

  const origin = String(ctx.origin || env.IAM_ORIGIN || 'https://inneranimalmedia.com').replace(/\/$/, '');
  const publicUrl = assetUrlFromR2Key(origin, committedKey);
  const imageId = `img_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const now = Math.floor(Date.now() / 1000);

  const metadata = {
    generation_id: generationId,
    purpose: row.purpose,
    provider: row.provider,
    model: row.model,
    content_tier: row.content_tier ?? null,
    cost_usd: row.cost_usd ?? null,
    saved_from: 'draft',
    label,
    category,
    project_slug: projectSlug,
    width,
    height,
    size_bytes: sizeBytes,
    size_label: sizeLabel,
  };

  await env.DB.prepare(
    `INSERT INTO images (
       id, tenant_id, project_id, user_id, filename, original_filename,
       mime_type, size, width, height, r2_key, cloudflare_image_id,
       url, thumbnail_url, alt_text, description, tags, metadata, status,
       created_at, updated_at, workspace_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
  )
    .bind(
      imageId,
      tenantId,
      projectId,
      userId,
      `${generationId}.${ext}`,
      label,
      contentType,
      sizeBytes,
      width,
      height,
      committedKey,
      null,
      publicUrl,
      publicUrl,
      label,
      sizeLabel ? `${label} (${sizeLabel})` : null,
      JSON.stringify(tagList),
      JSON.stringify(metadata),
      now,
      now,
      workspaceId || null,
    )
    .run();

  let cmsAssetId = null;
  const registerCms =
    body.register_cms_asset !== false &&
    body.register_cms_asset !== 0 &&
    String(body.register_cms_asset || '').toLowerCase() !== 'false';

  if (registerCms && tenantId) {
    cmsAssetId = `img_asset_${generationId.replace(/[^a-z0-9]/gi, '').slice(0, 16)}`;
    await env.DB.prepare(
      `INSERT INTO ${CMS_ASSETS} (
         id, tenant_id, filename, original_filename, path, size, mime_type, category,
         tags, r2_key, public_url, metadata, created_by, is_live, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         public_url = excluded.public_url,
         r2_key = excluded.r2_key,
         metadata = excluded.metadata,
         updated_at = datetime('now')`,
    )
      .bind(
        cmsAssetId,
        tenantId,
        label,
        label,
        publicUrl.startsWith('/assets/') ? publicUrl : committedKey,
        sizeBytes,
        contentType,
        category,
        JSON.stringify(['image_gen', ...tagList]),
        committedKey,
        publicUrl,
        JSON.stringify({
          label,
          generation_id: generationId,
          image_id: imageId,
          purpose: row.purpose,
          width,
          height,
          size_bytes: sizeBytes,
          size_label: sizeLabel,
          project_id: projectId,
        }),
        userId,
      )
      .run();
  }

  await env.DB.prepare(
    `UPDATE image_generation_drafts SET
       status = 'committed',
       committed_image_id = ?,
       committed_r2_key = ?,
       committed_asset_id = ?,
       preview_url = ?,
       updated_at = ?
     WHERE id = ? AND user_id = ?`,
  )
    .bind(imageId, committedKey, cmsAssetId, publicUrl, now, generationId, userId)
    .run();

  try {
    const { promoteImageDraftArtifact } = await import('./image-draft-artifact.js');
    await promoteImageDraftArtifact(env, {
      userId,
      generationId,
      publicUrl,
      r2Key: committedKey,
      name: label,
    });
  } catch (e) {
    console.warn('[image-draft] artifact_promote_failed', e?.message ?? e);
  }

  return {
    ok: true,
    status: 'saved',
    generation_id: generationId,
    asset_id: cmsAssetId || imageId,
    image_id: imageId,
    url: publicUrl,
    public_url: publicUrl,
    r2_key: committedKey,
    project_id: projectId,
    category,
    tags: tagList,
    width,
    height,
    size_bytes: sizeBytes,
    size_label: sizeLabel,
  };
}

/** Suggested library categories for generated images. */
export const IMAGE_SAVE_CATEGORY_PRESETS = Object.freeze([
  'logo',
  'website',
  'mockup',
  'hero',
  'social',
  'backdrop',
  'image_gen',
]);

/**
 * @param {unknown} tags
 * @param {string} category
 * @returns {string[]}
 */
function normalizeSaveTags(tags, category) {
  const out = new Set();
  const cat = String(category || '').trim().toLowerCase();
  if (cat) out.add(cat);
  out.add('image_gen');
  if (Array.isArray(tags)) {
    for (const t of tags) {
      const s = String(t || '').trim().toLowerCase().slice(0, 48);
      if (s) out.add(s);
    }
  } else if (typeof tags === 'string' && tags.trim()) {
    for (const part of tags.split(/[,|]/)) {
      const s = part.trim().toLowerCase().slice(0, 48);
      if (s) out.add(s);
    }
  }
  return [...out].slice(0, 24);
}

/**
 * @param {unknown} env
 * @param {string} projectId
 * @param {string} workspaceId
 * @returns {Promise<{ id: string, slug: string } | null>}
 */
export async function resolveProjectForImage(env, projectId, workspaceId) {
  if (!env?.DB || !projectId) return null;
  const pid = String(projectId).trim();
  const ws = String(workspaceId || '').trim();
  const row = await env.DB.prepare(
    ws
      ? `SELECT id, name FROM projects WHERE id = ? AND workspace_id = ? LIMIT 1`
      : `SELECT id, name FROM projects WHERE id = ? LIMIT 1`,
  )
    .bind(...(ws ? [pid, ws] : [pid]))
    .first()
    .catch(() => null);
  if (!row?.id) return null;

  let slug = '';
  const wp = await env.DB.prepare(
    `SELECT slug FROM workspace_projects
     WHERE json_extract(metadata_json, '$.projects_table_id') = ?
     LIMIT 1`,
  )
    .bind(String(row.id))
    .first()
    .catch(() => null);
  if (wp?.slug) slug = String(wp.slug);
  else if (row.name) {
    slug = String(row.name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64);
  }
  return { id: String(row.id), slug };
}

/**
 * Attach or detach a library image to a project.
 * @param {unknown} env
 * @param {{ imageId: string, userId: string, workspaceId: string, projectId: string | null }} p
 */
export async function setImageProject(env, p) {
  if (!env?.DB) throw new Error('Database not configured');
  const imageId = String(p.imageId || '').trim();
  const userId = String(p.userId || '').trim();
  const workspaceId = String(p.workspaceId || '').trim();
  if (!imageId || !userId || !workspaceId) throw new Error('image_id and workspace required');

  const row = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, metadata FROM images WHERE id = ? LIMIT 1`,
  )
    .bind(imageId)
    .first();
  if (!row?.id) throw new Error('image_not_found');
  if (String(row.user_id) !== userId || String(row.workspace_id) !== workspaceId) {
    throw new Error('forbidden');
  }

  let projectId = p.projectId != null ? String(p.projectId).trim() || null : null;
  let projectSlug = '';
  if (projectId) {
    const resolved = await resolveProjectForImage(env, projectId, workspaceId);
    if (!resolved) throw new Error('project_not_found');
    projectId = resolved.id;
    projectSlug = resolved.slug || '';
  }

  let meta = {};
  try {
    meta = row.metadata ? JSON.parse(String(row.metadata)) : {};
  } catch {
    meta = {};
  }
  meta.project_slug = projectSlug;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `UPDATE images SET project_id = ?, metadata = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
  )
    .bind(projectId, JSON.stringify(meta), now, imageId, userId)
    .run();

  return { ok: true, image_id: imageId, project_id: projectId, project_slug: projectSlug || null };
}

/**
 * Plural generative asks ("three layouts", "a few variations") must land as
 * persisted library assets — not TTL drafts the user never sees after expiry.
 * @param {string|null|undefined} text
 */
export function isPluralImageGenerationAsk(text) {
  const m = String(text || '').trim();
  if (!m) return false;
  if (
    /\b(two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(rough\s+|quick\s+|fast\s+)?(floor[- ]?plans?|layouts?|variations?|options?|concepts?|versions?|images?|sketches?|renders?|mockups?)\b/i.test(
      m,
    )
  ) {
    return true;
  }
  if (
    /\b(a few|several|multiple)\s+(rough\s+|quick\s+|fast\s+)?(floor[- ]?plans?|layouts?|variations?|options?|concepts?|versions?|images?|sketches?|renders?|mockups?)\b/i.test(
      m,
    )
  ) {
    return true;
  }
  if (
    /\b(generate|create|make|draw|render)\b[\s\S]{0,100}\b(two|three|four|five|six|\d+|a few|several|multiple)\b[\s\S]{0,60}\b(layouts?|variations?|options?|concepts?|floor[- ]?plans?|images?|sketches?|renders?|mockups?)\b/i.test(
      m,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * @param {Record<string, unknown> | null | undefined} params
 * @param {{ userMessage?: string|null, message?: string|null }} [ctx]
 */
export function imageGenerationShouldPersist(params, ctx = {}) {
  if (
    params?.persist === true ||
    params?.persist === 1 ||
    String(params?.persist || '').toLowerCase() === 'true'
  ) {
    return true;
  }
  const n = Number(params?.variations ?? params?.count ?? params?.n ?? 0);
  if (Number.isFinite(n) && n >= 2) return true;
  const blob = [
    ctx.userMessage,
    ctx.message,
    params?.prompt,
    params?.description,
  ]
    .filter((x) => x != null && String(x).trim())
    .join('\n');
  return isPluralImageGenerationAsk(blob);
}
