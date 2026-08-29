/**
 * Provider + api_platform normalizers.
 *
 * Catalog provider SSOT (live agentsam_model_catalog.provider):
 *   openai | anthropic | google | workers_ai | ollama | deepseek | cursor
 *
 * api_platform SSOT is agentsam_model_catalog.api_platform (guard:model-catalog-platforms).
 * This module only validates + collapses provider synonyms — it does not invent platforms
 * from model_key prefixes and does not map legacy api_platform aliases (fix D1 instead).
 */

/**
 * Dirty / legacy strings shared by both normalizers.
 * - `normalizeProvider`: collapse these to a canonical provider when seen in provider column.
 * - `normalizeApiPlatform`: fail loud (api_platform_retired) — never silent-remap.
 * Keep this as the single list so synonym vs retired drift cannot reopen.
 */
export const LEGACY_DIRTY_PROVIDER_PLATFORM_STRINGS = Object.freeze([
  'vertex',
  'google_vertex',
  'vertex_ai',
  'google_ai',
  'google_ai_studio',
  'google_gemini',
  'openai_api',
  'responses',
  'anthropic_api',
  'workers-ai',
  'workersai',
  'cloudflare_workers_ai',
  'workers_ai_openai_compat',
  'cloudflare',
]);

/** Dirty string → canonical provider (subset of LEGACY_DIRTY_PROVIDER_PLATFORM_STRINGS). */
const LEGACY_DIRTY_TO_PROVIDER = Object.freeze({
  openai_api: 'openai',
  responses: 'openai',
  anthropic_api: 'anthropic',
  google_gemini: 'google',
  vertex_ai: 'google',
  google_vertex: 'google',
  vertex: 'google',
  google_ai: 'google',
  google_ai_studio: 'google',
  workersai: 'workers_ai',
  'workers-ai': 'workers_ai',
  cloudflare_workers_ai: 'workers_ai',
  workers_ai_openai_compat: 'workers_ai',
  cloudflare: 'workers_ai',
});

/**
 * Additional provider-column synonyms that are *legal* api_platform values
 * (collapse provider only — never treat as retired api_platform).
 */
const LEGAL_PLATFORM_AS_PROVIDER_SYNONYM = Object.freeze({
  openai_chat_completions: 'openai',
  openai_responses: 'openai',
  gemini_api: 'google',
});

/** Canonical provider values written to / read from agentsam_model_catalog.provider. */
export const KNOWN_PROVIDERS = Object.freeze(
  new Set(['openai', 'anthropic', 'google', 'workers_ai', 'ollama', 'deepseek', 'cursor']),
);

export function normalizeProvider(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return v;

  if (Object.prototype.hasOwnProperty.call(LEGACY_DIRTY_TO_PROVIDER, v)) {
    return LEGACY_DIRTY_TO_PROVIDER[v];
  }
  if (Object.prototype.hasOwnProperty.call(LEGAL_PLATFORM_AS_PROVIDER_SYNONYM, v)) {
    return LEGAL_PLATFORM_AS_PROVIDER_SYNONYM[v];
  }
  if (v === 'google') return 'google';
  if (v === 'workers_ai') return 'workers_ai';
  if (v === 'ollama') return 'ollama';
  // First-class vendors (OpenAI-compatible HTTP ≠ provider=openai; Cursor SDK ≠ openai).
  if (v === 'deepseek') return 'deepseek';
  if (v === 'cursor' || v === 'cursor_sdk') return 'cursor';

  return v;
}

/** Catalog-legal api_platform values. Keep scripts/guard-model-catalog-platforms.mjs in sync. */
export const KNOWN_API_PLATFORMS = Object.freeze(
  new Set([
    'openai_responses',
    'openai_chat_completions',
    'openai_realtime',
    'openai_images',
    'openai_embeddings',
    'anthropic',
    'gemini_api',
    'google_interactions',
    'workers_ai',
    'deepseek',
    'ollama',
    'cursor_sdk',
  ]),
);

/** Retired api_platform labels — derived from the shared dirty list (minus cloudflare provider-only). */
export const RETIRED_API_PLATFORMS = Object.freeze(
  new Set(LEGACY_DIRTY_PROVIDER_PLATFORM_STRINGS),
);

/**
 * Validate catalog api_platform. Fail loud on blank/unknown/ambiguous/legacy aliases.
 * Do NOT guess from model_key — agentsam_model_catalog.api_platform is SSOT.
 */
export function normalizeApiPlatform(value, modelKey = '') {
  const mk = String(modelKey || '').trim();
  const v = String(value || '').trim().toLowerCase();
  if (!v || v === 'unknown') {
    throw new Error(
      `api_platform_required: catalog missing api_platform for model "${mk || '(unknown)'}"`,
    );
  }
  if (v === 'openai') {
    throw new Error(
      `api_platform_ambiguous: "openai" is not a dispatch platform for "${mk}" — ` +
        'use openai_responses|openai_chat_completions|openai_images|openai_embeddings|openai_realtime',
    );
  }
  // Retired / legacy labels — fix the catalog row; do not silently remap here.
  if (RETIRED_API_PLATFORMS.has(v)) {
    throw new Error(
      `api_platform_retired: "${v}" for model "${mk}" — set agentsam_model_catalog.api_platform ` +
        'to a KNOWN_API_PLATFORMS value (Veo/Gemini → gemini_api; OpenAI chat → openai_chat_completions|openai_responses; Cursor → cursor_sdk; DeepSeek → deepseek)',
    );
  }
  if (!KNOWN_API_PLATFORMS.has(v)) {
    throw new Error(
      `api_platform_unknown: "${v}" for model "${mk}" — fix agentsam_model_catalog.api_platform`,
    );
  }
  return v;
}
