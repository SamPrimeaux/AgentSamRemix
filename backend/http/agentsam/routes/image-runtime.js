/**
 * Image generation lane map — aligns with google-model-routes.js + Thompson arms (task_type=image_generation).
 *
 * OpenAI image: gpt-image-2 only (dated snapshot keys gpt-image-2-* allowed).
 */
import { GOOGLE_MODEL_ROUTES } from '../../../agentsam/catalog/google-model-routes.js';
import { providerModelIdFromCatalogRow } from '../../../agentsam/catalog/model-identity.js';

/** @param {string} modelKey */
export function isOpenAiImageModelKey(modelKey) {
  const mk = String(modelKey || '').trim();
  return mk === 'gpt-image-2' || mk.startsWith('gpt-image-2-');
}

/** @param {string} modelKey */
export function assertOpenAiImageModelActive(modelKey) {
  const mk = String(modelKey || '').trim();
  if (isOpenAiImageModelKey(mk)) return;
  throw new Error(
    `unsupported_openai_image_model:${mk || '(empty)'} — use gpt-image-2`,
  );
}

export const IMAGE_GENERATION_LANES = Object.freeze({
  /** Drafts, thumbnails, quick previews — prefer flash / cheap OpenAI. */
  fast_draft: {
    preferredModels: ['gemini-3.1-flash-image', 'gpt-image-2', '@cf/black-forest-labs/flux-2-klein-4b'],
    googleDefault: GOOGLE_MODEL_ROUTES.imageFast,
  },
  /** Logos, hero, client-facing mockups — balanced quality/cost. */
  brand_mockup: {
    preferredModels: ['gemini-3-pro-image', 'gpt-image-2', 'gemini-3.1-flash-image'],
    googleDefault: GOOGLE_MODEL_ROUTES.imagePro,
  },
  /** Final / print / ultra — pro lane first. */
  high_quality: {
    preferredModels: ['gemini-3-pro-image', 'gpt-image-2', 'imagen-4.0-ultra-generate-001'],
    googleDefault: GOOGLE_MODEL_ROUTES.imagePro,
  },
  /** Reference edit / inpaint — imgx_edit_image. */
  edit_reference: {
    preferredModels: ['gpt-image-2', 'gemini-3.1-flash-image', 'gemini-3-pro-image'],
    googleDefault: GOOGLE_MODEL_ROUTES.imageFast,
  },
});

/** Non-picker image-capable surfaces in IAM (tools + routing + CMS). */
export const IMAGE_CAPABLE_SURFACES = Object.freeze([
  { id: 'gemini_flash_image', model: GOOGLE_MODEL_ROUTES.imageFast, task_type: 'image_generation', tool: 'imgx_generate_image' },
  { id: 'gemini_pro_image', model: GOOGLE_MODEL_ROUTES.imagePro, task_type: 'image_generation', tool: 'imgx_generate_image' },
  { id: 'openai_gpt_image_2', model: 'gpt-image-2', task_type: 'image_generation', tool: 'imgx_generate_image' },
  { id: 'workers_ai_flux_klein_4b', model: '@cf/black-forest-labs/flux-2-klein-4b', task_type: 'image_generation', tool: 'imgx_generate_image' },
  { id: 'workers_ai_flux_klein_9b', model: '@cf/black-forest-labs/flux-2-klein-9b', task_type: 'image_generation', tool: 'imgx_generate_image' },
  { id: 'cms_theme_cover', model: 'gemini-3.1-flash-image', task_type: 'cms_theme_cover', tool: null },
  { id: 'meshy_image_to_3d', model: null, task_type: 'meshy', tool: 'meshyai_image_to_3d' },
  { id: 'cf_images_upload', model: null, task_type: 'cf_images', tool: 'cf_images_upload' },
]);

/**
 * @param {string} laneSlug
 * @returns {string|null}
 */
export function preferredGoogleImageModelForLane(laneSlug) {
  const lane = IMAGE_GENERATION_LANES[String(laneSlug || '').trim()];
  return lane?.googleDefault || GOOGLE_MODEL_ROUTES.imageFast;
}

/**
 * Resolve a Workers AI image binding id from agentsam_model_catalog (SSOT).
 * Prefer explicit model_key when provided; otherwise cheapest active Flux / image lane.
 *
 * @param {any} env
 * @param {{ modelKey?: string | null }} [opts]
 * @returns {Promise<{ model_key: string, provider_model_id: string } | null>}
 */
export async function resolveWorkersAiImageModelFromCatalog(env, opts = {}) {
  if (!env?.DB) return null;
  const requested = opts.modelKey != null ? String(opts.modelKey).trim() : '';

  if (requested) {
    const result = await env.DB.prepare(
      `SELECT *
       FROM agentsam_model_catalog
       WHERE is_active = 1
         AND LOWER(COALESCE(api_platform, '')) = 'workers_ai'
         AND (
           LOWER(COALESCE(routing_lane, '')) = 'image'
           OR LOWER(model_key) LIKE '%flux%'
           OR LOWER(COALESCE(display_name, '')) LIKE '%image%'
         )
       ORDER BY model_key
       LIMIT 40`,
    )
      .all()
      .catch(() => ({ results: [] }));
    const row = (result.results || []).find(
      (candidate) =>
        String(candidate?.model_key || '').trim() === requested ||
        providerModelIdFromCatalogRow(candidate) === requested,
    );
    const binding = providerModelIdFromCatalogRow(row);
    if (binding && row?.model_key) {
      return {
        model_key: String(row.model_key).trim(),
        provider_model_id: binding,
      };
    }
    return null;
  }

  const row = await env.DB.prepare(
    `SELECT *
     FROM agentsam_model_catalog
     WHERE is_active = 1
       AND LOWER(COALESCE(api_platform, '')) = 'workers_ai'
       AND (
         LOWER(COALESCE(routing_lane, '')) = 'image'
         OR LOWER(model_key) LIKE '%flux%'
         OR LOWER(COALESCE(display_name, '')) LIKE '%flux%'
         OR LOWER(COALESCE(display_name, '')) LIKE '%image%'
       )
     ORDER BY
       CASE WHEN LOWER(COALESCE(routing_lane, '')) = 'image' THEN 0 ELSE 1 END,
       COALESCE(cost_per_1k_in, 999999) ASC,
       model_key ASC
     LIMIT 1`,
  )
    .first()
    .catch(() => null);

  const binding = providerModelIdFromCatalogRow(row);
  if (!binding) return null;
  return {
    model_key: String(row.model_key).trim(),
    provider_model_id: binding,
  };
}
