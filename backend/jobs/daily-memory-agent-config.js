/**
 * Daily memory / focus email agent — model + instructions from
 * agentsam_subagent_profile (slug daily-memory-email). No hardcoded Gemini ids.
 */

import { loadModelRecord } from '../agentsam/catalog/model-resolution.js';

export const DAILY_MEMORY_AGENT_SLUG = 'daily-memory-email';

export class DailyMemoryAgentConfigError extends Error {
  constructor(message, { stage = 'agent_profile', model = '' } = {}) {
    super(message);
    this.name = 'DailyMemoryAgentConfigError';
    this.stage = stage;
    this.model = model;
  }
}

/**
 * @param {*} env
 * @param {{ loadModelRecord?: typeof loadModelRecord }} [deps]
 */
export async function resolveDailyMemoryAgentConfig(env, deps = {}) {
  if (!env?.DB) {
    throw new DailyMemoryAgentConfigError('DB required to resolve daily memory agent profile');
  }

  const profile = await env.DB.prepare(
    `SELECT id, slug, display_name, default_model_id, instructions_markdown,
            COALESCE(is_platform_global, 0) AS is_platform_global
     FROM agentsam_subagent_profile
     WHERE slug = ? AND is_active = 1 AND COALESCE(is_platform_global, 0) = 1
     LIMIT 1`,
  )
    .bind(DAILY_MEMORY_AGENT_SLUG)
    .first()
    .catch(() => null);

  if (!profile) {
    throw new DailyMemoryAgentConfigError(
      `agentsam_subagent_profile slug=${DAILY_MEMORY_AGENT_SLUG} missing or inactive (platform-global required)`,
    );
  }

  const modelKey = String(profile.default_model_id || '').trim();
  if (!modelKey) {
    throw new DailyMemoryAgentConfigError(
      `agentsam_subagent_profile slug=${DAILY_MEMORY_AGENT_SLUG} has empty default_model_id`,
    );
  }

  const loadModel = deps.loadModelRecord || loadModelRecord;
  let catalog;
  try {
    catalog = await loadModel(env.DB, modelKey, 'daily_memory_agent');
  } catch (err) {
    throw new DailyMemoryAgentConfigError(
      `daily memory agent default_model_id "${modelKey}" is not an active catalog model: ${err?.message || err}`,
      { model: modelKey },
    );
  }

  const apiModel = String(catalog.provider_model_id || catalog.model_key || modelKey).trim();
  if (!apiModel) {
    throw new DailyMemoryAgentConfigError(
      `daily memory agent catalog row for "${modelKey}" has no provider_model_id/model_key`,
      { model: modelKey },
    );
  }

  return {
    slug: DAILY_MEMORY_AGENT_SLUG,
    profileId: String(profile.id || ''),
    displayName: String(profile.display_name || DAILY_MEMORY_AGENT_SLUG),
    catalogModelKey: String(catalog.model_key),
    apiModel,
    instructions: String(profile.instructions_markdown || '').trim(),
  };
}
