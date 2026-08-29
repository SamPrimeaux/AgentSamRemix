/**
 * Canonical Google/Gemini lane map for AgentSam routing (August 2026).
 * D1 (`agentsam_model_catalog`, `agentsam_ai`, `agentsam_routing_arms`) is source of truth;
 * these constants align hot-path code with the same policy.
 */

export const GOOGLE_MODEL_ROUTES = Object.freeze({
  agenticCodingDefault: 'gemini-3.7-flash',
  premiumReasoning: 'gemini-3.7-flash',
  customToolAgent: 'gemini-3.1-pro-preview-customtools',
  cheapFast: 'gemini-3.5-flash-lite',
  imageFast: 'gemini-3.1-flash-image',
  imagePro: 'gemini-3-pro-image',
  tts: 'gemini-3.1-flash-tts-preview',
  computerUse: 'models/gemini-2.5-computer-use-preview-10-2025',
  deepResearch: 'deep-research-preview-04-2026',
  deepResearchMax: 'deep-research-max-preview-04-2026',
  /** Multimodal embedding lane only — not primary text RAG (see embedding-routes.js). */
  multimodalEmbedding: 'models/gemini-embedding-2',
  videoFast: 'models/veo-3.1-lite-generate-preview',
  videoStandard: 'models/veo-3.1-generate-preview',
  videoFastAlt: 'models/veo-3.1-fast-generate-preview',
  musicClip: 'models/lyria-3-clip-preview',
  musicPro: 'models/lyria-3-pro-preview',
  /** Live / voice input lane — browser SpeechRecognition → text; not chat picker default. */
  flashLive: 'gemini-3.1-flash-live-preview',
  /** Remote Linux sandbox agent — repo mount, install/test, scout reports (Interactions API). */
  antigravity: 'models/antigravity-preview-05-2026',
});

/** Google-shutdown or IAM-retired keys → current replacement. */
export const GOOGLE_MODEL_DEPRECATED_REDIRECTS = Object.freeze({
  'gemini-3-pro-preview': GOOGLE_MODEL_ROUTES.premiumReasoning,
  'gemini-3.1-pro-preview': GOOGLE_MODEL_ROUTES.agenticCodingDefault,
  'gemini-3.1-flash-lite-preview': GOOGLE_MODEL_ROUTES.cheapFast,
  'gemini-3.1-flash-lite': GOOGLE_MODEL_ROUTES.cheapFast,
  'gemini-3.5-flash': GOOGLE_MODEL_ROUTES.agenticCodingDefault,
  'gemini-2.5-pro': GOOGLE_MODEL_ROUTES.premiumReasoning,
  'gemini-2.5-flash': GOOGLE_MODEL_ROUTES.agenticCodingDefault,
  'gemini-2.5-flash-lite': GOOGLE_MODEL_ROUTES.cheapFast,
  'gemini-3-pro-image-preview': GOOGLE_MODEL_ROUTES.imagePro,
  'gemini-3.1-flash-image-preview': GOOGLE_MODEL_ROUTES.imageFast,
  'gemini-2.5-flash-image': GOOGLE_MODEL_ROUTES.imageFast,
  'gemini-robotics-er-1.5-preview': 'gemini-robotics-er-1.6-preview',
  'deep-research-pro-preview-12-2025': GOOGLE_MODEL_ROUTES.deepResearch,
});

/**
 * @param {string|null|undefined} modelKey
 * @returns {string}
 */
export function redirectDeprecatedGoogleModelKey(modelKey) {
  const k = String(modelKey || '').trim();
  if (!k) return k;
  let cur = k;
  for (let i = 0; i < 8; i++) {
    const next = GOOGLE_MODEL_DEPRECATED_REDIRECTS[cur];
    if (!next || next === cur) break;
    cur = next;
  }
  return cur;
}
