/**
 * Anthropic Agent Skills API (beta skills-2025-10-02).
 * Skills run inside code execution; pair with Files API for downloads.
 */
import Anthropic from '@anthropic-ai/sdk';
import { resolveApiKey } from '../core/vault.js';

export const ANTHROPIC_SKILLS_BETA = 'skills-2025-10-02';

async function clientForUser(env, userId) {
  const apiKey = await resolveApiKey(env, userId, 'ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured for this user');
  return new Anthropic({ apiKey });
}

/**
 * Normalize skills for Messages `container.skills` (max 8).
 * @param {Array<{ type?: string, skill_id: string, version?: string }>} skills
 */
export function normalizeAnthropicContainerSkills(skills) {
  if (!Array.isArray(skills) || !skills.length) return [];
  return skills
    .slice(0, 8)
    .map((s) => {
      const skill_id = String(s?.skill_id || s?.skillId || '').trim();
      if (!skill_id) return null;
      const type = String(s?.type || (skill_id.startsWith('skill_') ? 'custom' : 'anthropic')).trim();
      const version = s?.version != null ? String(s.version).trim() : 'latest';
      return { type, skill_id, version: version || 'latest' };
    })
    .filter(Boolean);
}

/** @param {{ env: any, userId?: string|null, source?: 'anthropic'|'custom'|null, limit?: number }} opts */
export async function listAnthropicSkills(opts = {}) {
  const client = await clientForUser(opts.env, opts.userId);
  const params = {};
  if (opts.source) params.source = opts.source;
  if (opts.limit != null) params.limit = Number(opts.limit);
  return client.beta.skills.list(params);
}

/** @param {{ env: any, userId?: string|null, skillId: string }} opts */
export async function retrieveAnthropicSkill(opts) {
  const client = await clientForUser(opts.env, opts.userId);
  return client.beta.skills.retrieve(String(opts.skillId || '').trim());
}

/**
 * Betas required when Skills appear on a Messages request.
 * @returns {string[]}
 */
export function anthropicSkillsMessageBetas() {
  return [ANTHROPIC_SKILLS_BETA];
}
