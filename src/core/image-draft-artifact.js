/**
 * Bridge image_generation_drafts → agentsam_artifacts so gens appear under
 * /dashboard/artifacts as drafts until the user saves (or TTL expires).
 *
 * Bytes stay in inneranimalmedia drafts/images/… — no duplicate ARTIFACTS put.
 */

import { pragmaTableInfo } from '../../backend/services/retention.js';
import { resolveWorkerR2BucketName } from './r2-storage-scope.js';

/**
 * Stable artifact id for a generation (igen_abc → art_img_abc).
 * @param {string} generationId
 */
export function imageDraftArtifactId(generationId) {
  const gid = String(generationId || '').trim();
  if (!gid) return null;
  const bare = gid.startsWith('igen_') ? gid.slice(5) : gid;
  const safe = bare.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  return safe ? `art_img_${safe}` : null;
}

/**
 * @param {string|null|undefined} prompt
 * @param {string|null|undefined} purpose
 */
function draftArtifactName(prompt, purpose) {
  const p = String(prompt || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  if (p) return p;
  const purposeLabel = String(purpose || '').trim().slice(0, 64);
  return purposeLabel ? `Image · ${purposeLabel}` : 'Generated image';
}

/**
 * Register (or refresh) a draft image as an agentsam_artifacts row.
 * Best-effort — never throws to the image gen path.
 *
 * @param {unknown} env
 * @param {{
 *   userId: string,
 *   workspaceId?: string|null,
 *   tenantId?: string|null,
 *   generationId: string,
 *   previewUrl: string,
 *   r2Key: string,
 *   r2Bucket?: string|null,
 *   prompt?: string|null,
 *   purpose?: string|null,
 *   provider?: string|null,
 *   model?: string|null,
 *   fileSizeBytes?: number|null,
 *   expiresAt?: number|null,
 *   sessionId?: string|null,
 *   width?: number|null,
 *   height?: number|null,
 * }} p
 */
export async function registerImageDraftArtifact(env, p) {
  if (!env?.DB) return null;
  const userId = String(p.userId || '').trim();
  const generationId = String(p.generationId || '').trim();
  const previewUrl = String(p.previewUrl || '').trim();
  const r2Key = String(p.r2Key || '').trim();
  if (!userId || !generationId || !previewUrl || !r2Key) return null;

  const artifactId = imageDraftArtifactId(generationId);
  if (!artifactId) return null;

  let workspaceId = p.workspaceId != null ? String(p.workspaceId).trim() : '';
  let tenantId = p.tenantId != null ? String(p.tenantId).trim() : '';
  if (!workspaceId || !tenantId) {
    try {
      const u = await env.DB.prepare(
        `SELECT tenant_id, default_workspace_id FROM auth_users WHERE id = ? LIMIT 1`,
      )
        .bind(userId)
        .first();
      if (!workspaceId && u?.default_workspace_id) {
        workspaceId = String(u.default_workspace_id).trim();
      }
      if (!tenantId && u?.tenant_id) tenantId = String(u.tenant_id).trim();
    } catch (_) {
      /* optional */
    }
  }
  if (!workspaceId || !tenantId) {
    console.warn('[image-draft-artifact] skip_register_missing_scope', {
      generation_id: generationId,
      has_ws: !!workspaceId,
      has_tenant: !!tenantId,
    });
    return null;
  }

  const cols = await pragmaTableInfo(env.DB, 'agentsam_artifacts');
  if (!cols.size) return null;

  const now = Math.floor(Date.now() / 1000);
  const name = draftArtifactName(p.prompt, p.purpose);
  const metadata = {
    generation_id: generationId,
    kind: 'image_draft',
    provider: p.provider || null,
    model: p.model || null,
    purpose: p.purpose || null,
    width: p.width ?? null,
    height: p.height ?? null,
  };

  const row = {
    id: artifactId,
    user_id: userId,
    tenant_id: tenantId,
    workspace_id: workspaceId,
    name: name.slice(0, 500),
    description: p.prompt != null ? String(p.prompt).slice(0, 2000) : null,
    artifact_type: 'image',
    artifact_status: 'draft',
    r2_key: r2Key,
    public_url: previewUrl,
    source: 'image_generation',
    file_size_bytes:
      p.fileSizeBytes != null && Number.isFinite(Number(p.fileSizeBytes))
        ? Math.max(0, Math.floor(Number(p.fileSizeBytes)))
        : null,
    is_public: 0,
  };
  if (cols.has('r2_bucket')) {
    const bucket =
      String(p.r2Bucket || '').trim() || resolveWorkerR2BucketName(env, 'ASSETS');
    if (!bucket) {
      console.warn('[image-draft-artifact] skip_register_missing_r2_bucket', {
        generation_id: generationId,
      });
      return null;
    }
    row.r2_bucket = bucket.slice(0, 120);
  }
  if (cols.has('scope')) row.scope = 'user';
  if (cols.has('visibility')) row.visibility = 'private';
  if (cols.has('preview_url')) row.preview_url = previewUrl;
  if (cols.has('thumbnail_url')) row.thumbnail_url = previewUrl;
  if (cols.has('expires_at') && p.expiresAt != null) {
    row.expires_at = Number(p.expiresAt) || null;
  }
  if (cols.has('source_session_id') && p.sessionId) {
    row.source_session_id = String(p.sessionId).slice(0, 200);
  }
  if (cols.has('source_tool_key')) row.source_tool_key = 'imgx_generate_image';
  if (cols.has('source_model_key') && p.model) {
    row.source_model_key = String(p.model).slice(0, 128);
  }
  if (cols.has('tags')) {
    row.tags = JSON.stringify(['image_gen', 'draft']);
  }
  if (cols.has('metadata_json')) {
    row.metadata_json = JSON.stringify(metadata);
  }
  if (cols.has('created_at')) row.created_at = now;
  if (cols.has('updated_at')) row.updated_at = now;

  const names = [];
  const ph = [];
  const binds = [];
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined || v === null) continue;
    if (!cols.has(k.toLowerCase())) continue;
    names.push(k);
    ph.push('?');
    binds.push(v);
  }
  if (!names.length) return null;

  const updateParts = [];
  const updateBinds = [];
  for (const col of [
    'name',
    'description',
    'artifact_status',
    'r2_key',
    'r2_bucket',
    'public_url',
    'preview_url',
    'thumbnail_url',
    'file_size_bytes',
    'expires_at',
    'source_session_id',
    'source_model_key',
    'tags',
    'metadata_json',
    'updated_at',
  ]) {
    if (!cols.has(col) || row[col] === undefined || row[col] === null) continue;
    updateParts.push(`${col} = excluded.${col}`);
  }
  if (cols.has('updated_at') && !updateParts.some((x) => x.startsWith('updated_at'))) {
    updateParts.push('updated_at = excluded.updated_at');
  }

  try {
    const conflict =
      updateParts.length > 0
        ? `ON CONFLICT(id) DO UPDATE SET ${updateParts.join(', ')}`
        : 'ON CONFLICT(id) DO NOTHING';
    await env.DB.prepare(
      `INSERT INTO agentsam_artifacts (${names.join(', ')}) VALUES (${ph.join(', ')}) ${conflict}`,
    )
      .bind(...binds)
      .run();
    console.log('[image-draft-artifact] registered', {
      artifact_id: artifactId,
      generation_id: generationId,
    });
    return { artifact_id: artifactId, generation_id: generationId };
  } catch (e) {
    console.warn('[image-draft-artifact] register_failed', e?.message ?? e);
    return null;
  }
}

/**
 * After user saves a draft — mark artifact approved and point URLs at committed asset.
 * @param {unknown} env
 * @param {{
 *   userId: string,
 *   generationId: string,
 *   publicUrl: string,
 *   r2Key?: string|null,
 *   name?: string|null,
 * }} p
 */
export async function promoteImageDraftArtifact(env, p) {
  if (!env?.DB) return null;
  const userId = String(p.userId || '').trim();
  const generationId = String(p.generationId || '').trim();
  const publicUrl = String(p.publicUrl || '').trim();
  const artifactId = imageDraftArtifactId(generationId);
  if (!userId || !artifactId || !publicUrl) return null;

  const now = Math.floor(Date.now() / 1000);
  const name = p.name != null ? String(p.name).trim().slice(0, 500) : null;
  const r2Key = p.r2Key != null ? String(p.r2Key).trim() : null;

  try {
    const cols = await pragmaTableInfo(env.DB, 'agentsam_artifacts');
    const sets = [
      `artifact_status = 'approved'`,
      `public_url = ?`,
      `updated_at = ?`,
    ];
    const binds = [publicUrl, now];
    if (cols.has('preview_url')) {
      sets.push('preview_url = ?');
      binds.push(publicUrl);
    }
    if (cols.has('thumbnail_url')) {
      sets.push('thumbnail_url = ?');
      binds.push(publicUrl);
    }
    if (r2Key && cols.has('r2_key')) {
      sets.push('r2_key = ?');
      binds.push(r2Key);
    }
    if (name) {
      sets.push('name = ?');
      binds.push(name);
    }
    if (cols.has('tags')) {
      sets.push(`tags = ?`);
      binds.push(JSON.stringify(['image_gen', 'saved']));
    }
    binds.push(artifactId, userId);
    await env.DB.prepare(
      `UPDATE agentsam_artifacts SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
    )
      .bind(...binds)
      .run();
    return { artifact_id: artifactId };
  } catch (e) {
    console.warn('[image-draft-artifact] promote_failed', e?.message ?? e);
    return null;
  }
}

/**
 * @param {unknown} env
 * @param {{ userId: string, generationId: string }} p
 */
export async function discardImageDraftArtifact(env, p) {
  if (!env?.DB) return null;
  const userId = String(p.userId || '').trim();
  const artifactId = imageDraftArtifactId(p.generationId);
  if (!userId || !artifactId) return null;
  const now = Math.floor(Date.now() / 1000);
  try {
    await env.DB.prepare(
      `UPDATE agentsam_artifacts
       SET artifact_status = 'discarded', updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
      .bind(now, artifactId, userId)
      .run();
    return { artifact_id: artifactId };
  } catch (e) {
    console.warn('[image-draft-artifact] discard_failed', e?.message ?? e);
    return null;
  }
}

/**
 * Map active image drafts into artifact-shaped rows for list merge (orphans / pre-bridge).
 * @param {Record<string, unknown>} draft
 */
export function mapImageDraftToArtifactRow(draft) {
  const generationId = draft.id != null ? String(draft.id) : '';
  const artifactId = imageDraftArtifactId(generationId) || `art_img_${generationId}`;
  const previewUrl = draft.preview_url != null ? String(draft.preview_url) : '';
  const name = draftArtifactName(draft.prompt, draft.purpose);
  const created = draft.created_at != null ? Number(draft.created_at) : null;
  const updated = draft.updated_at != null ? Number(draft.updated_at) : created;
  return {
    id: artifactId,
    user_id: draft.user_id,
    tenant_id: draft.tenant_id,
    workspace_id: draft.workspace_id,
    workspace_slug: null,
    project_key: null,
    name,
    description: draft.prompt != null ? String(draft.prompt).slice(0, 2000) : null,
    artifact_type: 'image',
    artifact_status: 'draft',
    validation_status: null,
    visibility: 'private',
    r2_key: draft.r2_key,
    public_url: previewUrl,
    preview_r2_key: null,
    preview_url: previewUrl,
    thumbnail_r2_key: null,
    thumbnail_url: previewUrl,
    source: 'image_generation',
    source_skill_id: null,
    source_run_id: null,
    source_session_id: null,
    source_message_id: null,
    source_workflow_id: null,
    source_tool_key: 'imgx_generate_image',
    source_model_key: draft.model != null ? String(draft.model) : null,
    tags: ['image_gen', 'draft'],
    metadata_json: {
      generation_id: generationId,
      kind: 'image_draft',
      orphan_list_merge: true,
    },
    file_size_bytes: null,
    is_public: 0,
    created_at: created,
    updated_at: updated,
  };
}
