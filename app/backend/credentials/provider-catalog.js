/** Provider-neutral key catalog for AgentSamRemix settings. */
export const KEY_CATEGORIES = Object.freeze(new Set(['provider', 'personal']));

export const PROVIDERS = Object.freeze(new Set([
  'openai',
  'anthropic',
  'google',
  'cloudflare',
  'github',
  'resend',
  'cursor',
  'supabase',
  'meshy',
  'other',
]));

export const PROVIDER_OPTIONS = Object.freeze([
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'google', label: 'Google AI' },
  { id: 'cloudflare', label: 'Cloudflare' },
  { id: 'github', label: 'GitHub' },
  { id: 'resend', label: 'Resend' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'supabase', label: 'Supabase' },
  { id: 'meshy', label: 'Meshy' },
  { id: 'other', label: 'Other' },
]);

export const BYOK_USER_SCOPE = 'user';
export const PERSONAL_SERVICE_NAME = 'personal';

export function providerSecretName(secretId, provider) {
  return `provider_key:${provider}:${secretId}`;
}
