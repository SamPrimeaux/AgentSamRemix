/**
 * Image tool telemetry — usage + USD estimates for TELEMETRY-002.
 * Handlers attach the returned `usage` object; extractToolExecUsage reads it on the loop path.
 */
import { parseGeminiUsageMetadata } from '../integrations/gemini.js';
import { estimateModelRunCostUsd } from '../../backend/telemetry/model-pricing.js';

/** @typedef {'1k' | '2k' | '4k'} GeminiImageSize */

/** Stable content-type keys for cost/quality learning (not the same as OpenAI quality=low|medium|high). */
export const IMAGE_CONTENT_TIERS = Object.freeze({
  draft_mockup: 'draft_mockup',
  standard_render: 'standard_render',
  presentation_quality: 'presentation_quality',
});

/**
 * Map classifyImageTier() → learning key (low-fi mockup vs investor deck, etc.).
 * @param {'draft' | 'quality' | 'standard' | string | null | undefined} tier
 */
export function contentTierFromImageTier(tier) {
  const t = String(tier || '').trim().toLowerCase();
  if (t === 'draft') return IMAGE_CONTENT_TIERS.draft_mockup;
  if (t === 'quality') return IMAGE_CONTENT_TIERS.presentation_quality;
  return IMAGE_CONTENT_TIERS.standard_render;
}

/**
 * Map pixel dimensions to Gemini imageSize tier (billing dial).
 * @param {number} width
 * @param {number} height
 * @returns {GeminiImageSize}
 */
export function resolveGeminiImageSize(width, height) {
  const maxEdge = Math.max(Number(width) || 0, Number(height) || 0);
  if (maxEdge >= 2048) return '4k';
  if (maxEdge >= 1536) return '2k';
  return '1k';
}

/**
 * @param {number} width
 * @param {number} height
 * @returns {string}
 */
export function resolveGeminiAspectRatio(width, height) {
  const w = Number(width) || 1024;
  const h = Number(height) || 1024;
  const ratio = w / h;
  if (ratio >= 1.7) return '16:9';
  if (ratio >= 1.2) return '4:3';
  if (ratio <= 0.6) return '9:16';
  if (ratio <= 0.85) return '3:4';
  return '1:1';
}

/**
 * OpenAI gpt-image-2 per-image USD (quality × size). API often omits usage — use explicit matrix.
 * @param {string | null | undefined} quality
 * @param {string | null | undefined} openAiSize
 */
export function estimateGptImage2CostUsd(quality, openAiSize) {
  const q = String(quality || 'medium').trim().toLowerCase();
  const tier = q === 'low' || q === 'high' || q === 'auto' ? q : q === 'hd' ? 'high' : 'medium';
  const size = String(openAiSize || '1024x1024').trim().toLowerCase();
  /** @type {Record<string, Record<string, number>>} */
  const matrix = {
    low: {
      '1024x1024': 0.011,
      '1536x1024': 0.016,
      '1024x1536': 0.016,
      '1792x1024': 0.02,
      '1024x1792': 0.02,
    },
    medium: {
      '1024x1024': 0.042,
      '1536x1024': 0.063,
      '1024x1536': 0.063,
      '1792x1024': 0.08,
      '1024x1792': 0.08,
    },
    high: {
      '1024x1024': 0.167,
      '1536x1024': 0.21,
      '1024x1536': 0.21,
      '1792x1024': 0.25,
      '1024x1792': 0.25,
    },
    auto: {
      '1024x1024': 0.042,
      '1536x1024': 0.063,
      '1024x1536': 0.063,
      '1792x1024': 0.08,
      '1024x1792': 0.08,
    },
  };
  return matrix[tier]?.[size] ?? matrix.medium['1024x1024'];
}

/**
 * @param {import('@cloudflare/workers-types').D1Database | null | undefined} db
 * @param {{
 *   provider: string,
 *   model: string,
 *   inputTokens?: number,
 *   outputTokens?: number,
 *   quality?: string | null,
 *   openAiSize?: string | null,
 *   imageSize?: string | null,
 *   imageCount?: number,
 * }} q
 */
export async function estimateImageGenerationCostUsd(db, q) {
  const provider = String(q.provider || '').trim().toLowerCase();
  const model = String(q.model || '').trim();
  const inTok = Math.max(0, Math.floor(Number(q.inputTokens) || 0));
  const outTok = Math.max(0, Math.floor(Number(q.outputTokens) || 0));

  if (db && model && (inTok > 0 || outTok > 0)) {
    const priced = await estimateModelRunCostUsd(db, {
      modelKey: model,
      provider,
      inputTokens: inTok,
      outputTokens: outTok,
      pricingKind: provider.includes('openai') && model.startsWith('gpt-image') ? 'image' : 'standard',
    });
    if (priced.costUsd > 0) {
      return { costUsd: priced.costUsd, pricingSource: priced.source || 'token_rates' };
    }
  }

  if (provider.includes('openai') && model.startsWith('gpt-image')) {
    return {
      costUsd: estimateGptImage2CostUsd(q.quality, q.openAiSize),
      pricingSource: 'gpt_image_matrix',
    };
  }

  if (
    (provider.includes('google') || provider.includes('gemini')) &&
    (model.startsWith('gemini-') || model.includes('imagen'))
  ) {
    const sizeKey =
      q.imageSize != null
        ? String(q.imageSize).trim().toLowerCase()
        : '1k';
    /** Rough USD/image until token rates land — flash cheap, pro ~10× (benchmark 2026-07-08). */
    const isPro = /pro/i.test(model);
    /** @type {Record<string, number>} */
    const flash = { '1k': 0.02, '2k': 0.04, '4k': 0.08 };
    /** @type {Record<string, number>} */
    const pro = { '1k': 0.08, '2k': 0.13, '4k': 0.24 };
    const table = isPro ? pro : flash;
    return {
      costUsd: table[sizeKey] ?? (isPro ? 0.13 : 0.02),
      pricingSource: 'gemini_image_matrix',
    };
  }

  const count = Math.max(1, Math.floor(Number(q.imageCount) || 1));
  if (provider.includes('workers')) {
    return { costUsd: 0.002 * count, pricingSource: 'workers_ai_estimate' };
  }

  return { costUsd: 0, pricingSource: 'none' };
}

/**
 * Build execResult.usage for image tool returns.
 * @param {import('@cloudflare/workers-types').D1Database | null | undefined} db
 * @param {{
 *   provider: string,
 *   model: string,
 *   usageMetadata?: Record<string, unknown> | null,
 *   quality?: string | null,
 *   openAiSize?: string | null,
 *   imageSize?: string | null,
 *   imageCount?: number,
 * }} q
 */
export async function buildImageToolExecUsage(db, q) {
  const provider = String(q.provider || '').trim();
  const model = String(q.model || '').trim();
  const parsed =
    q.usageMetadata && typeof q.usageMetadata === 'object'
      ? parseGeminiUsageMetadata({ usageMetadata: q.usageMetadata })
      : null;
  const inputTokens = parsed?.prompt_tokens ?? 0;
  const outputTokens = parsed?.output_tokens ?? 0;

  const { costUsd, pricingSource } = await estimateImageGenerationCostUsd(db, {
    provider,
    model,
    inputTokens,
    outputTokens,
    quality: q.quality,
    openAiSize: q.openAiSize,
    imageSize: q.imageSize,
    imageCount: q.imageCount ?? 1,
  });

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: costUsd,
    pricing_source: pricingSource,
    image_size: q.imageSize ?? null,
    model_key: model || null,
    provider: provider || null,
  };
}

/**
 * Attach usage block to an image generation tool result object.
 * @param {import('@cloudflare/workers-types').D1Database | null | undefined} db
 * @param {Record<string, unknown>} result
 * @param {{
 *   quality?: string | null,
 *   openAiSize?: string | null,
 *   imageSize?: string | null,
 * }} billing
 */
export async function attachImageGenerationUsage(db, result, billing = {}) {
  if (!result || typeof result !== 'object') return result;
  const usage = await buildImageToolExecUsage(db, {
    provider: String(result.provider || ''),
    model: String(result.model || ''),
    usageMetadata:
      result.usageMetadata && typeof result.usageMetadata === 'object'
        ? /** @type {Record<string, unknown>} */ (result.usageMetadata)
        : null,
    quality: billing.quality,
    openAiSize: billing.openAiSize,
    imageSize: billing.imageSize,
    imageCount: 1,
  });
  return {
    ...result,
    usage,
    model_key: result.model,
    modelKey: result.model,
    cost_usd: usage.cost_usd,
    costUsd: usage.cost_usd,
  };
}
