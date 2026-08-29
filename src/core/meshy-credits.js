/**
 * Meshy API credit cost estimates (https://docs.meshy.ai/en/api/pricing).
 * Used for preflight balance checks and agentsam_cad_jobs.credits_consumed estimates.
 *
 * Generation type                          | Cost
 * -----------------------------------------|------------------------------------------
 * Text to 3D Preview (Meshy 6)             | 20 credits
 * Text to 3D Preview (other models)      | 10 credits
 * Text to 3D Refine                      | 10 credits
 * Image to 3D (Meshy 6, no texture)      | 20 credits
 * Image to 3D (Meshy 6, with texture)    | 30 credits
 * Image to 3D (other, no texture)        | 5 credits
 * Image to 3D (other, with texture)      | 15 credits
 * Multi Image to 3D                      | same as Image to 3D
 * Retexture                              | 10 credits
 * Remesh                                 | 5 credits
 * Convert                                | 1 credit
 * Resize                                 | 1 credit
 * UV Unwrap                              | 5 credits
 * Auto-Rigging                           | 5 credits
 * Animation                              | 3 credits
 *
 * Docs: https://docs.meshy.ai/en/api/remesh · convert · resize · uv-unwrap ·
 *       https://docs.meshy.ai/en/api/rigging · https://docs.meshy.ai/en/api/animation
 */

/** @typedef {'text-to-3d-preview' | 'text-to-3d-refine' | 'text-to-3d-full' | 'image-to-3d' | 'multi-image-to-3d' | 'retexture' | 'remesh' | 'convert' | 'resize' | 'rigging' | 'animation' | 'text-to-image' | 'image-to-image' | 'print-repair' | 'print-multi-color' | 'uv-unwrap'} MeshyOperation */

export const MESHY_CREDIT_COSTS = {
  TEXT_TO_3D_PREVIEW_MESHY6: 20,
  TEXT_TO_3D_PREVIEW_DEFAULT: 10,
  TEXT_TO_3D_REFINE: 10,
  /** Meshy 6 preview + refine (worst-case text path preflight) */
  TEXT_TO_3D_FULL_MESHY6: 30,
  /** Other models preview + refine */
  TEXT_TO_3D_FULL_DEFAULT: 20,
  /** Conservative preflight when model tier is unknown */
  TEXT_TO_3D_FULL_CONSERVATIVE: 30,
  IMAGE_TO_3D_MESHY6_MESH: 20,
  IMAGE_TO_3D_MESHY6_TEXTURED: 30,
  IMAGE_TO_3D_DEFAULT_MESH: 5,
  IMAGE_TO_3D_DEFAULT_TEXTURED: 15,
  RETEXTURE: 10,
  REMESH: 5,
  CONVERT: 1,
  RESIZE: 1,
  RIGGING: 5,
  ANIMATION: 3,
  TEXT_TO_IMAGE_NANO: 3,
  TEXT_TO_IMAGE_PRO: 9,
  PRINT_REPAIR: 10,
  PRINT_MULTI_COLOR: 10,
  UV_UNWRAP: 5,
};

/**
 * @param {Record<string, unknown>} [body]
 */
export function isMeshy6AiModel(body = {}) {
  const aiModel = String(body.ai_model || body.aiModel || 'latest').toLowerCase();
  const modelType = String(body.model_type || body.modelType || 'standard').toLowerCase();
  return modelType === 'lowpoly' || aiModel.includes('meshy-6') || aiModel === 'latest';
}

/**
 * @param {Record<string, unknown>} [body]
 */
export function imageTo3dIncludesTexture(body = {}) {
  return body.should_texture !== false;
}

/**
 * Estimate credits for a text-to-3D preview request.
 * @param {Record<string, unknown>} [body]
 */
export function estimateTextTo3dPreviewCost(body = {}) {
  return isMeshy6AiModel(body)
    ? MESHY_CREDIT_COSTS.TEXT_TO_3D_PREVIEW_MESHY6
    : MESHY_CREDIT_COSTS.TEXT_TO_3D_PREVIEW_DEFAULT;
}

/**
 * Estimate credits for text-to-3D preview + refine chain.
 * @param {Record<string, unknown>} [body]
 * @param {{ autoRefine?: boolean }} [opts]
 */
export function estimateTextTo3dFullCost(body = {}, opts = {}) {
  const autoRefine = opts.autoRefine !== false && body.auto_refine !== false;
  if (!autoRefine) return estimateTextTo3dPreviewCost(body);
  return estimateTextTo3dPreviewCost(body) + MESHY_CREDIT_COSTS.TEXT_TO_3D_REFINE;
}

/**
 * Estimate credits for image-to-3D or multi-image-to-3D.
 * @param {Record<string, unknown>} [body]
 */
export function estimateImageTo3dCost(body = {}) {
  const meshy6 = isMeshy6AiModel(body);
  const textured = imageTo3dIncludesTexture(body);
  if (meshy6) {
    return textured
      ? MESHY_CREDIT_COSTS.IMAGE_TO_3D_MESHY6_TEXTURED
      : MESHY_CREDIT_COSTS.IMAGE_TO_3D_MESHY6_MESH;
  }
  return textured
    ? MESHY_CREDIT_COSTS.IMAGE_TO_3D_DEFAULT_TEXTURED
    : MESHY_CREDIT_COSTS.IMAGE_TO_3D_DEFAULT_MESH;
}

/**
 * @param {string} operation
 * @param {Record<string, unknown>} [body]
 */
export function estimateMeshyOperationCost(operation, body = {}) {
  switch (String(operation || '').toLowerCase()) {
    case 'text-to-3d-preview':
      return estimateTextTo3dPreviewCost(body);
    case 'text-to-3d-refine':
      return MESHY_CREDIT_COSTS.TEXT_TO_3D_REFINE;
    case 'text-to-3d-full':
    case 'text-to-3d':
      return estimateTextTo3dFullCost(body);
    case 'image-to-3d':
    case 'multi-image-to-3d':
      return estimateImageTo3dCost(body);
    case 'retexture':
      return MESHY_CREDIT_COSTS.RETEXTURE;
    case 'remesh':
    case 'post-process':
      return MESHY_CREDIT_COSTS.REMESH;
    case 'convert':
      return MESHY_CREDIT_COSTS.CONVERT;
    case 'resize':
      return MESHY_CREDIT_COSTS.RESIZE;
    case 'print-multi-color':
      return MESHY_CREDIT_COSTS.PRINT_MULTI_COLOR;
    case 'print-repair':
      return MESHY_CREDIT_COSTS.PRINT_REPAIR;
    case 'rigging':
      return MESHY_CREDIT_COSTS.RIGGING;
    case 'animation':
      return MESHY_CREDIT_COSTS.ANIMATION;
    case 'uv-unwrap':
    case 'unwrap':
      return MESHY_CREDIT_COSTS.UV_UNWRAP;
    default:
      return MESHY_CREDIT_COSTS.TEXT_TO_3D_FULL_CONSERVATIVE;
  }
}
