/**
 * Unified image generation — OpenAI, Google Imagen, Workers AI.
 * Used by /api/images/generate|edit and agent chat SSE tool paths.
 *
 * Product rule: AI creates drafts. Users create canon.
 * Default persist: false — drafts in drafts/images/{user_id}/ until POST /api/images/save.
 * Exception: plural in-session asks ("three layouts", variations≥2) force persist:true.
 */

import { generateImageOpenAI, normalizeOpenAiImageQuality } from '../../../src/integrations/openai.js';
import {
  imageGenerationShouldPersist,
  persistImageDraft,
} from '../../../src/core/image-draft-store.js';
import { assertOpenAiImageModelActive } from '../../http/agentsam/routes/image-runtime.js';
import { stripUserTextForIntent } from '../../../src/core/active-file-envelope.js';
import {
  hasImageGenerationIntentSync,
  isExplicitImagePlanningIntent,
  isPrimaryImageGenerationIntentSync,
  resolvePrimaryImageGenerationIntent,
} from '../../../src/core/image-intent-gate.js';
import { applyRewardEvent } from '../../../src/core/reward-events.js';
import { extractWorkersAiImageBytes } from '../../http/agentsam/routes/image-bytes-runtime.js';
import { resolveModelApiKey } from '../../../src/integrations/tokens.js';
import { getR2Binding } from '../../../src/api/r2-api.js';
import { resolvePrimaryUploadPrefix } from '../../../src/core/media-r2-access.js';
import {
  attachImageGenerationUsage,
  resolveGeminiAspectRatio,
  resolveGeminiImageSize,
} from '../../../src/core/image-generation-telemetry.js';
import {
  applyBindingPipeline,
  assertWithinBindingInputLimit,
  TransformValidationError,
} from '../../../src/core/cf-images-transform.js';

const BUCKET = 'inneranimalmedia';
const PROGRESS_INTERVAL_MS = 5000;

export const IMAGE_GEN_TOOL_NAMES = new Set(['imgx_generate_image', 'imgx_edit_image']);

/** Flat cost ref for Thompson blend — not an image "tier" product. */
function imageArmCostReferenceUsd() {
  return 0.015;
}

/** Raster + delivery formats for imgx (default png). `git` typo → gif. */
export const IMAGE_OUTPUT_FORMATS = Object.freeze(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg']);

/**
 * @param {unknown} raw
 * @returns {'png'|'jpg'|'webp'|'gif'|'svg'|null}
 */
export function normalizeImageOutputFormat(raw) {
  let f = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^\./, '')
    .replace(/^image\//, '');
  if (f === 'git') f = 'gif';
  if (f === 'jpeg') return 'jpg';
  if (f === 'jpg' || f === 'png' || f === 'webp' || f === 'gif' || f === 'svg') return f;
  return null;
}

/**
 * Default **png**. Honor explicit tool params; soft-parse "as webp" / "save as jpg" from prompt.
 * @param {Record<string, unknown> | null | undefined} params
 * @param {string} [prompt]
 * @returns {'png'|'jpg'|'webp'|'gif'|'svg'}
 */
export function resolveImageOutputFormat(params, prompt = '') {
  const fromParams = normalizeImageOutputFormat(
    params?.format ?? params?.output_format ?? params?.file_type ?? params?.ext,
  );
  if (fromParams) return fromParams;
  const text = `${String(params?.prompt || '')} ${String(prompt || '')}`;
  const m =
    text.match(
      /\b(?:as|in|to|format|file(?:\s*type)?|save\s+as|export\s+as)\s*[:=]?\s*\.?(png|jpe?g|webp|gif|svg|git)\b/i,
    ) || text.match(/\b(png|jpe?g|webp|gif|svg)\s+(?:format|file|image)\b/i);
  if (m) return normalizeImageOutputFormat(m[1]) || 'png';
  return 'png';
}

/** @param {'png'|'jpg'|'webp'|'gif'|'svg'} ext */
function mimeForImageExt(ext) {
  if (ext === 'jpg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'svg') return 'image/svg+xml';
  return 'image/png';
}

/** @param {string} contentType */
function extFromContentType(contentType) {
  const ct = String(contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (ct === 'image/jpeg') return 'jpg';
  if (ct === 'image/webp') return 'webp';
  if (ct === 'image/gif') return 'gif';
  if (ct === 'image/svg+xml') return 'svg';
  if (ct === 'image/png') return 'png';
  return '';
}

/**
 * Re-encode raster bytes via env.IMAGES (png/jpeg/webp; gif best-effort).
 * @param {any} env
 * @param {Uint8Array} bytes
 * @param {'png'|'jpeg'|'webp'|'gif'} formatKey
 */
async function reencodeRasterViaImages(env, bytes, formatKey) {
  if (!env?.IMAGES) {
    throw new Error(
      'IMAGES binding unavailable — cannot convert image format. Redeploy with images binding or pass a matching source mime.',
    );
  }
  assertWithinBindingInputLimit(bytes.byteLength);
  const source = new Blob([bytes]).stream();

  if (formatKey === 'gif') {
    try {
      const output = await env.IMAGES.input(source).output({ format: 'image/gif' });
      const buf = await output.response().arrayBuffer();
      return { bytes: new Uint8Array(buf), contentType: 'image/gif' };
    } catch (e) {
      const msg = e?.message != null ? String(e.message) : String(e);
      throw new Error(
        `format=gif could not be encoded (${msg.slice(0, 160)}). Use format=png (default), jpg, or webp.`,
      );
    }
  }

  const bindingFormat = formatKey === 'jpeg' ? 'jpeg' : formatKey;
  try {
    const pipelineResult = await applyBindingPipeline(
      env,
      source,
      { format: bindingFormat, quality: bindingFormat === 'png' ? undefined : 92 },
      { defaultFormat: 'png' },
    );
    const buf = await pipelineResult.output.response().arrayBuffer();
    const outFmt = pipelineResult.format === 'jpeg' ? 'jpg' : pipelineResult.format;
    return {
      bytes: new Uint8Array(buf),
      contentType: mimeForImageExt(/** @type {'png'|'jpg'|'webp'} */ (outFmt === 'jpg' ? 'jpg' : outFmt)),
    };
  } catch (e) {
    if (e instanceof TransformValidationError) throw e;
    const msg = e?.message != null ? String(e.message) : String(e);
    throw new Error(`Image format conversion to ${formatKey} failed: ${msg.slice(0, 200)}`);
  }
}

/**
 * SVG delivery for generative rasters: PNG (or given raster) embedded as data-URI SVG.
 * True vector drawing is illustration_create — this satisfies "save as .svg" requests.
 * @param {any} env
 * @param {Uint8Array} bytes
 * @param {string} contentType
 */
async function wrapRasterAsSvg(env, bytes, contentType) {
  let raster = bytes;
  let mime = String(contentType || 'image/png').split(';')[0].trim() || 'image/png';
  if (mime !== 'image/png' && mime !== 'image/jpeg' && mime !== 'image/webp') {
    const png = await reencodeRasterViaImages(env, bytes, 'png');
    raster = png.bytes;
    mime = png.contentType;
  }
  let width = 1024;
  let height = 1024;
  try {
    if (env?.IMAGES?.info) {
      const info = await env.IMAGES.info(new Blob([raster], { type: mime }).stream());
      if (info?.width) width = info.width;
      if (info?.height) height = info.height;
    }
  } catch {
    /* dimensions optional */
  }
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < raster.length; i += chunk) {
    binary += String.fromCharCode(...raster.subarray(i, i + chunk));
  }
  const b64 = btoa(binary);
  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<image width="${width}" height="${height}" href="data:${mime};base64,${b64}"/>` +
    `</svg>`;
  return {
    bytes: new TextEncoder().encode(svg),
    contentType: 'image/svg+xml',
    svg_embedded_raster: true,
  };
}

/**
 * Force delivery format (default png). Gemini often returns JPEG — re-encode unless already matching.
 * @param {any} env
 * @param {Uint8Array} bytes
 * @param {string} contentType
 * @param {'png'|'jpg'|'webp'|'gif'|'svg'} format
 */
export async function ensureGeneratedImageFormat(env, bytes, contentType, format) {
  const target = normalizeImageOutputFormat(format) || 'png';
  const srcExt = extFromContentType(contentType) || 'png';

  if (target === 'svg') {
    return wrapRasterAsSvg(env, bytes, contentType);
  }

  if (srcExt === target) {
    return { bytes, contentType: mimeForImageExt(target) };
  }

  const bindingKey = target === 'jpg' ? 'jpeg' : target;
  return reencodeRasterViaImages(env, bytes, /** @type {'png'|'jpeg'|'webp'|'gif'} */ (bindingKey));
}

/** Model-supplied variation count only (1–4). Prefer explicit `variations`; else `prompts.length`. */
export function normalizeImageVariationCount(params) {
  const explicit = Number(params?.variations ?? params?.count ?? params?.n);
  if (Number.isFinite(explicit) && explicit >= 1) {
    return Math.max(1, Math.min(4, Math.floor(explicit)));
  }
  if (Array.isArray(params?.prompts) && params.prompts.length > 1) {
    return Math.max(1, Math.min(4, params.prompts.length));
  }
  return 1;
}

const VARIATION_ANGLE_HINTS = Object.freeze([
  'front three-quarter exterior elevation',
  'rear elevation',
  'aerial property overview',
  'interior living-space view',
]);

/**
 * Force one dedicated frame per call — providers otherwise return A/B/C collages.
 * @param {string} basePrompt
 * @param {number} index zero-based
 * @param {number} total
 */
export function buildImageVariationPrompt(basePrompt, index, total) {
  const base = String(basePrompt || '').trim();
  const angle = VARIATION_ANGLE_HINTS[index % VARIATION_ANGLE_HINTS.length];
  const n = index + 1;
  return (
    `${base}\n\n` +
    `Variation ${n} of ${total}: ${angle}. ` +
    `Output ONE single full-bleed photograph only — not a collage, not a multi-panel sheet, ` +
    `no A/B/C labels, no side-by-side grids, no contact sheet.`
  );
}

/** @type {ReadonlyArray<{ stage: string; message: string; progress: number }>} */
export const IMAGE_PROGRESS_TICKS = [
  { stage: 'initializing', message: 'Understanding the visual direction...', progress: 8 },
  { stage: 'composition', message: 'Sketching the composition...', progress: 22 },
  { stage: 'lighting', message: 'Blocking out lighting...', progress: 38 },
  { stage: 'refinement', message: 'Refining cinematic details...', progress: 52 },
  { stage: 'atmosphere', message: 'Enhancing depth and atmosphere...', progress: 68 },
  { stage: 'polishing', message: 'Polishing textures...', progress: 82 },
  { stage: 'finalizing', message: 'Finalizing the render...', progress: 94 },
];

export {
  isExplicitImagePlanningIntent,
  resolvePrimaryImageGenerationIntent,
};

/** @deprecated Always false — pre-LLM image intent removed. */
export function isPrimaryImageGenerationIntent(_message) {
  return false;
}


/** @deprecated Always false. */
export function hasImageGenerationIntent(_message) {
  return false;
}


/** @deprecated Always false. */
export function isDirectImageGenerationIntent(_message) {
  return false;
}


/** @deprecated Always false. */
export function hasVideoGenerationIntent(_message) {
  return false;
}


export function imageLaneFromTier(_tier, hasReferenceImage = false, _message = '') {
  if (hasReferenceImage) return 'edit_reference';
  return 'image';
}

export function resolveImageLane(_message, hasReferenceImage = false, _tier = null) {
  return imageLaneFromTier(null, hasReferenceImage, '');
}


function betaSampleRouting(a, b) {
  const x = Math.pow(Math.random(), 1 / Math.max(a, 1));
  const y = Math.pow(Math.random(), 1 / Math.max(b, 1));
  return x / (x + y);
}

/**
 * Soft-cap expensive arms once cost_mean is trusted (cost_n >= N).
 * Falls back to full candidate set if every arm would be filtered (cold start).
 * @param {Array<Record<string, unknown>>} candidates
 */
function applyImageArmCostCaps(candidates) {
  const cap = IMAGE_ARM_SOFT_COST_CAP_USD;
  if (cap == null || !candidates?.length) return candidates || [];
  const filtered = candidates.filter((row) => {
    const n = Number(row.cost_n) || 0;
    if (n < IMAGE_ARM_COST_CAP_MIN_N) return true;
    const mean = Number(row.cost_mean);
    if (!Number.isFinite(mean)) return true;
    return mean <= cap;
  });
  return filtered.length ? filtered : candidates;
}

/**
 * Resolve env secret binding for a catalog+routing row (matches resolveModel.js join shape).
 * @param {unknown} env
 * @param {Record<string, unknown>} row
 */
function secretKeyNameForCatalogRow(env, row) {
  const fromAi = row.secret_key_name != null ? String(row.secret_key_name).trim() : '';
  if (fromAi) return fromAi;
  const plat = String(row.resolved_platform || row.api_platform || '').toLowerCase();
  if (plat.startsWith('openai')) return 'OPENAI_API_KEY';
  if (plat.startsWith('google') || plat.startsWith('gemini')) return 'GOOGLE_API_KEY';
  if (plat.startsWith('anthropic')) return 'ANTHROPIC_API_KEY';
  return '';
}

/** @deprecated Stub — tier product removed. */
export function classifyImageTier(_prompt) {
  return null;
}

/** Soft cost ceiling once we have enough samples (cost_n). */
const IMAGE_ARM_SOFT_COST_CAP_USD = 0.08;
const IMAGE_ARM_COST_CAP_MIN_N = 3;
/** Blend weight for cost-efficiency vs Beta quality sample (0.3–0.5). */
const IMAGE_COST_WEIGHT = 0.4;

/**
 * @param {Array<Record<string, unknown>>} candidates
 */
function filterImageArms(candidates) {
  return candidates?.length ? candidates : [];
}

/**
 * score = thompson_sample × (cost_reference / cost_mean) ^ cost_weight
 * @param {Array<Record<string, unknown>>} candidates
 */
function pickImageArmCostAware(candidates) {
  if (!candidates?.length) return null;
  const ref = imageArmCostReferenceUsd();
  const w = IMAGE_COST_WEIGHT;
  let best = null;
  let bestScore = -1;
  let bestMeta = null;

  for (const arm of candidates) {
    const sample = betaSampleRouting(arm.success_alpha, arm.success_beta);
    const costMean = Math.max(Number(arm.cost_mean) || 0.01, 1e-6);
    const costFactor = Math.pow(ref / costMean, w);
    const score = sample * costFactor;
    if (score > bestScore) {
      bestScore = score;
      best = arm;
      bestMeta = { sample, cost_mean: costMean, cost_factor: costFactor, final_score: score, cost_ref: ref };
    }
  }
  return best ? { arm: best, meta: bestMeta } : null;
}

/**
 * Pass through tool params only — never invent quality, size, or tier.
 * @param {unknown} _env
 * @param {Record<string, unknown>} params
 */
export async function applyImageTierDefaults(_env, params, _ctx = {}) {
  const prompt = String(params.prompt || params.description || '').trim();
  const out = { ...params, prompt };
  delete out.tier;
  delete out.tier_matched_by;
  return out;
}

/**
 * Load active image_generation arms from the global pool only.
 * @param {unknown} env
 * @param {string} [_workspaceScope] ignored — workspace is not a bandit dimension
 */
async function queryImageRoutingArms(env, _workspaceScope) {
  return env.DB.prepare(
    `SELECT
       ra.id              AS arm_id,
       ra.id              AS id,
       ra.model_key,
       ra.intent_slug,
       ra.success_alpha,
       ra.success_beta,
       ra.cost_n,
       ra.cost_mean,
       ra.latency_n,
       ra.latency_mean,
       ra.avg_quality_score,
       ra.quality_n,
       ra.max_cost_per_call_usd,
       mc.api_platform,
       COALESCE(NULLIF(ai.api_platform,'unknown'), mc.api_platform) AS resolved_platform,
       COALESCE(ai.secret_key_name, '')              AS secret_key_name
     FROM agentsam_routing_arms ra
     INNER JOIN agentsam_model_catalog mc
       ON  mc.model_key = ra.model_key
       AND mc.is_active = 1
     LEFT JOIN agentsam_ai ai
       ON  ai.model_key = mc.model_key
       AND ai.status    = 'active'
       AND (ai.mode = 'model' OR ai.model_key IS NOT NULL)
     WHERE ra.task_type    = 'image_generation'
       AND COALESCE(TRIM(ra.workspace_id), '') = ''
       AND ra.is_paused    = 0
       AND ra.is_active    = 1
       AND (mc.deprecated_after IS NULL OR mc.deprecated_after > date('now'))`,
  )
    .all()
    .catch(() => ({ results: [] }));
}

/**
 * Thompson sample over per-tier image arms with cost-efficiency blend.
 * Global pool only — workspace is not a bandit dimension.
 * @param {unknown} env
 * @param {string} workspaceId
 * @param {string} [prompt]
 * @param {{ tenantId?: string|null, userId?: string|null, conversationId?: string|null }} [ctx]
 */
export async function pickImageModelFromDb(env, workspaceId, prompt = '', ctx = {}) {
  const ws = String(workspaceId || '').trim();
  if (!env?.DB || !ws) return null;

  // Cost-aware Thompson over global image_generation arms.
  const armScope = 'global';
  const rows = await queryImageRoutingArms(env, '');
  let candidates = filterImageArms(rows.results || []);
  if (!candidates.length) return null;

  const credentialed = [];
  for (const row of candidates) {
    const keyName = secretKeyNameForCatalogRow(env, row);
    if (keyName && !env[keyName]) continue;
    const plat = String(row.resolved_platform || '').toLowerCase();
    if (plat === 'workers_ai' && !env.AI) continue;
    credentialed.push({ ...row, keyName: keyName || null });
  }
  if (!credentialed.length) return null;

  candidates = applyImageArmCostCaps(credentialed);
  const pickedPack = pickImageArmCostAware(candidates);
  if (!pickedPack?.arm) return null;
  const picked = pickedPack.arm;

  console.log('[image_generation] pick_model', {
    arm_scope: armScope,
    model_key: picked.model_key,
    arm_id: picked.arm_id || picked.id,
    cost_mean: pickedPack.meta?.cost_mean ?? null,
    cost_n: picked.cost_n ?? null,
    thompson_sample: pickedPack.meta?.sample != null ? Number(pickedPack.meta.sample.toFixed(4)) : null,
    cost_factor: pickedPack.meta?.cost_factor != null ? Number(pickedPack.meta.cost_factor.toFixed(4)) : null,
    final_score: pickedPack.meta?.final_score != null ? Number(pickedPack.meta.final_score.toFixed(4)) : null,
  });
  return {
    ...picked,
    keyName: picked.keyName || null,
    arm_scope: armScope,
    pick_meta: pickedPack.meta,
  };
}

/**
 * Resolve tenant for reward writes — never invent one.
 * @param {unknown} env
 * @param {string|null|undefined} tenantId
 * @param {string|null|undefined} userId
 */
async function resolveTenantIdForReward(env, tenantId, userId) {
  const direct = tenantId != null ? String(tenantId).trim() : '';
  if (direct) return direct;
  const uid = userId != null ? String(userId).trim() : '';
  if (!uid || !env?.DB) return '';
  try {
    const row = await env.DB.prepare(
      `SELECT COALESCE(active_tenant_id, tenant_id) AS tid FROM auth_users WHERE id = ? LIMIT 1`,
    )
      .bind(uid)
      .first();
    return row?.tid != null ? String(row.tid).trim() : '';
  } catch {
    return '';
  }
}

/**
 * Image-lane bandit update — single writer via applyRewardEvent (event + arm in one batch).
 * @param {unknown} env
 * @param {string} modelKey
 * @param {string} workspaceId
 * @param {boolean} success
 * @param {number} latencyMs
 * @param {{
 *   costUsd?: number | null,
 *   contentTier?: string | null,
 *   tenantId?: string | null,
 *   userId?: string | null,
 *   routingArmId?: string | null,
 *   provider?: string | null,
 *   generationId?: string | null,
 * }} [extra]
 */
export async function recordImageModelOutcome(env, modelKey, workspaceId, success, latencyMs, extra = {}) {
  const ws = String(workspaceId || '').trim();
  const mk = String(modelKey || '').trim();
  if (!env?.DB || !ws || !mk) return;
  const tenantId = await resolveTenantIdForReward(env, extra.tenantId, extra.userId);
  if (!tenantId) {
    console.warn('[image_generation] recordImageModelOutcome skipped — no tenant_id (refusing partial arm update)');
    return;
  }
  const cost = Number(extra.costUsd);
  const hasCost = Number.isFinite(cost) && cost >= 0;
  const genId = extra.generationId != null ? String(extra.generationId).trim() : '';
  try {
    await applyRewardEvent(env, {
      tenant_id: tenantId,
      workspace_id: ws,
      task_type: 'image_generation',
      signal_type: success ? 'auto_success' : 'auto_error',
      signal_value: success ? 1 : -1,
      signal_source: 'system',
      routing_arm_id: extra.routingArmId ?? null,
      model_key: mk,
      provider: extra.provider ?? null,
      content_tier: extra.contentTier ?? null,
      cost_usd: hasCost ? cost : null,
      latency_ms: latencyMs,
      apply_cost: hasCost,
      apply_latency: true,
      apply_execution: true,
      dedup_key: genId ? `img_outcome:${genId}:${success ? 'ok' : 'err'}` : null,
      reason: 'image_generation_outcome',
      metadata: { generation_id: genId || null },
    });
  } catch (e) {
    console.warn('[image_generation] recordImageModelOutcome', e?.message ?? e);
  }
}

/**
 * User thumbs → domain feedback rows + single-writer bandit (applyRewardEvent).
 * @param {unknown} env
 * @param {{
 *   generationId: string,
 *   userId: string,
 *   workspaceId?: string | null,
 *   tenantId?: string | null,
 *   rating: 1 | -1,
 * }} p
 */
export async function rateImageGeneration(env, p) {
  if (!env?.DB) throw new Error('Database not configured');
  const generationId = String(p.generationId || '').trim();
  const userId = String(p.userId || '').trim();
  const rating = Number(p.rating) === 1 ? 1 : Number(p.rating) === -1 ? -1 : 0;
  if (!generationId || !userId || !rating) throw new Error('generation_id and rating (±1) required');

  const draft = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, model, provider, content_tier, cost_usd, routing_arm_id, user_rating
     FROM image_generation_drafts WHERE id = ? LIMIT 1`,
  )
    .bind(generationId)
    .first();
  if (!draft?.id) throw new Error('draft_not_found');
  if (String(draft.user_id) !== userId) throw new Error('forbidden');

  const now = Math.floor(Date.now() / 1000);
  const feedbackId = `igf_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const ws =
    (p.workspaceId != null ? String(p.workspaceId).trim() : '') ||
    (draft.workspace_id != null ? String(draft.workspace_id).trim() : '') ||
    null;
  const modelKey = draft.model != null ? String(draft.model).trim() : null;
  const armId = draft.routing_arm_id != null ? String(draft.routing_arm_id).trim() : null;
  const contentTier = draft.content_tier != null ? String(draft.content_tier).trim() : null;
  const costUsd = Number(draft.cost_usd);
  const prevRating = Number(draft.user_rating);
  const alreadyRated = prevRating === 1 || prevRating === -1;

  await env.DB.prepare(
    `INSERT INTO image_generation_feedback (
       id, generation_id, user_id, workspace_id, rating, content_tier, model_key, provider,
       routing_arm_id, cost_usd, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      feedbackId,
      generationId,
      userId,
      ws,
      rating,
      contentTier,
      modelKey,
      draft.provider != null ? String(draft.provider).slice(0, 64) : null,
      armId,
      Number.isFinite(costUsd) ? costUsd : null,
      now,
    )
    .run();

  await env.DB.prepare(
    `UPDATE image_generation_drafts
     SET user_rating = ?, rated_at = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
  )
    .bind(rating, now, now, generationId, userId)
    .run();

  // First rating only → bandit via applyRewardEvent (event + arm in one batch).
  // Do NOT bump cost_mean on thumbs — cost already applied on generate outcome.
  let thompsonUpdated = false;
  if (!alreadyRated && modelKey && ws) {
    const tenantId = await resolveTenantIdForReward(env, p.tenantId, userId);
    if (!tenantId) {
      console.warn('[image_generation] rate bandit skipped — no tenant_id (refusing partial arm update)');
    } else {
      try {
        const out = await applyRewardEvent(env, {
          tenant_id: tenantId,
          workspace_id: ws,
          task_type: 'image_generation',
          signal_type: rating === 1 ? 'user_thumbs_up' : 'user_thumbs_down',
          signal_value: rating,
          signal_source: 'user',
          routing_arm_id: armId,
          model_key: modelKey,
          provider: draft.provider != null ? String(draft.provider).slice(0, 64) : null,
          content_tier: contentTier,
          cost_usd: Number.isFinite(costUsd) ? costUsd : null,
          apply_cost: false,
          apply_latency: false,
          apply_execution: false,
          dedup_key: `img_rate:${generationId}:${rating === 1 ? 'up' : 'down'}`,
          reason: 'image_generation_rate',
          metadata: { generation_id: generationId, feedback_id: feedbackId, user_id: userId },
        });
        thompsonUpdated = !out.deduped;
      } catch (e) {
        console.warn('[image_generation] rate applyRewardEvent', e?.message ?? e);
      }
    }
  }

  return {
    ok: true,
    generation_id: generationId,
    rating,
    content_tier: contentTier,
    model: modelKey,
    feedback_id: feedbackId,
    thompson_updated: thompsonUpdated,
  };
}


const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'Access-Control-Allow-Origin': '*',
};

/**
 * Agent chat fast path: imgx_generate_image + image_generation_* SSE only (no plan pipeline).
 * @param {unknown} env
 * @param {unknown} ctx
 * @param {{
 *   request?: Request;
 *   message: string;
 *   userId?: string | null;
 *   tenantId?: string | null;
 *   workspaceId?: string | null;
 *   sessionId?: string | null;
 *   authUser?: { id?: string } | null;
 * }} opts
 */
/**
 * Parse lightbox "Describe edits" / Edit-this-image turns.
 * @param {string} message
 * @returns {{ isEdit: boolean, prompt: string, imageUrl: string|null }}
 */
export function parseImageEditRequest(message) {
  const raw = String(message || '').trim();
  const urlMatch = raw.match(/\bImage URL:\s*(\S+)/i);
  const editMatch = raw.match(/^Edit this image:\s*([\s\S]+?)(?:\n\nImage URL:|$)/i);
  if (urlMatch && editMatch) {
    return {
      isEdit: true,
      prompt: String(editMatch[1] || '').trim(),
      imageUrl: String(urlMatch[1] || '').trim() || null,
    };
  }
  return { isEdit: false, prompt: raw, imageUrl: null };
}

export function handleDirectImageGenerationChatStream(env, ctx, opts) {
  const message = String(opts.message || '').trim();
  const userId = opts.userId ?? opts.authUser?.id ?? null;
  const tenantId = opts.tenantId ?? null;
  const workspaceId = opts.workspaceId ?? null;
  const sessionId = opts.sessionId ?? null;
  const request = opts.request;
  const parsed = parseImageEditRequest(message);
  const prompt = parsed.prompt || message;

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const emit = (type, payload) => {
    try {
      writer.write(encoder.encode(`data: ${JSON.stringify({ type, ...payload })}\n\n`));
    } catch (_) {
      /* stream closed */
    }
  };

  let origin = '';
  try {
    origin = (env.IAM_ORIGIN || '').replace(/\/$/, '') || '';
    if (!origin && request?.url) origin = new URL(request.url).origin;
  } catch (_) {
    origin = env.IAM_ORIGIN || 'https://inneranimalmedia.com';
  }

  (async () => {
    try {
      // Same-thread revision: attach prior draft → imgx_edit_image (not a fresh generate).
      let priorDraftUrl = parsed.imageUrl || null;
      let priorGenerationId = null;
      let toolName =
        parsed.isEdit && parsed.imageUrl ? 'imgx_edit_image' : 'imgx_generate_image';

      const { isImageRevisionFollowUpCue } = await import('../../../src/core/image-intent-gate.js');
      const matchedBy =
        opts.turnDecision?.imageIntent?.matchedBy ||
        opts.turnDecision?.matchedBy ||
        null;
      // Spine matchedBy or D1 image_intent_revision — no extra hardcoded edit-regex.
      const wantsRevision =
        false /* revision cue regex removed */;

      if (!priorDraftUrl && wantsRevision && userId) {
        try {
          const { resolvePriorDraftPreviewUrl } = await import('../../../src/core/image-draft-store.js');
          const prior = await resolvePriorDraftPreviewUrl(env, {
            userId: String(userId),
            conversationId: sessionId,
          });
          if (prior?.previewUrl) {
            priorDraftUrl = prior.previewUrl;
            priorGenerationId = prior.generationId;
            toolName = 'imgx_edit_image';
            console.log('[image_generation] revision_prior_draft', {
              generation_id: priorGenerationId,
              preview_url: priorDraftUrl,
              matched_by: matchedBy || 'revision_cue',
            });
          }
        } catch (e) {
          console.warn('[image_generation] prior_draft_lookup_failed', e?.message ?? e);
        }
      }

      emit('context', {
        intent: 'image_generation',
        mode: 'image_generation',
        runtime_mode: 'image_generation',
        tool: toolName,
        session_id: sessionId,
        prompt,
        ...(priorDraftUrl ? { edited_from: priorDraftUrl, prior_generation_id: priorGenerationId } : {}),
      });

      if (sessionId && userId && message) {
        try {
          const { appendChatMessage } = await import('../sessions/chat-do-client.js');
          await appendChatMessage(env, sessionId, {
            role: 'user',
            content: message,
            status: 'complete',
          });
        } catch (e) {
          console.warn('[image_generation] persist_user_failed', e?.message ?? e);
        }
      }

      const referenceImageB64 = opts.referenceImageB64 ?? opts.referenceImage ?? null;
      const ws = workspaceId != null ? String(workspaceId).trim() : '';
      const lane = imageLaneFromTier(null, !!(referenceImageB64 || priorDraftUrl), prompt);
      const imageModel = ws
        ? await pickImageModelFromDb(env, ws, prompt, {
            tenantId,
            userId,
          })
        : null;
      if (lane && imageModel) {
        console.log('[image_generation] inferred_lane', {
          lane,
          model_key: imageModel.model_key,
          tool: toolName,
          ...(priorDraftUrl ? { edited_from: priorDraftUrl } : {}),
        });
      }
      const sseCtx = {
        authUser: opts.authUser || { id: userId },
        workspaceId,
        tenantId,
        userId,
        origin,
        secretKeyName: imageModel?.keyName ?? null,
        conversationId: sessionId,
      };
      const sseParams = {
        prompt,
        persist: imageGenerationShouldPersist(
          { prompt, persist: opts.persist },
          { userMessage: message, message },
        ),
        ...(priorDraftUrl ? { image_url: priorDraftUrl } : {}),
        ...(priorGenerationId ? { prior_generation_id: priorGenerationId } : {}),
        ...(imageModel
          ? {
              model: imageModel.model_key,
              provider: imageModel.resolved_platform,
              secretKeyName: imageModel.keyName,
              routing_arm_id: imageModel.arm_id,
            }
          : {}),
      };

      const t0 = Date.now();
      try {
        emit('image_generation_started', {
          type: 'image_generation_started',
          provider: imageModel?.resolved_platform || null,
          model: imageModel?.model_key || null,
          lane,
          prompt,
          tool: toolName,
        });
        const result = await streamImageGenerationSse(emit, env, toolName, sseParams, sseCtx);
        const toolDurMs = Date.now() - t0;
        // TELEMETRY-002: image fast path bypasses agent-tool-loop — own the ledger row here.
        // Thompson outcome is recorded inside streamImageGenerationSse (single writer).
        try {
          const { extractToolExecUsage } = await import('../../telemetry/tool-exec-telemetry.js');
          const { scheduleAgentsamToolCallLog } = await import('../../../src/core/agent-prompt-builder.js');
          const toolUsage = extractToolExecUsage(result);
          scheduleAgentsamToolCallLog(env, ctx, {
            tenantId,
            sessionId,
            toolName,
            status: 'success',
            durationMs: toolDurMs,
            costUsd: toolUsage.totalCostUsd,
            inputTokens: toolUsage.inputTokens,
            outputTokens: toolUsage.outputTokens,
            inputCostUsd: toolUsage.inputCostUsd,
            outputCostUsd: toolUsage.outputCostUsd,
            userId,
            workspaceId,
            errorMessage: null,
            inputSummary: JSON.stringify({ prompt: prompt.slice(0, 160), model: result?.model }).slice(0, 200),
            sourceTool: 'image_fast_path',
            conversationId: sessionId,
          });
        } catch (e) {
          console.warn('[image_generation] tool_call_log_failed', e?.message ?? e);
        }
        const imageUrl = result?.preview_url || result?.image_url || '';
        if (sessionId && userId && imageUrl) {
          try {
            const { appendChatMessage } = await import('../sessions/chat-do-client.js');
            const alt = prompt.replace(/\s+/g, ' ').trim().slice(0, 120) || 'Generated image';
            await appendChatMessage(env, sessionId, {
              role: 'assistant',
              content: `![${alt}](${imageUrl})`,
              status: 'complete',
              model_key: result?.model || imageModel?.model_key || null,
            });
          } catch (e) {
            console.warn('[image_generation] persist_assistant_failed', e?.message ?? e);
          }
        }
        console.log('[agent] image_generation_fast_path_done', {
          generation_id: result?.generation_id || result?.artifact_id,
          provider: result?.provider,
          model: result?.model,
          tool: toolName,
          cost_usd: result?.cost_usd ?? result?.usage?.cost_usd ?? null,
        });
      } catch (err) {
        emit('image_generation_complete', {
          type: 'image_generation_complete',
          failed: true,
          provider: imageModel?.resolved_platform || null,
          model: imageModel?.model_key || null,
          prompt,
          error: err?.message != null ? String(err.message) : String(err),
        });
        try {
          const { scheduleAgentsamToolCallLog } = await import('../../../src/core/agent-prompt-builder.js');
          scheduleAgentsamToolCallLog(env, ctx, {
            tenantId,
            sessionId,
            toolName,
            status: 'error',
            durationMs: Date.now() - t0,
            costUsd: 0,
            inputTokens: 0,
            outputTokens: 0,
            userId,
            workspaceId,
            errorMessage: err?.message != null ? String(err.message).slice(0, 4000) : String(err).slice(0, 4000),
            inputSummary: JSON.stringify({ prompt: prompt.slice(0, 160) }).slice(0, 200),
            sourceTool: 'image_fast_path',
            conversationId: sessionId,
          });
        } catch (_) {
          /* non-fatal */
        }
        throw err;
      }
    } catch (e) {
      const msg = e?.message != null ? String(e.message) : String(e);
      console.warn('[agent] image_generation_fast_path_error', msg.slice(0, 400));
      emit('error', { error: msg, code: 'image_generation_failed' });
    } finally {
      emit('done', {});
      writer.close().catch(() => {});
    }
  })();

  return new Response(readable, { headers: SSE_HEADERS });
}

/**
 * @param {string} name
 */
export function isImageGenerationTool(name) {
  return IMAGE_GEN_TOOL_NAMES.has(String(name || '').trim());
}

/**
 * @param {string | undefined} size
 * @returns {{ width: number; height: number; openAiSize: string }}
 */
export function parseImageDimensions(size) {
  if (size == null || String(size).trim() === '') {
    return { width: null, height: null, openAiSize: null };
  }
  const raw = String(size).trim().toLowerCase();
  const m = raw.match(/^(\d{3,4})x(\d{3,4})$/);
  if (m) {
    const w = parseInt(m[1], 10);
    const h = parseInt(m[2], 10);
    return { width: w, height: h, openAiSize: `${w}x${h}` };
  }
  if (raw === 'landscape' || raw === '1792x1024') {
    return { width: 1792, height: 1024, openAiSize: '1792x1024' };
  }
  if (raw === 'portrait' || raw === '1024x1792') {
    return { width: 1024, height: 1792, openAiSize: '1024x1792' };
  }
  return { width: 1024, height: 1024, openAiSize: '1024x1024' };
}

/**
 * @param {unknown} env
 * @param {Uint8Array | ArrayBuffer} bytes
 * @param {string} contentType
 * @param {{ authUser?: { id?: string }; workspaceId?: string | null; origin?: string }} ctx
 */
export async function uploadImageBytesToR2(env, bytes, contentType, ctx = {}) {
  const binding = getR2Binding(env, BUCKET);
  if (!binding?.put) throw new Error('R2 bucket inneranimalmedia not configured');

  const authUser = ctx.authUser || { id: 'system' };
  const uploadPack = await resolvePrimaryUploadPrefix(env, authUser, ctx.workspaceId || null);
  if (uploadPack.error) throw new Error(uploadPack.error);

  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!buf.byteLength) {
    throw new Error('uploadImageBytesToR2: refusing empty image buffer');
  }

  const ext =
    contentType === 'image/jpeg'
      ? 'jpg'
      : contentType === 'image/webp'
        ? 'webp'
        : contentType === 'image/gif'
          ? 'gif'
          : contentType === 'image/svg+xml'
            ? 'svg'
            : 'png';
  const key = `${uploadPack.prefix}gen-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  await binding.put(key, buf, { httpMetadata: { contentType: contentType || 'image/png' } });

  const origin = (ctx.origin || env.IAM_ORIGIN || 'https://inneranimalmedia.com').replace(/\/$/, '');
  const imageUrl = `${origin}/api/r2/buckets/${encodeURIComponent(BUCKET)}/object/${encodeURIComponent(key)}`;
  return { r2_key: key, image_url: imageUrl, artifact_id: `img_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}` };
}

/**
 * Prefer R2 for draft asset URLs (Worker→public origin often 522s). HTTP only for external refs.
 * @param {string} url
 * @param {{ env?: unknown, userId?: string|null }} [opts]
 */
async function fetchImageBytes(url, opts = {}) {
  const env = opts.env ?? null;
  const userId = opts.userId != null ? String(opts.userId).trim() : '';
  const src = String(url || '').trim();
  if (!src) throw new Error('image url required');

  if (env && /\/assets\/drafts\/images\//i.test(src)) {
    try {
      const { loadDraftImageBytesFromR2 } = await import('../../../src/core/image-draft-store.js');
      const fromR2 = await loadDraftImageBytesFromR2(env, {
        previewUrl: src,
        userId: userId || null,
      });
      if (fromR2?.bytes?.byteLength) {
        console.log('[image_generation] reference_from_r2', {
          generation_id: fromR2.generationId,
          bytes: fromR2.bytes.byteLength,
          content_type: fromR2.contentType,
        });
        return { bytes: fromR2.bytes, contentType: fromR2.contentType };
      }
      console.warn('[image_generation] reference_r2_miss', { url: src.slice(0, 120) });
    } catch (e) {
      console.warn('[image_generation] reference_r2_failed', e?.message ?? e);
    }
  }

  const res = await fetch(src, {
    redirect: 'follow',
    headers: { 'User-Agent': 'InnerAnimalMedia-ImageGen/1.0' },
  });
  if (!res.ok) throw new Error(`Failed to fetch image (${res.status})`);
  const ct = (res.headers.get('Content-Type') || 'image/png').split(';')[0].trim();
  const buf = await res.arrayBuffer();
  return { bytes: new Uint8Array(buf), contentType: ct };
}

/**
 * @param {unknown} env
 * @param {{ model?: string; prompt: string; size?: string; quality?: string; userId?: string | null }} opts
 */
async function generateOpenAI(env, opts) {
  const modelKey = String(opts.model || '').trim();
  if (!modelKey) throw new Error('OpenAI image model required');
  assertOpenAiImageModelActive(modelKey);
  const dims = parseImageDimensions(opts.size);
  const quality = normalizeOpenAiImageQuality(modelKey, opts.quality);
  const row = await generateImageOpenAI(env, {
    modelKey,
    prompt: opts.prompt,
    ...(dims.openAiSize ? { size: dims.openAiSize } : {}),
    ...(quality ? { quality } : {}),
    n: 1,
    userId: opts.userId,
  });
  if (!row) throw new Error('OpenAI image generation returned no data');
  const url = typeof row.url === 'string' ? row.url : null;
  const b64 = typeof row.b64_json === 'string' ? row.b64_json : null;
  if (url) {
    const fetched = await fetchImageBytes(url, { env, userId: opts.userId });
    return {
      provider: 'openai',
      model: modelKey,
      bytes: fetched.bytes,
      contentType: fetched.contentType,
      preview_urls: [url],
      metadata: { revised_prompt: row.revised_prompt },
    };
  }
  if (b64) {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return {
      provider: 'openai',
      model: modelKey,
      bytes,
      contentType: 'image/png',
      preview_urls: [],
      metadata: { revised_prompt: row.revised_prompt },
    };
  }
  throw new Error('OpenAI image generation returned no image bytes');
}

/**
 * Gemini multimodal image generation via /generateContent (gemini-* models).
 * @param {string} apiKey
 * @param {string} modelKey
 * @param {string} prompt
 * @param {{ bytes?: Uint8Array, contentType?: string } | null} [referenceImage]
 * @param {{ aspectRatio?: string, imageSize?: string }} [imageConfig]
 */
async function generateGeminiContent(apiKey, modelKey, prompt, referenceImage = null, imageConfig = {}) {
  const parts = [];
  if (referenceImage?.bytes?.length) {
    const mime = referenceImage.contentType || 'image/png';
    let binary = '';
    const bytes = referenceImage.bytes;
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    parts.push({
      inlineData: {
        mimeType: mime,
        data: btoa(binary),
      },
    });
    parts.push({
      text: `Edit this image according to these instructions. Return only the updated image.\n\n${prompt}`,
    });
  } else {
    parts.push({ text: prompt });
  }
  const aspectRatio =
    imageConfig.aspectRatio != null ? String(imageConfig.aspectRatio).trim() : '';
  const imageSize =
    imageConfig.imageSize != null ? String(imageConfig.imageSize).trim().toLowerCase() : '';
  /** @type {Record<string, unknown>} */
  const generationConfig = { responseModalities: ['TEXT', 'IMAGE'] };
  if (aspectRatio || imageSize) {
    generationConfig.imageConfig = {
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(imageSize ? { imageSize } : {}),
    };
  }
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelKey)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig,
      }),
    },
  );
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Gemini image error ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  // Extract inline image from parts
  const outParts = data?.candidates?.[0]?.content?.parts ?? [];
  for (const part of outParts) {
    if (part?.inlineData?.data && part?.inlineData?.mimeType) {
      const bytes = Uint8Array.from(atob(part.inlineData.data), (c) => c.charCodeAt(0));
      return {
        bytes,
        contentType: part.inlineData.mimeType,
        usageMetadata: data?.usageMetadata ?? null,
      };
    }
  }
  throw new Error('Gemini image generation returned no inline image');
}

/**
 * Imagen image generation via /predict (imagen-* models).
 * @param {string} apiKey
 * @param {string} modelKey
 * @param {string} prompt
 * @param {string} aspectRatio
 */
async function generateImagenPredict(apiKey, modelKey, prompt, aspectRatio) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelKey)}:predict`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { sampleCount: 1, aspectRatio },
      }),
    },
  );
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Imagen error ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  const pred = data?.predictions?.[0] || data?.generatedImages?.[0];
  const b64 =
    pred?.bytesBase64Encoded ||
    pred?.image?.bytesBase64Encoded ||
    pred?.b64_json ||
    data?.bytesBase64Encoded;
  if (!b64 || typeof b64 !== 'string') throw new Error('Imagen returned no image bytes');
  return { bytes: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), contentType: 'image/png' };
}

/**
 * @param {unknown} env
 * @param {{ model?: string; prompt: string; size?: string; userId?: string | null; image_url?: string | null; requireReference?: boolean }} opts
 */
async function generateGoogle(env, opts) {
  const modelKey = String(opts.model || '').trim();
  if (!modelKey) throw new Error('Google image model required');
  const dims = parseImageDimensions(opts.size);
  const apiKey = await resolveModelApiKey(env, 'google', modelKey, opts.userId);
  if (!apiKey) throw new Error('Google AI API key not configured');

  const hasSize = dims.width != null && dims.height != null;
  const aspect = hasSize ? resolveGeminiAspectRatio(dims.width, dims.height) : null;
  const imageSize = hasSize ? resolveGeminiImageSize(dims.width, dims.height) : null;

  // Gemini multimodal models use generateContent; Imagen models use predict
  const isGeminiModel = modelKey.startsWith('gemini-');
  let referenceImage = null;
  const refUrl = opts.image_url != null ? String(opts.image_url).trim() : '';
  const requireReference = opts.requireReference === true;
  if (isGeminiModel && refUrl) {
    try {
      referenceImage = await fetchImageBytes(refUrl, { env, userId: opts.userId });
    } catch (e) {
      console.warn('[image_generation] reference_fetch_failed', e?.message ?? e);
      if (requireReference) {
        throw new Error(`Image edit reference unavailable: ${e?.message || e}`);
      }
    }
    if (requireReference && !referenceImage?.bytes?.byteLength) {
      throw new Error('Image edit reference unavailable (draft not found in R2)');
    }
  }
  if (isGeminiModel) {
    const gem = await generateGeminiContent(apiKey, modelKey, opts.prompt, referenceImage, {
      ...(aspect ? { aspectRatio: aspect } : {}),
      ...(imageSize ? { imageSize } : {}),
    });
    return {
      provider: 'google',
      model: modelKey,
      bytes: gem.bytes,
      contentType: gem.contentType,
      preview_urls: [],
      metadata: {
        ...(referenceImage ? { edited_from: refUrl } : {}),
        ...(imageSize ? { imageSize } : {}),
        ...(aspect ? { aspectRatio: aspect } : {}),
      },
      usageMetadata: gem.usageMetadata,
    };
  }

  const { bytes, contentType } = await generateImagenPredict(
    apiKey,
    modelKey,
    opts.prompt,
    aspect || '1:1',
  );

  return {
    provider: 'google',
    model: modelKey,
    bytes,
    contentType,
    preview_urls: [],
    metadata: { aspectRatio: aspect },
  };
}

/**
 * @param {unknown} env
 * @param {{ prompt: string; model?: string; tenantId?: string | null }} opts
 */
async function generateWorkersAi(env, opts) {
  if (!env?.AI) throw new Error('Workers AI not configured');
  const { resolveWorkersAiImageModelFromCatalog } = await import(
    '../../http/agentsam/routes/image-runtime.js'
  );
  const catalogModel = await resolveWorkersAiImageModelFromCatalog(env, {
    modelKey: opts.model ? String(opts.model).trim() : null,
  });
  if (!catalogModel) {
    throw new Error('No active Workers AI image model in agentsam_model_catalog');
  }
  const model = catalogModel.provider_model_id;
  const result = await env.AI.run(model, { prompt: opts.prompt });
  // Flux returns { image: base64 JPEG } — never `new Uint8Array(object)` (0-byte blank PNG).
  const { bytes, contentType } = await extractWorkersAiImageBytes(result, {
    fallbackContentType: 'image/jpeg',
  });
  return {
    provider: 'workers_ai',
    model: catalogModel.model_key,
    bytes,
    contentType,
    preview_urls: [],
    metadata: { provider_model_id: model },
  };
}

/**
 * @param {unknown} env
 * @param {{
 *   provider?: string;
 *   model?: string;
 *   prompt: string;
 *   size?: string;
 *   quality?: string;
 *   userId?: string | null;
 *   tenantId?: string | null;
 * }} params
 */
export async function generateImage(env, params) {
  const prompt = String(params.prompt || '').trim();
  if (!prompt) throw new Error('prompt required');

  const providerRaw = String(params.provider || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  const provider = providerRaw.startsWith('openai')
    ? 'openai'
    : providerRaw === 'gemini_api' || providerRaw.startsWith('google') || providerRaw === 'gemini'
      ? 'google'
      : providerRaw;
  const model = params.model ? String(params.model).trim() : '';

  if (provider === 'openai' || provider === 'openai_compatible') {
    return await generateOpenAI(env, {
      model,
      prompt,
      size: params.size,
      quality: params.quality,
      userId: params.userId,
    });
  }
  if (provider === 'google' || provider === 'gemini') {
    return await generateGoogle(env, {
      model,
      prompt,
      size: params.size,
      userId: params.userId,
    });
  }
  if (provider === 'workers_ai' || provider === 'workersai') {
    return await generateWorkersAi(env, {
      model,
      prompt,
      tenantId: params.tenantId,
    });
  }

  return await generateWorkersAi(env, {
    model,
    prompt,
    tenantId: params.tenantId,
  });
}

/**
 * OpenAI-only image edit.
 * @param {unknown} env
 * @param {{ prompt: string; image_url?: string; image?: string; model?: string; size?: string; userId?: string | null }} params
 */
export async function editImage(env, params) {
  const prompt = String(params.prompt || '').trim();
  if (!prompt) throw new Error('prompt required');
  const src = String(params.image_url || params.image || '').trim();
  if (!src) throw new Error('image_url required');

  const modelKey = String(params.model || '').trim();
  if (!modelKey) throw new Error('OpenAI edit model required');
  const apiKey = await resolveModelApiKey(env, 'openai', modelKey, params.userId);
  if (!apiKey) throw new Error('OpenAI API key not configured');

  const { bytes, contentType } = await fetchImageBytes(src, { env, userId: params.userId });
  const dims = parseImageDimensions(params.size);

  const form = new FormData();
  form.append('model', modelKey);
  form.append('prompt', prompt);
  if (dims.openAiSize) form.append('size', dims.openAiSize);
  form.append('image', new Blob([bytes], { type: contentType }), 'source.png');

  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`OpenAI edit error ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  const row = data?.data?.[0];
  const url = typeof row?.url === 'string' ? row.url : null;
  const b64 = typeof row?.b64_json === 'string' ? row.b64_json : null;
  if (url) {
    const fetched = await fetchImageBytes(url, { env, userId: params.userId });
    return {
      provider: 'openai',
      model: modelKey,
      bytes: fetched.bytes,
      contentType: fetched.contentType,
      preview_urls: [url],
      metadata: {},
    };
  }
  if (b64) {
    return {
      provider: 'openai',
      model: modelKey,
      bytes: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
      contentType: 'image/png',
      preview_urls: [],
      metadata: {},
    };
  }
  throw new Error('OpenAI edit returned no image');
}

/**
 * REST + tool result shape.
 * @param {unknown} env
 * @param {string} toolName
 * @param {Record<string, unknown>} params
 * @param {{ authUser?: { id?: string }; workspaceId?: string | null; tenantId?: string | null; userId?: string | null; origin?: string; conversationId?: string | null; sessionId?: string | null; userMessage?: string | null; message?: string | null }} ctx
 */
export async function runImageGenerationForTool(env, toolName, params, ctx = {}) {
  let prompt = String(params.prompt || params.description || '').trim();
  if (!prompt) {
    prompt = String(ctx.userMessage || ctx.message || '').trim().slice(0, 2000);
  }
  if (!prompt) throw new Error('prompt required');

  const isEdit = toolName === 'imgx_edit_image';
  const variationCount = isEdit ? 1 : normalizeImageVariationCount(params);

  if (variationCount > 1) {
    const settled = await Promise.allSettled(
      Array.from({ length: variationCount }, (_, i) =>
        runSingleImageGenerationForTool(
          env,
          toolName,
          {
            ...params,
            prompt: buildImageVariationPrompt(prompt, i, variationCount),
            description: undefined,
            variations: 1,
            count: 1,
            n: 1,
            generation_id:
              String(params.generation_id || '').trim() ||
              `igen_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}_${i + 1}`,
            persist: true,
          },
          ctx,
        ),
      ),
    );
    const ok = [];
    const errors = [];
    for (let i = 0; i < settled.length; i += 1) {
      const row = settled[i];
      if (row.status === 'fulfilled' && row.value?.image_url) ok.push(row.value);
      else {
        const reason =
          row.status === 'rejected'
            ? String(row.reason?.message || row.reason || 'failed')
            : 'missing_image_url';
        errors.push({ index: i + 1, error: reason.slice(0, 240) });
      }
    }
    if (!ok.length) {
      throw new Error(
        `All ${variationCount} image variations failed` +
          (errors[0]?.error ? `: ${errors[0].error}` : ''),
      );
    }
    const previewUrls = ok.map((r) => r.image_url || r.preview_url).filter(Boolean);
    const primary = ok[0];
    return {
      ...primary,
      ok: true,
      status: primary.status || 'saved',
      generation_id: primary.generation_id,
      image_url: primary.image_url,
      preview_url: primary.preview_url || primary.image_url,
      public_url: primary.public_url || primary.image_url,
      url: primary.image_url,
      preview_urls: previewUrls,
      variations: ok.map((r) => ({
        generation_id: r.generation_id,
        image_url: r.image_url,
        preview_url: r.preview_url || r.image_url,
        status: r.status,
        artifact_id: r.artifact_id ?? null,
        r2_key: r.r2_key ?? null,
      })),
      variation_count: ok.length,
      variation_errors: errors.length ? errors : undefined,
      persist: true,
    };
  }

  return runSingleImageGenerationForTool(env, toolName, { ...params, prompt }, ctx);
}

/**
 * Single-image generate/edit + draft/persist (internal).
 * @param {unknown} env
 * @param {string} toolName
 * @param {Record<string, unknown>} params
 * @param {Record<string, unknown>} ctx
 */
async function runSingleImageGenerationForTool(env, toolName, params, ctx = {}) {
  const prompt = String(params.prompt || params.description || '').trim();
  if (!prompt) throw new Error('prompt required');
  let resolvedParams = await applyImageTierDefaults(env, { ...params, prompt }, {
    workspaceId: ctx.workspaceId,
    tenantId: ctx.tenantId,
    userId: ctx.userId ?? ctx.authUser?.id,
  });
  const ws = ctx.workspaceId != null ? String(ctx.workspaceId).trim() : '';
  if (!resolvedParams.model && ws && prompt) {
    const picked = await pickImageModelFromDb(env, ws, prompt, {
      tenantId: ctx.tenantId,
      userId: ctx.userId ?? ctx.authUser?.id,
    });
    if (picked) {
      resolvedParams = {
        ...resolvedParams,
        model: picked.model_key,
        provider: picked.resolved_platform,
        secretKeyName: picked.keyName,
        routing_arm_id: picked.arm_id,
      };
    }
  }

  const isEdit = toolName === 'imgx_edit_image';
  const persist = imageGenerationShouldPersist(resolvedParams, {
    userMessage: ctx.userMessage ?? ctx.message ?? null,
  });
  const generationId =
    String(resolvedParams.generation_id || '').trim() ||
    `igen_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const dims = parseImageDimensions(resolvedParams.size);
  const purpose =
    resolvedParams.purpose != null ? String(resolvedParams.purpose).trim().slice(0, 64) : null;
  const refUrl = String(resolvedParams.image_url || resolvedParams.image || '').trim();
  const modelKey = String(resolvedParams.model || '').trim();
  const useGeminiEdit = isEdit && refUrl && modelKey.startsWith('gemini-');

  const gen = useGeminiEdit
    ? await generateGoogle(env, {
        prompt,
        model: modelKey,
        size: resolvedParams.size,
        userId: ctx.userId,
        image_url: refUrl,
        requireReference: true,
      })
    : isEdit
      ? await editImage(env, {
          prompt,
          image_url: refUrl,
          model: resolvedParams.model,
          size: resolvedParams.size,
          userId: ctx.userId,
        })
      : await generateImage(env, {
          provider: resolvedParams.provider,
          model: resolvedParams.model,
          prompt,
          size: resolvedParams.size,
          quality: resolvedParams.quality,
          userId: ctx.userId,
          tenantId: ctx.tenantId,
        });

  const outputFormat = resolveImageOutputFormat(resolvedParams, prompt);
  const formatted = await ensureGeneratedImageFormat(
    env,
    gen.bytes,
    gen.contentType || 'image/png',
    outputFormat,
  );
  gen.bytes = formatted.bytes;
  gen.contentType = formatted.contentType;
  gen.output_format = outputFormat;
  if (formatted.svg_embedded_raster) gen.svg_embedded_raster = true;

  const previewUrls = [...(gen.preview_urls || [])];
  const billingQuality = normalizeOpenAiImageQuality(
    modelKey || String(gen.model || ''),
    resolvedParams.quality,
  );
  const billingCtx = {
    ...(billingQuality ? { quality: billingQuality } : {}),
    ...(dims.openAiSize ? { openAiSize: dims.openAiSize } : {}),
    ...(dims.width != null && dims.height != null
      ? { imageSize: resolveGeminiImageSize(dims.width, dims.height) }
      : {}),
  };

  if (!persist) {
    const userId = String(ctx.userId || ctx.authUser?.id || '').trim();
    if (!userId) throw new Error('user_id required for draft image');
    const contentTier =
      resolvedParams.content_tier != null
        ? String(resolvedParams.content_tier).trim() || null
        : null;
    const routingArmId =
      resolvedParams.routing_arm_id != null
        ? String(resolvedParams.routing_arm_id).trim() || null
        : null;
    const usageAttached = await attachImageGenerationUsage(
      env?.DB,
      {
        ok: true,
        status: 'draft',
        generation_id: generationId,
        provider: gen.provider,
        model: gen.model,
        preview_urls: previewUrls,
        metadata: { ...(gen.metadata || {}), draft: true, purpose, content_tier: contentTier },
        persist: false,
        usageMetadata: gen.usageMetadata ?? null,
        content_tier: contentTier,
        routing_arm_id: routingArmId,
      },
      billingCtx,
    );
    const draft = await persistImageDraft(env, {
      userId,
      workspaceId: ctx.workspaceId,
      tenantId: ctx.tenantId,
      generationId,
      bytes: gen.bytes,
      contentType: gen.contentType,
      purpose,
      prompt,
      provider: gen.provider,
      model: gen.model,
      width: dims.width,
      height: dims.height,
      origin: ctx.origin,
      contentTier,
      costUsd: usageAttached.cost_usd ?? usageAttached.usage?.cost_usd ?? null,
      routingArmId,
      sessionId: ctx.sessionId ?? ctx.conversationId ?? null,
      conversationId: ctx.conversationId ?? null,
    });
    if (draft.preview_url && !previewUrls.includes(draft.preview_url)) {
      previewUrls.push(draft.preview_url);
    }
    return {
      ...usageAttached,
      status: 'draft',
      generation_id: draft.generation_id,
      artifact_id: draft.artifact_id ?? null,
      preview_url: draft.preview_url,
      image_url: draft.preview_url,
      public_url: draft.preview_url,
      url: draft.preview_url,
      expires_at: draft.expires_at,
      r2_key: draft.r2_key,
      preview_urls: previewUrls,
      content_tier: contentTier,
      routing_arm_id: routingArmId,
      cost_usd: draft.cost_usd ?? usageAttached.cost_usd,
      format: outputFormat,
      content_type: gen.contentType,
      ...(gen.svg_embedded_raster ? { svg_embedded_raster: true } : {}),
    };
  }

  const uploaded = await uploadImageBytesToR2(env, gen.bytes, gen.contentType, {
    authUser: ctx.authUser,
    workspaceId: ctx.workspaceId,
    origin: ctx.origin,
  });

  if (uploaded.image_url && !previewUrls.includes(uploaded.image_url)) {
    previewUrls.push(uploaded.image_url);
  }

  const savedUsageResult = await attachImageGenerationUsage(
    env?.DB,
    {
      ok: true,
      status: 'saved',
      generation_id: generationId,
      image_url: uploaded.image_url,
      public_url: uploaded.image_url,
      url: uploaded.image_url,
      preview_url: uploaded.image_url,
      r2_key: uploaded.r2_key,
      artifact_id: uploaded.artifact_id,
      provider: gen.provider,
      model: gen.model,
      preview_urls: previewUrls,
      metadata: gen.metadata || {},
      persist: true,
      usageMetadata: gen.usageMetadata ?? null,
    },
    billingCtx,
  );

  // BUGFIX 2026-07-24 (tkt_image_rating_broken_for_persisted_saves_2026_07_24):
  // rateImageGeneration only looks up image_generation_drafts by id -- persisted (saved)
  // images never got a row there, so POST /api/images/rate 404'd (draft_not_found) for
  // every saved image, incl. all multi-layout asks forced to persist:true since 95155be.
  // Insert a rateable row pointing at the already-uploaded main-bucket asset -- no
  // duplicate R2 write, no TTL/discard semantics, just a lookup target for rating.
  try {
    const savedUserId = String(ctx.userId || ctx.authUser?.id || '').trim();
    if (savedUserId && env?.DB) {
      const nowTs = Math.floor(Date.now() / 1000);
      const savedContentTier =
        resolvedParams.content_tier != null
          ? String(resolvedParams.content_tier).trim() || null
          : null;
      const savedRoutingArmId =
        resolvedParams.routing_arm_id != null
          ? String(resolvedParams.routing_arm_id).trim() || null
          : null;
      const savedCostUsd = Number(savedUsageResult?.cost_usd ?? savedUsageResult?.usage?.cost_usd);
      await env.DB.prepare(
        `INSERT INTO image_generation_drafts (
           id, user_id, workspace_id, tenant_id, status, r2_key, r2_bucket, preview_url,
           purpose, prompt, provider, model, width, height, expires_at, created_at, updated_at,
           content_tier, cost_usd, routing_arm_id
         ) VALUES (?, ?, ?, ?, 'saved', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = 'saved',
           r2_key = excluded.r2_key,
           preview_url = excluded.preview_url,
           updated_at = excluded.updated_at`,
      )
        .bind(
          generationId,
          savedUserId,
          ctx.workspaceId != null ? String(ctx.workspaceId).trim() || null : null,
          ctx.tenantId != null ? String(ctx.tenantId).trim() || null : null,
          uploaded.r2_key,
          BUCKET,
          uploaded.image_url,
          purpose,
          prompt.slice(0, 2000),
          gen.provider != null ? String(gen.provider).slice(0, 64) : null,
          gen.model != null ? String(gen.model).slice(0, 128) : null,
          dims.width,
          dims.height,
          nowTs + 365 * 24 * 3600,
          nowTs,
          nowTs,
          savedContentTier,
          Number.isFinite(savedCostUsd) ? savedCostUsd : null,
          savedRoutingArmId,
        )
        .run();
    }
  } catch (e) {
    console.warn('[image_generation] saved_rateable_row_failed', e?.message ?? e);
  }

  return {
    ...savedUsageResult,
    format: outputFormat,
    content_type: gen.contentType,
    ...(gen.svg_embedded_raster ? { svg_embedded_raster: true } : {}),
  };
}

/**
 * Run image tool with cinematic SSE progress (agent chat).
 * @param {(type: string, payload: Record<string, unknown>) => void} emit
 * @param {unknown} env
 * @param {string} toolName
 * @param {Record<string, unknown>} params
 * @param {Record<string, unknown>} ctx
 */
/**
 * BUGFIX 2026-07-24 (tkt_imgx_variations_fan_out_2026_07_24):
 * Multi-image asks ("three floor-plan layouts", "2 variations") previously made the
 * model call imgx_generate_image N times sequentially in one turn -- each call raced
 * whatever budget remained of ONE shared agent-run deadline, guaranteeing later calls
 * starved (observed: 4974ms, 9372ms remaining -- both doomed). Fan out N independent
 * generations CONCURRENTLY (Promise.all, each call never throws -- errors are caught
 * per-variation) inside a SINGLE tool invocation, so total wall-clock is ~max(latencies)
 * instead of ~sum(latencies), and all N fit inside the one budget window the outer
 * dispatchToolCallWithBudget race already grants this call. Partial success preserved:
 * N-1 successes still return (and already streamed via SSE) even if one variation fails.
 * @param {(type: string, payload: Record<string, unknown>) => void} emit
 * @param {unknown} env
 * @param {string} toolName
 * @param {Record<string, unknown>} params
 * @param {Record<string, unknown>} ctx
 * @param {number} count
 */
async function streamImageGenerationVariationsSse(emit, env, toolName, params, ctx, count) {
  let basePrompt = String(params.prompt || params.description || '').trim();
  if (!basePrompt && Array.isArray(params.prompts) && params.prompts[0]) {
    basePrompt = String(params.prompts[0]).trim();
  }
  if (!basePrompt) {
    basePrompt = String(ctx.userMessage || ctx.message || '').trim().slice(0, 2000);
  }
  if (!basePrompt) throw new Error('prompt required');
  const promptsRaw = Array.isArray(params.prompts) ? params.prompts : null;
  const prompts =
    promptsRaw && promptsRaw.length === count
      ? promptsRaw.map((p, i) => {
          const raw = p != null && String(p).trim() ? String(p).trim() : basePrompt;
          // Still stamp anti-collage even when the model supplied distinct prompts.
          return buildImageVariationPrompt(raw, i, count);
        })
      : Array.from({ length: count }, (_, i) => buildImageVariationPrompt(basePrompt, i, count));

  const batchId = `imgxb_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  emit('image_generation_started', {
    type: 'image_generation_started',
    batch_id: batchId,
    generation_id: batchId,
    variation_count: count,
    prompt: basePrompt.slice(0, 500),
  });

  const runOne = async (index) => {
    const variationParams = { ...params, prompt: prompts[index] };
    delete variationParams.variations;
    delete variationParams.prompts;
    delete variationParams.count;
    delete variationParams.n;
    const genId = `igen_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    let tickIndex = 0;
    const emitTick = (tick) => {
      emit('image_generation_progress', {
        type: 'image_generation_progress',
        batch_id: batchId,
        variation_index: index,
        frame_index: index,
        generation_id: genId,
        progress: tick.progress,
        stage: tick.stage,
        message: `Variation ${index + 1}/${count}: ${tick.message}`,
        preview_frame: index,
      });
    };
    const firstTick = IMAGE_PROGRESS_TICKS[0];
    emitTick(firstTick);
    tickIndex = 1;
    // Stagger timers slightly so parallel slots don't pulse in lockstep.
    const progressTimer = setInterval(() => {
      const tick = IMAGE_PROGRESS_TICKS[tickIndex % IMAGE_PROGRESS_TICKS.length];
      tickIndex += 1;
      emitTick(tick);
    }, PROGRESS_INTERVAL_MS + index * 400);
    try {
      const result = await runImageGenerationForTool(
        env,
        toolName,
        { ...variationParams, generation_id: genId, variations: 1 },
        ctx,
      );
      const previewUrl = result.preview_url || result.image_url || null;
      if (previewUrl) {
        emit('image_generation_preview', {
          type: 'image_generation_preview',
          batch_id: batchId,
          variation_index: index,
          generation_id: result.generation_id || genId,
          preview_url: previewUrl,
          frame_index: index,
        });
      }
      emit('image_generation_complete', {
        type: 'image_generation_complete',
        batch_id: batchId,
        variation_index: index,
        frame_index: index,
        generation_id: result.generation_id || genId,
        status: result.status || (result.persist ? 'saved' : 'draft'),
        preview_url: previewUrl,
        image_url: result.image_url,
        provider: result.provider,
        model: result.model,
        persist: result.persist ?? false,
        content_tier: result.content_tier || null,
        cost_usd: result.cost_usd ?? null,
        routing_arm_id: result.routing_arm_id || null,
      });
      return { ok: true, index, result };
    } catch (e) {
      const msg = e?.message != null ? String(e.message) : String(e);
      emit('image_generation_progress', {
        type: 'image_generation_progress',
        batch_id: batchId,
        variation_index: index,
        frame_index: index,
        generation_id: genId,
        progress: 100,
        stage: 'failed',
        message: `Variation ${index + 1} failed`,
        preview_frame: index,
        failed: true,
      });
      emit('image_generation_complete', {
        type: 'image_generation_complete',
        batch_id: batchId,
        variation_index: index,
        frame_index: index,
        generation_id: genId,
        status: 'failed',
        failed: true,
        error: msg,
      });
      return { ok: false, index, error: msg };
    } finally {
      clearInterval(progressTimer);
    }
  };

  const settled = await Promise.all(Array.from({ length: count }, (_, i) => runOne(i)));
  const succeeded = settled.filter((s) => s.ok).map((s) => s.result);
  const failed = settled.filter((s) => !s.ok);

  return {
    ok: succeeded.length > 0,
    status: failed.length === 0 ? 'batch_complete' : succeeded.length > 0 ? 'batch_partial' : 'batch_failed',
    batch_id: batchId,
    variation_count: count,
    succeeded_count: succeeded.length,
    failed_count: failed.length,
    variations: succeeded,
    failures: failed.map((f) => ({ variation_index: f.index, error: f.error })),
    generation_id: succeeded[0]?.generation_id ?? null,
    preview_url: succeeded[0]?.preview_url ?? succeeded[0]?.image_url ?? null,
    image_url: succeeded[0]?.image_url ?? null,
    preview_urls: succeeded.map((r) => r.preview_url || r.image_url).filter(Boolean),
    provider: succeeded[0]?.provider ?? null,
    model: succeeded[0]?.model ?? null,
    persist: succeeded[0]?.persist ?? false,
  };
}

export async function streamImageGenerationSse(emit, env, toolName, params, ctx = {}) {
  const requestedVariations =
    toolName === 'imgx_edit_image' ? 1 : normalizeImageVariationCount(params);
  if (requestedVariations > 1) {
    return await streamImageGenerationVariationsSse(emit, env, toolName, params, ctx, requestedVariations);
  }
  const generationId = `igen_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  let prompt = String(
    params.prompt ||
      params.description ||
      (Array.isArray(params.prompts) ? params.prompts[0] : '') ||
      '',
  ).trim();
  if (!prompt) {
    prompt = String(ctx.userMessage || ctx.message || '').trim().slice(0, 2000);
  }
  if (!prompt) throw new Error('prompt required');
  let resolvedParams = await applyImageTierDefaults(env, { ...params, prompt }, {
    workspaceId: ctx.workspaceId,
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    conversationId: ctx.conversationId,
  });
  const dims = parseImageDimensions(resolvedParams.size);
  const isEdit = toolName === 'imgx_edit_image';
  const shouldPersist = imageGenerationShouldPersist(resolvedParams, {
    userMessage: ctx.userMessage ?? ctx.message ?? null,
    message: ctx.message ?? ctx.userMessage ?? null,
  });
  resolvedParams = { ...resolvedParams, persist: shouldPersist };

  const ws = ctx.workspaceId != null ? String(ctx.workspaceId).trim() : '';
  let providerGuess = 'workers_ai';
  let modelGuess = resolvedParams.model ? String(resolvedParams.model).trim() : '';
  let scoredModelKey = modelGuess || null;
  const contentTier =
    resolvedParams.content_tier != null
      ? String(resolvedParams.content_tier).trim() || null
      : null;

  if (isEdit) {
    providerGuess = 'openai';
  } else if (!modelGuess && ws && prompt) {
    const picked = await pickImageModelFromDb(env, ws, prompt, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      conversationId: ctx.conversationId,
    });
    if (picked) {
      console.log('[image_generation] model_picked', {
        lane: imageLaneFromTier(null, false, prompt),
        model_key: picked.model_key,
      });
      scoredModelKey = picked.model_key;
      providerGuess = String(picked.resolved_platform || 'workers_ai');
      modelGuess = scoredModelKey;
      resolvedParams = {
        ...resolvedParams,
        model: scoredModelKey,
        provider: providerGuess,
        secretKeyName: picked.keyName,
        routing_arm_id: picked.arm_id,
      };
    }
  } else if (modelGuess && !resolvedParams.provider) {
    providerGuess = String(resolvedParams.provider || providerGuess);
  }
  if (resolvedParams.provider) {
    providerGuess = String(resolvedParams.provider);
  }

  emit('image_generation_started', {
    type: 'image_generation_started',
    generation_id: generationId,
    provider: providerGuess,
    model: String(modelGuess || ''),
    prompt: prompt.slice(0, 500),
    ...(contentTier ? { content_tier: contentTier } : {}),
    ...(dims.width != null ? { width: dims.width } : {}),
    ...(dims.height != null ? { height: dims.height } : {}),
  });

  let tickIndex = 0;
  let frameIndex = 0;
  const progressTimer = setInterval(() => {
    const tick = IMAGE_PROGRESS_TICKS[tickIndex % IMAGE_PROGRESS_TICKS.length];
    tickIndex += 1;
    emit('image_generation_progress', {
      type: 'image_generation_progress',
      generation_id: generationId,
      progress: tick.progress,
      stage: tick.stage,
      message: tick.message,
      preview_frame: frameIndex,
    });
  }, PROGRESS_INTERVAL_MS);

  // Immediate first tick
  const first = IMAGE_PROGRESS_TICKS[0];
  emit('image_generation_progress', {
    type: 'image_generation_progress',
    generation_id: generationId,
    progress: first.progress,
    stage: first.stage,
    message: first.message,
    preview_frame: 0,
  });
  tickIndex = 1;

  const scoredT0 = Date.now();
  try {
    const result = await runImageGenerationForTool(
      env,
      toolName,
      { ...resolvedParams, generation_id: generationId },
      ctx,
    );
    const outcomeCost = result?.cost_usd ?? result?.usage?.cost_usd ?? null;
    if (scoredModelKey && ws) {
      await recordImageModelOutcome(env, scoredModelKey, ws, true, Date.now() - scoredT0, {
        costUsd: outcomeCost,
        contentTier: result?.content_tier || contentTier,
        tenantId: ctx.tenantId,
        userId: ctx.userId || ctx.authUser?.id,
        routingArmId: result?.routing_arm_id || resolvedParams.routing_arm_id || null,
        provider: result?.provider || providerGuess,
        generationId: result?.generation_id || generationId,
      });
    }

    // Prefer distinct variation URLs (avoid duplicating primary when already in preview_urls).
    const seen = new Set();
    const emitPreview = (url) => {
      const u = String(url || '').trim();
      if (!u || seen.has(u)) return;
      seen.add(u);
      frameIndex += 1;
      emit('image_generation_preview', {
        type: 'image_generation_preview',
        generation_id: generationId,
        preview_url: u,
        frame_index: frameIndex,
      });
    };
    for (const previewUrl of result.preview_urls || []) emitPreview(previewUrl);
    emitPreview(result.image_url);
    for (const v of result.variations || []) emitPreview(v?.image_url || v?.preview_url);

    emit('image_generation_complete', {
      type: 'image_generation_complete',
      generation_id: result.generation_id || generationId,
      status: result.status || (result.persist ? 'saved' : 'draft'),
      preview_url: result.preview_url || result.image_url,
      image_url: result.image_url,
      preview_urls: result.preview_urls || [],
      variations: result.variations || undefined,
      variation_count: result.variation_count || undefined,
      expires_at: result.expires_at,
      r2_key: result.r2_key,
      artifact_id: result.artifact_id,
      provider: result.provider,
      model: result.model,
      persist: result.persist ?? false,
      content_tier: result.content_tier || contentTier,
      cost_usd: outcomeCost,
      routing_arm_id: result.routing_arm_id || resolvedParams.routing_arm_id || null,
    });

    return result;
  } catch (e) {
    if (scoredModelKey && ws) {
      await recordImageModelOutcome(env, scoredModelKey, ws, false, Date.now() - scoredT0, {
        tenantId: ctx.tenantId,
        userId: ctx.userId || ctx.authUser?.id,
        routingArmId: resolvedParams.routing_arm_id || null,
        provider: providerGuess,
        generationId,
      });
    }
    const msg = e?.message != null ? String(e.message) : String(e);
    emit('image_generation_progress', {
      type: 'image_generation_progress',
      generation_id: generationId,
      progress: 100,
      stage: 'failed',
      message: 'Image generation failed',
      preview_frame: frameIndex,
      failed: true,
    });
    throw new Error(msg);
  } finally {
    clearInterval(progressTimer);
  }
}
