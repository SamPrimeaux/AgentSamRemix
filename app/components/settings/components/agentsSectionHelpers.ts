import type { AgentsamUserPolicy } from '../types';

/** Default starter commands for new users with empty command allowlists. */
export const STARTER_COMMAND_SUGGESTIONS = [
  'ls',
  'cat',
  'pwd',
  'cd',
  'echo',
  'grep',
  'rg',
  'git status',
  'git log',
  'git diff',
  'node --version',
  'npm --version',
  'npx --version',
  'wrangler --version',
  'gh --version',
] as const;

export type AgentReviewSettings = {
  agent_review_on_commit?: boolean;
  agent_review_submodules?: boolean;
  agent_review_untracked?: boolean;
  agent_review_approach?: 'quick' | 'deep';
};

export type PolicySettingsJson = AgentReviewSettings & {
  branch_prefix?: string;
  auto_approve_mode_transitions?: boolean;
  conversation_density?: 'detailed' | 'minimal';
  completion_sound?: boolean;
  pr_destination?: 'github_web' | 'github_desktop' | 'ide';
};

export function parsePolicySettingsJson(raw: string | null | undefined): PolicySettingsJson {
  if (raw == null || raw === '') return {};
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as PolicySettingsJson)
      : {};
  } catch {
    return {};
  }
}

export function mergePolicySettingsJson(
  policy: AgentsamUserPolicy,
  patch: PolicySettingsJson,
): string {
  const current = parsePolicySettingsJson(policy.settings_json);
  return JSON.stringify({ ...current, ...patch });
}

export function applyTextSizeToDom(textSize: string | null | undefined): void {
  if (typeof document === 'undefined') return;
  const v = String(textSize || 'default').trim().toLowerCase();
  if (!v || v === 'default') {
    document.documentElement.removeAttribute('data-text-size');
  } else {
    document.documentElement.setAttribute('data-text-size', v);
  }
}

export function splitVoiceKeywords(raw: string | null | undefined): string[] {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s && !/\s/.test(s));
}

export function joinVoiceKeywords(words: string[]): string {
  return words
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s && !/\s/.test(s))
    .join(',');
}
