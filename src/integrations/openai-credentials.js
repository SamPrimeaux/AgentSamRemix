/**
 * OpenAI platform credential selection — additive AGENTSAMGPT_SERVICEKEY tier.
 * OPENAI_API_KEY remains default for all existing catalog keys; GPT-5.5 / codex opt in here.
 */

import { resolveApiKey } from '../core/vault.js';

export const OPENAI_PLATFORM_DEFAULT_SECRET = 'OPENAI_API_KEY';
/** Wrangler secret — Codex / GPT-5.5 subagent tier (not a replacement for OPENAI_API_KEY). */
export const OPENAI_AGENTSAM_GPT_TIER_SECRET = 'AGENTSAMGPT_SERVICEKEY';
/** Wrangler secret — DeepSeek API (OpenAI-compatible chat completions). */
export const DEEPSEEK_PLATFORM_SECRET = 'AGENTSAM_DEEPSEEK';
/** OpenAI-compatible chat completions — no /v1 suffix (see DeepSeek docs). */
export const DEEPSEEK_API_BASE = 'https://api.deepseek.com';
/** Beta base — strict tool JSON schema mode. */
export const DEEPSEEK_API_BASE_BETA = 'https://api.deepseek.com/beta';

/**
 * Which Wrangler / user_secrets name to use for an OpenAI call.
 * @param {string|null|undefined} modelKey — agentsam_model_catalog.model_key
 * @param {string|null|undefined} catalogSecretKeyName — agentsam_ai.secret_key_name when set
 */
export function resolveOpenAiSecretKeyName(modelKey, catalogSecretKeyName = null) {
  const fromCatalog =
    catalogSecretKeyName != null ? String(catalogSecretKeyName).trim() : '';
  if (fromCatalog) return fromCatalog;

  const mk = String(modelKey || '').trim().toLowerCase();
  if (!mk) return OPENAI_PLATFORM_DEFAULT_SECRET;
  if (mk.startsWith('deepseek-') || mk === 'deepseek-r1' || mk === 'deepseek-v3') {
    return DEEPSEEK_PLATFORM_SECRET;
  }
  if (mk.startsWith('gpt-5.5') || mk.includes('codex')) {
    return OPENAI_AGENTSAM_GPT_TIER_SECRET;
  }
  return OPENAI_PLATFORM_DEFAULT_SECRET;
}

/**
 * OpenAI-compatible upstream (OpenAI, DeepSeek, …).
 * @param {{ secretKeyName?: string|null, secret_key_name?: string|null, apiPlatform?: string|null, api_platform?: string|null, provider?: string|null }} [opts]
 */
export function isDeepSeekOpenAiCompatibleDispatch(opts = {}) {
  const plat = String(opts.apiPlatform ?? opts.api_platform ?? '').trim().toLowerCase();
  const prov = String(opts.provider ?? '').trim().toLowerCase();
  const sec = String(opts.secretKeyName ?? opts.secret_key_name ?? '').trim();
  return plat === 'deepseek' || prov === 'deepseek' || sec === DEEPSEEK_PLATFORM_SECRET;
}

/**
 * @param {{ secretKeyName?: string|null, secret_key_name?: string|null, apiPlatform?: string|null, api_platform?: string|null, provider?: string|null, deepseekStrictTools?: boolean|null, deepseekBeta?: boolean|null, deepseek_strict_tools?: boolean|null, deepseek_beta?: boolean|null }} [opts]
 */
export function resolveOpenAiCompatibleBaseUrl(opts = {}) {
  if (!isDeepSeekOpenAiCompatibleDispatch(opts)) return 'https://api.openai.com/v1';
  const strict =
    opts.deepseekStrictTools === true ||
    opts.deepseek_strict_tools === true ||
    opts.deepseekBeta === true ||
    opts.deepseek_beta === true;
  return strict ? DEEPSEEK_API_BASE_BETA : DEEPSEEK_API_BASE;
}

/**
 * Resolve bearer for OpenAI-compatible HTTP (OpenAI, DeepSeek, BYOK user_secrets, Worker secret).
 * @param {object} env
 * @param {string|null|undefined} modelKey
 * @param {string|null|undefined} userId
 * @param {{ secretKeyName?: string|null, secret_key_name?: string|null, apiPlatform?: string|null, api_platform?: string|null, provider?: string|null }} [opts]
 */
export async function resolveOpenAiCompatibleApiKey(env, modelKey, userId, opts = {}) {
  if (isDeepSeekOpenAiCompatibleDispatch(opts)) {
    const secretName =
      opts.secretKeyName ?? opts.secret_key_name ?? DEEPSEEK_PLATFORM_SECRET;
    return resolveApiKey(env, userId, secretName);
  }
  return resolveOpenAiApiKey(env, modelKey, userId, opts);
}

export function modelKeyUsesAgentsamGptServiceKey(modelKey, catalogSecretKeyName = null) {
  return (
    resolveOpenAiSecretKeyName(modelKey, catalogSecretKeyName) === OPENAI_AGENTSAM_GPT_TIER_SECRET
  );
}

/**
 * Resolve bearer for OpenAI HTTP (BYOK user_secrets first, then Worker secret).
 * @param {object} env
 * @param {string|null|undefined} modelKey
 * @param {string|null|undefined} userId
 * @param {{ secretKeyName?: string|null, secret_key_name?: string|null }} [opts]
 */
export async function resolveOpenAiApiKey(env, modelKey, userId, opts = {}) {
  const catalogSecret = opts.secretKeyName ?? opts.secret_key_name ?? null;
  const secretName = resolveOpenAiSecretKeyName(modelKey, catalogSecret);
  return resolveApiKey(env, userId, secretName);
}
